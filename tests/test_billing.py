from __future__ import annotations

from test_app import auth_headers_for_token, client, register_test_clinic
from app.services import billing_workflow, whatsapp_document_workflow
from app.services.whatsapp_client import WhatsAppSendResult


class FakeWhatsAppDocumentClient:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.documents: list[dict[str, object]] = []

    def upload_media(self, *, content: bytes, filename: str, content_type: str) -> str:
        self.uploads.append({"content": content, "filename": filename, "content_type": content_type})
        return "media-123"

    def send_document(self, *, to: str, media_id: str, filename: str, caption: str = "") -> WhatsAppSendResult:
        self.documents.append({"to": to, "media_id": media_id, "filename": filename, "caption": caption})
        return WhatsAppSendResult(message_id="wamid.invoice", raw={"messages": [{"id": "wamid.invoice"}]})


def test_catalog_gst_requires_hsn_sac_and_rate_together(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="gst-validation@clinic.com",
        clinic_name="GST Validation Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    base_payload = {
        "name": "Frames",
        "item_type": "medicine",
        "default_price": 1000,
        "track_inventory": False,
        "stock_quantity": 0,
        "low_stock_threshold": 0,
        "unit": "piece",
    }

    code_only = test_client.post(
        "/catalog",
        headers=headers,
        json={**base_payload, "hsn_sac_code": "9003"},
    )
    rate_only = test_client.post(
        "/catalog",
        headers=headers,
        json={**base_payload, "gst_rate": 12},
    )

    assert code_only.status_code == 422
    assert rate_only.status_code == 422


def test_catalog_item_can_be_edited_without_overwriting_stock(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="catalog-edit@clinic.com",
        clinic_name="Catalog Edit Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    created = test_client.post(
        "/catalog",
        headers=headers,
        json={
            "name": "Eye Drops",
            "item_type": "medicine",
            "default_price": 200,
            "track_inventory": True,
            "stock_quantity": 12,
            "low_stock_threshold": 3,
            "unit": "bottle",
        },
    ).json()

    updated = test_client.patch(
        f"/catalog/{created['id']}",
        headers=headers,
        json={
            "name": "Lubricating Eye Drops",
            "item_type": "medicine",
            "default_price": 240,
            "track_inventory": True,
            "low_stock_threshold": 5,
            "unit": "bottle",
            "hsn_sac_code": "3004",
            "gst_rate": 12,
            "aliases": ["eye drops", "lubricant"],
        },
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Lubricating Eye Drops"
    assert updated.json()["default_price"] == 240
    assert updated.json()["stock_quantity"] == 12
    assert updated.json()["low_stock_threshold"] == 5
    assert updated.json()["aliases"] == ["eye drops", "lubricant"]
    audit = list(repo.audit_events.values())[-1]
    assert audit["action"] == "catalog_item_updated"
    assert "name" in audit["metadata"]["changed_fields"]


def test_invoice_adds_catalog_gst_and_snapshots_the_tax_details(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="item-gst@clinic.com",
        clinic_name="Item GST Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = test_client.post(
        "/patients",
        headers=headers,
        json={
            "name": "Tax Patient",
            "phone": "5550102030",
            "reason": "Frames",
            "age": 35,
            "temperature": 98.4,
        },
    ).json()
    frames = test_client.post(
        "/catalog",
        headers=headers,
        json={
            "name": "Frames",
            "item_type": "medicine",
            "default_price": 1000,
            "track_inventory": False,
            "stock_quantity": 0,
            "low_stock_threshold": 0,
            "unit": "piece",
            "hsn_sac_code": "9003",
            "gst_rate": 12,
        },
    ).json()

    response = test_client.post(
        "/invoices",
        headers=headers,
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [
                {
                    "catalog_item_id": frames["id"],
                    "item_type": "medicine",
                    "label": "Frames",
                    "quantity": 1,
                    "unit_price": 1000,
                },
                {
                    "item_type": "service",
                    "label": "Consultation",
                    "quantity": 1,
                    "unit_price": 500,
                },
            ],
        },
    )

    assert response.status_code == 201
    invoice = response.json()
    assert invoice["subtotal"] == 1500
    assert invoice["tax_total"] == 120
    assert invoice["cgst_total"] == 60
    assert invoice["sgst_total"] == 60
    assert invoice["total"] == 1620
    assert invoice["amount_paid"] == 1620
    assert invoice["items"][0]["hsn_sac_code"] == "9003"
    assert invoice["items"][0]["gst_rate"] == 12
    assert invoice["items"][0]["tax_amount"] == 120
    assert invoice["items"][1]["tax_amount"] == 0

    repo.catalog_items[frames["id"]]["gst_rate"] = 18
    stored_invoice = test_client.get("/invoices", headers=headers).json()[0]
    assert stored_invoice["items"][0]["gst_rate"] == 12
    assert stored_invoice["total"] == 1620


