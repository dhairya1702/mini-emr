from __future__ import annotations

import sys
import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
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
from app import config as config_module
from app import main as main_module
from app.main import app
from app.db import DuplicateCheckInCandidateError, get_repository
from app.schemas import ClinicSettingsUpdate, PatientCaseStudySourceOut, UserOut
from app.services.case_study_specialty import apply_case_study_specialty_enrichment
from app.services.document_helpers import build_document_context_for_user, serialize_note_assets
from app.services.followup_workflow import _as_utc_minute
from app.services import followup_booking_service as followup_booking_service_module


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
        self.patient_attachments: dict[str, dict] = {}
        self.patient_attachment_files: dict[str, bytes] = {}
        self.myopia_measurements: dict[str, dict] = {}
        self.longitudinal_tracks: dict[str, dict] = {}
        self.case_studies: dict[str, dict] = {}
        self.catalog_items: dict[str, dict] = {}
        self.invoices: dict[str, dict] = {}
        self.invoice_items: dict[str, dict] = {}
        self.follow_ups: dict[str, dict] = {}
        self.appointments: dict[str, dict] = {}
        self.audit_events: dict[str, dict] = {}
        self.ai_usage_events: dict[str, dict] = {}
        self.platform_errors: dict[str, dict] = {}

    async def create_organization(self, clinic_name: str) -> dict:
        org_id = str(uuid4())
        organization = {"id": org_id, "name": clinic_name.strip(), "created_at": _now()}
        self.organizations[org_id] = organization
        return organization

    async def list_organization_ids(self) -> list[str]:
        return list(self.organizations.keys())

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

    async def create_ai_usage_event(
        self,
        *,
        org_id: str,
        provider: str,
        model: str,
        feature: str,
        input_tokens: int,
        output_tokens: int,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        metadata: dict | None = None,
    ) -> dict:
        usage_id = str(uuid4())
        row = {
            "id": usage_id,
            "org_id": org_id,
            "provider": provider,
            "model": model,
            "feature": feature,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_creation_input_tokens": cache_creation_input_tokens,
            "cache_read_input_tokens": cache_read_input_tokens,
            "total_tokens": input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens,
            "metadata": metadata or {},
            "created_at": _now(),
        }
        self.ai_usage_events[usage_id] = row
        return row

    async def list_all_organizations(self) -> list[dict]:
        summaries = []
        for org in self.organizations.values():
            org_id = org["id"]
            clinic_settings = self.clinic_settings.get(org_id, {})
            users = [row for row in self.users.values() if row["org_id"] == org_id]
            patients = [row for row in self.patients.values() if row["org_id"] == org_id]
            notes = [row for row in self.notes.values() if row["org_id"] == org_id]
            invoices = [row for row in self.invoices.values() if row["org_id"] == org_id]
            follow_ups = [row for row in self.follow_ups.values() if row["org_id"] == org_id]
            audit_events = [row for row in self.audit_events.values() if row["org_id"] == org_id]
            usage_events = [row for row in self.ai_usage_events.values() if row["org_id"] == org_id]
            last_activity = org["created_at"]
            for collection in (users, patients, notes, invoices, follow_ups, audit_events):
                for row in collection:
                    candidate = row.get("last_visit_at") or row.get("scheduled_for") or row.get("created_at")
                    if candidate and candidate > last_activity:
                        last_activity = candidate
            summaries.append(
                {
                    "org_id": org_id,
                    "clinic_name": clinic_settings.get("clinic_name") or org["name"],
                    "created_at": org["created_at"],
                    "user_count": len(users),
                    "patient_count": len(patients),
                    "note_count": len(notes),
                    "invoice_count": len(invoices),
                    "follow_up_count": len(follow_ups),
                    "total_tokens": sum(int(event.get("total_tokens") or 0) for event in usage_events),
                    "last_activity_at": last_activity,
                }
            )
        return summaries

    async def list_users_for_org_any(self, org_id: str) -> list[dict]:
        rows = [row for row in self.users.values() if row["org_id"] == org_id]
        rows.sort(key=lambda row: row["created_at"])
        return rows

    async def list_ai_usage_events_for_org(self, org_id: str, limit: int = 100) -> list[dict]:
        rows = [row for row in self.ai_usage_events.values() if row["org_id"] == org_id]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows[:limit]

    async def create_platform_error(
        self,
        *,
        org_id: str | None,
        user_id: str | None,
        identifier: str | None,
        path: str,
        method: str,
        status_code: int | None,
        error_type: str,
        message: str,
        details: str = "",
        context: dict | None = None,
    ) -> dict:
        error_id = str(uuid4())
        row = {
            "id": error_id,
            "org_id": org_id,
            "user_id": user_id,
            "identifier": identifier or "",
            "path": path,
            "method": method,
            "status_code": status_code,
            "error_type": error_type,
            "message": message,
            "details": details,
            "context": context or {},
            "created_at": _now(),
        }
        if not hasattr(self, "platform_errors"):
            self.platform_errors = {}
        self.platform_errors[error_id] = row
        return row

    async def list_platform_errors(self, limit: int = 100, org_id: str | None = None) -> list[dict]:
        rows = list(getattr(self, "platform_errors", {}).values())
        if org_id:
            rows = [row for row in rows if row["org_id"] == org_id]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows[:limit]

    async def delete_user_any(self, user_id: str) -> None:
        self.users.pop(user_id, None)

    async def delete_organization(self, org_id: str) -> None:
        self.organizations.pop(org_id, None)

    async def create_clinic_settings(self, org_id: str, payload) -> dict:
        settings_id = str(uuid4())
        values = payload.model_dump(exclude_unset=True, exclude={"email_configured"})
        row = {
            "id": settings_id,
            "org_id": org_id,
            "document_template_content_type": None,
            "document_template_data_base64": None,
            "sender_email_app_password": None,
            "clinic_specialty": None,
            **values,
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def get_clinic_settings(self, org_id: str) -> dict:
        return self.clinic_settings.get(org_id, {})

    async def upsert_clinic_settings(self, org_id: str, payload) -> dict:
        current = self.clinic_settings.get(org_id)
        values = payload.model_dump(exclude_unset=True, exclude={"email_configured"})
        row = {
            "id": current["id"] if current else str(uuid4()),
            "org_id": org_id,
            **(
                current
                or {
                    "document_template_content_type": None,
                    "document_template_data_base64": None,
                    "sender_email_app_password": None,
                    "clinic_specialty": None,
                }
            ),
            **values,
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
            "doctor_dob": None,
            "doctor_address": "",
            "doctor_signature_name": None,
            "doctor_signature_content_type": None,
            "doctor_signature_data_base64": None,
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
            "doctor_dob": user.get("doctor_dob"),
            "doctor_address": user.get("doctor_address", ""),
            "doctor_signature_name": user.get("doctor_signature_name"),
            "doctor_signature_content_type": user.get("doctor_signature_content_type"),
            "doctor_signature_data_base64": user.get("doctor_signature_data_base64"),
            "doctor_signature_url": (
                f"/users/{user_id}/signature/file" if user.get("doctor_signature_name") else None
            ),
            "created_at": user["created_at"],
        }

    async def get_auth_user(self, user_id: str) -> dict:
        user = self.users[user_id]
        return {
            "id": user["id"],
            "org_id": user["org_id"],
            "identifier": user["identifier"],
            "name": user["name"],
            "role": user["role"],
            "doctor_dob": user.get("doctor_dob"),
            "doctor_address": user.get("doctor_address", ""),
            "doctor_signature_name": user.get("doctor_signature_name"),
            "doctor_signature_content_type": user.get("doctor_signature_content_type"),
            "doctor_signature_url": (
                f"/users/{user_id}/signature/file" if user.get("doctor_signature_name") else None
            ),
            "created_at": user["created_at"],
        }

    async def get_user_for_org(self, org_id: str, user_id: str) -> dict:
        user = self.users[user_id]
        if user["org_id"] != org_id:
            raise KeyError(user_id)
        return await self.get_user(user_id)

    async def list_users(self, org_id: str) -> list[dict]:
        return [
            {
                "id": user["id"],
                "org_id": user["org_id"],
                "identifier": user["identifier"],
                "name": user["name"],
                "role": user["role"],
                "doctor_dob": user.get("doctor_dob"),
                "doctor_address": user.get("doctor_address", ""),
                "doctor_signature_name": user.get("doctor_signature_name"),
                "doctor_signature_content_type": user.get("doctor_signature_content_type"),
                "doctor_signature_url": (
                    f"/users/{user['id']}/signature/file" if user.get("doctor_signature_name") else None
                ),
                "created_at": user["created_at"],
            }
            for user in self.users.values()
            if user["org_id"] == org_id
        ]

    async def update_user_role(self, user_id: str, payload) -> dict:
        user = self.users[user_id]
        user["role"] = payload.role
        return dict(user)

    async def update_user_account(self, user_id: str, payload) -> dict:
        user = self.users[user_id]
        user["name"] = payload.name.strip()
        user["doctor_dob"] = payload.doctor_dob.isoformat() if payload.doctor_dob else None
        user["doctor_address"] = payload.doctor_address.strip()
        return dict(user)

    async def update_user_password_hash(self, user_id: str, password_hash: str) -> dict:
        user = self.users[user_id]
        user["password_hash"] = password_hash
        return dict(user)

    async def delete_user(self, user_id: str) -> None:
        self.users.pop(user_id, None)

    async def set_user_signature(self, user_id: str, *, filename: str, content_type: str, data_base64: str) -> dict:
        user = self.users[user_id]
        user["doctor_signature_name"] = filename
        user["doctor_signature_content_type"] = content_type
        user["doctor_signature_data_base64"] = data_base64
        user["doctor_signature_url"] = f"/users/{user_id}/signature/file"
        return dict(user)

    async def clear_user_signature(self, user_id: str) -> dict:
        user = self.users[user_id]
        user["doctor_signature_name"] = None
        user["doctor_signature_content_type"] = None
        user["doctor_signature_data_base64"] = None
        user["doctor_signature_url"] = None
        return dict(user)

    async def create_patient(self, org_id: str, payload) -> dict:
        patient_id = str(uuid4())
        created_at = _now()
        patient = {
            "id": patient_id,
            "org_id": org_id,
            **payload.model_dump(),
            "phone": _normalize_phone(payload.phone),
            "email": payload.email.strip().lower(),
            "address": payload.address.strip(),
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
            "email": payload.email.strip().lower(),
            "address": payload.address.strip(),
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
            "email": payload.email.strip().lower(),
            "address": payload.address.strip(),
            "status": "scheduled",
            "checked_in_patient_id": None,
            "checked_in_at": None,
            "created_at": _now(),
        }
        self.appointments[appointment_id] = appointment
        return appointment

    async def list_appointments(
        self,
        org_id: str,
        status: str | None = None,
        query: str | None = None,
        limit: int = 200,
        scheduled_from: str | None = None,
        scheduled_to: str | None = None,
    ) -> list[dict]:
        rows = [
            appointment for appointment in self.appointments.values()
            if appointment["org_id"] == org_id and (status is None or appointment["status"] == status)
        ]
        if scheduled_from:
            start = datetime.fromisoformat(scheduled_from.replace("Z", "+00:00"))
            rows = [
                appointment for appointment in rows
                if _as_utc_minute(appointment["scheduled_for"]) >= start
            ]
        if scheduled_to:
            end = datetime.fromisoformat(scheduled_to.replace("Z", "+00:00"))
            rows = [
                appointment for appointment in rows
                if _as_utc_minute(appointment["scheduled_for"]) < end
            ]
        normalized_query = (query or "").strip().lower()
        if normalized_query:
            rows = [
                appointment for appointment in rows
                if normalized_query in appointment["name"].lower()
                or normalized_query in appointment["phone"].lower()
                or normalized_query in appointment["reason"].lower()
            ]
        rows.sort(key=lambda appointment: _as_utc_minute(appointment["scheduled_for"]))
        return rows[:limit]

    async def cancel_expired_appointments(self, org_id: str, stale_before_iso: str) -> int:
        stale_before = datetime.fromisoformat(stale_before_iso.replace("Z", "+00:00"))
        cancelled = 0
        for appointment in self.appointments.values():
            scheduled_for = appointment["scheduled_for"]
            normalized = scheduled_for if isinstance(scheduled_for, datetime) else datetime.fromisoformat(str(scheduled_for).replace("Z", "+00:00"))
            if appointment["org_id"] == org_id and appointment["status"] == "scheduled" and normalized < stale_before:
                appointment["status"] = "cancelled"
                cancelled += 1
        return cancelled

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
                "email": appointment["email"],
                "address": appointment["address"],
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
                "email": appointment["email"],
                "address": appointment["address"],
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
                    "email": appointment["email"],
                    "address": appointment["address"],
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

    async def list_patients_by_ids(self, org_id: str, patient_ids: list[str]) -> list[dict]:
        allowed = {str(patient_id) for patient_id in patient_ids}
        return [
            {"id": patient["id"], "name": patient["name"]}
            for patient in self.patients.values()
            if patient["org_id"] == org_id and patient["id"] in allowed
        ]

    async def create_patient_visit(self, org_id: str, patient_id: str, payload) -> dict:
        patient = self.patients[patient_id]
        if patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")
        updated_at = _now()
        patient.update(
            {
                "name": payload.name,
                "phone": _normalize_phone(payload.phone),
                "email": payload.email.strip().lower(),
                "address": payload.address.strip(),
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

    async def create_patient_attachment(
        self,
        org_id: str,
        patient_id: str,
        *,
        uploaded_by: str,
        filename: str,
        content_type: str,
        file_size: int,
        raw_bytes: bytes,
    ) -> dict:
        await self.get_patient(org_id, patient_id)
        attachment_id = str(uuid4())
        safe_name = filename.strip() or "attachment"
        storage_path = f"{org_id}/{patient_id}/{attachment_id}/{safe_name}"
        row = {
            "id": attachment_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "uploaded_by": uploaded_by,
            "file_name": safe_name,
            "content_type": content_type,
            "file_size": file_size,
            "storage_path": storage_path,
            "created_at": _now(),
        }
        self.patient_attachments[attachment_id] = row
        self.patient_attachment_files[storage_path] = raw_bytes
        return row

    async def list_patient_attachments(self, org_id: str, patient_id: str) -> list[dict]:
        rows = [
            row for row in self.patient_attachments.values()
            if row["org_id"] == org_id and row["patient_id"] == patient_id
        ]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows

    async def get_patient_attachment(self, org_id: str, attachment_id: str) -> dict:
        row = self.patient_attachments[attachment_id]
        if row["org_id"] != org_id:
            raise ValueError("Attachment not found for this organization.")
        return row

    async def download_patient_attachment(self, org_id: str, attachment_id: str) -> tuple[dict, bytes]:
        row = await self.get_patient_attachment(org_id, attachment_id)
        return row, self.patient_attachment_files[row["storage_path"]]

    async def create_myopia_measurement(self, org_id: str, patient_id: str, payload) -> dict:
        await self.get_patient(org_id, patient_id)
        record_id = str(uuid4())
        row = {
            "id": record_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "measured_at": payload.measured_at,
            "age_years": payload.age_years,
            "axial_length_right_mm": payload.axial_length_right_mm,
            "axial_length_left_mm": payload.axial_length_left_mm,
            "treatment_type": payload.treatment_type.strip(),
            "treatment_notes": payload.treatment_notes.strip(),
            "visit_notes": payload.visit_notes.strip(),
            "refraction_right": payload.refraction_right.strip(),
            "refraction_left": payload.refraction_left.strip(),
            "created_at": _now(),
        }
        self.myopia_measurements[record_id] = row
        return row

    async def list_myopia_measurements_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        rows = [
            row for row in self.myopia_measurements.values()
            if row["org_id"] == org_id and row["patient_id"] == patient_id
        ]
        rows.sort(key=lambda row: row["measured_at"])
        return rows

    async def update_myopia_measurement(self, org_id: str, patient_id: str, record_id: str, updates: dict) -> dict:
        row = self.myopia_measurements[record_id]
        if row["org_id"] != org_id or row["patient_id"] != patient_id:
            raise ValueError("Myopia measurement not found for this patient.")
        row.update(updates)
        return row

    async def create_longitudinal_track(self, org_id: str, patient_id: str, payload) -> dict:
        await self.get_patient(org_id, patient_id)
        record_id = str(uuid4())
        row = {
            "id": record_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "track_type": payload.track_type,
            "measured_at": payload.measured_at,
            "summary_fields": payload.summary_fields,
            "raw_payload": payload.raw_payload,
            "derived_metrics": payload.derived_metrics,
            "created_at": _now(),
        }
        self.longitudinal_tracks[record_id] = row
        return row

    async def list_longitudinal_tracks_for_patient(self, org_id: str, patient_id: str, *, track_type: str | None = None) -> list[dict]:
        rows = [
            row for row in self.longitudinal_tracks.values()
            if row["org_id"] == org_id and row["patient_id"] == patient_id and (track_type is None or row["track_type"] == track_type)
        ]
        rows.sort(key=lambda row: row["measured_at"])
        return rows

    async def update_longitudinal_track(self, org_id: str, patient_id: str, record_id: str, updates: dict) -> dict:
        row = self.longitudinal_tracks[record_id]
        if row["org_id"] != org_id or row["patient_id"] != patient_id:
            raise ValueError("Longitudinal track record not found for this patient.")
        row.update(updates)
        return row

    async def create_case_study(self, org_id: str, created_by: str, payload) -> dict:
        await self.get_patient(org_id, str(payload.patient_id))
        case_study_id = str(uuid4())
        row = {
            "id": case_study_id,
            "org_id": org_id,
            "patient_id": str(payload.patient_id),
            "title": payload.title.strip(),
            "status": payload.status,
            "template_key": payload.template_key,
            "anonymized": payload.anonymized,
            "author_instructions": payload.author_instructions.strip(),
            "generated_content": payload.generated_content,
            "source_snapshot": payload.source_snapshot,
            "created_by": created_by,
            "created_at": _now(),
            "updated_at": _now(),
        }
        self.case_studies[case_study_id] = row
        return row

    async def list_case_studies(self, org_id: str) -> list[dict]:
        rows = [row for row in self.case_studies.values() if row["org_id"] == org_id]
        rows.sort(key=lambda row: row["updated_at"], reverse=True)
        return rows

    async def get_case_study(self, org_id: str, case_study_id: str) -> dict:
        row = self.case_studies[case_study_id]
        if row["org_id"] != org_id:
            raise ValueError("Case study not found for this organization.")
        return row

    async def update_case_study(self, org_id: str, case_study_id: str, updates: dict) -> dict:
        row = await self.get_case_study(org_id, case_study_id)
        if "patient_id" in updates:
            await self.get_patient(org_id, str(updates["patient_id"]))
            updates = {**updates, "patient_id": str(updates["patient_id"])}
        row.update(updates)
        row["updated_at"] = _now()
        return row

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
            asset_payload=getattr(payload, "asset_payload", []),
            structured_modules=getattr(payload, "structured_modules", []),
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
        asset_payload: list[dict],
        structured_modules: list[dict],
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
            "asset_payload": asset_payload,
            "structured_modules": structured_modules,
            "status": "draft",
            "version_number": version_number,
            "root_note_id": root_note_id,
            "amended_from_note_id": amended_from_note_id,
            "snapshot_content": None,
            "snapshot_asset_payload": [],
            "finalized_at": None,
            "sent_at": None,
            "sent_by": None,
            "sent_to": None,
            "created_at": _now(),
        }
        self.notes[note_id] = note
        return note

    async def update_note_draft(self, org_id: str, note_id: str, content: str, asset_payload: list[dict] | None = None, structured_modules: list[dict] | None = None) -> dict:
        note = await self.get_note(org_id, note_id)
        if note["status"] != "draft":
            raise ValueError("Only draft notes can be updated.")
        note["content"] = content
        if asset_payload is not None:
            note["asset_payload"] = asset_payload
        if structured_modules is not None:
            note["structured_modules"] = structured_modules
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
        note["snapshot_asset_payload"] = note.get("asset_payload") or []
        note["finalized_at"] = _now()
        return note

    async def create_note_amendment(self, org_id: str, note_id: str, content: str, asset_payload: list[dict] | None = None, structured_modules: list[dict] | None = None) -> dict:
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
            asset_payload=asset_payload or note.get("asset_payload") or [],
            structured_modules=structured_modules if structured_modules is not None else note.get("structured_modules") or [],
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
            note["snapshot_asset_payload"] = note.get("snapshot_asset_payload") or note.get("asset_payload") or []
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
        rows = []
        for invoice in self.invoices.values():
            if invoice["org_id"] != org_id:
                continue
            patient = self.patients.get(invoice["patient_id"])
            completed_by = self.users.get(str(invoice.get("completed_by") or ""))
            rows.append(
                {
                    **invoice,
                    "patient_name": patient["name"] if patient else None,
                    "completed_by_name": completed_by["name"] if completed_by else None,
                    "balance_due": round(max(float(invoice.get("total") or 0) - float(invoice.get("amount_paid") or 0), 0), 2),
                    "items": invoice.get("items", []),
                }
            )
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows

    async def get_patient_timeline_source(self, org_id: str, patient_id: str) -> dict:
        patient = await self.get_patient(org_id, patient_id)
        user_names = {
            user_id: user["name"]
            for user_id, user in self.users.items()
            if user["org_id"] == org_id
        }
        invoices = []
        for invoice in await self.list_invoices_for_patient(org_id, patient_id):
            completed_by = str(invoice.get("completed_by") or "")
            invoices.append(
                {
                    **invoice,
                    "patient_name": patient["name"],
                    "completed_by_name": user_names.get(completed_by),
                    "balance_due": round(max(float(invoice.get("total") or 0) - float(invoice.get("amount_paid") or 0), 0), 2),
                    "items": invoice.get("items", []),
                }
            )
        return {
            "patient": patient,
            "clinic_settings": self.clinic_settings.get(org_id, {}),
            "visits": await self.list_patient_visits_for_patient(org_id, patient_id),
            "notes": [
                {**note, "sent_by_name": user_names.get(str(note.get("sent_by") or ""))}
                for note in await self.list_notes_for_patient(org_id, patient_id)
            ],
            "myopia_measurements": await self.list_myopia_measurements_for_patient(org_id, patient_id),
            "longitudinal_tracks": await self.list_longitudinal_tracks_for_patient(org_id, patient_id),
            "invoices": invoices,
            "follow_ups": await self.list_follow_ups_for_patient(org_id, patient_id),
            "appointments": await self.list_appointments_for_patient(org_id, patient_id),
        }

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
            "reminder_sent_at": None,
            "created_at": _now(),
        }
        self.follow_ups[follow_up_id] = row
        return row

    async def list_follow_ups(
        self,
        org_id: str,
        status: str | None = None,
        query: str | None = None,
        limit: int = 200,
        scheduled_from: str | None = None,
        scheduled_to: str | None = None,
    ) -> list[dict]:
        rows = []
        normalized_query = (query or "").strip().lower()
        start = datetime.fromisoformat(scheduled_from.replace("Z", "+00:00")) if scheduled_from else None
        end = datetime.fromisoformat(scheduled_to.replace("Z", "+00:00")) if scheduled_to else None
        for follow_up in self.follow_ups.values():
            if follow_up["org_id"] != org_id:
                continue
            if status is not None and follow_up["status"] != status:
                continue
            scheduled_for = _as_utc_minute(follow_up["scheduled_for"])
            if start and scheduled_for < start:
                continue
            if end and scheduled_for >= end:
                continue
            patient = self.patients.get(follow_up["patient_id"])
            patient_name = patient["name"] if patient else ""
            if normalized_query and normalized_query not in patient_name.lower() and normalized_query not in follow_up["notes"].lower():
                continue
            rows.append({**follow_up, "patient_name": patient_name})
        rows.sort(key=lambda follow_up: _as_utc_minute(follow_up["scheduled_for"]))
        return rows[:limit]

    async def cancel_expired_follow_ups(self, org_id: str, stale_before_iso: str) -> int:
        stale_before = datetime.fromisoformat(stale_before_iso.replace("Z", "+00:00"))
        cancelled = 0
        for follow_up in self.follow_ups.values():
            scheduled_for = follow_up["scheduled_for"]
            normalized = scheduled_for if isinstance(scheduled_for, datetime) else datetime.fromisoformat(str(scheduled_for).replace("Z", "+00:00"))
            if follow_up["org_id"] == org_id and follow_up["status"] == "scheduled" and normalized < stale_before:
                follow_up["status"] = "cancelled"
                follow_up["completed_at"] = None
                cancelled += 1
        return cancelled

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
            if updates["status"] == "scheduled":
                follow_up["reminder_sent_at"] = None
        if "scheduled_for" in updates:
            follow_up["scheduled_for"] = updates["scheduled_for"]
        if "notes" in updates:
            follow_up["notes"] = updates["notes"]
        return follow_up

    async def list_due_follow_ups(self, org_id: str, due_before_iso: str) -> list[dict]:
        return [
            follow_up for follow_up in self.follow_ups.values()
            if follow_up["org_id"] == org_id
            and follow_up["status"] == "scheduled"
            and follow_up["reminder_sent_at"] is None
            and str(follow_up["scheduled_for"]) <= due_before_iso
        ]

    async def mark_follow_up_reminder_sent(self, org_id: str, follow_up_id: str) -> dict:
        follow_up = self.follow_ups[follow_up_id]
        if follow_up["org_id"] != org_id:
            raise ValueError("Follow-up not found for this organization.")
        follow_up["reminder_sent_at"] = _now()
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
    monkeypatch.setattr(
        config_module,
        "get_settings",
        lambda: SimpleNamespace(
            auth_secret="test-secret",
            supabase_service_role_key="",
            app_origin="http://127.0.0.1:3000",
        ),
    )
    monkeypatch.setattr(
        followup_booking_service_module,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="test-secret"),
    )
    app.dependency_overrides[get_repository] = lambda: repo
    with TestClient(app) as test_client:
        yield test_client, repo
    app.dependency_overrides.clear()


