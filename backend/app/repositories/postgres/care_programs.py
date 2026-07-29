from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.care_programs import MYOPIA_PROGRAM_KEY, MyopiaOfferingUpdate


ENROLLMENT_COLUMNS = [
    "id", "org_id", "patient_id", "catalog_item_id", "originating_invoice_id",
    "originating_invoice_item_id", "responsible_user_id", "status", "agreed_price",
    "program_snapshot", "started_at", "ends_at", "next_action_at", "completed_at",
    "cancelled_at", "cancellation_reason", "created_at", "updated_at",
]

EVENT_COLUMNS = [
    "id", "org_id", "enrollment_id", "event_type", "sequence", "status", "title",
    "due_at", "completed_at", "source_event_id", "linked_entity_type", "linked_entity_id",
    "payload", "created_by", "created_at", "updated_at",
]


def _columns(columns: list[str], prefix: str = "") -> str:
    return ", ".join(f"{prefix}{column}" for column in columns)


def _snapshot_for_item(item: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": 1,
        "program_key": str(catalog.get("program_key") or ""),
        "name": str(item.get("label") or catalog.get("name") or ""),
        "description": str(catalog.get("description") or ""),
        "price": float(item.get("line_total") or 0),
        "definition": catalog.get("program_definition") or {},
    }


def _with_program_name(enrollment: dict[str, Any]) -> dict[str, Any]:
    snapshot = enrollment.get("program_snapshot") or {}
    return {
        **enrollment,
        "program_name": str(snapshot.get("name") or "Care program"),
    }


def _create_review_events(cursor, enrollment: dict[str, Any], *, actor_user_id: str | None) -> None:
    snapshot = enrollment.get("program_snapshot") or {}
    definition = snapshot.get("definition") or {}
    reviews = definition.get("reviews") or []
    started_at = enrollment.get("started_at")
    if not started_at:
        return
    for sequence, review in enumerate(reviews):
        due_at = started_at + timedelta(days=int(review.get("offset_days") or 0))
        cursor.execute(
            """
            insert into public.care_program_events (
              org_id, enrollment_id, event_type, sequence, status, title, due_at, payload, created_by
            )
            values (%s, %s, 'review', %s, 'scheduled', %s, %s, %s::jsonb, %s)
            on conflict do nothing
            """,
            (
                str(enrollment["org_id"]),
                str(enrollment["id"]),
                sequence,
                str(review.get("label") or f"Review {sequence + 1}"),
                due_at,
                json.dumps({"review_key": review.get("key"), "offset_days": review.get("offset_days")}),
                actor_user_id,
            ),
        )
    cursor.execute(
        """
        update public.patient_program_enrollments
        set next_action_at = (
          select min(due_at) from public.care_program_events
          where enrollment_id = %s and event_type = 'review' and status = 'scheduled'
        ), updated_at = now()
        where id = %s
        """,
        (str(enrollment["id"]), str(enrollment["id"])),
    )


