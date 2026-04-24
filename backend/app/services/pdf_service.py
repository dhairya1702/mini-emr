import base64
from datetime import datetime
from io import BytesIO
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

try:  # pragma: no cover - exercised through integration paths when installed
    from pypdf import PdfReader, PdfWriter
except Exception:  # pragma: no cover
    PdfReader = None
    PdfWriter = None


DEFAULT_MARGIN = 0.75 * inch
MIN_CONTENT_HEIGHT = 0.75 * inch
DEFAULT_PAGE_SIZE = A4
TEMPLATE_FLAGS = {
    "note": "document_template_notes_enabled",
    "letter": "document_template_letters_enabled",
    "invoice": "document_template_invoices_enabled",
}
TEMPLATE_LABELS = {
    "note": "consultation note",
    "letter": "clinic letter",
    "invoice": "invoice",
}
TEMPLATE_MIN_TOP_CLEARANCE = {
    "note": 2.6 * inch,
    "letter": 2.3 * inch,
    "invoice": 2.3 * inch,
}
SIGNATURE_MAX_WIDTH = 2.0 * inch
SIGNATURE_MAX_HEIGHT = 0.8 * inch


class TemplateConfigurationError(ValueError):
    pass


def _page_size_for_template(template: tuple[str, bytes] | None) -> tuple[float, float]:
    if not template or template[0] != "application/pdf" or PdfReader is None:
        return DEFAULT_PAGE_SIZE
    try:
        reader = PdfReader(BytesIO(template[1]))
    except Exception as exc:
        raise TemplateConfigurationError(
            "The uploaded PDF template could not be opened. Re-upload the template in Clinic settings."
        ) from exc
    if not reader.pages:
        raise TemplateConfigurationError(
            "The uploaded PDF template has no pages. Re-upload the template in Clinic settings."
        )
    page = reader.pages[0]
    box = page.mediabox
    try:
        width = float(box.width)
        height = float(box.height)
    except Exception as exc:
        raise TemplateConfigurationError(
            "The uploaded PDF template has an unsupported page size. Re-upload the template in Clinic settings."
        ) from exc
    if width <= 0 or height <= 0:
        raise TemplateConfigurationError(
            "The uploaded PDF template has an invalid page size. Re-upload the template in Clinic settings."
        )
    return width, height


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


def _clamp_margin(value: Any) -> float:
    try:
        margin = float(value)
    except (TypeError, ValueError):
        return DEFAULT_MARGIN
    return max(0.0, min(margin, 288.0))


def _content_bounds(
    data: dict[str, Any],
    use_template: bool,
    page_size: tuple[float, float] = DEFAULT_PAGE_SIZE,
) -> tuple[float, float, float, float]:
    width, height = page_size
    if not use_template:
        margin_x = DEFAULT_MARGIN
        return margin_x, height - DEFAULT_MARGIN, width - (margin_x * 2), DEFAULT_MARGIN

    left = _clamp_margin(data.get("document_template_margin_left"))
    right = _clamp_margin(data.get("document_template_margin_right"))
    top = _clamp_margin(data.get("document_template_margin_top"))
    bottom = _clamp_margin(data.get("document_template_margin_bottom"))
    max_width = max(width - left - right, 120.0)
    bottom_limit = min(max(bottom, 0.0), height - 72.0)
    top_y = max(height - top, bottom_limit + 72.0)
    return left, top_y, max_width, bottom_limit


def _resolve_template(data: dict[str, Any], document_kind: str) -> tuple[str, bytes] | None:
    enabled = bool(data.get(TEMPLATE_FLAGS[document_kind]))
    if not enabled:
        return None
    label = TEMPLATE_LABELS[document_kind]
    mime_type = str(data.get("document_template_content_type") or "").strip().lower()
    encoded = str(data.get("document_template_data_base64") or "").strip()
    template_name = str(data.get("document_template_name") or "").strip()
    if not mime_type or not encoded:
        raise TemplateConfigurationError(
            f"The {label} template is enabled, but the uploaded file is missing. Re-upload the template in Clinic settings."
        )
    try:
        raw_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        raise TemplateConfigurationError(
            f"The uploaded {label} template is invalid. Re-upload the template in Clinic settings."
        ) from None
    if mime_type == "application/pdf" and PdfReader is None:
        raise TemplateConfigurationError(
            f"The uploaded {label} template is a PDF, but PDF template support is unavailable. "
            "Install backend requirements and restart the API."
        )
    if mime_type not in {"application/pdf", "image/jpeg", "image/png"}:
        template_hint = f" for '{template_name}'" if template_name else ""
        raise TemplateConfigurationError(
            f"The uploaded {label} template{template_hint} has unsupported type '{mime_type}'."
    )
    return mime_type, raw_bytes