def register_test_clinic(client: TestClient, *, identifier: str, clinic_name: str) -> dict:
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


def auth_headers_for_token(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_public_follow_up_booking_reschedules_and_creates_appointment(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="booking@example.com", clinic_name="Booking Clinic")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Booking Patient",
            "phone": "5550102222",
            "email": "patient@example.com",
            "address": "123 Main Street",
            "reason": "Review visit",
            "age": 29,
            "weight": 67,
            "height": 172,
            "temperature": 98.6,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    scheduled_for = (datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)).isoformat()
    follow_up_response = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        headers=auth_headers_for_token(token),
        json={"scheduled_for": scheduled_for, "notes": "Return for blood pressure review"},
    )
    assert follow_up_response.status_code == 201
    follow_up = follow_up_response.json()

    booking_token = followup_booking_service_module.create_follow_up_booking_token(
        org_id=session["user"]["org_id"],
        patient_id=patient["id"],
        follow_up_id=follow_up["id"],
    )

    first_slot = datetime.now(UTC).replace(microsecond=0, second=0, minute=0, hour=9)
    if first_slot <= datetime.now(UTC):
        first_slot += timedelta(days=1)
    while first_slot.weekday() == 6:
        first_slot += timedelta(days=1)
    second_slot = first_slot + timedelta(minutes=30)
    repo.clinic_settings[session["user"]["org_id"]].update(
        {
            "appointment_start_time": "09:00",
            "appointment_end_time": "11:00",
            "appointments_per_hour": 2,
        }
    )
    scheduled_response = test_client.post(
        "/appointments",
        headers=auth_headers_for_token(token),
        json={
            "name": "Occupied Slot",
            "phone": "5550103333",
            "reason": "Existing booking",
            "email": "occupied@example.com",
            "address": "456 Main Street",
            "age": 31,
            "weight": 64,
            "height": 170,
            "temperature": 98.5,
            "scheduled_for": first_slot.isoformat(),
        },
    )
    assert scheduled_response.status_code == 201

    context_response = test_client.get(f"/public/follow-up-booking?token={booking_token}")
    assert context_response.status_code == 200
    assert context_response.json()["patient_name"] == "Booking Patient"
    assert datetime.fromisoformat(context_response.json()["suggested_slots"][0].replace("Z", "+00:00")) == second_slot

    rescheduled_for = second_slot.isoformat()
    book_response = test_client.post(
        "/public/follow-up-booking",
        json={"token": booking_token, "scheduled_for": rescheduled_for},
    )
    assert book_response.status_code == 204

    reused_response = test_client.get(f"/public/follow-up-booking?token={booking_token}")
    assert reused_response.status_code == 400

    follow_ups_response = test_client.get(
        f"/follow-ups?scheduled_date={datetime.fromisoformat(rescheduled_for).date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert follow_ups_response.status_code == 200
    refreshed_follow_up = follow_ups_response.json()[0]
    assert datetime.fromisoformat(refreshed_follow_up["scheduled_for"].replace("Z", "+00:00")) == datetime.fromisoformat(rescheduled_for)
    assert refreshed_follow_up["status"] == "completed"

    appointments_response = test_client.get(
        f"/appointments?scheduled_date={datetime.fromisoformat(rescheduled_for).date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert appointments_response.status_code == 200
    appointment_reasons = [appointment["reason"] for appointment in appointments_response.json()]
    assert "Follow-up: Review visit" in appointment_reasons

    appointment_events = [event for event in repo.audit_events.values() if event["entity_type"] == "appointment"]
    assert any(event["actor_user_id"] is None for event in appointment_events)
    assert any(event.get("metadata", {}).get("source") == "public_follow_up_booking" for event in appointment_events)


def test_follow_up_slot_normalizer_accepts_iso_strings() -> None:
    normalized = _as_utc_minute("2026-04-10T10:30:45+00:00")

    assert normalized == datetime(2026, 4, 10, 10, 30, tzinfo=UTC)


def test_public_follow_up_booking_rejects_expired_tokens(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="booking-expired@example.com", clinic_name="Expired Booking Clinic")

    original_secret = followup_booking_service_module._secret

    def expired_token(*, org_id: str, patient_id: str, follow_up_id: str) -> str:
        payload = {
            "org_id": org_id,
            "patient_id": patient_id,
            "follow_up_id": follow_up_id,
            "exp": int((datetime.now(UTC) - timedelta(days=1)).timestamp()),
        }
        payload_segment = followup_booking_service_module._b64encode(
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        signature = hmac.new(
            original_secret(),
            payload_segment.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return f"{payload_segment}.{followup_booking_service_module._b64encode(signature)}"

    patient = test_client.post(
        "/patients",
        headers=auth_headers_for_token(session["token"]),
        json={
            "name": "Expired Booking Patient",
            "phone": "5550108282",
            "email": "expired@example.com",
            "address": "123 Main Street",
            "reason": "Review visit",
            "age": 29,
            "weight": 67,
            "height": 172,
            "temperature": 98.6,
        },
    ).json()

    follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        headers=auth_headers_for_token(session["token"]),
        json={"scheduled_for": (datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)).isoformat(), "notes": "Return soon"},
    ).json()

    token = expired_token(
        org_id=session["user"]["org_id"],
        patient_id=patient["id"],
        follow_up_id=follow_up["id"],
    )

    response = test_client.get(f"/public/follow-up-booking?token={token}")
    assert response.status_code == 400
    assert "expired" in response.json()["detail"].lower()


def test_public_follow_up_booking_rate_limits_context_requests(client, monkeypatch: pytest.MonkeyPatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="booking-ratelimit@example.com", clinic_name="Rate Limit Booking Clinic")

    patient = test_client.post(
        "/patients",
        headers=auth_headers_for_token(session["token"]),
        json={
            "name": "Rate Limit Booking Patient",
            "phone": "5550109292",
            "email": "ratelimit@example.com",
            "address": "123 Main Street",
            "reason": "Review visit",
            "age": 29,
            "weight": 67,
            "height": 172,
            "temperature": 98.6,
        },
    ).json()

    follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        headers=auth_headers_for_token(session["token"]),
        json={"scheduled_for": (datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)).isoformat(), "notes": "Return soon"},
    ).json()

    token = followup_booking_service_module.create_follow_up_booking_token(
        org_id=session["user"]["org_id"],
        patient_id=patient["id"],
        follow_up_id=follow_up["id"],
    )

    monkeypatch.setitem(main_module.RATE_LIMIT_WINDOWS, "public_follow_up_booking_get", (1, 60.0))
    main_module.RATE_LIMIT_BUCKETS.clear()

    first = test_client.get(f"/public/follow-up-booking?token={token}")
    assert first.status_code == 200

    second = test_client.get(f"/public/follow-up-booking?token={token}")
    assert second.status_code == 429


