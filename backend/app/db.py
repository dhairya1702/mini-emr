import asyncio
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any
from uuid import uuid4

from supabase import Client, create_client

from app.config import get_settings
from app.schemas import (
    AppointmentCreate,
    AppointmentCheckInRequest,
    AppointmentUpdate,
    CatalogItemCreate,
    CatalogStockUpdate,
    ClinicSettingsUpdate,
    FollowUpCreate,
    FollowUpUpdate,
    InvoiceCreate,
    NoteCreate,
    PatientCreate,
    PatientVisitCreate,
    UserRole,
)


class DuplicateCheckInCandidateError(ValueError):
    def __init__(self, matches: list[dict[str, Any]]) -> None:
        super().__init__("Possible duplicate active patients found.")
        self.matches = matches


def _display_name(row: dict[str, Any]) -> str:
    stored_name = str(row.get("name") or "").strip()
    if stored_name:
        return stored_name

    identifier = str(row.get("identifier") or "").strip()
    if "@" in identifier:
        local_part = identifier.split("@", 1)[0]
        return local_part.replace(".", " ").replace("_", " ").strip().title() or "User"
    return identifier or "User"


def _rpc_single(result: Any) -> dict[str, Any]:
    if isinstance(result, list):
        return result[0] if result else {}
    return result or {}


