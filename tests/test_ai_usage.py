from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services import ai_generation_service


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Repo:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def create_ai_usage_event(self, **payload):
        self.events.append(payload)
        return payload


async def _fake_generate_vertex_content(**_kwargs):
    return {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "Generated response"}],
                }
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 123,
            "candidatesTokenCount": 45,
            "cachedContentTokenCount": 7,
        },
    }


@pytest.mark.anyio
async def test_generate_soap_note_records_org_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_generate_vertex_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    result = await ai_generation_service.generate_soap_note(
        repo,
        "org-1",
        symptoms="Fever",
        diagnosis="Viral infection",
        medications="Paracetamol",
        notes="Rest well",
        patient_context="Name: Test Patient",
        clinic_context="Clinic Name: Demo Clinic",
        measurements_context="Temperature: 101 F",
    )

    assert "Presenting Complaint:" in result["content"]
    assert "Fever" in result["content"]
    assert "Diagnosis:" in result["content"]
    assert result["used_fallback"] is False
    assert len(repo.events) == 1
    event = repo.events[0]
    assert event["org_id"] == "org-1"
    assert event["provider"] == "gemini"
    assert event["model"] == "gemini-test"
    assert event["feature"] == "consultation_note"
    assert event["input_tokens"] == 123
    assert event["output_tokens"] == 45
    assert event["cache_read_input_tokens"] == 7


@pytest.mark.anyio
async def test_generate_clinic_letter_records_org_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", _fake_generate_vertex_content)
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="project-1",
            google_cloud_location="global",
            gemini_model="gemini-test",
        ),
    )

    content = await ai_generation_service.generate_clinic_letter(
        repo,
        "org-2",
        to="Patient",
        subject="Follow-up",
        content="Please continue treatment.",
        clinic_context="Clinic Name: Demo Clinic",
    )

    assert content == "Generated response"
    assert len(repo.events) == 1
    event = repo.events[0]
    assert event["org_id"] == "org-2"
    assert event["feature"] == "clinic_letter"
    assert event["model"] == "gemini-test"


@pytest.mark.anyio
async def test_fallback_generation_does_not_record_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(
        ai_generation_service,
        "get_settings",
        lambda: SimpleNamespace(
            google_cloud_project="",
            google_cloud_location="global",
            gemini_model="",
        ),
    )

    result = await ai_generation_service.generate_soap_note(
        repo,
        "org-3",
        symptoms="",
        diagnosis="",
        medications="",
        notes="",
    )

    assert "Presenting Complaint:" in result["content"]
    assert result["used_fallback"] is True
    assert repo.events == []


def test_normalized_note_strips_pipe_tables_from_generated_content():
    content = ai_generation_service._normalize_note_content(
        """
Presenting Complaint:
Dry cough since yesterday.

Diagnosis:
Viral URI.

Clinical Notes:
Field | Value
--- | ---
Template Key | well_visit_summary

Field | Value
--- | ---
Preset Key | routine_review

Patient appears well.

Treatment:
Paracetamol.

Follow-up Advice:
Review if worsening.
""",
        symptoms="Dry cough",
        diagnosis="Viral URI",
        medications="Paracetamol",
        notes="Patient appears well.",
    )

    assert "Field | Value" not in content
    assert "Template Key" not in content
    assert "Preset Key" not in content
    assert "well_visit_summary" not in content
    assert "routine_review" not in content
    assert "Patient appears well." in content
