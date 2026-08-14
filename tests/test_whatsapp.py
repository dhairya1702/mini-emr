from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from test_app import auth_headers_for_token, client, register_test_clinic
from app import config as config_module
from app.routes import whatsapp as whatsapp_route
from app.services import whatsapp_assistant
from app.services import whatsapp_client as whatsapp_client_module
from app.services import whatsapp_followup_workflow


def _settings(**overrides):
    defaults = {
        "auth_secret": "test-secret",
        "app_origin": "http://127.0.0.1:3000",
        "open_clinic_registration": True,
        "internal_scheduler_token": "internal-test-token",
        "whatsapp_enabled": True,
        "whatsapp_verify_token": "verify-test-token",
        "whatsapp_app_secret": "app-secret",
        "whatsapp_access_token": "access-token",
        "whatsapp_phone_number_id": "phone-number-id",
        "whatsapp_graph_api_version": "v23.0",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _payload(text: str, *, from_wa_id: str = "919999999999") -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "phone-number-id"},
                            "contacts": [{"wa_id": from_wa_id, "profile": {"name": "Owner"}}],
                            "messages": [
                                {
                                    "id": "wamid.test",
                                    "from": from_wa_id,
                                    "type": "text",
                                    "text": {"body": text},
                                }
                            ],
                        }
                    }
                ]
            }
        ],
    }


def _status_payload(message_id: str, status: str) -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "statuses": [
                                {
                                    "id": message_id,
                                    "recipient_id": "919600106623",
                                    "status": status,
                                }
                            ]
                        }
                    }
                ]
            }
        ],
    }


def _signature(body: bytes) -> str:
    return "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()


class FakeWhatsAppClient:
    sent: list[dict] = []

    def __init__(self, **_kwargs) -> None:
        pass

    def send_text(self, **kwargs):
        FakeWhatsAppClient.sent.append(kwargs)
        return SimpleNamespace(message_id="wamid.outbound", raw={"messages": [{"id": "wamid.outbound"}]})

    def send_follow_up_booking_template(self, **kwargs):
        FakeWhatsAppClient.sent.append(kwargs)
        return SimpleNamespace(message_id="wamid.follow-up", raw={"messages": [{"id": "wamid.follow-up"}]})


def _bind_owner(repo, org_id: str) -> None:
    import asyncio

    asyncio.run(
        repo.upsert_whatsapp_owner_binding(
            org_id=org_id,
            wa_id="919999999999",
            phone="+919999999999",
            display_name="Owner",
        )
    )


def _post_whatsapp_text(test_client, text: str, *, from_wa_id: str = "919999999999"):
    body = json.dumps(_payload(text, from_wa_id=from_wa_id)).encode("utf-8")
    return test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body), "Content-Type": "application/json"},
    )


def test_follow_up_booking_invitation_uses_template_once(client, monkeypatch: pytest.MonkeyPatch):
    _test_client, repo = client
    settings = _settings(
        app_origin="https://clinic.example",
        whatsapp_follow_up_template_name="follow_up_booking_invitation",
        whatsapp_follow_up_template_language="en",
    )
    monkeypatch.setattr(whatsapp_followup_workflow, "get_settings", lambda: settings)
    monkeypatch.setattr(whatsapp_followup_workflow, "build_whatsapp_client", lambda: FakeWhatsAppClient())
    FakeWhatsAppClient.sent = []

    follow_up = {
        "id": "follow-up-1",
        "patient_id": "patient-1",
        "notes": "Review your eye pressure",
    }
    patient = {
        "id": "patient-1",
        "name": "Asha Patel",
        "phone": "9876543210",
    }
    clinic_settings = {"clinic_name": "Fika Eye Care"}

    first = asyncio.run(
        whatsapp_followup_workflow.send_follow_up_booking_invitation(
            repo,
            org_id="org-1",
            follow_up=follow_up,
            patient=patient,
            clinic_settings=clinic_settings,
        )
    )
    second = asyncio.run(
        whatsapp_followup_workflow.send_follow_up_booking_invitation(
            repo,
            org_id="org-1",
            follow_up=follow_up,
            patient=patient,
            clinic_settings=clinic_settings,
        )
    )

    assert first["status"] == "accepted"
    assert second["id"] == first["id"]
    assert len(FakeWhatsAppClient.sent) == 1
    sent = FakeWhatsAppClient.sent[0]
    assert sent["to"] == "919876543210"
    assert sent["template_name"] == "follow_up_booking_invitation"
    assert sent["patient_first_name"] == "Asha"
    assert sent["clinic_name"] == "Fika Eye Care"
    assert sent["booking_token"]
    assert first["intent"] == "follow_up_booking_invitation"
    assert first["raw_payload"]["booking_url"].startswith("https://clinic.example/follow-up?token=")


