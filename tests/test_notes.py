from __future__ import annotations

from test_app import auth_headers, client, main_module, register


def test_sent_consultation_note_is_locked_to_saved_record(client):
    test_client, repo = client
    session = register(test_client, identifier="notes-lock@clinic.com", clinic_name="Notes Lock Clinic")
    headers = auth_headers(session["token"])

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
        },
        headers=headers,
    )
    assert generated.status_code == 200
    note_id = generated.json()["note_id"]
    assert note_id
    assert generated.json()["status"] == "draft"
    assert repo.notes[note_id]["status"] == "draft"
    assert repo.notes[note_id]["sent_at"] is None

    not_finalized = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "phone": patient["phone"]},
        headers=headers,
    )
    assert not_finalized.status_code == 400
    assert "Finalize the note" in not_finalized.text

    finalized = test_client.post(
        "/notes/finalize",
        json={"note_id": note_id},
        headers=headers,
    )
    assert finalized.status_code == 200
    assert finalized.json()["status"] == "final"
    assert finalized.json()["snapshot_content"]

    sent = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "phone": patient["phone"]},
        headers=headers,
    )
    assert sent.status_code == 200
    first_sent_at = repo.notes[note_id]["sent_at"]
    assert first_sent_at is not None
    assert repo.notes[note_id]["status"] == "sent"
    assert repo.notes[note_id]["snapshot_content"]

    resent = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "phone": patient["phone"]},
        headers=headers,
    )
    assert resent.status_code == 200
    assert repo.notes[note_id]["sent_at"] == first_sent_at

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
