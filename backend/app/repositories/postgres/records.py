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
    "content",
    "status",
    "version_number",
    "root_note_id",
    "amended_from_note_id",
    "snapshot_content",
    "asset_payload",
    "snapshot_asset_payload",
    "structured_modules",
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
                          content,
                          asset_payload,
                          structured_modules,
                          status,
                          version_number,
                          root_note_id,
                          amended_from_note_id,
                          snapshot_content,
                          snapshot_asset_payload,
                          finalized_at,
                          sent_at,
                          sent_by,
                          sent_to
                        )
                        values (
                          %s, %s, %s, %s, %s::jsonb, %s::jsonb, 'draft', %s, %s,
                          %s, null, '[]'::jsonb, null, null, null, null
                        )
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (
                            note_id,
                            org_id,
                            str(payload.patient_id),
                            payload.content,
                            json.dumps(payload.asset_payload),
                            json.dumps(payload.structured_modules),
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
                        set content = %s, asset_payload = %s::jsonb, structured_modules = %s::jsonb
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
                        set status = 'final', snapshot_content = %s, finalized_at = %s
                        where org_id = %s and id = %s
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (note.get("content") or "", datetime.now(UTC).isoformat(), org_id, note_id),
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
                content=content,
                asset_payload=asset_payload or note.get("asset_payload") or [],
                structured_modules=structured_modules
                if structured_modules is not None
                else note.get("structured_modules") or [],
            ),
            version_number=next_version,
            root_note_id=root_note_id,
            amended_from_note_id=str(note["id"]),
        )

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(NOTE_COLUMNS)}
                        from public.notes
                        where org_id = %s and patient_id = %s
                        order by created_at desc
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
                        set status = 'sent', snapshot_content = %s, sent_at = %s, sent_by = %s, sent_to = %s
                        where org_id = %s and id = %s
                        returning {_columns_sql(NOTE_COLUMNS)}
                        """,
                        (
                            note.get("snapshot_content") or note.get("content") or "",
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
                        select id, name
                        from public.patients
                        where org_id = %s and id = any(%s::uuid[])
                        """,
                        (org_id, patient_ids),
                    )
                    patient_names = {
                        str(row_dict["id"]): str(row_dict.get("name") or "").strip()
                        for row_dict in (_row_to_dict(row, cursor) for row in cursor.fetchall())
                    }
                    rows = [
                        {**follow_up, "patient_name": patient_names.get(str(follow_up["patient_id"]), "")}
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

    async def list_due_follow_ups(self, org_id: str, due_before_iso: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(FOLLOW_UP_COLUMNS)}
                        from public.follow_ups
                        where org_id = %s
                          and status = 'scheduled'
                          and reminder_sent_at is null
                          and scheduled_for <= %s
                        order by scheduled_for asc
                        """,
                        (org_id, due_before_iso),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def mark_follow_up_reminder_sent(self, org_id: str, follow_up_id: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.follow_ups
                        set reminder_sent_at = %s
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
