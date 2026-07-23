import sys
from base64 import b64encode
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import test_app  # noqa: F401

from app.services import pdf_service
from app.services.pdf_service import _classify_structured_tables, _extract_note_body, _parse_note_sections, _template_content_start_y, build_note_pdf


class _RecordingCanvas:
    def __init__(self, buffer, *_args, **_kwargs) -> None:
        self.buffer = buffer

    def setTitle(self, *_args, **_kwargs) -> None:
        pass

    def setFillColor(self, *_args, **_kwargs) -> None:
        pass

    def setFont(self, *_args, **_kwargs) -> None:
        pass

    def drawString(self, *_args, **_kwargs) -> None:
        pass

    def drawRightString(self, *_args, **_kwargs) -> None:
        pass

    def line(self, *_args, **_kwargs) -> None:
        pass

    def roundRect(self, *_args, **_kwargs) -> None:
        pass

    def setStrokeColor(self, *_args, **_kwargs) -> None:
        pass

    def drawImage(self, *_args, **_kwargs) -> None:
        pass

    def showPage(self) -> None:
        pass

    def save(self) -> None:
        self.buffer.write(b"canvas-pdf")


class _TemplateLayoutCanvas:
    last_instance = None

    def __init__(self, buffer, *_args, **_kwargs) -> None:
        self.buffer = buffer
        self.strings: list[tuple[float, float, str]] = []
        self.page_breaks = 0
        _TemplateLayoutCanvas.last_instance = self

    def setTitle(self, *_args, **_kwargs) -> None:
        pass

    def setFillColor(self, *_args, **_kwargs) -> None:
        pass

    def setFont(self, *_args, **_kwargs) -> None:
        pass

    def drawString(self, x, y, text, *_args, **_kwargs) -> None:
        self.strings.append((x, y, text))

    def showPage(self) -> None:
        self.page_breaks += 1

    def save(self) -> None:
        self.buffer.write(b"canvas-pdf")


class _SignatureCanvas:
    def __init__(self) -> None:
        self.images: list[tuple[float, float, float, float]] = []
        self.strings: list[tuple[float, float, str]] = []

    def setFillColor(self, *_args, **_kwargs) -> None:
        pass

    def setFont(self, *_args, **_kwargs) -> None:
        pass

    def drawImage(self, _image, x, y, *, width, height, **_kwargs) -> None:
        self.images.append((x, y, width, height))

    def drawString(self, x, y, text, *_args, **_kwargs) -> None:
        self.strings.append((x, y, text))


def test_template_content_start_y_uses_safer_default_clearance_for_note_templates() -> None:
    page_height = 842.0
    configured_top_y = page_height - 54.0

    start_y = _template_content_start_y(configured_top_y, page_height, "note")

    assert start_y < configured_top_y
    assert round(start_y, 1) == round(page_height - (2.6 * 72), 1)


def test_template_content_start_y_honors_more_conservative_user_margin() -> None:
    page_height = 842.0
    configured_top_y = page_height - 240.0

    start_y = _template_content_start_y(configured_top_y, page_height, "note")

    assert start_y == configured_top_y


def test_template_signature_uses_saved_normalized_box() -> None:
    pdf = _SignatureCanvas()
    data = {
        "doctor_signature_content_type": "image/png",
        "doctor_signature_data_base64": b64encode(b"signature").decode("ascii"),
        "document_template_signature_x": 0.5,
        "document_template_signature_y": 0.75,
        "document_template_signature_width": 0.2,
        "document_template_signature_height": 0.1,
    }

    pdf_service._draw_template_signature(pdf, data, width=600.0, height=800.0)  # type: ignore[arg-type]

    assert pdf.images == [(300.0, 120.0, 120.0, 80.0)]


def test_template_doctor_name_uses_saved_normalized_box() -> None:
    pdf = _SignatureCanvas()
    data = {
        "doctor_name": "Dr Template",
        "document_template_doctor_name_x": 0.5,
        "document_template_doctor_name_y": 0.85,
        "document_template_doctor_name_width": 0.2,
        "document_template_doctor_name_height": 0.05,
    }

    pdf_service._draw_template_doctor_name(pdf, data, width=600.0, height=800.0)  # type: ignore[arg-type]

    assert pdf.strings == [(300.0, 94.0, "Dr Template")]


def test_extract_note_body_accepts_section_labels_with_space_before_colon() -> None:
    note_content = (
        "Name: Test Patient\n"
        "Phone: 1234567890\n"
        "Follow-up sentence that should not stay in the header.\n\n"
        "Presenting Complaint :\n"
        "Fever for 5 days.\n"
    )

    extracted = _extract_note_body(note_content)

    assert extracted.startswith("Presenting Complaint :")
    assert "Follow-up sentence" not in extracted


