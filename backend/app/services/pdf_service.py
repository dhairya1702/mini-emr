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

from app.file_validation import validate_pdf_bytes

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
DEFAULT_TEMPLATE_SIGNATURE_BOX = {
    "x": 0.1,
    "y": 0.78,
    "width": 0.24,
    "height": 0.08,
}
DEFAULT_TEMPLATE_DOCTOR_NAME_BOX = {
    "x": 0.1,
    "y": 0.87,
    "width": 0.24,
    "height": 0.04,
}
DEFAULT_TEMPLATE_NOTE_LAYOUT = {
    "name": {"x": 0.1, "y": 0.16, "width": 0.26, "height": 0.035},
    "weight": {"x": 0.4, "y": 0.16, "width": 0.18, "height": 0.035},
    "date": {"x": 0.66, "y": 0.16, "width": 0.24, "height": 0.035},
    "age": {"x": 0.1, "y": 0.205, "width": 0.2, "height": 0.035},
    "temp": {"x": 0.4, "y": 0.205, "width": 0.2, "height": 0.035},
    "height": {"x": 0.1, "y": 0.25, "width": 0.22, "height": 0.035},
    "noteBody": {"x": 0.1, "y": 0.305, "width": 0.76, "height": 0.41},
}
ASSET_PREVIEW_MAX_HEIGHT = 7.0 * inch
SUPPORTED_NOTE_ASSET_IMAGE_PREFIX = "image/"
SUPPORTED_NOTE_ASSET_PDF_TYPE = "application/pdf"


class TemplateConfigurationError(ValueError):
    pass


def _page_size_for_template(template: tuple[str, bytes] | None) -> tuple[float, float]:
    if not template or template[0] != "application/pdf" or PdfReader is None:
        return DEFAULT_PAGE_SIZE
    try:
        validate_pdf_bytes(template[1])
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


def _wrap_text_after_label(
    text: str,
    font_name: str,
    font_size: int,
    first_line_width: float,
    continuation_width: float,
) -> list[str]:
    """Wrap text beside a label, then use the full row width below it."""
    words = text.strip().split()
    if not words:
        return []

    lines: list[str] = []
    current = words[0]
    current_width = first_line_width
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font_name, font_size) <= current_width:
            current = candidate
            continue
        lines.append(current)
        current = word
        current_width = continuation_width
    lines.append(current)
    return lines


def _clamp_margin(value: Any) -> float:
    try:
        margin = float(value)
    except (TypeError, ValueError):
        return DEFAULT_MARGIN
    return max(0.0, min(margin, 288.0))


def _clamp_normalized(value: Any, fallback: float, *, minimum: float = 0.0, maximum: float = 1.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(parsed, maximum))


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


def _resolve_uploaded_template(data: dict[str, Any], label: str) -> tuple[str, bytes]:
    mime_type = str(data.get("document_template_content_type") or "").strip().lower()
    encoded = str(data.get("document_template_data_base64") or "").strip()
    if not mime_type or not encoded:
        raise TemplateConfigurationError(f"The {label} template file is missing. Re-upload the template in Clinic settings.")
    try:
        raw_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        raise TemplateConfigurationError(f"The uploaded {label} template is invalid. Re-upload the template in Clinic settings.") from None
    if mime_type == "application/pdf" and PdfReader is None:
        raise TemplateConfigurationError(
            f"The uploaded {label} template is a PDF, but PDF template support is unavailable. "
            "Install backend requirements and restart the API."
        )
    if mime_type not in {"application/pdf", "image/jpeg", "image/png"}:
        raise TemplateConfigurationError(f"The uploaded {label} template has unsupported type '{mime_type}'.")
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


def _append_pdf_bytes(primary_pdf: bytes, secondary_pdf: bytes | None) -> bytes:
    if not secondary_pdf:
        return primary_pdf
    if PdfReader is None or PdfWriter is None:
        return primary_pdf

    writer = PdfWriter()
    for source in (primary_pdf, secondary_pdf):
        reader = PdfReader(BytesIO(source))
        for page in reader.pages:
            writer.add_page(page)

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
        pdf.drawString(margin_x, y, doctor_name)
        return

    _, raw_bytes = signature
    doctor_name = str(data.get("doctor_name") or "").strip()
    image_width = min(SIGNATURE_MAX_WIDTH, max_width * 0.45)
    image_height = SIGNATURE_MAX_HEIGHT
    x = margin_x
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
        pdf.drawString(margin_x, image_y - 12, doctor_name)


def _draw_template_signature(pdf: canvas.Canvas, data: dict[str, Any], *, width: float, height: float) -> None:
    signature = _resolve_signature(data)
    if not signature:
        return

    box_width_ratio = _clamp_normalized(
        data.get("document_template_signature_width"),
        DEFAULT_TEMPLATE_SIGNATURE_BOX["width"],
        minimum=0.02,
    )
    box_height_ratio = _clamp_normalized(
        data.get("document_template_signature_height"),
        DEFAULT_TEMPLATE_SIGNATURE_BOX["height"],
        minimum=0.02,
    )
    box_x_ratio = _clamp_normalized(data.get("document_template_signature_x"), DEFAULT_TEMPLATE_SIGNATURE_BOX["x"])
    box_y_ratio = _clamp_normalized(data.get("document_template_signature_y"), DEFAULT_TEMPLATE_SIGNATURE_BOX["y"])
    box_width_ratio = min(box_width_ratio, 1.0 - box_x_ratio)
    box_height_ratio = min(box_height_ratio, 1.0 - box_y_ratio)

    x = box_x_ratio * width
    box_width = max(box_width_ratio * width, 12.0)
    box_height = max(box_height_ratio * height, 12.0)
    y = height - ((box_y_ratio * height) + box_height)
    _, raw_bytes = signature
    pdf.drawImage(
        ImageReader(BytesIO(raw_bytes)),
        x,
        y,
        width=box_width,
        height=box_height,
        preserveAspectRatio=True,
        mask="auto",
    )


def _draw_template_doctor_name(pdf: canvas.Canvas, data: dict[str, Any], *, width: float, height: float) -> None:
    doctor_name = str(data.get("doctor_name") or "").strip()
    if not doctor_name:
        return

    box_width_ratio = _clamp_normalized(
        data.get("document_template_doctor_name_width"),
        DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["width"],
        minimum=0.02,
    )
    box_height_ratio = _clamp_normalized(
        data.get("document_template_doctor_name_height"),
        DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["height"],
        minimum=0.02,
    )
    box_x_ratio = _clamp_normalized(data.get("document_template_doctor_name_x"), DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["x"])
    box_y_ratio = _clamp_normalized(data.get("document_template_doctor_name_y"), DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["y"])
    box_width_ratio = min(box_width_ratio, 1.0 - box_x_ratio)
    box_height_ratio = min(box_height_ratio, 1.0 - box_y_ratio)

    x = box_x_ratio * width
    box_width = max(box_width_ratio * width, 12.0)
    box_height = max(box_height_ratio * height, 12.0)
    y = height - ((box_y_ratio * height) + box_height)
    font_size = max(8.0, min(12.0, box_height * 0.45))
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.setFont("Helvetica-Bold", font_size)
    pdf.drawString(x, y + max((box_height - font_size) / 2, 0), doctor_name[:80])