def _resolve_signature(data: dict[str, Any]) -> tuple[str, bytes] | None:
    mime_type = str(data.get("doctor_signature_content_type") or "").strip().lower()
    encoded = str(data.get("doctor_signature_data_base64") or "").strip()
    if not mime_type or not encoded:
        return None
    if mime_type not in {"image/jpeg", "image/png"}:
        raise TemplateConfigurationError(
            f"The uploaded doctor signature has unsupported type '{mime_type}'."
        )
    try:
        raw_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        raise TemplateConfigurationError("The uploaded doctor signature is invalid.") from None
    return mime_type, raw_bytes


def _draw_background(pdf: canvas.Canvas, template: tuple[str, bytes] | None, width: float, height: float) -> None:
    if not template or template[0] == "application/pdf":
        return
    pdf.drawImage(ImageReader(BytesIO(template[1])), 0, 0, width=width, height=height)


def _apply_pdf_template(base_pdf: bytes, template: tuple[str, bytes] | None) -> bytes:
    if not template or template[0] != "application/pdf" or PdfReader is None or PdfWriter is None:
        return base_pdf

    content_reader = PdfReader(BytesIO(base_pdf))
    template_reader = PdfReader(BytesIO(template[1]))
    if not template_reader.pages:
        return base_pdf

    writer = PdfWriter()
    template_page_count = len(template_reader.pages)
    for index, content_page in enumerate(content_reader.pages):
        merged_page = template_reader.pages[min(index, template_page_count - 1)].clone(writer)
        merged_page.merge_page(content_page)
        writer.add_page(merged_page)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _start_page(
    pdf: canvas.Canvas,
    template: tuple[str, bytes] | None,
    width: float,
    height: float,
) -> None:
    _draw_background(pdf, template, width, height)
    pdf.setFillColor(HexColor("#1e293b"))


def _draw_template_heading(
    pdf: canvas.Canvas,
    x: float,
    top_y: float,
    max_width: float,
    title: str,
    generated_on: str,
) -> float:
    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(x, top_y, title)

    pdf.setFont("Helvetica", 10)
    label_text = "Date:"
    label_width = stringWidth(label_text + " ", "Helvetica-Bold", 10)
    value_width = stringWidth(generated_on, "Helvetica", 10)
    right_x = x + max(max_width - label_width - value_width, 0)
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(right_x, top_y, label_text)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(right_x + label_width, top_y, generated_on)
    return top_y - 24


def _draw_doctor_signature(
    pdf: canvas.Canvas,
    data: dict[str, Any],
    *,
    width: float,
    margin_x: float,
    bottom_limit: float,
    max_width: float,
    y: float,
) -> None:
    signature = _resolve_signature(data)
    if not signature:
        doctor_name = str(data.get("doctor_name") or "").strip()
        if not doctor_name:
            return
        y = max(y, bottom_limit + 28)
        pdf.setFillColor(HexColor("#1e293b"))
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawRightString(width - margin_x, y, doctor_name)
        return

    _, raw_bytes = signature
    doctor_name = str(data.get("doctor_name") or "").strip()
    image_width = min(SIGNATURE_MAX_WIDTH, max_width * 0.45)
    image_height = SIGNATURE_MAX_HEIGHT
    x = width - margin_x - image_width
    image_y = max(y - image_height, bottom_limit + 18)
    pdf.drawImage(
        ImageReader(BytesIO(raw_bytes)),
        x,
        image_y,
        width=image_width,
        height=image_height,
        preserveAspectRatio=True,
        mask="auto",
    )
    if doctor_name:
        pdf.setFillColor(HexColor("#1e293b"))
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawRightString(width - margin_x, image_y - 12, doctor_name)


