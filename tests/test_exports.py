from __future__ import annotations

from test_app import auth_headers, client, register


def test_admin_can_export_patients_visits_and_invoices_csv(client):
    test_client, _repo = client
    session = register(test_client, identifier="exports@clinic.com", clinic_name="Exports Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Export Patient",
            "phone": "5550102323",
            "reason": "Review",
            "age": 30,
            "weight": 64,
            "height": 169,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "unpaid",
            "items": [
                {
                    "item_type": "service",
                    "label": "Consultation",
                    "quantity": 1,
                    "unit_price": 300,
                }
            ],
        },
        headers=headers,
    )
    assert invoice.status_code == 201

    patients_csv = test_client.get("/exports/patients.csv", headers=headers)
    assert patients_csv.status_code == 200
    assert "text/csv" in patients_csv.headers["content-type"]
    assert "Export Patient" in patients_csv.text
    assert "last_visit_at" in patients_csv.text

    visits_csv = test_client.get("/exports/visits.csv", headers=headers)
    assert visits_csv.status_code == 200
    assert "Export Patient" in visits_csv.text
    assert "source" in visits_csv.text

    invoices_csv = test_client.get("/exports/invoices.csv", headers=headers)
    assert invoices_csv.status_code == 200
    assert "payment_status" in invoices_csv.text
    assert "amount_paid" in invoices_csv.text
    assert "balance_due" in invoices_csv.text
    assert "unpaid" in invoices_csv.text