def test_follow_up_template_payload_has_dynamic_url_button(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self) -> bytes:
            return b'{"messages":[{"id":"wamid.template"}]}'

    def fake_urlopen(request, timeout):
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(whatsapp_client_module, "urlopen", fake_urlopen)
    client = whatsapp_client_module.WhatsAppClient(
        access_token="access-token",
        phone_number_id="phone-number-id",
    )
    result = client.send_follow_up_booking_template(
        to="919876543210",
        template_name="follow_up_booking_invitation",
        language_code="en",
        patient_first_name="Asha",
        clinic_name="Fika Eye Care",
        follow_up_reason="Eye pressure review",
        booking_token="signed-booking-token",
    )

    assert result.message_id == "wamid.template"
    template = captured["payload"]["template"]
    assert template["name"] == "follow_up_booking_invitation"
    assert template["components"][0]["parameters"][1]["text"] == "Fika Eye Care"
    button = template["components"][1]
    assert button["type"] == "button"
    assert button["sub_type"] == "url"
    assert button["parameters"] == [{"type": "text", "text": "signed-booking-token"}]


def test_whatsapp_webhook_verification(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())

    response = test_client.get(
        "/webhooks/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "verify-test-token",
            "hub.challenge": "challenge-123",
        },
    )

    assert response.status_code == 200
    assert response.text == "challenge-123"


def test_whatsapp_delivery_webhook_updates_outbound_event(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-status@clinic.com", clinic_name="Status Clinic")
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    import asyncio

    event = asyncio.run(
        repo.record_whatsapp_message_event(
            org_id=session["user"]["org_id"],
            binding_id=None,
            direction="outbound",
            wa_message_id="wamid.delivery",
            recipient_wa_id="919600106623",
            message_text="Invoice",
            intent="send_invoice_document",
            status="accepted",
            document_type="invoice",
            document_id="invoice-1",
        )
    )
    body = json.dumps(_status_payload("wamid.delivery", "delivered")).encode("utf-8")
    response = test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body), "Content-Type": "application/json"},
    )

    assert response.status_code == 200
    assert response.json()["processed"] == 1
    assert repo.whatsapp_message_events[event["id"]]["status"] == "delivered"
    delivery = test_client.get(
        "/whatsapp/document-deliveries/invoice/invoice-1",
        headers=auth_headers_for_token(session["token"]),
    )
    assert delivery.status_code == 200
    assert delivery.json()["status"] == "delivered"


def test_whatsapp_owner_summary_replies_and_logs_events(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp@clinic.com", clinic_name="WhatsApp Clinic")
    org_id = session["user"]["org_id"]
    headers = auth_headers_for_token(session["token"])
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []

    repo.clinic_settings[org_id]["timezone"] = "UTC"
    patient = test_client.post(
        "/patients",
        json={"name": "Seen Patient", "phone": "5550101111", "reason": "Consultation"},
        headers=headers,
    ).json()
    test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "partial",
            "amount_paid": 250,
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=headers,
    )
    _bind_owner(repo, org_id)

    response = _post_whatsapp_text(test_client, "today summary")

    assert response.status_code == 200
    assert response.json()["processed"] == 1
    assert FakeWhatsAppClient.sent
    assert "Patients seen: 1" in FakeWhatsAppClient.sent[0]["body"]
    assert "Revenue recorded: Rs. 250.00" in FakeWhatsAppClient.sent[0]["body"]
    statuses = [event["status"] for event in repo.whatsapp_message_events.values()]
    assert statuses == ["received", "sent"]


def test_whatsapp_revenue_and_patient_range_commands(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-ranges@clinic.com", clinic_name="WhatsApp Ranges Clinic")
    org_id = session["user"]["org_id"]
    headers = auth_headers_for_token(session["token"])
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    repo.clinic_settings[org_id]["timezone"] = "UTC"
    _bind_owner(repo, org_id)

    patient = test_client.post(
        "/patients",
        json={"name": "Monthly Patient", "phone": "5550101212", "reason": "Consultation"},
        headers=headers,
    ).json()
    test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 700}],
        },
        headers=headers,
    )

    assert _post_whatsapp_text(test_client, "revenue this month").status_code == 200
    assert "Revenue recorded this month: Rs. 700.00" in FakeWhatsAppClient.sent[-1]["body"]

    assert _post_whatsapp_text(test_client, "total revenue").status_code == 200
    assert "Total recorded revenue: Rs. 700.00" in FakeWhatsAppClient.sent[-1]["body"]

    assert _post_whatsapp_text(test_client, "patients this month").status_code == 200
    assert "Patients seen this month: 1 visit(s)." in FakeWhatsAppClient.sent[-1]["body"]

    assert _post_whatsapp_text(test_client, "total patients").status_code == 200
    assert "Total patient records: 1." in FakeWhatsAppClient.sent[-1]["body"]


