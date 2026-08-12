from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from test_app import auth_headers_for_token, client, register_test_clinic

from app.schema_domains.patients import AppointmentCreate
from app.routes.public import _public_client_ip
from app.services import public_appointment_workflow


def _future_iso(*, days: int = 1, hour: int = 9, minute: int = 0) -> str:
    scheduled_for = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(days=days)
    scheduled_for = scheduled_for.replace(hour=hour, minute=minute)
    return scheduled_for.isoformat()


def test_public_booking_client_ip_uses_verified_load_balancer_position():
    request = SimpleNamespace(
        headers={
            "x-forwarded-for": (
                "caller-supplied-value, 203.0.113.17, 198.51.100.8"
            )
        },
        client=SimpleNamespace(host="10.0.0.4"),
    )
    direct_request = SimpleNamespace(
        headers={"x-forwarded-for": "caller-controlled-value"},
        client=SimpleNamespace(host="203.0.113.18"),
    )

    assert _public_client_ip(request) == "203.0.113.17"
    assert _public_client_ip(direct_request) == "203.0.113.18"


def test_public_booking_generates_management_token_before_writing_appointment(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="public-token-first@clinic.com",
        clinic_name="Token First Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    enabled = test_client.patch("/check-in/config", headers=headers, json={"enabled": True})
    public_token = enabled.json()["public_url"].split("token=", 1)[1]
    slots = test_client.get(
        "/public/check-in/appointment-slots",
        params={"token": public_token},
    ).json()["suggested_slots"]
    appointment_count_before = len(repo.appointments)

    def fail_token_creation(**_kwargs):
        raise ValueError("token configuration failed")

    monkeypatch.setattr(
        public_appointment_workflow,
        "create_public_appointment_booking_token",
        fail_token_creation,
    )

    with pytest.raises(ValueError, match="token configuration failed"):
        asyncio.run(
            public_appointment_workflow.create_public_appointment(
                repo,
                clinic_token=public_token,
                payload=AppointmentCreate(
                    name="Token Test Patient",
                    phone="5550107001",
                    reason="Review",
                    scheduled_for=datetime.fromisoformat(slots[0]),
                ),
            )
        )

    assert len(repo.appointments) == appointment_count_before


def test_public_booking_rejects_a_second_active_appointment_for_same_phone(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="public-duplicate@clinic.com",
        clinic_name="Public Duplicate Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    enabled = test_client.patch("/check-in/config", headers=headers, json={"enabled": True})
    public_token = enabled.json()["public_url"].split("token=", 1)[1]
    slots = test_client.get(
        "/public/check-in/appointment-slots",
        params={"token": public_token},
    ).json()["suggested_slots"]
    assert len(slots) >= 2

    payload = {
        "token": public_token,
        "name": "Duplicate Patient",
        "phone": "(555) 010-7002",
        "reason": "Review",
        "date_of_birth": "1990-01-01",
        "sex_at_birth": "other",
        "scheduled_for": slots[0],
    }
    first = test_client.post("/public/check-in/appointment", json=payload)
    duplicate = test_client.post(
        "/public/check-in/appointment",
        json={**payload, "phone": "5550107002", "scheduled_for": slots[1]},
    )

    assert first.status_code == 201
    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == (
        "An active appointment already exists for this phone number."
    )


@pytest.mark.parametrize(
    ("limited_scope", "expected_limit"),
    [
        ("public_appointment_post_ip", 2),
        ("public_appointment_post_clinic", 2),
    ],
)
def test_public_booking_enforces_stable_abuse_limits(
    client,
    monkeypatch: pytest.MonkeyPatch,
    limited_scope: str,
    expected_limit: int,
):
    from app.services import auth_flow

    test_client, _repo = client
    monkeypatch.setitem(auth_flow.RATE_LIMIT_WINDOWS, "public_appointment_post_ip", (100, 300.0))
    monkeypatch.setitem(auth_flow.RATE_LIMIT_WINDOWS, "public_appointment_post_clinic", (100, 300.0))
    monkeypatch.setitem(auth_flow.RATE_LIMIT_WINDOWS, limited_scope, (expected_limit, 300.0))
    session = register_test_clinic(
        test_client,
        identifier=f"{limited_scope}@clinic.com",
        clinic_name="Stable Limit Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    enabled = test_client.patch("/check-in/config", headers=headers, json={"enabled": True})
    public_token = enabled.json()["public_url"].split("token=", 1)[1]
    slot = test_client.get(
        "/public/check-in/appointment-slots",
        params={"token": public_token},
    ).json()["suggested_slots"][0]

    statuses = []
    for index in range(expected_limit + 1):
        response = test_client.post(
            "/public/check-in/appointment",
            json={
                "token": public_token,
                "name": f"Rate Limit Patient {index}",
                    "phone": f"55501071{index:02d}",
                    "reason": "Review",
                    "date_of_birth": "1990-01-01",
                    "sex_at_birth": "other",
                    "scheduled_for": slot,
            },
        )
        statuses.append(response.status_code)

    assert statuses[:expected_limit] == [201, 400]
    assert statuses[-1] == 429
    assert response.json()["detail"] == "Too many requests. Please wait and try again."


def test_appointment_can_be_created_listed_and_checked_into_queue(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments@clinic.com", clinic_name="Appointments Clinic")
    headers = auth_headers_for_token(session["token"])

    create_appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550107070",
            "reason": "Vision review",
            "scheduled_for": _future_iso(days=1, hour=9, minute=15),
        },
        headers=headers,
    )
    assert create_appointment.status_code == 201
    appointment = create_appointment.json()
    assert appointment["status"] == "scheduled"

    list_appointments = test_client.get(
        f"/appointments?scheduled_date={datetime.fromisoformat(appointment['scheduled_for']).date().isoformat()}",
        headers=headers,
    )
    assert list_appointments.status_code == 200
    assert len(list_appointments.json()) == 1

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        headers=headers,
    )
    assert check_in.status_code == 200
    patient = check_in.json()
    assert patient["status"] == "waiting"
    assert patient["name"] == "Booked Patient"

    updated_appointments = test_client.get(
        f"/appointments?scheduled_date={datetime.fromisoformat(appointment['scheduled_for']).date().isoformat()}",
        headers=headers,
    )
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["status"] == "checked_in"

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    assert patients.json()["items"][0]["name"] == "Booked Patient"

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=headers,
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert "visit_recorded" in event_types
    assert "appointment_booked" in event_types
    assert "appointment_checked_in" in event_types


def test_appointment_check_in_preview_returns_active_phone_matches(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments-preview@clinic.com", clinic_name="Appointments Preview Clinic")
    headers = auth_headers_for_token(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Existing Queue Patient",
            "phone": "5550109090",
            "reason": "Already waiting",
            "age": 33,
            "weight": 72,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550109090",
            "reason": "Repeat visit",
            "scheduled_for": _future_iso(days=1, hour=11, minute=30),
        },
        headers=headers,
    ).json()

    preview = test_client.get(
        f"/appointments/{appointment['id']}/check-in-preview",
        headers=headers,
    )
    assert preview.status_code == 200
    matches = preview.json()
    assert len(matches) == 1
    assert matches[0]["id"] == patient["id"]


def test_appointment_check_in_requires_explicit_choice_when_phone_has_active_matches(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments-duplicate-choice@clinic.com", clinic_name="Appointments Duplicate Choice Clinic")
    headers = auth_headers_for_token(session["token"])

    existing = test_client.post(
        "/patients",
        json={
            "name": "Existing Queue Patient",
            "phone": "5550191919",
            "reason": "Already waiting",
            "age": 36,
            "weight": 70,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550191919",
            "reason": "Repeat visit",
            "scheduled_for": _future_iso(days=2, hour=11, minute=30),
        },
        headers=headers,
    ).json()

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        headers=headers,
    )
    assert check_in.status_code == 409
    detail = check_in.json()["detail"]
    assert detail["message"] == "Possible duplicate active patients found."
    assert len(detail["matches"]) == 1
    assert detail["matches"][0]["id"] == existing["id"]

    updated_appointments = test_client.get(
        f"/appointments?scheduled_date={datetime.fromisoformat(appointment['scheduled_for']).date().isoformat()}",
        headers=headers,
    )
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["status"] == "scheduled"
    assert updated_appointments.json()[0]["checked_in_patient_id"] is None

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    assert len(patients.json()["items"]) == 1


def test_appointment_check_in_can_link_existing_active_patient(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments-link@clinic.com", clinic_name="Appointments Link Clinic")
    headers = auth_headers_for_token(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Existing Queue Patient",
            "phone": "5550109999",
            "reason": "Already waiting",
            "age": 29,
            "weight": 65,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550109999",
            "reason": "Same visit duplicate",
            "scheduled_for": _future_iso(days=1, hour=12, minute=0),
        },
        headers=headers,
    ).json()

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        json={"existing_patient_id": patient["id"]},
        headers=headers,
    )
    assert check_in.status_code == 200
    assert check_in.json()["id"] == patient["id"]

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    assert len(patients.json()["items"]) == 1

    updated_appointments = test_client.get(
        f"/appointments?scheduled_date={datetime.fromisoformat(appointment['scheduled_for']).date().isoformat()}",
        headers=headers,
    )
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["checked_in_patient_id"] == patient["id"]


