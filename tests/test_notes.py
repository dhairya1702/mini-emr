from __future__ import annotations

from test_app import auth_headers_for_token, client, main_module, register_test_clinic
from app.services import ai_generation_service, note_workflow, whatsapp_document_workflow
from app.services.whatsapp_client import WhatsAppSendResult


class FakeWhatsAppDocumentClient:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.documents: list[dict[str, object]] = []

    def upload_media(self, *, content: bytes, filename: str, content_type: str) -> str:
        self.uploads.append({"content": content, "filename": filename, "content_type": content_type})
        return "media-note"

    def send_document(self, *, to: str, media_id: str, filename: str, caption: str = "") -> WhatsAppSendResult:
        self.documents.append({"to": to, "media_id": media_id, "filename": filename, "caption": caption})
        return WhatsAppSendResult(message_id="wamid.note", raw={"messages": [{"id": "wamid.note"}]})


def test_generate_note_inserts_eye_exam_table_when_ai_omits_it(client, monkeypatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="notes-eye-exam@clinic.com", clinic_name="Eye Exam Clinic")
    headers = auth_headers_for_token(session["token"])

    async def fake_generate_vertex_content(**_kwargs):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": (
                                    "Presenting Complaint:\nBlurred distance vision.\n\n"
                                    "Diagnosis:\nRefractive error.\n\n"
                                    "Clinical Notes:\nAI noted that the eye exam is recorded below.\n\n"
                                    "Treatment:\nSpectacle correction discussed.\n\n"
                                    "Follow-up Advice:\nReview if symptoms worsen."
                                )
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 10},
        }

    monkeypatch.setattr(ai_generation_service, "_generate_vertex_content", fake_generate_vertex_content)

    patient = test_client.post(
        "/patients",
        json={
            "name": "Eye Exam Patient",
            "phone": "5550106767",
            "reason": "Blurred vision",
            "age": 31,
            "weight": 70,
            "height": 172,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Blurred distance vision",
            "diagnosis": "Refractive error",
            "medications": "Spectacle correction discussed.",
            "notes": "AI noted that the eye exam is recorded below.",
            "eye_exam": [
                {"eye": "right", "sphere": "-1.25", "cylinder": "-0.50", "axis": "90", "vision": "6/6"},
                {"eye": "left", "sphere": "-1.00", "cylinder": "-0.25", "axis": "85", "vision": "6/6"},
            ],
        },
        headers=headers,
    )

    assert generated.status_code == 200, generated.json()
    content = generated.json()["content"]
    assert "Clinical Notes:\nEye Exam:" in content
    assert "Eye | Sphere | Cylinder | Axis | Vision" in content
    assert "Right | -1.25 | -0.50 | 90 | 6/6" in content
    assert "Left | -1.00 | -0.25 | 85 | 6/6" in content
    assert content.index("Eye Exam:") < content.index("AI noted that the eye exam is recorded below.")


def test_sent_consultation_note_is_emailed_and_locked_to_saved_record(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="notes-lock@clinic.com", clinic_name="Notes Lock Clinic")
    headers = auth_headers_for_token(session["token"])
    sent_messages: list[dict[str, object]] = []

    async def fake_send_clinic_email_message(**kwargs):
        sent_messages.append(kwargs)

    monkeypatch.setattr(note_workflow, "send_clinic_email_message", fake_send_clinic_email_message)

    patient = test_client.post(
        "/patients",
        json={
            "name": "Note Patient",
            "phone": "5550102424",
            "reason": "Consultation",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Headache",
            "diagnosis": "Migraine",
            "medications": "Paracetamol",
            "notes": "Hydrate well.",
            "assets": [
                {
                    "id": "drawing-1",
                    "kind": "drawing",
                    "name": "consultation-drawing.png",
                    "content_type": "image/png",
                    "data_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnM6tAAAAAASUVORK5CYII=",
                }
            ],
        },
        headers=headers,
    )
    assert generated.status_code == 200
    note_id = generated.json()["note_id"]
    assert note_id
    assert generated.json()["status"] == "draft"
    assert repo.notes[note_id]["status"] == "draft"
    assert repo.notes[note_id]["sent_at"] is None

    edited = test_client.patch(
        f"/notes/{note_id}/draft",
        json={"content": "Clinician-edited consultation note."},
        headers=headers,
    )
    assert edited.status_code == 200
    assert edited.json()["content"] == "Clinician-edited consultation note."
    assert repo.notes[note_id]["content"] == "Clinician-edited consultation note."

    sent = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "recipient_email": "patient@example.com"},
        headers=headers,
    )
    assert sent.status_code == 200
    first_sent_at = repo.notes[note_id]["sent_at"]
    assert first_sent_at is not None
    assert repo.notes[note_id]["status"] == "sent"
    assert repo.notes[note_id]["snapshot_content"]
    assert repo.notes[note_id]["asset_payload"]
    assert len(sent_messages) == 1
    assert sent_messages[0]["recipient"] == "patient@example.com"
    assert sent_messages[0]["subject"] == "Your consultation note from Notes Lock Clinic"
    assert sent_messages[0]["text_content"] == (
        "Hi Note,\n\n"
        "Thank you for visiting Notes Lock Clinic. We've attached your consultation note "
        "from your visit for your records.\n\n"
        "Take care,\nNotes Lock Clinic"
    )
    assert sent_messages[0]["attachments"]

    resent = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "recipient_email": "patient@example.com"},
        headers=headers,
    )
    assert resent.status_code == 200
    assert repo.notes[note_id]["sent_at"] == first_sent_at
    assert len(sent_messages) == 2

    notes = test_client.get(f"/patients/{patient['id']}/notes", headers=headers)
    assert notes.status_code == 200
    assert notes.json()[0]["sent_at"] is not None
    assert notes.json()[0]["status"] == "sent"


