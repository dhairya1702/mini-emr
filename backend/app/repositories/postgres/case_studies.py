from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.case_studies import CaseStudyCreate


CASE_STUDY_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "title",
    "status",
    "template_key",
    "anonymized",
    "author_instructions",
    "generated_content",
    "source_snapshot",
    "created_by",
    "created_at",
    "updated_at",
]

CASE_STUDY_UPDATE_COLUMNS = {
    "patient_id",
    "title",
    "status",
    "template_key",
    "anonymized",
    "author_instructions",
    "generated_content",
    "source_snapshot",
}


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


class PostgresCaseStudiesRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_case_study(self, org_id: str, created_by: str, payload: CaseStudyCreate) -> dict[str, Any]:
        case_study_id = str(uuid4())
        timestamp = datetime.now(UTC).isoformat()

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, str(payload.patient_id)),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    cursor.execute(
                        f"""
                        insert into public.case_studies (
                          id,
                          org_id,
                          patient_id,
                          title,
                          status,
                          template_key,
                          anonymized,
                          author_instructions,
                          generated_content,
                          source_snapshot,
                          created_by,
                          updated_at
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                        returning {_columns_sql(CASE_STUDY_COLUMNS)}
                        """,
                        (
                            case_study_id,
                            org_id,
                            str(payload.patient_id),
                            payload.title.strip(),
                            payload.status,
                            payload.template_key,
                            payload.anonymized,
                            payload.author_instructions.strip(),
                            payload.generated_content,
                            json.dumps(payload.source_snapshot),
                            created_by,
                            timestamp,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create case study.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_case_studies(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CASE_STUDY_COLUMNS)}
                        from public.case_studies
                        where org_id = %s
                        order by updated_at desc
                        """,
                        (org_id,),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def get_case_study(self, org_id: str, case_study_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CASE_STUDY_COLUMNS)}
                        from public.case_studies
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, case_study_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Case study not found for this organization.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_get)

    async def update_case_study(self, org_id: str, case_study_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.case_studies where org_id = %s and id = %s limit 1",
                        (org_id, case_study_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Case study not found for this organization.")
                    unsupported_columns = sorted(set(updates) - CASE_STUDY_UPDATE_COLUMNS)
                    if unsupported_columns:
                        raise ValueError("Unsupported case study update fields: " + ", ".join(unsupported_columns))
                    normalized_updates: dict[str, Any] = {}
                    for key, value in updates.items():
                        if key == "patient_id":
                            cursor.execute(
                                "select id from public.patients where org_id = %s and id = %s limit 1",
                                (org_id, str(value)),
                            )
                            if not cursor.fetchone():
                                raise ValueError("Patient not found for this organization.")
                            normalized_updates[key] = str(value)
                        elif key == "source_snapshot":
                            normalized_updates[key] = json.dumps(value)
                        elif hasattr(value, "isoformat"):
                            normalized_updates[key] = value.isoformat()
                        elif isinstance(value, str):
                            normalized_updates[key] = value.strip() if key != "generated_content" else value
                        else:
                            normalized_updates[key] = value
                    normalized_updates["updated_at"] = datetime.now(UTC).isoformat()
                    assignments = ", ".join(
                        f"{column} = %s::jsonb" if column == "source_snapshot" else f"{column} = %s"
                        for column in normalized_updates
                    )
                    cursor.execute(
                        f"""
                        update public.case_studies
                        set {assignments}
                        where org_id = %s and id = %s
                        returning {_columns_sql(CASE_STUDY_COLUMNS)}
                        """,
                        (*normalized_updates.values(), org_id, case_study_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update case study.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)
