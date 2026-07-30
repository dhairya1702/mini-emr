from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from test_app import auth_headers_for_token, client, register_test_clinic
from app.services.followup_workflow import _follow_up_email_parts


def _future_iso(*, days: int = 1, hour: int = 9, minute: int = 0) -> str:
    scheduled_for = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(days=days)
    scheduled_for = scheduled_for.replace(hour=hour, minute=minute)
    return scheduled_for.isoformat()


def test_follow_up_email_uses_approved_minimal_copy_and_schedule_button():
    subject, text_content, html_content = _follow_up_email_parts(
        clinic_name="Fika Eye Care",
        doctor_name="Dhairya Lalwani",
        patient_name="DH",
        booking_link="https://clinic.example/follow-up?token=abc123",
    )

    assert subject == "Schedule your follow-up with Dr. Dhairya Lalwani"
    assert "Dr. Dhairya Lalwani would like to see you again for a follow-up and check on your progress." in text_content
    assert "Please choose a convenient time slot using the link below." in text_content
    assert text_content.endswith("Thank you,\nFika Eye Care\n")
    assert "https://clinic.example/follow-up?token=abc123" in text_content
    assert ">Schedule</a>" in html_content
    assert 'href="https://clinic.example/follow-up?token=abc123"' in html_content
    assert "Booking hours" not in html_content
    assert "Notes:" not in html_content
    assert "If the button does not work" not in html_content
    assert "automated message" not in html_content
    assert "Thank you,<br><strong>Fika Eye Care</strong>" in html_content


def test_follow_up_email_escapes_patient_controlled_html():
    _subject, _text_content, html_content = _follow_up_email_parts(
        clinic_name="Clinic <One>",
        doctor_name="Doctor <Two>",
        patient_name="<script>alert(1)</script>",
        booking_link="https://clinic.example/follow-up?token=a&next=b",
    )

    assert "<script>" not in html_content
    assert "Clinic &lt;One&gt;" in html_content
    assert "Doctor &lt;Two&gt;" in html_content
    assert "token=a&amp;next=b" in html_content


def test_follow_up_can_be_created_listed_and_added_to_timeline(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="followup@clinic.com", clinic_name="Follow Up Clinic")

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
        headers=auth_headers_for_token(session["token"]),
    ).json()

    create_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": _future_iso(days=1, hour=10, minute=30),
            "notes": "Review symptoms and blood pressure",
        },
        headers=auth_headers_for_token(session["token"]),
    )
    assert create_follow_up.status_code == 201
    follow_up = create_follow_up.json()
    assert follow_up["status"] == "scheduled"
    assert follow_up["notes"] == "Review symptoms and blood pressure"

    list_follow_ups = test_client.get(
        f"/follow-ups?scheduled_date={datetime.fromisoformat(follow_up['scheduled_for']).date().isoformat()}",
        headers=auth_headers_for_token(session["token"]),
    )
    assert list_follow_ups.status_code == 200
    assert len(list_follow_ups.json()) == 1

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers_for_token(session["token"]),
    )
    assert timeline.status_code == 200
    timeline_events = timeline.json()
    event_types = [event["type"] for event in timeline_events]
    assert "follow_up_scheduled" in event_types
    scheduled = next(event for event in timeline_events if event["type"] == "follow_up_scheduled")
    assert scheduled["details"]["notes"] == "Review symptoms and blood pressure"


