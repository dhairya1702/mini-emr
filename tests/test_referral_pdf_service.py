from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
import sys

from pypdf import PdfReader, PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.referral_pdf_service import (
    build_referral_letter_content,
    build_referral_package_pdf,
)
from app.services import referral_pdf_service


def _snapshot(*, summary: str = "Saved chart summary exactly as reviewed.", recipient_type: str = "doctor") -> dict:
    return {
        "generated_at": datetime(2026, 8, 11, 21, 3, tzinfo=UTC),
        "patient": {
            "name": "Lalwani",
            "phone": "5558884769",
            "email": "patient@example.com",
            "date_of_birth": "2002-07-30",
            "ai_summary": summary,
        },
        "referral": {
            "recipient_type": recipient_type,
            "receiving_doctor": "Dr DH" if recipient_type != "patient" else "Lalwani",
            "specialty": "ENT" if recipient_type != "patient" else "",
            "clinic": "Docnot" if recipient_type != "patient" else "",
            "urgency": "routine",
            "reason": "Check up",
            "clinical_question": "Please assess ongoing symptoms",
            "referral_note": "Continue care as appropriate",
        },
        "records": [
            {
                "record_type": "test",
                "title": "Low Vision",
                "date": "2026-08-10T09:30:00+00:00",
                "payload": {
                    "summary": {"diagnosis": "Reduced visual function", "patient_id": "hidden"},
                    "findings": {"distance_va": {"right": "6/60", "left": "6/36"}},
                    "derived_metrics": {"contrast_loss": "Moderate"},
                },
            }
        ],
    }


def _clinic() -> dict:
    return {
        "clinic_name": "Fika Eye Care",
        "clinic_address": "10 Main Street",
        "clinic_phone": "+91 98765 43210",
        "doctor_name": "Dhairya Lalwani",
        "custom_header": "Specialist Eye Clinic",
        "custom_footer": "Fika Eye Care | Confidential clinical correspondence",
        "timezone": "UTC",
    }


def _blank_pdf(width: float, height: float) -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=width, height=height)
    writer.write(output)
    return output.getvalue()


def test_referral_letter_uses_saved_summary_and_formal_correspondence() -> None:
    content = build_referral_letter_content(_snapshot(), _clinic())

    assert "Date: 11/08/2026" in content
    assert "From: Dr. Dhairya Lalwani, Fika Eye Care" in content
    assert "To: Dr. DH, ENT, Docnot" in content
    assert "Subject: Referral of Lalwani for Check up" in content
    assert "Dear Dr. DH," in content
    assert "born on 30/07/2002" in content
    assert "Saved chart summary exactly as reviewed." in content
    assert "assessment and recommendations for further management" in content
    assert "Clinical Referral Package" not in content
    assert "Recipient Type" not in content


def test_patient_only_referral_uses_generic_clinician_and_allows_no_summary() -> None:
    content = build_referral_letter_content(
        _snapshot(summary="", recipient_type="patient"),
        _clinic(),
    )

    assert "To: The Receiving Clinician" in content
    assert "Dear Colleague," in content
    assert "Saved chart summary" not in content


def test_referral_pdf_orders_letter_consultation_appendix_and_external_attachment(monkeypatch) -> None:
    clinic = _clinic()
    note_pdf = _blank_pdf(400, 500)
    external_pdf = _blank_pdf(300, 350)
    rendered_sections: list[str] = []

    def fake_letter_pdf(_clinic, content, _generated_on, **_kwargs):
        rendered_sections.append(content)
        return _blank_pdf(595, 842)

    monkeypatch.setattr(referral_pdf_service, "build_letter_pdf", fake_letter_pdf)

    result, page_count = build_referral_package_pdf(
        _snapshot(),
        [("external.pdf", "application/pdf", external_pdf)],
        clinic_context=clinic,
        consultation_pdfs=[note_pdf],
    )
    assert page_count == 4
    assert "Referral of Lalwani for Check up" in rendered_sections[0]
    assert "Saved chart summary exactly as reviewed." in rendered_sections[0]
    assert "Clinical Appendix - Low Vision" in rendered_sections[1]
    assert "Reduced visual function" in rendered_sections[1]
    assert "Distance Va - Right: 6/60" in rendered_sections[1]
    assert "hidden" not in rendered_sections[1]
    reader = PdfReader(BytesIO(result))
    assert len(reader.pages) == 4
    assert float(reader.pages[0].mediabox.width) == 595
    assert float(reader.pages[1].mediabox.width) == 400
    assert float(reader.pages[1].mediabox.height) == 500
    assert float(reader.pages[2].mediabox.width) == 595
    assert float(reader.pages[3].mediabox.width) == 300
    assert float(reader.pages[3].mediabox.height) == 350
    generated_text = "\n".join(rendered_sections)
    assert "T21:03:04" not in generated_text
    assert "Record Type" not in generated_text
    assert "Recipient Type" not in generated_text
