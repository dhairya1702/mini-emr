from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.repositories.base import (
    BaseSupabaseRepository,
    DuplicateCheckInCandidateError,
    escape_ilike,
    find_check_in_matches,
    normalize_phone_number,
    rpc_single,
    visit_payload,
)
from app.schemas import AppointmentCheckInRequest, AppointmentCreate, AppointmentUpdate, PatientCreate, PatientVisitCreate


class PatientFlowRepositoryMixin(BaseSupabaseRepository):
    async def list_patients(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            patients = self.client.table("patients").select("*").eq("org_id", org_id).execute().data
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
                enriched.append({**patient, "last_visit_at": effective_last_visit_at})
            enriched.sort(key=lambda patient: str(patient.get("last_visit_at") or ""), reverse=True)
            return enriched

        return await asyncio.to_thread(_list)

    async def create_patient(self, org_id: str, payload: PatientCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = (
                self.client.table("patients")
                .insert({"org_id": org_id, **visit_payload(payload), "last_visit_at": datetime.now(UTC).isoformat()})
                .execute()
                .data[0]
            )
            self.client.table("patient_visits").insert(
                {"org_id": org_id, "patient_id": patient["id"], **visit_payload(payload), "source": "queue"}
            ).execute()
            return patient

        return await asyncio.to_thread(_create)

    async def create_patient_visit(self, org_id: str, patient_id: str, payload: PatientVisitCreate) -> dict[str, Any]:
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
                        **visit_payload(payload),
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
                {"org_id": org_id, "patient_id": patient_id, **visit_payload(payload), "source": "queue"}
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
                    "phone": normalize_phone_number(payload.phone),
                    "email": payload.email.strip().lower(),
                    "address": payload.address.strip(),
                    "scheduled_for": payload.scheduled_for.isoformat(),
                    "status": "scheduled",
                }
            )
            .execute()
            .data[0]
        )

    async def list_appointments(self, org_id: str, status: str | None = None, query: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            db_query = self.client.table("appointments").select("*").eq("org_id", org_id)
            if status:
                db_query = db_query.eq("status", status)
            normalized_query = (query or "").strip()
            if normalized_query:
                escaped_query = escape_ilike(normalized_query)
                db_query = db_query.or_(
                    f"name.ilike.%{escaped_query}%,phone.ilike.%{escaped_query}%,reason.ilike.%{escaped_query}%"
                )
            return db_query.order("scheduled_for", desc=False).limit(limit).execute().data

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
        return await asyncio.to_thread(lambda: find_check_in_matches(self.client, org_id, appointment_id))

    async def check_in_appointment(self, org_id: str, appointment_id: str, payload: AppointmentCheckInRequest) -> tuple[dict[str, Any], dict[str, Any]]:
        def _check_in() -> tuple[dict[str, Any], dict[str, Any]]:
            if payload.existing_patient_id is None and not payload.force_new:
                matches = find_check_in_matches(self.client, org_id, appointment_id)
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
            payload_data = rpc_single(result)
            appointment = payload_data.get("appointment")
            patient = payload_data.get("patient")
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
            update_payload["phone"] = normalize_phone_number(update_payload["phone"])
        if "email" in update_payload and update_payload["email"] is not None:
            update_payload["email"] = str(update_payload["email"]).strip().lower()
        if "address" in update_payload and update_payload["address"] is not None:
            update_payload["address"] = str(update_payload["address"]).strip()
        if "name" in update_payload and update_payload["name"] is not None:
            update_payload["name"] = str(update_payload["name"]).strip()
        if "reason" in update_payload and update_payload["reason"] is not None:
            update_payload["reason"] = str(update_payload["reason"]).strip()
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .update(update_payload)
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .execute()
            .data[0]
        )

    async def list_patient_matches_by_phone(self, org_id: str, phone: str, limit: int = 10) -> list[dict[str, Any]]:
        normalized_phone = normalize_phone_number(phone)
        if not normalized_phone:
            return []
        patients = await self.list_patients(org_id)
        return [patient for patient in patients if normalize_phone_number(patient.get("phone")) == normalized_phone][:limit]

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
