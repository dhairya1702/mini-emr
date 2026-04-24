from __future__ import annotations

from test_app import auth_headers, client, register


def test_auth_org_isolation_and_admin_staff_rules(client):
    test_client, _repo = client
    session_a = register(test_client, identifier="owner-a@clinic.com", clinic_name="Clinic A")
    session_b = register(test_client, identifier="owner-b@clinic.com", clinic_name="Clinic B")

    patient_payload = {
        "name": "Patient One",
        "phone": "5550101010",
        "reason": "Fever",
        "age": 30,
        "weight": 70,
        "height": 170,
        "temperature": 99.5,
    }

    response_a = test_client.post("/patients", json=patient_payload, headers=auth_headers(session_a["token"]))
    response_b = test_client.post("/patients", json={**patient_payload, "name": "Patient Two"}, headers=auth_headers(session_b["token"]))
    assert response_a.status_code == 201
    assert response_b.status_code == 201

    list_a = test_client.get("/patients", headers=auth_headers(session_a["token"]))
    list_b = test_client.get("/patients", headers=auth_headers(session_b["token"]))
    assert [patient["name"] for patient in list_a.json()] == ["Patient One"]
    assert [patient["name"] for patient in list_b.json()] == ["Patient Two"]

    create_staff = test_client.post(
        "/users/staff",
        json={"identifier": "staff-a@clinic.com", "password": "password123"},
        headers=auth_headers(session_a["token"]),
    )
    assert create_staff.status_code == 201

    staff_login = test_client.post(
        "/auth/login",
        json={"identifier": "staff-a@clinic.com", "password": "password123"},
    )
    assert staff_login.status_code == 200

    forbidden = test_client.post(
        "/users/staff",
        json={"identifier": "blocked@clinic.com", "password": "password123"},
        headers=auth_headers(staff_login.json()["token"]),
    )
    assert forbidden.status_code == 403


def test_staff_cannot_access_earnings_invoice_list_or_start_consultation(client):
    test_client, _repo = client
    session = register(test_client, identifier="owner-perms@clinic.com", clinic_name="Perms Clinic")

    create_staff = test_client.post(
        "/users/staff",
        json={"identifier": "staff-perms@clinic.com", "password": "password123"},
        headers=auth_headers(session["token"]),
    )
    assert create_staff.status_code == 201

    staff_login = test_client.post(
        "/auth/login",
        json={"identifier": "staff-perms@clinic.com", "password": "password123"},
    )
    assert staff_login.status_code == 200
    staff_headers = auth_headers(staff_login.json()["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Permissions Patient",
            "phone": "5550105050",
            "reason": "Fever",
            "age": 32,
            "weight": 67,
            "height": 168,
            "temperature": 99.1,
        },
        headers=auth_headers(session["token"]),
    ).json()
    note = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Fever",
            "diagnosis": "Viral",
            "medications": "Rest",
            "notes": "Hydration",
        },
        headers=auth_headers(session["token"]),
    ).json()
    finalized_note = test_client.post(
        "/notes/finalize",
        json={"note_id": note["note_id"]},
        headers=auth_headers(session["token"]),
    )
    assert finalized_note.status_code == 200

    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=auth_headers(session["token"]),
    ).json()

    invoices = test_client.get("/invoices", headers=staff_headers)
    assert invoices.status_code == 403
    assert "Admin access required" in invoices.text

    users = test_client.get("/users", headers=staff_headers)
    assert users.status_code == 403

    audit_events = test_client.get("/audit-events", headers=staff_headers)
    assert audit_events.status_code == 403

    exports = test_client.get("/exports/patients.csv", headers=staff_headers)
    assert exports.status_code == 403

    catalog = test_client.get("/catalog", headers=staff_headers)
    assert catalog.status_code == 403

    create_catalog = test_client.post(
        "/catalog",
        json={
            "name": "Drug",
            "item_type": "medicine",
            "default_price": 10,
            "track_inventory": False,
            "stock_quantity": 0,
            "low_stock_threshold": 0,
            "unit": "strip",
        },
        headers=staff_headers,
    )
    assert create_catalog.status_code == 403

    create_invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=staff_headers,
    )
    assert create_invoice.status_code == 403

    send_invoice = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient_email": "patient@example.com"},
        headers=staff_headers,
    )
    assert send_invoice.status_code == 403

    invoice_pdf = test_client.get(f"/invoices/{invoice['id']}/pdf", headers=staff_headers)
    assert invoice_pdf.status_code == 403

    generate_note = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Fever",
            "diagnosis": "Viral",
            "medications": "Rest",
            "notes": "Hydration",
        },
        headers=staff_headers,
    )
    assert generate_note.status_code == 403

    finalize_note = test_client.post(
        "/notes/finalize",
        json={"note_id": note["note_id"]},
        headers=staff_headers,
    )
    assert finalize_note.status_code == 403

    send_note = test_client.post(
        "/send-note",
        json={"note_id": note["note_id"], "patient_id": patient["id"], "recipient_email": "patient@example.com"},
        headers=staff_headers,
    )
    assert send_note.status_code == 403

    note_pdf = test_client.get(f"/notes/{note['note_id']}/pdf", headers=staff_headers)
    assert note_pdf.status_code == 403

    start_consultation = test_client.patch(
        f"/patients/{patient['id']}",
        json={"status": "consultation"},
        headers=staff_headers,
    )
    assert start_consultation.status_code == 403
    assert "Admin access required to start consultation" in start_consultation.text
