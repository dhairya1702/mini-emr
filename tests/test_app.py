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
reportlab_utils_module = ModuleType("reportlab.lib.utils")
reportlab_utils_module.ImageReader = lambda source: source
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

    def setStrokeColor(self, *_args, **_kwargs) -> None:
        pass

    def drawImage(self, *_args, **_kwargs) -> None:
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
sys.modules.setdefault("reportlab.lib.utils", reportlab_utils_module)
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
            "document_template_content_type": None,
            "document_template_data_base64": None,
            **payload.model_dump(exclude_unset=True),
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
            **(current or {"document_template_content_type": None, "document_template_data_base64": None}),
            **payload.model_dump(exclude_unset=True),
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def set_clinic_document_template(self, org_id: str, *, filename: str, content_type: str, data_base64: str) -> dict:
        current = self.clinic_settings.get(org_id, {})
        row = {
            "id": current.get("id", str(uuid4())),
            "org_id": org_id,
            **current,
            "document_template_name": filename,
            "document_template_url": "/settings/clinic/document-template/file",
            "document_template_content_type": content_type,
            "document_template_data_base64": data_base64,
            "document_template_notes_enabled": True,
            "document_template_letters_enabled": True,
            "document_template_invoices_enabled": True,
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def clear_clinic_document_template(self, org_id: str) -> dict:
        current = self.clinic_settings.get(org_id, {})
        row = {
            "id": current.get("id", str(uuid4())),
            "org_id": org_id,
            **current,
            "document_template_name": None,
            "document_template_url": None,
            "document_template_content_type": None,
            "document_template_data_base64": None,
            "document_template_notes_enabled": False,
            "document_template_letters_enabled": False,
            "document_template_invoices_enabled": False,
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def create_user(self, org_id: str, identifier: str, name: str, password_hash: str, role: str) -> dict:
        user_id = str(uuid4())
        user = {
            "id": user_id,
            "org_id": org_id,
            "identifier": identifier,
            "name": name.strip() or (identifier.split("@", 1)[0].title() if "@" in identifier else identifier),
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

    async def get_catalog_item(self, org_id: str, item_id: str) -> dict:
        item = self.catalog_items[item_id]
        if item["org_id"] != org_id:
            raise ValueError("Inventory item not found for this organization.")
        return item

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
            "admin_name": "Clinic Admin",
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
