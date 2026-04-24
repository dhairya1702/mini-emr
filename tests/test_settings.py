from __future__ import annotations

from base64 import b64encode
from io import BytesIO

from pypdf import PdfWriter

from test_app import auth_headers, client, register
from app.services.pdf_service import _page_size_for_template


def test_clinic_settings_document_template_upload_download_and_remove(client):
    test_client, _repo = client
    session = register(test_client, identifier="settings-template@clinic.com", clinic_name="Template Clinic")
    headers = auth_headers(session["token"])

    initial = test_client.get("/settings/clinic", headers=headers)
    assert initial.status_code == 200
    assert initial.json()["document_template_name"] is None
    assert initial.json()["document_template_url"] is None
    assert initial.json()["document_template_notes_enabled"] is False
    assert initial.json()["document_template_margin_top"] == 54

    template_bytes = b"%PDF-1.4 sample clinic paper"
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
            "document_template_notes_enabled": True,
            "document_template_letters_enabled": True,
            "document_template_invoices_enabled": False,
            "document_template_margin_top": 72,
            "document_template_margin_right": 48,
            "document_template_margin_bottom": 54,
            "document_template_margin_left": 60,
        },
    )
    assert updated.status_code == 200
    updated_json = updated.json()
    assert updated_json["document_template_name"] == "letterhead.pdf"
    assert updated_json["document_template_notes_enabled"] is True
    assert updated_json["document_template_letters_enabled"] is True
    assert updated_json["document_template_margin_top"] == 72
    assert updated_json["document_template_margin_left"] == 60

    removed = test_client.delete("/settings/clinic/document-template", headers=headers)
    assert removed.status_code == 200
    removed_json = removed.json()
    assert removed_json["document_template_name"] is None
    assert removed_json["document_template_url"] is None
    assert removed_json["document_template_notes_enabled"] is False
    assert removed_json["document_template_letters_enabled"] is False

    missing = test_client.get("/settings/clinic/document-template/file", headers=headers)
    assert missing.status_code == 404


def test_generate_letter_pdf_returns_error_when_template_is_enabled_but_missing(client):
    test_client, repo = client
    session = register(test_client, identifier="settings-letter-preview@clinic.com", clinic_name="Letter Preview Clinic")
    headers = auth_headers(session["token"])
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
    session = register(test_client, identifier="settings-letter-template@clinic.com", clinic_name="Letter Template Clinic")
    headers = auth_headers(session["token"])
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
    session = register(test_client, identifier="settings-note-template@clinic.com", clinic_name="Note Template Clinic")
    headers = auth_headers(session["token"])
    org_id = session["user"]["org_id"]

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

    def fake_build_note_pdf(*, patient, note_content, generated_on):  # type: ignore[no-redef]
        captured["patient"] = patient
        captured["note_content"] = note_content
        captured["generated_on"] = generated_on
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
    assert rendered_patient["document_template_notes_enabled"] is True
