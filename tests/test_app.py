from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

reportlab_module = ModuleType("reportlab")
reportlab_lib_module = ModuleType("reportlab.lib")
reportlab_colors_module = ModuleType("reportlab.lib.colors")
reportlab_colors_module.HexColor = lambda value: value
reportlab_pagesizes_module = ModuleType("reportlab.lib.pagesizes")
reportlab_pagesizes_module.A4 = (595, 842)
reportlab_units_module = ModuleType("reportlab.lib.units")
reportlab_units_module.inch = 72
reportlab_pdfbase_module = ModuleType("reportlab.pdfbase")
reportlab_pdfmetrics_module = ModuleType("reportlab.pdfbase.pdfmetrics")
reportlab_pdfmetrics_module.stringWidth = lambda text, *_args: float(len(text) * 6)


class _DummyCanvas:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def setTitle(self, *_args, **_kwargs) -> None:
        pass

    def setFillColor(self, *_args, **_kwargs) -> None:
        pass

    def setFont(self, *_args, **_kwargs) -> None:
        pass

    def drawString(self, *_args, **_kwargs) -> None:
        pass

    def drawRightString(self, *_args, **_kwargs) -> None:
        pass

    def line(self, *_args, **_kwargs) -> None:
        pass

    def roundRect(self, *_args, **_kwargs) -> None:
        pass

    def showPage(self) -> None:
        pass

    def save(self) -> None:
        pass


reportlab_pdfgen_module = ModuleType("reportlab.pdfgen")
reportlab_canvas_module = ModuleType("reportlab.pdfgen.canvas")
reportlab_canvas_module.Canvas = _DummyCanvas
reportlab_pdfgen_module.canvas = reportlab_canvas_module

sys.modules.setdefault("reportlab", reportlab_module)
sys.modules.setdefault("reportlab.lib", reportlab_lib_module)
sys.modules.setdefault("reportlab.lib.colors", reportlab_colors_module)
sys.modules.setdefault("reportlab.lib.pagesizes", reportlab_pagesizes_module)
sys.modules.setdefault("reportlab.lib.units", reportlab_units_module)
sys.modules.setdefault("reportlab.pdfbase", reportlab_pdfbase_module)
sys.modules.setdefault("reportlab.pdfbase.pdfmetrics", reportlab_pdfmetrics_module)
sys.modules.setdefault("reportlab.pdfgen", reportlab_pdfgen_module)
sys.modules.setdefault("reportlab.pdfgen.canvas", reportlab_canvas_module)

from app import auth as auth_module
from app.main import app
from app.db import get_repository


def _now() -> datetime:
    return datetime.now(UTC)


def _normalize_phone(phone: str) -> str:
    digits = "".join(char for char in phone if char.isdigit())
    return f"+{digits}" if phone.startswith("+") and digits else digits


