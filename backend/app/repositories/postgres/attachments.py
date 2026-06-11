from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.postgres import PostgresConnectionManager
from app.repositories.attachments import _safe_filename
from app.repositories.postgres.ai_usage import _row_to_dict


PATIENT_ATTACHMENT_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "uploaded_by",
    "file_name",
    "content_type",
    "file_size",
    "storage_path",
    "created_at",
]


class PostgresAttachmentsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def prepare_patient_attachment_metadata(
        self,
        org_id: str,
        patient_id: str,
        *,
        uploaded_by: str,
        filename: str,
        content_type: str,
        file_size: int,
    ) -> dict[str, Any]:
        attachment_id = str(uuid4())
        safe_name = _safe_filename(filename)
        storage_path = f"{org_id}/{patient_id}/{attachment_id}/{safe_name}"

        def _prepare() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    return {
                        "id": attachment_id,
                        "org_id": org_id,
                        "patient_id": patient_id,
                        "uploaded_by": uploaded_by,
                        "file_name": safe_name,
                        "content_type": content_type,
                        "file_size": file_size,
                        "storage_path": storage_path,
                        "created_at": datetime.now(UTC).isoformat(),
                    }

        return await asyncio.to_thread(_prepare)

    async def create_patient_attachment_metadata(self, row: dict[str, Any]) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.patient_attachments (
                          id, org_id, patient_id, uploaded_by, file_name,
                          content_type, file_size, storage_path, created_at
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        returning id, org_id, patient_id, uploaded_by, file_name,
                          content_type, file_size, storage_path, created_at
                        """,
                        (
                            row["id"],
                            row["org_id"],
                            row["patient_id"],
                            row.get("uploaded_by"),
                            row["file_name"],
                            row["content_type"],
                            row.get("file_size") or 0,
                            row["storage_path"],
                            row["created_at"],
                        ),
                    )
                    created = cursor.fetchone()
                    if not created:
                        raise ValueError("Failed to create patient attachment metadata.")
                    return _row_to_dict(created, cursor)

        return await asyncio.to_thread(_create)

    async def list_patient_attachments(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, patient_id, uploaded_by, file_name,
                          content_type, file_size, storage_path, created_at
                        from public.patient_attachments
                        where org_id = %s and patient_id = %s
                        order by created_at desc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def get_patient_attachment(self, org_id: str, attachment_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, patient_id, uploaded_by, file_name,
                          content_type, file_size, storage_path, created_at
                        from public.patient_attachments
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, attachment_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Patient attachment not found for this organization.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_get)
