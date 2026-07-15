from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from test_app import auth_headers_for_token, client, register_test_clinic
from app.services import patient_summary_workflow


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


def test_patient_summary_get_is_read_only_and_regenerate_caches(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="summary@clinic.com", clinic_name="Summary Clinic"
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, phone="5550107777")

    cached = test_client.get(f"/patients/{patient['id']}/summary", headers=headers)
    assert cached.status_code == 200
    assert cached.json()["summary"] == ""
    assert cached.json()["stale"] is True

    response = test_client.post(
        f"/patients/{patient['id']}/summary/regenerate", headers=headers
    )
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
    primed = test_client.post(
        f"/patients/{patient['id']}/summary/regenerate", headers=headers
    )
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


def test_summary_generation_does_not_overwrite_a_newer_patient_revision(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="summary-race@clinic.com", clinic_name="Race Clinic"
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, phone="5550101212")

    async def generate_while_record_changes(*_args, **_kwargs):
        await repo.mark_patient_summary_stale(session["user"]["org_id"], patient["id"])
        return {"content": "Outdated generated summary", "used_fallback": False}

    monkeypatch.setattr(
        patient_summary_workflow,
        "generate_patient_summary",
        generate_while_record_changes,
    )

    response = test_client.post(
        f"/patients/{patient['id']}/summary/regenerate",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["stale"] is True
    assert response.json()["summary"] == ""
    assert (repo.patients[patient["id"]]["ai_summary"] or "") == ""


def test_summary_source_uses_only_latest_two_visits_and_linked_final_notes():
    now = datetime.now(UTC)
    visits = [
        {"id": f"visit-{index}", "created_at": now - timedelta(days=index), "reason": f"reason {index}", "visit_kind": "new"}
        for index in range(3)
    ]
    notes = [
        {
            "id": "draft-newest",
            "visit_id": "visit-0",
            "status": "draft",
            "content": "draft must not appear",
            "created_at": now,
        },
        {
            "id": "final-newest",
            "visit_id": "visit-0",
            "status": "final",
            "snapshot_content": "Newest finalized clinical detail.",
            "created_at": now - timedelta(minutes=1),
            "finalized_at": now,
        },
        {
            "id": "sent-second",
            "visit_id": "visit-1",
            "status": "sent",
            "snapshot_content": "Second visit clinical detail.",
            "created_at": now - timedelta(days=1),
        },
        {
            "id": "final-old",
            "visit_id": "visit-2",
            "status": "final",
            "snapshot_content": "Old detail must not appear.",
            "created_at": now - timedelta(days=2),
        },
    ]

    source = patient_summary_workflow.build_patient_summary_source(
        {"date_of_birth": date(1990, 1, 1), "sex_at_birth": "female"},
        visits,
        notes,
    )

    assert [visit["visit_id"] for visit in source["context"]["recent_visits"]] == ["visit-0", "visit-1"]
    serialized = str(source["context"])
    assert "Newest finalized clinical detail" in serialized
    assert "Second visit clinical detail" in serialized
    assert "draft must not appear" not in serialized
    assert "Old detail must not appear" not in serialized


def test_summary_source_hash_ignores_changes_outside_rolling_window():
    now = datetime.now(UTC)
    patient = {"age": 40, "sex_at_birth": "male"}
    visits = [
        {"id": f"visit-{index}", "created_at": now - timedelta(days=index), "reason": f"reason {index}"}
        for index in range(3)
    ]
    first = patient_summary_workflow.build_patient_summary_source(patient, visits, [])
    visits[2]["reason"] = "changed old reason"
    second = patient_summary_workflow.build_patient_summary_source(patient, visits, [])
    assert first["source_hash"] == second["source_hash"]