def _template_box_to_pdf_rect(box: dict[str, Any], *, width: float, height: float) -> tuple[float, float, float, float]:
    box_width_ratio = _clamp_normalized(box.get("width"), 0.2, minimum=0.02)
    box_height_ratio = _clamp_normalized(box.get("height"), 0.04, minimum=0.02)
    box_x_ratio = _clamp_normalized(box.get("x"), 0.0)
    box_y_ratio = _clamp_normalized(box.get("y"), 0.0)
    box_width_ratio = min(box_width_ratio, 1.0 - box_x_ratio)
    box_height_ratio = min(box_height_ratio, 1.0 - box_y_ratio)
    box_width = max(box_width_ratio * width, 12.0)
    box_height = max(box_height_ratio * height, 12.0)
    x = box_x_ratio * width
    y = height - ((box_y_ratio * height) + box_height)
    return x, y, box_width, box_height


def _template_group_to_pdf_rect(
    layout: dict[str, dict[str, float]],
    keys: list[str],
    *,
    width: float,
    height: float,
) -> tuple[float, float, float, float]:
    rects = [
        _template_box_to_pdf_rect(layout.get(key) or DEFAULT_TEMPLATE_NOTE_LAYOUT[key], width=width, height=height)
        for key in keys
    ]
    left = min(rect[0] for rect in rects)
    bottom = min(rect[1] for rect in rects)
    right = max(rect[0] + rect[2] for rect in rects)
    top = max(rect[1] + rect[3] for rect in rects)
    return left, bottom, right - left, top - bottom


def _merged_note_layout(data: dict[str, Any]) -> dict[str, dict[str, float]]:
    raw_layout = data.get("document_template_note_layout") or {}
    if not isinstance(raw_layout, dict):
        raw_layout = {}
    merged = {key: value.copy() for key, value in DEFAULT_TEMPLATE_NOTE_LAYOUT.items()}
    for key, value in raw_layout.items():
        if isinstance(value, dict) and key in merged:
            merged[key] = {**merged[key], **value}
    return merged


def _draw_template_label_value_group(
    pdf: canvas.Canvas,
    *,
    x: float,
    y: float,
    box_width: float,
    box_height: float,
    items: list[tuple[str, Any]],
    font_size: float = 10,
) -> None:
    line_height = font_size + 4
    current_y = y + box_height - font_size - 2
    available_width = max(box_width - 4, 24)
    pdf.setFillColor(HexColor("#111827"))

    for label, value in items:
        value_text = str(value or "").strip()
        if not value_text:
            continue
        if current_y < y + 2:
            break

        label_text = f"{label}:"
        label_width = stringWidth(label_text + " ", "Helvetica-Bold", font_size)
        first_line_width = max(available_width - label_width, 24)
        value_lines = _wrap_text(value_text, "Helvetica", font_size, first_line_width)
        if not value_lines:
            continue

        pdf.setFont("Helvetica-Bold", font_size)
        pdf.drawString(x + 2, current_y, label_text)
        pdf.setFont("Helvetica", font_size)
        pdf.drawString(x + 2 + label_width, current_y, value_lines[0])
        current_y -= line_height

        for line in value_lines[1:]:
            if current_y < y + 2:
                break
            pdf.drawString(x + 2 + label_width, current_y, line)
            current_y -= line_height


def _draw_template_note_preview_text(
    pdf: canvas.Canvas,
    *,
    width: float,
    height: float,
    layout: dict[str, dict[str, float]],
) -> None:
    header_samples = {
        "name": ("Name", "Sample Patient"),
        "weight": ("Weight", "68 kg"),
        "date": ("Date", "Jul 23, 2026"),
        "age": ("Age", "34 yrs"),
        "temp": ("Temp", "98.4 F"),
        "height": ("Height", "172 cm"),
    }
    note_sections = [
        (
            "Presenting Complaint",
            "Patient reports gradual blurring of distance vision over the last 3 months, "
            "intermittent frontal headache after prolonged screen use, mild watering in the evening, and difficulty "
            "reading small text during night driving.",
        ),
        (
            "Clinical Notes",
            "Visual acuity assessed with and without correction. Patient is comfortable during "
            "examination. Anterior segment appears quiet. Pupils are equal and reactive. Extraocular movements are full. "
            "No acute symptoms reported during today's visit.",
        ),
        ("Diagnosis", "Myopic astigmatism with accommodative eye strain related to prolonged near work."),
        (
            "Treatment",
            "Updated spectacle prescription explained. Discussed visual hygiene, ergonomic screen distance, "
            "adequate lighting, and avoiding continuous near work without breaks.",
        ),
        ("Follow-up Advice", "Routine review in 6 months, earlier if headaches persist after new spectacles."),
    ]
    pdf.setFillColor(HexColor("#111827"))
    header_groups = [
        ["name", "age", "height"],
        ["weight", "temp"],
        ["date"],
    ]
    for keys in header_groups:
        x, y, box_width, box_height = _template_group_to_pdf_rect(layout, keys, width=width, height=height)
        _draw_template_label_value_group(
            pdf,
            x=x,
            y=y,
            box_width=box_width,
            box_height=box_height,
            items=[header_samples[key] for key in keys],
            font_size=10,
        )

    body_box = layout.get("noteBody") or DEFAULT_TEMPLATE_NOTE_LAYOUT["noteBody"]
    x, y, box_width, box_height = _template_box_to_pdf_rect(body_box, width=width, height=height)
    font_size = 9
    line_height = font_size + 3
    section_gap = 14
    current_y = y + box_height - font_size - 2
    for label, content in note_sections:
        label_text = f"{label}:"
        available_width = max(box_width - 4, 24)
        first_line_width = max(available_width - stringWidth(label_text + " ", "Helvetica-Bold", font_size), 24)
        content_lines = _wrap_text(content, "Helvetica", font_size, first_line_width)
        continuation_lines: list[str] = []
        if content_lines:
            first_content_line = content_lines[0]
            for extra_line in content_lines[1:]:
                continuation_lines.extend(_wrap_text(extra_line, "Helvetica", font_size, available_width))
        else:
            first_content_line = ""
        if current_y < y + 2:
            break
        pdf.setFont("Helvetica-Bold", font_size)
        pdf.drawString(x + 2, current_y, label_text)
        pdf.setFont("Helvetica", font_size)
        pdf.drawString(x + 2 + stringWidth(label_text + " ", "Helvetica-Bold", font_size), current_y, first_content_line)
        current_y -= line_height
        for line in continuation_lines:
            if current_y < y + 2:
                break
            pdf.drawString(x + 2, current_y, line)
            current_y -= line_height
        current_y -= section_gap


