from __future__ import annotations

from datetime import UTC, datetime, timedelta

import asyncio
from types import SimpleNamespace

from test_app import auth_headers_for_token, client, register_test_clinic
from app.repositories.postgres.patient_flow import _estimate_from_note_and_catalog
from app.services import billing_workflow


def _create_queue_patient(test_client, headers, name: str, phone: str):
    response = test_client.post(
        "/patients",
        json={
            "name": name,
            "phone": phone,
            "reason": "Queue review",
            "age": 30,
            "temperature": 98.6,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.json()
    return response.json()


def test_queue_billing_estimate_uses_consultation_and_exact_extractions():
    estimate = _estimate_from_note_and_catalog(
        {
            "status": "final",
            "clinical_extractions": {},
            "snapshot_clinical_extractions": {
                "services_performed": [{"name": "Nebulization", "quantity": 2}],
                "medications_prescribed": [{"name": "Paracetamol", "strength": "500 mg", "quantity": "6 tablets"}],
            },
        },
        [
            {"id": "consult", "name": "Consultation", "item_type": "service", "default_price": 500, "aliases": []},
            {"id": "neb", "name": "Nebulization", "item_type": "service", "default_price": 150, "aliases": []},
            {"id": "med", "name": "Paracetamol 500 mg", "item_type": "medicine", "default_price": 5, "aliases": [], "track_inventory": True, "stock_quantity": 10},
        ],
    )

    assert estimate == {"total": 830.0, "item_count": 3, "medicine_count": 1}


def test_queue_priority_and_shared_order_are_authoritative(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="queue-order@clinic.com", clinic_name="Queue Order Clinic")
    headers = auth_headers_for_token(session["token"])
    first = _create_queue_patient(test_client, headers, "First Patient", "5550101001")
    second = _create_queue_patient(test_client, headers, "Second Patient", "5550101002")
    urgent = _create_queue_patient(test_client, headers, "Urgent Patient", "5550101003")

    priority = test_client.patch(
        f"/patients/{urgent['id']}",
        json={"queue_priority": "urgent"},
        headers=headers,
    )
    assert priority.status_code == 200
    assert priority.json()["queue_priority"] == "urgent"

    reordered = test_client.put(
        "/patients/queue/order",
        json={
            "columns": {
                "waiting": [urgent["id"], second["id"], first["id"]],
                "consultation": [],
                "done": [],
            }
        },
        headers=headers,
    )
    assert reordered.status_code == 200, reordered.json()
    assert [row["id"] for row in reordered.json()] == [urgent["id"], second["id"], first["id"]]
    assert [row["queue_position"] for row in reordered.json()] == [1, 2, 3]

    listed = test_client.get("/patients/queue", headers=headers)
    assert [row["id"] for row in listed.json()["patients"]] == [urgent["id"], second["id"], first["id"]]


def test_patient_list_filters_completed_unbilled_patients_for_billing(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="billing-patient-filter@clinic.com",
        clinic_name="Billing Patient Filter Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    billable = _create_queue_patient(test_client, headers, "Billable Patient", "5550101101")
    billed = _create_queue_patient(test_client, headers, "Billed Patient", "5550101102")
    waiting = _create_queue_patient(test_client, headers, "Waiting Patient", "5550101103")
    repo.patients[billable["id"]]["status"] = "done"
    repo.patients[billed["id"]]["status"] = "done"
    repo.patients[billed["id"]]["billed"] = True

    response = test_client.get(
        "/patients",
        params={"status": "done", "billed": "false", "limit": 50},
        headers=headers,
    )

    assert response.status_code == 200
    assert [row["id"] for row in response.json()["items"]] == [billable["id"]]
    assert waiting["id"] not in {row["id"] for row in response.json()["items"]}


def test_patient_directory_uses_stable_cursor_pagination_and_basic_rows(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="patient-pagination@clinic.com",
        clinic_name="Patient Pagination Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    created_ids = []
    for index in range(25):
        created_ids.append(
            _create_queue_patient(
                test_client,
                headers,
                f"Paged Patient {index:02d}",
                f"555019{index:04d}",
            )["id"]
        )

    first = test_client.get("/patients", params={"limit": 20}, headers=headers)
    assert first.status_code == 200
    first_page = first.json()
    assert len(first_page["items"]) == 20
    assert first_page["has_more"] is True
    assert first_page["next_cursor"]
    assert all(item["current_visit"] is None for item in first_page["items"])
    assert all(item["billing_summary"] is None for item in first_page["items"])

    second = test_client.get(
        "/patients",
        params={"limit": 20, "cursor": first_page["next_cursor"]},
        headers=headers,
    )
    assert second.status_code == 200
    second_page = second.json()
    assert len(second_page["items"]) == 5
    assert second_page["has_more"] is False
    assert second_page["next_cursor"] is None
    listed_ids = [item["id"] for item in first_page["items"] + second_page["items"]]
    assert len(listed_ids) == len(set(listed_ids)) == 25
    assert set(listed_ids) == set(created_ids)

    invalid = test_client.get("/patients", params={"cursor": "not-a-cursor"}, headers=headers)
    assert invalid.status_code == 400


def test_queue_reorder_moves_stages_and_rejects_duplicate_ids(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="queue-stage@clinic.com", clinic_name="Queue Stage Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _create_queue_patient(test_client, headers, "Stage Patient", "5550102001")
    original_stage_time = patient["stage_entered_at"]

    moved = test_client.put(
        "/patients/queue/order",
        json={
            "columns": {
                "waiting": [],
                "consultation": [patient["id"]],
                "done": [],
            }
        },
        headers=headers,
    )
    assert moved.status_code == 200, moved.json()
    assert moved.json()[0]["status"] == "consultation"
    assert moved.json()[0]["stage_entered_at"] >= original_stage_time

    duplicate = test_client.put(
        "/patients/queue/order",
        json={
            "columns": {
                "waiting": [patient["id"]],
                "consultation": [patient["id"]],
                "done": [],
            }
        },
        headers=headers,
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "A patient can appear only once in the queue order."


def test_queue_exposes_demographics_and_current_visit_context(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="queue-context@clinic.com", clinic_name="Context Clinic")
    headers = auth_headers_for_token(session["token"])
    created = test_client.post(
        "/patients",
        headers=headers,
        json={
            "name": "Context Patient",
            "phone": "5550103901",
            "reason": "Review",
            "age": 34,
            "sex_at_birth": "female",
            "gender_identity": "Woman",
        },
    )
    assert created.status_code == 201
    patient = created.json()
    assert patient["sex_at_birth"] == "female"
    assert patient["gender_identity"] == "Woman"
    assert patient["current_visit"]["kind"] == "new"
    assert patient["current_visit"]["source"] == "queue"

    queue_list = test_client.get("/patients/queue", headers=headers)
    assert queue_list.status_code == 200
    assert queue_list.json()["patients"][0]["current_visit"]["id"] == patient["current_visit"]["id"]

    lightweight_list = test_client.get("/patients", headers=headers)
    assert lightweight_list.status_code == 200
    lightweight_patient = lightweight_list.json()["items"][0]
    assert lightweight_patient["current_visit"] is None
    assert lightweight_patient["billing_summary"] is None
    assert lightweight_patient["billing_estimate"] is None

    returning_walk_in = test_client.post(
        f"/patients/{patient['id']}/visits",
        headers=headers,
        json={
            "name": "Context Patient",
            "phone": "5550103901",
            "reason": "Follow-up review",
            "age": 34,
            "sex_at_birth": "female",
            "gender_identity": "Woman",
        },
    )
    assert returning_walk_in.status_code == 200
    assert returning_walk_in.json()["current_visit"]["kind"] == "new"

    scheduled_for = (datetime.now(UTC) + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    appointment = test_client.post(
        "/appointments",
        headers=headers,
        json={
            "name": "Context Patient",
            "phone": "5550103901",
            "reason": "Scheduled review",
            "age": 34,
            "sex_at_birth": "female",
            "gender_identity": "Woman",
            "scheduled_for": scheduled_for.isoformat(),
        },
    ).json()
    checked_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        headers=headers,
        json={"existing_patient_id": patient["id"]},
    )
    assert checked_in.status_code == 200
    current_visit = checked_in.json()["current_visit"]
    assert current_visit["kind"] == "new"
    assert current_visit["source"] == "appointment"
    assert datetime.fromisoformat(current_visit["scheduled_for"].replace("Z", "+00:00")) == scheduled_for

    follow_up_time = (datetime.now(UTC) + timedelta(days=5)).replace(hour=10, minute=0, second=0, microsecond=0)
    follow_up = asyncio.run(repo.create_follow_up(
        session["user"]["org_id"],
        patient["id"],
        session["user"]["id"],
        SimpleNamespace(scheduled_for=follow_up_time, notes="Scheduled review"),
    ))
    _saved_follow_up, follow_up_appointment = asyncio.run(repo.self_book_follow_up_atomic(
        org_id=session["user"]["org_id"],
        patient_id=patient["id"],
        follow_up_id=follow_up["id"],
        scheduled_for=follow_up_time,
        appointments_per_hour=4,
        timezone="UTC",
    ))
    checked_in_follow_up = test_client.post(
        f"/appointments/{follow_up_appointment['id']}/check-in",
        headers=headers,
        json={"existing_patient_id": patient["id"]},
    )
    assert checked_in_follow_up.status_code == 200
    assert checked_in_follow_up.json()["current_visit"]["kind"] == "follow_up"


def test_billing_column_summary_is_scoped_to_current_visit(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="queue-billing@clinic.com", clinic_name="Billing Context Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _create_queue_patient(test_client, headers, "Billing Patient", "5550103902")
    invoice = test_client.post(
        "/invoices",
        headers=headers,
        json={
            "patient_id": patient["id"],
            "payment_status": "partial",
            "amount_paid": 200,
            "items": [
                {"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500},
                {"item_type": "medicine", "label": "Medicine", "quantity": 1, "unit_price": 100},
            ],
        },
    )
    assert invoice.status_code == 201
    listed = test_client.get("/patients/queue", headers=headers).json()["patients"]
    summary = next(row for row in listed if row["id"] == patient["id"])["billing_summary"]
    assert summary == {
        "invoice_id": invoice.json()["id"],
        "total": 600.0,
        "payment_status": "partial",
        "balance_due": 400.0,
        "item_count": 2,
        "medicine_count": 1,
        "completed_at": None,
        "sent_at": None,
    }

    lightweight = test_client.get("/patients", params={"limit": 100}, headers=headers).json()["items"]
    lightweight_patient = next(row for row in lightweight if row["id"] == patient["id"])
    assert lightweight_patient["current_visit"] is None
    assert lightweight_patient["billing_summary"] is None
    assert lightweight_patient["billing_estimate"] is None

    enriched_again = test_client.get("/patients/queue", headers=headers).json()["patients"]
    enriched_summary = next(row for row in enriched_again if row["id"] == patient["id"])["billing_summary"]
    assert enriched_summary == summary


def test_patient_timeline_includes_notes_and_billing_events(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="timeline@clinic.com", clinic_name="Timeline Clinic")

    async def fake_send_clinic_email_message(**_kwargs):
        return None

    monkeypatch.setattr(billing_workflow, "send_clinic_email_message", fake_send_clinic_email_message)

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
        headers=auth_headers_for_token(session["token"]),
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
        headers=auth_headers_for_token(session["token"]),
    ).json()

    test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient_email": "patient@example.com"},
        headers=auth_headers_for_token(session["token"]),
    )

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers_for_token(session["token"]),
    )
    assert timeline.status_code == 200
    timeline_events = timeline.json()
    event_types = [event["type"] for event in timeline_events]
    assert "patient_created" in event_types
    assert "visit_recorded" in event_types
    assert "consultation_note" in event_types
    assert "invoice_created" in event_types
    assert "bill_sent" in event_types
    invoice_created = next(event for event in timeline_events if event["type"] == "invoice_created")
    assert invoice_created["details"]["total"] == 500.0
    assert invoice_created["details"]["payment_status"] == "paid"
    consultation_note = next(event for event in timeline_events if event["type"] == "consultation_note")
    assert consultation_note["details"]["status"] == "draft"
    assert "Viral fever" in consultation_note["details"]["content"]


def test_existing_patient_can_record_a_new_visit_and_refresh_latest_snapshot(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="patient-visits@clinic.com", clinic_name="Patient Visits Clinic")
    headers = auth_headers_for_token(session["token"])

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
    timeline_events = timeline.json()
    event_types = [event["type"] for event in timeline_events]
    assert event_types.count("visit_recorded") == 2
    visit_recorded = next(event for event in timeline_events if event["type"] == "visit_recorded")
    assert visit_recorded["details"]["reason"] in {"Initial visit", "Review visit"}
    assert "temperature" in visit_recorded["details"]

    audit_events = test_client.get("/audit-events", headers=headers)
    assert audit_events.status_code == 200
    actions = [event["action"] for event in audit_events.json()]
    assert "patient_visit_recorded" in actions


def test_patient_email_and_address_are_saved_and_updatable(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="patient-contact@clinic.com", clinic_name="Patient Contact Clinic")
    headers = auth_headers_for_token(session["token"])

    created = test_client.post(
        "/patients",
        json={
            "name": "Contact Patient",
            "phone": "5550109091",
            "email": "Contact.Patient@Example.com",
            "address": "12 Lake Road",
            "reason": "Consultation",
            "age": 28,
            "weight": 60,
            "height": 165,
            "temperature": 98.4,
        },
        headers=headers,
    )
    assert created.status_code == 201
    patient = created.json()
    assert patient["email"] == "contact.patient@example.com"
    assert patient["address"] == "12 Lake Road"

    updated = test_client.patch(
        f"/patients/{patient['id']}",
        json={
            "email": "updated@example.com",
            "address": "44 River Street",
        },
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["email"] == "updated@example.com"
    assert updated.json()["address"] == "44 River Street"


def test_patient_lookup_returns_multiple_matches_for_same_phone(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="patients-lookup@clinic.com", clinic_name="Patient Lookup Clinic")
    headers = auth_headers_for_token(session["token"])

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


def test_patient_chart_visit_endpoints_split_visit_list_and_detail(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="patient-chart@clinic.com", clinic_name="Patient Chart Clinic")
    headers = auth_headers_for_token(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Chart Patient",
            "phone": "5550121212",
            "reason": "Hand pain",
            "age": 33,
            "weight": 70,
            "height": 172,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    revisit = test_client.post(
        f"/patients/{patient['id']}/visits",
        json={
            "name": "Chart Patient",
            "phone": "5550121212",
            "reason": "Review hand pain",
            "age": 33,
            "weight": 71,
            "height": 172,
            "temperature": 98.4,
        },
        headers=headers,
    )
    assert revisit.status_code == 200

    visits = test_client.get(f"/patients/{patient['id']}/visits", headers=headers)
    assert visits.status_code == 200
    visit_rows = visits.json()
    assert len(visit_rows) == 2
    selected_visit = visit_rows[0]
    assert selected_visit["reason"] == "Review hand pain"

    note = asyncio.run(
        repo.create_note(
            session["user"]["org_id"],
            SimpleNamespace(
                patient_id=patient["id"],
                content="Diagnosis: Improving tendon strain",
                asset_payload=[
                    {
                        "id": "asset-1",
                        "kind": "attachment",
                        "name": "xray.png",
                        "content_type": "image/png",
                        "data_base64": "ZmFrZQ==",
                    }
                ],
                structured_modules=[],
            ),
        )
    )
    asyncio.run(repo.finalize_note(session["user"]["org_id"], note["id"]))
    asyncio.run(
        repo.create_follow_up(
            session["user"]["org_id"],
            patient["id"],
            session["user"]["id"],
            SimpleNamespace(
                scheduled_for=repo.patient_visits[selected_visit["id"]]["created_at"],
                notes="Review mobility next week",
            ),
        )
    )
    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={
            "file": (
                "clip.mp4",
                b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20,
                "video/mp4",
            )
        },
        headers=headers,
    )
    assert upload.status_code == 201

    detail = test_client.get(
        f"/patients/{patient['id']}/visits/{selected_visit['id']}/details",
        headers=headers,
    )
    assert detail.status_code == 200
    detail_json = detail.json()
    assert detail_json["visit_id"] == selected_visit["id"]
    assert detail_json["reason"] == "Review hand pain"
    assert detail_json["consultation_note"]["status"] == "final"
    assert "Improving tendon strain" in detail_json["consultation_note"]["content"]
    assert {row["source_type"] for row in detail_json["attachments"]} == {"note_attachment", "patient_attachment"}
    assert any(event["type"] == "follow_up_scheduled" for event in detail_json["timeline"])


def test_patient_lookup_returns_most_recent_matches_first_and_honors_limit(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="patients-lookup-limit@clinic.com", clinic_name="Patient Lookup Limit Clinic")
    headers = auth_headers_for_token(session["token"])

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


def test_patient_visit_detail_deduplicates_note_attachments_across_versions(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="patients-dedupe@clinic.com", clinic_name="Patient Dedupe Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = test_client.post(
        "/patients",
        json={
            "name": "Attachment Deduped",
            "phone": "5550191919",
            "reason": "Review hand pain",
            "age": 37,
            "weight": 69,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()
    visit = repo.patient_visits[next(iter(repo.patient_visits))]
    shared_asset = {
        "id": "asset-1",
        "kind": "attachment",
        "name": "scan.png",
        "content_type": "image/png",
        "data_base64": "YWJj",
    }
    import asyncio
    from app.schema_domains.patients import NoteCreate

    first_note = asyncio.run(repo.create_note(session["user"]["org_id"], NoteCreate(
        patient_id=patient["id"],
        content="Draft note",
        asset_payload=[shared_asset],
        structured_modules=[],
    )))
    second_note = asyncio.run(repo.create_note(session["user"]["org_id"], NoteCreate(
        patient_id=patient["id"],
        content="Final note",
        asset_payload=[shared_asset],
        structured_modules=[],
    )))
    asyncio.run(repo.finalize_note(session["user"]["org_id"], first_note["id"]))
    asyncio.run(repo.finalize_note(session["user"]["org_id"], second_note["id"]))

    detail = test_client.get(
        f"/patients/{patient['id']}/visits/{visit['id']}/details",
        headers=headers,
    )

    assert detail.status_code == 200
    note_attachments = [row for row in detail.json()["attachments"] if row["source_type"] == "note_attachment"]
    assert len(note_attachments) == 1


def test_patient_phone_is_normalized_for_lookup_and_storage(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="patients-normalize@clinic.com", clinic_name="Patient Normalize Clinic")
    headers = auth_headers_for_token(session["token"])

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
