from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.base import normalize_phone_number
from app.repositories.postgres.ai_usage import _row_to_dict
from app.repositories.postgres.patient_flow import PATIENT_COLUMNS, _columns_sql, _patient_with_profile_photo_url


CHECK_IN_REQUEST_COLUMNS = [
    "id",
    "org_id",
    "submitted_name",
    "submitted_phone",
    "submitted_phone_normalized",
    "submitted_email",
    "submitted_date_of_birth",
    "submitted_sex_at_birth",
    "submitted_reason",
    "status",
    "approved_patient_id",
    "reviewed_by",
    "reviewed_at",
    "rejection_reason",
    "created_at",
    "expires_at",
]


class PostgresCheckInsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def get_public_check_in_config(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select org_id, clinic_name, clinic_address, clinic_phone,
                          public_check_in_enabled, public_check_in_token
                        from public.clinic_settings
                        where org_id = %s
                        """,
                        (org_id,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Clinic settings not found.")
                    return {
                        "org_id": str(row[0]),
                        "clinic_name": str(row[1]),
                        "clinic_address": str(row[2] or ""),
                        "clinic_phone": str(row[3] or ""),
                        "enabled": bool(row[4]),
                        "token": str(row[5]),
                    }

        return await asyncio.to_thread(_get)

    async def get_public_check_in_config_by_token(self, token: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select org_id, clinic_name, clinic_address, clinic_phone,
                          public_check_in_enabled, public_check_in_token
                        from public.clinic_settings
                        where public_check_in_token = %s
                        """,
                        (token,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("This clinic check-in link is invalid.")
                    if not bool(row[4]):
                        raise ValueError("Online check-in is currently closed for this clinic.")
                    return {
                        "org_id": str(row[0]),
                        "clinic_name": str(row[1]),
                        "clinic_address": str(row[2] or ""),
                        "clinic_phone": str(row[3] or ""),
                        "enabled": True,
                        "token": str(row[5]),
                    }

        return await asyncio.to_thread(_get)

    async def update_public_check_in_enabled(self, org_id: str, enabled: bool) -> dict[str, Any]:
        def _update() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_settings
                        set public_check_in_enabled = %s, updated_at = now()
                        where org_id = %s
                        returning id
                        """,
                        (enabled, org_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Clinic settings not found.")

        await asyncio.to_thread(_update)
        return await self.get_public_check_in_config(org_id)

    async def regenerate_public_check_in_token(self, org_id: str) -> dict[str, Any]:
        def _update() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_settings
                        set public_check_in_token = gen_random_uuid(), updated_at = now()
                        where org_id = %s
                        returning id
                        """,
                        (org_id,),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Clinic settings not found.")

        await asyncio.to_thread(_update)
        return await self.get_public_check_in_config(org_id)

    async def create_public_check_in_request(
        self,
        *,
        org_id: str,
        name: str,
        phone: str,
        email: str,
        date_of_birth: date,
        sex_at_birth: str,
        reason: str,
    ) -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone)
        if len("".join(char for char in normalized_phone if char.isdigit())) < 6:
            raise ValueError("Enter a valid phone number.")

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id
                        from public.public_check_in_requests
                        where org_id = %s
                          and submitted_phone_normalized = %s
                          and submitted_date_of_birth = %s
                          and status = 'pending'
                          and expires_at > now()
                        limit 1
                        """,
                        (org_id, normalized_phone, date_of_birth),
                    )
                    if cursor.fetchone():
                        raise ValueError("A check-in request with these details is already waiting for review.")
                    cursor.execute(
                        f"""
                        insert into public.public_check_in_requests (
                          org_id, submitted_name, submitted_phone,
                          submitted_phone_normalized, submitted_email,
                          submitted_date_of_birth, submitted_sex_at_birth,
                          submitted_reason
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s)
                        returning {_columns_sql(CHECK_IN_REQUEST_COLUMNS)}
                        """,
                        (
                            org_id,
                            name.strip(),
                            phone.strip(),
                            normalized_phone,
                            email.strip().lower(),
                            date_of_birth,
                            sex_at_birth,
                            reason.strip(),
                        ),
                    )
                    return _row_to_dict(cursor.fetchone(), cursor)

        return await asyncio.to_thread(_create)

    async def list_public_check_in_requests(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.public_check_in_requests
                        set status = 'expired'
                        where org_id = %s and status = 'pending' and expires_at <= now()
                        """,
                        (org_id,),
                    )
                    cursor.execute(
                        f"""
                        select {_columns_sql(CHECK_IN_REQUEST_COLUMNS)}
                        from public.public_check_in_requests
                        where org_id = %s and status = 'pending'
                        order by created_at asc
                        limit 100
                        """,
                        (org_id,),
                    )
                    requests = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    for request in requests:
                        digits = "".join(char for char in str(request["submitted_phone_normalized"]) if char.isdigit())
                        submitted_email = str(request.get("submitted_email") or "").strip().lower()
                        cursor.execute(
                            f"""
                            select {_columns_sql(PATIENT_COLUMNS)}
                            from public.patients
                            where org_id = %s
                              and (
                                right(regexp_replace(phone, '\\D', '', 'g'), 10) = right(%s, 10)
                                or (%s <> '' and lower(trim(email)) = %s)
                                or date_of_birth = %s
                                or lower(trim(name)) = lower(trim(%s))
                              )
                            order by last_visit_at desc
                            limit 20
                            """,
                            (
                                org_id,
                                digits,
                                submitted_email,
                                submitted_email,
                                request["submitted_date_of_birth"],
                                request["submitted_name"],
                            ),
                        )
                        candidates = []
                        submitted_name = " ".join(str(request["submitted_name"]).lower().split())
                        for row in cursor.fetchall():
                            patient = _row_to_dict(row, cursor)
                            patient_digits = "".join(char for char in str(patient.get("phone") or "") if char.isdigit())
                            patient_name = " ".join(str(patient.get("name") or "").lower().split())
                            reasons = []
                            score = 0
                            if digits and patient_digits and patient_digits[-10:] == digits[-10:]:
                                reasons.append("Phone match")
                                score += 70
                            if (
                                submitted_email
                                and str(patient.get("email") or "").strip().lower() == submitted_email
                            ):
                                reasons.append("Email match")
                                score += 70
                            if patient.get("date_of_birth") == request["submitted_date_of_birth"]:
                                reasons.append("Date of birth match")
                                score += 20
                            if patient_name and patient_name == submitted_name:
                                reasons.append("Name match")
                                score += 20
                            if score < 20:
                                continue
                            patient["match_reasons"] = reasons
                            patient["confidence"] = "strong" if score >= 90 else "likely" if score >= 70 else "possible"
                            candidates.append(patient)
                        request["candidates"] = candidates[:5]
                    return requests

        return await asyncio.to_thread(_list)

    async def approve_public_check_in_request(
        self,
        *,
        org_id: str,
        request_id: str,
        reviewed_by: str,
        existing_patient_id: str | None,
    ) -> dict[str, Any]:
        def _approve() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select pg_advisory_xact_lock(hashtext(%s))", (org_id,))
                    cursor.execute(
                        f"""
                        select {_columns_sql(CHECK_IN_REQUEST_COLUMNS)}
                        from public.public_check_in_requests
                        where id = %s and org_id = %s
                        for update
                        """,
                        (request_id, org_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Check-in request not found.")
                    request = _row_to_dict(row, cursor)
                    if request["status"] != "pending" or request["expires_at"] <= datetime.now(UTC):
                        raise ValueError("This check-in request is no longer pending.")

                    if existing_patient_id:
                        cursor.execute(
                            f"""
                            select {_columns_sql(PATIENT_COLUMNS)}
                            from public.patients
                            where id = %s and org_id = %s
                            for update
                            """,
                            (existing_patient_id, org_id),
                        )
                        patient_row = cursor.fetchone()
                        if not patient_row:
                            raise ValueError("Existing patient not found for this clinic.")
                        patient = _row_to_dict(patient_row, cursor)
                        if patient["status"] in {"waiting", "consultation"} or (
                            patient["status"] == "done" and not patient["billed"]
                        ):
                            raise ValueError("This patient is already active in today's queue.")
                    else:
                        cursor.execute(
                            f"""
                            insert into public.patients (
                              org_id, name, phone, email, reason, date_of_birth,
                              sex_at_birth
                            )
                            values (%s, %s, %s, %s, %s, %s, %s)
                            returning {_columns_sql(PATIENT_COLUMNS)}
                            """,
                            (
                                org_id,
                                request["submitted_name"],
                                request["submitted_phone_normalized"],
                                request["submitted_email"],
                                request["submitted_reason"],
                                request["submitted_date_of_birth"],
                                request["submitted_sex_at_birth"],
                            ),
                        )
                        patient = _row_to_dict(cursor.fetchone(), cursor)

                    cursor.execute(
                        """
                        insert into public.patient_visits (
                          org_id, patient_id, name, phone, email, address, reason,
                          date_of_birth, sex_at_birth, gender_identity, age, weight,
                          height, temperature, source, visit_kind
                        )
                        values (
                          %s, %s, %s, %s, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s, %s, 'queue', 'new'
                        )
                        returning id
                        """,
                        (
                            org_id,
                            patient["id"],
                            patient["name"],
                            patient["phone"],
                            patient.get("email") or "",
                            patient.get("address") or "",
                            request["submitted_reason"],
                            patient.get("date_of_birth"),
                            patient.get("sex_at_birth"),
                            patient.get("gender_identity") or "",
                            patient.get("age"),
                            patient.get("weight"),
                            patient.get("height"),
                            patient.get("temperature"),
                        ),
                    )
                    visit_id = str(cursor.fetchone()[0])
                    cursor.execute(
                        f"""
                        update public.patients
                        set reason = %s, status = 'waiting', billed = false,
                          current_visit_id = %s, last_visit_at = now(),
                          ai_summary_stale = true,
                          ai_summary_revision = ai_summary_revision + 1
                        where id = %s and org_id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (request["submitted_reason"], visit_id, patient["id"], org_id),
                    )
                    saved = _patient_with_profile_photo_url(_row_to_dict(cursor.fetchone(), cursor))
                    saved["current_visit"] = {
                        "id": visit_id,
                        "kind": "new",
                        "source": "queue",
                        "scheduled_for": None,
                    }
                    saved["billing_summary"] = None
                    cursor.execute(
                        """
                        update public.public_check_in_requests
                        set status = 'approved', approved_patient_id = %s,
                          reviewed_by = %s, reviewed_at = now()
                        where id = %s
                        """,
                        (patient["id"], reviewed_by, request_id),
                    )
                    return saved

        return await asyncio.to_thread(_approve)

    async def reject_public_check_in_request(
        self,
        *,
        org_id: str,
        request_id: str,
        reviewed_by: str,
        reason: str,
    ) -> dict[str, Any]:
        def _reject() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.public_check_in_requests
                        set status = 'rejected', rejection_reason = %s,
                          reviewed_by = %s, reviewed_at = now()
                        where id = %s and org_id = %s and status = 'pending'
                        returning {_columns_sql(CHECK_IN_REQUEST_COLUMNS)}
                        """,
                        (reason.strip(), reviewed_by, request_id, org_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("This check-in request is no longer pending.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_reject)
