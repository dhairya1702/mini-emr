from __future__ import annotations

import json
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pypdf import PdfWriter

from test_app import auth_headers_for_token, client, register_test_clinic

from app.services import referral_workflow


def test_referral_snapshot_json_conversion_handles_uuid():
    patient_id = uuid4()
    converted = referral_workflow._json_value({"patient": {"id": patient_id}, "ids": [patient_id]})
    assert converted == {"patient": {"id": str(patient_id)}, "ids": [str(patient_id)]}
    json.dumps(converted)


@pytest.fixture(autouse=True)
def referral_pdf_builder(monkeypatch):
    def fake_build(_snapshot, _attachments, **_kwargs):
        output = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.add_blank_page(width=595, height=842)
        writer.write(output)
        return output.getvalue(), 2

    monkeypatch.setattr(referral_workflow, "build_referral_package_pdf", fake_build)

def _patient(test_client, headers, name: str = "Referral Patient") -> dict:
    response = test_client.post(
        "/patients",
        json={
            "name": name,
            "phone": "9876543210",
            "email": "patient@example.com",
            "reason": "Specialist review",
            "age": 42,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _final_note(repo, org_id: str, patient_id: str, content: str = "Stable frozen findings") -> str:
    note_id = str(uuid4())
    now = datetime.now(UTC)
    repo.notes[note_id] = {
        "id": note_id,
        "org_id": org_id,
        "patient_id": patient_id,
        "visit_id": None,
        "content": "Mutable content",
        "status": "final",
        "version_number": 1,
        "root_note_id": None,
        "amended_from_note_id": None,
        "snapshot_content": content,
        "asset_payload": [],
        "snapshot_asset_payload": [],
        "structured_modules": [{"module": "eye_exam", "payload": {"distance_va": "6/6 & <N6"}}],
        "clinical_extractions": {},
        "snapshot_clinical_extractions": {},
        "optometry_history": {},
        "snapshot_optometry_history": {},
        "finalized_at": now,
        "sent_at": None,
        "sent_by": None,
        "sent_to": None,
        "created_at": now,
    }
    return note_id


def _create_payload(note_id: str, track_ids: list[str] | None = None) -> dict:
    return {
        "recipient_type": "both",
        "recipient_name": "Dr Receiver",
        "recipient_specialty": "Retina",
        "recipient_clinic": "City Eye Centre",
        "recipient_email": "doctor@example.com",
        "recipient_phone": "+919876543211",
        "reason": "Retinal opinion",
        "clinical_question": "Does this patient need intervention?",
        "urgency": "urgent",
        "referral_note": "Please review the attached records.",
        "consultation_note_ids": [note_id],
        "longitudinal_track_ids": track_ids or [],
        "attachment_ids": [],
    }


def test_referral_package_is_frozen_and_downloadable(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="referral@clinic.com", clinic_name="Referral Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _patient(test_client, headers)
    org_id = session["user"]["org_id"]
    note_id = _final_note(repo, org_id, patient["id"])
    track_id = str(uuid4())
    now = datetime.now(UTC)
    repo.longitudinal_tracks[track_id] = {
        "id": track_id, "org_id": org_id, "patient_id": patient["id"],
        "track_type": "low_vision", "measured_at": now,
        "summary_fields": {"diagnosis": "Low vision"},
        "raw_payload": {"distance_va": {"right": "6/60", "left": "6/36"}},
        "derived_metrics": {}, "created_at": now,
    }

    created = test_client.post(
        f"/patients/{patient['id']}/referral-packages",
        json=_create_payload(note_id, [track_id]),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    package = created.json()
    assert package["status"] == "draft"
    assert package["page_count"] >= 2
    assert package["file_size"] > 400
    assert package["included_records"][0]["id"] == note_id
    assert package["included_records"][1]["id"] == track_id
    assert package["included_records"][1]["title"] == "Low Vision"
    stored_clinic = repo.referral_packages[package["id"]]["snapshot"]["clinic"]
    assert "sender_email_app_password" not in stored_clinic
    assert "public_check_in_token" not in stored_clinic

    first_download = test_client.get(f"/referral-packages/{package['id']}/file", headers=headers)
    assert first_download.status_code == 200
    assert first_download.content.startswith(b"%PDF-")
    repo.notes[note_id]["snapshot_content"] = "Changed after package creation"
    second_download = test_client.get(f"/referral-packages/{package['id']}/file", headers=headers)
    assert second_download.content == first_download.content

    listed = test_client.get(f"/patients/{patient['id']}/referral-packages", headers=headers)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [package["id"]]


def test_referral_creation_freezes_saved_chart_summary_and_patient_note_pdf(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="referral-summary@clinic.com",
        clinic_name="Summary Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _patient(test_client, headers, "Summary Patient")
    exact_summary = "This is the exact saved chart summary. It must not be regenerated."
    repo.patients[patient["id"]]["ai_summary"] = exact_summary
    note_id = _final_note(repo, session["user"]["org_id"], patient["id"], "Frozen patient note content")
    captured: dict = {}

    def fake_note_pdf(*, patient, note_content, generated_on, assets):
        captured["note_patient"] = patient
        captured["note_content"] = note_content
        captured["note_date"] = generated_on
        captured["note_assets"] = assets
        output = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.write(output)
        return output.getvalue()

    def fake_referral_pdf(snapshot, attachments, **kwargs):
        captured["snapshot"] = snapshot
        captured["attachments"] = attachments
        captured.update(kwargs)
        output = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.write(output)
        return output.getvalue(), 1

    monkeypatch.setattr(referral_workflow, "build_note_pdf", fake_note_pdf)
    monkeypatch.setattr(referral_workflow, "build_referral_package_pdf", fake_referral_pdf)

    response = test_client.post(
        f"/patients/{patient['id']}/referral-packages",
        json=_create_payload(note_id),
        headers=headers,
    )

    assert response.status_code == 201, response.text
    assert captured["snapshot"]["patient"]["ai_summary"] == exact_summary
    assert captured["snapshot"]["schema_version"] == 2
    assert captured["note_content"] == "Frozen patient note content"
    assert captured["note_assets"] == []
    assert len(captured["consultation_pdfs"]) == 1
    assert captured["clinic_context"]["clinic_name"] == "Summary Clinic"


def test_referral_rejects_draft_and_cross_patient_records(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="referral-scope@clinic.com", clinic_name="Scope Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _patient(test_client, headers, "First Patient")
    other = _patient(test_client, headers, "Second Patient")
    note_id = _final_note(repo, session["user"]["org_id"], other["id"])

    response = test_client.post(
        f"/patients/{patient['id']}/referral-packages", json=_create_payload(note_id), headers=headers
    )
    assert response.status_code == 400
    assert "does not belong" in response.json()["detail"].lower()

    repo.notes[note_id]["patient_id"] = patient["id"]
    repo.notes[note_id]["status"] = "draft"
    response = test_client.post(
        f"/patients/{patient['id']}/referral-packages", json=_create_payload(note_id), headers=headers
    )
    assert response.status_code == 400
    assert "finalized" in response.json()["detail"].lower()


def test_referral_email_delivery_is_recorded(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="referral-send@clinic.com", clinic_name="Send Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _patient(test_client, headers)
    note_id = _final_note(repo, session["user"]["org_id"], patient["id"])
    package = test_client.post(
        f"/patients/{patient['id']}/referral-packages", json=_create_payload(note_id), headers=headers
    ).json()
    sent: list[dict] = []

    async def fake_send_clinic_email_message(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(referral_workflow, "send_clinic_email_message", fake_send_clinic_email_message)
    response = test_client.post(
        f"/referral-packages/{package['id']}/send",
        json={
            "channels": ["email"],
            "recipients": [{"recipient_type": "doctor", "name": "Dr Receiver", "email": "doctor@example.com"}],
            "message": "",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert response.json()["deliveries"][0]["status"] == "sent"
    assert sent[0]["attachments"][0][2] == "application/pdf"
    assert sent[0]["subject"] == "Referral for Referral Patient"
    assert sent[0]["text_content"] == (
        "Hello Dr. Receiver, Send Clinic is referring Referral Patient to you for Retinal opinion. "
        "The referral letter is attached."
    )
    detail = test_client.get(f"/referral-packages/{package['id']}", headers=headers).json()
    assert detail["status"] == "sent"
    assert detail["deliveries"][0]["recipient"] == "doctor@example.com"


def test_referral_whatsapp_delivery_uses_frozen_pdf_and_is_recorded(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="referral-wa@clinic.com", clinic_name="WhatsApp Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _patient(test_client, headers)
    note_id = _final_note(repo, session["user"]["org_id"], patient["id"])
    package = test_client.post(
        f"/patients/{patient['id']}/referral-packages", json=_create_payload(note_id), headers=headers
    ).json()
    sent: list[dict] = []

    async def fake_send_pdf_document(_repo, **kwargs):
        sent.append(kwargs)
        return SimpleNamespace(provider_message_id="wamid.referral", status="accepted")

    monkeypatch.setattr(referral_workflow, "_send_pdf_document", fake_send_pdf_document)
    response = test_client.post(
        f"/referral-packages/{package['id']}/send",
        json={
            "channels": ["whatsapp"],
            "recipients": [{"recipient_type": "patient", "name": "Referral Patient", "phone": "+919876543211"}],
            "message": "",
            "idempotency_key": "referral-wa-test",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert response.json()["deliveries"][0]["status"] == "accepted"
    assert sent[0]["document_type"] == "referral_package"
    assert sent[0]["document_id"] == package["id"]
    assert sent[0]["pdf_bytes"].startswith(b"%PDF-")
    assert sent[0]["caption"] == (
        "Hello Referral Patient, your referral letter from WhatsApp Clinic is attached. "
        "Please show it to the doctor or hospital you are visiting."
    )