def test_appointment_check_in_can_force_new_patient_with_existing_phone(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments-force-new@clinic.com", clinic_name="Appointments Force New Clinic")
    headers = auth_headers_for_token(session["token"])

    existing = test_client.post(
        "/patients",
        json={
            "name": "Parent Patient",
            "phone": "5550121212",
            "reason": "Already waiting",
            "age": 39,
            "weight": 69,
            "temperature": 98.5,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Child Patient",
            "phone": "5550121212",
            "reason": "New consult",
            "age": 11,
            "weight": 34,
            "temperature": 98.7,
            "scheduled_for": _future_iso(days=2, hour=9, minute=30),
        },
        headers=headers,
    ).json()

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        json={"force_new": True},
        headers=headers,
    )
    assert check_in.status_code == 200
    created = check_in.json()
    assert created["id"] != existing["id"]
    assert created["name"] == "Child Patient"
    assert created["phone"] == existing["phone"]

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    matches = [patient for patient in patients.json()["items"] if patient["phone"] == "5550121212"]
    assert len(matches) == 2
    assert {patient["name"] for patient in matches} == {"Parent Patient", "Child Patient"}


def test_patient_lookup_returns_family_cluster_after_reusing_and_adding_under_same_phone(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="patients-family@clinic.com", clinic_name="Patients Family Clinic")
    headers = auth_headers_for_token(session["token"])

    parent = test_client.post(
        "/patients",
        json={
            "name": "Parent Patient",
            "phone": "5550131313",
            "reason": "Consultation",
            "age": 42,
            "weight": 71,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    sibling = test_client.post(
        "/patients",
        json={
            "name": "Sibling Patient",
            "phone": "5550131313",
            "reason": "Review",
            "age": 14,
            "weight": 41,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Youngest Patient",
            "phone": "5550131313",
            "reason": "Fresh visit",
            "age": 8,
            "weight": 28,
            "temperature": 99.0,
            "scheduled_for": _future_iso(days=2, hour=10, minute=30),
        },
        headers=headers,
    ).json()

    preview = test_client.get(
        f"/appointments/{appointment['id']}/check-in-preview",
        headers=headers,
    )
    assert preview.status_code == 200
    preview_ids = {match["id"] for match in preview.json()}
    assert preview_ids == {parent["id"], sibling["id"]}

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        json={"force_new": True},
        headers=headers,
    )
    assert check_in.status_code == 200

    lookup = test_client.get(
        "/patients/lookup",
        params={"phone": "5550131313"},
        headers=headers,
    )
    assert lookup.status_code == 200
    matches = lookup.json()
    assert len(matches) == 3
    assert {match["name"] for match in matches} == {
        "Parent Patient",
        "Sibling Patient",
        "Youngest Patient",
    }


def test_appointment_can_be_rescheduled_and_cancelled(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments-manage@clinic.com", clinic_name="Appointments Manage Clinic")
    headers = auth_headers_for_token(session["token"])

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550108080",
            "reason": "Review",
            "scheduled_for": _future_iso(days=1, hour=9, minute=15),
        },
        headers=headers,
    ).json()

    rescheduled_for = _future_iso(days=1, hour=11, minute=45)
    rescheduled = test_client.patch(
        f"/appointments/{appointment['id']}",
        json={"scheduled_for": rescheduled_for},
        headers=headers,
    )
    assert rescheduled.status_code == 200
    assert rescheduled.json()["scheduled_for"].startswith(rescheduled_for[:19])

    cancelled = test_client.patch(
        f"/appointments/{appointment['id']}",
        json={"status": "cancelled"},
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_appointment_listing_uses_clinic_local_date_boundaries(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="appointments-timezone@clinic.com", clinic_name="Appointments Timezone Clinic")
    headers = auth_headers_for_token(session["token"])

    settings_response = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Appointments Timezone Clinic",
            "timezone": "America/Los_Angeles",
            "appointment_start_time": "09:00",
            "appointment_end_time": "18:00",
            "appointments_per_hour": 4,
        },
    )
    assert settings_response.status_code == 200

    scheduled_for = (datetime.now(UTC) + timedelta(days=2)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    create_appointment = test_client.post(
        "/appointments",
        json={
            "name": "Midnight Boundary Patient",
            "phone": "5550111111",
            "reason": "Boundary review",
            "scheduled_for": scheduled_for.isoformat(),
        },
        headers=headers,
    )
    assert create_appointment.status_code == 201

    list_appointments = test_client.get(
        f"/appointments?scheduled_date={(scheduled_for - timedelta(hours=7)).date().isoformat()}",
        headers=headers,
    )
    assert list_appointments.status_code == 200
    assert len(list_appointments.json()) == 1
    assert list_appointments.json()[0]["name"] == "Midnight Boundary Patient"

    upcoming_appointments = test_client.get(
        "/appointments?upcoming=true",
        headers=headers,
    )
    assert upcoming_appointments.status_code == 200
    assert len(upcoming_appointments.json()) == 1
    assert upcoming_appointments.json()[0]["name"] == "Midnight Boundary Patient"
