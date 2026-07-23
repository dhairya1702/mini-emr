import asyncio
import httpx
from pydantic import ValidationError
import pytest

from test_app import client as _client  # noqa: F401 - configures the backend test import path

from app.schema_domains.clinical_extractions import (
    GeneratedConsultationPayload,
    MedicationPrescribed,
    PrescriptionInput,
)
from app.services.ai_generation_service import _merge_prescribed_medications, _render_consultation_note
from app.services import ai_generation_service
from app.services.billing_suggestion_service import _find_catalog_match


def test_generated_consultation_contract_forbids_catalog_fields_from_ai():
    payload = {
        "note_sections": {
            "presenting_complaint": "Fever for two days.",
            "diagnosis": "Viral fever.",
            "clinical_notes": "Patient was examined.",
            "treatment": "Supportive care advised.",
            "follow_up_advice": "Review if symptoms worsen.",
        },
        "services_performed": [],
        "medications_prescribed": [{
            "name": "Paracetamol",
            "strength": "500 mg",
            "dose": "1 tablet",
            "route": "oral",
            "schedule": "twice daily",
            "duration": "3 days",
            "quantity": "6 tablets",
            "instructions": "after food",
            "evidence": "Prescribed today.",
            "catalog_item_id": "6c81ac0d-8449-48dc-b55f-a930a2113751",
        }],
    }
    with pytest.raises(ValidationError):
        GeneratedConsultationPayload.model_validate(payload)


def test_explicit_prescription_overrides_duplicate_ai_extraction():
    ai_medicine = MedicationPrescribed(
        name="Amoxicillin",
        strength="500 mg",
        schedule="twice daily",
        evidence="AI extraction",
    )
    explicit = PrescriptionInput(
        catalog_item_id="6c81ac0d-8449-48dc-b55f-a930a2113751",
        name="Amoxicillin",
        strength="500 mg",
        schedule="three times daily",
        quantity="15 capsules",
    )

    merged = _merge_prescribed_medications([ai_medicine], [explicit])

    assert len(merged) == 1
    assert merged[0].schedule == "three times daily"
    assert merged[0].quantity == "15 capsules"
    assert str(merged[0].catalog_item_id) == str(explicit.catalog_item_id)


def test_note_renderer_places_one_medicine_table_after_treatment_before_follow_up():
    content = _render_consultation_note(
        {
            "presenting_complaint": "Fever.",
            "diagnosis": "Viral illness.",
            "clinical_notes": "Stable.",
            "treatment": "Supportive treatment.",
            "follow_up_advice": "Review in three days.",
        },
        [MedicationPrescribed(name="Paracetamol", strength="500 mg", quantity="6 tablets")],
    )

    assert content.count("Medications Prescribed:") == 1
    assert content.index("Clinical Notes:") < content.index("Diagnosis:")
    assert content.index("Treatment:") < content.index("Medications Prescribed:")
    assert content.index("Medications Prescribed:") < content.index("Follow-up Advice:")
    assert "Paracetamol | 500 mg | — | — | — | — | 6 tablets | —" in content


def test_catalog_matching_auto_match_is_exact_or_alias_only():
    items = [
        {"id": "1", "name": "Rapid Strep Test", "aliases": ["strep test"], "item_type": "service"},
        {"id": "2", "name": "Consultation", "aliases": [], "item_type": "service"},
    ]

    exact, exact_type, _ = _find_catalog_match("Rapid Strep Test", items)
    alias, alias_type, _ = _find_catalog_match("strep test", items)
    unmatched, unmatched_type, _ = _find_catalog_match("chest xray", items)

    assert exact["id"] == "1" and exact_type == "exact"
    assert alias["id"] == "1" and alias_type == "alias"
    assert unmatched is None and unmatched_type is None


def test_catalog_matching_maps_eye_exam_service_language_to_refraction():
    items = [
        {"id": "1", "name": "Refraction", "aliases": [], "item_type": "service"},
        {"id": "2", "name": "Consultation", "aliases": [], "item_type": "service"},
    ]

    matched, match_type, _ = _find_catalog_match(
        "Routine Eye Examination",
        items,
        expand_service_names=True,
    )

    assert matched["id"] == "1"
    assert match_type == "exact"


class _VertexResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code
        self.text = '{"error": {"message": "test error"}}'

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://vertex.test")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("vertex error", request=request, response=response)

    def json(self):
        return {"candidates": []}


def _walk_schema(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_schema(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_schema(child)


def test_consultation_vertex_schema_avoids_rejected_constraint_keywords():
    rejected_keywords = {"maxItems", "minimum", "maximum"}

    for node in _walk_schema(ai_generation_service.CONSULTATION_RESPONSE_SCHEMA):
        assert rejected_keywords.isdisjoint(node)


class _VertexClient:
    def __init__(self, statuses: list[int]):
        self.statuses = statuses
        self.calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        status = self.statuses[min(self.calls, len(self.statuses) - 1)]
        self.calls += 1
        return _VertexResponse(status)


def test_vertex_transient_failures_retry_twice(monkeypatch):
    client = _VertexClient([503, 429, 200])

    async def credentials(_project):
        return "token", "project"

    async def no_wait(_delay):
        return None

    monkeypatch.setattr(ai_generation_service, "_resolve_vertex_credentials", credentials)
    monkeypatch.setattr(ai_generation_service.httpx, "AsyncClient", lambda **_kwargs: client)
    monkeypatch.setattr(ai_generation_service.asyncio, "sleep", no_wait)

    response = asyncio.run(ai_generation_service._generate_vertex_content(
        project_id="project",
        location="global",
        model="gemini-test",
        system_instruction="system",
        prompt="prompt",
        max_output_tokens=100,
        temperature=0,
        max_retries=2,
    ))

    assert response == {"candidates": []}
    assert client.calls == 3


def test_vertex_does_not_retry_invalid_request(monkeypatch):
    client = _VertexClient([400, 200])

    async def credentials(_project):
        return "token", "project"

    monkeypatch.setattr(ai_generation_service, "_resolve_vertex_credentials", credentials)
    monkeypatch.setattr(ai_generation_service.httpx, "AsyncClient", lambda **_kwargs: client)

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(ai_generation_service._generate_vertex_content(
            project_id="project",
            location="global",
            model="gemini-test",
            system_instruction="system",
            prompt="prompt",
            max_output_tokens=100,
            temperature=0,
            max_retries=2,
        ))

    assert client.calls == 1
