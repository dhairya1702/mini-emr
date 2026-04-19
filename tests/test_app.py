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
from app import main as main_module
from app.main import app
from app.db import DuplicateCheckInCandidateError, get_repository


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
        self.patient_visits: dict[str, dict] = {}
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
        created_at = _now()
        patient = {
            "id": patient_id,
            "org_id": org_id,
            **payload.model_dump(),
            "phone": _normalize_phone(payload.phone),
            "status": "waiting",
            "billed": False,
            "created_at": created_at,
            "last_visit_at": created_at,
        }
        self.patients[patient_id] = patient
        await self._record_patient_visit(org_id, patient_id, payload, source="queue")
        return patient

    async def _record_patient_visit(self, org_id: str, patient_id: str, payload, source: str, appointment_id: str | None = None) -> dict:
        visit_id = str(uuid4())
        visit = {
            "id": visit_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "name": payload.name,
            "phone": _normalize_phone(payload.phone),
            "reason": payload.reason,
            "age": payload.age,
            "weight": payload.weight,
            "height": payload.height,
            "temperature": payload.temperature,
            "source": source,
            "appointment_id": appointment_id,
            "created_at": _now(),
        }
        self.patient_visits[visit_id] = visit
        return visit

    async def list_patient_matches_by_phone(self, org_id: str, phone: str, limit: int = 10) -> list[dict]:
        rows = [
            patient
            for patient in self.patients.values()
            if patient["org_id"] == org_id and patient["phone"] == _normalize_phone(phone)
        ]
        rows.sort(key=lambda patient: patient["last_visit_at"], reverse=True)
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

        if payload.existing_patient_id is None and not payload.force_new:
            matches = await self.list_potential_check_in_matches(org_id, appointment_id)
            if matches:
                raise DuplicateCheckInCandidateError(matches)

        if payload.existing_patient_id is not None:
            patient = self.patients[str(payload.existing_patient_id)]
            patient.update({
                "name": appointment["name"],
                "phone": appointment["phone"],
                "reason": appointment["reason"],
                "age": appointment["age"],
                "weight": appointment["weight"],
                "height": appointment["height"],
                "temperature": appointment["temperature"],
                "status": "waiting",
                "billed": False,
                "last_visit_at": _now(),
            })
        else:
            patient_id = str(uuid4())
            created_at = _now()
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
                "created_at": created_at,
                "last_visit_at": created_at,
            }
            self.patients[patient_id] = patient
        await self._record_patient_visit(
            org_id,
            patient["id"],
            type(
                "VisitPayload",
                (),
                {
                    "name": appointment["name"],
                    "phone": appointment["phone"],
                    "reason": appointment["reason"],
                    "age": appointment["age"],
                    "weight": appointment["weight"],
                    "height": appointment["height"],
                    "temperature": appointment["temperature"],
                },
            )(),
            source="appointment",
            appointment_id=appointment_id,
        )
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
        return sorted(
            [patient for patient in self.patients.values() if patient["org_id"] == org_id],
            key=lambda patient: patient["last_visit_at"],
            reverse=True,
        )

    async def create_patient_visit(self, org_id: str, patient_id: str, payload) -> dict:
        patient = self.patients[patient_id]
        if patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")
        updated_at = _now()
        patient.update(
            {
                "name": payload.name,
                "phone": _normalize_phone(payload.phone),
                "reason": payload.reason,
                "age": payload.age,
                "weight": payload.weight,
                "height": payload.height,
                "temperature": payload.temperature,
                "status": "waiting",
                "billed": False,
                "last_visit_at": updated_at,
            }
        )
        await self._record_patient_visit(org_id, patient_id, payload, source="queue")
        return patient

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

    async def list_patient_visits_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        return [
            visit for visit in self.patient_visits.values()
            if visit["org_id"] == org_id and visit["patient_id"] == patient_id
        ]

    async def list_patient_visits(self, org_id: str) -> list[dict]:
        return [
            visit for visit in self.patient_visits.values()
            if visit["org_id"] == org_id
        ]

    async def create_note(self, org_id: str, payload) -> dict:
        return await self._create_note(
            org_id,
            str(payload.patient_id),
            payload.content,
            version_number=1,
            root_note_id=None,
            amended_from_note_id=None,
        )

    async def _create_note(
        self,
        org_id: str,
        patient_id: str,
        content: str,
        *,
        version_number: int,
        root_note_id: str | None,
        amended_from_note_id: str | None,
    ) -> dict:
        note_id = str(uuid4())
        note = {
            "id": note_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "content": content,
            "status": "draft",
            "version_number": version_number,
            "root_note_id": root_note_id,
            "amended_from_note_id": amended_from_note_id,
            "snapshot_content": None,
            "finalized_at": None,
            "sent_at": None,
            "sent_by": None,
            "sent_to": None,
            "created_at": _now(),
        }
        self.notes[note_id] = note
        return note

    async def update_note_draft(self, org_id: str, note_id: str, content: str) -> dict:
        note = await self.get_note(org_id, note_id)
        if note["status"] != "draft":
            raise ValueError("Only draft notes can be updated.")
        note["content"] = content
        return note

    async def get_note(self, org_id: str, note_id: str) -> dict:
        note = self.notes[note_id]
        if note["org_id"] != org_id:
            raise ValueError("Note not found for this organization.")
        return note

    async def finalize_note(self, org_id: str, note_id: str) -> dict:
        note = await self.get_note(org_id, note_id)
        if note["status"] == "sent":
            raise ValueError("Sent notes cannot be changed.")
        if note["status"] == "final" and note["snapshot_content"]:
            return note
        note["status"] = "final"
        note["snapshot_content"] = note["content"]
        note["finalized_at"] = _now()
        return note

    async def create_note_amendment(self, org_id: str, note_id: str, content: str) -> dict:
        note = await self.get_note(org_id, note_id)
        related = [
            entry for entry in self.notes.values()
            if entry["org_id"] == org_id
            and entry["patient_id"] == note["patient_id"]
            and str(entry.get("root_note_id") or entry["id"]) == str(note.get("root_note_id") or note["id"])
        ]
        next_version = max(int(entry.get("version_number") or 1) for entry in related) + 1
        return await self._create_note(
            org_id,
            note["patient_id"],
            content,
            version_number=next_version,
            root_note_id=str(note.get("root_note_id") or note["id"]),
            amended_from_note_id=note_id,
        )

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        return [
            note for note in self.notes.values()
            if note["org_id"] == org_id and note["patient_id"] == patient_id
        ]

    async def mark_note_sent(self, org_id: str, note_id: str, *, sent_by: str, sent_to: str) -> dict:
        note = await self.get_note(org_id, note_id)
        if note["status"] == "draft":
            raise ValueError("Finalize the note before sending it.")
        if note["sent_at"] is None:
            note["status"] = "sent"
            note["snapshot_content"] = note["snapshot_content"] or note["content"]
            note["sent_at"] = _now()
            note["sent_by"] = sent_by
            note["sent_to"] = sent_to
        return note

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
        if payload.payment_status == "paid":
            amount_paid = subtotal
        elif payload.payment_status == "unpaid":
            amount_paid = 0
        else:
            amount_paid = round(float(payload.amount_paid or 0), 2)
            if amount_paid <= 0 or amount_paid >= subtotal:
                raise ValueError("Partial invoice amount must be less than the invoice total.")
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
            "amount_paid": amount_paid,
            "balance_due": round(max(subtotal - amount_paid, 0), 2),
            "paid_at": _now() if payload.payment_status == "paid" else None,
            "completed_at": None,
            "completed_by": None,
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

    async def list_invoices(self, org_id: str) -> list[dict]:
        return [
            invoice for invoice in self.invoices.values()
            if invoice["org_id"] == org_id
        ]

    async def finalize_invoice(self, org_id: str, invoice_id: str, *, completed_by: str) -> dict:
        invoice = self.invoices[invoice_id]
        if invoice["org_id"] != org_id:
            raise ValueError("Invoice not found for this organization.")
        if invoice["sent_at"] is not None:
            return {
                "patient_id": invoice["patient_id"],
                "completed_at": invoice["completed_at"],
                "completed_by": invoice["completed_by"],
                "sent_at": invoice["sent_at"],
                "already_finalized": True,
            }

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
        invoice["completed_at"] = invoice["completed_at"] or _now()
        invoice["completed_by"] = invoice["completed_by"] or completed_by
        invoice["sent_at"] = _now()
        return {
            "patient_id": invoice["patient_id"],
            "completed_at": invoice["completed_at"],
            "completed_by": invoice["completed_by"],
            "sent_at": invoice["sent_at"],
            "already_finalized": False,
            "stock_deductions": [
                {
                    "catalog_item_id": item_id,
                    "item_name": self.catalog_items[item_id]["name"],
                    "quantity": quantity,
                }
                for item_id, quantity in required_by_item.items()
            ],
        }

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
    main_module.RATE_LIMIT_BUCKETS.clear()
    main_module.RATE_LIMIT_WINDOWS.update({
        "auth_login": (5, 60.0),
        "auth_register": (3, 300.0),
        "note_generation": (20, 300.0),
    })
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