def test_invoice_payment_update_writes_its_audit_event_through_atomic_repository_contract(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="payment-audit@clinic.com",
        clinic_name="Payment Audit Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = test_client.post(
        "/patients",
        headers=headers,
        json={
            "name": "Payment Patient",
            "phone": "5550102021",
            "reason": "Consultation",
            "age": 40,
            "temperature": 98.6,
        },
    ).json()
    invoice = test_client.post(
        "/invoices",
        headers=headers,
        json={
            "patient_id": patient["id"],
            "payment_status": "unpaid",
            "items": [{
                "item_type": "service",
                "label": "Consultation",
                "quantity": 1,
                "unit_price": 500,
            }],
        },
    ).json()
    finalized = test_client.post(
        "/invoices/finalize",
        headers=headers,
        json={"invoice_id": invoice["id"]},
    )
    assert finalized.status_code == 200

    payment = test_client.patch(
        f"/invoices/{invoice['id']}/payment",
        headers=headers,
        json={"amount_paid": 200},
    )

    assert payment.status_code == 200
    assert payment.json()["invoice"]["amount_paid"] == 200
    matching_events = [
        event
        for event in repo.audit_events.values()
        if event["entity_id"] == invoice["id"]
        and event["action"] == "invoice_payment_updated"
    ]
    assert len(matching_events) == 1
    assert matching_events[0]["metadata"]["previous_amount_paid"] == 0
    assert matching_events[0]["metadata"]["amount_paid"] == 200


def test_billing_finalize_marks_patient_and_deducts_stock_once(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="billing@clinic.com", clinic_name="Billing Clinic")
    sent_messages: list[dict[str, object]] = []

    async def fake_send_clinic_email_message(**kwargs):
        sent_messages.append(kwargs)

    monkeypatch.setattr(billing_workflow, "send_clinic_email_message", fake_send_clinic_email_message)

    patient = test_client.post(
        "/patients",
        json={
            "name": "Bill Patient",
            "phone": "5550102020",
            "email": "bill@example.com",
            "address": "12 Billing Street",
            "reason": "Consultation",
            "age": 40,
            "weight": 75,
            "height": 172,
            "temperature": 98.6,
        },
        headers=auth_headers_for_token(session["token"]),
    ).json()

    item = test_client.post(
        "/catalog",
        json={
            "name": "Amoxicillin",
            "item_type": "medicine",
            "default_price": 50,
            "track_inventory": True,
            "stock_quantity": 10,
            "low_stock_threshold": 2,
            "unit": "strip",
        },
        headers=auth_headers_for_token(session["token"]),
    ).json()

    invoice_response = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [
                {
                    "catalog_item_id": item["id"],
                    "item_type": "medicine",
                    "label": "Amoxicillin",
                    "quantity": 3,
                    "unit_price": 50,
                }
            ],
        },
        headers=auth_headers_for_token(session["token"]),
    )
    assert invoice_response.status_code == 201
    invoice = invoice_response.json()
    assert invoice["payment_status"] == "paid"
    assert invoice["amount_paid"] == invoice["total"]
    assert invoice["balance_due"] == 0
    assert invoice["paid_at"] is not None
    assert invoice["sent_at"] is None
    assert repo.patients[patient["id"]]["billed"] is False
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 10
    assert repo.invoices[invoice["id"]]["completed_at"] is None

    completed = test_client.post(
        "/invoices/finalize",
        json={"invoice_id": invoice["id"]},
        headers=auth_headers_for_token(session["token"]),
    )
    assert completed.status_code == 200
    assert repo.patients[patient["id"]]["billed"] is True
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 7
    assert repo.invoices[invoice["id"]]["completed_at"] is not None
    assert repo.invoices[invoice["id"]]["sent_at"] is None

    first_send = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient_email": patient["email"]},
        headers=auth_headers_for_token(session["token"]),
    )
    assert first_send.status_code == 200
    assert repo.patients[patient["id"]]["billed"] is True
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 7
    assert repo.invoices[invoice["id"]]["sent_at"] is not None
    assert repo.invoices[invoice["id"]]["completed_by"] == session["user"]["id"]
    assert len(sent_messages) == 1
    assert sent_messages[0]["recipient"] == patient["email"]
    assert sent_messages[0]["subject"] == "Your invoice from Billing Clinic"
    assert sent_messages[0]["text_content"] == (
        "Hi Bill,\n\n"
        "Thank you for visiting Billing Clinic. We've attached the invoice from your visit "
        "for your records.\n\n"
        "Thank you,\nBilling Clinic"
    )

    second_send = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient_email": patient["email"]},
        headers=auth_headers_for_token(session["token"]),
    )
    assert second_send.status_code == 200
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 7
    assert "already emailed" in second_send.json()["message"].lower()