def _draw_template_label_value_box(
    pdf: canvas.Canvas,
    *,
    width: float,
    height: float,
    box: dict[str, float],
    label: str,
    value: Any,
    font_size: float = 10,
) -> None:
    value_text = str(value or "").strip()
    if not value_text:
        return

    x, y, box_width, box_height = _template_box_to_pdf_rect(box, width=width, height=height)
    label_text = f"{label}:"
    available_width = max(box_width - 4, 24)
    label_width = stringWidth(label_text + " ", "Helvetica-Bold", font_size)
    first_line_width = max(available_width - label_width, 24)
    value_lines = _wrap_text(value_text, "Helvetica", font_size, first_line_width)
    if not value_lines:
        return

    line_height = font_size + 3
    current_y = y + box_height - font_size - 2
    if current_y < y + 2:
        return

    pdf.setFillColor(HexColor("#111827"))
    pdf.setFont("Helvetica-Bold", font_size)
    pdf.drawString(x + 2, current_y, label_text)
    pdf.setFont("Helvetica", font_size)
    pdf.drawString(x + 2 + label_width, current_y, value_lines[0])
    current_y -= line_height

    for line in value_lines[1:]:
        if current_y < y + 2:
            break
        pdf.drawString(x + 2, current_y, line)
        current_y -= line_height


def _template_note_header_values(patient: dict[str, Any], generated_on: str) -> dict[str, tuple[str, Any]]:
    return {
        "name": ("Name", patient.get("name") or "Not recorded"),
        "weight": ("Weight", f"{patient['weight']} kg" if patient.get("weight") is not None else ""),
        "date": ("Date", generated_on.strip()),
        "age": ("Age", patient.get("age") if patient.get("age") is not None else ""),
        "temp": ("Temp", f"{patient['temperature']} F" if patient.get("temperature") is not None else ""),
        "height": ("Height", f"{patient['height']} cm" if patient.get("height") is not None else ""),
    }


def _draw_template_note_headers(
    pdf: canvas.Canvas,
    *,
    patient: dict[str, Any],
    generated_on: str,
    width: float,
    height: float,
    layout: dict[str, dict[str, float]],
) -> None:
    values = _template_note_header_values(patient, generated_on)
    header_groups = [
        ["name", "age", "height"],
        ["weight", "temp"],
        ["date"],
    ]
    for keys in header_groups:
        x, y, box_width, box_height = _template_group_to_pdf_rect(layout, keys, width=width, height=height)
        _draw_template_label_value_group(
            pdf,
            x=x,
            y=y,
            box_width=box_width,
            box_height=box_height,
            items=[values[key] for key in keys],
            font_size=10,
        )


def _draw_template_note_body(
    pdf: canvas.Canvas,
    *,
    template: tuple[str, bytes] | None,
    width: float,
    height: float,
    layout: dict[str, dict[str, float]],
    data: dict[str, Any],
    note_sections: list[tuple[str, str]],
) -> None:
    body_box = layout.get("noteBody") or DEFAULT_TEMPLATE_NOTE_LAYOUT["noteBody"]
    x, y, box_width, box_height = _template_box_to_pdf_rect(body_box, width=width, height=height)
    font_size = 10
    line_height = font_size + 4
    section_gap = 14
    available_width = max(box_width - 4, 24)
    body_floor = y + 2
    reserved_boxes = []
    if data.get("doctor_signature_content_type") and data.get("doctor_signature_data_base64"):
        reserved_boxes.append(
            {
                "x": data.get("document_template_signature_x", DEFAULT_TEMPLATE_SIGNATURE_BOX["x"]),
                "y": data.get("document_template_signature_y", DEFAULT_TEMPLATE_SIGNATURE_BOX["y"]),
                "width": data.get("document_template_signature_width", DEFAULT_TEMPLATE_SIGNATURE_BOX["width"]),
                "height": data.get("document_template_signature_height", DEFAULT_TEMPLATE_SIGNATURE_BOX["height"]),
            }
        )
    if str(data.get("doctor_name") or "").strip():
        reserved_boxes.append(
            {
                "x": data.get("document_template_doctor_name_x", DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["x"]),
                "y": data.get("document_template_doctor_name_y", DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["y"]),
                "width": data.get("document_template_doctor_name_width", DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["width"]),
                "height": data.get("document_template_doctor_name_height", DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["height"]),
            }
        )
    for reserved_box in reserved_boxes:
        reserved_x, reserved_y, reserved_width, reserved_height = _template_box_to_pdf_rect(
            reserved_box,
            width=width,
            height=height,
        )
        overlaps_horizontally = reserved_x < x + box_width and reserved_x + reserved_width > x
        overlaps_vertically = reserved_y < y + box_height and reserved_y + reserved_height > y
        if overlaps_horizontally and overlaps_vertically:
            body_floor = max(body_floor, reserved_y + reserved_height + section_gap)
    if body_floor > y + box_height - font_size - line_height:
        body_floor = y + 2
    current_y = y + box_height - font_size - 2

    def ensure_space() -> None:
        nonlocal current_y
        if current_y >= body_floor:
            return
        pdf.showPage()
        _start_page(pdf, template, width, height)
        current_y = y + box_height - font_size - 2

    pdf.setFillColor(HexColor("#111827"))
    for section_label, section_content in note_sections:
        prose_lines, _tables = _split_text_and_tables(section_content)
        paragraphs = [line.strip() for line in prose_lines if line.strip()]
        if not paragraphs:
            continue

        label_text = f"{section_label}:"
        label_width = stringWidth(label_text + " ", "Helvetica-Bold", font_size)
        ensure_space()
        pdf.setFont("Helvetica-Bold", font_size)
        pdf.drawString(x + 2, current_y, label_text)
        pdf.setFont("Helvetica", font_size)

        first_paragraph = paragraphs[0]
        first_line_width = max(available_width - label_width, 24)
        first_lines = _wrap_text_after_label(
            first_paragraph,
            "Helvetica",
            font_size,
            first_line_width,
            available_width,
        )
        if first_lines:
            pdf.drawString(x + 2 + label_width, current_y, first_lines[0])
            current_y -= line_height
            for line in first_lines[1:]:
                ensure_space()
                pdf.drawString(x + 2, current_y, line)
                current_y -= line_height
        else:
            current_y -= line_height

        for paragraph in paragraphs[1:]:
            current_y -= 2
            for line in _wrap_text(paragraph, "Helvetica", font_size, available_width):
                ensure_space()
                pdf.drawString(x + 2, current_y, line)
                current_y -= line_height

        current_y -= section_gap


