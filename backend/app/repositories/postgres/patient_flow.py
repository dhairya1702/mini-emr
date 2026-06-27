from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any

from psycopg import Error as PsycopgError

from app.postgres import PostgresConnectionManager
from app.repositories.base import (
    DuplicateCheckInCandidateError,
    escape_ilike,
    normalize_phone_number,
    visit_payload,
)
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.patients import (
    AppointmentCheckInRequest,
    AppointmentCreate,
    AppointmentUpdate,
    PatientCreate,
    PatientVisitCreate,
)


PATIENT_COLUMNS = [
    "id",
    "org_id",
    "name",
    "phone",
    "email",
    "address",
    "reason",
    "date_of_birth",
    "age",
    "weight",
    "height",
    "temperature",
    "profile_photo_storage_path",
    "profile_photo_content_type",
    "profile_photo_updated_at",
    "status",
    "billed",
    "ai_summary",
    "ai_summary_updated_at",
    "ai_summary_stale",
    "ai_summary_revision",
    "created_at",
    "last_visit_at",
]

PATIENT_UPDATE_COLUMNS = {
    "status",
    "billed",
    "name",
    "phone",
    "email",
    "address",
    "reason",
    "date_of_birth",
    "age",
    "weight",
    "height",
    "temperature",
}

APPOINTMENT_COLUMNS = [
    "id",
    "org_id",
    "name",
    "phone",
    "email",
    "address",
    "reason",
    "date_of_birth",
    "age",
    "weight",
    "height",
    "temperature",
    "scheduled_for",
    "status",
    "checked_in_patient_id",
    "checked_in_at",
    "created_at",
]

PATIENT_VISIT_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "name",
    "phone",
    "email",
    "address",
    "reason",
    "date_of_birth",
    "age",
    "weight",
    "height",
    "temperature",
    "source",
    "appointment_id",
    "created_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


def _json_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return json.loads(value)
    return value or {}


def _patient_with_profile_photo_url(patient: dict[str, Any]) -> dict[str, Any]:
    storage_path = str(patient.get("profile_photo_storage_path") or "").strip()
    return {
        **patient,
        "profile_photo_url": f"/patients/{patient['id']}/profile-photo/file" if storage_path else None,
    }


class PostgresPatientFlowRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def list_patients(
        self,
        org_id: str,
        *,
        active_only: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    active_clause = (
                        "and (status in ('waiting', 'consultation') or (status = 'done' and billed = false))"
                        if active_only
                        else ""
                    )
                    paging_clause = "limit %s offset %s" if limit is not None else ""
                    params: tuple[Any, ...] = (
                        (org_id, limit, offset)
                        if limit is not None
                        else (org_id,)
                    )
                    cursor.execute(
                        f"""
                        select {_columns_sql(PATIENT_COLUMNS)}
                        from public.patients
                        where org_id = %s
                        {active_clause}
                        order by last_visit_at desc
                        {paging_clause}
                        """,
                        params,
                    )
                    return [_patient_with_profile_photo_url(_row_to_dict(row, cursor)) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def create_patient(self, org_id: str, payload: PatientCreate) -> dict[str, Any]:
        values = visit_payload(payload)
        now = datetime.now(UTC).isoformat()

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.patients (
                          org_id, name, phone, email, address, reason, date_of_birth, age, weight,
                          height, temperature, last_visit_at
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (
                            org_id,
                            values["name"],
                            values["phone"],
                            values["email"],
                            values["address"],
                            values["reason"],
                            values["date_of_birth"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                            now,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create patient.")
                    patient = _patient_with_profile_photo_url(_row_to_dict(row, cursor))
                    cursor.execute(
                        """
                        insert into public.patient_visits (
                          org_id, patient_id, name, phone, email, address, reason,
                          date_of_birth, age, weight, height, temperature, source
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'queue')
                        """,
                        (
                            org_id,
                            patient["id"],
                            values["name"],
                            values["phone"],
                            values["email"],
                            values["address"],
                            values["reason"],
                            values["date_of_birth"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                        ),
                    )
                    return patient

        return await asyncio.to_thread(_create)

    async def create_patient_visit(self, org_id: str, patient_id: str, payload: PatientVisitCreate) -> dict[str, Any]:
        values = visit_payload(payload)
        now = datetime.now(UTC).isoformat()

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    cursor.execute(
                        f"""
                        update public.patients
                        set name = %s, phone = %s, email = %s, address = %s, reason = %s,
                          date_of_birth = %s, age = %s, weight = %s, height = %s, temperature = %s,
                          status = 'waiting', billed = false, last_visit_at = %s,
                          ai_summary_stale = true,
                          ai_summary_revision = ai_summary_revision + 1
                        where org_id = %s and id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (
                            values["name"],
                            values["phone"],
                            values["email"],
                            values["address"],
                            values["reason"],
                            values["date_of_birth"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                            now,
                            org_id,
                            patient_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update patient visit.")
                    updated = _row_to_dict(row, cursor)
                    cursor.execute(
                        """
                        insert into public.patient_visits (
                          org_id, patient_id, name, phone, email, address, reason,
                          date_of_birth, age, weight, height, temperature, source
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'queue')
                        """,
                        (
                            org_id,
                            patient_id,
                            values["name"],
                            values["phone"],
                            values["email"],
                            values["address"],
                            values["reason"],
                            values["date_of_birth"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                        ),
                    )
                    return updated

        return await asyncio.to_thread(_create)

    async def create_appointment(
        self,
        org_id: str,
        payload: AppointmentCreate,
        *,
        appointments_per_hour: int = 4,
        timezone: str = "UTC",
    ) -> dict[str, Any]:
        values = {
            **payload.model_dump(),
            "phone": normalize_phone_number(payload.phone),
            "email": payload.email.strip().lower(),
            "address": payload.address.strip(),
            "scheduled_for": payload.scheduled_for.isoformat(),
        }

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select pg_advisory_xact_lock(
                          hashtext(%s),
                          hashtext(date_trunc('hour', %s::timestamptz at time zone %s)::text)
                        )
                        """,
                        (org_id, values["scheduled_for"], timezone),
                    )
                    cursor.execute(
                        """
                        select
                          count(*)::integer,
                          count(*) filter (where scheduled_for = %s::timestamptz)::integer
                        from public.appointments
                        where org_id = %s
                          and status = 'scheduled'
                          and date_trunc('hour', scheduled_for at time zone %s)
                            = date_trunc('hour', %s::timestamptz at time zone %s)
                        """,
                        (
                            values["scheduled_for"],
                            org_id,
                            timezone,
                            values["scheduled_for"],
                            timezone,
                        ),
                    )
                    capacity_row = cursor.fetchone() or (0, 0)
                    if int(capacity_row[1]) > 0:
                        raise ValueError("That appointment slot is already booked.")
                    if int(capacity_row[0]) >= appointments_per_hour:
                        raise ValueError("That hour is fully booked.")
                    cursor.execute(
                        f"""
                        insert into public.appointments (
                          org_id, name, phone, email, address, reason, date_of_birth, age, weight,
                          height, temperature, scheduled_for, status
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'scheduled')
                        returning {_columns_sql(APPOINTMENT_COLUMNS)}
                        """,
                        (
                            org_id,
                            values["name"],
                            values["phone"],
                            values["email"],
                            values["address"],
                            values["reason"],
                            values["date_of_birth"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                            values["scheduled_for"],
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create appointment.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def self_book_follow_up_atomic(
        self,
        *,
        org_id: str,
        patient_id: str,
        follow_up_id: str,
        scheduled_for: datetime,
        appointments_per_hour: int,
        timezone: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        def _book() -> tuple[dict[str, Any], dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    try:
                        cursor.execute(
                            "select public.self_book_follow_up_atomic(%s, %s, %s, %s, %s, %s)",
                            (
                                org_id,
                                patient_id,
                                follow_up_id,
                                scheduled_for.isoformat(),
                                appointments_per_hour,
                                timezone,
                            ),
                        )
                    except PsycopgError as exc:
                        message = str(exc).splitlines()[0].strip() or "Failed to book follow-up appointment."
                        raise ValueError(message) from exc
                    row = cursor.fetchone()
                    payload_data = _json_payload(row[0] if row else None)
                    follow_up = payload_data.get("follow_up")
                    appointment = payload_data.get("appointment")
                    if not follow_up or not appointment:
                        raise ValueError("Failed to book follow-up appointment.")
                    return follow_up, appointment

        return await asyncio.to_thread(_book)

    async def list_appointments(
        self,
        org_id: str,
        status: str | None = None,
        query: str | None = None,
        limit: int = 200,
        scheduled_from: str | None = None,
        scheduled_to: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["org_id = %s"]
        params: list[Any] = [org_id]
        if status:
            clauses.append("status = %s")
            params.append(status)
        if scheduled_from:
            clauses.append("scheduled_for >= %s")
            params.append(scheduled_from)
        if scheduled_to:
            clauses.append("scheduled_for < %s")
            params.append(scheduled_to)
        normalized_query = (query or "").strip()
        if normalized_query:
            pattern = f"%{escape_ilike(normalized_query)}%"
            clauses.append("(name ilike %s escape '\\' or phone ilike %s escape '\\' or reason ilike %s escape '\\')")
            params.extend([pattern, pattern, pattern])
        params.append(limit)

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(APPOINTMENT_COLUMNS)}
                        from public.appointments
                        where {" and ".join(clauses)}
                        order by scheduled_for asc
                        limit %s
                        """,
                        tuple(params),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def cancel_expired_appointments(self, org_id: str, stale_before_iso: str) -> int:
        def _cancel() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.appointments
                        set status = 'cancelled'
                        where org_id = %s and status = 'scheduled' and scheduled_for < %s
                        returning id
                        """,
                        (org_id, stale_before_iso),
                    )
                    return len(cursor.fetchall())

        return await asyncio.to_thread(_cancel)

    async def list_appointments_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(APPOINTMENT_COLUMNS)}
                        from public.appointments
                        where org_id = %s and checked_in_patient_id = %s
                        order by created_at desc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def list_patient_visits_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(PATIENT_VISIT_COLUMNS)}
                        from public.patient_visits
                        where org_id = %s and patient_id = %s
                        order by created_at desc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def list_patient_visits(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(PATIENT_VISIT_COLUMNS)}
                        from public.patient_visits
                        where org_id = %s
                        order by created_at desc
                        """,
                        (org_id,),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def list_potential_check_in_matches(self, org_id: str, appointment_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(lambda: self._list_potential_check_in_matches_sync(org_id, appointment_id))

    def _list_potential_check_in_matches_sync(self, org_id: str, appointment_id: str) -> list[dict[str, Any]]:
        with self.connection_manager.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    select {_columns_sql(APPOINTMENT_COLUMNS)}
                    from public.appointments
                    where org_id = %s and id = %s
                    limit 1
                    """,
                    (org_id, appointment_id),
                )
                appointment_row = cursor.fetchone()
                if not appointment_row:
                    raise ValueError("Appointment not found for this organization.")
                appointment = _row_to_dict(appointment_row, cursor)
                normalized_phone = normalize_phone_number(appointment.get("phone"))
                if not normalized_phone:
                    return []
                cursor.execute(
                    f"""
                    select {_columns_sql(PATIENT_COLUMNS)}
                    from public.patients
                    where org_id = %s and billed = false and phone = %s
                    order by last_visit_at desc
                    limit 50
                    """,
                    (org_id, normalized_phone),
                )
                return [_patient_with_profile_photo_url(_row_to_dict(row, cursor)) for row in cursor.fetchall()]

    async def check_in_appointment(
        self,
        org_id: str,
        appointment_id: str,
        payload: AppointmentCheckInRequest,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        def _check_in() -> tuple[dict[str, Any], dict[str, Any]]:
            if payload.existing_patient_id is None and not payload.force_new:
                matches = self._list_potential_check_in_matches_sync(org_id, appointment_id)
                if matches:
                    raise DuplicateCheckInCandidateError(matches)

            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select public.check_in_appointment_atomic(%s, %s, %s)",
                        (
                            org_id,
                            appointment_id,
                            str(payload.existing_patient_id) if payload.existing_patient_id else None,
                        ),
                    )
                    row = cursor.fetchone()
                    payload_data = _json_payload(row[0] if row else None)
                    appointment = payload_data.get("appointment")
                    patient = payload_data.get("patient")
                    if not appointment or not patient:
                        raise ValueError("Failed to check in appointment.")
                    return appointment, _patient_with_profile_photo_url(patient)

        return await asyncio.to_thread(_check_in)

    async def update_patient_profile_photo(
        self,
        org_id: str,
        patient_id: str,
        *,
        storage_path: str,
        content_type: str,
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.patients
                        set profile_photo_storage_path = %s,
                          profile_photo_content_type = %s,
                          profile_photo_updated_at = now()
                        where org_id = %s and id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (storage_path, content_type, org_id, patient_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Patient not found for this organization.")
                    return _patient_with_profile_photo_url(_row_to_dict(row, cursor))

        return await asyncio.to_thread(_update)

    async def clear_patient_profile_photo(self, org_id: str, patient_id: str) -> dict[str, Any]:
        def _clear() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.patients
                        set profile_photo_storage_path = null,
                          profile_photo_content_type = null,
                          profile_photo_updated_at = null
                        where org_id = %s and id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (org_id, patient_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Patient not found for this organization.")
                    return _patient_with_profile_photo_url(_row_to_dict(row, cursor))

        return await asyncio.to_thread(_clear)

    async def update_appointment(
        self,
        org_id: str,
        appointment_id: str,
        payload: AppointmentUpdate,
        *,
        appointments_per_hour: int = 4,
        timezone: str = "UTC",
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(APPOINTMENT_COLUMNS)}
                        from public.appointments
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, appointment_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Appointment not found for this organization.")
                    appointment = _row_to_dict(row, cursor)
                    current_status = str(appointment.get("status") or "")
                    if current_status == "checked_in":
                        raise ValueError("Checked-in appointments cannot be edited.")

                    update_payload: dict[str, Any] = {}
                    if payload.scheduled_for is not None:
                        if current_status != "scheduled":
                            raise ValueError("Only scheduled appointments can be rescheduled.")
                        update_payload["scheduled_for"] = payload.scheduled_for.isoformat()
                        cursor.execute(
                            """
                            select pg_advisory_xact_lock(
                              hashtext(%s),
                              hashtext(date_trunc('hour', %s::timestamptz at time zone %s)::text)
                            )
                            """,
                            (org_id, update_payload["scheduled_for"], timezone),
                        )
                        cursor.execute(
                            """
                            select
                              count(*)::integer,
                              count(*) filter (where scheduled_for = %s::timestamptz)::integer
                            from public.appointments
                            where org_id = %s
                              and id <> %s
                              and status = 'scheduled'
                              and date_trunc('hour', scheduled_for at time zone %s)
                                = date_trunc('hour', %s::timestamptz at time zone %s)
                            """,
                            (
                                update_payload["scheduled_for"],
                                org_id,
                                appointment_id,
                                timezone,
                                update_payload["scheduled_for"],
                                timezone,
                            ),
                        )
                        capacity_row = cursor.fetchone() or (0, 0)
                        if int(capacity_row[1]) > 0:
                            raise ValueError("That appointment slot is already booked.")
                        if int(capacity_row[0]) >= appointments_per_hour:
                            raise ValueError("That hour is fully booked.")
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

                    assignments = ", ".join(f"{column} = %s" for column in update_payload)
                    cursor.execute(
                        f"""
                        update public.appointments
                        set {assignments}
                        where org_id = %s and id = %s
                        returning {_columns_sql(APPOINTMENT_COLUMNS)}
                        """,
                        (*update_payload.values(), org_id, appointment_id),
                    )
                    updated_row = cursor.fetchone()
                    if not updated_row:
                        raise ValueError("Failed to update appointment.")
                    return _row_to_dict(updated_row, cursor)

        return await asyncio.to_thread(_update)

    async def update_patient(self, org_id: str, patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        unsupported_columns = sorted(set(payload) - PATIENT_UPDATE_COLUMNS)
        if unsupported_columns:
            raise ValueError("Unsupported patient update fields: " + ", ".join(unsupported_columns))
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
        if not update_payload:
            raise ValueError("No patient updates provided.")

        def _update() -> dict[str, Any]:
            assignments = ", ".join(f"{column} = %s" for column in update_payload)
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.patients
                        set {assignments}
                        where org_id = %s and id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (*update_payload.values(), org_id, patient_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update patient.")
                    return _patient_with_profile_photo_url(_row_to_dict(row, cursor))

        return await asyncio.to_thread(_update)

    async def list_patient_matches_by_phone(self, org_id: str, phone: str, limit: int = 10) -> list[dict[str, Any]]:
        normalized_phone = normalize_phone_number(phone)
        if not normalized_phone:
            return []

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(PATIENT_COLUMNS)}
                        from public.patients
                        where org_id = %s and phone = %s
                        order by last_visit_at desc
                        limit %s
                        """,
                        (org_id, normalized_phone, limit),
                    )
                    return [_patient_with_profile_photo_url(_row_to_dict(row, cursor)) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def get_patient(self, org_id: str, patient_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(PATIENT_COLUMNS)}
                        from public.patients
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, patient_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Patient not found for this organization.")
                    return _patient_with_profile_photo_url(_row_to_dict(row, cursor))

        return await asyncio.to_thread(_get)

    async def save_patient_summary(
        self,
        org_id: str,
        patient_id: str,
        summary: str,
        updated_at: datetime,
        expected_revision: int,
    ) -> bool:
        def _save() -> bool:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.patients
                        set ai_summary = %s,
                            ai_summary_updated_at = %s,
                            ai_summary_stale = false
                        where org_id = %s and id = %s
                          and ai_summary_revision = %s
                        returning id
                        """,
                        (summary, updated_at, org_id, patient_id, expected_revision),
                    )
                    return cursor.fetchone() is not None

        return await asyncio.to_thread(_save)

    async def mark_patient_summary_stale(self, org_id: str, patient_id: str) -> None:
        def _mark() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.patients
                        set ai_summary_stale = true,
                            ai_summary_revision = ai_summary_revision + 1
                        where org_id = %s and id = %s
                        """,
                        (org_id, patient_id),
                    )

        await asyncio.to_thread(_mark)

    async def list_patients_by_ids(self, org_id: str, patient_ids: list[str]) -> list[dict[str, Any]]:
        unique_ids = sorted({str(patient_id) for patient_id in patient_ids if str(patient_id)})
        if not unique_ids:
            return []

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, name
                        from public.patients
                        where org_id = %s and id = any(%s::uuid[])
                        """,
                        (org_id, unique_ids),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def get_patient_timeline_source(self, org_id: str, patient_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select public.get_patient_timeline_source(%s, %s)",
                        (org_id, patient_id),
                    )
                    row = cursor.fetchone()
                    payload = _json_payload(row[0] if row else None)
                    if not payload:
                        raise ValueError("Patient not found for this organization.")
                    return payload

        return await asyncio.to_thread(_get)
