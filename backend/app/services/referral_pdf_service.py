from __future__ import annotations

from io import BytesIO
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

try:
    from pypdf import PdfReader, PdfWriter
except Exception:  # pragma: no cover
    PdfReader = None
    PdfWriter = None


MARGIN = 0.65 * inch
BODY_FONT = "Helvetica"
BOLD_FONT = "Helvetica-Bold"


def _plain(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return " ".join(str(value).split())


def _label(value: str) -> str:
    return str(value or "").replace("_", " ").strip().title()


def _wrapped(text: str, font: str, size: float, width: float) -> list[str]:
    words = _plain(text).split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


class _ReferralCanvas:
    def __init__(self) -> None:
        self.output = BytesIO()
        self.width, self.height = A4
        self.drawing = canvas.Canvas(self.output, pagesize=A4)
        self.y = self.height - MARGIN
        self.page_count = 1

    def new_page(self) -> None:
        self.drawing.showPage()
        self.page_count += 1
        self.y = self.height - MARGIN

    def ensure(self, height: float) -> None:
        if self.y - height < MARGIN:
            self.new_page()

    def heading(self, text: str, *, title: bool = False) -> None:
        size = 18 if title else 12
        gap = 26 if title else 19
        self.ensure(gap + 8)
        self.drawing.setFillColor(HexColor("#17324D"))
        self.drawing.setFont(BOLD_FONT, size)
        self.drawing.drawString(MARGIN, self.y, _plain(text))
        self.y -= gap

    def line(self, label: str, value: Any, *, indent: float = 0) -> None:
        text = _plain(value)
        if not text:
            return
        left = MARGIN + indent
        label_width = 1.7 * inch
        value_width = self.width - MARGIN - left - label_width
        lines = _wrapped(text, BODY_FONT, 8.5, value_width)
        height = max(15, len(lines) * 11 + 4)
        self.ensure(height)
        self.drawing.setFillColor(HexColor("#354A5F"))
        self.drawing.setFont(BOLD_FONT, 8.5)
        self.drawing.drawString(left, self.y, _plain(label))
        self.drawing.setFillColor(HexColor("#17212B"))
        self.drawing.setFont(BODY_FONT, 8.5)
        line_y = self.y
        for line in lines:
            self.drawing.drawString(left + label_width, line_y, line)
            line_y -= 11
        self.y -= height

    def paragraph(self, value: Any) -> None:
        text = _plain(value)
        if not text:
            return
        for line in _wrapped(text, BODY_FONT, 8.5, self.width - 2 * MARGIN):
            self.ensure(12)
            self.drawing.setFillColor(HexColor("#17212B"))
            self.drawing.setFont(BODY_FONT, 8.5)
            self.drawing.drawString(MARGIN, self.y, line)
            self.y -= 11
        self.y -= 3

    def finish(self) -> bytes:
        self.drawing.save()
        return self.output.getvalue()


def _draw_payload(writer: _ReferralCanvas, value: Any, *, depth: int = 0) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if child in (None, "", [], {}):
                continue
            if isinstance(child, (dict, list)):
                writer.heading(_label(key))
                _draw_payload(writer, child, depth=depth + 1)
            else:
                writer.line(_label(key), child, indent=min(depth, 2) * 8)
    elif isinstance(value, list):
        for index, child in enumerate(value, 1):
            if isinstance(child, (dict, list)):
                writer.line("Entry", index, indent=min(depth, 2) * 8)
                _draw_payload(writer, child, depth=depth + 1)
            else:
                writer.paragraph(f"- {_plain(child)}")
    else:
        writer.paragraph(value)


def _base_referral_pdf(snapshot: dict[str, Any]) -> tuple[bytes, int]:
    writer = _ReferralCanvas()
    writer.heading("Clinical Referral Package", title=True)
    clinic = snapshot.get("clinic") or {}
    patient = snapshot.get("patient") or {}
    referral = snapshot.get("referral") or {}
    writer.line("Clinic", clinic.get("clinic_name") or "ClinicOS")
    writer.line("Referring Doctor", clinic.get("doctor_name"))
    writer.line("Patient", patient.get("name"))
    writer.line("Phone", patient.get("phone"))
    writer.line("Email", patient.get("email"))
    writer.line("Date Of Birth", patient.get("date_of_birth"))
    writer.line("Age", patient.get("age"))
    writer.line("Sex", patient.get("sex_at_birth"))
    writer.line("Generated On", snapshot.get("generated_at"))
    writer.heading("Referral Details")
    _draw_payload(writer, referral)
    history = snapshot.get("patient_history") or {}
    if history:
        writer.heading("Relevant Patient History")
        _draw_payload(writer, history)
    for record in snapshot.get("records") or []:
        writer.new_page()
        writer.heading(str(record.get("title") or "Clinical Record"), title=True)
        writer.line("Record Type", record.get("record_type"))
        writer.line("Date", record.get("date"))
        writer.line("Status", record.get("status"))
        for paragraph in str(record.get("content") or "").splitlines():
            writer.paragraph(paragraph)
        if record.get("payload"):
            _draw_payload(writer, record["payload"])
    return writer.finish(), writer.page_count


def _image_pdf(raw_bytes: bytes) -> bytes:
    output = BytesIO()
    page_width, page_height = A4
    drawing = canvas.Canvas(output, pagesize=A4)
    reader = ImageReader(BytesIO(raw_bytes))
    width, height = reader.getSize()
    max_width, max_height = page_width - inch, page_height - inch
    scale = min(max_width / width, max_height / height, 1.0)
    draw_width, draw_height = width * scale, height * scale
    drawing.drawImage(reader, (page_width - draw_width) / 2, (page_height - draw_height) / 2, draw_width, draw_height, preserveAspectRatio=True)
    drawing.save()
    return output.getvalue()


def build_referral_package_pdf(
    snapshot: dict[str, Any], attachments: list[tuple[str, str, bytes]]
) -> tuple[bytes, int]:
    base_pdf, base_page_count = _base_referral_pdf(snapshot)
    if PdfReader is None or PdfWriter is None:
        if attachments:
            raise ValueError("PDF merging support is unavailable.")
        return base_pdf, base_page_count
    pdf_writer = PdfWriter()
    try:
        for page in PdfReader(BytesIO(base_pdf)).pages:
            pdf_writer.add_page(page)
    except Exception:
        if not attachments:  # test environments may stub ReportLab output
            return base_pdf, base_page_count
        raise
    for file_name, content_type, raw_bytes in attachments:
        if content_type == "application/pdf":
            source = raw_bytes
        elif content_type.startswith("image/"):
            try:
                source = _image_pdf(raw_bytes)
            except Exception as exc:
                raise ValueError(f"Attachment '{file_name}' could not be rendered in the referral PDF.") from exc
        else:
            raise ValueError(f"Attachment '{file_name}' cannot be embedded in a referral PDF.")
        try:
            for page in PdfReader(BytesIO(source)).pages:
                pdf_writer.add_page(page)
        except Exception as exc:
            raise ValueError(f"Attachment '{file_name}' is not a readable PDF or image.") from exc
    output = BytesIO()
    pdf_writer.write(output)
    return output.getvalue(), len(pdf_writer.pages)
