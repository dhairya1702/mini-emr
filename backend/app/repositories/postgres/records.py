from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.patients import FollowUpCreate, FollowUpUpdate, NoteCreate


NOTE_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "visit_id",
    "content",
    "status",
    "version_number",
    "root_note_id",
    "amended_from_note_id",
    "snapshot_content",
    "asset_payload",
    "snapshot_asset_payload",
    "structured_modules",
    "clinical_extractions",
    "snapshot_clinical_extractions",
    "optometry_history",
    "snapshot_optometry_history",
    "finalized_at",
    "sent_at",
    "sent_by",
    "sent_to",
    "created_at",
]

FOLLOW_UP_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "created_by",
    "scheduled_for",
    "notes",
    "status",
    "completed_at",
    "reminder_sent_at",
    "reminder_claimed_at",
    "reminder_attempt_count",
    "reminder_last_error",
    "created_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


class PostgresRecordsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

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

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.notes (
                          id,
                          org_id,
                          patient_id,
                          visit_id,
                          content,
                          asset_payload,
                          structured_modules,
                          clinical_extractions,
                          optometry_history,
                          status,
                          version_number,
                          root_note_id,
                          amended_from_note_id,
                          snapshot_content,
                          snapshot_asset_payload,
                          snapshot_clinical_extractions,
                          snapshot_optometry_history,
                          finalized_at,
                          sent_at,
                          sent_by,
                          sent_to
                        )
                        values (
                          %s, %s, %s,
                          coalesce(%s, (select current_visit_id from public.patients where org_id = %s and id = %s)),
                          %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, 'draft', %s, %s,
                          %s, null, '[]'::jsonb, null, null, null, null, null, null
                        )
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (
                            note_id,
                            org_id,
                            str(payload.patient_id),
                            str(payload.visit_id) if payload.visit_id else None,
                            org_id,
                            str(payload.patient_id),
                            payload.content,
                            json.dumps(payload.asset_payload),
                            json.dumps(payload.structured_modules),
                            json.dumps(payload.clinical_extractions),
                            json.dumps(payload.optometry_history),
                            version_number,
                            root_note_id,
                            amended_from_note_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create note.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def update_note_draft(
        self,
        org_id: str,
        note_id: str,
        content: str,
        asset_payload: list[dict[str, Any]] | None = None,
        structured_modules: list[dict[str, Any]] | None = None,
        clinical_extractions: dict[str, Any] | None = None,
        optometry_history: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    note = self._get_note_sync(cursor, org_id, note_id)
                    if not note:
                        raise ValueError("Note not found for this organization.")
                    if note.get("status") != "draft":
                        raise ValueError("Only draft notes can be updated.")
                    cursor.execute(
                        f"""
                        update public.notes
                        set content = %s, asset_payload = %s::jsonb, structured_modules = %s::jsonb,
                            clinical_extractions = %s::jsonb, optometry_history = %s::jsonb
                        where org_id = %s and id = %s
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (
                            content,
                            json.dumps(asset_payload if asset_payload is not None else note.get("asset_payload") or []),
                            json.dumps(
                                structured_modules
                                if structured_modules is not None
                                else note.get("structured_modules") or []
                            ),
                            json.dumps(
                                clinical_extractions
                                if clinical_extractions is not None
                                else note.get("clinical_extractions") or {}
                            ),
                            json.dumps(
                                optometry_history
                                if optometry_history is not None
                                else note.get("optometry_history") or {}
                            ),
                            org_id,
                            note_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update note draft.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)

    async def get_note(self, org_id: str, note_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    note = self._get_note_sync(cursor, org_id, note_id)
                    if not note:
                        raise ValueError("Note not found for this organization.")
                    return note

        return await asyncio.to_thread(_get)

    def _get_note_sync(self, cursor: Any, org_id: str, note_id: str) -> dict[str, Any] | None:
        cursor.execute(
            f"""
            select {_columns_sql(NOTE_COLUMNS)}
            from public.notes
            where org_id = %s and id = %s
            limit 1
            """,
            (org_id, note_id),
        )
        row = cursor.fetchone()
        return _row_to_dict(row, cursor) if row else None

    async def finalize_note(self, org_id: str, note_id: str) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    note = self._get_note_sync(cursor, org_id, note_id)
                    if not note:
                        raise ValueError("Note not found for this organization.")
                    if note.get("status") == "sent":
                        raise ValueError("Sent notes cannot be changed.")
                    if note.get("status") == "final" and note.get("snapshot_content"):
                        return note
                    cursor.execute(
                        f"""
                        update public.notes
                        set status = 'final', snapshot_content = %s, snapshot_asset_payload = %s::jsonb,
                            snapshot_clinical_extractions = %s::jsonb,
                            snapshot_optometry_history = %s::jsonb,
                            finalized_at = %s
                        where org_id = %s and id = %s
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (
                            note.get("content") or "",
                            json.dumps(note.get("asset_payload") or []),
                            json.dumps(note.get("clinical_extractions") or {}),
                            json.dumps(note.get("optometry_history") or {}),
                            datetime.now(UTC).isoformat(),
                            org_id,
                            note_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to finalize note.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_finalize)

    async def create_note_amendment(
        self,
        org_id: str,
        note_id: str,
        content: str,
        asset_payload: list[dict[str, Any]] | None = None,
        structured_modules: list[dict[str, Any]] | None = None,
        clinical_extractions: dict[str, Any] | None = None,
        optometry_history: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        note = await self.get_note(org_id, note_id)
        patient_notes = await self.list_notes_for_patient(org_id, str(note["patient_id"]))
        root_note_id = str(note.get("root_note_id") or note["id"])
        existing_versions = [
            entry for entry in patient_notes if str(entry.get("root_note_id") or entry["id"]) == root_note_id
        ]
        next_version = max(int(entry.get("version_number") or 1) for entry in existing_versions) + 1
        return await self.create_note(
            org_id,
            NoteCreate(
                patient_id=note["patient_id"],
                visit_id=note.get("visit_id"),
                content=content,
                asset_payload=asset_payload or note.get("asset_payload") or [],
                structured_modules=structured_modules
                if structured_modules is not None
                else note.get("structured_modules") or [],
                clinical_extractions=clinical_extractions
                if clinical_extractions is not None
                else note.get("clinical_extractions") or {},
                optometry_history=optometry_history
                if optometry_history is not None
                else note.get("optometry_history") or {},
            ),
            version_number=next_version,
            root_note_id=root_note_id,
            amended_from_note_id=str(note["id"]),
        )

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    note_columns = ", ".join(f"note.{column}" for column in NOTE_COLUMNS)
                    cursor.execute(
                        f"""
                        select {note_columns}, visit.reason as visit_reason
                        from public.notes note
                        left join public.patient_visits visit
                          on visit.org_id = note.org_id and visit.id = note.visit_id
                        where note.org_id = %s and note.patient_id = %s
                        order by note.created_at desc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def mark_note_sent(self, org_id: str, note_id: str, *, sent_by: str, sent_to: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    note = self._get_note_sync(cursor, org_id, note_id)
                    if not note:
                        raise ValueError("Note not found for this organization.")
                    if note.get("status") == "draft":
                        raise ValueError("Finalize the note before sending it.")
                    if note.get("sent_at"):
                        return note
                    cursor.execute(
                        f"""
                        update public.notes
                        set status = 'sent',
                            snapshot_content = %s,
                            snapshot_asset_payload = %s::jsonb,
                            snapshot_clinical_extractions = %s::jsonb,
                            snapshot_optometry_history = %s::jsonb,
                            sent_at = %s,
                            sent_by = %s,
                            sent_to = %s
                        where org_id = %s and id = %s
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (
                            note.get("snapshot_content") or note.get("content") or "",
                            json.dumps(note.get("snapshot_asset_payload") or note.get("asset_payload") or []),
                            json.dumps(note.get("snapshot_clinical_extractions") or note.get("clinical_extractions") or {}),
                            json.dumps(note.get("snapshot_optometry_history") or note.get("optometry_history") or {}),
                            datetime.now(UTC).isoformat(),
                            sent_by,
                            sent_to,
                            org_id,
                            note_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to mark note as sent.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_mark)

    async def create_follow_up(
        self,
        org_id: str,
        patient_id: str,
        created_by: str,
        payload: FollowUpCreate,
    ) -> dict[str, Any]:
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
                        insert into public.follow_ups (
                          org_id, patient_id, created_by, scheduled_for, notes, status, reminder_sent_at
                        )
                        values (%s, %s, %s, %s, %s, 'scheduled', null)
                        returning {_columns_sql(FOLLOW_UP_COLUMNS)}
                        """,
                        (org_id, patient_id, created_by, payload.scheduled_for.isoformat(), payload.notes.strip()),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create follow-up.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_follow_ups(
        self,
        org_id: str,
        status: str | None = None,
        query: str | None = None,
        limit: int = 200,
        scheduled_from: datetime | None = None,
        scheduled_to: datetime | None = None,
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
        params.append(limit)

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(FOLLOW_UP_COLUMNS)}
                        from public.follow_ups
                        where {" and ".join(clauses)}
                        order by scheduled_for asc
                        limit %s
                        """,
                        tuple(params),
                    )
                    follow_ups = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    if not follow_ups:
                        return []
                    patient_ids = sorted({str(follow_up["patient_id"]) for follow_up in follow_ups})
                    cursor.execute(
                        """
                        select id, name, email, phone
                        from public.patients
                        where org_id = %s and id = any(%s::uuid[])
                        """,
                        (org_id, patient_ids),
                    )
                    patients = {
                        str(row_dict["id"]): row_dict
                        for row_dict in (_row_to_dict(row, cursor) for row in cursor.fetchall())
                    }
                    rows = [
                        {
                            **follow_up,
                            "patient_name": str(patients.get(str(follow_up["patient_id"]), {}).get("name") or "").strip(),
                            "patient_email": str(patients.get(str(follow_up["patient_id"]), {}).get("email") or "").strip(),
                            "patient_phone": str(patients.get(str(follow_up["patient_id"]), {}).get("phone") or "").strip(),
                        }
                        for follow_up in follow_ups
                    ]
                    normalized_query = (query or "").strip().lower()
                    if normalized_query:
                        rows = [
                            row
                            for row in rows
                            if normalized_query in row["patient_name"].lower()
                            or normalized_query in str(row.get("notes") or "").lower()
                        ]
                    return rows

        return await asyncio.to_thread(_list)

    async def list_follow_up_page(
        self,
        org_id: str,
        *,
        view: str,
        limit: int,
        cursor_scheduled_for: datetime | None = None,
        cursor_id: str | None = None,
        status: str | None = None,
        query: str | None = None,
        scheduled_from: datetime | None = None,
        scheduled_to: datetime | None = None,
    ) -> dict[str, Any]:
        base_clauses = ["follow_up.org_id = %s"]
        base_params: list[Any] = [org_id]
        if status:
            base_clauses.append("follow_up.status = %s")
            base_params.append(status)
        if scheduled_from:
            base_clauses.append("follow_up.scheduled_for >= %s")
            base_params.append(scheduled_from)
        if scheduled_to:
            base_clauses.append("follow_up.scheduled_for < %s")
            base_params.append(scheduled_to)
        normalized_query = (query or "").strip()
        if normalized_query:
            pattern = f"%{normalized_query}%"
            base_clauses.append(
                "(patient.name ilike %s or follow_up.notes ilike %s or patient.phone ilike %s)"
            )
            base_params.extend([pattern, pattern, pattern])

        direction = "desc" if view == "history" else "asc"
        page_clauses = ["follow_up_view = %s"]
        page_params: list[Any] = [view]
        if cursor_scheduled_for is not None and cursor_id:
            comparator = "<" if direction == "desc" else ">"
            page_clauses.append(f"(scheduled_for, id) {comparator} (%s, %s::uuid)")
            page_params.extend([cursor_scheduled_for, cursor_id])

        follow_up_columns = ", ".join(f"follow_up.{column}" for column in FOLLOW_UP_COLUMNS)
        tracked_sql = f"""
            select {follow_up_columns},
              patient.name as patient_name,
              patient.email as patient_email,
              patient.phone as patient_phone,
              appointment.id as appointment_id,
              appointment.status as appointment_status,
              appointment.scheduled_for as appointment_scheduled_for,
              contact.created_at as last_contacted_at,
              coalesce(contact.metadata->'channels', '[]'::jsonb) as last_contact_channels,
              nullif(contact.metadata->>'delivery_status', '') as last_delivery_status,
              nullif(contact.metadata->>'error', '') as last_delivery_error,
              coalesce(reminders.reminder_count, 0)::int as reminder_count
            from public.follow_ups follow_up
            join public.patients patient
              on patient.org_id = follow_up.org_id and patient.id = follow_up.patient_id
            left join lateral (
              select id, status, scheduled_for
              from public.appointments
              where org_id = follow_up.org_id and follow_up_id = follow_up.id
              order by created_at desc
              limit 1
            ) appointment on true
            left join lateral (
              select created_at, metadata
              from public.audit_events
              where org_id = follow_up.org_id
                and entity_type = 'follow_up'
                and entity_id = follow_up.id::text
                and action in ('follow_up_invitation_sent', 'follow_up_reminder_sent')
              order by created_at desc
              limit 1
            ) contact on true
            left join lateral (
              select count(*) as reminder_count
              from public.audit_events
              where org_id = follow_up.org_id
                and entity_type = 'follow_up'
                and entity_id = follow_up.id::text
                and action = 'follow_up_reminder_sent'
            ) reminders on true
            where {" and ".join(base_clauses)}
        """
        classified_sql = f"""
            with tracked as ({tracked_sql}), classified as (
              select tracked.*,
                case
                  when status <> 'scheduled'
                    or (appointment_id is not null and appointment_status <> 'cancelled')
                    then 'history'
                  when last_delivery_status in ('failed', 'partial')
                    then 'delivery_issues'
                  else 'needs_action'
                end as follow_up_view
              from tracked
            )
        """

        counts_tracked_sql = f"""
            select follow_up.status,
              appointment.id as appointment_id,
              appointment.status as appointment_status,
              nullif(contact.metadata->>'delivery_status', '') as last_delivery_status
            from public.follow_ups follow_up
            left join lateral (
              select id, status
              from public.appointments
              where org_id = follow_up.org_id and follow_up_id = follow_up.id
              order by created_at desc
              limit 1
            ) appointment on true
            left join lateral (
              select metadata
              from public.audit_events
              where org_id = follow_up.org_id
                and entity_type = 'follow_up'
                and entity_id = follow_up.id::text
                and action in ('follow_up_invitation_sent', 'follow_up_reminder_sent')
              order by created_at desc
              limit 1
            ) contact on true
            where follow_up.org_id = %s
        """

        def _list() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        {classified_sql}
                        select * from classified
                        where {" and ".join(page_clauses)}
                        order by scheduled_for {direction}, id {direction}
                        limit %s
                        """,
                        (*base_params, *page_params, limit + 1),
                    )
                    rows = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    has_more = len(rows) > limit
                    items = rows[:limit]
                    for item in items:
                        item.pop("follow_up_view", None)

                    cursor.execute(
                        f"""
                        with tracked as ({counts_tracked_sql}), classified as (
                          select case
                            when status <> 'scheduled'
                              or (appointment_id is not null and appointment_status <> 'cancelled')
                              then 'history'
                            when last_delivery_status in ('failed', 'partial')
                              then 'delivery_issues'
                            else 'needs_action'
                          end as follow_up_view
                          from tracked
                        )
                        select
                          count(*) filter (where follow_up_view = 'needs_action')::int as needs_action,
                          count(*) filter (where follow_up_view = 'delivery_issues')::int as delivery_issues,
                          count(*) filter (where follow_up_view = 'history')::int as history
                        from classified
                        """,
                        (org_id,),
                    )
                    count_row = cursor.fetchone() or (0, 0, 0)
                    return {
                        "items": items,
                        "has_more": has_more,
                        "counts": {
                            "needs_action": int(count_row[0] or 0),
                            "delivery_issues": int(count_row[1] or 0),
                            "history": int(count_row[2] or 0),
                        },
                    }

        return await asyncio.to_thread(_list)

    async def get_follow_up_tracking(self, org_id: str, follow_up_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          appointment.id as appointment_id,
                          appointment.status as appointment_status,
                          appointment.scheduled_for as appointment_scheduled_for,
                          contact.created_at as last_contacted_at,
                          coalesce(contact.metadata->'channels', '[]'::jsonb) as last_contact_channels,
                          nullif(contact.metadata->>'delivery_status', '') as last_delivery_status,
                          nullif(contact.metadata->>'error', '') as last_delivery_error,
                          coalesce(reminders.reminder_count, 0)::int as reminder_count
                        from public.follow_ups follow_up
                        left join lateral (
                          select id, status, scheduled_for
                          from public.appointments
                          where org_id = follow_up.org_id and follow_up_id = follow_up.id
                          order by created_at desc
                          limit 1
                        ) appointment on true
                        left join lateral (
                          select created_at, metadata
                          from public.audit_events
                          where org_id = follow_up.org_id
                            and entity_type = 'follow_up'
                            and entity_id = follow_up.id::text
                            and action in ('follow_up_invitation_sent', 'follow_up_reminder_sent')
                          order by created_at desc
                          limit 1
                        ) contact on true
                        left join lateral (
                          select count(*) as reminder_count
                          from public.audit_events
                          where org_id = follow_up.org_id
                            and entity_type = 'follow_up'
                            and entity_id = follow_up.id::text
                            and action = 'follow_up_reminder_sent'
                        ) reminders on true
                        where follow_up.org_id = %s and follow_up.id = %s
                        limit 1
                        """,
                        (org_id, follow_up_id),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else {}

        return await asyncio.to_thread(_get)

    async def list_follow_ups_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(FOLLOW_UP_COLUMNS)}
                        from public.follow_ups
                        where org_id = %s and patient_id = %s
                        order by scheduled_for desc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def cancel_expired_follow_ups(self, org_id: str, stale_before_iso: str) -> int:
        def _cancel() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.follow_ups
                        set status = 'cancelled', completed_at = null
                        where org_id = %s and status = 'scheduled' and scheduled_for < %s
                        returning id
                        """,
                        (org_id, stale_before_iso),
                    )
                    return len(cursor.fetchall())

        return await asyncio.to_thread(_cancel)

    async def claim_due_follow_ups(
        self,
        org_id: str,
        due_after_iso: str,
        due_before_iso: str,
    ) -> list[dict[str, Any]]:
        def _claim() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        with candidates as (
                          select id from public.follow_ups
                          where org_id = %s
                            and status = 'scheduled'
                            and reminder_sent_at is null
                            and scheduled_for > %s
                            and scheduled_for <= %s
                            and (
                              reminder_claimed_at is null
                              or reminder_claimed_at < now() - interval '15 minutes'
                            )
                          order by scheduled_for asc
                          for update skip locked
                        )
                        update public.follow_ups follow_up
                        set reminder_claimed_at = now(),
                            reminder_attempt_count = reminder_attempt_count + 1,
                            reminder_last_error = ''
                        from candidates
                        where follow_up.id = candidates.id
                        returning {', '.join(f'follow_up.{column}' for column in FOLLOW_UP_COLUMNS)}
                        """,
                        (org_id, due_after_iso, due_before_iso),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_claim)

    async def mark_follow_up_reminder_sent(self, org_id: str, follow_up_id: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.follow_ups
                        set reminder_sent_at = %s,
                            reminder_claimed_at = null,
                            reminder_last_error = ''
                        where org_id = %s and id = %s
                        returning {_columns_sql(FOLLOW_UP_COLUMNS)}
                        """,
                        (datetime.now(UTC).isoformat(), org_id, follow_up_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to mark follow-up reminder as sent.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_mark)

    async def release_follow_up_reminder_claim(self, org_id: str, follow_up_id: str, error: str) -> None:
        def _release() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.follow_ups
                        set reminder_claimed_at = null,
                            reminder_last_error = %s
                        where org_id = %s and id = %s and reminder_sent_at is null
                        """,
                        (str(error)[:1000], org_id, follow_up_id),
                    )

        await asyncio.to_thread(_release)

    async def update_follow_up(self, org_id: str, follow_up_id: str, payload: FollowUpUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(FOLLOW_UP_COLUMNS)}
                        from public.follow_ups
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, follow_up_id),
                    )
                    if not cursor.fetchone():
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
                            if payload.status == "scheduled":
                                update_payload["reminder_sent_at"] = None
                    if not update_payload:
                        raise ValueError("No follow-up updates provided.")

                    assignments = ", ".join(f"{column} = %s" for column in update_payload)
                    cursor.execute(
                        f"""
                        update public.follow_ups
                        set {assignments}
                        where org_id = %s and id = %s
                        returning {_columns_sql(FOLLOW_UP_COLUMNS)}
                        """,
                        (*update_payload.values(), org_id, follow_up_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update follow-up.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)