def test_auth_me_reissues_session_headers(client):
    test_client, _repo = client
    session = register(test_client, identifier="session@clinic.com", clinic_name="Session Clinic")
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == session["token"]

    response = test_client.get("/auth/me", headers=auth_headers(session["token"]))
    assert response.status_code == 200
    refreshed_token = response.headers.get("x-session-token")
    refreshed_expiry = response.headers.get("x-session-expires-at")
    assert refreshed_token
    assert refreshed_expiry

    payload = auth_module.decode_access_token(refreshed_token)
    assert payload["sub"] == response.json()["id"]
    assert int(refreshed_expiry) == payload["exp"]
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) == refreshed_token


def test_auth_cookie_session_and_logout(client):
    test_client, _repo = client
    register(test_client, identifier="cookie@clinic.com", clinic_name="Cookie Clinic")

    cookie_response = test_client.get("/auth/me")
    assert cookie_response.status_code == 200
    assert cookie_response.json()["identifier"] == "cookie@clinic.com"

    logout_response = test_client.post("/auth/logout")
    assert logout_response.status_code == 204
    assert test_client.cookies.get(auth_module.SESSION_COOKIE_NAME) is None

    after_logout = test_client.get("/auth/me")
    assert after_logout.status_code == 401


def test_access_token_requires_explicit_auth_secret(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        auth_module,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="", supabase_service_role_key="service-role-key"),
    )

    with pytest.raises(RuntimeError, match="AUTH_SECRET must be configured."):
        auth_module.create_access_token(
            {
                "id": str(uuid4()),
                "org_id": str(uuid4()),
                "identifier": "owner@clinic.com",
                "role": "admin",
            }
        )


