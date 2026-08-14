from __future__ import annotations

import sys
import asyncio
import copy
import hashlib
import hmac
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

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
from app.schema_domains.patients import calculate_age_from_dob
from app.services.case_study_specialty import apply_case_study_specialty_enrichment
from app.services.document_helpers import build_document_context_for_user, serialize_note_assets
from app.services.followup_workflow import _as_utc_minute
from app.services import followup_workflow as followup_workflow_module
from app.services import followup_booking_service as followup_booking_service_module
from app.storage import get_patient_attachment_storage


def _now() -> datetime:
    return datetime.now(UTC)


def _normalize_phone(phone: str) -> str:
    digits = "".join(char for char in phone if char.isdigit())
    return f"+{digits}" if phone.startswith("+") and digits else digits


def signature_png_bytes() -> bytes:
    from io import BytesIO

    image = Image.new("RGB", (120, 48), "white")
    draw = ImageDraw.Draw(image)
    draw.line((10, 30, 48, 12, 82, 31, 110, 15), fill="black", width=4)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class FakeRepo:
    def __init__(self) -> None:
        self.organizations: dict[str, dict] = {}
        self.clinic_settings: dict[str, dict] = {}
        self.users: dict[str, dict] = {}
        self.patients: dict[str, dict] = {}
        self.patient_visits: dict[str, dict] = {}
        self.notes: dict[str, dict] = {}
        self.optometry_histories: dict[tuple[str, str], dict] = {}
        self.optometry_history_revisions: list[dict] = []
        self.patient_attachments: dict[str, dict] = {}
        self.patient_attachment_files: dict[str, bytes] = {}
        self.myopia_measurements: dict[str, dict] = {}
        self.longitudinal_tracks: dict[str, dict] = {}
        self.referral_packages: dict[str, dict] = {}
        self.referral_deliveries: dict[str, dict] = {}
        self.case_studies: dict[str, dict] = {}
        self.catalog_items: dict[str, dict] = {}
        self.invoices: dict[str, dict] = {}
        self.invoice_items: dict[str, dict] = {}
        self.follow_ups: dict[str, dict] = {}
        self.appointments: dict[str, dict] = {}
        self.audit_events: dict[str, dict] = {}
        self.ai_usage_events: dict[str, dict] = {}
        self.platform_errors: dict[str, dict] = {}
        self.password_reset_tokens: dict[str, dict] = {}
        self.whatsapp_owner_bindings: dict[str, dict] = {}
        self.whatsapp_message_events: dict[str, dict] = {}
        self.public_check_in_requests: dict[str, dict] = {}
        self.api_request_metrics: list[dict] = []
        self.customer_onboarding: dict[str, dict] = {}
        self.rate_limits: dict[tuple[str, str], tuple[float, int]] = {}
        self.platform_email_settings: dict = {
            "sender_name": "ClinicOS",
            "sender_email": "",
            "sender_email_app_password": None,
            "is_enabled": False,
            "last_tested_at": None,
            "last_test_succeeded": False,
            "last_error": "",
            "updated_at": _now(),
        }

    async def consume_rate_limit(
        self,
        *,
        scope: str,
        key_hash: str,
        max_window_seconds: int,
    ) -> int:
        from time import monotonic

        now = monotonic()
        started_at, count = self.rate_limits.get((scope, key_hash), (now, 0))
        if now - started_at > max_window_seconds:
            started_at, count = now, 0
        count += 1
        self.rate_limits[(scope, key_hash)] = (started_at, count)
        return count

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

    async def _apply_audit_event_factory(self, factory, result: dict) -> None:
        if factory is None:
            return
        for event in factory(result):
            await self.create_audit_event(**event)

    async def list_audit_events(self, org_id: str, limit: int = 100) -> list[dict]:
        rows = [
            row for row in self.audit_events.values()
            if row["org_id"] == org_id
        ]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows[:limit]

    async def upsert_whatsapp_owner_binding(
        self,
        *,
        org_id: str,
        wa_id: str,
        phone: str = "",
        display_name: str = "",
        role: str = "owner",
        user_id: str | None = None,
        is_active: bool = True,
    ) -> dict:
        existing = next(
            (row for row in self.whatsapp_owner_bindings.values() if row["wa_id"] == wa_id and row["is_active"]),
            None,
        )
        binding_id = existing["id"] if existing else str(uuid4())
        row = {
            "id": binding_id,
            "org_id": org_id,
            "user_id": user_id,
            "wa_id": wa_id,
            "phone": phone,
            "display_name": display_name,
            "role": role,
            "is_active": is_active,
            "created_at": existing["created_at"] if existing else _now(),
            "updated_at": _now(),
        }
        self.whatsapp_owner_bindings[binding_id] = row
        return dict(row)

    async def get_whatsapp_owner_binding(self, wa_id: str) -> dict | None:
        for row in self.whatsapp_owner_bindings.values():
            if row["wa_id"] == wa_id and row["is_active"]:
                return dict(row)
        return None

    async def record_whatsapp_message_event(
        self,
        *,
        org_id: str | None,
        binding_id: str | None,
        direction: str,
        wa_message_id: str = "",
        sender_wa_id: str = "",
        recipient_wa_id: str = "",
        message_text: str = "",
        intent: str = "",
        status: str,
        error: str = "",
        raw_payload: dict | None = None,
        document_type: str = "",
        document_id: str = "",
        idempotency_key: str = "",
    ) -> dict:
        existing = next(
            (
                row
                for row in self.whatsapp_message_events.values()
                if idempotency_key and row.get("org_id") == org_id and row.get("idempotency_key") == idempotency_key
            ),
            None,
        )
        if existing:
            return dict(existing)
        event_id = str(uuid4())
        row = {
            "id": event_id,
            "org_id": org_id,
            "binding_id": binding_id,
            "direction": direction,
            "wa_message_id": wa_message_id,
            "sender_wa_id": sender_wa_id,
            "recipient_wa_id": recipient_wa_id,
            "message_text": message_text,
            "intent": intent,
            "status": status,
            "error": error,
            "raw_payload": raw_payload or {},
            "document_type": document_type,
            "document_id": document_id,
            "idempotency_key": idempotency_key,
            "created_at": _now(),
            "updated_at": _now(),
        }
        self.whatsapp_message_events[event_id] = row
        return dict(row)

    async def get_whatsapp_message_event_by_idempotency(self, org_id: str, idempotency_key: str) -> dict | None:
        return next(
            (
                dict(row)
                for row in self.whatsapp_message_events.values()
                if row.get("org_id") == org_id and row.get("idempotency_key") == idempotency_key
            ),
            None,
        )

    async def update_whatsapp_message_status(
        self,
        wa_message_id: str,
        *,
        status: str,
        error: str = "",
        raw_payload: dict | None = None,
    ) -> dict | None:
        ranks = {"sent": 1, "accepted": 1, "delivered": 2, "read": 3, "failed": 4}
        for row in self.whatsapp_message_events.values():
            if row.get("wa_message_id") != wa_message_id:
                continue
            if status == "failed" or ranks.get(status, 0) >= ranks.get(str(row.get("status")), 0):
                row["status"] = status
            if error:
                row["error"] = error
            row["raw_payload"] = {**row.get("raw_payload", {}), **(raw_payload or {})}
            row["updated_at"] = _now()
            return dict(row)
        return None

    async def update_whatsapp_message_event(
        self,
        event_id: str,
        *,
        status: str,
        wa_message_id: str = "",
        error: str = "",
        raw_payload: dict | None = None,
    ) -> dict:
        row = self.whatsapp_message_events[event_id]
        row["status"] = status
        if wa_message_id:
            row["wa_message_id"] = wa_message_id
        row["error"] = error
        row["raw_payload"] = {**row.get("raw_payload", {}), **(raw_payload or {})}
        row["updated_at"] = _now()
        return dict(row)

    async def get_latest_whatsapp_document_event(
        self,
        org_id: str,
        document_type: str,
        document_id: str,
    ) -> dict | None:
        matches = [
            row
            for row in self.whatsapp_message_events.values()
            if row.get("org_id") == org_id
            and row.get("document_type") == document_type
            and row.get("document_id") == document_id
        ]
        return dict(matches[-1]) if matches else None

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
            attachments = [row for row in self.patient_attachments.values() if row["org_id"] == org_id]
            recent_errors = [row for row in self.platform_errors.values() if row.get("org_id") == org_id]
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
                    "workspace_mode": clinic_settings.get("workspace_mode") or "solo",
                    "users_allowed": int(clinic_settings.get("users_allowed") or 2),
                    "clinic_specialty": clinic_settings.get("clinic_specialty"),
                    "created_at": org["created_at"],
                    "user_count": len(users),
                    "patient_count": len(patients),
                    "note_count": len(notes),
                    "invoice_count": len(invoices),
                    "follow_up_count": len(follow_ups),
                    "total_tokens": sum(int(event.get("total_tokens") or 0) for event in usage_events),
                    "media_storage_bytes": sum(int(row.get("file_size") or 0) for row in attachments),
                    "recent_error_count": len(recent_errors),
                    "last_activity_at": last_activity,
                }
            )
        return summaries

    async def create_customer_onboarding(
        self,
        *,
        customer_id: str,
        customer_name: str,
        phone: str,
        users_allowed: int,
        workspace_mode: str = "solo",
        created_by: str | None = None,
    ) -> dict:
        if customer_id in self.customer_onboarding:
            raise ValueError("Customer onboarding record already exists.")
        onboarding_id = str(uuid4())
        row = {
            "id": onboarding_id,
            "customer_id": customer_id,
            "customer_name": customer_name,
            "phone": _normalize_phone(phone),
            "users_allowed": users_allowed,
            "workspace_mode": workspace_mode,
            "status": "pending",
            "claimed_org_id": None,
            "claimed_at": None,
            "created_by": created_by,
            "created_at": _now(),
            "updated_at": _now(),
        }
        self.customer_onboarding[customer_id] = row
        return dict(row)

    async def list_customer_onboarding(self) -> list[dict]:
        rows = []
        for row in self.customer_onboarding.values():
            claimed_org_id = row.get("claimed_org_id")
            settings = self.clinic_settings.get(claimed_org_id or "", {})
            org = self.organizations.get(claimed_org_id or "", {})
            users_used = sum(1 for user in self.users.values() if user["org_id"] == claimed_org_id)
            rows.append(
                {
                    **row,
                    "claimed_org_name": settings.get("clinic_name") or org.get("name"),
                    "users_used": users_used,
                }
            )
        rows.sort(key=lambda item: item["created_at"], reverse=True)
        return rows

    async def get_customer_onboarding_by_customer_id(self, customer_id: str) -> dict | None:
        row = self.customer_onboarding.get(customer_id)
        return dict(row) if row else None

    async def get_customer_onboarding_for_org(self, org_id: str) -> dict | None:
        for row in self.customer_onboarding.values():
            if row.get("claimed_org_id") == org_id:
                return dict(row)
        return None

    async def claim_customer_onboarding(self, customer_id: str, org_id: str) -> dict:
        row = self.customer_onboarding.get(customer_id)
        if not row or row.get("status") != "pending":
            raise ValueError("Invalid customer ID or phone number.")
        row["status"] = "claimed"
        row["claimed_org_id"] = org_id
        row["claimed_at"] = _now()
        row["updated_at"] = _now()
        return dict(row)

    async def provision_customer_organization(
        self,
        *,
        customer_id: str,
        expected_phone: str,
        clinic_settings,
        identifier: str,
        email: str,
        phone: str,
        name: str,
        password_hash: str,
    ) -> dict:
        onboarding = self.customer_onboarding.get(customer_id)
        if (
            not onboarding
            or onboarding.get("status") != "pending"
            or _normalize_phone(onboarding.get("phone", "")) != _normalize_phone(expected_phone)
        ):
            raise ValueError("Invalid customer ID or phone number.")
        if any(user["identifier"] == identifier for user in self.users.values()):
            raise ValueError("An account with that email or phone already exists.")

        organization = await self.create_organization(str(clinic_settings.clinic_name or ""))
        org_id = str(organization["id"])
        try:
            provisioned_settings = clinic_settings.model_copy(
                update={
                    "workspace_mode": onboarding.get("workspace_mode") or "solo",
                    "users_allowed": int(onboarding.get("users_allowed") or 2),
                }
            )
            await self.create_clinic_settings(org_id, provisioned_settings)
            created = await self.create_user(
                org_id=org_id,
                identifier=identifier,
                email=email,
                phone=phone,
                name=name,
                password_hash=password_hash,
                role="admin",
            )
            await self.claim_customer_onboarding(customer_id, org_id)
            return created
        except Exception:
            self.organizations.pop(org_id, None)
            self.clinic_settings.pop(org_id, None)
            self.users = {
                user_id: user
                for user_id, user in self.users.items()
                if user["org_id"] != org_id
            }
            raise

    async def provision_open_organization(
        self,
        *,
        clinic_settings,
        identifier: str,
        email: str,
        phone: str,
        name: str,
        password_hash: str,
    ) -> dict:
        if any(user["identifier"] == identifier for user in self.users.values()):
            raise ValueError("An account with that email or phone already exists.")
        organization = await self.create_organization(str(clinic_settings.clinic_name or ""))
        org_id = str(organization["id"])
        try:
            await self.create_clinic_settings(org_id, clinic_settings)
            return await self.create_user(
                org_id=org_id,
                identifier=identifier,
                email=email,
                phone=phone,
                name=name,
                password_hash=password_hash,
                role="admin",
            )
        except Exception:
            self.organizations.pop(org_id, None)
            self.clinic_settings.pop(org_id, None)
            self.users = {
                user_id: user
                for user_id, user in self.users.items()
                if user["org_id"] != org_id
            }
            raise

    async def update_customer_onboarding(self, onboarding_id: str, payload: dict) -> dict:
        for row in self.customer_onboarding.values():
            if row["id"] != onboarding_id:
                continue
            if "users_allowed" in payload and row.get("claimed_org_id"):
                users_used = await self.count_users_for_org(row["claimed_org_id"])
                if int(payload["users_allowed"]) < users_used:
                    raise ValueError(f"User limit cannot be lower than the {users_used} existing users.")
            for key in ("customer_name", "phone", "users_allowed", "workspace_mode", "status"):
                if key in payload and payload[key] is not None:
                    row[key] = _normalize_phone(payload[key]) if key == "phone" else payload[key]
            if "workspace_mode" in payload and row.get("claimed_org_id"):
                self.clinic_settings[row["claimed_org_id"]]["workspace_mode"] = row["workspace_mode"]
            if "users_allowed" in payload and row.get("claimed_org_id"):
                self.clinic_settings[row["claimed_org_id"]]["users_allowed"] = int(row["users_allowed"])
            row["updated_at"] = _now()
            return dict(row)
        raise ValueError("Customer onboarding record not found.")

    async def disable_customer_onboarding(self, onboarding_id: str) -> dict:
        return await self.update_customer_onboarding(onboarding_id, {"status": "disabled"})

    async def update_organization_workspace_mode(self, org_id: str, workspace_mode: str) -> str:
        settings = self.clinic_settings.get(org_id)
        if not settings:
            raise ValueError("Organization settings not found.")
        settings["workspace_mode"] = workspace_mode
        settings["updated_at"] = _now()
        for row in self.customer_onboarding.values():
            if row.get("claimed_org_id") == org_id:
                row["workspace_mode"] = workspace_mode
                row["updated_at"] = _now()
        return workspace_mode

    async def update_organization_users_allowed(self, org_id: str, users_allowed: int) -> int:
        settings = self.clinic_settings.get(org_id)
        if not settings:
            raise ValueError("Organization settings not found.")
        users_used = await self.count_users_for_org(org_id)
        if users_allowed < users_used:
            raise ValueError(f"User limit cannot be lower than the {users_used} existing users.")
        settings["users_allowed"] = users_allowed
        settings["updated_at"] = _now()
        for row in self.customer_onboarding.values():
            if row.get("claimed_org_id") == org_id:
                row["users_allowed"] = users_allowed
                row["updated_at"] = _now()
        return users_allowed

    async def count_users_for_org(self, org_id: str) -> int:
        return sum(1 for user in self.users.values() if user["org_id"] == org_id)

    async def count_admins_for_org(self, org_id: str) -> int:
        return sum(
            1
            for user in self.users.values()
            if user["org_id"] == org_id and user["role"] == "admin"
        )

    async def list_users_for_org_any(self, org_id: str) -> list[dict]:
        rows = [row for row in self.users.values() if row["org_id"] == org_id]
        rows.sort(key=lambda row: row["created_at"])
        return rows

    async def list_ai_usage_events_for_org(self, org_id: str, limit: int = 100) -> list[dict]:
        rows = [row for row in self.ai_usage_events.values() if row["org_id"] == org_id]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows[:limit]

    async def get_superdashboard_ai_metrics(self, days: int = 7) -> dict:
        since = _now().date() - timedelta(days=max(days, 1) - 1)
        rows = [
            row for row in self.ai_usage_events.values()
            if row["created_at"].date() >= since
        ]
        daily: dict[str, dict] = {}
        for row in rows:
            key = row["created_at"].date().isoformat()
            metric = daily.setdefault(key, {"date": key, "request_count": 0, "total_tokens": 0})
            metric["request_count"] += 1
            metric["total_tokens"] += int(row.get("total_tokens") or 0)
        return {
            "request_count": len(rows),
            "total_tokens": sum(int(row.get("total_tokens") or 0) for row in rows),
            "daily": list(daily.values()),
        }

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

    async def record_api_request_batch(self, rows: list[dict[str, str | int]]) -> None:
        for row in rows:
            metric_date = datetime.fromisoformat(str(row["metric_date"])).replace(tzinfo=UTC)
            self.api_request_metrics.append(
                {
                    "org_id": str(row.get("org_id") or "") or None,
                    "request_count": int(row["request_count"]),
                    "error_response_count": int(row["error_response_count"]),
                    "created_at": metric_date,
                }
            )

    async def get_superdashboard_request_metrics(self, days: int = 7) -> dict:
        since = _now().date() - timedelta(days=max(days, 1) - 1)
        requests = [
            row for row in self.api_request_metrics
            if row["created_at"].date() >= since
        ]
        errors = [
            row for row in self.platform_errors.values()
            if row["created_at"].date() >= since
        ]
        daily: dict[str, dict] = {}
        for row in requests:
            key = row["created_at"].date().isoformat()
            metric = daily.setdefault(
                key,
                {"date": key, "request_count": 0, "error_response_count": 0},
            )
            metric["request_count"] += int(row.get("request_count", 1))
            metric["error_response_count"] += int(
                row.get("error_response_count", int(row.get("status_code", 0) >= 500))
            )
        contexts = Counter(str(row.get("path") or row.get("error_type") or "unknown") for row in errors)
        return {
            "request_count": sum(int(row.get("request_count", 1)) for row in requests),
            "error_response_count": sum(
                int(row.get("error_response_count", int(row.get("status_code", 0) >= 500)))
                for row in requests
            ),
            "error_count": len(errors),
            "top_error_context": contexts.most_common(1)[0][0] if contexts else "",
            "daily": list(daily.values()),
        }

    async def get_controlroom_database_overview(self) -> dict:
        checked_at = _now()
        checks = [
            (
                "invoice_items_invoice_org",
                "Invoice item org matches invoice org",
                sum(
                    1
                    for item in self.invoice_items.values()
                    if not self.invoices.get(item.get("invoice_id"))
                    or item.get("org_id") != self.invoices[item.get("invoice_id")].get("org_id")
                ),
            ),
            (
                "invoice_items_catalog_org",
                "Invoice item org matches catalog item org",
                sum(
                    1
                    for item in self.invoice_items.values()
                    if item.get("catalog_item_id")
                    and self.catalog_items.get(item.get("catalog_item_id"))
                    and item.get("org_id") != self.catalog_items[item.get("catalog_item_id")].get("org_id")
                ),
            ),
            (
                "users_valid_org",
                "Users belong to valid organizations",
                sum(1 for user in self.users.values() if user.get("org_id") not in self.organizations),
            ),
            (
                "settings_valid_org",
                "Clinic settings belong to valid organizations",
                sum(1 for row in self.clinic_settings.values() if row.get("org_id") not in self.organizations),
            ),
            (
                "patients_valid_org",
                "Patients belong to valid organizations",
                sum(1 for row in self.patients.values() if row.get("org_id") not in self.organizations),
            ),
            (
                "whatsapp_binding_user_org",
                "WhatsApp bindings point to valid org/users",
                sum(
                    1
                    for row in self.whatsapp_owner_bindings.values()
                    if row.get("org_id") not in self.organizations
                    or (
                        row.get("user_id")
                        and (
                            row.get("user_id") not in self.users
                            or self.users[row.get("user_id")].get("org_id") != row.get("org_id")
                        )
                    )
                ),
            ),
        ]
        return {
            "checked_at": checked_at,
            "reachable": True,
            "migration_status": "healthy",
            "pending_migrations": [],
            "database_only_migrations": [],
            "applied_migrations": [
                {
                    "name": "2026-07-23_tenant_integrity_schema_drift.sql",
                    "checksum_sha256": "test-checksum",
                    "applied_at": checked_at,
                }
            ],
            "table_stats": [
                {"table_name": "organizations", "estimated_rows": len(self.organizations)},
                {"table_name": "clinic_users", "estimated_rows": len(self.users)},
                {"table_name": "patients", "estimated_rows": len(self.patients)},
                {"table_name": "platform_errors", "estimated_rows": len(self.platform_errors)},
            ],
            "integrity_checks": [
                {
                    "key": key,
                    "label": label,
                    "status": "healthy" if invalid_count == 0 else "failing",
                    "invalid_count": invalid_count,
                    "evidence": f"{invalid_count} invalid rows.",
                }
                for key, label, invalid_count in checks
            ],
        }

    async def get_controlroom_status_metrics(self) -> dict:
        database = await self.get_controlroom_database_overview()
        since_24h = _now() - timedelta(hours=24)
        since_1h = _now() - timedelta(hours=1)
        requests = [row for row in self.api_request_metrics if row["created_at"] >= since_24h]
        errors_1h = [row for row in self.platform_errors.values() if row["created_at"] >= since_1h]
        whatsapp_failed = [
            row for row in self.whatsapp_message_events.values()
            if row.get("status") == "failed" and row.get("created_at", _now()) >= since_24h
        ]
        due_followups = [
            row for row in self.follow_ups.values()
            if row.get("status") == "scheduled" and row.get("scheduled_for", _now()) <= _now()
        ]
        return {
            "database": database,
            "request_metrics_24h": {
                "request_count": sum(int(row.get("request_count", 1)) for row in requests),
                "error_response_count": sum(
                    int(row.get("error_response_count", int(row.get("status_code", 0) >= 500)))
                    for row in requests
                ),
            },
            "errors_1h": {
                "error_count": len(errors_1h),
                "top_error_context": Counter(str(row.get("path") or "") for row in errors_1h).most_common(1)[0][0]
                if errors_1h
                else "",
            },
            "whatsapp_24h": {"failed_count": len(whatsapp_failed), "last_failed_at": None},
            "followups_due": {
                "due_count": len(due_followups),
                "error_count": sum(int(bool(row.get("reminder_last_error"))) for row in due_followups),
            },
            "ai_usage_24h": {
                "request_count": len([row for row in self.ai_usage_events.values() if row["created_at"] >= since_24h]),
                "total_tokens": sum(
                    int(row.get("total_tokens") or 0)
                    for row in self.ai_usage_events.values()
                    if row["created_at"] >= since_24h
                ),
            },
            "email": {
                "configured_org_count": sum(
                    int(bool(row.get("sender_email")) and bool(row.get("sender_email_app_password")))
                    for row in self.clinic_settings.values()
                )
            },
            "storage": {
                "media_storage_bytes": sum(int(row.get("file_size") or 0) for row in self.patient_attachments.values())
            },
        }

    async def list_controlroom_incidents(self, *, window_hours: int = 24, limit: int = 500) -> list[dict]:
        since = _now() - timedelta(hours=window_hours)
        rows = [
            row for row in self.platform_errors.values()
            if row["created_at"] >= since
        ]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        groups: dict[str, dict] = {}
        for row in rows[:limit]:
            basis = "|".join([
                str(row.get("method") or ""),
                str(row.get("path") or ""),
                str(row.get("status_code") or ""),
                str(row.get("error_type") or ""),
                str(row.get("message") or "").lower(),
            ])
            fingerprint = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]
            group = groups.setdefault(
                fingerprint,
                {
                    "fingerprint": fingerprint,
                    "severity": "high" if int(row.get("status_code") or 0) >= 500 else "low",
                    "method": row.get("method") or "",
                    "path": row.get("path") or "",
                    "status_code": row.get("status_code"),
                    "error_type": row.get("error_type") or "",
                    "message": row.get("message") or "",
                    "count": 0,
                    "org_ids": set(),
                    "user_ids": set(),
                    "first_seen_at": row["created_at"],
                    "last_seen_at": row["created_at"],
                    "latest_sample": row,
                },
            )
            group["count"] += 1
            if row.get("org_id"):
                group["org_ids"].add(row["org_id"])
            if row.get("user_id"):
                group["user_ids"].add(row["user_id"])
            group["first_seen_at"] = min(group["first_seen_at"], row["created_at"])
            group["last_seen_at"] = max(group["last_seen_at"], row["created_at"])
        return [
            {
                **group,
                "affected_org_count": len(group["org_ids"]),
                "affected_user_count": len(group["user_ids"]),
            }
            for group in sorted(groups.values(), key=lambda item: item["count"], reverse=True)
        ]

    async def delete_user_any(self, user_id: str) -> None:
        self.users.pop(user_id, None)

    async def delete_organization(self, org_id: str) -> bool:
        return self.organizations.pop(org_id, None) is not None

    async def create_clinic_settings(self, org_id: str, payload) -> dict:
        settings_id = str(uuid4())
        values = payload.model_dump(exclude_unset=True, exclude={"email_configured"})
        row = {
            "id": settings_id,
            "org_id": org_id,
            "document_template_content_type": None,
            "document_template_data_base64": None,
            "document_template_signature_x": 0.1,
            "document_template_signature_y": 0.78,
            "document_template_signature_width": 0.24,
            "document_template_signature_height": 0.08,
            "document_template_doctor_name_x": 0.1,
            "document_template_doctor_name_y": 0.87,
            "document_template_doctor_name_width": 0.24,
            "document_template_doctor_name_height": 0.04,
            "document_template_note_layout": {},
            "sender_email_app_password": None,
            "email_sender_mode": "clinicos",
            "clinic_specialty": None,
            "timezone": "UTC",
            "onboarding_required": False,
            "onboarding_completed_at": None,
            "workspace_mode": "solo",
            "gstin": "",
            "public_check_in_enabled": False,
            "public_check_in_token": str(uuid4()),
            **values,
            "updated_at": _now(),
        }
        self.clinic_settings[org_id] = row
        return row

    async def get_clinic_settings(self, org_id: str) -> dict:
        return self.clinic_settings.get(org_id, {})

    async def get_public_check_in_config(self, org_id: str) -> dict:
        settings = self.clinic_settings[org_id]
        return {
            "org_id": org_id,
            "clinic_name": settings["clinic_name"],
            "clinic_address": settings.get("clinic_address", ""),
            "clinic_phone": settings.get("clinic_phone", ""),
            "enabled": settings.get("public_check_in_enabled", False),
            "token": settings["public_check_in_token"],
        }

    async def get_public_check_in_config_by_token(self, token: str) -> dict:
        for org_id, settings in self.clinic_settings.items():
            if settings.get("public_check_in_token") != token:
                continue
            if not settings.get("public_check_in_enabled"):
                raise ValueError("Online check-in is currently closed for this clinic.")
            return {
                "org_id": org_id,
                "clinic_name": settings["clinic_name"],
                "clinic_address": settings.get("clinic_address", ""),
                "clinic_phone": settings.get("clinic_phone", ""),
                "enabled": True,
                "token": token,
            }
        raise ValueError("This clinic check-in link is invalid.")

    async def update_public_check_in_enabled(self, org_id: str, enabled: bool) -> dict:
        self.clinic_settings[org_id]["public_check_in_enabled"] = enabled
        return await self.get_public_check_in_config(org_id)

    async def regenerate_public_check_in_token(self, org_id: str) -> dict:
        self.clinic_settings[org_id]["public_check_in_token"] = str(uuid4())
        return await self.get_public_check_in_config(org_id)

    async def create_public_check_in_request(
        self,
        *,
        org_id: str,
        name: str,
        phone: str,
        email: str,
        date_of_birth,
        sex_at_birth: str,
        reason: str,
    ) -> dict:
        normalized_phone = _normalize_phone(phone)
        if any(
            row["org_id"] == org_id
            and row["submitted_phone_normalized"] == normalized_phone
            and row["submitted_date_of_birth"] == date_of_birth
            and row["status"] == "pending"
            for row in self.public_check_in_requests.values()
        ):
            raise ValueError("A check-in request with these details is already waiting for review.")
        request_id = str(uuid4())
        tracking_token = str(uuid4())
        row = {
            "id": request_id,
            "org_id": org_id,
            "submitted_name": name.strip(),
            "submitted_phone": phone.strip(),
            "submitted_phone_normalized": normalized_phone,
            "submitted_email": email.strip().lower(),
            "submitted_date_of_birth": date_of_birth,
            "submitted_sex_at_birth": sex_at_birth,
            "submitted_reason": reason.strip(),
            "status": "pending",
            "approved_patient_id": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "rejection_reason": "",
            "created_at": _now(),
            "expires_at": _now() + timedelta(hours=12),
            "tracking_token_hash": hashlib.sha256(tracking_token.encode("utf-8")).hexdigest(),
        }
        self.public_check_in_requests[request_id] = row
        return {**row, "tracking_token": tracking_token}

    async def get_public_check_in_status(self, tracking_token: str) -> dict:
        tracking_token_hash = hashlib.sha256(tracking_token.encode("utf-8")).hexdigest()
        request = next(
            (
                row
                for row in self.public_check_in_requests.values()
                if row.get("tracking_token_hash") == tracking_token_hash
            ),
            None,
        )
        if request is None:
            raise ValueError("Check-in request not found.")
        status = request["status"]
        if status == "pending" and request["expires_at"] <= _now():
            status = "expired"
        return {"status": status}

    async def get_public_check_in_requests_status(self, org_id: str) -> dict:
        request_ids = sorted(
            str(request["id"])
            for request in self.public_check_in_requests.values()
            if request["org_id"] == org_id
            and request["status"] == "pending"
            and request["expires_at"] > _now()
        )
        return {
            "pending_count": len(request_ids),
            "revision": hashlib.sha256(",".join(request_ids).encode("utf-8")).hexdigest(),
        }

    async def get_dashboard_queue_revision(self, org_id: str) -> str:
        queue_state = [
            {
                "id": row["id"],
                "status": row["status"],
                "billed": row["billed"],
                "queue_priority": row.get("queue_priority"),
                "queue_position": row.get("queue_position"),
                "current_visit_id": row.get("current_visit_id"),
                "last_visit_at": row.get("last_visit_at"),
            }
            for row in self.patients.values()
            if row["org_id"] == org_id
            and (
                row["status"] in {"waiting", "consultation"}
                or (row["status"] == "done" and not row["billed"])
            )
        ]
        serialized = json.dumps(queue_state, sort_keys=True, default=str)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    async def get_dashboard_status(self, org_id: str) -> dict:
        check_ins = await self.get_public_check_in_requests_status(org_id)
        active_count = sum(
            1
            for row in self.patients.values()
            if row["org_id"] == org_id
            and (
                row["status"] in {"waiting", "consultation"}
                or (row["status"] == "done" and not row["billed"])
            )
        )
        return {
            "queue_revision": await self.get_dashboard_queue_revision(org_id),
            "active_patient_count": active_count,
            "check_in_revision": f"{check_ins['revision']}:{check_ins['pending_count']}",
            "pending_check_in_count": check_ins["pending_count"],
        }

    async def get_billing_status(self, org_id: str) -> dict:
        billable = [
            {
                "id": row["id"],
                "name": row["name"],
                "status": row["status"],
                "billed": row["billed"],
                "last_visit_at": row["last_visit_at"],
            }
            for row in self.patients.values()
            if row["org_id"] == org_id and row["status"] == "done" and not row["billed"]
        ]
        invoices = [
            {
                "id": row["id"],
                "patient_id": row["patient_id"],
                "total": row["total"],
                "amount_paid": row.get("amount_paid", 0),
                "payment_status": row["payment_status"],
                "items": [item.get("id") for item in row.get("items", [])],
            }
            for row in self.invoices.values()
            if row["org_id"] == org_id
        ]
        return {
            "billable_patients_revision": hashlib.sha256(
                json.dumps(billable, sort_keys=True, default=str).encode("utf-8")
            ).hexdigest(),
            "billable_patient_count": len(billable),
            "invoices_revision": hashlib.sha256(
                json.dumps(invoices, sort_keys=True, default=str).encode("utf-8")
            ).hexdigest(),
        }

    async def list_invoice_summaries(self, org_id: str, limit: int = 5) -> list[dict]:
        rows = []
        for invoice in self.invoices.values():
            if invoice["org_id"] != org_id:
                continue
            patient = self.patients.get(invoice["patient_id"])
            rows.append({
                "id": invoice["id"],
                "patient_id": invoice["patient_id"],
                "patient_name": patient["name"] if patient else None,
                "item_count": len(invoice.get("items", [])),
                "total": invoice["total"],
                "payment_status": invoice["payment_status"],
                "amount_paid": invoice.get("amount_paid", 0),
                "balance_due": round(
                    max(float(invoice.get("total") or 0) - float(invoice.get("amount_paid") or 0), 0),
                    2,
                ),
                "created_at": invoice["created_at"],
            })
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows[:limit]

    async def get_billing_dashboard(self, org_id: str, recent_invoice_limit: int = 5) -> dict:
        return {
            **await self.get_billing_status(org_id),
            "recent_invoices": await self.list_invoice_summaries(org_id, recent_invoice_limit),
        }

    async def list_public_check_in_requests(self, org_id: str) -> list[dict]:
        rows = []
        for request in self.public_check_in_requests.values():
            if (
                request["org_id"] != org_id
                or request["status"] != "pending"
                or request["expires_at"] <= _now()
            ):
                continue
            candidates = []
            request_phone = _normalize_phone(request["submitted_phone"])
            request_email = request["submitted_email"]
            request_name = " ".join(request["submitted_name"].lower().split())
            for patient in self.patients.values():
                if patient["org_id"] != org_id:
                    continue
                reasons = []
                score = 0
                if (
                    _normalize_phone(patient["phone"])
                    and _normalize_phone(patient["phone"])[-10:] == request_phone[-10:]
                ):
                    reasons.append("Phone match")
                    score += 70
                if request_email and patient.get("email", "").strip().lower() == request_email:
                    reasons.append("Email match")
                    score += 70
                if patient.get("date_of_birth") == request["submitted_date_of_birth"]:
                    reasons.append("Date of birth match")
                    score += 20
                if " ".join(patient["name"].lower().split()) == request_name:
                    reasons.append("Name match")
                    score += 20
                if score < 20:
                    continue
                candidates.append(
                    {
                        **patient,
                        "match_reasons": reasons,
                        "confidence": "strong" if score >= 90 else "likely" if score >= 70 else "possible",
                    }
                )
            rows.append({**request, "candidates": candidates[:5]})
        rows.sort(key=lambda row: row["created_at"])
        return rows

    async def approve_public_check_in_request(
        self,
        *,
        org_id: str,
        request_id: str,
        reviewed_by: str,
        existing_patient_id: str | None,
        assigned_doctor_id: str | None = None,
    ) -> dict:
        from app.schema_domains.patients import PatientCreate, PatientVisitCreate

        request = self.public_check_in_requests[request_id]
        if (
            request["org_id"] != org_id
            or request["status"] != "pending"
            or request["expires_at"] <= _now()
        ):
            raise ValueError("This check-in request is no longer pending.")
        if existing_patient_id:
            patient = self.patients[existing_patient_id]
            if patient["org_id"] != org_id:
                raise ValueError("Existing patient not found for this clinic.")
            if patient["status"] in {"waiting", "consultation"} or (
                patient["status"] == "done" and not patient["billed"]
            ):
                raise ValueError("This patient is already active in today's queue.")
            payload = PatientVisitCreate(
                name=patient["name"],
                phone=patient["phone"],
                email=patient.get("email", ""),
                address=patient.get("address", ""),
                reason=request["submitted_reason"],
                date_of_birth=patient.get("date_of_birth"),
                sex_at_birth=patient.get("sex_at_birth"),
                gender_identity=patient.get("gender_identity", ""),
                age=patient.get("age"),
                weight=patient.get("weight"),
                height=patient.get("height"),
                temperature=patient.get("temperature"),
            )
            saved = await self.create_patient_visit(org_id, existing_patient_id, payload)
        else:
            saved = await self.create_patient(
                org_id,
                PatientCreate(
                    name=request["submitted_name"],
                    phone=request["submitted_phone"],
                    email=request["submitted_email"],
                    reason=request["submitted_reason"],
                    date_of_birth=request["submitted_date_of_birth"],
                    sex_at_birth=request["submitted_sex_at_birth"],
                    assigned_doctor_id=assigned_doctor_id,
                ),
            )
        request.update(
            {
                "status": "approved",
                "approved_patient_id": saved["id"],
                "reviewed_by": reviewed_by,
                "reviewed_at": _now(),
            }
        )
        return saved

    async def reject_public_check_in_request(
        self,
        *,
        org_id: str,
        request_id: str,
        reviewed_by: str,
        reason: str,
    ) -> dict:
        request = self.public_check_in_requests[request_id]
        if (
            request["org_id"] != org_id
            or request["status"] != "pending"
            or request["expires_at"] <= _now()
        ):
            raise ValueError("This check-in request is no longer pending.")
        request.update(
            {
                "status": "rejected",
                "reviewed_by": reviewed_by,
                "reviewed_at": _now(),
                "rejection_reason": reason,
            }
        )
        return request

    async def get_platform_email_settings(self) -> dict:
        return dict(self.platform_email_settings)

    async def upsert_platform_email_settings(
        self,
        *,
        sender_name: str,
        sender_email: str,
        sender_email_app_password: str,
        is_enabled: bool,
        last_test_succeeded: bool,
        last_error: str,
        updated_by: str,
    ) -> dict:
        self.platform_email_settings = {
            "sender_name": sender_name,
            "sender_email": sender_email,
            "sender_email_app_password": sender_email_app_password,
            "is_enabled": is_enabled,
            "last_tested_at": _now(),
            "last_test_succeeded": last_test_succeeded,
            "last_error": last_error,
            "updated_by": updated_by,
            "updated_at": _now(),
        }
        return dict(self.platform_email_settings)

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
                    "document_template_signature_x": 0.1,
                    "document_template_signature_y": 0.78,
                    "document_template_signature_width": 0.24,
                    "document_template_signature_height": 0.08,
                    "document_template_doctor_name_x": 0.1,
                    "document_template_doctor_name_y": 0.87,
                    "document_template_doctor_name_width": 0.24,
                    "document_template_doctor_name_height": 0.04,
                    "document_template_note_layout": {},
                    "sender_email_app_password": None,
                    "email_sender_mode": "clinicos",
                    "clinic_specialty": None,
                    "timezone": "UTC",
                    "onboarding_required": False,
                    "onboarding_completed_at": None,
                    "workspace_mode": "solo",
                    "public_check_in_enabled": False,
                    "public_check_in_token": str(uuid4()),
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

    async def create_user(
        self,
        org_id: str,
        identifier: str,
        email: str = "",
        phone: str = "",
        name: str = "",
        password_hash: str = "",
        role: str = "staff",
    ) -> dict:
        settings = self.clinic_settings.get(org_id, {})
        users_allowed = int(settings.get("users_allowed") or 2)
        users_used = sum(1 for user in self.users.values() if user["org_id"] == org_id)
        if users_used >= users_allowed:
            raise ValueError("User limit reached for this customer.")
        user_id = str(uuid4())
        user = {
            "id": user_id,
            "org_id": org_id,
            "identifier": identifier,
            "email": email,
            "phone": phone,
            "name": name.strip() or (identifier.split("@", 1)[0].title() if "@" in identifier else identifier),
            "password_hash": password_hash,
            "role": role,
            "doctor_dob": None,
            "doctor_address": "",
            "doctor_signature_name": None,
            "doctor_signature_content_type": None,
            "doctor_signature_data_base64": None,
            "session_version": 1,
            "superdashboard_session_version": 1,
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
            "email": user.get("email", ""),
            "phone": user.get("phone", ""),
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
            "session_version": user.get("session_version", 1),
            "superdashboard_session_version": user.get("superdashboard_session_version", 1),
            "created_at": user["created_at"],
        }

    async def get_auth_user(self, user_id: str) -> dict:
        user = self.users[user_id]
        return {
            "id": user["id"],
            "org_id": user["org_id"],
            "identifier": user["identifier"],
            "email": user.get("email", ""),
            "phone": user.get("phone", ""),
            "name": user["name"],
            "role": user["role"],
            "doctor_dob": user.get("doctor_dob"),
            "doctor_address": user.get("doctor_address", ""),
            "doctor_signature_name": user.get("doctor_signature_name"),
            "doctor_signature_content_type": user.get("doctor_signature_content_type"),
            "doctor_signature_url": (
                f"/users/{user_id}/signature/file" if user.get("doctor_signature_name") else None
            ),
            "session_version": user.get("session_version", 1),
            "superdashboard_session_version": user.get("superdashboard_session_version", 1),
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
                "email": user.get("email", ""),
                "phone": user.get("phone", ""),
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

    async def update_user_role(self, org_id: str, user_id: str, payload) -> dict:
        user = self.users.get(user_id)
        if user is None or user["org_id"] != org_id:
            raise IndexError(user_id)
        if user["role"] == "admin" and payload.role != "admin":
            admin_count = await self.count_admins_for_org(org_id)
            if admin_count <= 1:
                raise ValueError("Every clinic must retain at least one admin.")
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
        user["session_version"] = int(user.get("session_version", 1)) + 1
        user["superdashboard_session_version"] = int(user.get("superdashboard_session_version", 1)) + 1
        return dict(user)

    async def create_password_reset_token(
        self,
        *,
        user_id: str,
        token_hash: str,
        requested_by_user_id: str | None,
        requested_by_name: str,
        requester_realm: str,
        expires_at,
    ) -> dict:
        now = _now()
        for token in self.password_reset_tokens.values():
            if token.get("user_id") == user_id and token.get("used_at") is None:
                token["used_at"] = now
        token_id = str(uuid4())
        row = {
            "id": token_id,
            "user_id": user_id,
            "token_hash": token_hash,
            "requested_by_user_id": requested_by_user_id,
            "requested_by_name": requested_by_name,
            "requester_realm": requester_realm,
            "expires_at": expires_at,
            "used_at": None,
            "created_at": now,
        }
        self.password_reset_tokens[token_id] = row
        return dict(row)

    async def consume_password_reset_token(self, token_hash: str, new_password_hash: str) -> dict | None:
        now = _now()
        for token in self.password_reset_tokens.values():
            if token["token_hash"] != token_hash or token.get("used_at") is not None or token["expires_at"] <= now:
                continue
            user = self.users[token["user_id"]]
            user["password_hash"] = new_password_hash
            user["session_version"] = int(user.get("session_version", 1)) + 1
            user["superdashboard_session_version"] = int(user.get("superdashboard_session_version", 1)) + 1
            token["used_at"] = now
            return dict(user)
        return None

    async def revoke_user_sessions(self, user_id: str) -> None:
        user = self.users[user_id]
        user["session_version"] = int(user.get("session_version", 1)) + 1

    async def revoke_superdashboard_sessions(self, user_id: str) -> None:
        user = self.users[user_id]
        user["superdashboard_session_version"] = int(user.get("superdashboard_session_version", 1)) + 1

    async def delete_user(self, org_id: str, user_id: str) -> None:
        user = self.users.get(user_id)
        if user is None or user["org_id"] != org_id:
            raise IndexError(user_id)
        if user["role"] == "admin":
            admin_count = await self.count_admins_for_org(org_id)
            if admin_count <= 1:
                raise ValueError("Every clinic must retain at least one admin.")
        self.users.pop(user_id, None)

    async def set_user_signature(self, user_id: str, *, filename: str, content_type: str, data_base64: str) -> dict:
        user = self.users[user_id]
        user["doctor_signature_name"] = filename
        user["doctor_signature_content_type"] = content_type
        user["doctor_signature_data_base64"] = data_base64
        user["doctor_signature_url"] = f"/users/{user_id}/signature/file"
        result = dict(user)
        result.pop("session_version", None)
        return result

    async def clear_user_signature(self, user_id: str) -> dict:
        user = self.users[user_id]
        user["doctor_signature_name"] = None
        user["doctor_signature_content_type"] = None
        user["doctor_signature_data_base64"] = None
        user["doctor_signature_url"] = None
        result = dict(user)
        result.pop("session_version", None)
        return result

    async def create_patient(self, org_id: str, payload) -> dict:
        patient_id = str(uuid4())
        created_at = _now()
        payload_data = payload.model_dump()
        payload_data["age"] = payload.age if payload.age is not None else calculate_age_from_dob(payload.date_of_birth)
        patient = {
            "id": patient_id,
            "org_id": org_id,
            **payload_data,
            "phone": _normalize_phone(payload.phone),
            "email": payload.email.strip().lower(),
            "address": payload.address.strip(),
            "status": "waiting",
            "billed": False,
            "queue_priority": "normal",
            "stage_entered_at": created_at,
            "queue_position": self._next_queue_position(org_id, "waiting"),
            "profile_photo_storage_path": None,
            "profile_photo_content_type": None,
            "profile_photo_updated_at": None,
            "profile_photo_url": None,
            "ai_summary": None,
            "ai_summary_updated_at": None,
            "ai_summary_stale": True,
            "ai_summary_revision": 0,
            "ai_summary_source_hash": None,
            "created_at": created_at,
            "last_visit_at": created_at,
        }
        self.patients[patient_id] = patient
        await self._record_patient_visit(org_id, patient_id, payload, source="queue")
        return patient

    async def _record_patient_visit(self, org_id: str, patient_id: str, payload, source: str, appointment_id: str | None = None) -> dict:
        visit_id = str(uuid4())
        appointment = self.appointments.get(appointment_id, {}) if appointment_id else {}
        follow_up_id = appointment.get("follow_up_id")
        visit_kind = "follow_up" if follow_up_id else "new"
        visit = {
            "id": visit_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "name": payload.name,
            "phone": _normalize_phone(payload.phone),
            "email": payload.email.strip().lower(),
            "address": payload.address.strip(),
            "reason": payload.reason,
            "date_of_birth": getattr(payload, "date_of_birth", None),
            "sex_at_birth": getattr(payload, "sex_at_birth", None),
            "gender_identity": getattr(payload, "gender_identity", ""),
            "age": payload.age if payload.age is not None else calculate_age_from_dob(getattr(payload, "date_of_birth", None)),
            "weight": payload.weight,
            "height": payload.height,
            "temperature": payload.temperature,
            "source": source,
            "appointment_id": appointment_id,
            "follow_up_id": follow_up_id,
            "visit_kind": visit_kind,
            "created_at": _now(),
        }
        self.patient_visits[visit_id] = visit
        patient = self.patients[patient_id]
        patient["current_visit_id"] = visit_id
        patient["current_visit"] = {
            "id": visit_id,
            "kind": visit_kind,
            "source": source,
            "scheduled_for": self.appointments.get(appointment_id, {}).get("scheduled_for") if appointment_id else None,
        }
        patient["billing_summary"] = None
        return visit

    async def list_patient_matches_by_phone(self, org_id: str, phone: str, limit: int = 10) -> list[dict]:
        rows = [
            patient
            for patient in self.patients.values()
            if patient["org_id"] == org_id and patient["phone"] == _normalize_phone(phone)
        ]
        rows.sort(key=lambda patient: patient["last_visit_at"], reverse=True)
        return rows[:limit]

    async def create_appointment(
        self,
        org_id: str,
        payload,
        *,
        appointment_id: str | None = None,
        reject_duplicate_phone: bool = False,
        audit_event_factory=None,
        appointments_per_hour: int = 4,
        timezone: str = "UTC",
    ) -> dict:
        scheduled_for = _as_utc_minute(payload.scheduled_for)
        same_hour = [
            appointment
            for appointment in self.appointments.values()
            if appointment["org_id"] == org_id
            and appointment["status"] == "scheduled"
            and _as_utc_minute(appointment["scheduled_for"]).replace(minute=0)
            == scheduled_for.replace(minute=0)
        ]
        if any(_as_utc_minute(item["scheduled_for"]) == scheduled_for for item in same_hour):
            raise ValueError("That appointment slot is already booked.")
        if len(same_hour) >= appointments_per_hour:
            raise ValueError("That hour is fully booked.")
        if reject_duplicate_phone and any(
            appointment["org_id"] == org_id
            and appointment["status"] == "scheduled"
            and appointment["phone"] == _normalize_phone(payload.phone)
            and _as_utc_minute(appointment["scheduled_for"]) >= _now()
            for appointment in self.appointments.values()
        ):
            raise ValueError("An active appointment already exists for this phone number.")
        appointment_id = appointment_id or str(uuid4())
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
            "follow_up_id": None,
            "created_at": _now(),
        }
        self.appointments[appointment_id] = appointment
        await self._apply_audit_event_factory(audit_event_factory, appointment)
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

    async def get_appointment(self, org_id: str, appointment_id: str) -> dict:
        appointment = self.appointments.get(appointment_id)
        if not appointment or appointment["org_id"] != org_id:
            raise ValueError("Appointment not found.")
        return appointment

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

    async def list_scheduled_appointment_times(
        self,
        org_id: str,
        scheduled_from: str,
        scheduled_to: str,
    ) -> list[datetime]:
        start = _as_utc_minute(scheduled_from)
        end = _as_utc_minute(scheduled_to)
        return [
            _as_utc_minute(appointment["scheduled_for"])
            for appointment in self.appointments.values()
            if appointment["org_id"] == org_id
            and appointment["status"] == "scheduled"
            and start <= _as_utc_minute(appointment["scheduled_for"]) < end
        ]

    async def list_potential_check_in_matches(self, org_id: str, appointment_id: str) -> list[dict]:
        appointment = self.appointments[appointment_id]
        return [
            patient
            for patient in self.patients.values()
            if patient["org_id"] == org_id and not patient["billed"] and patient["phone"] == appointment["phone"]
        ]

    async def check_in_appointment(
        self,
        org_id: str,
        appointment_id: str,
        payload,
        *,
        audit_event_factory=None,
    ) -> tuple[dict, dict]:
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
            entered_at = _now()
            patient.update({
                "name": appointment["name"],
                "phone": appointment["phone"],
                "email": appointment["email"],
                "address": appointment["address"],
                "reason": appointment["reason"],
                "date_of_birth": appointment.get("date_of_birth"),
                "sex_at_birth": appointment.get("sex_at_birth"),
                "gender_identity": appointment.get("gender_identity", ""),
                "age": appointment["age"],
                "weight": appointment["weight"],
                "height": appointment["height"],
                "temperature": appointment["temperature"],
                "status": "waiting",
                "billed": False,
                "queue_priority": "normal",
                "stage_entered_at": entered_at,
                "queue_position": self._next_queue_position(org_id, "waiting", exclude_id=patient["id"]),
                "last_visit_at": entered_at,
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
                "date_of_birth": appointment.get("date_of_birth"),
                "sex_at_birth": appointment.get("sex_at_birth"),
                "gender_identity": appointment.get("gender_identity", ""),
                "age": appointment["age"],
                "weight": appointment["weight"],
                "height": appointment["height"],
                "temperature": appointment["temperature"],
                "status": "waiting",
                "billed": False,
                "queue_priority": "normal",
                "stage_entered_at": created_at,
                "queue_position": self._next_queue_position(org_id, "waiting"),
                "profile_photo_storage_path": None,
                "profile_photo_content_type": None,
                "profile_photo_updated_at": None,
                "profile_photo_url": None,
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
                    "date_of_birth": appointment.get("date_of_birth"),
                    "sex_at_birth": appointment.get("sex_at_birth"),
                    "gender_identity": appointment.get("gender_identity", ""),
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
        await self._apply_audit_event_factory(
            audit_event_factory,
            {"appointment": appointment, "patient": patient},
        )
        return appointment, patient

    async def update_appointment(
        self,
        org_id: str,
        appointment_id: str,
        payload,
        *,
        audit_event_factory=None,
        appointments_per_hour: int = 4,
        timezone: str = "UTC",
    ) -> dict:
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
            scheduled_for = _as_utc_minute(updates["scheduled_for"])
            same_hour = [
                item
                for item_id, item in self.appointments.items()
                if item_id != appointment_id
                and item["org_id"] == org_id
                and item["status"] == "scheduled"
                and _as_utc_minute(item["scheduled_for"]).replace(minute=0)
                == scheduled_for.replace(minute=0)
            ]
            if any(_as_utc_minute(item["scheduled_for"]) == scheduled_for for item in same_hour):
                raise ValueError("That appointment slot is already booked.")
            if len(same_hour) >= appointments_per_hour:
                raise ValueError("That hour is fully booked.")
            appointment["scheduled_for"] = updates["scheduled_for"]
        if "status" in updates:
            if updates["status"] == "checked_in":
                raise ValueError("Use check-in to move appointments into the queue.")
            if updates["status"] == "cancelled" and appointment["status"] != "scheduled":
                raise ValueError("Only scheduled appointments can be cancelled.")
            appointment["status"] = updates["status"]
        await self._apply_audit_event_factory(audit_event_factory, appointment)
        return appointment

    async def list_patients(
        self,
        org_id: str,
        *,
        active_only: bool = False,
        status: str | None = None,
        billed: bool | None = None,
        query: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        cursor_last_visit_at: datetime | None = None,
        cursor_id: str | None = None,
        include_queue_context: bool = False,
    ) -> list[dict]:
        normalized_query = str(query or "").strip().lower()
        rows = [
                patient
                for patient in self.patients.values()
                if patient["org_id"] == org_id
                and (
                    not active_only
                    or patient["status"] in {"waiting", "consultation"}
                    or (patient["status"] == "done" and not patient["billed"])
                )
                and (status is None or patient["status"] == status)
                and (billed is None or patient["billed"] is billed)
                and (
                    not normalized_query
                    or normalized_query in str(patient.get("name") or "").lower()
                    or normalized_query in str(patient.get("phone") or "").lower()
                    or normalized_query in str(patient.get("reason") or "").lower()
                )
            ]
        if active_only:
            rows.sort(
                key=lambda patient: (
                    {"waiting": 0, "consultation": 1, "done": 2}[patient["status"]],
                    0 if patient.get("queue_priority", "normal") == "urgent" else 1,
                    int(patient.get("queue_position") or 0),
                )
            )
        else:
            rows.sort(key=lambda patient: (patient["last_visit_at"], patient["id"]), reverse=True)
            if cursor_last_visit_at is not None and cursor_id is not None:
                rows = [
                    patient for patient in rows
                    if (patient["last_visit_at"], patient["id"]) < (cursor_last_visit_at, cursor_id)
                ]
        selected = copy.deepcopy(rows[offset : offset + limit if limit is not None else None])
        if not include_queue_context:
            for patient in selected:
                patient["current_visit"] = None
                patient["billing_summary"] = None
                patient["billing_estimate"] = None
            return selected
        for patient in selected:
            visit_id = patient.get("current_visit_id")
            matching = [invoice for invoice in self.invoices.values() if invoice.get("visit_id") == visit_id]
            if matching:
                invoice = max(matching, key=lambda row: row["created_at"])
                patient["billing_summary"] = {
                    "invoice_id": invoice["id"],
                    "total": invoice["total"],
                    "payment_status": invoice["payment_status"],
                    "balance_due": invoice["balance_due"],
                    "item_count": len(invoice["items"]),
                    "medicine_count": sum(1 for item in invoice["items"] if item["item_type"] == "medicine"),
                    "completed_at": invoice["completed_at"],
                    "sent_at": invoice["sent_at"],
                }
        return selected

    def _next_queue_position(self, org_id: str, status: str, *, exclude_id: str = "") -> int:
        positions = [
            int(patient.get("queue_position") or 0)
            for patient_id, patient in self.patients.items()
            if patient_id != exclude_id and patient["org_id"] == org_id and patient["status"] == status
        ]
        return max(positions, default=0) + 1

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
                "date_of_birth": getattr(payload, "date_of_birth", None),
                "sex_at_birth": getattr(payload, "sex_at_birth", None),
                "gender_identity": getattr(payload, "gender_identity", ""),
                "age": payload.age if payload.age is not None else calculate_age_from_dob(getattr(payload, "date_of_birth", None)),
                "weight": payload.weight,
                "height": payload.height,
                "temperature": payload.temperature,
                "status": "waiting",
                "billed": False,
                "queue_priority": "normal",
                "stage_entered_at": updated_at,
                "queue_position": self._next_queue_position(org_id, "waiting", exclude_id=patient_id),
                "last_visit_at": updated_at,
                "ai_summary_stale": True,
                "ai_summary_revision": int(patient.get("ai_summary_revision") or 0) + 1,
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
        next_status = updates.get("status", patient["status"])
        next_priority = updates.get("queue_priority", patient.get("queue_priority", "normal"))
        if next_status != patient["status"]:
            updates["stage_entered_at"] = _now()
            updates["queue_position"] = self._next_queue_position(org_id, next_status, exclude_id=patient_id)
        elif next_priority != patient.get("queue_priority", "normal"):
            matching_positions = [
                int(row.get("queue_position") or 0)
                for row_id, row in self.patients.items()
                if row_id != patient_id
                and row["org_id"] == org_id
                and row["status"] == patient["status"]
                and row.get("queue_priority", "normal") == next_priority
            ]
            updates["queue_position"] = min(matching_positions, default=1) - 1
        patient.update(updates)
        return patient

    async def reorder_queue(
        self,
        org_id: str,
        columns: dict[str, list[str]],
        *,
        role: str,
    ) -> list[dict]:
        statuses = ("waiting", "consultation", "done")
        submitted = [patient_id for status in statuses for patient_id in columns.get(status, [])]
        if len(submitted) != len(set(submitted)):
            raise ValueError("A patient can appear only once in the queue order.")
        active = {
            patient_id: patient
            for patient_id, patient in self.patients.items()
            if patient["org_id"] == org_id
            and (patient["status"] in {"waiting", "consultation"} or (patient["status"] == "done" and not patient["billed"]))
        }
        if any(patient_id not in active for patient_id in submitted):
            raise ValueError("Queue order includes a patient that is not active for this clinic.")
        target_by_id = {
            patient_id: status
            for status in statuses
            for patient_id in columns.get(status, [])
        }
        for patient_id, target_status in target_by_id.items():
            source_status = active[patient_id]["status"]
            if source_status == target_status:
                continue
            if role != "admin" or (source_status, target_status) not in {
                ("waiting", "consultation"),
                ("consultation", "done"),
            }:
                raise ValueError("Patients can only move through the queue stages in order.")
        for status in statuses:
            ordered_ids = list(columns.get(status, [])) + [
                patient_id
                for patient_id, patient in active.items()
                if patient_id not in target_by_id and patient["status"] == status
            ]
            ordered_ids.sort(key=lambda patient_id: 0 if active[patient_id].get("queue_priority") == "urgent" else 1)
            for position, patient_id in enumerate(ordered_ids, start=1):
                patient = active[patient_id]
                if patient["status"] != status:
                    patient["stage_entered_at"] = _now()
                patient["status"] = status
                patient["queue_position"] = position
        return await self.list_patients(org_id, active_only=True, limit=500, include_queue_context=True)

    async def get_patient(self, org_id: str, patient_id: str) -> dict:
        patient = self.patients[patient_id]
        if patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")
        return patient

    async def get_optometry_history(self, org_id: str, patient_id: str, visit_id: str | None = None) -> dict | None:
        patient = await self.get_patient(org_id, patient_id)
        resolved_visit_id = visit_id or str(patient.get("current_visit_id") or "") or None
        if resolved_visit_id:
            row = self.optometry_histories.get((org_id, patient_id, resolved_visit_id))
        else:
            row = next(
                (value for key, value in reversed(list(self.optometry_histories.items())) if key[:2] == (org_id, patient_id)),
                None,
            )
        return dict(row) if row else None

    async def save_optometry_history(
        self,
        *,
        org_id: str,
        patient_id: str,
        updated_by: str,
        expected_revision: int,
        payload: dict,
        visit_id: str | None = None,
    ) -> dict:
        patient = await self.get_patient(org_id, patient_id)
        resolved_visit_id = visit_id or str(patient.get("current_visit_id") or "")
        if not resolved_visit_id or not any(
            str(visit["id"]) == resolved_visit_id and visit["org_id"] == org_id and visit["patient_id"] == patient_id
            for visit in self.patient_visits.values()
        ):
            raise ValueError("Visit not found for this patient.")
        current = self.optometry_histories.get((org_id, patient_id, resolved_visit_id))
        current_revision = int(current.get("revision") or 0) if current else 0
        if current_revision != expected_revision:
            raise ValueError(f"OPTOMETRY_HISTORY_REVISION_CONFLICT:{current_revision}")
        now = _now()
        user = self.users.get(updated_by) or {}
        row = {
            "history_id": current["history_id"] if current else str(uuid4()),
            "org_id": org_id,
            "patient_id": patient_id,
            "visit_id": resolved_visit_id,
            "payload": dict(payload),
            "revision": current_revision + 1,
            "updated_by": updated_by,
            "updated_by_name": user.get("name") or user.get("identifier") or "",
            "created_at": current["created_at"] if current else now,
            "updated_at": now,
        }
        self.optometry_histories[(org_id, patient_id, resolved_visit_id)] = row
        self.optometry_history_revisions.append(dict(row))
        return dict(row)

    async def list_optometry_history_revisions(self, org_id: str, patient_id: str, visit_id: str | None = None) -> list[dict]:
        return [
            dict(row)
            for row in reversed(self.optometry_history_revisions)
            if row["org_id"] == org_id and row["patient_id"] == patient_id
            and (visit_id is None or row["visit_id"] == visit_id)
        ]

    async def save_patient_summary(
        self,
        org_id: str,
        patient_id: str,
        summary: str,
        updated_at,
        expected_revision: int,
        source_hash: str,
    ) -> bool:
        patient = await self.get_patient(org_id, patient_id)
        if int(patient.get("ai_summary_revision") or 0) != expected_revision:
            return False
        patient["ai_summary"] = summary
        patient["ai_summary_updated_at"] = updated_at
        patient["ai_summary_stale"] = False
        patient["ai_summary_source_hash"] = source_hash
        return True

    async def mark_patient_summary_stale(self, org_id: str, patient_id: str) -> None:
        patient = await self.get_patient(org_id, patient_id)
        patient["ai_summary_stale"] = True
        patient["ai_summary_revision"] = int(patient.get("ai_summary_revision") or 0) + 1

    async def update_patient_profile_photo(
        self,
        org_id: str,
        patient_id: str,
        *,
        storage_path: str,
        content_type: str,
    ) -> dict:
        patient = await self.get_patient(org_id, patient_id)
        patient["profile_photo_storage_path"] = storage_path
        patient["profile_photo_content_type"] = content_type
        patient["profile_photo_updated_at"] = _now()
        patient["profile_photo_url"] = f"/patients/{patient_id}/profile-photo/file"
        return patient

    async def clear_patient_profile_photo(self, org_id: str, patient_id: str) -> dict:
        patient = await self.get_patient(org_id, patient_id)
        patient["profile_photo_storage_path"] = None
        patient["profile_photo_content_type"] = None
        patient["profile_photo_updated_at"] = None
        patient["profile_photo_url"] = None
        return patient

    async def prepare_patient_attachment_metadata(
        self,
        org_id: str,
        patient_id: str,
        *,
        uploaded_by: str,
        filename: str,
        content_type: str,
        file_size: int,
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
        return row

    async def create_patient_attachment_metadata(self, row: dict) -> dict:
        self.patient_attachments[row["id"]] = row
        return row

    async def list_patient_attachments(self, org_id: str, patient_id: str) -> list[dict]:
        rows = [
            row for row in self.patient_attachments.values()
            if row["org_id"] == org_id and row["patient_id"] == patient_id
        ]
        rows.sort(key=lambda row: row["created_at"], reverse=True)
        return rows

    async def get_patient_attachment(self, org_id: str, attachment_id: str) -> dict:
        row = self.patient_attachments.get(attachment_id)
        if row is None:
            raise ValueError("Attachment not found for this organization.")
        if row["org_id"] != org_id:
            raise ValueError("Attachment not found for this organization.")
        return row

    async def create_referral_package(self, org_id: str, row: dict) -> dict:
        package_id = str(row.get("id") or uuid4())
        saved = {**row, "id": package_id, "org_id": org_id, "created_at": _now()}
        self.referral_packages[package_id] = saved
        return saved

    async def get_referral_package(self, org_id: str, package_id: str) -> dict:
        row = self.referral_packages.get(package_id)
        if row is None or row["org_id"] != org_id:
            raise ValueError("Referral not found for this organization.")
        return row

    async def list_referral_packages(self, org_id: str, patient_id: str) -> list[dict]:
        rows = [
            row for row in self.referral_packages.values()
            if row["org_id"] == org_id and row["patient_id"] == patient_id
        ]
        return sorted(rows, key=lambda row: row["created_at"], reverse=True)

    async def list_longitudinal_tracks_by_ids(
        self, org_id: str, patient_id: str, record_ids: list[str]
    ) -> list[dict]:
        return [
            self.longitudinal_tracks[record_id] for record_id in record_ids
            if record_id in self.longitudinal_tracks
            and self.longitudinal_tracks[record_id]["org_id"] == org_id
            and self.longitudinal_tracks[record_id]["patient_id"] == patient_id
        ]

    async def create_referral_delivery(self, org_id: str, row: dict) -> dict:
        delivery_id = str(row.get("id") or uuid4())
        now = _now()
        saved = {**row, "id": delivery_id, "org_id": org_id, "created_at": now, "updated_at": now}
        self.referral_deliveries[delivery_id] = saved
        return saved

    async def list_referral_deliveries(self, org_id: str, package_id: str) -> list[dict]:
        return [
            row for row in self.referral_deliveries.values()
            if row["org_id"] == org_id and row["referral_package_id"] == package_id
        ]

    async def delete_patient_attachment_metadata(self, org_id: str, patient_id: str, attachment_id: str) -> dict:
        row = await self.get_patient_attachment(org_id, attachment_id)
        if row["patient_id"] != patient_id:
            raise ValueError("Attachment not found for this patient.")
        self.patient_attachments.pop(attachment_id, None)
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
        patient = await self.get_patient(org_id, str(payload.patient_id))
        return await self._create_note(
            org_id,
            str(payload.patient_id),
            payload.content,
            visit_id=str(getattr(payload, "visit_id", None) or patient.get("current_visit_id") or "") or None,
            asset_payload=getattr(payload, "asset_payload", []),
            structured_modules=getattr(payload, "structured_modules", []),
            clinical_extractions=getattr(payload, "clinical_extractions", {}),
            optometry_history=getattr(payload, "optometry_history", {}),
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
        visit_id: str | None,
        asset_payload: list[dict],
        structured_modules: list[dict],
        clinical_extractions: dict,
        optometry_history: dict,
        version_number: int,
        root_note_id: str | None,
        amended_from_note_id: str | None,
    ) -> dict:
        note_id = str(uuid4())
        note = {
            "id": note_id,
            "org_id": org_id,
            "patient_id": patient_id,
            "visit_id": visit_id,
            "content": content,
            "asset_payload": asset_payload,
            "structured_modules": structured_modules,
            "clinical_extractions": clinical_extractions,
            "snapshot_clinical_extractions": None,
            "optometry_history": optometry_history,
            "snapshot_optometry_history": None,
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

    async def update_note_draft(self, org_id: str, note_id: str, content: str, asset_payload: list[dict] | None = None, structured_modules: list[dict] | None = None, clinical_extractions: dict | None = None, optometry_history: dict | None = None) -> dict:
        note = await self.get_note(org_id, note_id)
        if note["status"] != "draft":
            raise ValueError("Only draft notes can be updated.")
        note["content"] = content
        if asset_payload is not None:
            note["asset_payload"] = asset_payload
        if structured_modules is not None:
            note["structured_modules"] = structured_modules
        if clinical_extractions is not None:
            note["clinical_extractions"] = clinical_extractions
        if optometry_history is not None:
            note["optometry_history"] = optometry_history
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
        note["snapshot_clinical_extractions"] = note.get("clinical_extractions") or {}
        note["snapshot_optometry_history"] = note.get("optometry_history") or {}
        note["finalized_at"] = _now()
        return note

    async def create_note_amendment(self, org_id: str, note_id: str, content: str, asset_payload: list[dict] | None = None, structured_modules: list[dict] | None = None, clinical_extractions: dict | None = None, optometry_history: dict | None = None) -> dict:
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
            visit_id=note.get("visit_id"),
            asset_payload=asset_payload or note.get("asset_payload") or [],
            structured_modules=structured_modules if structured_modules is not None else note.get("structured_modules") or [],
            clinical_extractions=clinical_extractions if clinical_extractions is not None else note.get("clinical_extractions") or {},
            optometry_history=optometry_history if optometry_history is not None else note.get("optometry_history") or {},
            version_number=next_version,
            root_note_id=str(note.get("root_note_id") or note["id"]),
            amended_from_note_id=note_id,
        )

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict]:
        rows = []
        for note in self.notes.values():
            if note["org_id"] != org_id or note["patient_id"] != patient_id:
                continue
            visit = self.patient_visits.get(str(note.get("visit_id") or "")) or {}
            rows.append({**note, "visit_reason": visit.get("reason")})
        return rows

    async def mark_note_sent(self, org_id: str, note_id: str, *, sent_by: str, sent_to: str) -> dict:
        note = await self.get_note(org_id, note_id)
        if note["status"] == "draft":
            raise ValueError("Finalize the note before sending it.")
        if note["sent_at"] is None:
            note["status"] = "sent"
            note["snapshot_content"] = note["snapshot_content"] or note["content"]
            note["snapshot_asset_payload"] = note.get("snapshot_asset_payload") or note.get("asset_payload") or []
            note["snapshot_optometry_history"] = note.get("snapshot_optometry_history") or note.get("optometry_history") or {}
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

    async def list_active_medicines(self, org_id: str) -> list[dict]:
        return [
            {
                "id": item["id"],
                "name": item["name"],
                "unit": item["unit"],
                "default_price": item["default_price"],
                "track_inventory": item["track_inventory"],
                "stock_quantity": item["stock_quantity"],
            }
            for item in sorted(self.catalog_items.values(), key=lambda row: row["name"])
            if item["org_id"] == org_id
            and item["item_type"] == "medicine"
            and item.get("is_active", True)
        ]

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

    async def update_catalog_item(self, org_id: str, item_id: str, payload) -> dict:
        item = self.catalog_items[item_id]
        if item["org_id"] != org_id:
            raise ValueError("Inventory item not found for this organization.")
        item.update(payload.model_dump())
        return item

    async def delete_catalog_item(self, org_id: str, item_id: str) -> None:
        item = self.catalog_items[item_id]
        if item["org_id"] != org_id:
            raise ValueError("Inventory item not found for this organization.")
        self.catalog_items.pop(item_id, None)

    async def create_invoice(
        self,
        org_id: str,
        payload,
        *,
        audit_event_factory=None,
    ) -> dict:
        patient = self.patients.get(str(payload.patient_id))
        if not patient or patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")

        subtotal = round(sum(item.quantity * item.unit_price for item in payload.items), 2)
        tax_total = 0.0
        cgst_total = 0.0
        sgst_total = 0.0
        prepared_items: list[dict] = []
        for raw_item in payload.items:
            catalog_item = None
            if raw_item.catalog_item_id:
                catalog_item = self.catalog_items.get(str(raw_item.catalog_item_id))
                if not catalog_item or catalog_item["org_id"] != org_id:
                    raise ValueError("Inventory item not found for this organization.")
            line_total = round(raw_item.quantity * raw_item.unit_price, 2)
            hsn_sac_code = str((catalog_item or {}).get("hsn_sac_code") or "")
            gst_rate = (catalog_item or {}).get("gst_rate")
            tax_amount = round(line_total * float(gst_rate) / 100, 2) if hsn_sac_code and gst_rate is not None else 0.0
            cgst_amount = round(tax_amount / 2, 2)
            sgst_amount = round(tax_amount - cgst_amount, 2)
            tax_total = round(tax_total + tax_amount, 2)
            cgst_total = round(cgst_total + cgst_amount, 2)
            sgst_total = round(sgst_total + sgst_amount, 2)
            prepared_items.append({
                "raw_item": raw_item,
                "line_total": line_total,
                "hsn_sac_code": hsn_sac_code,
                "gst_rate": gst_rate,
                "tax_amount": tax_amount,
                "cgst_amount": cgst_amount,
                "sgst_amount": sgst_amount,
            })
        total = round(subtotal + tax_total, 2)
        if payload.payment_status == "paid":
            amount_paid = total
        elif payload.payment_status == "unpaid":
            amount_paid = 0
        else:
            amount_paid = round(float(payload.amount_paid or 0), 2)
            if amount_paid <= 0 or amount_paid >= total:
                raise ValueError("Partial invoice amount must be less than the invoice total.")
        existing_invoice_id = str(payload.invoice_id) if getattr(payload, "invoice_id", None) else None
        if existing_invoice_id:
            existing = self.invoices.get(existing_invoice_id)
            if not existing or existing["org_id"] != org_id or existing["patient_id"] != str(payload.patient_id) or existing["completed_at"] is not None:
                raise ValueError("Draft invoice not found for this patient.")
            for item_id, item in list(self.invoice_items.items()):
                if item.get("invoice_id") == existing_invoice_id:
                    self.invoice_items.pop(item_id, None)
            invoice_id = existing_invoice_id
            invoice = existing
        else:
            invoice_id = str(uuid4())
            invoice = {
                "id": invoice_id,
                "org_id": org_id,
                "patient_id": str(payload.patient_id),
                "visit_id": patient.get("current_visit_id"),
                "created_at": _now(),
            }
        items = []
        for prepared_item in prepared_items:
            raw_item = prepared_item["raw_item"]
            invoice_item = {
                "id": str(uuid4()),
                "catalog_item_id": str(raw_item.catalog_item_id) if raw_item.catalog_item_id else None,
                "item_type": raw_item.item_type,
                "label": raw_item.label,
                "quantity": raw_item.quantity,
                "unit_price": raw_item.unit_price,
                "line_total": prepared_item["line_total"],
                "hsn_sac_code": prepared_item["hsn_sac_code"],
                "gst_rate": prepared_item["gst_rate"],
                "taxable_value": prepared_item["line_total"] if prepared_item["tax_amount"] else 0,
                "tax_amount": prepared_item["tax_amount"],
                "cgst_amount": prepared_item["cgst_amount"],
                "sgst_amount": prepared_item["sgst_amount"],
            }
            self.invoice_items[invoice_item["id"]] = invoice_item | {"invoice_id": invoice_id}
            items.append(invoice_item)

        invoice.update({
            "subtotal": subtotal,
            "tax_total": tax_total,
            "cgst_total": cgst_total,
            "sgst_total": sgst_total,
            "total": total,
            "supplier_gstin": str(self.clinic_settings.get(org_id, {}).get("gstin") or ""),
            "payment_status": payload.payment_status,
            "amount_paid": amount_paid,
            "balance_due": round(max(total - amount_paid, 0), 2),
            "paid_at": _now() if payload.payment_status == "paid" else None,
            "completed_at": None,
            "completed_by": None,
            "sent_at": None,
            "items": items,
        })
        self.invoices[invoice_id] = invoice
        await self._apply_audit_event_factory(audit_event_factory, invoice)
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

    async def list_invoices(
        self,
        org_id: str,
        limit: int | None = None,
        offset: int = 0,
        cursor_created_at: datetime | None = None,
        cursor_id: str | None = None,
    ) -> list[dict]:
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
        rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        if cursor_created_at is not None and cursor_id is not None:
            rows = [
                row for row in rows
                if (row["created_at"], row["id"]) < (cursor_created_at, cursor_id)
            ]
        return rows[offset:offset + limit] if limit is not None else rows[offset:]

    async def sum_revenue(self, org_id: str, start: str | None = None, end: str | None = None) -> dict:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00")) if start else None
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else None
        total = 0.0
        count = 0
        for invoice in self.invoices.values():
            if invoice["org_id"] != org_id:
                continue
            if start_dt and invoice["created_at"] < start_dt:
                continue
            if end_dt and invoice["created_at"] >= end_dt:
                continue
            total += float(invoice.get("amount_paid") or 0)
            count += 1
        return {"total_paid": round(total, 2), "invoice_count": count}

    async def sum_pending(self, org_id: str) -> dict:
        total = 0.0
        count = 0
        for invoice in self.invoices.values():
            if invoice["org_id"] != org_id or str(invoice.get("payment_status") or "") not in {"unpaid", "partial"}:
                continue
            total += max(float(invoice.get("total") or 0) - float(invoice.get("amount_paid") or 0), 0)
            count += 1
        return {"pending_total": round(total, 2), "pending_count": count}

    async def count_patients(self, org_id: str) -> int:
        return sum(1 for patient in self.patients.values() if patient["org_id"] == org_id)

    async def count_visits_in_range(self, org_id: str, start: str, end: str) -> int:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
        return sum(
            1 for visit in self.patient_visits.values()
            if visit["org_id"] == org_id and start_dt <= visit["created_at"] < end_dt
        )

    async def count_appointments_in_range(self, org_id: str, start: str, end: str, *, status: str = "scheduled") -> int:
        start_dt = _as_utc_minute(start)
        end_dt = _as_utc_minute(end)
        return sum(
            1 for appointment in self.appointments.values()
            if appointment["org_id"] == org_id
            and appointment["status"] == status
            and start_dt <= _as_utc_minute(appointment["scheduled_for"]) < end_dt
        )

    async def count_follow_ups_in_range(self, org_id: str, start: str, end: str, *, status: str = "scheduled") -> int:
        start_dt = _as_utc_minute(start)
        end_dt = _as_utc_minute(end)
        return sum(
            1 for follow_up in self.follow_ups.values()
            if follow_up["org_id"] == org_id
            and follow_up["status"] == status
            and start_dt <= _as_utc_minute(follow_up["scheduled_for"]) < end_dt
        )

    async def iter_patients_for_export(self, org_id: str, *, page_size: int = 500):
        cursor_last_visit_at = None
        cursor_id = None
        while True:
            page = await self.list_patients(
                org_id,
                include_queue_context=False,
                limit=page_size,
                cursor_last_visit_at=cursor_last_visit_at,
                cursor_id=cursor_id,
            )
            if not page:
                return
            for patient in page:
                yield patient
            if len(page) < page_size:
                return
            last = page[-1]
            cursor_last_visit_at = last["last_visit_at"]
            cursor_id = str(last["id"])

    async def iter_visits_for_export(self, org_id: str, *, page_size: int = 500):
        visits = [
            visit for visit in self.patient_visits.values()
            if visit["org_id"] == org_id and self.patients.get(visit["patient_id"])
        ]
        visits.sort(key=lambda visit: (visit["created_at"], visit["id"]), reverse=True)
        for visit in visits:
            patient = self.patients[visit["patient_id"]]
            yield {
                **visit,
                "status": patient["status"],
                "billed": patient.get("billed", False),
                "last_visit_at": patient["last_visit_at"],
            }

    async def iter_patients_without_visits_for_export(self, org_id: str, *, page_size: int = 500):
        with_visits = {
            str(visit["patient_id"]) for visit in self.patient_visits.values()
            if visit["org_id"] == org_id
        }
        patients = [
            patient for patient in self.patients.values()
            if patient["org_id"] == org_id and str(patient["id"]) not in with_visits
        ]
        patients.sort(key=lambda patient: (patient["last_visit_at"], patient["id"]), reverse=True)
        for patient in patients:
            yield patient

    async def iter_invoices_for_export(self, org_id: str, *, page_size: int = 500):
        cursor_created_at = None
        cursor_id = None
        while True:
            page = await self.list_invoices(
                org_id,
                limit=page_size,
                cursor_created_at=cursor_created_at,
                cursor_id=cursor_id,
            )
            if not page:
                return
            for invoice in page:
                yield invoice
            if len(page) < page_size:
                return
            last = page[-1]
            cursor_created_at = last["created_at"]
            cursor_id = str(last["id"])

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

    async def finalize_invoice(
        self,
        org_id: str,
        invoice_id: str,
        *,
        completed_by: str,
        mark_sent: bool = False,
        audit_event_factory=None,
    ) -> dict:
        invoice = self.invoices[invoice_id]
        if invoice["org_id"] != org_id:
            raise ValueError("Invoice not found for this organization.")
        already_completed = invoice["completed_at"] is not None
        already_sent = invoice["sent_at"] is not None
        if already_completed and (already_sent or not mark_sent):
            result = {
                "patient_id": invoice["patient_id"],
                "completed_at": invoice["completed_at"],
                "completed_by": invoice["completed_by"],
                "sent_at": invoice["sent_at"],
                "already_completed": True,
                "already_sent": already_sent,
                "stock_deductions": [],
                "program_enrollments": [],
                "invoice": dict(invoice),
            }
            await self._apply_audit_event_factory(audit_event_factory, result)
            return result

        stock_deductions: list[dict] = []
        if not already_completed:
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
                stock_deductions.append(
                    {
                        "catalog_item_id": item_id,
                        "item_name": self.catalog_items[item_id]["name"],
                        "quantity": quantity,
                    }
                )

            self.patients[invoice["patient_id"]]["billed"] = True
            invoice["completed_at"] = invoice["completed_at"] or _now()
            invoice["completed_by"] = invoice["completed_by"] or completed_by
        if mark_sent and invoice["sent_at"] is None:
            invoice["sent_at"] = _now()
        result = {
            "patient_id": invoice["patient_id"],
            "completed_at": invoice["completed_at"],
            "completed_by": invoice["completed_by"],
            "sent_at": invoice["sent_at"],
            "already_completed": already_completed,
            "already_sent": already_sent,
            "stock_deductions": stock_deductions,
            "program_enrollments": [],
            "invoice": dict(invoice),
        }
        await self._apply_audit_event_factory(audit_event_factory, result)
        return result

    async def update_invoice_payment(
        self,
        org_id: str,
        invoice_id: str,
        *,
        amount_paid: float,
        actor_user_id: str,
        audit_event_factory=None,
    ) -> dict:
        del actor_user_id
        invoice = self.invoices[invoice_id]
        if invoice["org_id"] != org_id or invoice["completed_at"] is None:
            raise ValueError("Completed invoice not found for this organization.")
        previous = float(invoice.get("amount_paid") or 0)
        requested = round(float(amount_paid), 2)
        total = float(invoice.get("total") or 0)
        if requested < previous:
            raise ValueError("Recorded payment cannot be reduced.")
        if requested > total:
            raise ValueError("Recorded payment cannot exceed the invoice total.")
        invoice["amount_paid"] = requested
        invoice["payment_status"] = "paid" if requested == total else "partial"
        invoice["balance_due"] = round(max(total - requested, 0), 2)
        if invoice["payment_status"] == "paid":
            invoice["paid_at"] = invoice.get("paid_at") or _now()
        invoice["previous_amount_paid"] = previous
        invoice["program_enrollments"] = []
        await self._apply_audit_event_factory(audit_event_factory, invoice)
        return invoice

    async def mark_invoice_sent(self, org_id: str, invoice_id: str) -> dict:
        invoice = self.invoices[invoice_id]
        if invoice["org_id"] != org_id or invoice["completed_at"] is None:
            raise ValueError("Completed invoice not found for this organization.")
        invoice["sent_at"] = invoice["sent_at"] or _now()
        return dict(invoice)

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
            "reminder_claimed_at": None,
            "reminder_attempt_count": 0,
            "reminder_last_error": "",
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

    async def self_book_follow_up_atomic(
        self,
        *,
        org_id: str,
        patient_id: str,
        follow_up_id: str,
        scheduled_for: datetime,
        appointments_per_hour: int,
        timezone: str,
        audit_event_factory=None,
    ) -> tuple[dict, dict]:
        del timezone
        follow_up = self.follow_ups.get(follow_up_id)
        if not follow_up or follow_up["org_id"] != org_id or follow_up["patient_id"] != patient_id:
            raise ValueError("Follow-up not found.")
        existing_appointment = next(
            (
                appointment
                for appointment in self.appointments.values()
                if appointment["org_id"] == org_id and appointment.get("follow_up_id") == follow_up_id
            ),
            None,
        )
        if follow_up["status"] != "scheduled" and not existing_appointment:
            raise ValueError("This follow-up is no longer available for booking.")
        if existing_appointment and existing_appointment["status"] == "checked_in":
            raise ValueError("This appointment has already been checked in.")
        patient = self.patients.get(patient_id)
        if not patient or patient["org_id"] != org_id:
            raise ValueError("Patient not found for this organization.")

        normalized = _as_utc_minute(scheduled_for)
        hour_bucket = normalized.replace(minute=0, second=0, microsecond=0)
        scheduled_appointments = [
            appointment for appointment in self.appointments.values()
            if appointment["org_id"] == org_id
            and appointment["status"] == "scheduled"
            and appointment["id"] != (existing_appointment or {}).get("id")
        ]
        if any(_as_utc_minute(appointment["scheduled_for"]) == normalized for appointment in scheduled_appointments):
            raise ValueError("That follow-up slot is already booked. Choose another time.")
        same_hour_count = sum(
            1
            for appointment in scheduled_appointments
            if _as_utc_minute(appointment["scheduled_for"]).replace(minute=0, second=0, microsecond=0) == hour_bucket
        )
        if same_hour_count >= appointments_per_hour:
            raise ValueError("That hour is fully booked. Choose another follow-up slot.")

        follow_up["scheduled_for"] = normalized
        follow_up["status"] = "completed"
        follow_up["completed_at"] = _now()
        if existing_appointment:
            appointment = existing_appointment
            appointment.update(
                {
                    "scheduled_for": normalized,
                    "status": "scheduled",
                    "checked_in_patient_id": None,
                    "checked_in_at": None,
                }
            )
        else:
            appointment_id = str(uuid4())
            appointment = {
                "id": appointment_id,
                "org_id": org_id,
                "name": patient["name"],
                "phone": patient["phone"],
                "email": patient.get("email", ""),
                "address": patient.get("address", ""),
                "reason": f"Follow-up: {str(patient.get('reason') or '').strip() or 'Review'}",
                "date_of_birth": patient.get("date_of_birth"),
                "sex_at_birth": patient.get("sex_at_birth"),
                "gender_identity": patient.get("gender_identity", ""),
                "age": patient.get("age"),
                "weight": patient.get("weight"),
                "height": patient.get("height"),
                "temperature": patient.get("temperature"),
                "scheduled_for": normalized,
                "status": "scheduled",
                "checked_in_patient_id": None,
                "checked_in_at": None,
                "follow_up_id": follow_up_id,
                "created_at": _now(),
            }
            self.appointments[appointment_id] = appointment
        await self._apply_audit_event_factory(audit_event_factory, appointment)
        return follow_up, appointment

    async def get_appointment_for_follow_up(self, org_id: str, follow_up_id: str) -> dict | None:
        return next(
            (
                appointment
                for appointment in self.appointments.values()
                if appointment["org_id"] == org_id and appointment.get("follow_up_id") == follow_up_id
            ),
            None,
        )

    async def cancel_self_booked_follow_up_appointment(
        self,
        *,
        org_id: str,
        patient_id: str,
        follow_up_id: str,
        audit_event_factory=None,
    ) -> dict:
        follow_up = self.follow_ups.get(follow_up_id)
        appointment = await self.get_appointment_for_follow_up(org_id, follow_up_id)
        if (
            not follow_up
            or follow_up["patient_id"] != patient_id
            or not appointment
            or appointment["status"] != "scheduled"
        ):
            raise ValueError("This appointment is not currently scheduled.")
        appointment["status"] = "cancelled"
        await self._apply_audit_event_factory(audit_event_factory, appointment)
        return appointment

    async def claim_due_follow_ups(
        self,
        org_id: str,
        due_after_iso: str,
        due_before_iso: str,
    ) -> list[dict]:
        due_after = _as_utc_minute(due_after_iso)
        due_before = _as_utc_minute(due_before_iso)
        claimed = [
            follow_up for follow_up in self.follow_ups.values()
            if follow_up["org_id"] == org_id
            and follow_up["status"] == "scheduled"
            and follow_up["reminder_sent_at"] is None
            and follow_up.get("reminder_claimed_at") is None
            and due_after < _as_utc_minute(follow_up["scheduled_for"]) <= due_before
        ]
        for follow_up in claimed:
            follow_up["reminder_claimed_at"] = _now()
            follow_up["reminder_attempt_count"] = int(follow_up.get("reminder_attempt_count") or 0) + 1
            follow_up["reminder_last_error"] = ""
        return claimed

    async def mark_follow_up_reminder_sent(self, org_id: str, follow_up_id: str) -> dict:
        follow_up = self.follow_ups[follow_up_id]
        if follow_up["org_id"] != org_id:
            raise ValueError("Follow-up not found for this organization.")
        follow_up["reminder_sent_at"] = _now()
        follow_up["reminder_claimed_at"] = None
        return follow_up

    async def release_follow_up_reminder_claim(self, org_id: str, follow_up_id: str, error: str) -> None:
        follow_up = self.follow_ups[follow_up_id]
        if follow_up["org_id"] != org_id:
            raise ValueError("Follow-up not found for this organization.")
        follow_up["reminder_claimed_at"] = None
        follow_up["reminder_last_error"] = error


class FakePatientAttachmentStorage:
    def __init__(self, repo: FakeRepo) -> None:
        self.repo = repo

    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        self.repo.patient_attachment_files[storage_path] = raw_bytes

    async def download(self, storage_path: str) -> bytes:
        return self.repo.patient_attachment_files[storage_path]

    async def upload_file(self, storage_path: str, file_obj, content_type: str) -> None:
        file_obj.seek(0)
        self.repo.patient_attachment_files[storage_path] = file_obj.read()

    async def iter_download(
        self,
        storage_path: str,
        *,
        start: int = 0,
        end: int | None = None,
        chunk_size: int = 1024 * 1024,
    ):
        raw_bytes = self.repo.patient_attachment_files[storage_path]
        stop = len(raw_bytes) if end is None else end + 1
        for offset in range(start, stop, chunk_size):
            yield raw_bytes[offset:min(offset + chunk_size, stop)]

    async def delete(self, storage_path: str) -> None:
        self.repo.patient_attachment_files.pop(storage_path, None)


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
        lambda: SimpleNamespace(
            auth_secret="test-secret",
            app_origin="http://127.0.0.1:3000",
            open_clinic_registration=True,
        ),
    )
    monkeypatch.setattr(
        config_module,
        "get_settings",
        lambda: SimpleNamespace(
            auth_secret="test-secret",
            app_origin="http://127.0.0.1:3000",
            open_clinic_registration=True,
        ),
    )
    monkeypatch.setattr(
        followup_booking_service_module,
        "get_settings",
        lambda: SimpleNamespace(auth_secret="test-secret"),
    )
    app.dependency_overrides[get_repository] = lambda: repo
    app.dependency_overrides[get_patient_attachment_storage] = lambda: FakePatientAttachmentStorage(repo)
    with TestClient(app) as test_client:
        yield test_client, repo
    app.dependency_overrides.clear()


def register_test_clinic(client: TestClient, *, identifier: str, clinic_name: str) -> dict:
    repo = client.app.dependency_overrides[get_repository]()
    customer_id = f"CID-TST-{uuid4().hex[:4].upper()}"
    asyncio.run(
        repo.create_customer_onboarding(
            customer_id=customer_id,
            customer_name=clinic_name,
            phone="5550100000",
            users_allowed=2,
            created_by=None,
        )
    )
    response = client.post(
        "/auth/register",
        json={
            "identifier": identifier,
            "email": identifier if "@" in identifier else f"{identifier}@example.com",
            "phone": "5550100000",
            "password": "password123!",
            "customer_id": customer_id,
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
    return {
        "Authorization": f"Bearer {token}",
        "Cookie": f"{auth_module.SESSION_COOKIE_NAME}={token}",
    }


def test_active_medicine_catalog_is_minimal_and_available_to_staff(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="medicine-admin@example.com",
        clinic_name="Medicine Cache Clinic",
    )
    admin_headers = auth_headers_for_token(session["token"])
    active_medicine = test_client.post(
        "/catalog",
        headers=admin_headers,
        json={
            "name": "Amoxicillin",
            "item_type": "medicine",
            "default_price": 12.5,
            "track_inventory": True,
            "stock_quantity": 24,
            "low_stock_threshold": 5,
            "unit": "tablet",
        },
    )
    assert active_medicine.status_code == 201
    assert test_client.post(
        "/catalog",
        headers=admin_headers,
        json={"name": "Consultation", "item_type": "service", "default_price": 500},
    ).status_code == 201
    assert test_client.post(
        "/catalog",
        headers=admin_headers,
        json={"name": "Inactive medicine", "item_type": "medicine", "default_price": 5, "is_active": False},
    ).status_code == 201
    assert test_client.post(
        "/users/staff",
        headers=admin_headers,
        json={
            "identifier": "medicine-staff@example.com",
            "email": "medicine-staff@example.com",
            "phone": "5550103447",
            "password": "password123!",
        },
    ).status_code == 201
    staff_session = test_client.post(
        "/auth/login",
        json={"identifier": "medicine-staff@example.com", "password": "password123!"},
    )
    assert staff_session.status_code == 200
    staff_headers = auth_headers_for_token(staff_session.json()["token"])

    full_catalog = test_client.get("/catalog", headers=staff_headers)
    assert full_catalog.status_code == 200
    assert {item["name"] for item in full_catalog.json()} == {"Amoxicillin", "Consultation", "Inactive medicine"}
    medicines = test_client.get("/catalog/medicines", headers=staff_headers)
    assert medicines.status_code == 200
    assert medicines.json() == [{
        "id": active_medicine.json()["id"],
        "name": "Amoxicillin",
        "unit": "tablet",
        "default_price": 12.5,
        "track_inventory": True,
        "stock_quantity": 24.0,
    }]


def test_dashboard_status_and_queue_snapshot_are_lightweight_and_revisioned(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="dashboard-heartbeat@example.com",
        clinic_name="Heartbeat Clinic",
    )
    headers = auth_headers_for_token(session["token"])

    empty_status = test_client.get("/dashboard/status", headers=headers)
    assert empty_status.status_code == 200
    assert empty_status.json()["active_patient_count"] == 0
    assert empty_status.json()["pending_check_in_count"] == 0
    assert isinstance(empty_status.json()["queue_revision"], str)
    assert isinstance(empty_status.json()["check_in_revision"], str)

    created = test_client.post(
        "/patients",
        headers=headers,
        json={
            "name": "Heartbeat Patient",
            "phone": "9000000042",
            "reason": "Routine visit",
            "date_of_birth": "1990-01-02",
        },
    )
    assert created.status_code == 201

    snapshot = test_client.get("/patients/queue", headers=headers)
    assert snapshot.status_code == 200
    assert snapshot.json()["revision"] != empty_status.json()["queue_revision"]
    assert [row["id"] for row in snapshot.json()["patients"]] == [created.json()["id"]]

    updated_status = test_client.get("/dashboard/status", headers=headers)
    assert updated_status.json()["active_patient_count"] == 1
    assert updated_status.json()["queue_revision"] == snapshot.json()["revision"]


def test_public_qr_check_in_requires_staff_approval_and_suggests_existing_patient(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="qr-check-in@example.com", clinic_name="Fika Eye Care")
    headers = auth_headers_for_token(session["token"])

    existing = test_client.post(
        "/patients",
        headers=headers,
        json={
            "name": "Trusted Patient Name",
            "phone": "9876543210",
            "email": "trusted@example.com",
            "reason": "Previous visit",
            "date_of_birth": "1994-03-12",
        },
    ).json()
    repo.patients[existing["id"]]["status"] = "done"
    repo.patients[existing["id"]]["billed"] = True
    queue_anchor = test_client.post(
        "/patients",
        headers=headers,
        json={
            "name": "Already Waiting",
            "phone": "9000000001",
            "reason": "Routine visit",
            "date_of_birth": "1988-01-02",
        },
    ).json()

    config = test_client.get("/check-in/config", headers=headers)
    assert config.status_code == 200
    assert config.json()["enabled"] is False

    enabled = test_client.patch("/check-in/config", headers=headers, json={"enabled": True})
    assert enabled.status_code == 200
    public_url = enabled.json()["public_url"]
    public_token = public_url.split("token=", 1)[1]

    context = test_client.get(f"/public/check-in?token={public_token}")
    assert context.status_code == 200
    assert context.json()["clinic_name"] == "Fika Eye Care"

    submitted = test_client.post(
        "/public/check-in",
        json={
            "token": public_token,
            "name": "Untrusted Different Name",
            "phone": "9876543210",
            "email": "trusted@example.com",
            "date_of_birth": "1994-03-12",
            "sex_at_birth": "female",
            "reason": "Blurred vision",
        },
    )
    assert submitted.status_code == 201
    request_id = submitted.json()["id"]
    tracking_token = submitted.json()["tracking_token"]
    assert tracking_token
    assert repo.public_check_in_requests[request_id]["tracking_token_hash"] == hashlib.sha256(
        tracking_token.encode("utf-8")
    ).hexdigest()
    pending_status = test_client.get(
        "/public/check-in/status",
        headers={"X-Check-In-Token": tracking_token},
    )
    assert pending_status.status_code == 200
    assert pending_status.json() == {"status": "pending"}
    request_feed_status = test_client.get("/check-in/requests/status", headers=headers)
    assert request_feed_status.status_code == 200
    assert request_feed_status.json()["pending_count"] == 1
    assert request_feed_status.json()["revision"]
    missing_status = test_client.get(
        "/public/check-in/status",
        headers={"X-Check-In-Token": str(uuid4())},
    )
    assert missing_status.status_code == 404
    assert missing_status.json()["detail"] == "Check-in request not found."
    assert not any(
        patient["reason"] == "Blurred vision" and patient["status"] == "waiting"
        for patient in repo.patients.values()
    )

    pending = test_client.get("/check-in/requests", headers=headers)
    assert pending.status_code == 200
    request = pending.json()[0]
    assert request["id"] == request_id
    assert request["candidates"][0]["id"] == existing["id"]
    assert request["candidates"][0]["confidence"] == "strong"
    assert request["candidates"][0]["match_reasons"] == [
        "Phone match",
        "Email match",
        "Date of birth match",
    ]

    approved = test_client.post(
        f"/check-in/requests/{request_id}/approve",
        headers=headers,
        json={"existing_patient_id": existing["id"], "force_new": False},
    )
    assert approved.status_code == 200
    assert approved.json()["id"] == existing["id"]
    assert approved.json()["name"] == "Trusted Patient Name"
    assert approved.json()["phone"] == "9876543210"
    assert approved.json()["email"] == "trusted@example.com"
    assert approved.json()["reason"] == "Blurred vision"
    assert approved.json()["status"] == "waiting"
    assert approved.json()["queue_position"] == queue_anchor["queue_position"] + 1
    approved_status = test_client.get(
        "/public/check-in/status",
        headers={"X-Check-In-Token": tracking_token},
    )
    assert approved_status.json() == {"status": "approved"}
    assert test_client.get("/check-in/requests", headers=headers).json() == []
    assert test_client.get("/check-in/requests/status", headers=headers).json()["pending_count"] == 0

    new_submission = test_client.post(
        "/public/check-in",
        json={
            "token": public_token,
            "name": "New QR Patient",
            "phone": "9123456780",
            "email": "new.qr.patient@example.com",
            "date_of_birth": "2001-08-09",
            "sex_at_birth": "other",
            "reason": "Eye strain",
        },
    )
    assert new_submission.status_code == 201
    new_patient = test_client.post(
        f"/check-in/requests/{new_submission.json()['id']}/approve",
        headers=headers,
        json={"existing_patient_id": None, "force_new": True},
    )
    assert new_patient.status_code == 200
    assert new_patient.json()["email"] == "new.qr.patient@example.com"
    assert new_patient.json()["sex_at_birth"] == "other"
    assert new_patient.json()["queue_position"] == approved.json()["queue_position"] + 1

    rejected_submission = test_client.post(
        "/public/check-in",
        json={
            "token": public_token,
            "name": "Declined Patient",
            "phone": "9123456781",
            "email": "declined@example.com",
            "date_of_birth": "2002-09-10",
            "sex_at_birth": "female",
            "reason": "Dry eyes",
        },
    ).json()
    rejected = test_client.post(
        f"/check-in/requests/{rejected_submission['id']}/reject",
        headers=headers,
        json={"reason": ""},
    )
    assert rejected.status_code == 200
    rejected_status = test_client.get(
        "/public/check-in/status",
        headers={"X-Check-In-Token": rejected_submission["tracking_token"]},
    )
    assert rejected_status.json() == {"status": "rejected"}
    repo.public_check_in_requests[rejected_submission["id"]].update(
        status="pending",
        expires_at=_now() - timedelta(seconds=1),
    )
    expired_status = test_client.get(
        "/public/check-in/status",
        headers={"X-Check-In-Token": rejected_submission["tracking_token"]},
    )
    assert expired_status.json() == {"status": "expired"}
    assert repo.public_check_in_requests[rejected_submission["id"]]["status"] == "pending"
    assert test_client.get("/check-in/requests", headers=headers).json() == []
    assert test_client.get("/check-in/requests/status", headers=headers).json()["pending_count"] == 0
    expired_rejection = test_client.post(
        f"/check-in/requests/{rejected_submission['id']}/reject",
        headers=headers,
        json={"reason": ""},
    )
    assert expired_rejection.status_code == 400


def test_public_qr_appointment_books_only_after_capacity_check_and_can_be_managed(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="qr-appointment@example.com",
        clinic_name="Fika Eye Care",
    )
    headers = auth_headers_for_token(session["token"])
    enabled = test_client.patch("/check-in/config", headers=headers, json={"enabled": True})
    public_token = enabled.json()["public_url"].split("token=", 1)[1]

    slots_response = test_client.get(
        f"/public/check-in/appointment-slots?token={public_token}"
    )
    assert slots_response.status_code == 200
    slots = slots_response.json()["suggested_slots"]
    assert len(slots) >= 2
    patient_count_before = len(repo.patients)

    payload = {
        "token": public_token,
        "name": "Appointment Patient",
        "phone": "9000011111",
        "email": "appointment@example.com",
        "date_of_birth": "1990-06-15",
        "sex_at_birth": "female",
        "reason": "Routine eye exam",
        "scheduled_for": slots[0],
    }
    booked = test_client.post("/public/check-in/appointment", json=payload)
    assert booked.status_code == 201
    booking = booked.json()
    assert booking["status"] == "scheduled"
    assert booking["scheduled_for"] == slots[0]
    assert len(repo.patients) == patient_count_before
    assert repo.public_check_in_requests == {}

    collision = test_client.post(
        "/public/check-in/appointment",
        json={**payload, "phone": "9000022222", "email": "other@example.com"},
    )
    assert collision.status_code == 400
    assert "already booked" in collision.json()["detail"].lower()

    context = test_client.get(
        "/public/check-in/appointment",
        params={"booking_token": booking["booking_token"]},
    )
    assert context.status_code == 200
    assert context.json()["appointment_id"] == booking["appointment_id"]

    rescheduled = test_client.post(
        "/public/check-in/appointment/reschedule",
        json={
            "booking_token": booking["booking_token"],
            "scheduled_for": slots[1],
        },
    )
    assert rescheduled.status_code == 200
    assert rescheduled.json()["scheduled_for"] == slots[1]

    cancelled = test_client.post(
        "/public/check-in/appointment/cancel",
        json={"booking_token": booking["booking_token"]},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


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

    follow_up_day = (datetime.now(UTC) + timedelta(days=2)).date()
    while follow_up_day.weekday() == 6:
        follow_up_day += timedelta(days=1)
    scheduled_for_value = datetime(
        follow_up_day.year,
        follow_up_day.month,
        follow_up_day.day,
        8,
        30,
        tzinfo=UTC,
    )
    scheduled_for = scheduled_for_value.isoformat()
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

    first_slot = scheduled_for_value.replace(hour=9, minute=0)
    second_slot = first_slot + timedelta(minutes=30)
    repo.clinic_settings[session["user"]["org_id"]].update(
        {
            "timezone": "UTC",
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
    assert reused_response.status_code == 200
    booked_context = reused_response.json()
    assert booked_context["appointment_status"] == "scheduled"
    appointment_id = booked_context["appointment_id"]
    assert datetime.fromisoformat(booked_context["appointment_scheduled_for"].replace("Z", "+00:00")) == second_slot

    third_slot = second_slot + timedelta(days=1)
    reschedule_response = test_client.post(
        "/public/follow-up-booking",
        json={"token": booking_token, "scheduled_for": third_slot.isoformat()},
    )
    assert reschedule_response.status_code == 204

    rescheduled_context = test_client.get(f"/public/follow-up-booking?token={booking_token}")
    assert rescheduled_context.status_code == 200
    assert rescheduled_context.json()["appointment_id"] == appointment_id
    assert datetime.fromisoformat(
        rescheduled_context.json()["appointment_scheduled_for"].replace("Z", "+00:00")
    ) == third_slot

    cancel_response = test_client.post(
        "/public/follow-up-booking/cancel",
        json={"token": booking_token},
    )
    assert cancel_response.status_code == 204
    cancelled_context = test_client.get(f"/public/follow-up-booking?token={booking_token}")
    assert cancelled_context.status_code == 200
    assert cancelled_context.json()["appointment_status"] == "cancelled"

    rebook_response = test_client.post(
        "/public/follow-up-booking",
        json={"token": booking_token, "scheduled_for": second_slot.isoformat()},
    )
    assert rebook_response.status_code == 204
    assert len(
        [
            appointment
            for appointment in repo.appointments.values()
            if appointment.get("follow_up_id") == follow_up["id"]
        ]
    ) == 1

    follow_ups_response = test_client.get(
        f"/follow-ups?view=history&scheduled_date={second_slot.date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert follow_ups_response.status_code == 200
    refreshed_follow_up = follow_ups_response.json()["items"][0]
    assert datetime.fromisoformat(refreshed_follow_up["scheduled_for"].replace("Z", "+00:00")) == second_slot
    assert refreshed_follow_up["status"] == "completed"

    appointments_response = test_client.get(
        f"/appointments?scheduled_date={second_slot.date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert appointments_response.status_code == 200
    appointment_reasons = [appointment["reason"] for appointment in appointments_response.json()]
    assert "Follow-up: Review visit" in appointment_reasons

    appointment_events = [event for event in repo.audit_events.values() if event["entity_type"] == "appointment"]
    assert any(event["actor_user_id"] is None for event in appointment_events)
    assert any(event.get("metadata", {}).get("source") == "public_follow_up_booking" for event in appointment_events)
    assert any(event["action"] == "appointment_rescheduled" for event in appointment_events)
    assert any(event["action"] == "appointment_cancelled" for event in appointment_events)


def test_staff_can_remind_patient_and_follow_up_tracking_is_returned(client, monkeypatch: pytest.MonkeyPatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="reminders@example.com", clinic_name="Reminder Clinic")
    token = session["token"]

    async def fake_email(*_args, **_kwargs):
        return None

    async def fake_whatsapp(*_args, **_kwargs):
        return {"id": "message-1", "status": "accepted"}

    monkeypatch.setattr(followup_workflow_module, "_send_follow_up_email", fake_email)
    monkeypatch.setattr(followup_workflow_module, "send_follow_up_booking_invitation", fake_whatsapp)

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Reminder Patient",
            "phone": "5550105555",
            "email": "reminder-patient@example.com",
            "address": "123 Main Street",
            "reason": "Review",
            "age": 34,
            "weight": 68,
            "height": 170,
            "temperature": 98.4,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()
    follow_up_response = test_client.post(
        f"/patients/{patient['id']}/follow-ups",
        headers=auth_headers_for_token(token),
        json={
            "scheduled_for": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
            "notes": "Pressure review",
        },
    )
    assert follow_up_response.status_code == 201
    follow_up = follow_up_response.json()

    for event in repo.audit_events.values():
        if event["entity_type"] == "follow_up" and event["entity_id"] == follow_up["id"]:
            event["created_at"] = datetime.now(UTC) - timedelta(hours=25)

    reminder_response = test_client.post(
        f"/follow-ups/{follow_up['id']}/remind",
        headers=auth_headers_for_token(token),
        json={"channels": ["email", "whatsapp"], "idempotency_key": "test-reminder-1"},
    )
    assert reminder_response.status_code == 200
    assert reminder_response.json()["delivery_status"] == "sent"
    assert reminder_response.json()["channels"] == {"email": "sent", "whatsapp": "sent"}

    listed = test_client.get("/follow-ups", headers=auth_headers_for_token(token))
    assert listed.status_code == 200
    tracked = next(row for row in listed.json()["items"] if row["id"] == follow_up["id"])
    assert tracked["reminder_count"] == 1
    assert tracked["last_contact_channels"] == ["email", "whatsapp"]
    assert tracked["last_delivery_status"] == "sent"


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

    yesterday = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0) - timedelta(days=1)
    tomorrow = datetime.now(UTC).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)

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
            "scheduled_for": tomorrow.isoformat(),
        },
    )
    assert old_appointment.status_code == 201
    old_appointment_body = old_appointment.json()
    repo.appointments[old_appointment_body["id"]]["scheduled_for"] = yesterday

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
        json={"scheduled_for": tomorrow.isoformat(), "notes": "Old follow-up"},
    )
    assert old_follow_up.status_code == 201
    old_follow_up_body = old_follow_up.json()
    repo.follow_ups[old_follow_up_body["id"]]["scheduled_for"] = yesterday

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
            f"/follow-ups?view=delivery_issues&scheduled_date={tomorrow.date().isoformat()}",
        headers=auth_headers_for_token(token),
    )
    assert follow_ups_response.status_code == 200
    follow_up_ids = {row["id"] for row in follow_ups_response.json()["items"]}
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


def test_module_entries_serialize_postgres_uuid_rows(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="module-uuid@example.com",
        clinic_name="Module UUID Clinic",
    )
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Dev Patel",
            "phone": "5550104545",
            "email": "dev@example.com",
            "address": "14 Vision Road",
            "reason": "Myopia review",
            "age": 17,
            "weight": 56,
            "height": 169,
            "temperature": 98.3,
        },
    )
    assert patient_response.status_code == 201
    patient_id = patient_response.json()["id"]
    record_id = uuid4()

    async def list_postgres_shaped_tracks(org_id: str, requested_patient_id: str, *, track_type: str | None = None) -> list[dict]:
        assert org_id == session["user"]["org_id"]
        assert requested_patient_id == patient_id
        assert track_type is None
        return [{
            "id": record_id,
            "org_id": UUID(org_id),
            "patient_id": UUID(patient_id),
            "track_type": "eye_exam",
            "measured_at": datetime(2026, 8, 6, 10, 0, tzinfo=UTC),
            "summary_fields": {"summary": "Complete eye examination"},
            "raw_payload": {"version": 2, "case_sheet": {}},
            "derived_metrics": {},
            "created_at": datetime(2026, 8, 6, 10, 0, tzinfo=UTC),
        }]

    repo.list_longitudinal_tracks_for_patient = list_postgres_shaped_tracks

    response = test_client.get(
        f"/patients/{patient_id}/module-entries",
        headers=auth_headers_for_token(token),
    )

    assert response.status_code == 200
    assert response.json() == [{
        "id": str(record_id),
        "track_type": "eye_exam",
        "patient_id": patient_id,
        "org_id": session["user"]["org_id"],
        "measured_at": "2026-08-06T10:00:00Z",
        "summary_fields": {"summary": "Complete eye examination"},
        "raw_payload": {"version": 2, "case_sheet": {}},
        "derived_metrics": {},
        "created_at": "2026-08-06T10:00:00Z",
    }]


