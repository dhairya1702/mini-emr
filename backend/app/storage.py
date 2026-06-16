from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Protocol

from app.config import get_settings


class PatientAttachmentStorage(Protocol):
    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        ...

    async def download(self, storage_path: str) -> bytes:
        ...

    async def delete(self, storage_path: str) -> None:
        ...


class GcsPatientAttachmentStorage:
    def __init__(self, bucket_name: str, client=None) -> None:
        normalized_bucket_name = str(bucket_name or "").strip()
        if not normalized_bucket_name:
            raise RuntimeError("GCS_PATIENT_ATTACHMENTS_BUCKET must be configured.")
        if client is None:
            from google.cloud import storage as google_storage

            client = google_storage.Client()
        self.bucket = client.bucket(normalized_bucket_name)

    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        def _upload() -> None:
            blob = self.bucket.blob(storage_path)
            blob.upload_from_string(raw_bytes, content_type=content_type)

        await asyncio.to_thread(_upload)

    async def download(self, storage_path: str) -> bytes:
        return await asyncio.to_thread(lambda: self.bucket.blob(storage_path).download_as_bytes())

    async def delete(self, storage_path: str) -> None:
        def _delete() -> None:
            try:
                self.bucket.blob(storage_path).delete()
            except Exception as exc:  # pragma: no cover - provider-specific missing-object handling
                if exc.__class__.__name__ != "NotFound":
                    raise

        await asyncio.to_thread(_delete)


@lru_cache
def get_patient_attachment_storage() -> PatientAttachmentStorage:
    settings = get_settings()
    return GcsPatientAttachmentStorage(settings.gcs_patient_attachments_bucket)