def test_login_rate_limit_returns_429(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    register(test_client, identifier="ratelimit-login@clinic.com", clinic_name="Rate Limit Clinic")
    monkeypatch.setitem(main_module.RATE_LIMIT_WINDOWS, "auth_login", (1, 60.0))
    main_module.RATE_LIMIT_BUCKETS.clear()

    first = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "password123"},
    )
    assert first.status_code == 200

    second = test_client.post(
        "/auth/login",
        json={"identifier": "ratelimit-login@clinic.com", "password": "password123"},
    )
    assert second.status_code == 429


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


def test_sent_consultation_note_is_locked_to_saved_record(client):
    test_client, repo = client
    session = register(test_client, identifier="notes-lock@clinic.com", clinic_name="Notes Lock Clinic")
    headers = auth_headers(session["token"])

    patient = test_client.post(
        "/patients",
        json={
            "name": "Note Patient",
            "phone": "5550102424",
            "reason": "Consultation",
            "age": 29,
            "weight": 61,
            "height": 166,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    generated = test_client.post(
        "/generate-note",
        json={
            "patient_id": patient["id"],
            "symptoms": "Headache",
            "diagnosis": "Migraine",
            "medications": "Paracetamol",
            "notes": "Hydrate well.",
        },
        headers=headers,
    )
    assert generated.status_code == 200
    note_id = generated.json()["note_id"]
    assert note_id
    assert generated.json()["status"] == "draft"
    assert repo.notes[note_id]["status"] == "draft"
    assert repo.notes[note_id]["sent_at"] is None

    not_finalized = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "phone": patient["phone"]},
        headers=headers,
    )
    assert not_finalized.status_code == 400
    assert "Finalize the note" in not_finalized.text

    finalized = test_client.post(
        "/notes/finalize",
        json={"note_id": note_id},
        headers=headers,
    )
    assert finalized.status_code == 200
    assert finalized.json()["status"] == "final"
    assert finalized.json()["snapshot_content"]

    sent = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "phone": patient["phone"]},
        headers=headers,
    )
    assert sent.status_code == 200
    first_sent_at = repo.notes[note_id]["sent_at"]
    assert first_sent_at is not None
    assert repo.notes[note_id]["status"] == "sent"
    assert repo.notes[note_id]["snapshot_content"]

    resent = test_client.post(
        "/send-note",
        json={"note_id": note_id, "patient_id": patient["id"], "phone": patient["phone"]},
        headers=headers,
    )
    assert resent.status_code == 200
    assert repo.notes[note_id]["sent_at"] == first_sent_at

    notes = test_client.get(f"/patients/{patient['id']}/notes", headers=headers)
    assert notes.status_code == 200
    assert notes.json()[0]["sent_at"] is not None
    assert notes.json()[0]["status"] == "sent"