def _draw_template_note_pdf_content(
    pdf: canvas.Canvas,
    *,
    patient: dict[str, Any],
    generated_on: str,
    note_sections: list[tuple[str, str]],
    template: tuple[str, bytes] | None,
    width: float,
    height: float,
) -> None:
    layout = _merged_note_layout(patient)
    _draw_template_note_headers(
        pdf,
        patient=patient,
        generated_on=generated_on,
        width=width,
        height=height,
        layout=layout,
    )
    _draw_template_note_body(
        pdf,
        template=template,
        width=width,
        height=height,
        layout=layout,
        data=patient,
        note_sections=note_sections,
    )


def build_template_note_preview_pdf(data: dict[str, Any]) -> bytes:
    template = _resolve_uploaded_template(data, "document preview")
    width, height = _page_size_for_template(template)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    pdf.setTitle("Document Template Note Preview")
    _draw_background(pdf, template, width, height)
    _draw_template_note_preview_text(pdf, width=width, height=height, layout=_merged_note_layout(data))
    _draw_template_signature(pdf, data, width=width, height=height)
    _draw_template_doctor_name(pdf, data, width=width, height=height)
    pdf.showPage()
    pdf.save()
    preview_bytes = buffer.getvalue()
    return _apply_pdf_template(preview_bytes, template)


def _draw_document_signature(
    pdf: canvas.Canvas,
    data: dict[str, Any],
    *,
    use_template: bool,
    width: float,
    height: float,
    margin_x: float,
    bottom_limit: float,
    max_width: float,
    y: float,
) -> None:
    if use_template:
        _draw_template_signature(pdf, data, width=width, height=height)
        _draw_template_doctor_name(pdf, data, width=width, height=height)
        return
    _draw_doctor_signature(pdf, data, width=width, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y)


def _template_signature_content_floor(data: dict[str, Any], *, height: float, bottom_limit: float) -> float:
    reserved_tops = [bottom_limit]
    if _resolve_signature(data):
        signature_y = _clamp_normalized(
            data.get("document_template_signature_y"), DEFAULT_TEMPLATE_SIGNATURE_BOX["y"]
        )
        reserved_tops.append(height - (signature_y * height))
    if str(data.get("doctor_name") or "").strip():
        name_y = _clamp_normalized(
            data.get("document_template_doctor_name_y"), DEFAULT_TEMPLATE_DOCTOR_NAME_BOX["y"]
        )
        reserved_tops.append(height - (name_y * height))
    return max(reserved_tops) + 8


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
    "Date",
}

SECTION_ORDER = (
    "Presenting Complaint",
    "Clinical Notes",
    "Diagnosis",
    "Treatment",
    "Medications Prescribed",
    "Follow-up Advice",
)

SECTION_LABELS = set(SECTION_ORDER)


def _normalize_section_candidate(raw_line: str) -> str:
    stripped = raw_line.strip().strip("*").strip()
    while stripped.startswith(("-", "*", "•")):
        stripped = stripped[1:].strip()
    return stripped


def _match_section_label(raw_line: str) -> tuple[str, str] | None:
    stripped = _normalize_section_candidate(raw_line)
    if ":" not in stripped:
        return None
    label, remainder = stripped.split(":", 1)
    normalized_label = label.strip()
    if normalized_label not in SECTION_LABELS:
        return None
    return normalized_label, remainder.strip()


def _extract_note_body(note_content: str) -> str:
    lines = note_content.splitlines()
    for index, line in enumerate(lines):
        if _match_section_label(line):
            return "\n".join(lines[index:]).strip()
    return note_content.strip()


def _parse_note_sections(note_content: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = []
    current_label: str | None = None
    current_lines: list[str] = []

    for raw_line in _extract_note_body(note_content).splitlines():
        matched = _match_section_label(raw_line)
        if matched:
            if current_label is not None:
                sections.append((current_label, current_lines))
            current_label, remainder = matched
            current_lines = [remainder] if remainder else []
            continue
        if current_label is not None:
            current_lines.append(raw_line.rstrip())

    if current_label is not None:
        sections.append((current_label, current_lines))

    ordered_sections: list[tuple[str, str]] = []
    by_label = {label: "\n".join(lines).strip() for label, lines in sections}
    for label in SECTION_ORDER:
        if label in by_label:
            ordered_sections.append((label, by_label[label]))
    return ordered_sections


def _parse_pipe_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.split("|")]