def provision_program_enrollments_for_invoice(
    cursor,
    *,
    org_id: str,
    invoice: dict[str, Any],
    items: list[dict[str, Any]],
    actor_user_id: str,
) -> list[dict[str, Any]]:
    program_items = [item for item in items if item.get("item_type") == "program"]
    if not program_items:
        return []
    catalog_ids = [str(item["catalog_item_id"]) for item in program_items if item.get("catalog_item_id")]
    cursor.execute(
        """
        select id, name, description, program_key, program_definition, is_active
        from public.catalog_items
        where org_id = %s and id = any(%s::uuid[]) and item_type = 'program'
        """,
        (org_id, catalog_ids),
    )
    catalog_by_id = {str(row[0]): _row_to_dict(row, cursor) for row in cursor.fetchall()}
    created: list[dict[str, Any]] = []
    active = Decimal(str(invoice.get("amount_paid") or 0)) > 0
    started_at = (invoice.get("completed_at") or datetime.now(UTC)) if active else None
    for item in program_items:
        cursor.execute(
            f"""
            select {_columns(ENROLLMENT_COLUMNS)}
            from public.patient_program_enrollments
            where originating_invoice_item_id = %s
            """,
            (str(item["id"]),),
        )
        existing = cursor.fetchone()
        if existing:
            created.append(_with_program_name(_row_to_dict(existing, cursor)))
            continue
        catalog = catalog_by_id.get(str(item.get("catalog_item_id")))
        if not catalog or not catalog.get("is_active"):
            raise ValueError("Care program is not active for this clinic.")
        snapshot = _snapshot_for_item(item, catalog)
        duration_days = int((snapshot.get("definition") or {}).get("duration_days") or 365)
        cursor.execute(
            f"""
            insert into public.patient_program_enrollments (
              org_id, patient_id, catalog_item_id, originating_invoice_id,
              originating_invoice_item_id, status, agreed_price, program_snapshot,
              started_at, ends_at
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
            on conflict (originating_invoice_item_id) do nothing
            returning {_columns(ENROLLMENT_COLUMNS)}
            """,
            (
                org_id,
                str(invoice["patient_id"]),
                str(item["catalog_item_id"]),
                str(invoice["id"]),
                str(item["id"]),
                "active" if active else "pending",
                item.get("line_total") or 0,
                json.dumps(snapshot),
                started_at,
                started_at + timedelta(days=duration_days) if started_at else None,
            ),
        )
        row = cursor.fetchone()
        if row:
            enrollment = _row_to_dict(row, cursor)
            if active:
                _create_review_events(cursor, enrollment, actor_user_id=actor_user_id)
            created.append(_with_program_name(enrollment))
            continue
    return created


def activate_pending_program_enrollments(
    cursor,
    *,
    org_id: str,
    invoice_id: str,
    actor_user_id: str,
) -> list[dict[str, Any]]:
    cursor.execute(
        f"""
        select {_columns(ENROLLMENT_COLUMNS)}
        from public.patient_program_enrollments
        where org_id = %s and originating_invoice_id = %s and status = 'pending'
        for update
        """,
        (org_id, invoice_id),
    )
    pending = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
    activated: list[dict[str, Any]] = []
    started_at = datetime.now(UTC)
    for enrollment in pending:
        definition = (enrollment.get("program_snapshot") or {}).get("definition") or {}
        duration_days = int(definition.get("duration_days") or 365)
        cursor.execute(
            f"""
            update public.patient_program_enrollments
            set status = 'active', started_at = %s, ends_at = %s, updated_at = now()
            where org_id = %s and id = %s
            returning {_columns(ENROLLMENT_COLUMNS)}
            """,
            (
                started_at,
                started_at + timedelta(days=duration_days),
                org_id,
                str(enrollment["id"]),
            ),
        )
        updated = _row_to_dict(cursor.fetchone(), cursor)
        _create_review_events(cursor, updated, actor_user_id=actor_user_id)
        activated.append(_with_program_name(updated))
    return activated


class PostgresCareProgramsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def get_myopia_program_catalog_item(self, org_id: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, name, item_type, description, program_key, program_definition,
                          is_active, default_price, track_inventory, stock_quantity, low_stock_threshold,
                          unit, aliases, created_at
                        from public.catalog_items
                        where org_id = %s and program_key = %s
                        limit 1
                        """,
                        (org_id, MYOPIA_PROGRAM_KEY),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None
        return await asyncio.to_thread(_get)

    async def upsert_myopia_program(self, org_id: str, payload: MyopiaOfferingUpdate) -> dict[str, Any]:
        definition = payload.definition().model_dump(mode="json")

        def _upsert() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.catalog_items (
                          org_id, name, item_type, description, program_key, program_definition,
                          is_active, default_price, track_inventory, stock_quantity,
                          low_stock_threshold, unit, aliases
                        )
                        values (%s, %s, 'program', %s, %s, %s::jsonb, %s, %s, false, 0, 0, '', '[]'::jsonb)
                        on conflict (org_id, program_key) where program_key is not null
                        do update set name = excluded.name, description = excluded.description,
                          program_definition = excluded.program_definition, is_active = excluded.is_active,
                          default_price = excluded.default_price
                        returning id, org_id, name, item_type, description, program_key, program_definition,
                          is_active, default_price, track_inventory, stock_quantity, low_stock_threshold,
                          unit, aliases, created_at
                        """,
                        (
                            org_id,
                            payload.name.strip(),
                            payload.description.strip(),
                            MYOPIA_PROGRAM_KEY,
                            json.dumps(definition),
                            payload.is_active,
                            payload.default_price,
                        ),
                    )
                    return _row_to_dict(cursor.fetchone(), cursor)
        return await asyncio.to_thread(_upsert)

    async def list_program_enrollments(
        self,
        org_id: str,
        *,
        patient_id: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            conditions = ["e.org_id = %s"]
            values: list[Any] = [org_id]
            if patient_id:
                conditions.append("e.patient_id = %s")
                values.append(patient_id)
            if status:
                conditions.append("e.status = %s")
                values.append(status)
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns(ENROLLMENT_COLUMNS, "e.")},
                          p.name as patient_name,
                          p.phone as patient_phone,
                          coalesce(u.name, u.identifier, '') as responsible_user_name,
                          (
                            select count(*) from public.care_program_events review
                            where review.enrollment_id = e.id and review.event_type = 'review'
                          ) as total_reviews,
                          (
                            select count(*) from public.care_program_events review
                            where review.enrollment_id = e.id and review.event_type = 'review'
                              and review.status = 'completed'
                          ) as completed_reviews,
                          (
                            select review.title from public.care_program_events review
                            where review.enrollment_id = e.id and review.event_type = 'review'
                              and review.status = 'scheduled'
                            order by review.due_at asc limit 1
                          ) as next_review_title,
                          greatest(invoice.total - invoice.amount_paid, 0) as balance_due
                        from public.patient_program_enrollments e
                        join public.patients p on p.org_id = e.org_id and p.id = e.patient_id
                        join public.invoices invoice
                          on invoice.org_id = e.org_id and invoice.id = e.originating_invoice_id
                        left join public.clinic_users u on u.org_id = e.org_id and u.id = e.responsible_user_id
                        where {' and '.join(conditions)}
                        order by
                          case
                            when e.status = 'active' and e.next_action_at < now() - interval '1 day' then 0
                            when e.status = 'active' and e.next_action_at is not null then 1
                            when e.status = 'active' and e.responsible_user_id is null then 2
                            when e.status = 'pending' then 3
                            when e.status = 'active' then 4
                            when e.status = 'completed' then 5
                            else 6
                          end,
                          coalesce(e.next_action_at, e.created_at) asc
                        """,
                        values,
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]
        return await asyncio.to_thread(_list)

    async def get_program_enrollment(self, org_id: str, enrollment_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns(ENROLLMENT_COLUMNS, "e.")},
                          p.name as patient_name,
                          p.phone as patient_phone,
                          coalesce(u.name, u.identifier, '') as responsible_user_name,
                          (
                            select count(*) from public.care_program_events review
                            where review.enrollment_id = e.id and review.event_type = 'review'
                          ) as total_reviews,
                          (
                            select count(*) from public.care_program_events review
                            where review.enrollment_id = e.id and review.event_type = 'review'
                              and review.status = 'completed'
                          ) as completed_reviews,
                          (
                            select review.title from public.care_program_events review
                            where review.enrollment_id = e.id and review.event_type = 'review'
                              and review.status = 'scheduled'
                            order by review.due_at asc limit 1
                          ) as next_review_title,
                          greatest(invoice.total - invoice.amount_paid, 0) as balance_due
                        from public.patient_program_enrollments e
                        join public.patients p on p.org_id = e.org_id and p.id = e.patient_id
                        join public.invoices invoice
                          on invoice.org_id = e.org_id and invoice.id = e.originating_invoice_id
                        left join public.clinic_users u on u.org_id = e.org_id and u.id = e.responsible_user_id
                        where e.org_id = %s and e.id = %s
                        limit 1
                        """,
                        (org_id, enrollment_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Care program enrollment not found.")
                    enrollment = _row_to_dict(row, cursor)
                    cursor.execute(
                        f"""
                        select {_columns(EVENT_COLUMNS)}
                        from public.care_program_events
                        where org_id = %s and enrollment_id = %s
                        order by coalesce(sequence, 999), created_at
                        """,
                        (org_id, enrollment_id),
                    )
                    enrollment["events"] = [_row_to_dict(event, cursor) for event in cursor.fetchall()]
                    return enrollment
        return await asyncio.to_thread(_get)

    async def list_patient_program_timeline(
        self, org_id: str, patient_id: str
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select e.id as enrollment_id, e.status as enrollment_status,
                          e.created_at as enrolled_at, e.started_at, e.completed_at as enrollment_completed_at,
                          e.program_snapshot, ev.id as event_id, ev.event_type, ev.status as event_status,
                          ev.title, ev.due_at, ev.completed_at as event_completed_at,
                          ev.linked_entity_type, ev.linked_entity_id
                        from public.patient_program_enrollments e
                        left join public.care_program_events ev
                          on ev.org_id = e.org_id and ev.enrollment_id = e.id
                          and ev.event_type = 'review' and ev.status = 'completed'
                        where e.org_id = %s and e.patient_id = %s
                        order by e.created_at desc, ev.completed_at desc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]
        return await asyncio.to_thread(_list)

    async def assign_program_enrollment(self, org_id: str, enrollment_id: str, user_id: str) -> dict[str, Any]:
        def _assign() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.clinic_users where org_id = %s and id = %s and role = 'admin'",
                        (org_id, user_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Responsible doctor must be an admin in this clinic.")
                    cursor.execute(
                        f"""
                        update public.patient_program_enrollments
                        set responsible_user_id = %s, updated_at = now()
                        where org_id = %s and id = %s and status in ('pending', 'active')
                        returning {_columns(ENROLLMENT_COLUMNS)}
                        """,
                        (user_id, org_id, enrollment_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Current care program enrollment not found.")
                    return _row_to_dict(row, cursor)
        return await asyncio.to_thread(_assign)

    async def cancel_program_enrollment(
        self, org_id: str, enrollment_id: str, reason: str, actor_user_id: str
    ) -> dict[str, Any]:
        def _cancel() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.patient_program_enrollments
                        set status = 'cancelled', cancelled_at = now(), cancellation_reason = %s,
                          next_action_at = null, updated_at = now()
                        where org_id = %s and id = %s and status in ('pending', 'active')
                        returning {_columns(ENROLLMENT_COLUMNS)}
                        """,
                        (reason.strip(), org_id, enrollment_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Current care program enrollment not found.")
                    cursor.execute(
                        """
                        update public.care_program_events
                        set status = 'cancelled', updated_at = now()
                        where org_id = %s and enrollment_id = %s and status = 'scheduled'
                        """,
                        (org_id, enrollment_id),
                    )
                    return _row_to_dict(row, cursor)
        return await asyncio.to_thread(_cancel)

    async def complete_program_review(
        self, org_id: str, enrollment_id: str, event_id: str, measurement_id: str, actor_user_id: str
    ) -> dict[str, Any]:
        def _complete() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select patient_id, responsible_user_id, status from public.patient_program_enrollments where org_id = %s and id = %s for update",
                        (org_id, enrollment_id),
                    )
                    enrollment = cursor.fetchone()
                    if not enrollment or enrollment[2] != "active":
                        raise ValueError("Active care program enrollment not found.")
                    if not enrollment[1]:
                        raise ValueError("Assign a responsible doctor before completing a review.")
                    cursor.execute(
                        "select id from public.myopia_measurements where org_id = %s and patient_id = %s and id = %s",
                        (org_id, str(enrollment[0]), measurement_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Myopia measurement does not belong to this patient.")
                    cursor.execute(
                        f"""
                        select {_columns(EVENT_COLUMNS)}
                        from public.care_program_events
                        where org_id = %s and enrollment_id = %s and id = %s and event_type = 'review'
                        for update
                        """,
                        (org_id, enrollment_id, event_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Program review not found.")
                    event = _row_to_dict(row, cursor)
                    if event["status"] == "completed":
                        if str(event.get("linked_entity_id") or "") != measurement_id:
                            raise ValueError("This review is already linked to another measurement.")
                        event["_already_completed"] = True
                        return event
                    if event["status"] != "scheduled":
                        raise ValueError("This review cannot be completed.")
                    cursor.execute(
                        """
                        select id from public.care_program_events
                        where org_id = %s and event_type = 'review' and status = 'completed'
                          and linked_entity_id = %s and id <> %s
                        """,
                        (org_id, measurement_id, event_id),
                    )
                    if cursor.fetchone():
                        raise ValueError("This measurement already completed another program review.")
                    cursor.execute(
                        f"""
                        update public.care_program_events
                        set status = 'completed', completed_at = now(), linked_entity_type = 'myopia_measurement',
                          linked_entity_id = %s, updated_at = now()
                        where id = %s
                        returning {_columns(EVENT_COLUMNS)}
                        """,
                        (measurement_id, event_id),
                    )
                    updated = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        """
                        select min(due_at) filter (where status = 'scheduled'),
                          count(*) filter (where status = 'scheduled')
                        from public.care_program_events
                        where enrollment_id = %s and event_type = 'review'
                        """,
                        (enrollment_id,),
                    )
                    next_due, remaining = cursor.fetchone()
                    if remaining == 0:
                        cursor.execute(
                            """
                            update public.patient_program_enrollments
                            set status = 'completed', completed_at = now(), next_action_at = null, updated_at = now()
                            where org_id = %s and id = %s
                            """,
                            (org_id, enrollment_id),
                        )
                    else:
                        cursor.execute(
                            "update public.patient_program_enrollments set next_action_at = %s, updated_at = now() where org_id = %s and id = %s",
                            (next_due, org_id, enrollment_id),
                        )
                    return updated
        return await asyncio.to_thread(_complete)

    async def create_program_report_event(
        self,
        org_id: str,
        enrollment_id: str,
        review_event_id: str,
        snapshot: dict[str, Any],
        actor_user_id: str,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select count(*) from public.care_program_events where enrollment_id = %s and event_type = 'progress_report' and source_event_id = %s",
                        (enrollment_id, review_event_id),
                    )
                    version = int(cursor.fetchone()[0]) + 1
                    payload = {**snapshot, "version": version}
                    cursor.execute(
                        f"""
                        insert into public.care_program_events (
                          org_id, enrollment_id, event_type, status, title, completed_at,
                          source_event_id, payload, created_by
                        )
                        values (%s, %s, 'progress_report', 'completed', %s, now(), %s, %s::jsonb, %s)
                        returning {_columns(EVENT_COLUMNS)}
                        """,
                        (
                            org_id,
                            enrollment_id,
                            f"Myopia progress report v{version}",
                            review_event_id,
                            json.dumps(payload),
                            actor_user_id,
                        ),
                    )
                    return _row_to_dict(cursor.fetchone(), cursor)
        return await asyncio.to_thread(_create)

    async def get_program_report_event(self, org_id: str, report_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns(EVENT_COLUMNS)}
                        from public.care_program_events
                        where org_id = %s and id = %s and event_type = 'progress_report'
                        """,
                        (org_id, report_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Care program report not found.")
                    return _row_to_dict(row, cursor)
        return await asyncio.to_thread(_get)