def test_note_generation_rate_limit_returns_429(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register(test_client, identifier="ratelimit-note@clinic.com", clinic_name="Rate Limit Note Clinic")
    headers = auth_headers(session["token"])
    patient = test_client.post(
        "/patients",
        json={
            "name": "Rate Limit Patient",
            "phone": "5550102525",
            "reason": "Review",
            "age": 31,
            "weight": 64,
            "height": 167,
            "temperature": 98.5,
        },
        headers=headers,
    ).json()

    monkeypatch.setitem(main_module.RATE_LIMIT_WINDOWS, "note_generation", (1, 60.0))
    main_module.RATE_LIMIT_BUCKETS.clear()

    first = test_client.post(
        "/generate-note",
        json={"patient_id": patient["id"], "symptoms": "Cough", "diagnosis": "Cold", "medications": "Rest", "notes": "Observe"},
        headers=headers,
    )
    assert first.status_code == 200

    second = test_client.post(
        "/generate-note",
        json={"patient_id": patient["id"], "symptoms": "Cough", "diagnosis": "Cold", "medications": "Rest", "notes": "Observe"},
        headers=headers,
    )
    assert second.status_code == 429


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
        json={"invoice_id": invoice["id"], "recipient": patient["phone"]},
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
        json={"note_id": note["note_id"], "patient_id": patient["id"], "phone": patient["phone"]},
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
    assert "patient_visit_recorded" not in actions
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
    assert "visit_recorded" in event_types
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


def test_appointment_check_in_requires_explicit_choice_when_phone_has_active_matches(client):
    test_client, _repo = client
    session = register(test_client, identifier="appointments-duplicate-choice@clinic.com", clinic_name="Appointments Duplicate Choice Clinic")
    headers = auth_headers(session["token"])

    existing = test_client.post(
        "/patients",
        json={
            "name": "Existing Queue Patient",
            "phone": "5550191919",
            "reason": "Already waiting",
            "age": 36,
            "weight": 70,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Booked Patient",
            "phone": "5550191919",
            "reason": "Repeat visit",
            "scheduled_for": "2026-04-18T11:30:00+00:00",
        },
        headers=headers,
    ).json()

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        headers=headers,
    )
    assert check_in.status_code == 409
    detail = check_in.json()["detail"]
    assert detail["message"] == "Possible duplicate active patients found."
    assert len(detail["matches"]) == 1
    assert detail["matches"][0]["id"] == existing["id"]

    updated_appointments = test_client.get("/appointments", headers=headers)
    assert updated_appointments.status_code == 200
    assert updated_appointments.json()[0]["status"] == "scheduled"
    assert updated_appointments.json()[0]["checked_in_patient_id"] is None

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    assert len(patients.json()) == 1


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

    created_names: list[str] = []
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
        created_names.append(created.json()["name"])

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


