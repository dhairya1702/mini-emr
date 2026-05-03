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
ASSET_PREVIEW_MAX_HEIGHT = 7.0 * inch
SUPPORTED_NOTE_ASSET_IMAGE_PREFIX = "image/"
SUPPORTED_NOTE_ASSET_PDF_TYPE = "application/pdf"


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
    for label in ("Presenting Complaint", "Diagnosis", "Clinical Notes", "Treatment", "Follow-up Advice"):
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

    for _section_label, section_content in note_sections:
        _prose_lines, tables = _split_text_and_tables(section_content)
        for header_cells, body_rows in tables:
            normalized_header = [cell.strip().lower() for cell in header_cells]
            if normalized_header == ["measurement", "value"]:
                vitals_rows = body_rows
            elif normalized_header == ["medicine", "quantity", "schedule", "duration", "notes"]:
                medicines_table = (header_cells, body_rows)
            elif normalized_header == ["eye", "sphere", "cylinder", "axis", "vision"]:
                eye_exam_table = (header_cells, body_rows)

    return vitals_rows, medicines_table, eye_exam_table


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

        y = top_y - (64 if custom_header.strip() else 48)

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

    y -= 14
    note_sections = _parse_note_sections(note_content)
    vitals_rows, medicines_table, eye_exam_table = _classify_structured_tables(note_sections)

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

        prose_lines, _tables = _split_text_and_tables(section_content)
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

        y -= 10

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
            y -= 18

        y -= 4

    _draw_doctor_signature(pdf, clinic, width=width, margin_x=margin_x, bottom_limit=bottom_limit, max_width=max_width, y=y - 8)

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
        y -= 22

    y -= 14
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawRightString(margin_x + max_width - 80, y, "Subtotal")
    pdf.drawRightString(margin_x + max_width - 10, y, f"{float(invoice.get('subtotal', 0)):.2f}")
    y -= 22
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
