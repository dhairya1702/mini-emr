from __future__ import annotations

from base64 import b64encode
from io import BytesIO

from pypdf import PdfWriter

from test_app import auth_headers_for_token, client, register_test_clinic, signature_png_bytes
from app.services.pdf_service import _page_size_for_template
from app.services import note_workflow, whatsapp_document_workflow
from app.services.whatsapp_client import WhatsAppSendResult


class FakeWhatsAppDocumentClient:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.documents: list[dict[str, object]] = []

    def upload_media(self, *, content: bytes, filename: str, content_type: str) -> str:
        self.uploads.append({"content": content, "filename": filename, "content_type": content_type})
        return "media-letter"

    def send_document(self, *, to: str, media_id: str, filename: str, caption: str = "") -> WhatsAppSendResult:
        self.documents.append({"to": to, "media_id": media_id, "filename": filename, "caption": caption})
        return WhatsAppSendResult(message_id="wamid.letter", raw={"messages": [{"id": "wamid.letter"}]})


def test_clinic_settings_document_template_upload_download_and_remove(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="settings-template@clinic.com", clinic_name="Template Clinic")
    headers = auth_headers_for_token(session["token"])

    initial = test_client.get("/settings/clinic", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["document_template_name"] is None
    assert initial.json()["document_template_url"] is None
    assert initial.json()["document_template_notes_enabled"] is False
    assert initial.json()["document_template_margin_top"] == 54
    assert initial.json()["appointment_start_time"] == "09:00"
    assert initial.json()["appointment_end_time"] == "18:00"
    assert initial.json()["appointments_per_hour"] == 4
    assert initial.json()["clinic_specialty"] is None
    assert initial.json()["timezone"] == "Asia/Kolkata"
    assert initial.json()["onboarding_required"] is True
    assert initial.json()["onboarding_completed_at"] is None
    assert initial.json()["workspace_mode"] == "solo"

    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    template_buffer = BytesIO()
    writer.write(template_buffer)
    template_bytes = template_buffer.getvalue()
    uploaded = test_client.post(
        "/settings/clinic/document-template",
        headers=headers,
        files={"file": ("letterhead.pdf", template_bytes, "application/pdf")},
    )
    assert uploaded.status_code == 200
    uploaded_json = uploaded.json()
    assert uploaded_json["document_template_name"] == "letterhead.pdf"
    assert uploaded_json["document_template_url"] == "/settings/clinic/document-template/file"
    assert uploaded_json["document_template_notes_enabled"] is True
    assert uploaded_json["document_template_letters_enabled"] is True
    assert uploaded_json["document_template_invoices_enabled"] is True

    downloaded = test_client.get("/settings/clinic/document-template/file", headers=headers)
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/pdf"
    assert downloaded.content == template_bytes

    updated = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Template Clinic",
            "timezone": "Asia/Kolkata",
            "appointment_start_time": "08:30",
            "appointment_end_time": "17:30",
            "appointments_per_hour": 2,
            "document_template_notes_enabled": True,
            "document_template_letters_enabled": True,
            "document_template_invoices_enabled": False,
            "document_template_margin_top": 72,
            "document_template_margin_right": 48,
            "document_template_margin_bottom": 54,
            "document_template_margin_left": 60,
            "document_template_signature_x": 0.58,
            "document_template_signature_y": 0.76,
            "document_template_signature_width": 0.28,
            "document_template_signature_height": 0.09,
            "document_template_doctor_name_x": 0.58,
            "document_template_doctor_name_y": 0.86,
            "document_template_doctor_name_width": 0.28,
            "document_template_doctor_name_height": 0.04,
            "document_template_note_layout": {
                "name": {"x": 0.11, "y": 0.16, "width": 0.3, "height": 0.04},
                "noteBody": {"x": 0.12, "y": 0.3, "width": 0.7, "height": 0.42},
            },
        },
    )
    assert updated.status_code == 200
    updated_json = updated.json()
    assert updated_json["document_template_name"] == "letterhead.pdf"
    assert updated_json["document_template_notes_enabled"] is True
    assert updated_json["document_template_letters_enabled"] is True
    assert updated_json["document_template_margin_top"] == 72
    assert updated_json["document_template_margin_left"] == 60
    assert updated_json["document_template_signature_x"] == 0.58
    assert updated_json["document_template_signature_y"] == 0.76
    assert updated_json["document_template_signature_width"] == 0.28
    assert updated_json["document_template_signature_height"] == 0.09
    assert updated_json["document_template_doctor_name_x"] == 0.58
    assert updated_json["document_template_doctor_name_y"] == 0.86
    assert updated_json["document_template_doctor_name_width"] == 0.28
    assert updated_json["document_template_doctor_name_height"] == 0.04
    assert updated_json["document_template_note_layout"]["name"]["x"] == 0.11
    assert updated_json["document_template_note_layout"]["noteBody"]["height"] == 0.42
    assert updated_json["appointment_start_time"] == "08:30"
    assert updated_json["appointment_end_time"] == "17:30"
    assert updated_json["appointments_per_hour"] == 2
    assert updated_json["timezone"] == "Asia/Kolkata"
    assert updated_json["workspace_mode"] == "solo"