def _escape_ilike(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace(",", "\\,")


def _normalize_phone_number(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    digits = "".join(char for char in raw if char.isdigit())
    if raw.startswith("+") and digits:
        return f"+{digits}"
    return digits


def _round_money(value: float) -> float:
    return round(float(value), 2)


def _normalize_invoice_amount_paid(payment_status: str, amount_paid: float | None, total: float) -> float:
    normalized_total = _round_money(total)
    if payment_status == "paid":
        return normalized_total
    if payment_status == "unpaid":
        return 0.0
    if amount_paid is None:
        raise ValueError("Enter the amount received for a partial invoice.")
    normalized_paid = _round_money(amount_paid)
    if normalized_paid <= 0:
        raise ValueError("Partial invoices must record an amount greater than zero.")
    if normalized_paid >= normalized_total:
        raise ValueError("Partial invoice amount must be less than the invoice total.")
    return normalized_paid


def _attach_invoice_balances(invoice: dict[str, Any]) -> dict[str, Any]:
    total = _round_money(invoice.get("total") or 0)
    amount_paid = _round_money(invoice.get("amount_paid") or 0)
    return {
        **invoice,
        "amount_paid": amount_paid,
        "balance_due": _round_money(max(total - amount_paid, 0)),
    }


def _visit_payload(payload: PatientCreate | PatientVisitCreate) -> dict[str, Any]:
    return {
        "name": payload.name.strip(),
        "phone": _normalize_phone_number(payload.phone),
        "reason": payload.reason.strip(),
        "age": payload.age,
        "weight": payload.weight,
        "height": payload.height,
        "temperature": payload.temperature,
    }


def _find_check_in_matches(client: Client, org_id: str, appointment_id: str) -> list[dict[str, Any]]:
    appointment = (
        client.table("appointments")
        .select("*")
        .eq("org_id", org_id)
        .eq("id", appointment_id)
        .single()
        .execute()
        .data
    )
    if not appointment:
        raise ValueError("Appointment not found for this organization.")

    normalized_phone = _normalize_phone_number(appointment.get("phone"))
    if not normalized_phone:
        return []

    candidates = (
        client.table("patients")
        .select("*")
        .eq("org_id", org_id)
        .eq("billed", False)
        .order("last_visit_at", desc=True)
        .limit(50)
        .execute()
        .data
    )
    return [
        candidate
        for candidate in candidates
        if _normalize_phone_number(candidate.get("phone")) == normalized_phone
    ]


class SupabaseRepository:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase environment variables are not configured.")
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    async def create_organization(self, clinic_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("organizations")
            .insert({"name": clinic_name.strip()})
            .execute()
            .data[0]
        )

    async def create_audit_event(
        self,
        org_id: str,
        actor_user_id: str | None,
        actor_name: str,
        entity_type: str,
        entity_id: str,
        action: str,
        summary: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("audit_events")
            .insert(
                {
                    "org_id": org_id,
                    "actor_user_id": actor_user_id,
                    "actor_name": actor_name.strip(),
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "action": action,
                    "summary": summary.strip(),
                    "metadata": metadata or {},
                }
            )
            .execute()
            .data[0]
        )

    async def list_audit_events(self, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("audit_events")
            .select("*")
            .eq("org_id", org_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
        )

    async def list_patients(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            patients = (
                self.client.table("patients")
                .select("*")
                .eq("org_id", org_id)
                .execute()
                .data
            )
            visits = (
                self.client.table("patient_visits")
                .select("patient_id,created_at")
                .eq("org_id", org_id)
                .order("created_at", desc=True)
                .execute()
                .data
            )
            latest_visit_by_patient: dict[str, str] = {}
            for visit in visits:
                patient_id = str(visit.get("patient_id") or "")
                created_at = str(visit.get("created_at") or "")
                if patient_id and created_at and patient_id not in latest_visit_by_patient:
                    latest_visit_by_patient[patient_id] = created_at

            enriched: list[dict[str, Any]] = []
            for patient in patients:
                effective_last_visit_at = latest_visit_by_patient.get(
                    str(patient.get("id") or ""),
                    str(patient.get("created_at") or patient.get("last_visit_at") or ""),
                )
                enriched.append(
                    {
                        **patient,
                        "last_visit_at": effective_last_visit_at,
                    }
                )
            enriched.sort(key=lambda patient: str(patient.get("last_visit_at") or ""), reverse=True)
            return enriched

        return await asyncio.to_thread(_list)

    async def create_patient(self, org_id: str, payload: PatientCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = (
                self.client.table("patients")
                .insert(
                    {
                        "org_id": org_id,
                        **_visit_payload(payload),
                        "last_visit_at": datetime.now(UTC).isoformat(),
                    }
                )
                .execute()
                .data[0]
            )
            self.client.table("patient_visits").insert(
                {
                    "org_id": org_id,
                    "patient_id": patient["id"],
                    **_visit_payload(payload),
                    "source": "queue",
                }
            ).execute()
            return patient

        return await asyncio.to_thread(_create)

    async def create_patient_visit(
        self,
        org_id: str,
        patient_id: str,
        payload: PatientVisitCreate,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = (
                self.client.table("patients")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", patient_id)
                .single()
                .execute()
                .data
            )
            if not patient:
                raise ValueError("Patient not found for this organization.")

            updated = (
                self.client.table("patients")
                .update(
                    {
                        **_visit_payload(payload),
                        "status": "waiting",
                        "billed": False,
                        "last_visit_at": datetime.now(UTC).isoformat(),
                    }
                )
                .eq("org_id", org_id)
                .eq("id", patient_id)
                .execute()
                .data[0]
            )
            self.client.table("patient_visits").insert(
                {
                    "org_id": org_id,
                    "patient_id": patient_id,
                    **_visit_payload(payload),
                    "source": "queue",
                }
            ).execute()
            return updated

        return await asyncio.to_thread(_create)

    async def create_appointment(self, org_id: str, payload: AppointmentCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("appointments")
            .insert(
                {
                    "org_id": org_id,
                    **payload.model_dump(),
                    "phone": _normalize_phone_number(payload.phone),
                    "scheduled_for": payload.scheduled_for.isoformat(),
                    "status": "scheduled",
                }
            )
            .execute()
            .data[0]
        )

    async def list_appointments(
        self,
        org_id: str,
        status: str | None = None,
        query: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            db_query = (
                self.client.table("appointments")
                .select("*")
                .eq("org_id", org_id)
            )
            if status:
                db_query = db_query.eq("status", status)
            normalized_query = (query or "").strip()
            if normalized_query:
                escaped_query = _escape_ilike(normalized_query)
                db_query = db_query.or_(
                    f"name.ilike.%{escaped_query}%,phone.ilike.%{escaped_query}%,reason.ilike.%{escaped_query}%"
                )
            return (
                db_query
                .order("scheduled_for", desc=False)
                .limit(limit)
                .execute()
                .data
            )

        return await asyncio.to_thread(_list)

    async def list_appointments_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("appointments")
            .select("*")
            .eq("org_id", org_id)
            .eq("checked_in_patient_id", patient_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )

    async def list_patient_visits_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("patient_visits")
            .select("*")
            .eq("org_id", org_id)
            .eq("patient_id", patient_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )

    async def list_patient_visits(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("patient_visits")
            .select("*")
            .eq("org_id", org_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )

    async def list_potential_check_in_matches(self, org_id: str, appointment_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(lambda: _find_check_in_matches(self.client, org_id, appointment_id))

    async def check_in_appointment(
        self,
        org_id: str,
        appointment_id: str,
        payload: AppointmentCheckInRequest,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        def _check_in() -> tuple[dict[str, Any], dict[str, Any]]:
            if payload.existing_patient_id is None and not payload.force_new:
                matches = _find_check_in_matches(self.client, org_id, appointment_id)
                if matches:
                    raise DuplicateCheckInCandidateError(matches)

            result = (
                self.client.rpc(
                    "check_in_appointment_atomic",
                    {
                        "p_org_id": org_id,
                        "p_appointment_id": appointment_id,
                        "p_existing_patient_id": str(payload.existing_patient_id) if payload.existing_patient_id else None,
                    },
                )
                .execute()
                .data
            )
            payload = _rpc_single(result)
            appointment = payload.get("appointment")
            patient = payload.get("patient")
            if not appointment or not patient:
                raise ValueError("Failed to check in appointment.")
            return appointment, patient

        return await asyncio.to_thread(_check_in)

    async def update_appointment(self, org_id: str, appointment_id: str, payload: AppointmentUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            appointment = (
                self.client.table("appointments")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", appointment_id)
                .single()
                .execute()
                .data
            )
            if not appointment:
                raise ValueError("Appointment not found for this organization.")

            current_status = str(appointment.get("status") or "")
            if current_status == "checked_in":
                raise ValueError("Checked-in appointments cannot be edited.")

            update_payload: dict[str, Any] = {}
            if payload.scheduled_for is not None:
                if current_status != "scheduled":
                    raise ValueError("Only scheduled appointments can be rescheduled.")
                update_payload["scheduled_for"] = payload.scheduled_for.isoformat()

            if payload.status is not None:
                if payload.status == "checked_in":
                    raise ValueError("Use check-in to move appointments into the queue.")
                if payload.status == "cancelled":
                    if current_status != "scheduled":
                        raise ValueError("Only scheduled appointments can be cancelled.")
                    update_payload["status"] = "cancelled"
                elif payload.status == "scheduled":
                    if current_status == "cancelled":
                        update_payload["status"] = "scheduled"
                    else:
                        update_payload["status"] = "scheduled"

            if not update_payload:
                raise ValueError("No appointment updates provided.")

            return (
                self.client.table("appointments")
                .update(update_payload)
                .eq("org_id", org_id)
                .eq("id", appointment_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_update)

    async def update_patient(self, org_id: str, patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        update_payload = dict(payload)
        if "phone" in update_payload and update_payload["phone"] is not None:
            update_payload["phone"] = _normalize_phone_number(update_payload["phone"])
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .update(update_payload)
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .execute()
            .data[0]
        )

    async def list_patient_matches_by_phone(self, org_id: str, phone: str, limit: int = 10) -> list[dict[str, Any]]:
        normalized_phone = _normalize_phone_number(phone)
        if not normalized_phone:
            return []
        patients = await self.list_patients(org_id)
        return [
            patient
            for patient in patients
            if _normalize_phone_number(patient.get("phone")) == normalized_phone
        ][:limit]

    async def get_patient(self, org_id: str, patient_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .single()
            .execute()
            .data
        )

    async def create_note(
        self,
        org_id: str,
        payload: NoteCreate,
        *,
        version_number: int = 1,
        root_note_id: str | None = None,
        amended_from_note_id: str | None = None,
    ) -> dict[str, Any]:
        note_id = str(uuid4())
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .insert(
                {
                    "id": note_id,
                    "org_id": org_id,
                    "patient_id": str(payload.patient_id),
                    "content": payload.content,
                    "status": "draft",
                    "version_number": version_number,
                    "root_note_id": root_note_id,
                    "amended_from_note_id": amended_from_note_id,
                    "snapshot_content": None,
                    "finalized_at": None,
                    "sent_at": None,
                    "sent_by": None,
                    "sent_to": None,
                }
            )
            .execute()
            .data[0]
        )

    async def update_note_draft(self, org_id: str, note_id: str, content: str) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            note = (
                self.client.table("notes")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", note_id)
                .single()
                .execute()
                .data
            )
            if not note:
                raise ValueError("Note not found for this organization.")
            if note.get("status") != "draft":
                raise ValueError("Only draft notes can be updated.")
            updated = (
                self.client.table("notes")
                .update({"content": content})
                .eq("org_id", org_id)
                .eq("id", note_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to update note draft.")
            return updated[0]

        return await asyncio.to_thread(_update)

    async def get_note(self, org_id: str, note_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .select("*")
            .eq("org_id", org_id)
            .eq("id", note_id)
            .single()
            .execute()
            .data
        )

    async def finalize_note(self, org_id: str, note_id: str) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            note = (
                self.client.table("notes")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", note_id)
                .single()
                .execute()
                .data
            )
            if not note:
                raise ValueError("Note not found for this organization.")
            if note.get("status") == "sent":
                raise ValueError("Sent notes cannot be changed.")
            if note.get("status") == "final" and note.get("snapshot_content"):
                return note
            updated = (
                self.client.table("notes")
                .update(
                    {
                        "status": "final",
                        "snapshot_content": note.get("content") or "",
                        "finalized_at": datetime.now(UTC).isoformat(),
                    }
                )
                .eq("org_id", org_id)
                .eq("id", note_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to finalize note.")
            return updated[0]

        return await asyncio.to_thread(_finalize)

    async def create_note_amendment(self, org_id: str, note_id: str, content: str) -> dict[str, Any]:
        note = await self.get_note(org_id, note_id)
        patient_notes = await self.list_notes_for_patient(org_id, str(note["patient_id"]))
        root_note_id = str(note.get("root_note_id") or note["id"])
        existing_versions = [
            entry
            for entry in patient_notes
            if str(entry.get("root_note_id") or entry["id"]) == root_note_id
        ]
        next_version = max(int(entry.get("version_number") or 1) for entry in existing_versions) + 1
        return await self.create_note(
            org_id,
            NoteCreate(patient_id=note["patient_id"], content=content),
            version_number=next_version,
            root_note_id=root_note_id,
            amended_from_note_id=str(note["id"]),
        )

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .select("*")
            .eq("org_id", org_id)
            .eq("patient_id", patient_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )

    async def mark_note_sent(self, org_id: str, note_id: str, *, sent_by: str, sent_to: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            note = (
                self.client.table("notes")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", note_id)
                .single()
                .execute()
                .data
            )
            if not note:
                raise ValueError("Note not found for this organization.")
            if note.get("status") == "draft":
                raise ValueError("Finalize the note before sending it.")
            if note.get("sent_at"):
                return note
            updated = (
                self.client.table("notes")
                .update(
                    {
                        "status": "sent",
                        "snapshot_content": note.get("snapshot_content") or note.get("content") or "",
                        "sent_at": datetime.now(UTC).isoformat(),
                        "sent_by": sent_by,
                        "sent_to": sent_to,
                    }
                )
                .eq("org_id", org_id)
                .eq("id", note_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to mark note as sent.")
            return updated[0]

        return await asyncio.to_thread(_mark)

    async def create_follow_up(
        self,
        org_id: str,
        patient_id: str,
        created_by: str,
        payload: FollowUpCreate,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = (
                self.client.table("patients")
                .select("id")
                .eq("org_id", org_id)
                .eq("id", patient_id)
                .single()
                .execute()
                .data
            )
            if not patient:
                raise ValueError("Patient not found for this organization.")
            return (
                self.client.table("follow_ups")
                .insert(
                    {
                        "org_id": org_id,
                        "patient_id": patient_id,
                        "created_by": created_by,
                        "scheduled_for": payload.scheduled_for.isoformat(),
                        "notes": payload.notes.strip(),
                        "status": "scheduled",
                    }
                )
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_create)

    async def list_follow_ups(
        self,
        org_id: str,
        status: str | None = None,
        query: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            follow_ups_query = (
                self.client.table("follow_ups")
                .select("*")
                .eq("org_id", org_id)
            )
            if status:
                follow_ups_query = follow_ups_query.eq("status", status)
            follow_ups = (
                follow_ups_query
                .order("scheduled_for", desc=False)
                .limit(limit)
                .execute()
                .data
            )
            if not follow_ups:
                return []

            patient_ids = sorted({str(follow_up["patient_id"]) for follow_up in follow_ups})
            patients = (
                self.client.table("patients")
                .select("id, name")
                .eq("org_id", org_id)
                .in_("id", patient_ids)
                .execute()
                .data
            )
            patient_names = {str(patient["id"]): str(patient.get("name") or "").strip() for patient in patients}
            normalized_query = (query or "").strip().lower()

            rows = [
                {**follow_up, "patient_name": patient_names.get(str(follow_up["patient_id"]), "")}
                for follow_up in follow_ups
            ]
            if normalized_query:
                rows = [
                    row
                    for row in rows
                    if normalized_query in row["patient_name"].lower()
                    or normalized_query in str(row.get("notes") or "").lower()
                ]
            return rows

        return await asyncio.to_thread(_list)

    async def list_follow_ups_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("follow_ups")
            .select("*")
            .eq("org_id", org_id)
            .eq("patient_id", patient_id)
            .order("scheduled_for", desc=True)
            .execute()
            .data
        )

    async def update_follow_up(self, org_id: str, follow_up_id: str, payload: FollowUpUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            existing = (
                self.client.table("follow_ups")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", follow_up_id)
                .single()
                .execute()
                .data
            )
            if not existing:
                raise ValueError("Follow-up not found for this organization.")
            update_payload: dict[str, Any] = {}
            if payload.scheduled_for is not None:
                update_payload["scheduled_for"] = payload.scheduled_for.isoformat()
            if payload.notes is not None:
                update_payload["notes"] = payload.notes.strip()
            if payload.status is not None:
                update_payload["status"] = payload.status
                if payload.status == "completed":
                    update_payload["completed_at"] = datetime.now(UTC).isoformat()
                elif payload.status in {"scheduled", "cancelled"}:
                    update_payload["completed_at"] = None
            if not update_payload:
                raise ValueError("No follow-up updates provided.")
            return (
                self.client.table("follow_ups")
                .update(update_payload)
                .eq("org_id", org_id)
                .eq("id", follow_up_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_update)

    async def get_clinic_settings(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            rows = (
                self.client.table("clinic_settings")
                .select("*")
                .eq("org_id", org_id)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else {}

        return await asyncio.to_thread(_get)

    async def create_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def upsert_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .upsert(
                {
                    "org_id": org_id,
                    **payload.model_dump(),
                    "updated_at": timestamp,
                },
                on_conflict="org_id",
            )
            .execute()
            .data[0]
        )

    async def get_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            rows = (
                self.client.table("clinic_users")
                .select("*")
                .eq("identifier", identifier)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else None

        user = await asyncio.to_thread(_get)
        if user:
            user["name"] = _display_name(user)
        return user

    async def get_user(self, user_id: str) -> dict[str, Any]:
        user = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .select("id, org_id, identifier, name, role, created_at")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
        user["name"] = _display_name(user)
        return user

    async def create_user(self, org_id: str, identifier: str, password_hash: str, role: UserRole) -> dict[str, Any]:
        created = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .insert(
                {
                    "org_id": org_id,
                    "identifier": identifier,
                    "name": "",
                    "password_hash": password_hash,
                    "role": role,
                }
            )
            .execute()
            .data[0]
        )
        created["name"] = _display_name(created)
        return created

    async def list_users(self, org_id: str) -> list[dict[str, Any]]:
        rows = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .select("id, org_id, identifier, name, role, created_at")
            .eq("org_id", org_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )
        return [{**row, "name": _display_name(row)} for row in rows]

    async def count_users(self) -> int:
        def _count() -> int:
            rows = self.client.table("clinic_users").select("id", count="exact").execute()
            return rows.count or 0

        return await asyncio.to_thread(_count)

    async def list_catalog_items(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("catalog_items")
            .select("*")
            .eq("org_id", org_id)
            .order("item_type", desc=False)
            .order("name", desc=False)
            .execute()
            .data
        )

    async def create_catalog_item(self, org_id: str, payload: CatalogItemCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("catalog_items")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def update_catalog_stock(
        self,
        org_id: str,
        item_id: str,
        payload: CatalogStockUpdate,
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            if payload.delta == 0:
                raise ValueError("Stock adjustment must be non-zero.")
            item = (
                self.client.table("catalog_items")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", item_id)
                .single()
                .execute()
                .data
            )
            next_quantity = float(item.get("stock_quantity", 0)) + payload.delta
            if next_quantity < 0:
                raise ValueError("Stock cannot go below zero.")
            return (
                self.client.table("catalog_items")
                .update({"stock_quantity": next_quantity})
                .eq("org_id", org_id)
                .eq("id", item_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_update)

    async def delete_catalog_item(self, org_id: str, item_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.client.table("catalog_items")
            .delete()
            .eq("org_id", org_id)
            .eq("id", item_id)
            .execute()
        )

    async def create_invoice(self, org_id: str, payload: InvoiceCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            invoice_total = _round_money(sum(item.quantity * item.unit_price for item in payload.items))
            normalized_amount_paid = _normalize_invoice_amount_paid(
                payload.payment_status,
                payload.amount_paid,
                invoice_total,
            )
            result = (
                self.client.rpc(
                    "create_invoice_atomic",
                    {
                        "p_org_id": org_id,
                        "p_patient_id": str(payload.patient_id),
                        "p_payment_status": payload.payment_status,
                        "p_amount_paid": normalized_amount_paid,
                        "p_items": [
                            {
                                "catalog_item_id": str(item.catalog_item_id) if item.catalog_item_id else None,
                                "item_type": item.item_type,
                                "label": item.label,
                                "quantity": item.quantity,
                                "unit_price": item.unit_price,
                            }
                            for item in payload.items
                        ],
                    },
                )
                .execute()
                .data
            )
            invoice = _rpc_single(result)
            if not invoice:
                raise ValueError("Failed to create invoice.")
            return _attach_invoice_balances(invoice)

        return await asyncio.to_thread(_create)

    async def finalize_invoice(self, org_id: str, invoice_id: str, *, completed_by: str) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            result = (
                self.client.rpc(
                    "finalize_invoice_atomic",
                    {
                        "p_org_id": org_id,
                        "p_invoice_id": invoice_id,
                        "p_completed_by": completed_by,
                    },
                )
                .execute()
                .data
            )
            finalized = _rpc_single(result)
            if not finalized:
                raise ValueError("Failed to finalize invoice.")
            return finalized

        return await asyncio.to_thread(_finalize)

    async def get_invoice(self, org_id: str, invoice_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            invoice = (
                self.client.table("invoices")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", invoice_id)
                .single()
                .execute()
                .data
            )
            items = (
                self.client.table("invoice_items")
                .select("*")
                .eq("invoice_id", invoice_id)
                .order("created_at", desc=False)
                .execute()
                .data
            )
            invoice["items"] = items
            return _attach_invoice_balances(invoice)

        return await asyncio.to_thread(_get)

    async def list_invoices(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            invoices = (
                self.client.table("invoices")
                .select("*")
                .eq("org_id", org_id)
                .order("created_at", desc=True)
                .execute()
                .data
            )
            for invoice in invoices:
                invoice["items"] = (
                    self.client.table("invoice_items")
                    .select("*")
                    .eq("invoice_id", invoice["id"])
                    .order("created_at", desc=False)
                    .execute()
                    .data
                )
            return [_attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)

    async def list_invoices_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            invoices = (
                self.client.table("invoices")
                .select("*")
                .eq("org_id", org_id)
                .eq("patient_id", patient_id)
                .order("created_at", desc=True)
                .execute()
                .data
            )
            for invoice in invoices:
                invoice["items"] = (
                    self.client.table("invoice_items")
                    .select("*")
                    .eq("invoice_id", invoice["id"])
                    .order("created_at", desc=False)
                    .execute()
                    .data
                )
            return [_attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)


@lru_cache
def get_repository() -> SupabaseRepository:
    return SupabaseRepository()
