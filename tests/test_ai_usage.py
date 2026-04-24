from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services import anthropic_service


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Repo:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def create_ai_usage_event(self, **payload):
        self.events.append(payload)
        return payload


class _Messages:
    def create(self, **_kwargs):
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Generated response")],
            usage=SimpleNamespace(
                input_tokens=123,
                output_tokens=45,
                cache_creation_input_tokens=6,
                cache_read_input_tokens=7,
            ),
        )


class _Anthropic:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.messages = _Messages()


@pytest.mark.anyio
async def test_generate_soap_note_records_org_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(anthropic_service, "Anthropic", _Anthropic)
    monkeypatch.setattr(
        anthropic_service,
        "get_settings",
        lambda: SimpleNamespace(anthropic_api_key="key", anthropic_model="claude-test"),
    )

    content = await anthropic_service.generate_soap_note(
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

    assert content == "Generated response"
    assert len(repo.events) == 1
    event = repo.events[0]
    assert event["org_id"] == "org-1"
    assert event["provider"] == "anthropic"
    assert event["model"] == "claude-test"
    assert event["feature"] == "consultation_note"
    assert event["input_tokens"] == 123
    assert event["output_tokens"] == 45
    assert event["cache_creation_input_tokens"] == 6
    assert event["cache_read_input_tokens"] == 7


@pytest.mark.anyio
async def test_generate_clinic_letter_records_org_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(anthropic_service, "Anthropic", _Anthropic)
    monkeypatch.setattr(
        anthropic_service,
        "get_settings",
        lambda: SimpleNamespace(anthropic_api_key="key", anthropic_model="claude-test"),
    )

    content = await anthropic_service.generate_clinic_letter(
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
    assert event["model"] == "claude-test"


@pytest.mark.anyio
async def test_fallback_generation_does_not_record_ai_usage(monkeypatch):
    repo = _Repo()
    monkeypatch.setattr(
        anthropic_service,
        "get_settings",
        lambda: SimpleNamespace(anthropic_api_key="", anthropic_model="claude-test"),
    )

    content = await anthropic_service.generate_soap_note(
        repo,
        "org-3",
        symptoms="",
        diagnosis="",
        medications="",
        notes="",
    )

    assert "Presenting Complaint:" in content
    assert repo.events == []