def test_consultation_note_can_be_sent_on_whatsapp(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="notes-whatsapp@clinic.com", clinic_name="Notes WhatsApp Clinic")
    headers = auth_headers_for_token(session["token"])
    fake_client = FakeWhatsAppDocumentClient()
    monkeypatch.setattr(whatsapp_document_workflow, "build_whatsapp_client", lambda: fake_client)
    patient = test_client.post(
        "/patients",
        json={
            "name": "WhatsApp Note Patient",
            "phone": "9600106623",
            "reason": "Consultation",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()
    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Blurred vision",
            "diagnosis": "Refractive error",
            "medications": "Spectacles",
            "notes": "Review in one year.",
        },
        headers=headers,
    ).json()

    response = test_client.post(
        "/send-note-whatsapp",
        json={
            "note_id": generated["note_id"],
            "patient_id": patient["id"],
            "recipient_phone": patient["phone"],
            "idempotency_key": "note-send-1",
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["delivery"]["status"] == "accepted"
    assert repo.notes[generated["note_id"]]["status"] == "sent"
    assert fake_client.documents[0]["to"] == "919600106623"
    event = next(iter(repo.whatsapp_message_events.values()))
    assert event["document_type"] == "consultation_note"
    assert event["document_id"] == generated["note_id"]


def test_note_file_attachment_is_persisted_as_patient_attachment(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="notes-attachment@clinic.com", clinic_name="Notes Attachment Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = test_client.post(
        "/patients",
        json={
            "name": "Stored Attachment Patient",
            "phone": "5550102626",
            "reason": "Consultation",
            "age": 34,
            "weight": 70,
            "height": 171,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Rash",
            "diagnosis": "Dermatitis",
            "medications": "",
            "notes": "Photo attached.",
            "assets": [
                {
                    "id": "attachment-1",
                    "kind": "attachment",
                    "name": "rash.png",
                    "content_type": "image/png",
                    "data_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnM6tAAAAAASUVORK5CYII=",
                }
            ],
        },
        headers=headers,
    )

    assert generated.status_code == 200
    note_id = generated.json()["note_id"]
    saved_asset = repo.notes[note_id]["asset_payload"][0]
    assert saved_asset["attachment_id"]
    assert "data_base64" not in saved_asset

    stored_attachment = repo.patient_attachments[saved_asset["attachment_id"]]
    assert stored_attachment["patient_id"] == patient["id"]
    assert stored_attachment["content_type"] == "image/png"
    assert repo.patient_attachment_files[stored_attachment["storage_path"]]

    finalized = test_client.post("/notes/finalize", json={"note_id": note_id}, headers=headers)
    assert finalized.status_code == 200
    assert finalized.json()["snapshot_asset_payload"][0]["attachment_id"] == saved_asset["attachment_id"]


def test_note_generation_rate_limit_returns_429(client, monkeypatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="ratelimit-note@clinic.com", clinic_name="Rate Limit Note Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = test_client.post(
        "/patients",
        json={
            "name": "Rate Limit Patient",
            "phone": "5550102525",
            "reason": "Review",
            "age": 31,
            "weight": 64,
            "height": 167,
            "temperature": 98.5,
        },
        headers=headers,
    ).json()

    monkeypatch.setitem(main_module.RATE_LIMIT_WINDOWS, "note_generation", (1, 60.0))
    main_module.RATE_LIMIT_BUCKETS.clear()

    first = test_client.post(
        "/generate-note",
        json={"patient_id": patient["id"], "symptoms": "Cough", "diagnosis": "Cold", "medications": "Rest", "notes": "Observe"},
        headers=headers,
    )
    assert first.status_code == 200

    second = test_client.post(
        "/generate-note",
        json={"patient_id": patient["id"], "symptoms": "Cough", "diagnosis": "Cold", "medications": "Rest", "notes": "Observe"},
        headers=headers,
    )
    assert second.status_code == 429


def test_note_delivery_failure_reports_finalized_state(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="notes-failure@clinic.com", clinic_name="Notes Failure Clinic")
    headers = auth_headers_for_token(session["token"])

    async def failing_send_clinic_email_message(**_kwargs):
        raise note_workflow.EmailDeliveryError("SMTP unavailable")

    monkeypatch.setattr(note_workflow, "send_clinic_email_message", failing_send_clinic_email_message)

    patient = test_client.post(
        "/patients",
        json={
            "name": "Failure Note Patient",
            "phone": "5550107272",
            "reason": "Consultation",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Headache",
            "diagnosis": "Migraine",
            "medications": "Paracetamol",
            "notes": "Hydrate well.",
        },
        headers=headers,
    )
    assert generated.status_code == 200
    note_id = generated.json()["note_id"]

    response = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "recipient_email": "patient@example.com"},
        headers=headers,
    )

    assert response.status_code == 502
    assert "note finalized" in response.json()["detail"]["message"].lower()
    assert repo.notes[note_id]["status"] == "final"
    assert repo.notes[note_id]["sent_at"] is None
    assert any(
        error["path"] == "/send-note" and error["context"].get("note_id") == note_id
        for error in repo.platform_errors.values()
    )
