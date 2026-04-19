from __future__ import annotations

from test_app import auth_headers, client, register


def test_billing_finalize_marks_patient_and_deducts_stock_once(client):
    test_client, repo = client
    session = register(test_client, identifier="billing@clinic.com", clinic_name="Billing Clinic")

    patient = test_client.post(
        "/patients",
        json={
            "name": "Bill Patient",
            "phone": "5550102020",
            "reason": "Consultation",
            "age": 40,
            "weight": 75,
            "height": 172,
            "temperature": 98.6,
        },
        headers=auth_headers(session["token"]),
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
        headers=auth_headers(session["token"]),
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
        headers=auth_headers(session["token"]),
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

    first_send = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient": patient["phone"]},
        headers=auth_headers(session["token"]),
    )
    assert first_send.status_code == 200
    assert repo.patients[patient["id"]]["billed"] is True
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 7
    assert repo.invoices[invoice["id"]]["sent_at"] is not None
    assert repo.invoices[invoice["id"]]["completed_at"] is not None
    assert repo.invoices[invoice["id"]]["completed_by"] == session["user"]["id"]

    second_send = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient": patient["phone"]},
        headers=auth_headers(session["token"]),
    )
    assert second_send.status_code == 200
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 7
    assert "already finalized" in second_send.json()["message"].lower()


def test_invoice_can_be_created_with_partial_payment_status(client):
    test_client, repo = client
    session = register(test_client, identifier="billing-partial@clinic.com", clinic_name="Billing Partial Clinic")
    headers = auth_headers(session["token"])

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


def test_cross_org_invoice_and_negative_stock_adjustment_are_rejected(client):
    test_client, _repo = client
    session_a = register(test_client, identifier="owner-a2@clinic.com", clinic_name="Clinic A2")
    session_b = register(test_client, identifier="owner-b2@clinic.com", clinic_name="Clinic B2")

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
        headers=auth_headers(session_b["token"]),
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
        headers=auth_headers(session_a["token"]),
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
        headers=auth_headers(session_a["token"]),
    ).json()

    negative_adjustment = test_client.patch(
        f"/catalog/{item['id']}/stock",
        json={"delta": -3},
        headers=auth_headers(session_a["token"]),
    )
    assert negative_adjustment.status_code == 400
    assert "Stock cannot go below zero" in negative_adjustment.text
