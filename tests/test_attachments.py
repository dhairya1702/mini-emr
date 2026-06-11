from __future__ import annotations

from postgrest.exceptions import APIError

from test_app import auth_headers_for_token, client, register_test_clinic
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
