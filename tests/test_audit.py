from __future__ import annotations

from test_app import auth_headers, client, register


def test_audit_events_list_tracks_core_changes(client):
    test_client, _repo = client
    session = register(test_client, identifier="audit@clinic.com", clinic_name="Audit Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Audit Patient",
            "phone": "5550107777",
            "reason": "Review",
            "age": 30,
            "weight": 64,
            "height": 170,
            "temperature": 98.9,
        },
        headers=headers,
    ).json()

    update_patient = test_client.patch(
        f"/patients/{patient['id']}",
        json={"reason": "Updated review"},
        headers=headers,
    )
    assert update_patient.status_code == 200

    create_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={"scheduled_for": "2026-04-10T10:30:00+00:00", "notes": "Audit trail check"},
        headers=headers,
    )
    assert create_follow_up.status_code == 201

    audit_events = test_client.get("/audit-events", headers=headers)
    assert audit_events.status_code == 200
    actions = [event["action"] for event in audit_events.json()]
    assert "patient_created" in actions
    assert "patient_updated" in actions
    assert "patient_visit_recorded" not in actions
    assert "follow_up_created" in actions
