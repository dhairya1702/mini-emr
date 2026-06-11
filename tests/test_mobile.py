from __future__ import annotations

from test_app import auth_headers_for_token, client, register_test_clinic


def _create_patient(test_client, headers, name="Mobile Patient"):
    response = test_client.post(
        "/patients",
        json={
            "name": name,
            "phone": "5550103333",
            "reason": "Mobile consultation",
            "age": 34,
            "weight": 68,
            "height": 171,
            "temperature": 98.6,
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def _generate_note(test_client, headers, patient_id: str):
    response = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient_id,
            "symptoms": "Headache",
            "diagnosis": "Migraine",
            "medications": "Paracetamol",
            "notes": "Hydrate well.",
        },
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


def test_mobile_finalize_consultation_finalizes_note_and_removes_patient_from_queue(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="mobile-finalize@clinic.com",
        clinic_name="Mobile Finalize Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers)
    generated = _generate_note(test_client, headers, patient["id"])

    response = test_client.post(
        "/mobile/consultations/finalize",
        json={"patient_id": patient["id"], "note_id": generated["note_id"]},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["note"]["status"] == "final"
    assert payload["patient"]["status"] == "done"
    assert repo.notes[generated["note_id"]]["snapshot_content"]
    assert repo.patients[patient["id"]]["status"] == "done"
    assert any(
        event["action"] == "mobile_consultation_completed"
        and event["metadata"].get("note_id") == generated["note_id"]
        for event in repo.audit_events.values()
    )


def test_mobile_finalize_rejects_note_for_different_patient(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="mobile-wrong-patient@clinic.com",
        clinic_name="Mobile Wrong Patient Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    first_patient = _create_patient(test_client, headers, name="First Mobile Patient")
    second_patient = _create_patient(test_client, headers, name="Second Mobile Patient")
    generated = _generate_note(test_client, headers, first_patient["id"])

    response = test_client.post(
        "/mobile/consultations/finalize",
        json={"patient_id": second_patient["id"], "note_id": generated["note_id"]},
        headers=headers,
    )

    assert response.status_code == 400
    assert "does not belong" in response.json()["detail"]
    assert repo.notes[generated["note_id"]]["status"] == "draft"
    assert repo.patients[second_patient["id"]]["status"] == "waiting"