class FakeRepo:
    def __init__(self) -> None:
        self.organizations: dict[str, dict] = {}
        self.clinic_settings: dict[str, dict] = {}
        self.users: dict[str, dict] = {}
        self.patients: dict[str, dict] = {}
        self.notes: dict[str, dict] = {}
        self.catalog_items: dict[str, dict] = {}
        self.invoices: dict[str, dict] = {}
        self.invoice_items: dict[str, dict] = {}
        self.follow_ups: dict[str, dict] = {}
        self.appointments: dict[str, dict] = {}
        self.audit_events: dict[str, dict] = {}

    async def create_organization(self, clinic_name: str) -> dict:
        org_id = str(uuid4())
        organization = {"id": org_id, "name": clinic_name.strip(), "created_at": _now()}
        self.organizations[org_id] = organization
        return organization

    async def create_audit_event(
        self,
        org_id: str,
        actor_user_id: str | None,
        actor_name: str,
        entity_type: str,
        entity_id: str,
        action: str,
        summary: str,
        metadata: dict | None = None,
    ) -> dict:
        audit_id = str(uuid4())
        row = {
            "id": audit_id,
            "org_id": org_id,
            "actor_user_id": actor_user_id,
            "actor_name": actor_name,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "action": action,
            "summary": summary,
            "metadata": metadata or {},
            "created_at": _now(),
        }
        self.audit_events[audit_id] = row
        return row

    async def list_audit_events(self, org_id: str, limit: int = 100) -> list[dict]:
        rows = [
            row for row in self.audit_events.values()
            if row["org_id"] == org_id
        ]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows[:limit]

    async def create_clinic_settings(self, org_id: str, payload) -> dict:
        settings_id = str(uuid4())
        row = {
            "id": settings_id,
            "org_id": org_id,
            **payload.model_dump(),
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def get_clinic_settings(self, org_id: str) -> dict:
        return self.clinic_settings.get(org_id, {})

    async def upsert_clinic_settings(self, org_id: str, payload) -> dict:
        current = self.clinic_settings.get(org_id)
        row = {
            "id": current["id"] if current else str(uuid4()),
            "org_id": org_id,
            **payload.model_dump(),
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def create_user(self, org_id: str, identifier: str, password_hash: str, role: str) -> dict:
        user_id = str(uuid4())
        user = {
            "id": user_id,
            "org_id": org_id,
            "identifier": identifier,
            "name": identifier.split("@", 1)[0].title() if "@" in identifier else identifier,
            "password_hash": password_hash,
            "role": role,
            "created_at": _now(),
        }
        self.users[user_id] = user
        return user

    async def get_user_by_identifier(self, identifier: str) -> dict | None:
        for user in self.users.values():
            if user["identifier"] == identifier:
                return dict(user)
        return None

    async def get_user(self, user_id: str) -> dict:
        user = self.users[user_id]
        return {
            "id": user["id"],
            "org_id": user["org_id"],
            "identifier": user["identifier"],
            "name": user["name"],
            "role": user["role"],
            "created_at": user["created_at"],
        }

    async def list_users(self, org_id: str) -> list[dict]:
        return [
            {
                "id": user["id"],
                "org_id": user["org_id"],
                "identifier": user["identifier"],
                "name": user["name"],
                "role": user["role"],
                "created_at": user["created_at"],
            }
            for user in self.users.values()
            if user["org_id"] == org_id
        ]

    async def create_patient(self, org_id: str, payload) -> dict:
        patient_id = str(uuid4())
        patient = {
            "id": patient_id,
            "org_id": org_id,
            **payload.model_dump(),
            "phone": _normalize_phone(payload.phone),
            "status": "waiting",
            "billed": False,
            "created_at": _now(),
        }
        self.patients[patient_id] = patient
        return patient

    async def list_patient_matches_by_phone(self, org_id: str, phone: str, limit: int = 10) -> list[dict]:
        rows = [
            patient
            for patient in self.patients.values()
            if patient["org_id"] == org_id and patient["phone"] == _normalize_phone(phone)
        ]
        rows.sort(key=lambda patient: patient["created_at"], reverse=True)
        return rows[:limit]

    async def create_appointment(self, org_id: str, payload) -> dict:
        appointment_id = str(uuid4())
        appointment = {
            "id": appointment_id,
            "org_id": org_id,
            **payload.model_dump(),
            "phone": _normalize_phone(payload.phone),
            "status": "scheduled",
            "checked_in_patient_id": None,
            "checked_in_at": None,
            "created_at": _now(),
        }
        self.appointments[appointment_id] = appointment
        return appointment

    async def list_appointments(self, org_id: str, status: str | None = None, query: str | None = None, limit: int = 200) -> list[dict]:
        rows = [
            appointment for appointment in self.appointments.values()
            if appointment["org_id"] == org_id and (status is None or appointment["status"] == status)
        ]
        normalized_query = (query or "").strip().lower()
        if normalized_query:
            rows = [
                appointment for appointment in rows
                if normalized_query in appointment["name"].lower()
                or normalized_query in appointment["phone"].lower()
                or normalized_query in appointment["reason"].lower()
            ]
        return rows[:limit]

    async def list_appointments_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        return [
            appointment for appointment in self.appointments.values()
            if appointment["org_id"] == org_id and appointment["checked_in_patient_id"] == patient_id
        ]

    async def list_potential_check_in_matches(self, org_id: str, appointment_id: str) -> list[dict]:
        appointment = self.appointments[appointment_id]
        return [
            patient
            for patient in self.patients.values()
            if patient["org_id"] == org_id and not patient["billed"] and patient["phone"] == appointment["phone"]
        ]

    async def check_in_appointment(self, org_id: str, appointment_id: str, payload) -> tuple[dict, dict]:
        appointment = self.appointments[appointment_id]
        if appointment["org_id"] != org_id:
            raise ValueError("Appointment not found for this organization.")
        if appointment["status"] != "scheduled":
            raise ValueError("Only scheduled appointments can be added to the waiting queue.")

        if payload.existing_patient_id is not None:
            patient = self.patients[str(payload.existing_patient_id)]
        else:
            patient_id = str(uuid4())
            patient = {
                "id": patient_id,
                "org_id": org_id,
                "name": appointment["name"],
                "phone": appointment["phone"],
                "reason": appointment["reason"],
                "age": appointment["age"],
                "weight": appointment["weight"],
                "height": appointment["height"],
                "temperature": appointment["temperature"],
                "status": "waiting",
                "billed": False,
                "created_at": _now(),
            }
            self.patients[patient_id] = patient
        appointment["status"] = "checked_in"
        appointment["checked_in_patient_id"] = patient["id"]
        appointment["checked_in_at"] = _now()
        return appointment, patient

    async def update_appointment(self, org_id: str, appointment_id: str, payload) -> dict:
        appointment = self.appointments[appointment_id]
        if appointment["org_id"] != org_id:
            raise ValueError("Appointment not found for this organization.")
        if appointment["status"] == "checked_in":
            raise ValueError("Checked-in appointments cannot be edited.")

        updates = payload.model_dump(exclude_none=True)
        if not updates:
            raise ValueError("No appointment updates provided.")
        if "scheduled_for" in updates:
            if appointment["status"] != "scheduled":
                raise ValueError("Only scheduled appointments can be rescheduled.")
            appointment["scheduled_for"] = updates["scheduled_for"]
        if "status" in updates:
            if updates["status"] == "checked_in":
                raise ValueError("Use check-in to move appointments into the queue.")
            if updates["status"] == "cancelled" and appointment["status"] != "scheduled":
                raise ValueError("Only scheduled appointments can be cancelled.")
            appointment["status"] = updates["status"]
        return appointment

    async def list_patients(self, org_id: str) -> list[dict]:
        return [patient for patient in self.patients.values() if patient["org_id"] == org_id]

    async def update_patient(self, org_id: str, patient_id: str, payload: dict) -> dict:
        patient = self.patients[patient_id]
        if patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")
        updates = dict(payload)
        if "phone" in updates and updates["phone"] is not None:
            updates["phone"] = _normalize_phone(updates["phone"])
        patient.update(updates)
        return patient

    async def get_patient(self, org_id: str, patient_id: str) -> dict:
        patient = self.patients[patient_id]
        if patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")
        return patient

    async def create_note(self, org_id: str, payload) -> dict:
        note_id = str(uuid4())
        note = {
            "id": note_id,
            "org_id": org_id,
            "patient_id": str(payload.patient_id),
            "content": payload.content,
            "created_at": _now(),
        }
        self.notes[note_id] = note
        return note

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        return [
            note for note in self.notes.values()
            if note["org_id"] == org_id and note["patient_id"] == patient_id
        ]

    async def create_catalog_item(self, org_id: str, payload) -> dict:
        item_id = str(uuid4())
        item = {
            "id": item_id,
            "org_id": org_id,
            **payload.model_dump(),
            "created_at": _now(),
        }
        self.catalog_items[item_id] = item
        return item

    async def list_catalog_items(self, org_id: str) -> list[dict]:
        return [item for item in self.catalog_items.values() if item["org_id"] == org_id]

    async def update_catalog_stock(self, org_id: str, item_id: str, payload) -> dict:
        item = self.catalog_items[item_id]
        if item["org_id"] != org_id:
            raise ValueError("Inventory item not found for this organization.")
        next_quantity = item["stock_quantity"] + payload.delta
        if next_quantity < 0:
            raise ValueError("Stock cannot go below zero.")
        item["stock_quantity"] = next_quantity
        return item

    async def delete_catalog_item(self, org_id: str, item_id: str) -> None:
        item = self.catalog_items[item_id]
        if item["org_id"] != org_id:
            raise ValueError("Inventory item not found for this organization.")
        self.catalog_items.pop(item_id, None)

    async def create_invoice(self, org_id: str, payload) -> dict:
        patient = self.patients.get(str(payload.patient_id))
        if not patient or patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")

        subtotal = round(sum(item.quantity * item.unit_price for item in payload.items), 2)
        invoice_id = str(uuid4())
        items = []
        for raw_item in payload.items:
            if raw_item.catalog_item_id:
                catalog_item = self.catalog_items.get(str(raw_item.catalog_item_id))
                if not catalog_item or catalog_item["org_id"] != org_id:
                    raise ValueError("Inventory item not found for this organization.")
            invoice_item = {
                "id": str(uuid4()),
                "catalog_item_id": str(raw_item.catalog_item_id) if raw_item.catalog_item_id else None,
                "item_type": raw_item.item_type,
                "label": raw_item.label,
                "quantity": raw_item.quantity,
                "unit_price": raw_item.unit_price,
                "line_total": round(raw_item.quantity * raw_item.unit_price, 2),
            }
            self.invoice_items[invoice_item["id"]] = invoice_item | {"invoice_id": invoice_id}
            items.append(invoice_item)

        invoice = {
            "id": invoice_id,
            "org_id": org_id,
            "patient_id": str(payload.patient_id),
            "subtotal": subtotal,
            "total": subtotal,
            "payment_status": payload.payment_status,
            "paid_at": _now() if payload.payment_status == "paid" else None,
            "sent_at": None,
            "created_at": _now(),
            "items": items,
        }
        self.invoices[invoice_id] = invoice
        return invoice

    async def get_invoice(self, org_id: str, invoice_id: str) -> dict:
        invoice = self.invoices[invoice_id]
        if invoice["org_id"] != org_id:
            raise ValueError("Invoice not found for this organization.")
        return invoice

    async def list_invoices_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        return [
            invoice for invoice in self.invoices.values()
            if invoice["org_id"] == org_id and invoice["patient_id"] == patient_id
        ]

    async def finalize_invoice(self, org_id: str, invoice_id: str) -> str:
        invoice = self.invoices[invoice_id]
        if invoice["org_id"] != org_id:
            raise ValueError("Invoice not found for this organization.")
        if invoice["sent_at"] is not None:
            return invoice["patient_id"]

        required_by_item: dict[str, float] = {}
        for item in invoice["items"]:
            catalog_item_id = item.get("catalog_item_id")
            if not catalog_item_id:
                continue
            catalog_item = self.catalog_items[catalog_item_id]
            if catalog_item["org_id"] != org_id:
                raise ValueError("Inventory item not found for this organization.")
            if catalog_item["track_inventory"]:
                required_by_item[catalog_item_id] = required_by_item.get(catalog_item_id, 0) + item["quantity"]

        for item_id, quantity in required_by_item.items():
            catalog_item = self.catalog_items[item_id]
            if catalog_item["stock_quantity"] < quantity:
                raise ValueError(f"Insufficient stock for {catalog_item['name']}.")

        for item_id, quantity in required_by_item.items():
            self.catalog_items[item_id]["stock_quantity"] -= quantity

        self.patients[invoice["patient_id"]]["billed"] = True
        invoice["sent_at"] = _now()
        return invoice["patient_id"]

    async def create_follow_up(self, org_id: str, patient_id: str, created_by: str, payload) -> dict:
        patient = self.patients.get(patient_id)
        if not patient or patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")
        follow_up_id = str(uuid4())
        row = {
            "id": follow_up_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "created_by": created_by,
            "scheduled_for": payload.scheduled_for,
            "notes": payload.notes,
            "status": "scheduled",
            "completed_at": None,
            "created_at": _now(),
        }
        self.follow_ups[follow_up_id] = row
        return row

    async def list_follow_ups(self, org_id: str, status: str | None = None, query: str | None = None, limit: int = 200) -> list[dict]:
        rows = []
        normalized_query = (query or "").strip().lower()
        for follow_up in self.follow_ups.values():
            if follow_up["org_id"] != org_id:
                continue
            if status is not None and follow_up["status"] != status:
                continue
            patient = self.patients.get(follow_up["patient_id"])
            patient_name = patient["name"] if patient else ""
            if normalized_query and normalized_query not in patient_name.lower() and normalized_query not in follow_up["notes"].lower():
                continue
            rows.append({**follow_up, "patient_name": patient_name})
        return rows[:limit]

    async def list_follow_ups_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        return [
            follow_up for follow_up in self.follow_ups.values()
            if follow_up["org_id"] == org_id and follow_up["patient_id"] == patient_id
        ]

    async def update_follow_up(self, org_id: str, follow_up_id: str, payload) -> dict:
        follow_up = self.follow_ups[follow_up_id]
        if follow_up["org_id"] != org_id:
            raise ValueError("Follow-up not found for this organization.")
        updates = payload.model_dump(exclude_none=True)
        if not updates:
            raise ValueError("No follow-up updates provided.")
        if "status" in updates:
            follow_up["status"] = updates["status"]
            follow_up["completed_at"] = _now() if updates["status"] == "completed" else None
        if "scheduled_for" in updates:
            follow_up["scheduled_for"] = updates["scheduled_for"]
        if "notes" in updates:
            follow_up["notes"] = updates["notes"]
        return follow_up


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    repo = FakeRepo()
    auth_module.get_settings.cache_clear()
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="test-secret", supabase_service_role_key=""),
    )
    app.dependency_overrides[get_repository] = lambda: repo
    with TestClient(app) as test_client:
        yield test_client, repo
    app.dependency_overrides.clear()