def test_tbi_evaluation_is_optometry_only_and_appears_in_timeline(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="tbi@example.com", clinic_name="TBI Clinic")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Rit Shah",
            "phone": "5550109999",
            "email": "rit@example.com",
            "address": "14 Vision Lane",
            "reason": "TBI evaluation",
            "age": 29,
            "weight": 70,
            "height": 174,
            "temperature": 98.2,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    blocked_response = test_client.post(
        f"/patients/{patient['id']}/tbi-evaluations",
        headers=auth_headers_for_token(token),
        json={
            "measured_at": "2026-07-22T10:00:00+00:00",
            "payload": {"visual_acuity": {"unaided": {"od": "6/9 +1", "os": "N6"}}},
        },
    )
    assert blocked_response.status_code == 400

    repo.clinic_settings[session["user"]["org_id"]]["clinic_specialty"] = "optometry"
    payload = {
        "visual_acuity": {
            "unaided": {"od": "6/9 +1", "os": "CF @ 2m?", "ou": "N6 / 20∆ BO"},
        },
        "final_comments": "Symbols ok: + - / @ ? ∆",
        "management_and_therapy_options": "VT review in 2 weeks.",
    }
    created_response = test_client.post(
        f"/patients/{patient['id']}/tbi-evaluations",
        headers=auth_headers_for_token(token),
        json={"measured_at": "2026-07-22T10:00:00+00:00", "payload": payload},
    )
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["payload"]["visual_acuity"]["unaided"]["ou"] == "N6 / 20∆ BO"

    list_response = test_client.get(
        f"/patients/{patient['id']}/tbi-evaluations",
        headers=auth_headers_for_token(token),
    )
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    timeline_response = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers_for_token(token),
    )
    assert timeline_response.status_code == 200
    tbi_events = [event for event in timeline_response.json() if event["type"] == "tbi_evaluation"]
    assert len(tbi_events) == 1
    assert "Unaided VA" in tbi_events[0]["description"]