def test_follow_up_can_be_rescheduled_completed_and_cancelled(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="followup-manage@clinic.com", clinic_name="Follow Up Manage Clinic")
    headers = auth_headers_for_token(session["token"])

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
            "scheduled_for": _future_iso(days=1, hour=9, minute=0),
            "notes": "Initial review",
        },
        headers=headers,
    ).json()

    rescheduled_for = _future_iso(days=2, hour=10, minute=15)
    rescheduled = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={
            "scheduled_for": rescheduled_for,
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
    session = register_test_clinic(test_client, identifier="followup-timeline@clinic.com", clinic_name="Follow Up Timeline Clinic")
    headers = auth_headers_for_token(session["token"])

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
            "scheduled_for": _future_iso(days=2, hour=9, minute=30),
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


def test_internal_follow_up_reminder_runner_requires_valid_token(client, monkeypatch):
    test_client, _repo = client
    register_test_clinic(test_client, identifier="scheduler-auth@clinic.com", clinic_name="Scheduler Auth Clinic")
    monkeypatch.setattr(
        "app.routes.followups.get_settings",
        lambda: SimpleNamespace(internal_scheduler_token="scheduler-secret"),
    )

    missing = test_client.post("/internal/run-follow-up-reminders")
    assert missing.status_code == 403

    invalid = test_client.post(
        "/internal/run-follow-up-reminders",
        headers={"X-Internal-Token": "wrong-secret"},
    )
    assert invalid.status_code == 403


def test_internal_follow_up_reminder_runner_processes_orgs(client, monkeypatch):
    test_client, _repo = client
    register_test_clinic(test_client, identifier="scheduler-run@clinic.com", clinic_name="Scheduler Run Clinic")
    monkeypatch.setattr(
        "app.routes.followups.get_settings",
        lambda: SimpleNamespace(internal_scheduler_token="scheduler-secret"),
    )

    response = test_client.post(
        "/internal/run-follow-up-reminders",
        headers={"X-Internal-Token": "scheduler-secret"},
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["processed_orgs"] == 1


def test_due_follow_up_claim_cannot_be_claimed_twice(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="reminder-claim@clinic.com", clinic_name="Reminder Claim Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = test_client.post(
        "/patients",
        json={"name": "Reminder Patient", "phone": "5550199999", "reason": "Review"},
        headers=headers,
    ).json()
    created = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={"scheduled_for": _future_iso(days=2), "notes": "Claim once"},
        headers=headers,
    )
    assert created.status_code == 201
    org_id = session["user"]["org_id"]
    start = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    end = (datetime.now(UTC) + timedelta(days=3)).isoformat()

    first = asyncio.run(repo.claim_due_follow_ups(org_id, start, end))
    second = asyncio.run(repo.claim_due_follow_ups(org_id, start, end))

    assert len(first) == 1
    assert second == []


def test_internal_follow_up_reminder_runner_reports_missing_config(client, monkeypatch):
    test_client, _repo = client
    register_test_clinic(test_client, identifier="scheduler-missing@clinic.com", clinic_name="Scheduler Missing Clinic")
    monkeypatch.setattr(
        "app.routes.followups.get_settings",
        lambda: SimpleNamespace(internal_scheduler_token=""),
    )

    response = test_client.post(
        "/internal/run-follow-up-reminders",
        headers={"X-Internal-Token": "scheduler-secret"},
    )

    assert response.status_code == 503
    assert "INTERNAL_SCHEDULER_TOKEN" in response.json()["detail"]


def test_follow_up_listing_uses_clinic_local_date_boundaries(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="followup-timezone@clinic.com", clinic_name="Follow Up Timezone Clinic")
    headers = auth_headers_for_token(session["token"])

    settings_response = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Follow Up Timezone Clinic",
            "clinic_specialty": "general_physician",
            "timezone": "Asia/Kolkata",
            "appointment_start_time": "09:00",
            "appointment_end_time": "18:00",
            "appointments_per_hour": 4,
        },
    )
    assert settings_response.status_code == 200

    patient = test_client.post(
        "/patients",
        json={
            "name": "Boundary Follow Up Patient",
            "phone": "5550111212",
            "reason": "Review",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.5,
        },
        headers=headers,
    ).json()

    scheduled_for = (datetime.now(UTC) + timedelta(days=2)).replace(
        hour=19,
        minute=0,
        second=0,
        microsecond=0,
    )
    create_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": scheduled_for.isoformat(),
            "notes": "Midnight boundary review",
        },
        headers=headers,
    )
    assert create_follow_up.status_code == 201

    list_follow_ups = test_client.get(
        f"/follow-ups?scheduled_date={(scheduled_for + timedelta(hours=5, minutes=30)).date().isoformat()}",
        headers=headers,
    )
    assert list_follow_ups.status_code == 200
    assert len(list_follow_ups.json()) == 1
    assert list_follow_ups.json()[0]["notes"] == "Midnight boundary review"

    upcoming_follow_ups = test_client.get(
        "/follow-ups?upcoming=true",
        headers=headers,
    )
    assert upcoming_follow_ups.status_code == 200
    assert len(upcoming_follow_ups.json()) == 1
    assert upcoming_follow_ups.json()[0]["notes"] == "Midnight boundary review"