def test_schedule_lists_filter_by_requested_date_without_mutating_expired_items(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="cleanup@example.com", clinic_name="Cleanup Clinic")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Cleanup Patient",
            "phone": "5550103333",
            "email": "cleanup@example.com",
            "address": "123 Main Street",
            "reason": "Review visit",
            "age": 41,
            "weight": 72,
            "height": 168,
            "temperature": 98.4,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    yesterday = datetime.now(UTC).replace(microsecond=0) - timedelta(days=1)
    tomorrow = datetime.now(UTC).replace(microsecond=0) + timedelta(days=1)

    old_appointment = test_client.post(
        "/appointments",
        headers=auth_headers_for_token(token),
        json={
            "name": "Old Appointment",
            "phone": "5550103333",
            "email": "cleanup@example.com",
            "address": "123 Main Street",
            "reason": "Old appointment",
            "age": 41,
            "weight": 72,
            "height": 168,
            "temperature": 98.4,
            "scheduled_for": yesterday.isoformat(),
        },
    )
    assert old_appointment.status_code == 201
    old_appointment_body = old_appointment.json()

    future_appointment = test_client.post(
        "/appointments",
        headers=auth_headers_for_token(token),
        json={
            "name": "Future Appointment",
            "phone": "5550103333",
            "email": "cleanup@example.com",
            "address": "123 Main Street",
            "reason": "Future appointment",
            "age": 41,
            "weight": 72,
            "height": 168,
            "temperature": 98.4,
            "scheduled_for": tomorrow.isoformat(),
        },
    )
    assert future_appointment.status_code == 201
    future_appointment_body = future_appointment.json()

    old_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        headers=auth_headers_for_token(token),
        json={"scheduled_for": yesterday.isoformat(), "notes": "Old follow-up"},
    )
    assert old_follow_up.status_code == 201
    old_follow_up_body = old_follow_up.json()

    future_follow_up = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        headers=auth_headers_for_token(token),
        json={"scheduled_for": tomorrow.isoformat(), "notes": "Future follow-up"},
    )
    assert future_follow_up.status_code == 201
    future_follow_up_body = future_follow_up.json()

    appointments_response = test_client.get(
        f"/appointments?scheduled_date={tomorrow.date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert appointments_response.status_code == 200
    appointment_ids = {row["id"] for row in appointments_response.json()}
    assert future_appointment_body["id"] in appointment_ids
    assert old_appointment_body["id"] not in appointment_ids
    assert repo.appointments[old_appointment_body["id"]]["status"] == "scheduled"

    follow_ups_response = test_client.get(
        f"/follow-ups?scheduled_date={tomorrow.date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert follow_ups_response.status_code == 200
    follow_up_ids = {row["id"] for row in follow_ups_response.json()}
    assert future_follow_up_body["id"] in follow_up_ids
    assert old_follow_up_body["id"] not in follow_up_ids
    assert repo.follow_ups[old_follow_up_body["id"]]["status"] == "scheduled"


def test_myopia_measurements_create_history_and_timeline(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="axial@example.com", clinic_name="Axial Clinic")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Maya Rao",
            "phone": "5550104444",
            "email": "maya@example.com",
            "address": "12 Oak Street",
            "reason": "Myopia review",
            "age": 11,
            "weight": 40,
            "height": 145,
            "temperature": 98.4,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    first_record = test_client.post(
        f"/patients/{patient['id']}/myopia-records",
        headers=auth_headers_for_token(token),
        json={
            "measured_at": "2026-01-01T10:00:00+00:00",
            "age_years": 11.0,
            "axial_length_right_mm": 24.12,
            "axial_length_left_mm": 24.05,
            "treatment_type": "Observation",
            "treatment_notes": "Baseline biometry.",
            "visit_notes": "Outdoor time discussed.",
            "refraction_right": "-1.75 DS",
            "refraction_left": "-1.50 DS",
        },
    )
    assert first_record.status_code == 201

    second_record = test_client.post(
        f"/patients/{patient['id']}/myopia-records",
        headers=auth_headers_for_token(token),
        json={
            "measured_at": "2026-07-01T10:00:00+00:00",
            "age_years": 11.5,
            "axial_length_right_mm": 24.22,
            "axial_length_left_mm": 24.16,
            "treatment_type": "Atropine 0.01%",
            "treatment_notes": "Started low-dose atropine.",
            "visit_notes": "Compliance reviewed.",
            "refraction_right": "-2.00 DS",
            "refraction_left": "-1.75 DS",
        },
    )
    assert second_record.status_code == 201

    history_response = test_client.get(
        f"/patients/{patient['id']}/myopia-history",
        headers=auth_headers_for_token(token),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history["records"]) == 2
    assert history["baseline_delta"] == {"right_mm": 0.1, "left_mm": 0.11}
    assert history["last_delta"] == {"right_mm": 0.1, "left_mm": 0.11}
    assert history["annualized_growth"] is not None
    assert history["overlay_version"] == "clinic-reference-v1"

    timeline_response = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers_for_token(token),
    )
    assert timeline_response.status_code == 200
    myopia_events = [event for event in timeline_response.json() if event["type"] == "myopia_measurement"]
    assert len(myopia_events) == 2
    assert any("OD 24.22 mm" in event["description"] for event in myopia_events)


def test_case_study_generation_storage_and_pdf(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="case-study@example.com", clinic_name="Case Study Clinic")
    token = session["token"]

    settings_response = test_client.put(
        "/settings/clinic",
        headers=auth_headers_for_token(token),
        json={"clinic_specialty": "optometry"},
    )
    assert settings_response.status_code == 200

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Ananya Shah",
            "phone": "5550105555",
            "email": "ananya@example.com",
            "address": "44 Pine Street",
            "reason": "Progressive myopia",
            "age": 12,
            "weight": 43,
            "height": 150,
            "temperature": 98.7,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    note_response = test_client.post(
        "/generate-note",
        headers=auth_headers_for_token(token),
        json={
            "patient_id": patient["id"],
            "symptoms": "Blurred distance vision",
            "diagnosis": "Progressive myopia",
            "medications": "Atropine 0.01%",
            "notes": "Family history of myopia. Discussed outdoor time and compliance.",
        },
    )
    assert note_response.status_code == 200

    myopia_response = test_client.post(
        f"/patients/{patient['id']}/myopia-records",
        headers=auth_headers_for_token(token),
        json={
            "measured_at": "2026-01-01T10:00:00+00:00",
            "age_years": 12.0,
            "axial_length_right_mm": 24.32,
            "axial_length_left_mm": 24.28,
            "treatment_type": "Atropine 0.01%",
            "treatment_notes": "Continuing treatment.",
            "visit_notes": "Compliance improved.",
            "refraction_right": "-2.25 DS",
            "refraction_left": "-2.00 DS",
        },
    )
    assert myopia_response.status_code == 201

    source_response = test_client.get(
        f"/patients/{patient['id']}/case-study-source",
        headers=auth_headers_for_token(token),
    )
    assert source_response.status_code == 200
    source = source_response.json()
    assert source["patient"]["name"] == "Ananya Shah"
    assert len(source["notes"]) == 1
    assert source["myopia_history"]["records"][0]["treatment_type"] == "Atropine 0.01%"

    generated_response = test_client.post(
        "/generate-case-study",
        headers=auth_headers_for_token(token),
        json={
          "patient_id": patient["id"],
          "title": "",
          "template_key": "conference_presentation",
          "anonymized": True,
          "author_instructions": "Focus on longitudinal progression and treatment decisions.",
        },
    )
    assert generated_response.status_code == 200
    generated = generated_response.json()
    assert "Title:" in generated["content"]
    assert "Learning Points:" in generated["content"]
    assert generated["source"]["patient"]["name"] == "Patient A"

    create_response = test_client.post(
        "/case-studies",
        headers=auth_headers_for_token(token),
        json={
            "patient_id": patient["id"],
            "title": generated["title"],
            "status": "draft",
            "template_key": "conference_presentation",
            "anonymized": True,
            "author_instructions": "Focus on longitudinal progression and treatment decisions.",
            "generated_content": generated["content"],
            "source_snapshot": generated["source"],
        },
    )
    assert create_response.status_code == 201
    saved = create_response.json()
    assert saved["status"] == "draft"
    assert saved["patient_name"] == "Ananya Shah"

    list_response = test_client.get("/case-studies", headers=auth_headers_for_token(token))
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    update_response = test_client.patch(
        f"/case-studies/{saved['id']}",
        headers=auth_headers_for_token(token),
        json={"status": "final", "title": "Conference Case: Progressive Myopia"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "final"

    pdf_response = test_client.get(
        f"/case-studies/{saved['id']}/pdf",
        headers=auth_headers_for_token(token),
    )
    assert pdf_response.status_code == 200
    assert pdf_response.headers["content-type"] == "application/pdf"


def test_case_study_source_is_generic_for_non_optometry_clinics(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="case-study-gp@example.com", clinic_name="General Clinic")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Ravi Kumar",
            "phone": "5550201111",
            "email": "ravi@example.com",
            "address": "18 Lake Road",
            "reason": "Fever",
            "age": 34,
            "weight": 72,
            "height": 174,
            "temperature": 99.1,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    note_response = test_client.post(
        "/generate-note",
        headers=auth_headers_for_token(token),
        json={
            "patient_id": patient["id"],
            "symptoms": "Fever and body ache",
            "diagnosis": "Viral fever",
            "medications": "Paracetamol",
            "notes": "Hydration and rest advised.",
        },
    )
    assert note_response.status_code == 200

    source_response = test_client.get(
        f"/patients/{patient['id']}/case-study-source",
        headers=auth_headers_for_token(token),
    )
    assert source_response.status_code == 200
    source = source_response.json()
    assert source["patient"]["name"] == "Ravi Kumar"
    assert len(source["notes"]) == 1
    assert source["myopia_history"] is None


def test_pediatric_growth_records_create_history_and_timeline(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="peds@example.com", clinic_name="Peds Clinic")
    token = session["token"]

    settings_response = test_client.put(
        "/settings/clinic",
        headers=auth_headers_for_token(token),
        json={"clinic_specialty": "pediatrics"},
    )
    assert settings_response.status_code == 200

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Aarav Mehta",
            "phone": "5550204444",
            "email": "aarav@example.com",
            "address": "22 Maple Street",
            "reason": "Well-child visit",
            "age": 8,
            "weight": 26,
            "height": 128,
            "temperature": 98.4,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    growth_response = test_client.post(
        f"/patients/{patient['id']}/growth-records",
        headers=auth_headers_for_token(token),
        json={
            "measured_at": "2026-05-01T10:00:00+00:00",
            "height_cm": 128,
            "weight_kg": 26,
            "head_circumference_cm": 52,
            "visit_notes": "Routine growth review",
        },
    )
    assert growth_response.status_code == 201
    assert growth_response.json()["bmi"] > 0

    history_response = test_client.get(
        f"/patients/{patient['id']}/growth-history",
        headers=auth_headers_for_token(token),
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history["records"]) == 1
    assert history["latest_measurement"]["height_cm"] == 128.0

    timeline_response = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers_for_token(token),
    )
    assert timeline_response.status_code == 200
    growth_events = [event for event in timeline_response.json() if event["type"] == "growth_measurement"]
    assert len(growth_events) == 1
    assert "BMI" in growth_events[0]["description"]


def test_generate_parent_handout_returns_pediatric_content(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="peds-handout@example.com", clinic_name="Blue Bird Pediatrics")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Maya Sharma",
            "phone": "5550207777",
            "email": "maya@example.com",
            "address": "7 Garden Lane",
            "reason": "Well-child visit",
            "age": 6,
            "weight": 20,
            "height": 112,
            "temperature": 98.6,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    handout_response = test_client.post(
        "/generate-parent-handout",
        headers=auth_headers_for_token(token),
        json={
            "patient_id": patient["id"],
            "template_key": "well_visit_summary",
            "instructions": "Focus on hydration and return precautions.",
            "well_child_visit": {
                "visit_band": "school_age",
                "nutrition_summary": "Balanced diet discussed.",
                "sleep_summary": "Regular bedtime encouraged.",
                "elimination_summary": "",
                "school_behavior_summary": "",
                "parent_concerns": "Occasional picky eating.",
                "assessment_summary": "Doing well overall.",
            },
        },
    )

    assert handout_response.status_code == 200
    body = handout_response.json()
    assert body["title"] == "Well-Visit Summary"
    assert "Maya Sharma" in body["content"]
    assert "Focus on hydration and return precautions." in body["content"]


def test_build_document_context_for_user_prefers_user_profile_name() -> None:
    async def scenario() -> None:
        repo = FakeRepo()
        org = await repo.create_organization("ClinicOS")
        await repo.create_clinic_settings(
            org["id"],
            ClinicSettingsUpdate(
                clinic_name="ClinicOS",
                doctor_name="Fallback Doctor",
            ),
        )
        user = await repo.create_user(
            org["id"],
            "admin@clinic.test",
            "Dr. Rivera",
            "hashed-password",
            "admin",
        )
        await repo.set_user_signature(
            user["id"],
            filename="signature.png",
            content_type="image/png",
            data_base64="ZmFrZQ==",
        )

        context = await build_document_context_for_user(repo, UserOut(**await repo.get_user(user["id"])))

        assert context["doctor_name"] == "Dr. Rivera"
        assert context["doctor_signature_name"] == "signature.png"
        assert context["doctor_signature_content_type"] == "image/png"
        assert context["doctor_signature_data_base64"] == "ZmFrZQ=="

    asyncio.run(scenario())


def test_case_study_specialty_enrichment_dispatches_only_for_optometry() -> None:
    async def scenario() -> None:
        repo = FakeRepo()
        org = await repo.create_organization("ClinicOS")

        payload = SimpleNamespace(
            model_dump=lambda: {
                "name": "Lina",
                "phone": "1234567890",
                "email": "",
                "address": "",
                "reason": "Progressive myopia",
                "age": 11,
                "weight": 31.5,
                "temperature": 98.6,
                "height": 140.0,
            },
            name="Lina",
            phone="1234567890",
            email="",
            address="",
            reason="Progressive myopia",
            age=11,
            weight=31.5,
            temperature=98.6,
            height=140.0,
        )
        patient = await repo.create_patient(org["id"], payload)

        base_source = PatientCaseStudySourceOut(
            patient={
                **patient,
                "status": patient["status"],
                "billed": patient["billed"],
                "last_visit_at": patient["last_visit_at"],
            },
            visits=[],
            timeline=[],
            notes=[],
            myopia_history=None,
        )

        generic_source = await apply_case_study_specialty_enrichment(
            repo,
            org["id"],
            patient["id"],
            "general_physician",
            base_source,
        )
        assert generic_source.myopia_history is None

        measured_at = _now()
        await repo.create_myopia_measurement(
            org["id"],
            patient["id"],
            SimpleNamespace(
                measured_at=measured_at,
                age_years=11.0,
                axial_length_right_mm=23.11,
                axial_length_left_mm=23.02,
                treatment_type="Observation",
                treatment_notes="",
                visit_notes="",
                refraction_right="",
                refraction_left="",
                model_dump=lambda: {
                    "measured_at": measured_at,
                    "age_years": 11.0,
                    "axial_length_right_mm": 23.11,
                    "axial_length_left_mm": 23.02,
                    "treatment_type": "Observation",
                    "treatment_notes": "",
                    "visit_notes": "",
                    "refraction_right": "",
                    "refraction_left": "",
                },
            ),
        )

        enriched_source = await apply_case_study_specialty_enrichment(
            repo,
            org["id"],
            patient["id"],
            "optometry",
            base_source,
        )
        assert enriched_source.myopia_history is not None
        assert enriched_source.myopia_history.records[0].treatment_type == "Observation"

    asyncio.run(scenario())


def test_serialize_note_assets_uses_model_dump() -> None:
    class FakeAsset:
        def __init__(self, payload: dict) -> None:
            self.payload = payload

        def model_dump(self) -> dict:
            return dict(self.payload)

    assets = [
        FakeAsset({"id": "asset-1", "kind": "attachment"}),
        FakeAsset({"id": "asset-2", "kind": "drawing"}),
    ]

    assert serialize_note_assets(assets) == [
        {"id": "asset-1", "kind": "attachment"},
        {"id": "asset-2", "kind": "drawing"},
    ]
