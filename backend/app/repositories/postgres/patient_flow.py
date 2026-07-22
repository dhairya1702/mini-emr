from __future__ import annotations

import asyncio
import json
import re
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
    "sex_at_birth",
    "gender_identity",
    "age",
    "weight",
    "height",
    "temperature",
    "profile_photo_storage_path",
    "profile_photo_content_type",
    "profile_photo_updated_at",
    "status",
    "billed",
    "queue_priority",
    "stage_entered_at",
    "queue_position",
    "current_visit_id",
    "ai_summary",
    "ai_summary_updated_at",
    "ai_summary_stale",
    "ai_summary_revision",
    "ai_summary_source_hash",
    "created_at",
    "last_visit_at",
]

PATIENT_UPDATE_COLUMNS = {
    "status",
    "billed",
    "queue_priority",
    "name",
    "phone",
    "email",
    "address",
    "reason",
    "date_of_birth",
    "sex_at_birth",
    "gender_identity",
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
    "sex_at_birth",
    "gender_identity",
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
    "sex_at_birth",
    "gender_identity",
    "age",
    "weight",
    "height",
    "temperature",
    "source",
    "appointment_id",
    "visit_kind",
    "created_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


def _json_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return json.loads(value)
    return value or {}


def _normalize_catalog_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def _catalog_aliases(item: dict[str, Any]) -> list[str]:
    value = item.get("aliases") or []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    return [str(alias) for alias in value if str(alias).strip()] if isinstance(value, list) else []


def _numeric_quantity(value: Any, default: float = 1) -> float:
    match = re.search(r"\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return default
    quantity = float(match.group(0))
    return quantity if 0 < quantity <= 10000 else default


def _catalog_item_available(item: dict[str, Any], quantity: float) -> bool:
    return not bool(item.get("track_inventory")) or float(item.get("stock_quantity") or 0) >= quantity


def _find_exact_catalog_item(
    name: str,
    items: list[dict[str, Any]],
    *,
    catalog_item_id: str | None = None,
) -> dict[str, Any] | None:
    if catalog_item_id:
        direct = next((item for item in items if str(item.get("id")) == catalog_item_id), None)
        if direct:
            return direct
    normalized = _normalize_catalog_text(name)
    if not normalized:
        return None
    for item in items:
        if _normalize_catalog_text(str(item.get("name") or "")) == normalized:
            return item
    for item in items:
        if normalized in {_normalize_catalog_text(alias) for alias in _catalog_aliases(item)}:
            return item
    return None


SERVICE_NAME_EXPANSIONS: tuple[tuple[set[str], tuple[str, ...]], ...] = (
    (
        {"eye", "exam"},
        ("eye exam", "eye examination", "eye check up", "routine eye exam", "routine eye examination", "refraction", "vision test", "vision examination"),
    ),
    ({"eye", "check"}, ("eye check up", "eye exam", "eye examination", "refraction", "vision test")),
    ({"refraction"}, ("refraction", "eye exam", "eye examination", "vision test")),
    ({"contact", "lens"}, ("contact lens", "contact lens trial", "contact lens fitting")),
    ({"binocular", "vision"}, ("binocular vision", "binocular vision assessment")),
    ({"low", "vision"}, ("low vision", "low vision assessment")),
    ({"myopia"}, ("myopia", "myopia management")),
    ({"tbi"}, ("tbi evaluation", "neurovision", "neurovision tbi")),
)


def _expanded_service_names(name: str) -> list[str]:
    normalized = _normalize_catalog_text(name)
    tokens = set(normalized.split())
    candidates = [name]
    for required_tokens, expansions in SERVICE_NAME_EXPANSIONS:
        if required_tokens.issubset(tokens) or normalized in {_normalize_catalog_text(expansion) for expansion in expansions}:
            candidates.extend(expansions)
    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = _normalize_catalog_text(candidate)
        if key and key not in seen:
            deduped.append(candidate)
            seen.add(key)
    return deduped


def _find_service_catalog_item(name: str, services: list[dict[str, Any]]) -> dict[str, Any] | None:
    for candidate in _expanded_service_names(name):
        item = _find_exact_catalog_item(candidate, services)
        if item:
            return item
    return None


def _estimate_from_note_and_catalog(
    note: dict[str, Any] | None,
    catalog_items: list[dict[str, Any]],
) -> dict[str, Any] | None:
    services = [item for item in catalog_items if item.get("item_type") == "service"]
    medicines = [item for item in catalog_items if item.get("item_type") == "medicine"]
    line_items: dict[str, dict[str, Any]] = {}

    consultation = next(
        (
            item for item in services
            if _normalize_catalog_text(str(item.get("name") or "")) == "consultation"
            or "consultation" in {_normalize_catalog_text(alias) for alias in _catalog_aliases(item)}
        ),
        None,
    )
    if consultation and _catalog_item_available(consultation, 1):
        line_items[str(consultation["id"])] = {"item": consultation, "quantity": 1}

    extractions = _json_payload(
        note.get("snapshot_clinical_extractions")
        if note and note.get("status") in {"final", "sent"} and note.get("snapshot_clinical_extractions")
        else note.get("clinical_extractions") if note else {}
    )

    for extracted in extractions.get("services_performed") or []:
        name = str(extracted.get("name") or "").strip()
        item = _find_service_catalog_item(name, services)
        quantity = _numeric_quantity(extracted.get("quantity"))
        if item and _catalog_item_available(item, quantity) and str(item["id"]) not in line_items:
            line_items[str(item["id"])] = {"item": item, "quantity": quantity}

    for extracted in extractions.get("medications_prescribed") or []:
        name = str(extracted.get("name") or "").strip()
        strength = str(extracted.get("strength") or "").strip()
        lookup_name = f"{name} {strength}".strip() if strength else name
        item = _find_exact_catalog_item(
            lookup_name,
            medicines,
            catalog_item_id=str(extracted.get("catalog_item_id")) if extracted.get("catalog_item_id") else None,
        )
        if not item and strength:
            item = _find_exact_catalog_item(name, medicines)
        quantity = _numeric_quantity(extracted.get("quantity"))
        if item and _catalog_item_available(item, quantity) and str(item["id"]) not in line_items:
            line_items[str(item["id"])] = {"item": item, "quantity": quantity}

    if not line_items:
        return None
    total = sum(float(row["item"].get("default_price") or 0) * float(row["quantity"]) for row in line_items.values())
    medicine_count = sum(1 for row in line_items.values() if row["item"].get("item_type") == "medicine")
    return {
        "total": total,
        "item_count": len(line_items),
        "medicine_count": medicine_count,
    }


def _patient_with_profile_photo_url(patient: dict[str, Any]) -> dict[str, Any]:
    storage_path = str(patient.get("profile_photo_storage_path") or "").strip()
    return {
        **patient,
        "profile_photo_url": f"/patients/{patient['id']}/profile-photo/file" if storage_path else None,
    }


class PostgresPatientFlowRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    @staticmethod
    def _attach_queue_context(cursor: Any, patients: list[dict[str, Any]]) -> list[dict[str, Any]]:
        visit_ids = [str(patient["current_visit_id"]) for patient in patients if patient.get("current_visit_id")]
        visits: dict[str, dict[str, Any]] = {}
        billing: dict[str, dict[str, Any]] = {}
        estimates: dict[str, dict[str, Any]] = {}
        if visit_ids:
            cursor.execute(
                """
                select visit.id::text, visit.visit_kind, visit.source, appointment.scheduled_for
                from public.patient_visits visit
                left join public.appointments appointment on appointment.id = visit.appointment_id
                where visit.id = any(%s::uuid[])
                """,
                (visit_ids,),
            )
            visits = {
                str(row[0]): {
                    "id": str(row[0]),
                    "kind": str(row[1]),
                    "source": str(row[2]),
                    "scheduled_for": row[3],
                }
                for row in cursor.fetchall()
            }
            cursor.execute(
                """
                select distinct on (invoice.visit_id)
                  invoice.visit_id::text, invoice.id::text, invoice.total,
                  invoice.payment_status, invoice.amount_paid, invoice.completed_at,
                  invoice.sent_at,
                  coalesce(items.item_count, 0), coalesce(items.medicine_count, 0)
                from public.invoices invoice
                left join lateral (
                  select count(*)::integer as item_count,
                    count(*) filter (where item_type = 'medicine')::integer as medicine_count
                  from public.invoice_items where invoice_id = invoice.id
                ) items on true
                where invoice.visit_id = any(%s::uuid[])
                order by invoice.visit_id, invoice.created_at desc
                """,
                (visit_ids,),
            )
            billing = {
                str(row[0]): {
                    "invoice_id": str(row[1]),
                    "total": float(row[2] or 0),
                    "payment_status": str(row[3]),
                    "balance_due": max(float(row[2] or 0) - float(row[4] or 0), 0),
                    "completed_at": row[5],
                    "sent_at": row[6],
                    "item_count": int(row[7] or 0),
                    "medicine_count": int(row[8] or 0),
                }
                for row in cursor.fetchall()
            }
            org_ids = list({str(patient["org_id"]) for patient in patients if patient.get("org_id")})
            cursor.execute(
                """
                select id::text, org_id::text, name, item_type, default_price,
                  track_inventory, stock_quantity, aliases
                from public.catalog_items
                where org_id = any(%s::uuid[])
                """,
                (org_ids,),
            )
            catalog_by_org: dict[str, list[dict[str, Any]]] = {}
            for row in cursor.fetchall():
                item = {
                    "id": str(row[0]),
                    "org_id": str(row[1]),
                    "name": str(row[2]),
                    "item_type": str(row[3]),
                    "default_price": float(row[4] or 0),
                    "track_inventory": bool(row[5]),
                    "stock_quantity": float(row[6] or 0),
                    "aliases": row[7],
                }
                catalog_by_org.setdefault(str(row[1]), []).append(item)
            cursor.execute(
                """
                select distinct on (visit_id)
                  visit_id::text, org_id::text, status, clinical_extractions,
                  snapshot_clinical_extractions
                from public.notes
                where visit_id = any(%s::uuid[])
                order by visit_id, created_at desc
                """,
                (visit_ids,),
            )
            notes = {
                str(row[0]): {
                    "org_id": str(row[1]),
                    "status": str(row[2]),
                    "clinical_extractions": row[3],
                    "snapshot_clinical_extractions": row[4],
                }
                for row in cursor.fetchall()
            }
            for visit_id, note in notes.items():
                estimate = _estimate_from_note_and_catalog(note, catalog_by_org.get(str(note.get("org_id")), []))
                if estimate:
                    estimates[visit_id] = estimate
        return [
            {
                **patient,
                "current_visit": visits.get(str(patient.get("current_visit_id") or "")),
                "billing_summary": billing.get(str(patient.get("current_visit_id") or "")),
                "billing_estimate": estimates.get(str(patient.get("current_visit_id") or "")),
            }
            for patient in patients
        ]

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
                        order by
                          case status when 'waiting' then 0 when 'consultation' then 1 else 2 end,
                          case when queue_priority = 'urgent' then 0 else 1 end,
                          queue_position asc,
                          last_visit_at desc
                        {paging_clause}
                        """,
                        params,
                    )
                    patients = [_patient_with_profile_photo_url(_row_to_dict(row, cursor)) for row in cursor.fetchall()]
                    return self._attach_queue_context(cursor, patients)

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
                          org_id, name, phone, email, address, reason, date_of_birth, sex_at_birth,
                          gender_identity, age, weight,
                          height, temperature, last_visit_at
                        )
                        values (
                          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
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
                            values["sex_at_birth"],
                            values["gender_identity"],
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
                          date_of_birth, sex_at_birth, gender_identity, age, weight, height,
                          temperature, source, visit_kind
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'queue', 'new')
                        returning id
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
                            values["sex_at_birth"],
                            values["gender_identity"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                        ),
                    )
                    visit_row = cursor.fetchone()
                    if not visit_row:
                        raise ValueError("Failed to create patient visit.")
                    cursor.execute(
                        f"""
                        update public.patients set current_visit_id = %s
                        where org_id = %s and id = %s
                        returning {_columns_sql(PATIENT_COLUMNS)}
                        """,
                        (str(visit_row[0]), org_id, str(patient["id"])),
                    )
                    saved = _patient_with_profile_photo_url(_row_to_dict(cursor.fetchone(), cursor))
                    saved["current_visit"] = {
                        "id": str(visit_row[0]), "kind": "new", "source": "queue", "scheduled_for": None,
                    }
                    saved["billing_summary"] = None
                    return saved

        return await asyncio.to_thread(_create)

    async def create_patient_visit(self, org_id: str, patient_id: str, payload: PatientVisitCreate) -> dict[str, Any]:
        values = visit_payload(payload)
        now = datetime.now(UTC).isoformat()

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select pg_advisory_xact_lock(hashtext(%s))", (org_id,))
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1 for update",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    visit_kind = "new"
                    cursor.execute(
                        """
                        insert into public.patient_visits (
                          org_id, patient_id, name, phone, email, address, reason,
                          date_of_birth, sex_at_birth, gender_identity, age, weight, height,
                          temperature, source, visit_kind
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'queue', %s)
                        returning id
                        """,
                        (
                            org_id, patient_id, values["name"], values["phone"], values["email"],
                            values["address"], values["reason"], values["date_of_birth"],
                            values["sex_at_birth"], values["gender_identity"], values["age"],
                            values["weight"], values["height"], values["temperature"], visit_kind,
                        ),
                    )
                    visit_id = str(cursor.fetchone()[0])
                    cursor.execute(
                        f"""
                        update public.patients
                        set name = %s, phone = %s, email = %s, address = %s, reason = %s,
                          date_of_birth = %s, sex_at_birth = %s, gender_identity = %s,
                          age = %s, weight = %s, height = %s, temperature = %s,
                          status = 'waiting', billed = false, last_visit_at = %s,
                          current_visit_id = %s,
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
                            values["sex_at_birth"],
                            values["gender_identity"],
                            values["age"],
                            values["weight"],
                            values["height"],
                            values["temperature"],
                            now,
                            visit_id,
                            org_id,
                            patient_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update patient visit.")
                    saved = _patient_with_profile_photo_url(_row_to_dict(row, cursor))
                    saved["current_visit"] = {
                        "id": visit_id, "kind": visit_kind, "source": "queue", "scheduled_for": None,
                    }
                    saved["billing_summary"] = None
                    return saved

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
                          org_id, name, phone, email, address, reason, date_of_birth, sex_at_birth,
                          gender_identity, age, weight,
                          height, temperature, scheduled_for, status
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'scheduled')
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
                            values["sex_at_birth"],
                            values["gender_identity"],
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

    async def list_scheduled_appointment_times(
        self,
        org_id: str,
        scheduled_from: str,
        scheduled_to: str,
    ) -> list[datetime]:
        def _list() -> list[datetime]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select scheduled_for
                        from public.appointments
                        where org_id = %s
                          and status = 'scheduled'
                          and scheduled_for >= %s
                          and scheduled_for < %s
                        order by scheduled_for asc
                        """,
                        (org_id, scheduled_from, scheduled_to),
                    )
                    return [row[0] for row in cursor.fetchall()]

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
                    saved = _patient_with_profile_photo_url(patient)
                    visit_id = str(saved.get("current_visit_id") or "")
                    if visit_id:
                        cursor.execute(
                            "select visit_kind from public.patient_visits where org_id = %s and id = %s",
                            (org_id, visit_id),
                        )
                        visit_row = cursor.fetchone()
                        saved["current_visit"] = {
                            "id": visit_id,
                            "kind": str(visit_row[0] if visit_row else "new"),
                            "source": "appointment",
                            "scheduled_for": appointment.get("scheduled_for"),
                        }
                    saved["billing_summary"] = None
                    return appointment, saved

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
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select pg_advisory_xact_lock(hashtext(%s))", (org_id,))
                    cursor.execute(
                        """
                        select status, queue_priority
                        from public.patients
                        where org_id = %s and id = %s
                        for update
                        """,
                        (org_id, patient_id),
                    )
                    current = cursor.fetchone()
                    if not current:
                        raise ValueError("Failed to update patient.")
                    current_status = str(current[0])
                    current_priority = str(current[1])
                    next_status = str(update_payload.get("status") or current_status)
                    next_priority = str(update_payload.get("queue_priority") or current_priority)
                    if next_status != current_status:
                        update_payload["stage_entered_at"] = datetime.now(UTC).isoformat()
                        cursor.execute(
                            """
                            select coalesce(max(queue_position), 0) + 1
                            from public.patients
                            where org_id = %s and status = %s and id <> %s
                            """,
                            (org_id, next_status, patient_id),
                        )
                        position_row = cursor.fetchone()
                        update_payload["queue_position"] = int(position_row[0] if position_row else 1)
                    elif next_priority != current_priority:
                        cursor.execute(
                            """
                            select coalesce(min(queue_position), 1) - 1
                            from public.patients
                            where org_id = %s and status = %s and queue_priority = %s and id <> %s
                            """,
                            (org_id, current_status, next_priority, patient_id),
                        )
                        position_row = cursor.fetchone()
                        update_payload["queue_position"] = int(position_row[0] if position_row else 0)
                    assignments = ", ".join(f"{column} = %s" for column in update_payload)
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
                    patient = _patient_with_profile_photo_url(_row_to_dict(row, cursor))
                    return self._attach_queue_context(cursor, [patient])[0]

        return await asyncio.to_thread(_update)

    async def reorder_queue(
        self,
        org_id: str,
        columns: dict[str, list[str]],
        *,
        role: str,
    ) -> list[dict[str, Any]]:
        statuses = ("waiting", "consultation", "done")
        submitted = [patient_id for status in statuses for patient_id in columns.get(status, [])]
        if len(submitted) != len(set(submitted)):
            raise ValueError("A patient can appear only once in the queue order.")

        def _reorder() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select pg_advisory_xact_lock(hashtext(%s))", (org_id,))
                    cursor.execute(
                        """
                        select id::text, status, queue_priority, queue_position
                        from public.patients
                        where org_id = %s
                          and (status in ('waiting', 'consultation') or (status = 'done' and billed = false))
                        order by
                          case status when 'waiting' then 0 when 'consultation' then 1 else 2 end,
                          case when queue_priority = 'urgent' then 0 else 1 end,
                          queue_position,
                          last_visit_at desc
                        for update
                        """,
                        (org_id,),
                    )
                    rows = cursor.fetchall()
                    current = {
                        str(row[0]): {
                            "status": str(row[1]),
                            "queue_priority": str(row[2]),
                            "queue_position": int(row[3]),
                        }
                        for row in rows
                    }
                    unknown = [patient_id for patient_id in submitted if patient_id not in current]
                    if unknown:
                        raise ValueError("Queue order includes a patient that is not active for this clinic.")

                    target_by_id = {
                        patient_id: status
                        for status in statuses
                        for patient_id in columns.get(status, [])
                    }
                    for patient_id, target_status in target_by_id.items():
                        source_status = current[patient_id]["status"]
                        if source_status == target_status:
                            continue
                        allowed = role == "admin" and (
                            (source_status == "waiting" and target_status == "consultation")
                            or (source_status == "consultation" and target_status == "done")
                        )
                        if not allowed:
                            raise ValueError("Patients can only move through the queue stages in order.")

                    for status in statuses:
                        ordered_ids = list(columns.get(status, []))
                        ordered_ids.extend(
                            patient_id
                            for patient_id, data in current.items()
                            if patient_id not in target_by_id and data["status"] == status
                        )
                        ordered_ids = sorted(
                            ordered_ids,
                            key=lambda patient_id: 0 if current[patient_id]["queue_priority"] == "urgent" else 1,
                        )
                        for position, patient_id in enumerate(ordered_ids, start=1):
                            source_status = current[patient_id]["status"]
                            cursor.execute(
                                """
                                update public.patients
                                set status = %s,
                                  queue_position = %s,
                                  stage_entered_at = case when status <> %s then now() else stage_entered_at end
                                where org_id = %s and id = %s
                                """,
                                (status, position, status, org_id, patient_id),
                            )

                    cursor.execute(
                        f"""
                        select {_columns_sql(PATIENT_COLUMNS)}
                        from public.patients
                        where org_id = %s
                          and (status in ('waiting', 'consultation') or (status = 'done' and billed = false))
                        order by
                          case status when 'waiting' then 0 when 'consultation' then 1 else 2 end,
                          case when queue_priority = 'urgent' then 0 else 1 end,
                          queue_position,
                          last_visit_at desc
                        """,
                        (org_id,),
                    )
                    patients = [
                        _patient_with_profile_photo_url(_row_to_dict(row, cursor))
                        for row in cursor.fetchall()
                    ]
                    return self._attach_queue_context(cursor, patients)

        return await asyncio.to_thread(_reorder)

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
        source_hash: str,
    ) -> bool:
        def _save() -> bool:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.patients
                        set ai_summary = %s,
                            ai_summary_updated_at = %s,
                            ai_summary_stale = false,
                            ai_summary_source_hash = %s
                        where org_id = %s and id = %s
                          and ai_summary_revision = %s
                        returning id
                        """,
                        (summary, updated_at, source_hash, org_id, patient_id, expected_revision),
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
