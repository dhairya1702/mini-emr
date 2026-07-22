from __future__ import annotations

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


def _signature(body: bytes) -> str:
    return "sha256=" + hmac.new(b"app-secret", body, hashlib.sha256).hexdigest()


class FakeWhatsAppClient:
    sent: list[dict] = []

    def __init__(self, **_kwargs) -> None:
        pass

    def send_text(self, **kwargs):
        FakeWhatsAppClient.sent.append(kwargs)
        return SimpleNamespace(message_id="wamid.outbound", raw={"messages": [{"id": "wamid.outbound"}]})


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


def _post_whatsapp_text(test_client, text: str):
    body = json.dumps(_payload(text)).encode("utf-8")
    return test_client.post(
        "/webhooks/whatsapp",
        content=body,
        headers={"X-Hub-Signature-256": _signature(body), "Content-Type": "application/json"},
    )


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