def test_clinic_settings_can_store_specialty_for_existing_org(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="settings-specialty@clinic.com", clinic_name="Specialty Clinic")
    headers = auth_headers_for_token(session["token"])

    response = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Specialty Clinic",
            "clinic_specialty": "dentistry",
            "timezone": "America/New_York",
            "appointment_start_time": "09:00",
            "appointment_end_time": "18:00",
            "appointments_per_hour": 4,
        },
    )

    assert response.status_code == 200
    assert response.json()["clinic_specialty"] == "dentistry"
    assert response.json()["timezone"] == "America/New_York"
    assert response.json()["workspace_mode"] == "solo"

    fetched = test_client.get("/settings/clinic", headers=headers)
    assert fetched.status_code == 200
    assert fetched.json()["clinic_specialty"] == "dentistry"
    assert fetched.json()["timezone"] == "America/New_York"
    assert fetched.json()["workspace_mode"] == "solo"

    completed = test_client.post("/settings/clinic/onboarding/complete", headers=headers)
    assert completed.status_code == 200
    assert completed.json()["onboarding_completed_at"] is not None
    assert completed.json()["workspace_mode"] == "solo"

    removed = test_client.delete("/settings/clinic/document-template", headers=headers)
    assert removed.status_code == 200
    removed_json = removed.json()
    assert removed_json["document_template_name"] is None
    assert removed_json["document_template_url"] is None
    assert removed_json["document_template_notes_enabled"] is False
    assert removed_json["document_template_letters_enabled"] is False

    missing = test_client.get("/settings/clinic/document-template/file", headers=headers)
    assert missing.status_code == 404


def test_clinic_template_rejects_malformed_pdf(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="bad-template@clinic.com", clinic_name="Bad Template Clinic")
    response = test_client.post(
        "/settings/clinic/document-template",
        headers=auth_headers_for_token(session["token"]),
        files={"file": ("unsafe.pdf", b"%PDF-1.4 not a real PDF", "application/pdf")},
    )
    assert response.status_code == 400
    assert "malformed or unsafe" in response.json()["detail"]


def test_clinic_settings_normalizes_common_timezone_aliases(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="settings-timezone-alias@clinic.com", clinic_name="Timezone Alias Clinic")
    headers = auth_headers_for_token(session["token"])

    response = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Timezone Alias Clinic",
            "timezone": "Asia/Calcutta",
            "appointment_start_time": "09:00",
            "appointment_end_time": "18:00",
            "appointments_per_hour": 4,
        },
    )

    assert response.status_code == 200
    assert response.json()["timezone"] == "Asia/Kolkata"


def test_generate_letter_pdf_returns_error_when_template_is_enabled_but_missing(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="settings-letter-preview@clinic.com", clinic_name="Letter Preview Clinic")
    headers = auth_headers_for_token(session["token"])
    org_id = session["user"]["org_id"]

    repo.clinic_settings[org_id] = {
        "id": repo.clinic_settings[org_id]["id"],
        "org_id": org_id,
        "clinic_name": "Letter Preview Clinic",
        "document_template_name": "letterhead.pdf",
        "document_template_content_type": "application/pdf",
        "document_template_data_base64": None,
        "document_template_letters_enabled": True,
    }

    response = test_client.post(
        "/generate-letter-pdf",
        headers=headers,
        json={"content": "To: Patient\nSubject: Follow-up\nPlease review your medicines."},
    )

    assert response.status_code == 400
    assert "template is enabled" in response.json()["detail"]


