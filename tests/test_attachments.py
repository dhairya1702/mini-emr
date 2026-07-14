from __future__ import annotations

import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image
from pypdf import PdfWriter

from test_app import auth_headers_for_token, client, register_test_clinic
from app import storage as storage_module


def _image_bytes(image_format: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, format=image_format)
    return output.getvalue()


MP4_BYTES = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20
WEBM_BYTES = b"\x1aE\xdf\xa3" + b"\x00" * 20
def _pdf_bytes() -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.write(output)
    return output.getvalue()


PDF_BYTES = _pdf_bytes()
JPEG_BYTES = _image_bytes("JPEG")
WEBP_BYTES = _image_bytes("WEBP")


def _create_patient(test_client, headers, name="Attachment Patient"):
    response = test_client.post(
        "/patients",
        json={
            "name": name,
            "phone": "5550104444",
            "email": "patient@example.com",
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
        files={"file": ("clip.mp4", MP4_BYTES, "video/mp4")},
        headers=headers,
    )

    assert upload.status_code == 201
    attachment = upload.json()
    assert attachment["file_name"] == "clip.mp4"
    assert attachment["content_type"] == "video/mp4"
    assert attachment["file_size"] == len(MP4_BYTES)
    assert attachment["patient_id"] == patient["id"]

    listed = test_client.get(f"/patients/{patient['id']}/attachments", headers=headers)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [attachment["id"]]

    downloaded = test_client.get(f"/attachments/{attachment['id']}/file", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.content == MP4_BYTES
    assert downloaded.headers["accept-ranges"] == "bytes"
    assert repo.patient_attachment_files[attachment["storage_path"]] == MP4_BYTES

    ranged = test_client.get(
        f"/attachments/{attachment['id']}/file",
        headers={**headers, "Range": "bytes=0-4"},
    )
    assert ranged.status_code == 206
    assert ranged.content == MP4_BYTES[:5]
    assert ranged.headers["content-range"] == f"bytes 0-4/{len(MP4_BYTES)}"

    suffix = test_client.get(
        f"/attachments/{attachment['id']}/file",
        headers={**headers, "Range": "bytes=-4"},
    )
    assert suffix.status_code == 206
    assert suffix.content == MP4_BYTES[-4:]

    unsatisfiable = test_client.get(
        f"/attachments/{attachment['id']}/file",
        headers={**headers, "Range": f"bytes={len(MP4_BYTES)}-"},
    )
    assert unsatisfiable.status_code == 416
    assert unsatisfiable.headers["content-range"] == f"bytes */{len(MP4_BYTES)}"


def test_patient_document_attachment_upload_list_and_download(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="attachments-document@clinic.com",
        clinic_name="Attachments Document Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers)

    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("scan.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert upload.status_code == 201
    attachment = upload.json()
    assert attachment["file_name"] == "scan.pdf"
    assert attachment["content_type"] == "application/pdf"
    assert attachment["file_size"] == len(PDF_BYTES)

    downloaded = test_client.get(f"/attachments/{attachment['id']}/file", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.content == PDF_BYTES
    assert repo.patient_attachment_files[attachment["storage_path"]] == PDF_BYTES


def test_patient_attachment_rejects_malformed_pdf(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="bad-pdf@clinic.com", clinic_name="Bad PDF Clinic")
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers)
    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("unsafe.pdf", b"%PDF-1.4 malformed", "application/pdf")},
        headers=headers,
    )
    assert upload.status_code == 400
    assert "malformed or unsafe" in upload.json()["detail"]


def test_patient_attachment_delete_removes_metadata_and_storage(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="attachments-delete@clinic.com",
        clinic_name="Attachments Delete Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers)

    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("clip.mp4", MP4_BYTES, "video/mp4")},
        headers=headers,
    )
    assert upload.status_code == 201
    attachment = upload.json()

    deleted = test_client.delete(
        f"/patients/{patient['id']}/attachments/{attachment['id']}",
        headers=headers,
    )

    assert deleted.status_code == 200
    assert attachment["id"] == deleted.json()["id"]
    assert attachment["id"] not in repo.patient_attachments
    assert attachment["storage_path"] not in repo.patient_attachment_files


def test_patient_attachment_send_emails_stored_file(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="attachments-send@clinic.com",
        clinic_name="Attachments Send Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    org_id = session["user"]["org_id"]
    repo.clinic_settings[org_id].update(
        {
            "sender_name": "Attachments Send Clinic",
            "sender_email": "clinic@example.com",
            "sender_email_app_password": "abcd efgh ijkl mnop",
        }
    )
    sent: dict = {}

    async def fake_send_clinic_email_message(**kwargs):
        sent.update(kwargs)

    monkeypatch.setattr("app.routes.attachments.send_clinic_email_message", fake_send_clinic_email_message)
    patient = _create_patient(test_client, headers)
    upload = test_client.post(
        f"/patients/{patient['id']}/attachments",
        files={"file": ("scan.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )
    assert upload.status_code == 201
    attachment = upload.json()

    response = test_client.post(
        f"/patients/{patient['id']}/attachments/{attachment['id']}/send",
        json={
            "recipient_email": "confirmed@example.com",
            "subject": "Your scan",
            "message": "Attached scan.",
        },
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Attachment emailed to confirmed@example.com."
    assert sent["recipient"] == "confirmed@example.com"
    assert sent["subject"] == "Your scan"
    assert sent["text_content"] == "Attached scan."
    assert sent["attachments"] == [("scan.pdf", PDF_BYTES, "application/pdf")]
    audit_events = [event for event in repo.audit_events.values() if event["action"] == "patient_attachment_sent"]
    assert audit_events


def test_patient_profile_photo_upload_download_replace_and_delete(client):
    test_client, repo = client
    session = register_test_clinic(
        test_client,
        identifier="patient-photo@clinic.com",
        clinic_name="Patient Photo Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, name="Photo Patient")

    upload = test_client.post(
        f"/patients/{patient['id']}/profile-photo",
        files={"file": ("face.jpg", JPEG_BYTES, "image/jpeg")},
        headers=headers,
    )

    assert upload.status_code == 200
    updated = upload.json()
    assert updated["profile_photo_url"] == f"/patients/{patient['id']}/profile-photo/file"
    assert updated["profile_photo_content_type"] == "image/jpeg"
    assert updated["profile_photo_updated_at"]
    first_storage_path = repo.patients[patient["id"]]["profile_photo_storage_path"]
    assert repo.patient_attachment_files[first_storage_path] == JPEG_BYTES

    downloaded = test_client.get(updated["profile_photo_url"], headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.content == JPEG_BYTES
    assert downloaded.headers["content-type"].startswith("image/jpeg")

    replaced = test_client.post(
        f"/patients/{patient['id']}/profile-photo",
        files={"file": ("face.webp", WEBP_BYTES, "image/webp")},
        headers=headers,
    )

    assert replaced.status_code == 200
    assert replaced.json()["profile_photo_content_type"] == "image/webp"
    second_storage_path = repo.patients[patient["id"]]["profile_photo_storage_path"]
    assert second_storage_path != first_storage_path
    assert first_storage_path not in repo.patient_attachment_files
    assert repo.patient_attachment_files[second_storage_path] == WEBP_BYTES

    deleted = test_client.delete(f"/patients/{patient['id']}/profile-photo", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["profile_photo_url"] is None
    assert second_storage_path not in repo.patient_attachment_files
    assert repo.patients[patient["id"]]["profile_photo_storage_path"] is None


def test_patient_profile_photo_rejects_non_images_and_oversized_files(client):
    test_client, _repo = client
    session = register_test_clinic(
        test_client,
        identifier="patient-photo-invalid@clinic.com",
        clinic_name="Patient Photo Invalid Clinic",
    )
    headers = auth_headers_for_token(session["token"])
    patient = _create_patient(test_client, headers, name="Invalid Photo Patient")

    invalid_type = test_client.post(
        f"/patients/{patient['id']}/profile-photo",
        files={"file": ("notes.pdf", b"pdf-bytes", "application/pdf")},
        headers=headers,
    )
    assert invalid_type.status_code == 400
    assert "Only JPG, PNG, and WEBP" in invalid_type.json()["detail"]

    oversized = test_client.post(
        f"/patients/{patient['id']}/profile-photo",
        files={"file": ("large.jpg", b"x" * (5 * 1024 * 1024 + 1), "image/jpeg")},
        headers=headers,
    )
    assert oversized.status_code == 400
    assert oversized.json()["detail"] == "Patient photo must be 5 MB or smaller."


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
        files={
            "file": (
                "notes.docx",
                b"docx-bytes",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        headers=headers,
    )

    assert upload.status_code == 400
    assert "attachments" in upload.json()["detail"]


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
        files={"file": ("clip.webm", WEBM_BYTES, "video/webm")},
        headers=first_headers,
    )
    assert upload.status_code == 201

    blocked = test_client.get(f"/attachments/{upload.json()['id']}/file", headers=second_headers)
    assert blocked.status_code == 400
    assert "not found" in blocked.json()["detail"].lower()


def test_patient_attachment_storage_uses_gcs(monkeypatch):
    class FakeGcsStorage:
        def __init__(self, bucket_name: str) -> None:
            self.bucket_name = bucket_name

    storage_module.get_patient_attachment_storage.cache_clear()
    monkeypatch.setattr(
        storage_module,
        "get_settings",
        lambda: SimpleNamespace(gcs_patient_attachments_bucket="clinic-media"),
    )
    monkeypatch.setattr(storage_module, "GcsPatientAttachmentStorage", FakeGcsStorage)

    selected = storage_module.get_patient_attachment_storage()

    assert isinstance(selected, FakeGcsStorage)
    assert selected.bucket_name == "clinic-media"
    storage_module.get_patient_attachment_storage.cache_clear()


def test_gcs_patient_attachment_storage_requires_bucket():
    with pytest.raises(RuntimeError, match="GCS_PATIENT_ATTACHMENTS_BUCKET"):
        storage_module.GcsPatientAttachmentStorage("")


def test_gcs_patient_attachment_storage_uploads_and_downloads_bytes():
    class FakeBlob:
        def __init__(self) -> None:
            self.uploaded_bytes = b""
            self.content_type = ""
            self.deleted = False

        def upload_from_string(self, raw_bytes, content_type=None):
            self.uploaded_bytes = raw_bytes
            self.content_type = content_type

        def download_as_bytes(self):
            return self.uploaded_bytes

        def delete(self):
            self.deleted = True

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
    asyncio.run(storage.delete("org/patient/attachment/video.mp4"))

    blob = fake_client.fake_bucket.blobs["org/patient/attachment/video.mp4"]
    assert fake_client.bucket_name == "clinic-media"
    assert blob.uploaded_bytes == b"video-bytes"
    assert blob.content_type == "video/mp4"
    assert downloaded == b"video-bytes"
    assert blob.deleted is True
