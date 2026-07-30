from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict


OPTOMETRY_HISTORY_COLUMNS = [
    "history.id as history_id",
    "history.org_id",
    "history.patient_id",
    "history.payload",
    "history.revision",
    "history.updated_by",
    "coalesce(clinic_user.name, clinic_user.identifier, '') as updated_by_name",
    "history.created_at",
    "history.updated_at",
]


def _normalize_payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    return {}


class PostgresOptometryHistoryRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def get_optometry_history(self, org_id: str, patient_id: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {", ".join(OPTOMETRY_HISTORY_COLUMNS)}
                        from public.patient_optometry_histories history
                        left join public.clinic_users clinic_user on clinic_user.id = history.updated_by
                        where history.org_id = %s and history.patient_id = %s
                        limit 1
                        """,
                        (org_id, patient_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        cursor.execute(
                            "select id from public.patients where org_id = %s and id = %s limit 1",
                            (org_id, patient_id),
                        )
                        if not cursor.fetchone():
                            raise ValueError("Patient not found for this organization.")
                        return None
                    history = _row_to_dict(row, cursor)
                    history["payload"] = _normalize_payload(history.get("payload"))
                    return history

        return await asyncio.to_thread(_get)

    async def save_optometry_history(
        self,
        *,
        org_id: str,
        patient_id: str,
        updated_by: str,
        expected_revision: int,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        def _save() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s for update",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")

                    cursor.execute(
                        """
                        select id, revision
                        from public.patient_optometry_histories
                        where org_id = %s and patient_id = %s
                        for update
                        """,
                        (org_id, patient_id),
                    )
                    existing = cursor.fetchone()
                    current_revision = int(existing[1]) if existing else 0
                    if current_revision != expected_revision:
                        raise ValueError(
                            f"OPTOMETRY_HISTORY_REVISION_CONFLICT:{current_revision}"
                        )

                    next_revision = current_revision + 1
                    history_id = str(existing[0]) if existing else str(uuid4())
                    serialized = json.dumps(payload)
                    if existing:
                        cursor.execute(
                            """
                            update public.patient_optometry_histories
                            set payload = %s::jsonb,
                                revision = %s,
                                updated_by = %s,
                                updated_at = now()
                            where id = %s
                            """,
                            (serialized, next_revision, updated_by, history_id),
                        )
                    else:
                        cursor.execute(
                            """
                            insert into public.patient_optometry_histories (
                              id, org_id, patient_id, payload, revision, updated_by
                            )
                            values (%s, %s, %s, %s::jsonb, %s, %s)
                            """,
                            (
                                history_id,
                                org_id,
                                patient_id,
                                serialized,
                                next_revision,
                                updated_by,
                            ),
                        )

                    cursor.execute(
                        """
                        insert into public.patient_optometry_history_revisions (
                          history_id, org_id, patient_id, revision, payload, updated_by
                        )
                        values (%s, %s, %s, %s, %s::jsonb, %s)
                        """,
                        (
                            history_id,
                            org_id,
                            patient_id,
                            next_revision,
                            serialized,
                            updated_by,
                        ),
                    )
                    cursor.execute(
                        f"""
                        select {", ".join(OPTOMETRY_HISTORY_COLUMNS)}
                        from public.patient_optometry_histories history
                        left join public.clinic_users clinic_user on clinic_user.id = history.updated_by
                        where history.id = %s
                        """,
                        (history_id,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to save optometry details.")
                    history = _row_to_dict(row, cursor)
                    history["payload"] = _normalize_payload(history.get("payload"))
                    return history

        return await asyncio.to_thread(_save)

    async def list_optometry_history_revisions(
        self,
        org_id: str,
        patient_id: str,
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select revision.id, revision.history_id, revision.org_id,
                          revision.patient_id, revision.revision, revision.payload,
                          revision.updated_by, revision.created_at
                        from public.patient_optometry_history_revisions revision
                        where revision.org_id = %s and revision.patient_id = %s
                        order by revision.revision desc
                        """,
                        (org_id, patient_id),
                    )
                    rows = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    for row in rows:
                        row["payload"] = _normalize_payload(row.get("payload"))
                    return rows

        return await asyncio.to_thread(_list)