def test_invoice_can_be_sent_on_whatsapp_with_patient_phone(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="billing-whatsapp@clinic.com", clinic_name="WhatsApp Billing Clinic")
    headers = auth_headers_for_token(session["token"])
    fake_client = FakeWhatsAppDocumentClient()
    monkeypatch.setattr(whatsapp_document_workflow, "build_whatsapp_client", lambda: fake_client)

    patient = test_client.post(
        "/patients",
        json={
            "name": "WhatsApp Patient",
            "phone": "9600106623",
            "email": "wa@example.com",
            "reason": "Consultation",
            "age": 30,
            "weight": 65,
            "height": 170,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()
    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=headers,
    ).json()

    response = test_client.post(
        "/send-invoice-whatsapp",
        json={"invoice_id": invoice["id"]},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["invoice"]["sent_at"] is not None
    assert fake_client.uploads[0]["filename"] == "WhatsApp_Patient_invoice.pdf"
    assert fake_client.uploads[0]["content_type"] == "application/pdf"
    assert fake_client.documents == [
        {
            "to": "919600106623",
            "media_id": "media-123",
            "filename": "WhatsApp_Patient_invoice.pdf",
            "caption": (
                "Hi WhatsApp,\n\n"
                "Thank you for visiting WhatsApp Billing Clinic.\n\n"
                "Here is your receipt for today's visit.\n"
                "Amount paid: Rs. 500.00\n\n"
                "Attached for your records."
            ),
        }
    ]
    events = list(repo.whatsapp_message_events.values())
    assert len(events) == 1
    assert events[0]["intent"] == "send_invoice_document"
    assert events[0]["status"] == "accepted"
    assert events[0]["document_type"] == "invoice"
    assert events[0]["document_id"] == invoice["id"]
    assert events[0]["wa_message_id"] == "wamid.invoice"
    assert events[0]["recipient_wa_id"] == "919600106623"


def test_invoice_whatsapp_idempotency_prevents_duplicate_delivery(client, monkeypatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="billing-wa-idempotent@clinic.com", clinic_name="WA Idempotent Clinic")
    headers = auth_headers_for_token(session["token"])
    fake_client = FakeWhatsAppDocumentClient()
    monkeypatch.setattr(whatsapp_document_workflow, "build_whatsapp_client", lambda: fake_client)
    patient = test_client.post(
        "/patients",
        json={
            "name": "Idempotent Patient",
            "phone": "9600106623",
            "reason": "Consultation",
            "age": 30,
            "weight": 65,
            "height": 170,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()
    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=headers,
    ).json()
    payload = {"invoice_id": invoice["id"], "idempotency_key": "invoice-send-1"}

    first = test_client.post("/send-invoice-whatsapp", json=payload, headers=headers)
    second = test_client.post("/send-invoice-whatsapp", json=payload, headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["delivery"]["event_id"] == second.json()["delivery"]["event_id"]
    assert len(fake_client.documents) == 1


def test_invoice_can_be_created_with_partial_payment_status(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="billing-partial@clinic.com", clinic_name="Billing Partial Clinic")
    headers = auth_headers_for_token(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Partial Pay Patient",
            "phone": "5550102121",
            "reason": "Consultation",
            "age": 37,
            "weight": 72,
            "height": 171,
            "temperature": 98.7,
        },
        headers=headers,
    ).json()

    invoice_response = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "partial",
            "amount_paid": 150,
            "items": [
                {
                    "item_type": "service",
                    "label": "Consultation",
                    "quantity": 1,
                    "unit_price": 500,
                }
            ],
        },
        headers=headers,
    )
    assert invoice_response.status_code == 201
    invoice = invoice_response.json()
    assert invoice["payment_status"] == "partial"
    assert invoice["amount_paid"] == 150
    assert invoice["balance_due"] == 350
    assert invoice["paid_at"] is None
    assert repo.patients[patient["id"]]["billed"] is False


def test_invoice_create_with_invoice_id_updates_existing_draft(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="billing-update@clinic.com", clinic_name="Billing Update Clinic")
    headers = auth_headers_for_token(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Draft Update Patient",
            "phone": "5550103131",
            "reason": "Consultation",
            "age": 33,
            "weight": 70,
            "height": 170,
            "temperature": 98.7,
        },
        headers=headers,
    ).json()

    first = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=headers,
    )
    assert first.status_code == 201
    invoice = first.json()

    second = test_client.post(
        "/invoices",
        json={
            "invoice_id": invoice["id"],
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [
                {"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500},
                {"item_type": "service", "label": "Procedure", "quantity": 1, "unit_price": 250},
            ],
        },
        headers=headers,
    )
    assert second.status_code == 201
    updated = second.json()
    assert updated["id"] == invoice["id"]
    assert updated["total"] == 750
    assert len(updated["items"]) == 2
    assert len(repo.invoices) == 1


def test_cross_org_invoice_and_negative_stock_adjustment_are_rejected(client):
    test_client, _repo = client
    session_a = register_test_clinic(test_client, identifier="owner-a2@clinic.com", clinic_name="Clinic A2")
    session_b = register_test_clinic(test_client, identifier="owner-b2@clinic.com", clinic_name="Clinic B2")

    patient_b = test_client.post(
        "/patients",
        json={
            "name": "Other Org Patient",
            "phone": "5550103030",
            "reason": "Checkup",
            "age": 28,
            "weight": 60,
            "height": 165,
            "temperature": 98.4,
        },
        headers=auth_headers_for_token(session_b["token"]),
    ).json()

    foreign_invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient_b["id"],
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
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert foreign_invoice.status_code == 400
    assert "Patient not found for this organization" in foreign_invoice.text

    item = test_client.post(
        "/catalog",
        json={
            "name": "Paracetamol",
            "item_type": "medicine",
            "default_price": 20,
            "track_inventory": True,
            "stock_quantity": 2,
            "low_stock_threshold": 1,
            "unit": "strip",
        },
        headers=auth_headers_for_token(session_a["token"]),
    ).json()

    negative_adjustment = test_client.patch(
        f"/catalog/{item['id']}/stock",
        json={"delta": -3},
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert negative_adjustment.status_code == 400
    assert "Stock cannot go below zero" in negative_adjustment.text


def test_invoice_delivery_failure_reports_finalized_state(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="billing-failure@clinic.com", clinic_name="Billing Failure Clinic")

    async def failing_send_clinic_email_message(**_kwargs):
        raise billing_workflow.EmailDeliveryError("SMTP unavailable")

    monkeypatch.setattr(billing_workflow, "send_clinic_email_message", failing_send_clinic_email_message)

    patient = test_client.post(
        "/patients",
        json={
            "name": "Failed Bill Patient",
            "phone": "5550106262",
            "email": "failed-bill@example.com",
            "address": "12 Billing Street",
            "reason": "Consultation",
            "age": 40,
            "weight": 75,
            "height": 172,
            "temperature": 98.6,
        },
        headers=auth_headers_for_token(session["token"]),
    ).json()

    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=auth_headers_for_token(session["token"]),
    ).json()

    response = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient_email": patient["email"]},
        headers=auth_headers_for_token(session["token"]),
    )

    assert response.status_code == 502
    assert "invoice finalized" in response.json()["detail"]["message"].lower()
    assert repo.invoices[invoice["id"]]["completed_at"] is not None
    assert any(
        error["path"] == "/send-invoice" and error["context"].get("invoice_id") == invoice["id"]
        for error in repo.platform_errors.values()
    )