def test_appointment_check_in_can_force_new_patient_with_existing_phone(client):
    test_client, _repo = client
    session = register(test_client, identifier="appointments-force-new@clinic.com", clinic_name="Appointments Force New Clinic")
    headers = auth_headers(session["token"])

    existing = test_client.post(
        "/patients",
        json={
            "name": "Parent Patient",
            "phone": "5550121212",
            "reason": "Already waiting",
            "age": 39,
            "weight": 69,
            "temperature": 98.5,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Child Patient",
            "phone": "5550121212",
            "reason": "New consult",
            "age": 11,
            "weight": 34,
            "temperature": 98.7,
            "scheduled_for": "2026-04-18T09:30:00+00:00",
        },
        headers=headers,
    ).json()

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        json={"force_new": True},
        headers=headers,
    )
    assert check_in.status_code == 200
    created = check_in.json()
    assert created["id"] != existing["id"]
    assert created["name"] == "Child Patient"
    assert created["phone"] == existing["phone"]

    patients = test_client.get("/patients", headers=headers)
    assert patients.status_code == 200
    matches = [patient for patient in patients.json() if patient["phone"] == "5550121212"]
    assert len(matches) == 2
    assert {patient["name"] for patient in matches} == {"Parent Patient", "Child Patient"}


def test_patient_lookup_returns_family_cluster_after_reusing_and_adding_under_same_phone(client):
    test_client, _repo = client
    session = register(test_client, identifier="patients-family@clinic.com", clinic_name="Patients Family Clinic")
    headers = auth_headers(session["token"])

    parent = test_client.post(
        "/patients",
        json={
            "name": "Parent Patient",
            "phone": "5550131313",
            "reason": "Consultation",
            "age": 42,
            "weight": 71,
            "temperature": 98.6,
        },
        headers=headers,
    ).json()

    sibling = test_client.post(
        "/patients",
        json={
            "name": "Sibling Patient",
            "phone": "5550131313",
            "reason": "Review",
            "age": 14,
            "weight": 41,
            "temperature": 98.4,
        },
        headers=headers,
    ).json()

    appointment = test_client.post(
        "/appointments",
        json={
            "name": "Youngest Patient",
            "phone": "5550131313",
            "reason": "Fresh visit",
            "age": 8,
            "weight": 28,
            "temperature": 99.0,
            "scheduled_for": "2026-04-18T10:30:00+00:00",
        },
        headers=headers,
    ).json()

    preview = test_client.get(
        f"/appointments/{appointment['id']}/check-in-preview",
        headers=headers,
    )
    assert preview.status_code == 200
    preview_ids = {match["id"] for match in preview.json()}
    assert preview_ids == {parent["id"], sibling["id"]}

    check_in = test_client.post(
        f"/appointments/{appointment['id']}/check-in",
        json={"force_new": True},
        headers=headers,
    )
    assert check_in.status_code == 200

    lookup = test_client.get(
        "/patients/lookup",
        params={"phone": "5550131313"},
        headers=headers,
    )
    assert lookup.status_code == 200
    matches = lookup.json()
    assert len(matches) == 3
    assert {match["name"] for match in matches} == {
        "Parent Patient",
        "Sibling Patient",
        "Youngest Patient",
    }


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
