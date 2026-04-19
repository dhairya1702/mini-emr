from __future__ import annotations

from test_app import auth_headers, client, register


def test_appointment_can_be_created_listed_and_checked_into_queue(client):
    test_client, _repo = client
    session = register(test_client, identifier="appointments@clinic.com", clinic_name="Appointments Clinic")
    headers = auth_headers(session["token"])

    create_appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550107070",
            "reason": "Vision review",
            "scheduled_for": "2026-04-12T09:15:00+00:00",
        },
        headers=headers,
    )
    assert create_appointment.status_code == 201
    appointment = create_appointment.json()
    assert appointment["status"] == "scheduled"

    list_appointments = test_client.get("/appointments", headers=headers)
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

    updated_appointments = test_client.get("/appointments", headers=headers)
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["status"] == "checked_in"

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    assert patients.json()[0]["name"] == "Booked Patient"

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
    session = register(test_client, identifier="appointments-preview@clinic.com", clinic_name="Appointments Preview Clinic")
    headers = auth_headers(session["token"])

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
            "scheduled_for": "2026-04-12T11:30:00+00:00",
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
    session = register(test_client, identifier="appointments-duplicate-choice@clinic.com", clinic_name="Appointments Duplicate Choice Clinic")
    headers = auth_headers(session["token"])

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
            "scheduled_for": "2026-04-18T11:30:00+00:00",
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

    updated_appointments = test_client.get("/appointments", headers=headers)
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["status"] == "scheduled"
    assert updated_appointments.json()[0]["checked_in_patient_id"] is None

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    assert len(patients.json()) == 1


def test_appointment_check_in_can_link_existing_active_patient(client):
    test_client, _repo = client
    session = register(test_client, identifier="appointments-link@clinic.com", clinic_name="Appointments Link Clinic")
    headers = auth_headers(session["token"])

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
            "scheduled_for": "2026-04-12T12:00:00+00:00",
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
    assert len(patients.json()) == 1

    updated_appointments = test_client.get("/appointments", headers=headers)
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["checked_in_patient_id"] == patient["id"]


def test_appointment_check_in_can_force_new_patient_with_existing_phone(client):
    test_client, _repo = client
    session = register(test_client, identifier="appointments-force-new@clinic.com", clinic_name="Appointments Force New Clinic")
    headers = auth_headers(session["token"])

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
            "scheduled_for": "2026-04-18T09:30:00+00:00",
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
    matches = [patient for patient in patients.json() if patient["phone"] == "5550121212"]
    assert len(matches) == 2
    assert {patient["name"] for patient in matches} == {"Parent Patient", "Child Patient"}


def test_patient_lookup_returns_family_cluster_after_reusing_and_adding_under_same_phone(client):
    test_client, _repo = client
    session = register(test_client, identifier="patients-family@clinic.com", clinic_name="Patients Family Clinic")
    headers = auth_headers(session["token"])

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
            "scheduled_for": "2026-04-18T10:30:00+00:00",
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
    session = register(test_client, identifier="appointments-manage@clinic.com", clinic_name="Appointments Manage Clinic")
    headers = auth_headers(session["token"])

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550108080",
            "reason": "Review",
            "scheduled_for": "2026-04-12T09:15:00+00:00",
        },
        headers=headers,
    ).json()

    rescheduled = test_client.patch(
        f"/appointments/{appointment['id']}",
        json={"scheduled_for": "2026-04-12T11:45:00+00:00"},
        headers=headers,
    )
    assert rescheduled.status_code == 200
    assert rescheduled.json()["scheduled_for"].startswith("2026-04-12T11:45:00")

    cancelled = test_client.patch(
        f"/appointments/{appointment['id']}",
        json={"status": "cancelled"},
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