def test_whatsapp_appointments_this_week_command(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-week@clinic.com", clinic_name="WhatsApp Week Clinic")
    org_id = session["user"]["org_id"]
    headers = auth_headers_for_token(session["token"])
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    repo.clinic_settings[org_id]["timezone"] = "UTC"
    _bind_owner(repo, org_id)

    tomorrow = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(days=1)
    test_client.post(
        "/appointments",
        json={
            "name": "Week Appointment",
            "phone": "5550103434",
            "reason": "Review",
            "scheduled_for": tomorrow.isoformat(),
        },
        headers=headers,
    )

    response = _post_whatsapp_text(test_client, "appointments this week")

    assert response.status_code == 200
    assert "This week's appointments" in FakeWhatsAppClient.sent[-1]["body"]
    assert "Week Appointment" in FakeWhatsAppClient.sent[-1]["body"]


def test_whatsapp_staff_binding_is_ignored(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-staff@clinic.com", clinic_name="WhatsApp Staff Clinic")
    org_id = session["user"]["org_id"]
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    asyncio.run(
        repo.upsert_whatsapp_owner_binding(
            org_id=org_id,
            wa_id="918888888888",
            phone="+918888888888",
            display_name="Staff",
            role="staff",
        )
    )

    for text in ("revenue today", "total revenue", "today summary", "patients this week"):
        response = _post_whatsapp_text(test_client, text, from_wa_id="918888888888")
        assert response.status_code == 200
    assert FakeWhatsAppClient.sent == []
    events = list(repo.whatsapp_message_events.values())
    assert len(events) == 4
    assert all(event["status"] == "ignored" for event in events)
    assert all(event["intent"] for event in events)


def test_whatsapp_doctor_binding_can_chat(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-doctor@clinic.com", clinic_name="WhatsApp Doctor Clinic")
    org_id = session["user"]["org_id"]
    headers = auth_headers_for_token(session["token"])
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    repo.clinic_settings[org_id]["timezone"] = "UTC"
    asyncio.run(
        repo.upsert_whatsapp_owner_binding(
            org_id=org_id,
            wa_id="917777777777",
            phone="+917777777777",
            display_name="Doctor",
            role="doctor",
        )
    )

    test_client.post(
        "/patients",
        json={"name": "Doctor Patient", "phone": "5550109999", "reason": "Consultation"},
        headers=headers,
    )

    response = _post_whatsapp_text(test_client, "total patients", from_wa_id="917777777777")

    assert response.status_code == 200
    assert response.json()["processed"] == 1
    assert FakeWhatsAppClient.sent
    assert "Total patient records: 1." in FakeWhatsAppClient.sent[-1]["body"]
    statuses = [event["status"] for event in repo.whatsapp_message_events.values()]
    assert statuses == ["received", "sent"]


def test_whatsapp_revenue_and_counts_use_aggregates(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="whatsapp-aggregates@clinic.com", clinic_name="WhatsApp Aggregates Clinic"
    )
    org_id = session["user"]["org_id"]
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    repo.clinic_settings[org_id]["timezone"] = "UTC"

    async def _fail_full_load(*_args, **_kwargs):
        raise AssertionError("full-table load must not happen for aggregate intents")

    monkeypatch.setattr(repo, "list_invoices", _fail_full_load)
    monkeypatch.setattr(repo, "list_patient_visits", _fail_full_load)
    monkeypatch.setattr(repo, "list_patients", _fail_full_load)
    _bind_owner(repo, org_id)

    for text in ("revenue today", "total revenue", "pending payments", "patients today", "total patients", "today summary"):
        response = _post_whatsapp_text(test_client, text)
        assert response.status_code == 200
        assert FakeWhatsAppClient.sent, text


def test_whatsapp_total_patients_reports_full_count_above_ten_thousand(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="whatsapp-huge@clinic.com", clinic_name="WhatsApp Huge Clinic"
    )
    org_id = session["user"]["org_id"]
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    repo.clinic_settings[org_id]["timezone"] = "UTC"

    async def _count_patients(_org_id: str) -> int:
        return 12345

    monkeypatch.setattr(repo, "count_patients", _count_patients)
    _bind_owner(repo, org_id)

    response = _post_whatsapp_text(test_client, "total patients")

    assert response.status_code == 200
    assert FakeWhatsAppClient.sent
    assert "Total patient records: 12345." in FakeWhatsAppClient.sent[-1]["body"]


def test_internal_whatsapp_binding_seed_endpoint_allows_doctor_role(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client, identifier="whatsapp-doctor-seed@clinic.com", clinic_name="WhatsApp Doctor Seed Clinic"
    )
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())

    response = test_client.post(
        "/internal/whatsapp/owner-bindings",
        headers={"X-Internal-Scheduler-Token": "internal-test-token"},
        json={
            "org_id": session["user"]["org_id"],
            "wa_id": "916666666666",
            "phone": "+916666666666",
            "display_name": "Doctor",
            "role": "doctor",
        },
    )

    assert response.status_code == 200
    assert response.json()["role"] == "doctor"


def test_internal_whatsapp_binding_seed_endpoint(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-seed@clinic.com", clinic_name="WhatsApp Seed Clinic")
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())

    response = test_client.post(
        "/internal/whatsapp/owner-bindings",
        headers={"X-Internal-Scheduler-Token": "internal-test-token"},
        json={
            "org_id": session["user"]["org_id"],
            "wa_id": "919999999999",
            "phone": "+919999999999",
            "display_name": "Owner",
        },
    )

    assert response.status_code == 200
    binding = response.json()
    assert binding["org_id"] == session["user"]["org_id"]
    assert binding["wa_id"] == "919999999999"
    assert repo.whatsapp_owner_bindings[binding["id"]]["display_name"] == "Owner"


def test_whatsapp_disabled_mode_ignores_bound_sender(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="whatsapp-disabled@clinic.com", clinic_name="WhatsApp Disabled Clinic")
    org_id = session["user"]["org_id"]
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings(whatsapp_enabled=False))
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []
    import asyncio

    asyncio.run(
        repo.upsert_whatsapp_owner_binding(
            org_id=org_id,
            wa_id="919999999999",
            phone="+919999999999",
            display_name="Owner",
        )
    )

    body = json.dumps(_payload("today summary")).encode("utf-8")
    response = test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body), "Content-Type": "application/json"},
    )

    assert response.status_code == 200
    assert FakeWhatsAppClient.sent == []
    events = list(repo.whatsapp_message_events.values())
    assert len(events) == 1
    assert events[0]["status"] == "ignored"