def test_binocular_vision_evaluation_is_optometry_only_and_appears_in_timeline(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="binocular@example.com", clinic_name="BV Clinic")
    token = session["token"]

    patient_response = test_client.post(
        "/patients",
        headers=auth_headers_for_token(token),
        json={
            "name": "Nia Shah",
            "phone": "5550108888",
            "email": "nia@example.com",
            "address": "18 Vision Lane",
            "reason": "binocular vision assessment",
            "age": 16,
            "weight": 52,
            "height": 162,
            "temperature": 98.2,
        },
    )
    assert patient_response.status_code == 201
    patient = patient_response.json()

    blocked_response = test_client.post(
        f"/patients/{patient['id']}/binocular-vision-evaluations",
        headers=auth_headers_for_token(token),
        json={
            "measured_at": "2026-07-22T10:00:00+00:00",
            "payload": {"history": {"main_complaints": "Eyestrain"}},
        },
    )
    assert blocked_response.status_code == 400

    repo.clinic_settings[session["user"]["org_id"]]["clinic_specialty"] = "optometry"
    payload = {
        "history": {"main_complaints": "Eyestrain at near work"},
        "motor_evaluation": {"npc_accommodative_target": {"objective": "8 cm"}},
        "sensory_evaluation": {"stereopsis": {"near": "40 sec arc"}},
        "impression": "Convergence insufficiency",
    }
    created_response = test_client.post(
        f"/patients/{patient['id']}/binocular-vision-evaluations",
        headers=auth_headers_for_token(token),
        json={"measured_at": "2026-07-22T10:00:00+00:00", "payload": payload},
    )
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["payload"]["impression"] == "Convergence insufficiency"
    assert "Convergence insufficiency" in created["summary_fields"]["summary"]

    list_response = test_client.get(
        f"/patients/{patient['id']}/binocular-vision-evaluations",
        headers=auth_headers_for_token(token),
    )
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    timeline_response = test_client.get(
        f"/patients/{patient['id']}/timeline",
        headers=auth_headers_for_token(token),
    )
    assert timeline_response.status_code == 200
    binocular_events = [event for event in timeline_response.json() if event["type"] == "binocular_vision"]
    assert len(binocular_events) == 1
    assert "Convergence insufficiency" in binocular_events[0]["description"]


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
            org_id=org["id"],
            identifier="admin@clinic.test",
            email="admin@clinic.test",
            name="Dr. Rivera",
            password_hash="hashed-password",
            role="admin",
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
