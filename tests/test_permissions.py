from __future__ import annotations

import pytest

from test_app import auth_headers_for_token, client, register_test_clinic, signature_png_bytes


def test_auth_org_isolation_and_admin_staff_rules(client):
    test_client, _repo = client
    session_a = register_test_clinic(test_client, identifier="owner-a@clinic.com", clinic_name="Clinic A")
    session_b = register_test_clinic(test_client, identifier="owner-b@clinic.com", clinic_name="Clinic B")

    patient_payload = {
        "name": "Patient One",
        "phone": "5550101010",
        "reason": "Fever",
        "age": 30,
        "weight": 70,
        "height": 170,
        "temperature": 99.5,
    }

    response_a = test_client.post("/patients", json=patient_payload, headers=auth_headers_for_token(session_a["token"]))
    response_b = test_client.post("/patients", json={**patient_payload, "name": "Patient Two"}, headers=auth_headers_for_token(session_b["token"]))
    assert response_a.status_code == 201
    assert response_b.status_code == 201

    list_a = test_client.get("/patients", headers=auth_headers_for_token(session_a["token"]))
    list_b = test_client.get("/patients", headers=auth_headers_for_token(session_b["token"]))
    assert [patient["name"] for patient in list_a.json()] == ["Patient One"]
    assert [patient["name"] for patient in list_b.json()] == ["Patient Two"]

    create_staff = test_client.post(
        "/users/staff",
        json={"identifier": "staff-a@clinic.com", "password": "password123!"},
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert create_staff.status_code == 201

    staff_login = test_client.post(
        "/auth/login",
        json={"identifier": "staff-a@clinic.com", "password": "password123!"},
    )
    assert staff_login.status_code == 200

    forbidden = test_client.post(
        "/users/staff",
        json={"identifier": "blocked@clinic.com", "password": "password123!"},
        headers=auth_headers_for_token(staff_login.json()["token"]),
    )
    assert forbidden.status_code == 403


def test_staff_cannot_access_earnings_invoice_list_or_start_consultation(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="owner-perms@clinic.com", clinic_name="Perms Clinic")

    create_staff = test_client.post(
        "/users/staff",
        json={"identifier": "staff-perms@clinic.com", "password": "password123!"},
        headers=auth_headers_for_token(session["token"]),
    )
    assert create_staff.status_code == 201

    staff_login = test_client.post(
        "/auth/login",
        json={"identifier": "staff-perms@clinic.com", "password": "password123!"},
    )
    assert staff_login.status_code == 200
    staff_headers = auth_headers_for_token(staff_login.json()["token"])

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
        headers=auth_headers_for_token(session["token"]),
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
        headers=auth_headers_for_token(session["token"]),
    ).json()
    finalized_note = test_client.post(
        "/notes/finalize",
        json={"note_id": note["note_id"]},
        headers=auth_headers_for_token(session["token"]),
    )
    assert finalized_note.status_code == 200

    invoice = test_client.post(
        "/invoices",
        json={
            "patient_id": patient["id"],
            "payment_status": "paid",
            "items": [{"item_type": "service", "label": "Consultation", "quantity": 1, "unit_price": 500}],
        },
        headers=auth_headers_for_token(session["token"]),
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

    send_invoice_whatsapp = test_client.post(
        "/send-invoice-whatsapp",
        json={"invoice_id": invoice["id"], "recipient_phone": "9600106623"},
        headers=staff_headers,
    )
    assert send_invoice_whatsapp.status_code == 403

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


def test_staff_can_prioritize_and_reorder_but_cannot_advance_queue_stage(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="owner-queue-perms@clinic.com", clinic_name="Queue Perms Clinic")
    admin_headers = auth_headers_for_token(session["token"])
    assert test_client.post(
        "/users/staff",
        json={"identifier": "staff-queue-perms@clinic.com", "password": "password123!"},
        headers=admin_headers,
    ).status_code == 201
    staff_login = test_client.post(
        "/auth/login",
        json={"identifier": "staff-queue-perms@clinic.com", "password": "password123!"},
    ).json()
    staff_headers = auth_headers_for_token(staff_login["token"])
    patients = [
        test_client.post(
            "/patients",
            json={"name": name, "phone": phone, "reason": "Review", "age": 30},
            headers=admin_headers,
        ).json()
        for name, phone in (("Queue A", "5550103001"), ("Queue B", "5550103002"))
    ]

    priority = test_client.patch(
        f"/patients/{patients[1]['id']}",
        json={"queue_priority": "urgent"},
        headers=staff_headers,
    )
    assert priority.status_code == 200

    reordered = test_client.put(
        "/patients/queue/order",
        json={"columns": {"waiting": [patients[1]["id"], patients[0]["id"]], "consultation": [], "done": []}},
        headers=staff_headers,
    )
    assert reordered.status_code == 200

    forbidden_move = test_client.put(
        "/patients/queue/order",
        json={"columns": {"waiting": [patients[1]["id"]], "consultation": [patients[0]["id"]], "done": []}},
        headers=staff_headers,
    )
    assert forbidden_move.status_code == 400
    assert forbidden_move.json()["detail"] == "Patients can only move through the queue stages in order."


def test_admin_cannot_manage_users_across_organizations(client):
    test_client, _repo = client
    session_a = register_test_clinic(test_client, identifier="owner-users-a@clinic.com", clinic_name="Users Clinic A")
    session_b = register_test_clinic(test_client, identifier="owner-users-b@clinic.com", clinic_name="Users Clinic B")

    create_staff_b = test_client.post(
        "/users/staff",
        json={"identifier": "staff-users-b@clinic.com", "password": "password123!"},
        headers=auth_headers_for_token(session_b["token"]),
    )
    assert create_staff_b.status_code == 201
    foreign_user_id = create_staff_b.json()["id"]

    update_role = test_client.patch(
        f"/users/{foreign_user_id}",
        json={"role": "admin"},
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert update_role.status_code == 404

    upload_signature = test_client.post(
        f"/users/{foreign_user_id}/signature",
        headers=auth_headers_for_token(session_a["token"]),
        files={"file": ("signature.png", signature_png_bytes(), "image/png")},
    )
    assert upload_signature.status_code == 404

    remove_signature = test_client.delete(
        f"/users/{foreign_user_id}/signature",
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert remove_signature.status_code == 404

    download_signature = test_client.get(
        f"/users/{foreign_user_id}/signature/file",
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert download_signature.status_code == 404

    delete_user = test_client.delete(
        f"/users/{foreign_user_id}",
        headers=auth_headers_for_token(session_a["token"]),
    )
    assert delete_user.status_code == 404


def test_foreign_user_signature_upload_does_not_process_image(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session_a = register_test_clinic(test_client, identifier="owner-signature-a@clinic.com", clinic_name="Signature Clinic A")
    session_b = register_test_clinic(test_client, identifier="owner-signature-b@clinic.com", clinic_name="Signature Clinic B")

    create_staff_b = test_client.post(
        "/users/staff",
        json={"identifier": "staff-signature-b@clinic.com", "password": "password123!"},
        headers=auth_headers_for_token(session_b["token"]),
    )
    assert create_staff_b.status_code == 201
    foreign_user_id = create_staff_b.json()["id"]

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("normalize_signature_image should not run for foreign users.")

    monkeypatch.setattr("app.routes.users.normalize_signature_image", fail_if_called)

    upload_signature = test_client.post(
        f"/users/{foreign_user_id}/signature",
        headers=auth_headers_for_token(session_a["token"]),
        files={"file": ("signature.png", signature_png_bytes(), "image/png")},
    )

    assert upload_signature.status_code == 404