def test_classify_structured_tables_reads_vitals_and_medicines_from_sections() -> None:
    note_content = (
        "Presenting Complaint:\nFever.\n\n"
        "Clinical Notes:\nMeasurement | Value\n--- | ---\nBlood Pressure | 120/80 mmHg\nPulse | 71 bpm\nSpO2 | 98%\nBlood Sugar | 110.0\nEye | Sphere | Cylinder | Axis | Vision\n--- | --- | --- | --- | ---\nRight | -1.25 | -0.50 | 90 | 6/6\nLeft | -1.00 | -0.25 | 85 | 6/6\n\n"
        "Treatment:\nMedicine | Quantity | Schedule | Duration | Notes\n--- | --- | --- | --- | ---\ndolo | 1 | Morning, Night | 5 | -\n"
    )

    note_sections = _parse_note_sections(note_content)
    vitals_rows, medicines_table, eye_exam_table = _classify_structured_tables(note_sections)

    assert len(vitals_rows) == 4
    assert medicines_table is not None
    assert medicines_table[0] == ["Medicine", "Quantity", "Schedule", "Duration", "Notes"]
    assert eye_exam_table is not None
    assert eye_exam_table[0] == ["Eye", "Sphere", "Cylinder", "Axis", "Vision"]


def test_parse_note_sections_uses_clinical_flow_order_with_medications_before_follow_up() -> None:
    note_content = (
        "Presenting Complaint:\nFever.\n\n"
        "Diagnosis:\nViral fever.\n\n"
        "Clinical Notes:\nTemperature reviewed.\n\n"
        "Treatment:\nSupportive care.\n\n"
        "Follow-up Advice:\nReview in 3 days.\n\n"
        "Medications Prescribed:\n"
        "Medicine | Strength | Dose | Route | Schedule | Duration | Quantity | Instructions\n"
        "--- | --- | --- | --- | --- | --- | --- | ---\n"
        "Paracetamol | 500 mg | 1 tablet | oral | twice daily | 3 days | 6 | after food"
    )

    labels = [label for label, _content in _parse_note_sections(note_content)]

    assert labels == [
        "Presenting Complaint",
        "Clinical Notes",
        "Diagnosis",
        "Treatment",
        "Medications Prescribed",
        "Follow-up Advice",
    ]


def test_note_image_asset_page_gets_template_applied_locally(monkeypatch) -> None:
    monkeypatch.setattr(pdf_service.canvas, "Canvas", _RecordingCanvas)
    monkeypatch.setattr(pdf_service, "_start_page", lambda *args, **kwargs: None)
    monkeypatch.setattr(pdf_service, "_template_content_start_y", lambda *_args, **_kwargs: 700.0)

    applied: list[tuple[bytes, tuple[str, bytes] | None]] = []

    def fake_apply_pdf_template(raw: bytes, template: tuple[str, bytes] | None) -> bytes:
        applied.append((raw, template))
        return b"templated-asset"

    monkeypatch.setattr(pdf_service, "_apply_pdf_template", fake_apply_pdf_template)

    result = pdf_service._build_note_asset_pdf(
        {
            "id": "drawing-1",
            "kind": "drawing",
            "name": "consultation-drawing.png",
            "content_type": "image/png",
            "data_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnM6tAAAAAASUVORK5CYII=",
        },
        index=1,
        width=595.0,
        height=842.0,
        template=("application/pdf", b"template"),
        use_template=True,
        margin_x=54.0,
        top_y=788.0,
        max_width=487.0,
        bottom_limit=54.0,
    )

    assert result == b"templated-asset"
    assert applied == [(b"canvas-pdf", ("application/pdf", b"template"))]