def register(client: TestClient, *, identifier: str, clinic_name: str) -> dict:
    response = client.post(
        "/auth/register",
        json={
            "identifier": identifier,
            "password": "password123",
            "clinic_name": clinic_name,
            "clinic_address": "123 Main Street",
            "clinic_phone": "5550100000",
            "doctor_name": "Dr Test",
        },
    )
    assert response.status_code == 201
    return response.json()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


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

    second_send = test_client.post(
        "/send-invoice",
        json={"invoice_id": invoice["id"], "recipient": patient["phone"]},
        headers=auth_headers(session["token"]),
    )
    assert second_send.status_code == 200
    assert repo.catalog_items[item["id"]]["stock_quantity"] == 7


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

    invoices = test_client.get("/invoices", headers=staff_headers)
    assert invoices.status_code == 403
    assert "Admin access required" in invoices.text

    start_consultation = test_client.patch(
        f"/patients/{patient['id']}",
        json={"status": "consultation"},
        headers=staff_headers,
    )
    assert start_consultation.status_code == 403
    assert "Admin access required to start consultation" in start_consultation.text


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
    import asyncio
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
    assert "consultation_note" in event_types
    assert "invoice_created" in event_types
    assert "bill_sent" in event_types


def test_follow_up_can_be_created_listed_and_added_to_timeline(client):
    test_client, _repo = client
    session = register(test_client, identifier="followup@clinic.com", clinic_name="Follow Up Clinic")

    patient = test_client.post(
        "/patients",
        json={
            "name": "Follow Up Patient",
            "phone": "5550106060",
            "reason": "Review",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.5,
        },
        headers=auth_headers(session["token"]),
    ).json()

    create_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": "2026-04-10T10:30:00+00:00",
            "notes": "Review symptoms and blood pressure",
        },
        headers=auth_headers(session["token"]),
    )
    assert create_follow_up.status_code == 201
    follow_up = create_follow_up.json()
    assert follow_up["status"] == "scheduled"
    assert follow_up["notes"] == "Review symptoms and blood pressure"

    list_follow_ups = test_client.get(
        "/follow-ups",
        headers=auth_headers(session["token"]),
    )
    assert list_follow_ups.status_code == 200
    assert len(list_follow_ups.json()) == 1

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers(session["token"]),
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert "follow_up_scheduled" in event_types


