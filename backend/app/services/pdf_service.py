from datetime import datetime
from io import BytesIO
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


def _format_display_datetime(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value).strip()
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw
    local_value = parsed.astimezone() if parsed.tzinfo else parsed
    month = local_value.strftime("%b")
    day = local_value.day
    hour = local_value.strftime("%I").lstrip("0") or "0"
    minute_period = local_value.strftime("%M %p")
    return f"{month} {day}, {hour}:{minute_period}"


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


def _draw_detail_pair_row(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    left: tuple[str, str],
    right: tuple[str, str] | None,
    total_width: float,
) -> float:
    gap = 24
    column_width = (total_width - gap) / 2
    left_end_y = _draw_label_value_line(pdf, x, y, left[0], left[1], column_width)
    right_end_y = y
    if right:
        right_end_y = _draw_label_value_line(
            pdf,
            x + column_width + gap,
            y,
            right[0],
            right[1],
            column_width,
        )
    return min(left_end_y, right_end_y)


def build_note_pdf(patient: dict[str, Any], note_content: str, generated_on: str) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    margin_x = 0.75 * inch
    top_y = height - 0.75 * inch
    max_width = width - (margin_x * 2)

    patient_name = patient.get("name", "Patient")
    clinic_name = patient.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = patient.get("custom_header", "")
    custom_footer = patient.get("custom_footer", "")
    pdf.setTitle(f"{patient_name} Consultation Note")

    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin_x, top_y, clinic_name)

    pdf.setFillColor(HexColor("#475569"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin_x, top_y - 18, "Consultation Note")
    if custom_header.strip():
        pdf.drawString(margin_x, top_y - 32, custom_header.strip())

    pdf.setFont("Helvetica-Bold", 10)
    generated_label = "Date:"
    label_width = stringWidth(generated_label + " ", "Helvetica-Bold", 10)
    value_width = stringWidth(generated_on, "Helvetica", 10)
    right_x = width - margin_x - label_width - value_width
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.drawString(right_x, top_y, generated_label)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(right_x + label_width, top_y, generated_on)

    y = top_y - (58 if custom_header.strip() else 42)
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

    for index in range(0, len(detail_lines), 2):
        left = detail_lines[index]
        right = detail_lines[index + 1] if index + 1 < len(detail_lines) else None
        y = _draw_detail_pair_row(pdf, margin_x, y, left, right, max_width)

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

    if custom_footer.strip():
        footer_y = 0.55 * inch
        pdf.setStrokeColor(HexColor("#cbd5e1"))
        pdf.line(margin_x, footer_y + 12, width - margin_x, footer_y + 12)
        pdf.setFont("Helvetica", 9)
        pdf.setFillColor(HexColor("#64748b"))
        footer_lines = _wrap_text(custom_footer.strip(), "Helvetica", 9, max_width)
        current_y = footer_y
        for footer_line in footer_lines[:2]:
            pdf.drawString(margin_x, current_y, footer_line)
            current_y -= 11

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


def build_letter_pdf(clinic: dict[str, Any], letter_content: str, generated_on: str) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    margin_x = 0.75 * inch
    top_y = height - 0.75 * inch
    max_width = width - (margin_x * 2)

    clinic_name = clinic.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = clinic.get("custom_header", "")
    custom_footer = clinic.get("custom_footer", "")
    pdf.setTitle("Clinic Letter")

    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin_x, top_y, clinic_name)

    pdf.setFillColor(HexColor("#475569"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin_x, top_y - 18, "Clinic Letter")
    if custom_header.strip():
        header_lines = _wrap_text(custom_header.strip(), "Helvetica", 10, max_width)
        header_y = top_y - 32
        for header_line in header_lines[:2]:
            pdf.drawString(margin_x, header_y, header_line)
            header_y -= 12

    pdf.setFont("Helvetica-Bold", 10)
    generated_label = "Date:"
    label_width = stringWidth(generated_label + " ", "Helvetica-Bold", 10)
    value_width = stringWidth(generated_on, "Helvetica", 10)
    right_x = width - margin_x - label_width - value_width
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.drawString(right_x, top_y, generated_label)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(right_x + label_width, top_y, generated_on)

    y = top_y - (70 if custom_header.strip() else 44)
    pdf.setFont("Helvetica", 11)
    pdf.setFillColor(HexColor("#1e293b"))

    for raw_line in letter_content.splitlines():
        stripped = raw_line.strip()
        if stripped == "":
            y -= 10
            continue

        if ":" in stripped:
            label, value = stripped.split(":", 1)
            if label.strip() in {"To", "Subject"}:
                y = _draw_label_value_line(pdf, margin_x, y, label.strip(), value.strip(), max_width)
                continue

        wrapped_lines = _wrap_text(stripped, "Helvetica", 11, max_width)
        for wrapped in wrapped_lines:
            if y < 0.95 * inch:
                pdf.showPage()
                y = height - 0.75 * inch
                pdf.setFont("Helvetica", 11)
                pdf.setFillColor(HexColor("#1e293b"))
            pdf.drawString(margin_x, y, wrapped)
            y -= 16

    if custom_footer.strip():
        footer_y = 0.55 * inch
        pdf.setStrokeColor(HexColor("#cbd5e1"))
        pdf.line(margin_x, footer_y + 12, width - margin_x, footer_y + 12)
        pdf.setFont("Helvetica", 9)
        pdf.setFillColor(HexColor("#64748b"))
        footer_lines = _wrap_text(custom_footer.strip(), "Helvetica", 9, max_width)
        current_y = footer_y
        for footer_line in footer_lines[:2]:
            pdf.drawString(margin_x, current_y, footer_line)
            current_y -= 11

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


def build_invoice_pdf(
    clinic: dict[str, Any],
    patient: dict[str, Any],
    invoice: dict[str, Any],
    generated_on: str,
) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    margin_x = 0.75 * inch
    top_y = height - 0.75 * inch
    max_width = width - (margin_x * 2)

    clinic_name = clinic.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = clinic.get("custom_header", "")
    custom_footer = clinic.get("custom_footer", "")
    pdf.setTitle("Clinic Invoice")

    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(margin_x, top_y, clinic_name)

    pdf.setFillColor(HexColor("#475569"))
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin_x, top_y - 18, "Clinic Invoice")
    if custom_header.strip():
        pdf.drawString(margin_x, top_y - 32, custom_header.strip())

    pdf.setFont("Helvetica-Bold", 10)
    generated_label = "Date:"
    label_width = stringWidth(generated_label + " ", "Helvetica-Bold", 10)
    value_width = stringWidth(generated_on, "Helvetica", 10)
    right_x = width - margin_x - label_width - value_width
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.drawString(right_x, top_y, generated_label)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(right_x + label_width, top_y, generated_on)

    y = top_y - (58 if custom_header.strip() else 42)
    details = [
        ("Patient", patient.get("name", "Not recorded")),
        ("Phone", patient.get("phone", "Not recorded")),
        ("Visit Reason", patient.get("reason", "Not recorded")),
        ("Payment Status", str(invoice.get("payment_status", "unpaid")).replace("_", " ").title()),
        ("Amount Paid", f"{float(invoice.get('amount_paid', 0)):.2f}"),
        ("Balance Due", f"{float(invoice.get('balance_due', 0)):.2f}"),
        ("Paid On", _format_display_datetime(invoice.get("paid_at")) or "Pending"),
    ]
    for index in range(0, len(details), 2):
        left = details[index]
        right = details[index + 1] if index + 1 < len(details) else None
        y = _draw_detail_pair_row(pdf, margin_x, y, left, right, max_width)

    y -= 8
    pdf.setFillColor(HexColor("#e0f2fe"))
    pdf.roundRect(margin_x, y - 24, max_width, 24, 8, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin_x + 10, y - 16, "Item")
    pdf.drawString(margin_x + max_width - 170, y - 16, "Qty")
    pdf.drawString(margin_x + max_width - 110, y - 16, "Price")
    pdf.drawString(margin_x + max_width - 50, y - 16, "Total")
    y -= 34

    pdf.setFont("Helvetica", 10)
    for item in invoice.get("items", []):
        if y < 1.25 * inch:
            pdf.showPage()
            y = height - 0.9 * inch
            pdf.setFont("Helvetica", 10)
            pdf.setFillColor(HexColor("#1e293b"))
        pdf.drawString(margin_x + 10, y, str(item.get("label", "")))
        pdf.drawRightString(margin_x + max_width - 145, y, str(item.get("quantity", "")))
        pdf.drawRightString(margin_x + max_width - 80, y, f"{float(item.get('unit_price', 0)):.2f}")
        pdf.drawRightString(margin_x + max_width - 10, y, f"{float(item.get('line_total', 0)):.2f}")
        y -= 18

    y -= 8
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawRightString(margin_x + max_width - 80, y, "Subtotal")
    pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('subtotal', 0)):.2f}")
    y -= 18
    pdf.drawRightString(margin_x + max_width - 80, y, "Total")
    pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('total', 0)):.2f}")

    if custom_footer.strip():
        footer_y = 0.55 * inch
        pdf.setStrokeColor(HexColor("#cbd5e1"))
        pdf.line(margin_x, footer_y + 12, width - margin_x, footer_y + 12)
        pdf.setFont("Helvetica", 9)
        pdf.setFillColor(HexColor("#64748b"))
        footer_lines = _wrap_text(custom_footer.strip(), "Helvetica", 9, max_width)
        current_y = footer_y
        for footer_line in footer_lines[:2]:
            pdf.drawString(margin_x, current_y, footer_line)
            current_y -= 11

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()
