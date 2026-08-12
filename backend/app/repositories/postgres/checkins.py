from __future__ import annotations

import asyncio
import hashlib
import secrets
from datetime import UTC, date, datetime
from typing import Any

from psycopg.errors import UniqueViolation

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
    "tracking_token_hash",
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

        tracking_token = secrets.token_urlsafe(32)
        tracking_token_hash = hashlib.sha256(tracking_token.encode("utf-8")).hexdigest()

        def _create() -> dict[str, Any]:
            try:
                with self.connection_manager.pool.connection() as connection:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            """
                            update public.public_check_in_requests
                            set status = 'expired'
                            where org_id = %s
                              and status = 'pending'
                              and expires_at <= now()
                            """,
                            (org_id,),
                        )
                        cursor.execute(
                            f"""
                            insert into public.public_check_in_requests (
                              org_id, submitted_name, submitted_phone,
                              submitted_phone_normalized, submitted_email,
                              submitted_date_of_birth, submitted_sex_at_birth,
                              submitted_reason, tracking_token_hash
                            )
                            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                                tracking_token_hash,
                            ),
                        )
                        created = _row_to_dict(cursor.fetchone(), cursor)
                        created["tracking_token"] = tracking_token
                        return created
            except UniqueViolation as error:
                raise ValueError(
                    "A check-in request with these details is already waiting for review."
                ) from error

        return await asyncio.to_thread(_create)

    async def get_public_check_in_status(self, tracking_token: str) -> dict[str, Any]:
        tracking_token_hash = hashlib.sha256(tracking_token.encode("utf-8")).hexdigest()

        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select case
                          when status = 'pending' and expires_at <= now() then 'expired'
                          else status
                        end as status
                        from public.public_check_in_requests
                        where tracking_token_hash = %s
                        """,
                        (tracking_token_hash,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Check-in request not found.")
                    return {"status": str(row[0])}

        return await asyncio.to_thread(_get)

    async def get_public_check_in_requests_status(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id::text
                        from public.public_check_in_requests
                        where org_id = %s
                          and status = 'pending'
                          and expires_at > now()
                        order by id
                        """,
                        (org_id,),
                    )
                    request_ids = [str(row[0]) for row in cursor.fetchall()]
                    revision = hashlib.sha256(",".join(request_ids).encode("utf-8")).hexdigest()
                    return {"pending_count": len(request_ids), "revision": revision}

        return await asyncio.to_thread(_get)

    async def list_public_check_in_requests(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CHECK_IN_REQUEST_COLUMNS)}
                        from public.public_check_in_requests
                        where org_id = %s and status = 'pending' and expires_at > now()
                        order by created_at asc
                        limit 100
                        """,
                        (org_id,),
                    )
                    requests = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    if not requests:
                        return []

                    request_by_id = {str(request["id"]): request for request in requests}
                    for request in requests:
                        request["candidates"] = []
                    cursor.execute(
                        f"""
                        with ranked_candidates as (
                          select check_in.id as check_in_request_id,
                            {", ".join(f"patient.{column}" for column in PATIENT_COLUMNS)},
                            row_number() over (
                              partition by check_in.id
                              order by patient.last_visit_at desc
                            ) as candidate_rank
                          from public.public_check_in_requests check_in
                          join public.patients patient
                            on patient.org_id = check_in.org_id
                           and (
                             (
                               check_in.submitted_phone_match_key <> ''
                               and patient.phone_match_key = check_in.submitted_phone_match_key
                             )
                             or (
                               check_in.submitted_email_normalized <> ''
                               and patient.email_normalized = check_in.submitted_email_normalized
                             )
                             or patient.date_of_birth = check_in.submitted_date_of_birth
                             or patient.name_normalized = check_in.submitted_name_normalized
                           )
                          where check_in.org_id = %s
                            and check_in.id = any(%s::uuid[])
                        )
                        select check_in_request_id,
                          {_columns_sql(PATIENT_COLUMNS)}
                        from ranked_candidates
                        where candidate_rank <= 20
                        order by check_in_request_id, candidate_rank
                        """,
                        (org_id, list(request_by_id)),
                    )
                    for row in cursor.fetchall():
                        request_id = str(row[0])
                        request = request_by_id.get(request_id)
                        if request is None:
                            continue
                        patient = dict(zip(PATIENT_COLUMNS, row[1:], strict=True))
                        digits = "".join(
                            char
                            for char in str(request["submitted_phone_normalized"])
                            if char.isdigit()
                        )
                        submitted_email = str(request.get("submitted_email") or "").strip().lower()
                        submitted_name = " ".join(str(request["submitted_name"]).lower().split())
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
                        if len(request["candidates"]) < 5:
                            request["candidates"].append(patient)
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
                        """
                        select coalesce(max(queue_position), 0) + 1
                        from public.patients
                        where org_id = %s and status = 'waiting' and id <> %s
                        """,
                        (org_id, patient["id"]),
                    )
                    position_row = cursor.fetchone()
                    queue_position = int(position_row[0] if position_row else 1)
                    cursor.execute(
                        f"""
                        update public.patients
                        set reason = %s, status = 'waiting', billed = false,
                          current_visit_id = %s, last_visit_at = now(),
                          stage_entered_at = now(), queue_position = %s,
                          ai_summary_stale = true,
                          ai_summary_revision = ai_summary_revision + 1
                        where id = %s and org_id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (request["submitted_reason"], visit_id, queue_position, patient["id"], org_id),
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
                        where id = %s and org_id = %s and status = 'pending' and expires_at > now()
                        returning {_columns_sql(CHECK_IN_REQUEST_COLUMNS)}
                        """,
                        (reason.strip(), reviewed_by, request_id, org_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("This check-in request is no longer pending.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_reject)