def test_whatsapp_hsr_style_unauthorized_sender_is_ignored(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(whatsapp_route, "WhatsAppClient", FakeWhatsAppClient)
    FakeWhatsAppClient.sent = []

    body = json.dumps(_payload("revenue today", from_wa_id="918888888888")).encode("utf-8")
    response = test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body), "Content-Type": "application/json"},
    )

    assert response.status_code == 200
    assert FakeWhatsAppClient.sent == []
    events = list(repo.whatsapp_message_events.values())
    assert len(events) == 1
    assert events[0]["status"] == "ignored"


def test_whatsapp_rejects_invalid_signature(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings())
    body = json.dumps(_payload("today summary")).encode("utf-8")

    response = test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=bad", "Content-Type": "application/json"},
    )

    assert response.status_code == 403


def test_whatsapp_rejects_missing_app_secret_without_explicit_bypass(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    monkeypatch.setattr(config_module, "get_settings", lambda: _settings(whatsapp_app_secret=""))
    body = json.dumps(_payload("today summary")).encode("utf-8")

    response = test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 403


def test_whatsapp_allows_explicit_signature_bypass_for_dev(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    monkeypatch.setattr(
        config_module,
        "get_settings",
        lambda: _settings(whatsapp_app_secret="", whatsapp_skip_signature_check=True),
    )
    body = json.dumps(_payload("today summary")).encode("utf-8")

    response = test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 200


def test_whatsapp_command_classifier():
    assert whatsapp_assistant.classify_intent("who is there tomorrow?") == "appointments_tomorrow"
    assert whatsapp_assistant.classify_intent("how much did we make today") == "revenue_today"
    assert whatsapp_assistant.classify_intent("revenue this month") == "revenue_this_month"
    assert whatsapp_assistant.classify_intent("total revenue") == "total_revenue"
    assert whatsapp_assistant.classify_intent("patients this week") == "patients_this_week"
    assert whatsapp_assistant.classify_intent("total patients") == "total_patients"
    assert whatsapp_assistant.classify_intent("appointments this week") == "appointments_this_week"
    assert whatsapp_assistant.classify_intent("unpaid invoices") == "pending_payments"
    assert whatsapp_assistant.classify_intent("hello") == "help"
