from __future__ import annotations

import asyncio
import warnings
from functools import lru_cache
from typing import Protocol

from app.config import get_settings


PATIENT_ATTACHMENTS_BUCKET = "patient-attachments"


class PatientAttachmentStorage(Protocol):
    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        ...

    async def download(self, storage_path: str) -> bytes:
        ...


class SupabasePatientAttachmentStorage:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase environment variables are not configured.")
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="The `gotrue` package is deprecated.*",
                category=DeprecationWarning,
            )
            from supabase._sync.client import create_client

        self.client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            lambda: self.client.storage.from_(PATIENT_ATTACHMENTS_BUCKET).upload(
                storage_path,
                raw_bytes,
                file_options={
                    "content-type": content_type,
                    "upsert": "false",
                },
            )
        )

    async def download(self, storage_path: str) -> bytes:
        return await asyncio.to_thread(
            lambda: self.client.storage.from_(PATIENT_ATTACHMENTS_BUCKET).download(storage_path)
        )


class GcsPatientAttachmentStorage:
    def __init__(self, bucket_name: str, client=None) -> None:
        normalized_bucket_name = str(bucket_name or "").strip()
        if not normalized_bucket_name:
            raise RuntimeError("GCS_PATIENT_ATTACHMENTS_BUCKET must be configured when STORAGE_BACKEND=gcs.")
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


@lru_cache
def get_patient_attachment_storage() -> PatientAttachmentStorage:
    settings = get_settings()
    storage_backend = str(settings.storage_backend or "supabase").strip().lower()
    if storage_backend == "supabase":
        return SupabasePatientAttachmentStorage()
    if storage_backend == "gcs":
        return GcsPatientAttachmentStorage(settings.gcs_patient_attachments_bucket)
    raise RuntimeError("STORAGE_BACKEND must be one of: supabase, gcs.")