def _template_content_start_y(top_y: float, page_height: float, document_kind: str) -> float:
    safe_top_y = page_height - TEMPLATE_MIN_TOP_CLEARANCE[document_kind]
    return min(top_y, safe_top_y)


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
    template = _resolve_template(patient, "note")
    width, height = _page_size_for_template(template)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    use_template = template is not None
    margin_x, top_y, max_width, bottom_limit = _content_bounds(patient, use_template, (width, height))

    patient_name = patient.get("name", "Patient")
    clinic_name = patient.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = patient.get("custom_header", "")
    custom_footer = patient.get("custom_footer", "")
    pdf.setTitle(f"{patient_name} Consultation Note")

    if use_template:
        _start_page(pdf, template, width, height)
        y = _template_content_start_y(top_y, height, "note")
    else:
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
        if y < bottom_limit:
            pdf.showPage()
            if use_template:
                _start_page(pdf, template, width, height)
                y = _template_content_start_y(top_y, height, "note")
            else:
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
            if y < bottom_limit:
                pdf.showPage()
                if use_template:
                    _start_page(pdf, template, width, height)
                    y = _template_content_start_y(top_y, height, "note")
                else:
                    y = height - 0.75 * inch
                    pdf.setFont("Helvetica", 11)
                    pdf.setFillColor(HexColor("#1e293b"))
            pdf.drawString(margin_x, y, wrapped)
            y -= 16

    _draw_doctor_signature(pdf, patient, width=width, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y)

    if custom_footer.strip() and not use_template:
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
    return _apply_pdf_template(buffer.getvalue(), template)


def build_letter_pdf(clinic: dict[str, Any], letter_content: str, generated_on: str) -> bytes:
    template = _resolve_template(clinic, "letter")
    width, height = _page_size_for_template(template)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    use_template = template is not None
    margin_x, top_y, max_width, bottom_limit = _content_bounds(clinic, use_template, (width, height))

    clinic_name = clinic.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = clinic.get("custom_header", "")
    custom_footer = clinic.get("custom_footer", "")
    pdf.setTitle("Clinic Letter")

    if use_template:
        _start_page(pdf, template, width, height)
        y = _template_content_start_y(top_y, height, "letter")
    else:
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
            if y < bottom_limit:
                pdf.showPage()
                if use_template:
                    _start_page(pdf, template, width, height)
                    y = _template_content_start_y(top_y, height, "letter")
                else:
                    y = height - 0.75 * inch
                    pdf.setFont("Helvetica", 11)
                    pdf.setFillColor(HexColor("#1e293b"))
            pdf.drawString(margin_x, y, wrapped)
            y -= 16

    _draw_doctor_signature(pdf, clinic, width=width, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y)

    if custom_footer.strip() and not use_template:
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
    return _apply_pdf_template(buffer.getvalue(), template)


def build_invoice_pdf(
    clinic: dict[str, Any],
    patient: dict[str, Any],
    invoice: dict[str, Any],
    generated_on: str,
) -> bytes:
    template = _resolve_template(clinic, "invoice")
    width, height = _page_size_for_template(template)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    use_template = template is not None
    margin_x, top_y, max_width, bottom_limit = _content_bounds(clinic, use_template, (width, height))

    clinic_name = clinic.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = clinic.get("custom_header", "")
    custom_footer = clinic.get("custom_footer", "")
    pdf.setTitle("Clinic Invoice")

    if use_template:
        _start_page(pdf, template, width, height)
        y = _template_content_start_y(top_y, height, "invoice")
    else:
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
        if y < bottom_limit + 48:
            pdf.showPage()
            if use_template:
                _start_page(pdf, template, width, height)
                y = _template_content_start_y(top_y, height, "invoice")
            else:
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

    if custom_footer.strip() and not use_template:
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
    return _apply_pdf_template(buffer.getvalue(), template)
