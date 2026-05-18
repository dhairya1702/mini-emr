from __future__ import annotations

from test_app import auth_headers, client, main_module, register
from app.services import note_workflow


def test_sent_consultation_note_is_emailed_and_locked_to_saved_record(client, monkeypatch):
    test_client, repo = client
    session = register(test_client, identifier="notes-lock@clinic.com", clinic_name="Notes Lock Clinic")
    headers = auth_headers(session["token"])
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


def test_note_generation_rate_limit_returns_429(client, monkeypatch):
    test_client, _repo = client
    session = register(test_client, identifier="ratelimit-note@clinic.com", clinic_name="Rate Limit Note Clinic")
    headers = auth_headers(session["token"])
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
    session = register(test_client, identifier="notes-failure@clinic.com", clinic_name="Notes Failure Clinic")
    headers = auth_headers(session["token"])

    async def failing_send_clinic_email_message(**_kwargs):
        raise RuntimeError("SMTP unavailable")

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