def test_audit_events_list_tracks_core_changes(client):
    test_client, _repo = client
    session = register(test_client, identifier="audit@clinic.com", clinic_name="Audit Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Audit Patient",
            "phone": "5550107777",
            "reason": "Review",
            "age": 30,
            "weight": 64,
            "height": 170,
            "temperature": 98.9,
        },
        headers=headers,
    ).json()

    update_patient = test_client.patch(
        f"/patients/{patient['id']}",
        json={"reason": "Updated review"},
        headers=headers,
    )
    assert update_patient.status_code == 200

    create_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={"scheduled_for": "2026-04-10T10:30:00+00:00", "notes": "Audit trail check"},
        headers=headers,
    )
    assert create_follow_up.status_code == 201

    audit_events = test_client.get("/audit-events", headers=headers)
    assert audit_events.status_code == 200
    actions = [event["action"] for event in audit_events.json()]
    assert "patient_created" in actions
    assert "patient_updated" in actions
    assert "follow_up_created" in actions


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


def test_follow_up_can_be_rescheduled_completed_and_cancelled(client):
    test_client, _repo = client
    session = register(test_client, identifier="followup-manage@clinic.com", clinic_name="Follow Up Manage Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Follow Up Patient",
            "phone": "5550109090",
            "reason": "Review",
            "age": 33,
            "weight": 70,
            "height": 170,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": "2026-04-15T09:00:00+00:00",
            "notes": "Initial review",
        },
        headers=headers,
    ).json()

    rescheduled = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={
            "scheduled_for": "2026-04-16T10:15:00+00:00",
            "notes": "Updated review",
        },
        headers=headers,
    )
    assert rescheduled.status_code == 200
    assert rescheduled.json()["notes"] == "Updated review"

    completed = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={"status": "completed"},
        headers=headers,
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None

    cancelled = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={"status": "cancelled"},
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_patient_timeline_includes_follow_up_completion_event(client):
    test_client, _repo = client
    session = register(test_client, identifier="followup-timeline@clinic.com", clinic_name="Follow Up Timeline Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Follow Up Timeline Patient",
            "phone": "5550109191",
            "reason": "Review",
            "age": 34,
            "weight": 68,
            "height": 171,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        json={
            "scheduled_for": "2026-04-18T09:30:00+00:00",
            "notes": "Review progress",
        },
        headers=headers,
    ).json()

    complete_follow_up = test_client.patch(
        f"/follow-ups/{follow_up['id']}",
        json={"status": "completed"},
        headers=headers,
    )
    assert complete_follow_up.status_code == 200

    timeline = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=headers,
    )
    assert timeline.status_code == 200
    event_types = [event["type"] for event in timeline.json()]
    assert "follow_up_scheduled" in event_types
    assert "follow_up_completed" in event_types
