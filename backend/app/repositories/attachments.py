from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from postgrest.exceptions import APIError

from app.repositories.base import BaseSupabaseRepository


PATIENT_ATTACHMENTS_BUCKET = "patient-attachments"
MISSING_PATIENT_ATTACHMENTS_TABLE_MESSAGE = (
    "Patient attachments are not set up. Run the latest Supabase schema migration."
)


def _safe_filename(filename: str) -> str:
    stem = Path(filename or "attachment").name.strip() or "attachment"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip(".-")
    return cleaned or "attachment"


def _is_missing_patient_attachments_table(exc: Exception) -> bool:
    return (
        isinstance(exc, APIError)
        and getattr(exc, "code", "") == "PGRST205"
        and "patient_attachments" in str(getattr(exc, "message", exc))
    )


class AttachmentsRepositoryMixin(BaseSupabaseRepository):
    async def create_patient_attachment(
        self,
        org_id: str,
        patient_id: str,
        *,
        uploaded_by: str,
        filename: str,
        content_type: str,
        file_size: int,
        raw_bytes: bytes,
    ) -> dict[str, Any]:
        attachment_id = str(uuid4())
        safe_name = _safe_filename(filename)
        storage_path = f"{org_id}/{patient_id}/{attachment_id}/{safe_name}"

        def _create() -> dict[str, Any]:
            patient = (
                self.client.table("patients")
                .select("id")
                .eq("org_id", org_id)
                .eq("id", patient_id)
                .single()
                .execute()
                .data
            )
            if not patient:
                raise ValueError("Patient not found for this organization.")

            try:
                self.client.table("patient_attachments").select("id").eq("org_id", org_id).limit(1).execute()
            except APIError as exc:
                if _is_missing_patient_attachments_table(exc):
                    raise ValueError(MISSING_PATIENT_ATTACHMENTS_TABLE_MESSAGE) from exc
                raise

            self.client.storage.from_(PATIENT_ATTACHMENTS_BUCKET).upload(
                storage_path,
                raw_bytes,
                file_options={
                    "content-type": content_type,
                    "upsert": "false",
                },
            )
            row = {
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
            return self.client.table("patient_attachments").insert(row).execute().data[0]

        return await asyncio.to_thread(_create)

    async def list_patient_attachments(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            try:
                return (
                    self.client.table("patient_attachments")
                    .select("*")
                    .eq("org_id", org_id)
                    .eq("patient_id", patient_id)
                    .order("created_at", desc=True)
                    .execute()
                    .data
                )
            except APIError as exc:
                if _is_missing_patient_attachments_table(exc):
                    return []
                raise

        return await asyncio.to_thread(_list)

    async def get_patient_attachment(self, org_id: str, attachment_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patient_attachments")
            .select("*")
            .eq("org_id", org_id)
            .eq("id", attachment_id)
            .single()
            .execute()
            .data
        )

    async def download_patient_attachment(self, org_id: str, attachment_id: str) -> tuple[dict[str, Any], bytes]:
        def _download() -> tuple[dict[str, Any], bytes]:
            row = (
                self.client.table("patient_attachments")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", attachment_id)
                .single()
                .execute()
                .data
            )
            if not row:
                raise ValueError("Attachment not found for this organization.")
            raw = self.client.storage.from_(PATIENT_ATTACHMENTS_BUCKET).download(row["storage_path"])
            return row, raw

        return await asyncio.to_thread(_download)
