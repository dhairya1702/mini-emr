from __future__ import annotations

from test_app import auth_headers_for_token, client, register_test_clinic


def _create_patient(test_client, headers, *, phone: str):
    return test_client.post(
        "/patients",
        json={
            "name": "Summary Patient",
            "phone": phone,
            "reason": "Consultation",
            "age": 40,
            "weight": 72,
            "height": 175,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()


def test_patient_summary_is_generated_and_cached(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="summary@clinic.com", clinic_name="Summary Clinic"
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, phone="5550107777")

    response = test_client.get(f"/patients/{patient['id']}/summary", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]
    assert body["stale"] is False
    # GEMINI is unconfigured in tests, so the deterministic fallback is used.
    assert body["used_fallback"] is True
    assert repo.patients[patient["id"]]["ai_summary_stale"] is False
    assert repo.patients[patient["id"]]["ai_summary"]


def test_finalizing_a_note_marks_summary_stale(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="summary-stale@clinic.com", clinic_name="Stale Clinic"
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, phone="5550108888")

    # Prime the cache so the patient is no longer stale.
    primed = test_client.get(f"/patients/{patient['id']}/summary", headers=headers)
    assert primed.status_code == 200
    assert repo.patients[patient["id"]]["ai_summary_stale"] is False

    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Cough",
            "diagnosis": "Bronchitis",
            "medications": "Rest",
            "notes": "Review in a week.",
        },
        headers=headers,
    )
    assert generated.status_code == 200
    note_id = generated.json()["note_id"]

    finalized = test_client.post(
        "/notes/finalize",
        json={"note_id": note_id},
        headers=headers,
    )
    assert finalized.status_code == 200
    # Finalizing new clinical info should invalidate the cached summary.
    assert repo.patients[patient["id"]]["ai_summary_stale"] is True


def test_regenerate_summary_endpoint(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="summary-regen@clinic.com", clinic_name="Regen Clinic"
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, phone="5550109999")

    response = test_client.post(
        f"/patients/{patient['id']}/summary/regenerate", headers=headers
    )
    assert response.status_code == 200
    assert response.json()["summary"]
    assert repo.patients[patient["id"]]["ai_summary_stale"] is False