def test_build_note_pdf_does_not_template_merge_combined_assets_bundle(monkeypatch) -> None:
    monkeypatch.setattr(pdf_service.canvas, "Canvas", _RecordingCanvas)
    monkeypatch.setattr(pdf_service, "_resolve_template", lambda *_args, **_kwargs: ("application/pdf", b"template"))
    monkeypatch.setattr(pdf_service, "_page_size_for_template", lambda *_args, **_kwargs: (595.0, 842.0))
    monkeypatch.setattr(pdf_service, "_content_bounds", lambda *_args, **_kwargs: (54.0, 788.0, 487.0, 54.0))
    monkeypatch.setattr(pdf_service, "_template_content_start_y", lambda *_args, **_kwargs: 700.0)
    monkeypatch.setattr(pdf_service, "_start_page", lambda *args, **kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_detail_pair_row", lambda *_args, **_kwargs: 640.0)
    monkeypatch.setattr(pdf_service, "_extract_note_body", lambda *_args, **_kwargs: "Assessment:\nStable")
    monkeypatch.setattr(pdf_service, "_wrap_text", lambda text, *_args, **_kwargs: [text])
    monkeypatch.setattr(pdf_service, "_draw_label_value_line", lambda *_args, **_kwargs: 620.0)
    monkeypatch.setattr(pdf_service, "_draw_doctor_signature", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_build_note_assets_pdf", lambda *_args, **_kwargs: b"assets-pdf")

    apply_calls: list[bytes] = []

    def fake_apply_pdf_template(raw: bytes, *_args, **_kwargs) -> bytes:
        apply_calls.append(raw)
        return b"templated-base" if raw == b"canvas-pdf" else b"unexpected"

    append_calls: list[tuple[bytes, bytes | None]] = []

    def fake_append_pdf_bytes(primary: bytes, secondary: bytes | None) -> bytes:
        append_calls.append((primary, secondary))
        return b"combined"

    monkeypatch.setattr(pdf_service, "_apply_pdf_template", fake_apply_pdf_template)
    monkeypatch.setattr(pdf_service, "_append_pdf_bytes", fake_append_pdf_bytes)

    result = build_note_pdf(
        patient={"name": "Template Patient", "document_template_notes_enabled": True},
        note_content="Assessment:\nStable",
        generated_on="Apr 28, 2026 10:30 AM",
        assets=[{"id": "asset-1", "content_type": "image/png"}],
    )

    assert result == b"combined"
    assert apply_calls == [b"canvas-pdf"]
    assert append_calls == [(b"templated-base", b"assets-pdf")]


def test_build_note_pdf_uses_saved_template_layout_for_real_note_content(monkeypatch) -> None:
    monkeypatch.setattr(pdf_service.canvas, "Canvas", _TemplateLayoutCanvas)
    monkeypatch.setattr(pdf_service, "_resolve_template", lambda *_args, **_kwargs: ("application/pdf", b"template"))
    monkeypatch.setattr(pdf_service, "_page_size_for_template", lambda *_args, **_kwargs: (600.0, 800.0))
    monkeypatch.setattr(pdf_service, "_content_bounds", lambda *_args, **_kwargs: (54.0, 746.0, 492.0, 54.0))
    monkeypatch.setattr(pdf_service, "_start_page", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_apply_pdf_template", lambda raw, *_args, **_kwargs: raw)
    monkeypatch.setattr(pdf_service, "_build_structured_data_pdf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_build_note_assets_pdf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_template_signature", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_template_doctor_name", lambda *_args, **_kwargs: None)

    build_note_pdf(
        patient={
            "name": "Template Patient",
            "age": 34,
            "height": 172,
            "weight": 68,
            "temperature": 98.4,
            "document_template_notes_enabled": True,
            "document_template_note_layout": {
                "name": {"x": 0.2, "y": 0.1, "width": 0.25, "height": 0.04},
                "noteBody": {"x": 0.3, "y": 0.4, "width": 0.4, "height": 0.2},
            },
        },
        note_content="Presenting Complaint:\nBlurred vision after screen use.\n\nTreatment:\nUpdated prescription.",
        generated_on="Jul 23, 2026 5:30 PM",
    )

    canvas = _TemplateLayoutCanvas.last_instance
    assert canvas is not None
    assert (62.0, 708.0, "Name:") in canvas.strings
    assert any(text == "Template Patient" for _x, _y, text in canvas.strings)
    assert any(text == "Age:" for _x, _y, text in canvas.strings)
    assert any(text == "Height:" for _x, _y, text in canvas.strings)
    assert (182.0, 468.0, "Presenting Complaint:") in canvas.strings
    assert any("Blurred vision" in text for _x, _y, text in canvas.strings)
    assert any(text == "Treatment:" for _x, _y, text in canvas.strings)


def test_build_note_pdf_continues_template_body_on_new_template_pages(monkeypatch) -> None:
    monkeypatch.setattr(pdf_service.canvas, "Canvas", _TemplateLayoutCanvas)
    monkeypatch.setattr(pdf_service, "_resolve_template", lambda *_args, **_kwargs: ("application/pdf", b"template"))
    monkeypatch.setattr(pdf_service, "_page_size_for_template", lambda *_args, **_kwargs: (600.0, 800.0))
    monkeypatch.setattr(pdf_service, "_content_bounds", lambda *_args, **_kwargs: (54.0, 746.0, 492.0, 54.0))
    monkeypatch.setattr(pdf_service, "_start_page", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_apply_pdf_template", lambda raw, *_args, **_kwargs: raw)
    monkeypatch.setattr(pdf_service, "_build_structured_data_pdf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_build_note_assets_pdf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_template_signature", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_template_doctor_name", lambda *_args, **_kwargs: None)

    long_text = " ".join(["screen strain and intermittent blurring"] * 80)
    build_note_pdf(
        patient={
            "name": "Overflow Patient",
            "document_template_notes_enabled": True,
            "document_template_note_layout": {
                "noteBody": {"x": 0.1, "y": 0.35, "width": 0.45, "height": 0.04},
            },
        },
        note_content=f"Presenting Complaint:\n{long_text}",
        generated_on="Jul 23, 2026 5:30 PM",
    )

    canvas = _TemplateLayoutCanvas.last_instance
    assert canvas is not None
    assert canvas.page_breaks > 0


def test_build_note_pdf_keeps_template_body_above_signature_and_name_boxes(monkeypatch) -> None:
    monkeypatch.setattr(pdf_service.canvas, "Canvas", _TemplateLayoutCanvas)
    monkeypatch.setattr(pdf_service, "_resolve_template", lambda *_args, **_kwargs: ("application/pdf", b"template"))
    monkeypatch.setattr(pdf_service, "_page_size_for_template", lambda *_args, **_kwargs: (600.0, 800.0))
    monkeypatch.setattr(pdf_service, "_content_bounds", lambda *_args, **_kwargs: (54.0, 746.0, 492.0, 54.0))
    monkeypatch.setattr(pdf_service, "_start_page", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_apply_pdf_template", lambda raw, *_args, **_kwargs: raw)
    monkeypatch.setattr(pdf_service, "_build_structured_data_pdf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_build_note_assets_pdf", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_template_signature", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_draw_template_doctor_name", lambda *_args, **_kwargs: None)

    long_text = " ".join(["visual strain after screen use"] * 60)
    build_note_pdf(
        patient={
            "name": "Reserved Space Patient",
            "doctor_name": "Dr Reserved",
            "doctor_signature_content_type": "image/png",
            "doctor_signature_data_base64": b64encode(b"signature").decode("ascii"),
            "document_template_notes_enabled": True,
            "document_template_note_layout": {
                "noteBody": {"x": 0.1, "y": 0.28, "width": 0.65, "height": 0.55},
            },
            "document_template_signature_x": 0.1,
            "document_template_signature_y": 0.72,
            "document_template_signature_width": 0.24,
            "document_template_signature_height": 0.08,
            "document_template_doctor_name_x": 0.1,
            "document_template_doctor_name_y": 0.82,
            "document_template_doctor_name_width": 0.24,
            "document_template_doctor_name_height": 0.04,
        },
        note_content=f"Presenting Complaint:\n{long_text}",
        generated_on="Jul 23, 2026 5:30 PM",
    )

    canvas = _TemplateLayoutCanvas.last_instance
    assert canvas is not None
    reserved_floor = 800.0 - ((0.72 * 800.0) + (0.08 * 800.0)) + (0.08 * 800.0) + 8
    body_strings = [
        (x, y, text)
        for x, y, text in canvas.strings
        if x >= 62 and text not in {"Name:", "Reserved Space Patient", "Date:", "Jul 23, 2026 5:30 PM"}
    ]
    assert body_strings
    assert all(y >= reserved_floor for _x, y, _text in body_strings)
    assert canvas.page_breaks > 0


def test_build_note_pdf_skips_missing_optional_patient_details(monkeypatch) -> None:
    monkeypatch.setattr(pdf_service.canvas, "Canvas", _RecordingCanvas)
    monkeypatch.setattr(pdf_service, "_resolve_template", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_wrap_text", lambda text, *_args, **_kwargs: [text])
    monkeypatch.setattr(pdf_service, "_draw_label_value_line", lambda *_args, **_kwargs: 620.0)
    monkeypatch.setattr(pdf_service, "_draw_doctor_signature", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pdf_service, "_build_note_assets_pdf", lambda *_args, **_kwargs: None)

    detail_rows: list[tuple[tuple[str, str], tuple[str, str] | None]] = []

    def fake_draw_detail_pair_row(_pdf, _x, y, left, right, _max_width):
        detail_rows.append((left, right))
        return y - 18

    monkeypatch.setattr(pdf_service, "_draw_detail_pair_row", fake_draw_detail_pair_row)

    build_note_pdf(
        patient={
            "name": "L Venkatesh",
            "phone": "9840221676",
            "age": None,
            "height": None,
            "weight": None,
            "temperature": None,
            "reason": "Routine ocular examination",
        },
        note_content="Presenting Complaint:\nRoutine ocular examination.",
        generated_on="Jul 23, 2026 2:30 PM",
    )

    flattened = [item for row in detail_rows for item in row if item is not None]

    assert ("Name", "L Venkatesh") in flattened
    assert ("Phone", "9840221676") in flattened
    assert ("Date", "Jul 23, 2026 2:30 PM") in flattened
    assert ("Reason for Visit", "Routine ocular examination") in flattened
    assert all(label not in {"Age", "Height", "Weight", "Temperature"} for label, _value in flattened)
    assert all(value != "Not recorded" for _label, value in flattened)