def test_generate_letter_pdf_uses_template_when_letter_template_is_configured(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="settings-letter-template@clinic.com", clinic_name="Letter Template Clinic")
    headers = auth_headers_for_token(session["token"])
    org_id = session["user"]["org_id"]

    repo.clinic_settings[org_id] = {
        "id": repo.clinic_settings[org_id]["id"],
        "org_id": org_id,
        "clinic_name": "Letter Template Clinic",
        "document_template_name": "letterhead.png",
        "document_template_content_type": "image/png",
        "document_template_data_base64": b64encode(b"fake image bytes").decode("ascii"),
        "document_template_letters_enabled": True,
    }

    response = test_client.post(
        "/generate-letter-pdf",
        headers=headers,
        json={"content": "To: Patient\nSubject: Follow-up\nPlease review your medicines."},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"


def test_generate_letter_pdf_uses_current_user_signature_context(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="settings-letter-signature@clinic.com", clinic_name="Letter Signature Clinic")
    headers = auth_headers_for_token(session["token"])
    user_id = session["user"]["id"]

    repo.users[user_id]["name"] = "Dr Letter Preview"
    repo.users[user_id]["doctor_signature_name"] = "sig.png"
    repo.users[user_id]["doctor_signature_content_type"] = "image/png"
    repo.users[user_id]["doctor_signature_data_base64"] = "ZmFrZQ=="

    captured: dict[str, object] = {}

    def fake_build_letter_pdf(*, clinic, letter_content, generated_on):  # type: ignore[no-redef]
        captured["clinic"] = clinic
        captured["letter_content"] = letter_content
        captured["generated_on"] = generated_on
        return b"%PDF-1.4 test"

    monkeypatch.setattr("app.routes.notes.build_letter_pdf", fake_build_letter_pdf)

    response = test_client.post(
        "/generate-letter-pdf",
        headers=headers,
        json={"content": "To: Patient\nSubject: Follow-up\nPlease review your medicines."},
    )

    assert response.status_code == 200
    rendered_clinic = captured["clinic"]
    assert isinstance(rendered_clinic, dict)
    assert rendered_clinic["doctor_name"] == "Dr Letter Preview"
    assert rendered_clinic["doctor_signature_name"] == "sig.png"
    assert rendered_clinic["doctor_signature_content_type"] == "image/png"
    assert rendered_clinic["doctor_signature_data_base64"] == "ZmFrZQ=="


def test_pdf_template_page_size_is_read_from_uploaded_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)

    buffer = BytesIO()
    writer.write(buffer)

    width, height = _page_size_for_template(("application/pdf", buffer.getvalue()))

    assert width == 612
    assert height == 792


def test_saved_clinic_template_offsets_are_used_for_note_pdf_generation(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="settings-note-template@clinic.com", clinic_name="Note Template Clinic")
    headers = auth_headers_for_token(session["token"])
    org_id = session["user"]["org_id"]
    user_id = session["user"]["id"]

    repo.users[user_id]["name"] = "Dr Note Preview"
    repo.users[user_id]["doctor_signature_name"] = "sig.png"
    repo.users[user_id]["doctor_signature_content_type"] = "image/png"
    repo.users[user_id]["doctor_signature_data_base64"] = "ZmFrZQ=="

    update = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Note Template Clinic",
            "document_template_notes_enabled": True,
            "document_template_margin_top": 200,
            "document_template_margin_right": 54,
            "document_template_margin_bottom": 54,
            "document_template_margin_left": 54,
            "document_template_signature_x": 0.55,
            "document_template_signature_y": 0.72,
            "document_template_signature_width": 0.25,
            "document_template_signature_height": 0.08,
            "document_template_doctor_name_x": 0.55,
            "document_template_doctor_name_y": 0.84,
            "document_template_doctor_name_width": 0.25,
            "document_template_doctor_name_height": 0.04,
            "document_template_note_layout": {
                "name": {"x": 0.1, "y": 0.18, "width": 0.26, "height": 0.04},
            },
        },
    )
    assert update.status_code == 200
    assert repo.clinic_settings[org_id]["document_template_margin_top"] == 200

    patient = test_client.post(
        "/patients",
        json={
            "name": "Template Patient",
            "phone": "5550107878",
            "reason": "Review",
            "age": 26,
            "weight": 62,
            "height": 168,
            "temperature": 98.7,
        },
        headers=headers,
    ).json()

    captured: dict[str, object] = {}

    def fake_build_note_pdf(*, patient, note_content, generated_on, assets=None):  # type: ignore[no-redef]
        captured["patient"] = patient
        captured["note_content"] = note_content
        captured["generated_on"] = generated_on
        captured["assets"] = assets
        return b"%PDF-1.4 test"

    monkeypatch.setattr("app.routes.notes.build_note_pdf", fake_build_note_pdf)

    response = test_client.post(
        "/generate-note-pdf",
        headers=headers,
        json={"patient_id": patient["id"], "content": "Presenting Complaint: Saved offset check"},
    )

    assert response.status_code == 200
    rendered_patient = captured["patient"]
    assert isinstance(rendered_patient, dict)
    assert rendered_patient["document_template_margin_top"] == 200
    assert rendered_patient["document_template_signature_x"] == 0.55
    assert rendered_patient["document_template_signature_y"] == 0.72
    assert rendered_patient["document_template_signature_width"] == 0.25
    assert rendered_patient["document_template_signature_height"] == 0.08
    assert rendered_patient["document_template_doctor_name_x"] == 0.55
    assert rendered_patient["document_template_doctor_name_y"] == 0.84
    assert rendered_patient["document_template_doctor_name_width"] == 0.25
    assert rendered_patient["document_template_doctor_name_height"] == 0.04
    assert rendered_patient["document_template_note_layout"]["name"]["y"] == 0.18
    assert rendered_patient["document_template_notes_enabled"] is True
    assert rendered_patient["doctor_name"] == "Dr Note Preview"
    assert rendered_patient["doctor_signature_name"] == "sig.png"
    assert rendered_patient["doctor_signature_content_type"] == "image/png"
    assert rendered_patient["doctor_signature_data_base64"] == "ZmFrZQ=="
    assert captured["assets"] == []