def _is_pipe_separator_row(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(cell and set(cell) <= {"-", ":", " "} for cell in cells)


def _split_text_and_tables(content: str) -> tuple[list[str], list[tuple[list[str], list[list[str]]]]]:
    prose_lines: list[str] = []
    tables: list[tuple[list[str], list[list[str]]]] = []
    lines = content.splitlines()
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if "|" in stripped and index + 1 < len(lines):
            header_cells = _parse_pipe_row(stripped)
            separator_cells = _parse_pipe_row(lines[index + 1].strip())
            if _is_pipe_separator_row(separator_cells) and len(header_cells) == len(separator_cells):
                rows: list[list[str]] = []
                index += 2
                while index < len(lines):
                    candidate = lines[index].strip()
                    if not candidate or "|" not in candidate:
                        break
                    if index + 1 < len(lines):
                        next_candidate = lines[index + 1].strip()
                        parsed_candidate = _parse_pipe_row(candidate)
                        parsed_next = _parse_pipe_row(next_candidate)
                        if _is_pipe_separator_row(parsed_next) and len(parsed_candidate) == len(parsed_next):
                            break
                    rows.append(_parse_pipe_row(candidate))
                    index += 1
                tables.append((header_cells, rows))
                continue
        if stripped in {
            "Vitals Table:",
            "Test Scores:",
            "Eye Exam:",
            "Prescribed medicines:",
            "Contact Lens Assessment:",
            "Contact Lens Order Summary:",
            "Contact Lens Eye Details:",
            "Binocular Vision Overview:",
            "Binocular Vision Convergence:",
            "Binocular Vision Sensory & Plan:",
            "Binocular Vision Assessment:",
            "Low Vision Assessment:",
            "Low Vision Functional & Device Trial:",
            "Low Vision Plan & Support:",
            "Myopia Management:",
        }:
            index += 1
            continue
        prose_lines.append(lines[index].rstrip())
        index += 1
    return prose_lines, tables


def _classify_structured_tables(
    note_sections: list[tuple[str, str]],
) -> tuple[list[list[str]], tuple[list[str], list[list[str]]] | None, tuple[list[str], list[list[str]]] | None]:
    vitals_rows: list[list[str]] = []
    medicines_table: tuple[list[str], list[list[str]]] | None = None
    eye_exam_table: tuple[list[str], list[list[str]]] | None = None

    for section_label, section_content in note_sections:
        if section_label == "Medications Prescribed":
            continue
        _prose_lines, tables = _split_text_and_tables(section_content)
        for header_cells, body_rows in tables:
            normalized_header = [cell.strip().lower() for cell in header_cells]
            if normalized_header == ["measurement", "value"]:
                vitals_rows = body_rows
            elif _is_medicine_table(header_cells):
                medicines_table = (header_cells, body_rows)
            elif normalized_header in (
                ["eye", "sphere", "cylinder", "axis", "vision"],
                ["section", "row", "sphere", "cylinder", "axis", "vision"],
            ):
                eye_exam_table = (header_cells, body_rows)

    return vitals_rows, medicines_table, eye_exam_table


def _is_medicine_table(header_cells: list[str]) -> bool:
    normalized_header = [cell.strip().lower() for cell in header_cells]
    return normalized_header in (
        ["medicine", "quantity", "schedule", "duration", "notes"],
        ["medicine", "strength", "dose", "route", "schedule", "duration", "quantity", "instructions"],
    )


def _draw_vitals_grid(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    max_width: float,
    rows: list[list[str]],
) -> float:
    ordered = []
    preferred = ["Blood Pressure", "Pulse", "SpO2", "Blood Sugar"]
    row_map = {row[0]: row[1] if len(row) > 1 else "-" for row in rows if row}
    for key in preferred:
        if key in row_map:
            ordered.append((key, row_map[key]))
    for row in rows:
        if not row:
            continue
        key = row[0]
        if key not in preferred:
            ordered.append((key, row[1] if len(row) > 1 else "-"))

    if not ordered:
        return y

    cells: list[tuple[str, str]] = ordered[:4]
    while len(cells) < 4:
        cells.append(("-", "-"))

    col_width = max_width / len(cells)
    header_height = 30
    value_height = 42
    current_x = x

    for label, _value in cells:
        pdf.setStrokeColor(HexColor("#111827"))
        pdf.setFillColor(HexColor("#ffffff"))
        pdf.roundRect(current_x, y - header_height, col_width, header_height, 0, fill=1, stroke=1)
        pdf.setFillColor(HexColor("#111827"))
        pdf.setFont("Helvetica-Bold", 11)
        header_lines = _wrap_text(label or "-", "Helvetica-Bold", 11, col_width - 12) or ["-"]
        header_y = y - 18
        for line in header_lines[:2]:
            pdf.drawString(current_x + 6, header_y, line)
            header_y -= 11
        current_x += col_width

    current_x = x
    for _label, value in cells:
        pdf.setStrokeColor(HexColor("#111827"))
        pdf.setFillColor(HexColor("#ffffff"))
        pdf.roundRect(current_x, y - header_height - value_height, col_width, value_height, 0, fill=1, stroke=1)
        pdf.setFillColor(HexColor("#111827"))
        pdf.setFont("Helvetica", 11)
        value_lines = _wrap_text(value or "-", "Helvetica", 11, col_width - 12) or ["-"]
        value_y = y - header_height - 18
        for line in value_lines[:2]:
            pdf.drawString(current_x + 6, value_y, line)
            value_y -= 13
        current_x += col_width

    return y - header_height - value_height - 14


def _build_structured_data_pdf(
    *,
    width: float,
    height: float,
    template: tuple[str, bytes] | None,
    use_template: bool,
    margin_x: float,
    top_y: float,
    max_width: float,
    bottom_limit: float,
    vitals_rows: list[list[str]],
    eye_exam_table: tuple[list[str], list[list[str]]] | None,
    medicines_table: tuple[list[str], list[list[str]]] | None,
) -> bytes | None:
    if not vitals_rows and not medicines_table and not eye_exam_table:
        return None

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))

    def start_structured_page() -> float:
        if use_template:
            _start_page(pdf, template, width, height)
            return _template_content_start_y(top_y, height, "note")
        pdf.setFillColor(HexColor("#1e293b"))
        return height - DEFAULT_MARGIN

    y = start_structured_page()

    if vitals_rows:
        pdf.setFillColor(HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(margin_x, y, "Vitals")
        y -= 18
        y = _draw_vitals_grid(pdf, margin_x, y, max_width, vitals_rows)
        y -= 10

    if eye_exam_table:
        header_cells, body_rows = eye_exam_table
        estimated_rows = max(1, len(body_rows)) + 1
        estimated_height = (estimated_rows * 28) + 40
        if y - estimated_height < bottom_limit:
            pdf.showPage()
            y = start_structured_page()
        pdf.setFillColor(HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(margin_x, y, "Eye Test")
        y -= 18
        y = _draw_pipe_table(
            pdf,
            margin_x,
            y,
            max_width,
            header_cells,
            body_rows,
            bottom_limit=bottom_limit,
            template=template,
            use_template=use_template,
            width=width,
            height=height,
            top_y=top_y,
        )
        y -= 10

    if medicines_table:
        header_cells, body_rows = medicines_table
        estimated_rows = max(1, len(body_rows)) + 1
        estimated_height = (estimated_rows * 28) + 40
        if y - estimated_height < bottom_limit:
            pdf.showPage()
            y = start_structured_page()
        pdf.setFillColor(HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(margin_x, y, "Medicines")
        y -= 18
        y = _draw_pipe_table(
            pdf,
            margin_x,
            y,
            max_width,
            header_cells,
            body_rows,
            bottom_limit=bottom_limit,
            template=template,
            use_template=use_template,
            width=width,
            height=height,
            top_y=top_y,
        )

    pdf.save()
    buffer.seek(0)
    structured_pdf = buffer.getvalue()
    return _apply_pdf_template(structured_pdf, template) if use_template else structured_pdf


def _draw_pipe_table(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    max_width: float,
    header_cells: list[str],
    body_rows: list[list[str]],
    *,
    bottom_limit: float,
    template: tuple[str, bytes] | None,
    use_template: bool,
    width: float,
    height: float,
    top_y: float,
) -> float:
    column_count = max(len(header_cells), *(len(row) for row in body_rows)) if body_rows else len(header_cells)
    if column_count <= 0:
        return y

    rows = [header_cells] + [
        row + [""] * (column_count - len(row))
        for row in body_rows
    ]
    normalized_header = header_cells + [""] * (column_count - len(header_cells))
    rows[0] = normalized_header
    column_width = max_width / column_count
    font_size = 10
    padding_x = 6
    padding_y = 6

    def _new_page(current_y: float) -> float:
        pdf.showPage()
        if use_template:
            _start_page(pdf, template, width, height)
            return _template_content_start_y(top_y, height, "note")
        pdf.setFillColor(HexColor("#1e293b"))
        return height - 0.75 * inch

    for row_index, row in enumerate(rows):
        wrapped_cells = [
            _wrap_text(cell or "-", "Helvetica-Bold" if row_index == 0 else "Helvetica", font_size, column_width - (padding_x * 2)) or ["-"]
            for cell in row
        ]
        row_height = max(len(lines) for lines in wrapped_cells) * 14 + (padding_y * 2)
        if y - row_height < bottom_limit:
            y = _new_page(y)
        current_x = x
        for cell_index, cell_lines in enumerate(wrapped_cells):
            pdf.setStrokeColor(HexColor("#cbd5e1"))
            if row_index == 0:
                pdf.setFillColor(HexColor("#e0f2fe"))
                pdf.roundRect(current_x, y - row_height, column_width, row_height, 0, fill=1, stroke=1)
                pdf.setFillColor(HexColor("#0f172a"))
                pdf.setFont("Helvetica-Bold", font_size)
            else:
                pdf.setFillColor(HexColor("#ffffff"))
                pdf.roundRect(current_x, y - row_height, column_width, row_height, 0, fill=1, stroke=1)
                pdf.setFillColor(HexColor("#1e293b"))
                pdf.setFont("Helvetica", font_size)
            text_y = y - padding_y - 10
            for line in cell_lines:
                pdf.drawString(current_x + padding_x, text_y, line)
                text_y -= 14
            current_x += column_width
        y -= row_height
    return y - 12


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
    gap = 28
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
    return min(left_end_y, right_end_y) - 4


def _build_note_asset_pdf(
    asset: dict[str, Any],
    *,
    index: int,
    width: float,
    height: float,
    template: tuple[str, bytes] | None,
    use_template: bool,
    margin_x: float,
    top_y: float,
    max_width: float,
    bottom_limit: float,
) -> bytes | None:
    content_type = str(asset.get("content_type") or "").strip().lower()
    if not content_type.startswith(SUPPORTED_NOTE_ASSET_IMAGE_PREFIX):
        return None

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    if use_template:
        _start_page(pdf, template, width, height)
        y = _template_content_start_y(top_y, height, "note")
    else:
        y = height - DEFAULT_MARGIN
        pdf.setFillColor(HexColor("#0f172a"))

    asset_kind = str(asset.get("kind") or "attachment").strip().lower()
    asset_title = "Consultation Drawing" if asset_kind == "drawing" else "Consultation Attachment"

    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(margin_x, y, asset_title)
    y -= 24
    y -= 10

    try:
        raw_bytes = base64.b64decode(str(asset.get("data_base64") or ""), validate=True)
    except Exception:
        return None

    image_reader = ImageReader(BytesIO(raw_bytes))
    frame_top = y - 10
    frame_height = max(min(ASSET_PREVIEW_MAX_HEIGHT, frame_top - bottom_limit), 180)
    frame_bottom = max(bottom_limit, frame_top - frame_height)
    pdf.setStrokeColor(HexColor("#dbeafe"))
    pdf.roundRect(margin_x, frame_bottom, max_width, frame_height, 16, fill=0, stroke=1)
    pdf.drawImage(
        image_reader,
        margin_x,
        frame_bottom,
        width=max_width,
        height=frame_height,
        preserveAspectRatio=True,
        mask="auto",
    )

    pdf.save()
    buffer.seek(0)
    asset_pdf = buffer.getvalue()
    return _apply_pdf_template(asset_pdf, template) if use_template else asset_pdf


def _build_note_pdf_attachment_pdf(
    asset: dict[str, Any],
    *,
    index: int,
    width: float,
    height: float,
    template: tuple[str, bytes] | None,
    use_template: bool,
    margin_x: float,
    top_y: float,
    max_width: float,
    bottom_limit: float,
) -> bytes | None:
    content_type = str(asset.get("content_type") or "").strip().lower()
    if content_type != SUPPORTED_NOTE_ASSET_PDF_TYPE or PdfReader is None or PdfWriter is None:
        return None

    try:
        raw_bytes = base64.b64decode(str(asset.get("data_base64") or ""), validate=True)
        validate_pdf_bytes(raw_bytes)
        attachment_reader = PdfReader(BytesIO(raw_bytes))
    except Exception:
        return None
    if not attachment_reader.pages:
        return None

    intro_buffer = BytesIO()
    pdf = canvas.Canvas(intro_buffer, pagesize=(width, height))
    if use_template:
        _start_page(pdf, template, width, height)
        y = _template_content_start_y(top_y, height, "note")
    else:
        y = height - DEFAULT_MARGIN
        pdf.setFillColor(HexColor("#0f172a"))

    asset_name = str(asset.get("name") or f"attachment-{index}.pdf").strip() or f"attachment-{index}.pdf"
    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(margin_x, y, "Consultation Attachment PDF")
    y -= 24
    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(HexColor("#475569"))
    pdf.drawString(margin_x, y, asset_name)
    y -= 18
    pdf.drawString(margin_x, y, f"Attached PDF pages: {len(attachment_reader.pages)}")
    y -= 28
    pdf.setStrokeColor(HexColor("#dbeafe"))
    pdf.roundRect(margin_x, bottom_limit, max_width, max(180, y - bottom_limit), 16, fill=0, stroke=1)
    pdf.setFillColor(HexColor("#1e293b"))
    pdf.setFont("Helvetica", 11)
    pdf.drawString(margin_x + 18, y - 8, "The following pages are part of the uploaded consultation attachment.")
    pdf.save()
    intro_buffer.seek(0)

    intro_pdf = intro_buffer.getvalue()
    intro_pdf = _apply_pdf_template(intro_pdf, template) if use_template else intro_pdf

    writer = PdfWriter()
    intro_reader = PdfReader(BytesIO(intro_pdf))
    for page in intro_reader.pages:
        writer.add_page(page)
    for page in attachment_reader.pages:
        writer.add_page(page)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _build_note_assets_pdf(
    assets: list[dict[str, Any]],
    *,
    width: float,
    height: float,
    template: tuple[str, bytes] | None,
    use_template: bool,
    margin_x: float,
    top_y: float,
    max_width: float,
    bottom_limit: float,
) -> bytes | None:
    if not assets:
        return None

    supported_assets = [
        asset for asset in assets
        if str(asset.get("content_type") or "").strip().lower().startswith(SUPPORTED_NOTE_ASSET_IMAGE_PREFIX)
        or str(asset.get("content_type") or "").strip().lower() == SUPPORTED_NOTE_ASSET_PDF_TYPE
    ]
    if not supported_assets:
        return None
    combined_pdf: bytes | None = None
    for index, asset in enumerate(supported_assets, start=1):
        content_type = str(asset.get("content_type") or "").strip().lower()
        if content_type == SUPPORTED_NOTE_ASSET_PDF_TYPE:
            asset_pdf = _build_note_pdf_attachment_pdf(
                asset,
                index=index,
                width=width,
                height=height,
                template=template,
                use_template=use_template,
                margin_x=margin_x,
                top_y=top_y,
                max_width=max_width,
                bottom_limit=bottom_limit,
            )
        else:
            asset_pdf = _build_note_asset_pdf(
                asset,
                index=index,
                width=width,
                height=height,
                template=template,
                use_template=use_template,
                margin_x=margin_x,
                top_y=top_y,
                max_width=max_width,
                bottom_limit=bottom_limit,
            )
        if not asset_pdf:
            continue
        combined_pdf = asset_pdf if combined_pdf is None else _append_pdf_bytes(combined_pdf, asset_pdf)
    return combined_pdf


def build_note_pdf(patient: dict[str, Any], note_content: str, generated_on: str, assets: list[dict[str, Any]] | None = None) -> bytes:
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
    note_sections = _parse_note_sections(note_content)
    vitals_rows, medicines_table, eye_exam_table = _classify_structured_tables(note_sections)

    if use_template:
        _start_page(pdf, template, width, height)
        _draw_template_note_pdf_content(
            pdf,
            patient=patient,
            generated_on=generated_on,
            note_sections=note_sections,
            template=template,
            width=width,
            height=height,
        )
        _draw_document_signature(
            pdf,
            patient,
            use_template=use_template,
            width=width,
            height=height,
            margin_x=margin_x,
            bottom_limit=bottom_limit,
            max_width=max_width,
            y=bottom_limit,
        )
        pdf.save()
        buffer.seek(0)
        base_pdf = _apply_pdf_template(buffer.getvalue(), template)
        structured_pdf = _build_structured_data_pdf(
            width=width,
            height=height,
            template=template,
            use_template=use_template,
            margin_x=margin_x,
            top_y=top_y,
            max_width=max_width,
            bottom_limit=bottom_limit,
            vitals_rows=vitals_rows,
            eye_exam_table=eye_exam_table,
            medicines_table=medicines_table,
        )
        if structured_pdf:
            base_pdf = _append_pdf_bytes(base_pdf, structured_pdf)
        assets_pdf = _build_note_assets_pdf(
            assets or [],
            width=width,
            height=height,
            template=template,
            use_template=use_template,
            margin_x=margin_x,
            top_y=top_y,
            max_width=max_width,
            bottom_limit=bottom_limit,
        )
        return _append_pdf_bytes(base_pdf, assets_pdf)
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

        y = top_y - (64 if custom_header.strip() else 48)

    detail_lines = [
        ("Name", patient.get("name", "Not recorded")),
        ("Phone", patient.get("phone", "Not recorded")),
    ]
    if generated_on.strip():
        detail_lines.append(("Date", generated_on.strip()))
    if patient.get("age") is not None:
        detail_lines.append(("Age", str(patient["age"])))
    if patient.get("height") is not None:
        detail_lines.append(("Height", f"{patient['height']} cm"))
    if patient.get("weight") is not None:
        detail_lines.append(("Weight", f"{patient['weight']} kg"))
    if patient.get("temperature") is not None:
        detail_lines.append(("Temperature", f"{patient['temperature']} F"))
    if patient.get("reason"):
        detail_lines.append(("Reason for Visit", patient["reason"]))

    for index in range(0, len(detail_lines), 2):
        left = detail_lines[index]
        right = detail_lines[index + 1] if index + 1 < len(detail_lines) else None
        y = _draw_detail_pair_row(pdf, margin_x, y, left, right, max_width)

    y -= 14

    for section_label, section_content in note_sections:
        if y < bottom_limit + 28:
            pdf.showPage()
            if use_template:
                _start_page(pdf, template, width, height)
                y = _template_content_start_y(top_y, height, "note")
            else:
                y = height - 0.75 * inch
                pdf.setFillColor(HexColor("#1e293b"))

        pdf.setFillColor(HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(margin_x, y, f"{section_label}:")
        y -= 22

        prose_lines, tables = _split_text_and_tables(section_content)
        pdf.setFont("Helvetica", 11)
        pdf.setFillColor(HexColor("#1e293b"))

        for raw_line in prose_lines:
            stripped = raw_line.strip()
            if stripped == "":
                y -= 10
                continue
            wrapped_lines = _wrap_text(stripped, "Helvetica", 11, max_width)
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
                y -= 18
            y -= 4

        for header_cells, body_rows in tables:
            if section_label != "Medications Prescribed" or not _is_medicine_table(header_cells):
                continue
            estimated_rows = max(1, len(body_rows)) + 1
            estimated_height = (estimated_rows * 28) + 12
            if y - estimated_height < bottom_limit:
                pdf.showPage()
                if use_template:
                    _start_page(pdf, template, width, height)
                    y = _template_content_start_y(top_y, height, "note")
                else:
                    y = height - 0.75 * inch
            y = _draw_pipe_table(
                pdf,
                margin_x,
                y,
                max_width,
                header_cells,
                body_rows,
                bottom_limit=bottom_limit,
                template=template,
                use_template=use_template,
                width=width,
                height=height,
                top_y=top_y,
            )

        y -= 10

    _draw_document_signature(pdf, patient, use_template=use_template, width=width, height=height, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y)

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
    base_pdf = _apply_pdf_template(buffer.getvalue(), template)
    structured_pdf = _build_structured_data_pdf(
        width=width,
        height=height,
        template=template,
        use_template=use_template,
        margin_x=margin_x,
        top_y=top_y,
        max_width=max_width,
        bottom_limit=bottom_limit,
        vitals_rows=vitals_rows,
        eye_exam_table=eye_exam_table,
        medicines_table=medicines_table,
    )
    if structured_pdf:
        base_pdf = _append_pdf_bytes(base_pdf, structured_pdf)
    assets_pdf = _build_note_assets_pdf(
        assets or [],
        width=width,
        height=height,
        template=template,
        use_template=use_template,
        margin_x=margin_x,
        top_y=top_y,
        max_width=max_width,
        bottom_limit=bottom_limit,
    )
    return _append_pdf_bytes(base_pdf, assets_pdf)


def build_letter_pdf(
    clinic: dict[str, Any],
    letter_content: str,
    generated_on: str,
    *,
    document_title: str = "Clinic Letter",
    show_generated_date: bool = True,
) -> bytes:
    template = _resolve_template(clinic, "letter")
    width, height = _page_size_for_template(template)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    use_template = template is not None
    margin_x, top_y, max_width, bottom_limit = _content_bounds(clinic, use_template, (width, height))
    content_bottom_limit = (
        _template_signature_content_floor(clinic, height=height, bottom_limit=bottom_limit)
        if use_template
        else bottom_limit
    )

    clinic_name = clinic.get("clinic_name", "ClinicOS") or "ClinicOS"
    custom_header = clinic.get("custom_header", "")
    custom_footer = clinic.get("custom_footer", "")
    pdf.setTitle(document_title)

    if use_template:
        _start_page(pdf, template, width, height)
        y = _template_content_start_y(top_y, height, "letter")
    else:
        pdf.setFillColor(HexColor("#0f172a"))
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(margin_x, top_y, clinic_name)

        pdf.setFillColor(HexColor("#475569"))
        pdf.setFont("Helvetica", 10)
        pdf.drawString(margin_x, top_y - 18, document_title)
        if custom_header.strip():
            header_lines = _wrap_text(custom_header.strip(), "Helvetica", 10, max_width)
            header_y = top_y - 32
            for header_line in header_lines[:2]:
                pdf.drawString(margin_x, header_y, header_line)
                header_y -= 12

        if show_generated_date:
            pdf.setFont("Helvetica-Bold", 10)
            generated_label = "Date:"
            label_width = stringWidth(generated_label + " ", "Helvetica-Bold", 10)
            value_width = stringWidth(generated_on, "Helvetica", 10)
            right_x = width - margin_x - label_width - value_width
            pdf.setFillColor(HexColor("#1e293b"))
            pdf.drawString(right_x, top_y, generated_label)
            pdf.setFont("Helvetica", 10)
            pdf.drawString(right_x + label_width, top_y, generated_on)

        y = top_y - (78 if custom_header.strip() else 52)

    pdf.setFont("Helvetica", 11)
    pdf.setFillColor(HexColor("#1e293b"))

    for raw_line in letter_content.splitlines():
        stripped = raw_line.strip()
        if stripped == "":
            y -= 10
            continue

        if ":" in stripped:
            label, value = stripped.split(":", 1)
            if label.strip() in {"Date", "From", "To", "Subject"}:
                y = _draw_label_value_line(pdf, margin_x, y, label.strip(), value.strip(), max_width)
                continue

        wrapped_lines = _wrap_text(stripped, "Helvetica", 11, max_width)
        for wrapped in wrapped_lines:
            if y < content_bottom_limit:
                pdf.showPage()
                if use_template:
                    _start_page(pdf, template, width, height)
                    y = _template_content_start_y(top_y, height, "letter")
                else:
                    y = height - 0.75 * inch
                    pdf.setFont("Helvetica", 11)
                    pdf.setFillColor(HexColor("#1e293b"))
            pdf.drawString(margin_x, y, wrapped)
            y -= 18

        y -= 4

    _draw_document_signature(pdf, clinic, use_template=use_template, width=width, height=height, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y - 8)

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


def build_case_study_pdf(clinic: dict[str, Any], title: str, case_study_content: str, generated_on: str) -> bytes:
    width, height = A4
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    margin_x = 0.8 * inch
    top_y = height - 0.8 * inch
    max_width = width - (margin_x * 2)
    bottom_limit = 0.85 * inch

    clinic_name = str(clinic.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    pdf.setTitle(title.strip() or "Case Study")
    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(margin_x, top_y, clinic_name)
    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(HexColor("#475569"))
    pdf.drawString(margin_x, top_y - 16, "Case Study")
    generated_label = f"Generated on {generated_on}"
    generated_width = stringWidth(generated_label, "Helvetica", 10)
    pdf.drawString(width - margin_x - generated_width, top_y - 16, generated_label)
    y = top_y - 42

    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 16)
    title_lines = _wrap_text(title.strip() or "Case Study", "Helvetica-Bold", 16, max_width)
    for line in title_lines[:3]:
        if y < bottom_limit:
            pdf.showPage()
            y = height - 0.85 * inch
            pdf.setFillColor(HexColor("#0f172a"))
            pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(margin_x, y, line)
        y -= 22

    y -= 6
    pdf.setStrokeColor(HexColor("#cbd5e1"))
    pdf.line(margin_x, y, width - margin_x, y)
    y -= 18
    pdf.setFillColor(HexColor("#1e293b"))

    content_lines = case_study_content.splitlines()
    if content_lines:
        first_non_empty = next((line.strip() for line in content_lines if line.strip()), "")
        if first_non_empty.startswith("Title:"):
            trimmed_lines: list[str] = []
            skipped_title_heading = False
            skipped_title_body = False
            for raw_line in content_lines:
                stripped = raw_line.strip()
                if not skipped_title_heading and stripped.startswith("Title:"):
                    skipped_title_heading = True
                    title_remainder = stripped.split(":", 1)[1].strip()
                    if title_remainder:
                        skipped_title_body = True
                    continue
                if skipped_title_heading and not skipped_title_body:
                    if not stripped:
                        continue
                    skipped_title_body = True
                    continue
                trimmed_lines.append(raw_line)
            content_lines = trimmed_lines

    for raw_line in content_lines:
        stripped = raw_line.strip()
        if not stripped:
            y -= 10
            continue

        is_heading = stripped.endswith(":") and len(stripped) < 40
        font_name = "Helvetica-Bold" if is_heading else "Helvetica"
        font_size = 12 if is_heading else 11
        leading = 18 if is_heading else 16
        pdf.setFont(font_name, font_size)
        wrapped_lines = _wrap_text(stripped, font_name, font_size, max_width)
        for wrapped in wrapped_lines:
            if y < bottom_limit:
                pdf.showPage()
                y = height - 0.85 * inch
                pdf.setFillColor(HexColor("#1e293b"))
                pdf.setFont(font_name, font_size)
            pdf.drawString(margin_x, y, wrapped)
            y -= leading
        y -= 4

    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


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

        y = top_y - (66 if custom_header.strip() else 48)

    details = [
        ("Patient", patient.get("name", "Not recorded")),
        ("Phone", patient.get("phone", "Not recorded")),
        ("GSTIN", invoice.get("supplier_gstin") or clinic.get("gstin") or "Not configured"),
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

    y -= 14
    pdf.setFillColor(HexColor("#e0f2fe"))
    pdf.roundRect(margin_x, y - 24, max_width, 24, 8, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin_x + 10, y - 16, "Item")
    pdf.drawString(margin_x + max_width - 170, y - 16, "Qty")
    pdf.drawString(margin_x + max_width - 110, y - 16, "Price")
    pdf.drawString(margin_x + max_width - 50, y - 16, "Total")
    y -= 40

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
        if item.get("hsn_sac_code") and item.get("gst_rate") is not None:
            pdf.setFont("Helvetica", 8)
            pdf.setFillColor(HexColor("#64748b"))
            code_label = "SAC" if item.get("item_type") == "service" else "HSN"
            pdf.drawString(
                margin_x + 10,
                y - 12,
                f"{code_label} {item.get('hsn_sac_code')} | GST {float(item.get('gst_rate', 0)):g}%",
            )
            pdf.setFont("Helvetica", 10)
            pdf.setFillColor(HexColor("#1e293b"))
            y -= 32
        else:
            y -= 22

    y -= 14
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawRightString(margin_x + max_width - 80, y, "Subtotal")
    pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('subtotal', 0)):.2f}")
    if float(invoice.get("tax_total", 0) or 0) > 0:
        y -= 18
        pdf.setFont("Helvetica", 10)
        pdf.drawRightString(margin_x + max_width - 80, y, "CGST")
        pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('cgst_total', 0)):.2f}")
        y -= 18
        pdf.drawRightString(margin_x + max_width - 80, y, "SGST")
        pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('sgst_total', 0)):.2f}")
        y -= 18
        pdf.drawRightString(margin_x + max_width - 80, y, "Total GST")
        pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('tax_total', 0)):.2f}")
    y -= 22
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawRightString(margin_x + max_width - 80, y, "Total")
    pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('total', 0)):.2f}")

    _draw_document_signature(pdf, clinic, use_template=use_template, width=width, height=height, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y - 28)

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
