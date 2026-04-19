from __future__ import annotations

import asyncio
from types import SimpleNamespace

from test_app import auth_headers, client, register


def test_patient_timeline_includes_notes_and_billing_events(client):
    test_client, repo = client
    session = register(test_client, identifier="timeline@clinic.com", clinic_name="Timeline Clinic")

    patient = test_client.post(
        "/patients",
        json={
            "name": "Timeline Patient",
            "phone": "5550104040",
            "reason": "Follow up",
            "age": 35,
            "weight": 68,
            "height": 169,
            "temperature": 98.7,
        },
        headers=auth_headers(session["token"]),
    ).json()

    awaitable_note = repo.create_note(
        session["user"]["org_id"],
        SimpleNamespace(patient_id=patient["id"], content="Diagnosis: Viral fever\nTreatment: Rest and fluids"),
    )
    asyncio.run(awaitable_note)

    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [
                {
                    "item_type": "service",
                    "label": "Consultation",
                    "quantity": 1,
                    "unit_price": 500,
                }
            ],
        },
        headers=auth_headers(session["token"]),
    ).json()

    test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient": patient["phone"]},
        headers=auth_headers(session["token"]),
    )

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers(session["token"]),
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert "patient_created" in event_types
    assert "visit_recorded" in event_types
    assert "consultation_note" in event_types
    assert "invoice_created" in event_types
    assert "bill_sent" in event_types


def test_existing_patient_can_record_a_new_visit_and_refresh_latest_snapshot(client):
    test_client, _repo = client
    session = register(test_client, identifier="patient-visits@clinic.com", clinic_name="Patient Visits Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Returning Patient",
            "phone": "5550105050",
            "reason": "Initial visit",
            "age": 32,
            "weight": 66,
            "height": 168,
            "temperature": 98.5,
        },
        headers=headers,
    ).json()

    revisit = test_client.post(
        f"/patients/{patient['id']}/visits",
        json={
            "name": "Returning Patient",
            "phone": "5550105050",
            "reason": "Review visit",
            "age": 33,
            "weight": 67,
            "height": 168,
            "temperature": 99.1,
        },
        headers=headers,
    )
    assert revisit.status_code == 200
    updated = revisit.json()
    assert updated["id"] == patient["id"]
    assert updated["reason"] == "Review visit"
    assert updated["age"] == 33
    assert updated["weight"] == 67
    assert updated["temperature"] == 99.1
    assert updated["last_visit_at"] >= patient["last_visit_at"]

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=headers,
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert event_types.count("visit_recorded") == 2

    audit_events = test_client.get("/audit-events", headers=headers)
    assert audit_events.status_code == 200
    actions = [event["action"] for event in audit_events.json()]
    assert "patient_visit_recorded" in actions


def test_patient_lookup_returns_multiple_matches_for_same_phone(client):
    test_client, _repo = client
    session = register(test_client, identifier="patients-lookup@clinic.com", clinic_name="Patient Lookup Clinic")
    headers = auth_headers(session["token"])

    first = test_client.post(
        "/patients",
        json={
            "name": "Parent Patient",
            "phone": "5550111111",
            "reason": "Consultation",
            "age": 41,
            "weight": 68,
            "temperature": 98.5,
        },
        headers=headers,
    )
    assert first.status_code == 201

    second = test_client.post(
        "/patients",
        json={
            "name": "Child Patient",
            "phone": "5550111111",
            "reason": "Follow-up",
            "age": 12,
            "weight": 35,
            "temperature": 98.4,
        },
        headers=headers,
    )
    assert second.status_code == 201

    lookup = test_client.get(
        "/patients/lookup",
        params={"phone": "5550111111"},
        headers=headers,
    )
    assert lookup.status_code == 200
    matches = lookup.json()
    assert len(matches) == 2
    assert {match["name"] for match in matches} == {"Parent Patient", "Child Patient"}


def test_patient_lookup_returns_most_recent_matches_first_and_honors_limit(client):
    test_client, _repo = client
    session = register(test_client, identifier="patients-lookup-limit@clinic.com", clinic_name="Patient Lookup Limit Clinic")
    headers = auth_headers(session["token"])

    for name in ["Oldest Patient", "Middle Patient", "Newest Patient"]:
        created = test_client.post(
            "/patients",
            json={
                "name": name,
                "phone": "5550141414",
                "reason": "Consultation",
                "age": 30,
                "weight": 65,
                "temperature": 98.6,
            },
            headers=headers,
        )
        assert created.status_code == 201

    lookup = test_client.get(
        "/patients/lookup",
        params={"phone": "5550141414", "limit": 2},
        headers=headers,
    )
    assert lookup.status_code == 200
    matches = lookup.json()
    assert [match["name"] for match in matches] == ["Newest Patient", "Middle Patient"]


def test_patient_phone_is_normalized_for_lookup_and_storage(client):
    test_client, _repo = client
    session = register(test_client, identifier="patients-normalize@clinic.com", clinic_name="Patient Normalize Clinic")
    headers = auth_headers(session["token"])

    created = test_client.post(
        "/patients",
        json={
            "name": "Formatted Patient",
            "phone": "(555) 012-3456",
            "reason": "Consultation",
            "age": 30,
            "weight": 70,
            "temperature": 98.6,
        },
        headers=headers,
    )
    assert created.status_code == 201
    assert created.json()["phone"] == "5550123456"

    lookup = test_client.get(
        "/patients/lookup",
        params={"phone": "555-012-3456"},
        headers=headers,
    )
    assert lookup.status_code == 200
    matches = lookup.json()
    assert len(matches) == 1
    assert matches[0]["phone"] == "5550123456"
