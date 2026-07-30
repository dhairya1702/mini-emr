from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import AsyncIterator, BinaryIO, Protocol

from app.config import get_settings


class PatientAttachmentStorage(Protocol):
    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        ...

    async def download(self, storage_path: str) -> bytes:
        ...

    async def upload_file(self, storage_path: str, file_obj: BinaryIO, content_type: str) -> None:
        ...

    def iter_download(
        self,
        storage_path: str,
        *,
        start: int = 0,
        end: int | None = None,
        chunk_size: int = 1024 * 1024,
    ) -> AsyncIterator[bytes]:
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

    async def upload_file(self, storage_path: str, file_obj: BinaryIO, content_type: str) -> None:
        def _upload() -> None:
            blob = self.bucket.blob(storage_path)
            blob.upload_from_file(file_obj, rewind=True, content_type=content_type)

        await asyncio.to_thread(_upload)

    async def iter_download(
        self,
        storage_path: str,
        *,
        start: int = 0,
        end: int | None = None,
        chunk_size: int = 1024 * 1024,
    ) -> AsyncIterator[bytes]:
        blob = self.bucket.blob(storage_path)
        offset = start
        while end is None or offset <= end:
            chunk_end = offset + chunk_size - 1
            if end is not None:
                chunk_end = min(chunk_end, end)
            expected_length = chunk_end - offset + 1
            chunk = await asyncio.to_thread(
                blob.download_as_bytes,
                start=offset,
                end=chunk_end,
            )
            if not chunk:
                break
            yield chunk
            offset += len(chunk)
            if len(chunk) < expected_length:
                break

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