def test_clinic_email_sender_settings_are_saved_without_returning_app_password(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="settings-email@clinic.com", clinic_name="Mail Clinic")
    headers = auth_headers_for_token(session["token"])
    org_id = session["user"]["org_id"]

    response = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Mail Clinic",
            "sender_name": "Dr Sharma Clinic",
            "sender_email": "drsharma@gmail.com",
            "sender_email_app_password": "abcd efgh ijkl mnop",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sender_name"] == "Dr Sharma Clinic"
    assert body["sender_email"] == "drsharma@gmail.com"
    assert body["email_configured"] is True
    assert "sender_email_app_password" not in body
    assert repo.clinic_settings[org_id]["sender_email_app_password"] == "abcd efgh ijkl mnop"


def test_send_letter_emails_generated_content(client, monkeypatch):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="settings-send-letter@clinic.com", clinic_name="Letter Send Clinic")
    headers = auth_headers_for_token(session["token"])
    sent_messages: list[dict[str, object]] = []

    async def fake_send_clinic_email_message(**kwargs):
        sent_messages.append(kwargs)

    monkeypatch.setattr(note_workflow, "send_clinic_email_message", fake_send_clinic_email_message)

    saved = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Letter Send Clinic",
            "sender_name": "Letter Send Clinic",
            "sender_email": "letters@gmail.com",
            "sender_email_app_password": "abcd efgh ijkl mnop",
        },
    )
    assert saved.status_code == 200

    response = test_client.post(
        "/send-letter",
        headers=headers,
        json={
            "recipient_email": "patient@example.com",
            "subject": "Medical Certificate",
            "content": "This is to certify that the patient attended the clinic.",
        },
    )

    assert response.status_code == 200
    assert sent_messages
    assert sent_messages[0]["recipient"] == "patient@example.com"
    assert sent_messages[0]["subject"] == "Medical Certificate"
    assert sent_messages[0]["text_content"] == (
        "Hi,\n\n"
        "Thank you for visiting Letter Send Clinic.\n\n"
        "Here is your Medical Certificate.\n\n"
        "Attached for your records."
    )
    assert sent_messages[0]["attachments"][0][0] == "clinic_letter.pdf"


def test_send_letter_whatsapp_sends_generated_pdf_document(client, monkeypatch):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="settings-send-letter-wa@clinic.com", clinic_name="Letter WA Clinic")
    headers = auth_headers_for_token(session["token"])
    fake_client = FakeWhatsAppDocumentClient()
    monkeypatch.setattr(whatsapp_document_workflow, "build_whatsapp_client", lambda: fake_client)

    saved = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Letter WA Clinic",
        },
    )
    assert saved.status_code == 200

    response = test_client.post(
        "/send-letter-whatsapp",
        headers=headers,
        json={
            "recipient_phone": "+91 96001 06623",
            "recipient_name": "Letter Patient",
            "subject": "Medical Certificate",
            "content": "This is to certify that the patient attended the clinic.",
        },
    )

    assert response.status_code == 200
    assert fake_client.uploads[0]["filename"] == "clinic_letter.pdf"
    assert fake_client.uploads[0]["content_type"] == "application/pdf"
    assert fake_client.documents == [
        {
            "to": "919600106623",
            "media_id": "media-letter",
            "filename": "clinic_letter.pdf",
            "caption": (
                "Hi Letter,\n\n"
                "Thank you for visiting Letter WA Clinic.\n\n"
                "Here is your Medical Certificate.\n\n"
                "Attached for your records."
            ),
        }
    ]
    events = list(repo.whatsapp_message_events.values())
    assert len(events) == 1
    assert events[0]["intent"] == "send_letter_document"
    assert events[0]["status"] == "sent"
    assert events[0]["wa_message_id"] == "wamid.letter"
    assert events[0]["recipient_wa_id"] == "919600106623"


