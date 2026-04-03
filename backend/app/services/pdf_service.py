from io import BytesIO
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


def _wrap_text(text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    lines: list[str] = []
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            lines.append("")
            continue

        words = stripped.split()
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if stringWidth(candidate, font_name, font_size) <= max_width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)

    return lines


DETAIL_LABELS = {
    "Name",
    "Phone",
    "Age",
    "Height",
    "Weight",
    "Temperature",
    "Reason for Visit",
    "Generated On",
}

SECTION_LABELS = {
    "Presenting Complaint",
    "Diagnosis",
    "Clinical Notes",
    "Treatment",
    "Follow-up Advice",
}


def _extract_note_body(note_content: str) -> str:
    lines = note_content.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if any(stripped.startswith(f"{label}:") for label in SECTION_LABELS):
            return "\n".join(lines[index:]).strip()
    return note_content.strip()


def _draw_label_value_line(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    label: str,
    value: str,
    max_width: float,
) -> float:
    label_font = "Helvetica-Bold"
    body_font = "Helvetica"
    font_size = 11
    label_text = f"{label}:"
    label_width = stringWidth(label_text + " ", label_font, font_size)
    value_width = max_width - label_width
    wrapped_values = _wrap_text(value, body_font, font_size, value_width) or [""]

    pdf.setFillColor(HexColor("#1e293b"))
    pdf.setFont(label_font, font_size)
    pdf.drawString(x, y, label_text)

    pdf.setFont(body_font, font_size)
    pdf.drawString(x + label_width, y, wrapped_values[0])
    y -= 16

    for continuation in wrapped_values[1:]:
        pdf.drawString(x + label_width, y, continuation)
        y -= 16

    return y


def build_note_pdf(patient: dict[str, Any], note_content: str, generated_on: str) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    margin_x = 0.75 * inch
    top_y = height - 0.75 * inch
    max_width = width - (margin_x * 2)

    patient_name = patient.get("name", "Patient")
    pdf.setTitle(f"{patient_name} Consultation Note")

    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin_x, top_y, "ClinicOS")

    pdf.setFillColor(HexColor("#475569"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin_x, top_y - 18, "Consultation Note")

    pdf.setFont("Helvetica-Bold", 10)
    generated_label = "Date:"
    label_width = stringWidth(generated_label + " ", "Helvetica-Bold", 10)
    value_width = stringWidth(generated_on, "Helvetica", 10)
    right_x = width - margin_x - label_width - value_width
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.drawString(right_x, top_y, generated_label)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(right_x + label_width, top_y, generated_on)

    y = top_y - 42
    detail_lines = [
        ("Name", patient.get("name", "Not recorded")),
        ("Phone", patient.get("phone", "Not recorded")),
        ("Age", str(patient.get("age")) if patient.get("age") is not None else "Not recorded"),
        ("Height", f"{patient['height']} cm" if patient.get("height") is not None else "Not recorded"),
        ("Weight", f"{patient['weight']} kg" if patient.get("weight") is not None else "Not recorded"),
        (
            "Temperature",
            f"{patient['temperature']} F" if patient.get("temperature") is not None else "Not recorded",
        ),
        (
            "Reason for Visit",
            patient.get("reason", "Not recorded"),
        ),
    ]

    for label, value in detail_lines:
        y = _draw_label_value_line(pdf, margin_x, y, label, value, max_width)

    y -= 6
    raw_lines = _extract_note_body(note_content).splitlines()

    for line in raw_lines:
        if y < 0.75 * inch:
            pdf.showPage()
            y = height - 0.75 * inch
            pdf.setFillColor(HexColor("#1e293b"))

        stripped = line.strip()
        if stripped == "":
            y -= 10
            continue

        if ":" in stripped:
            label, value = stripped.split(":", 1)
            label = label.strip()
            value = value.strip()

            if label in DETAIL_LABELS:
                y = _draw_label_value_line(pdf, margin_x, y, label, value or "Not recorded", max_width)
                continue

            if label in SECTION_LABELS and value == "":
                pdf.setFont("Helvetica-Bold", 11)
                pdf.drawString(margin_x, y, f"{label}:")
                y -= 18
                continue

        wrapped_lines = _wrap_text(stripped, "Helvetica", 11, max_width)
        pdf.setFont("Helvetica", 11)
        pdf.setFillColor(HexColor("#1e293b"))
        for wrapped in wrapped_lines:
            if y < 0.75 * inch:
                pdf.showPage()
                y = height - 0.75 * inch
                pdf.setFont("Helvetica", 11)
                pdf.setFillColor(HexColor("#1e293b"))
            pdf.drawString(margin_x, y, wrapped)
            y -= 16

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()
