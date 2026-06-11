from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError

from test_app import auth_headers_for_token, client, register_test_clinic
from app import storage as storage_module
from app.repositories.attachments import _is_missing_patient_attachments_table


def _create_patient(test_client, headers, name="Attachment Patient"):
    response = test_client.post(
        "/patients",
        json={
            "name": name,
            "phone": "5550104444",
            "reason": "Media review",
            "age": 42,
            "weight": 72,
            "height": 170,
            "temperature": 98.6,
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def test_patient_video_attachment_upload_list_and_download(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="attachments@clinic.com",
        clinic_name="Attachments Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers)

    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("clip.mp4", b"video-bytes", "video/mp4")},
        headers=headers,
    )

    assert upload.status_code == 201
    attachment = upload.json()
    assert attachment["file_name"] == "clip.mp4"
    assert attachment["content_type"] == "video/mp4"
    assert attachment["file_size"] == len(b"video-bytes")
    assert attachment["patient_id"] == patient["id"]

    listed = test_client.get(f"/patients/{patient['id']}/attachments", headers=headers)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [attachment["id"]]

    downloaded = test_client.get(f"/attachments/{attachment['id']}/file", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.content == b"video-bytes"
    assert repo.patient_attachment_files[attachment["storage_path"]] == b"video-bytes"


def test_patient_attachment_rejects_unsupported_file_type(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="attachments-unsupported@clinic.com",
        clinic_name="Attachments Unsupported Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers)

    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("photo.jpg", b"jpg-bytes", "image/jpeg")},
        headers=headers,
    )

    assert upload.status_code == 400
    assert "videos" in upload.json()["detail"]


def test_patient_attachment_download_is_org_scoped(client):
    test_client, _repo = client
    first = register_test_clinic(
        test_client,
        identifier="attachments-first@clinic.com",
        clinic_name="Attachments First Clinic",
    )
    second = register_test_clinic(
        test_client,
        identifier="attachments-second@clinic.com",
        clinic_name="Attachments Second Clinic",
    )
    first_headers = auth_headers_for_token(first["token"])
    second_headers = auth_headers_for_token(second["token"])
    patient = _create_patient(test_client, first_headers)
    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("clip.webm", b"webm-bytes", "video/webm")},
        headers=first_headers,
    )
    assert upload.status_code == 201

    blocked = test_client.get(f"/attachments/{upload.json()['id']}/file", headers=second_headers)
    assert blocked.status_code == 400
    assert "not found" in blocked.json()["detail"].lower()


def test_patient_attachment_missing_table_error_is_detected():
    missing_table_error = APIError(
        {
            "message": "Could not find the table 'public.patient_attachments' in the schema cache",
            "code": "PGRST205",
            "hint": "Perhaps you meant the table 'public.patient_visits'",
            "details": None,
        }
    )
    unrelated_error = APIError(
        {
            "message": "Could not find the table 'public.other_table' in the schema cache",
            "code": "PGRST205",
            "hint": None,
            "details": None,
        }
    )

    assert _is_missing_patient_attachments_table(missing_table_error)
    assert not _is_missing_patient_attachments_table(unrelated_error)


def test_patient_attachment_storage_defaults_to_supabase(monkeypatch):
    marker = object()
    storage_module.get_patient_attachment_storage.cache_clear()
    monkeypatch.setattr(
        storage_module,
        "get_settings",
        lambda: SimpleNamespace(storage_backend="supabase", gcs_patient_attachments_bucket=""),
    )
    monkeypatch.setattr(storage_module, "SupabasePatientAttachmentStorage", lambda: marker)

    assert storage_module.get_patient_attachment_storage() is marker
    storage_module.get_patient_attachment_storage.cache_clear()


def test_patient_attachment_storage_can_select_gcs(monkeypatch):
    class FakeGcsStorage:
        def __init__(self, bucket_name: str) -> None:
            self.bucket_name = bucket_name

    storage_module.get_patient_attachment_storage.cache_clear()
    monkeypatch.setattr(
        storage_module,
        "get_settings",
        lambda: SimpleNamespace(storage_backend="gcs", gcs_patient_attachments_bucket="clinic-media"),
    )
    monkeypatch.setattr(storage_module, "GcsPatientAttachmentStorage", FakeGcsStorage)

    selected = storage_module.get_patient_attachment_storage()

    assert isinstance(selected, FakeGcsStorage)
    assert selected.bucket_name == "clinic-media"
    storage_module.get_patient_attachment_storage.cache_clear()


def test_patient_attachment_storage_rejects_invalid_backend(monkeypatch):
    storage_module.get_patient_attachment_storage.cache_clear()
    monkeypatch.setattr(
        storage_module,
        "get_settings",
        lambda: SimpleNamespace(storage_backend="filesystem", gcs_patient_attachments_bucket=""),
    )

    with pytest.raises(RuntimeError, match="STORAGE_BACKEND"):
        storage_module.get_patient_attachment_storage()
    storage_module.get_patient_attachment_storage.cache_clear()


def test_gcs_patient_attachment_storage_requires_bucket():
    with pytest.raises(RuntimeError, match="GCS_PATIENT_ATTACHMENTS_BUCKET"):
        storage_module.GcsPatientAttachmentStorage("")


def test_gcs_patient_attachment_storage_uploads_and_downloads_bytes():
    class FakeBlob:
        def __init__(self) -> None:
            self.uploaded_bytes = b""
            self.content_type = ""

        def upload_from_string(self, raw_bytes, content_type=None):
            self.uploaded_bytes = raw_bytes
            self.content_type = content_type

        def download_as_bytes(self):
            return self.uploaded_bytes

    class FakeBucket:
        def __init__(self) -> None:
            self.blobs: dict[str, FakeBlob] = {}

        def blob(self, storage_path: str):
            return self.blobs.setdefault(storage_path, FakeBlob())

    class FakeClient:
        def __init__(self) -> None:
            self.bucket_name = ""
            self.fake_bucket = FakeBucket()

        def bucket(self, bucket_name: str):
            self.bucket_name = bucket_name
            return self.fake_bucket

    fake_client = FakeClient()
    storage = storage_module.GcsPatientAttachmentStorage("clinic-media", client=fake_client)

    asyncio.run(storage.upload("org/patient/attachment/video.mp4", b"video-bytes", "video/mp4"))
    downloaded = asyncio.run(storage.download("org/patient/attachment/video.mp4"))

    blob = fake_client.fake_bucket.blobs["org/patient/attachment/video.mp4"]
    assert fake_client.bucket_name == "clinic-media"
    assert blob.uploaded_bytes == b"video-bytes"
    assert blob.content_type == "video/mp4"
    assert downloaded == b"video-bytes"
