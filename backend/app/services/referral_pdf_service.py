from __future__ import annotations

import re
from io import BytesIO
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from app.formatting import format_display_date
from app.services.pdf_service import build_letter_pdf

try:
    from pypdf import PdfReader, PdfWriter
except Exception:  # pragma: no cover
    PdfReader = None
    PdfWriter = None


_INTERNAL_TEST_KEYS = {
    "created_at",
    "entry_id",
    "id",
    "org_id",
    "patient_id",
    "schema_version",
    "status",
    "track_type",
    "updated_at",
    "visit_id",
}


def _plain(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return " ".join(str(value).split())


def _label(value: str) -> str:
    return str(value or "").replace("_", " ").strip().title()


def _sentence(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text if text.endswith((".", "!", "?")) else f"{text}."


def _doctor_name(value: Any) -> str:
    name = str(value or "").strip()
    if not name:
        return ""
    cleaned = re.sub(r"^dr\.?\s+", "", name, flags=re.IGNORECASE)
    return f"Dr. {cleaned}" if cleaned else name


def _display_date(value: Any, clinic: dict[str, Any]) -> str:
    if not value:
        return ""
    return format_display_date(value, str(clinic.get("timezone") or "UTC"))


def _patient_description(patient: dict[str, Any], clinic: dict[str, Any]) -> str:
    name = str(patient.get("name") or "the patient").strip() or "the patient"
    date_of_birth = _display_date(patient.get("date_of_birth"), clinic)
    if date_of_birth:
        return f"{name}, born on {date_of_birth}"
    if patient.get("age") not in (None, ""):
        return f"{name}, aged {patient['age']}"
    return name


def build_referral_letter_content(snapshot: dict[str, Any], clinic: dict[str, Any]) -> str:
    patient = snapshot.get("patient") or {}
    referral = snapshot.get("referral") or {}
    patient_name = str(patient.get("name") or "Patient").strip() or "Patient"
    clinic_name = str(clinic.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    referring_doctor = _doctor_name(clinic.get("doctor_name"))

    recipient_type = str(referral.get("recipient_type") or "doctor")
    receiving_doctor = str(referral.get("receiving_doctor") or "").strip()
    if recipient_type == "patient" or not receiving_doctor:
        to_name = "The Receiving Clinician"
        salutation = "Dear Colleague,"
    else:
        to_name = _doctor_name(receiving_doctor)
        salutation = f"Dear {to_name},"

    from_parts = [value for value in (referring_doctor, clinic_name) if value]
    to_parts = [
        value for value in (
            to_name,
            str(referral.get("specialty") or "").strip(),
            str(referral.get("clinic") or "").strip(),
        ) if value
    ]
    reason = str(referral.get("reason") or "further assessment").strip() or "further assessment"

    lines = [
        f"Date: {_display_date(snapshot.get('generated_at'), clinic)}",
        f"From: {', '.join(from_parts)}",
        f"To: {', '.join(to_parts)}",
        f"Subject: Referral of {patient_name} for {reason}",
        "",
        salutation,
        "",
        _sentence(
            f"I am referring {_patient_description(patient, clinic)} to you for further assessment regarding {reason}"
        ),
    ]

    summary = str(patient.get("ai_summary") or "").strip()
    if summary:
        lines.extend(["", summary])

    urgency = str(referral.get("urgency") or "routine").strip().lower()
    if urgency in {"urgent", "emergency"}:
        lines.extend(["", f"This referral is marked as {urgency}."])

    clinical_question = str(referral.get("clinical_question") or "").strip()
    if clinical_question:
        lines.extend([
            "",
            _sentence(f"I would particularly appreciate your assessment regarding {clinical_question}"),
        ])

    referral_note = str(referral.get("referral_note") or "").strip()
    if referral_note:
        lines.extend(["", f"Additional clinical context: {_sentence(referral_note)}"])

    lines.extend([
        "",
        "Please find the relevant consultation notes and selected clinical information attached.",
        "",
        (
            "I would appreciate your assessment and recommendations for further management "
            "and ongoing care as appropriate."
        ),
        "",
        "Yours sincerely,",
    ])
    return "\n".join(lines)


def _flatten_test_values(value: Any, *, prefix: str = "") -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key) in _INTERNAL_TEST_KEYS or child in (None, "", [], {}):
                continue
            label = " - ".join(part for part in (prefix, _label(str(key))) if part)
            if isinstance(child, (dict, list)):
                rows.extend(_flatten_test_values(child, prefix=label))
            else:
                rows.append((label, _plain(child)))
    elif isinstance(value, list):
        for index, child in enumerate(value, 1):
            label = f"{prefix} {index}".strip()
            if isinstance(child, (dict, list)):
                rows.extend(_flatten_test_values(child, prefix=label))
            elif child not in (None, ""):
                rows.append((label or "Finding", _plain(child)))
    elif value not in (None, ""):
        rows.append((prefix or "Finding", _plain(value)))
    return rows


def _test_appendix_content(
    record: dict[str, Any],
    *,
    patient_name: str,
    clinic: dict[str, Any],
) -> str:
    title = str(record.get("title") or "Clinical Test").strip() or "Clinical Test"
    lines = [
        f"Subject: Clinical Appendix - {title}",
        "",
        f"Patient: {patient_name}",
    ]
    measured_on = _display_date(record.get("date"), clinic)
    if measured_on:
        lines.append(f"Test Date: {measured_on}")

    payload = record.get("payload") or {}
    sections = (
        ("Summary", payload.get("summary") or {}),
        ("Findings", payload.get("findings") or {}),
        ("Calculated Measurements", payload.get("derived_metrics") or {}),
    )
    found = False
    for heading, values in sections:
        rows = _flatten_test_values(values)
        if not rows:
            continue
        found = True
        lines.extend(["", f"{heading}:"])
        lines.extend(f"{label}: {value}" for label, value in rows)
    if not found:
        lines.extend(["", "No additional findings were recorded."])
    return "\n".join(lines)


def _image_pdf(raw_bytes: bytes) -> bytes:
    output = BytesIO()
    page_width, page_height = A4
    drawing = canvas.Canvas(output, pagesize=A4)
    reader = ImageReader(BytesIO(raw_bytes))
    width, height = reader.getSize()
    max_width, max_height = page_width - inch, page_height - inch
    scale = min(max_width / width, max_height / height, 1.0)
    draw_width, draw_height = width * scale, height * scale
    drawing.drawImage(
        reader,
        (page_width - draw_width) / 2,
        (page_height - draw_height) / 2,
        draw_width,
        draw_height,
        preserveAspectRatio=True,
    )
    drawing.save()
    return output.getvalue()


def build_referral_package_pdf(
    snapshot: dict[str, Any],
    attachments: list[tuple[str, str, bytes]],
    *,
    clinic_context: dict[str, Any] | None = None,
    consultation_pdfs: list[bytes] | None = None,
) -> tuple[bytes, int]:
    clinic = clinic_context or snapshot.get("clinic") or {}
    generated_on = _display_date(snapshot.get("generated_at"), clinic)
    sources = [
        build_letter_pdf(
            clinic,
            build_referral_letter_content(snapshot, clinic),
            generated_on,
            document_title="Referral Letter",
            show_generated_date=False,
        ),
        *(consultation_pdfs or []),
    ]

    patient_name = str((snapshot.get("patient") or {}).get("name") or "Patient")
    for record in snapshot.get("records") or []:
        if str(record.get("record_type") or "") != "test":
            continue
        sources.append(
            build_letter_pdf(
                clinic,
                _test_appendix_content(record, patient_name=patient_name, clinic=clinic),
                generated_on,
            )
        )

    for file_name, content_type, raw_bytes in attachments:
        if content_type == "application/pdf":
            sources.append(raw_bytes)
        elif content_type.startswith("image/"):
            try:
                sources.append(_image_pdf(raw_bytes))
            except Exception as exc:
                raise ValueError(f"Attachment '{file_name}' could not be rendered in the referral PDF.") from exc
        else:
            raise ValueError(f"Attachment '{file_name}' cannot be embedded in a referral PDF.")

    if PdfReader is None or PdfWriter is None:
        if len(sources) > 1:
            raise ValueError("PDF merging support is unavailable.")
        return sources[0], 1

    pdf_writer = PdfWriter()
    for source in sources:
        try:
            for page in PdfReader(BytesIO(source)).pages:
                pdf_writer.add_page(page)
        except Exception as exc:
            raise ValueError("A referral section could not be rendered as a readable PDF.") from exc
    output = BytesIO()
    pdf_writer.write(output)
    return output.getvalue(), len(pdf_writer.pages)