def test_user_signature_can_be_uploaded_and_removed(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="profile@clinic.com", clinic_name="Profile Clinic")
    headers = auth_headers_for_token(session["token"])

    created = test_client.post(
        "/users/staff",
        headers=headers,
        json={
            "identifier": "signature-user@clinic.com",
            "password": "password123!",
        },
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    signature = test_client.post(
        f"/users/{user_id}/signature",
        headers=headers,
        files={"file": ("signature.png", signature_png_bytes(), "image/png")},
    )
    assert signature.status_code == 200
    signature_body = signature.json()
    assert signature_body["doctor_signature_name"] == "signature.png"
    assert signature_body["doctor_signature_url"] == f"/users/{user_id}/signature/file"

    removed = test_client.delete(f"/users/{user_id}/signature", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["doctor_signature_name"] is None


def test_admin_can_change_user_role(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="role-admin@clinic.com", clinic_name="Role Clinic")
    headers = auth_headers_for_token(session["token"])

    created = test_client.post(
        "/users/staff",
        headers=headers,
        json={"identifier": "staff-role@clinic.com", "password": "password123!"},
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    updated = test_client.patch(
        f"/users/{user_id}",
        headers=headers,
        json={"role": "admin"},
    )
    assert updated.status_code == 200
    assert updated.json()["role"] == "admin"


def test_staff_creation_preserves_ops_workspace_mode(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="workspace-admin@clinic.com", clinic_name="Workspace Clinic")
    headers = auth_headers_for_token(session["token"])

    initial = test_client.get("/settings/clinic", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["workspace_mode"] == "solo"

    created = test_client.post(
        "/users/staff",
        headers=headers,
        json={"identifier": "workspace-staff@clinic.com", "password": "password123!"},
    )
    assert created.status_code == 201

    updated = test_client.get("/settings/clinic", headers=headers)
    assert updated.status_code == 200
    assert updated.json()["workspace_mode"] == "solo"


def test_onboarding_completion_preserves_ops_workspace_mode_when_staff_exists(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="workspace-onboarding@clinic.com", clinic_name="Workspace Onboarding")
    headers = auth_headers_for_token(session["token"])

    saved = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={
            "clinic_name": "Workspace Onboarding",
            "clinic_specialty": "general_physician",
            "timezone": "Asia/Kolkata",
            "appointment_start_time": "09:00",
            "appointment_end_time": "18:00",
            "appointments_per_hour": 4,
        },
    )
    assert saved.status_code == 200

    created = test_client.post(
        "/users/staff",
        headers=headers,
        json={"identifier": "workspace-team@clinic.com", "password": "password123!"},
    )
    assert created.status_code == 201

    completed = test_client.post("/settings/clinic/onboarding/complete", headers=headers)
    assert completed.status_code == 200
    assert completed.json()["workspace_mode"] == "solo"


def test_clinic_admin_cannot_change_ops_workspace_mode(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="workspace-locked@clinic.com", clinic_name="Locked Workspace")
    headers = auth_headers_for_token(session["token"])

    updated = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={"workspace_mode": "team"},
    )

    assert updated.status_code == 403
    assert updated.json()["detail"] == "Workspace mode and user limits are managed by ClinicOS Ops."
    current = test_client.get("/settings/clinic", headers=headers)
    assert current.json()["workspace_mode"] == "solo"

    limit_update = test_client.put(
        "/settings/clinic",
        headers=headers,
        json={"users_allowed": 20},
    )
    assert limit_update.status_code == 403
    assert limit_update.json()["detail"] == "Workspace mode and user limits are managed by ClinicOS Ops."


def test_admin_can_remove_user_but_not_self(client):
    test_client, _repo = client
    session = register_test_clinic(test_client, identifier="remove-admin@clinic.com", clinic_name="Remove Clinic")
    headers = auth_headers_for_token(session["token"])

    created = test_client.post(
        "/users/staff",
        headers=headers,
        json={"identifier": "remove-staff@clinic.com", "password": "password123!"},
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    removed = test_client.delete(f"/users/{user_id}", headers=headers)
    assert removed.status_code == 204

    users = test_client.get("/users", headers=headers)
    assert users.status_code == 200
    assert all(user["id"] != user_id for user in users.json())

    self_remove = test_client.delete(f"/users/{session['user']['id']}", headers=headers)
    assert self_remove.status_code == 400
    assert self_remove.json()["detail"] == "You cannot remove your own account."
