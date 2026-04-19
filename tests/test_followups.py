from __future__ import annotations

from test_app import auth_headers, client, register


def test_follow_up_can_be_created_listed_and_added_to_timeline(client):
    test_client, _repo = client
    session = register(test_client, identifier="followup@clinic.com", clinic_name="Follow Up Clinic")

    patient = test_client.post(
        "/patients",
        json={
            "name": "Follow Up Patient",
            "phone": "5550106060",
            "reason": "Review",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.5,
        },
        headers=auth_headers(session["token"]),
    ).json()

    create_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": "2026-04-10T10:30:00+00:00",
            "notes": "Review symptoms and blood pressure",
        },
        headers=auth_headers(session["token"]),
    )
    assert create_follow_up.status_code == 201
    follow_up = create_follow_up.json()
    assert follow_up["status"] == "scheduled"
    assert follow_up["notes"] == "Review symptoms and blood pressure"

    list_follow_ups = test_client.get(
        "/follow-ups",
        headers=auth_headers(session["token"]),
    )
    assert list_follow_ups.status_code == 200
    assert len(list_follow_ups.json()) == 1

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers(session["token"]),
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert "follow_up_scheduled" in event_types


def test_follow_up_can_be_rescheduled_completed_and_cancelled(client):
    test_client, _repo = client
    session = register(test_client, identifier="followup-manage@clinic.com", clinic_name="Follow Up Manage Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Follow Up Patient",
            "phone": "5550109090",
            "reason": "Review",
            "age": 33,
            "weight": 70,
            "height": 170,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": "2026-04-15T09:00:00+00:00",
            "notes": "Initial review",
        },
        headers=headers,
    ).json()

    rescheduled = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={
            "scheduled_for": "2026-04-16T10:15:00+00:00",
            "notes": "Updated review",
        },
        headers=headers,
    )
    assert rescheduled.status_code == 200
    assert rescheduled.json()["notes"] == "Updated review"

    completed = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={"status": "completed"},
        headers=headers,
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None

    cancelled = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={"status": "cancelled"},
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_patient_timeline_includes_follow_up_completion_event(client):
    test_client, _repo = client
    session = register(test_client, identifier="followup-timeline@clinic.com", clinic_name="Follow Up Timeline Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Follow Up Timeline Patient",
            "phone": "5550109191",
            "reason": "Review",
            "age": 34,
            "weight": 68,
            "height": 171,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": "2026-04-18T09:30:00+00:00",
            "notes": "Review progress",
        },
        headers=headers,
    ).json()

    complete_follow_up = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={"status": "completed"},
        headers=headers,
    )
    assert complete_follow_up.status_code == 200

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=headers,
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert "follow_up_scheduled" in event_types
    assert "follow_up_completed" in event_types
