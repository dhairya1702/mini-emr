import sys
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
        "Treatment:\nMedicine | Quantity | Schedule | Duration | Notes\n--- | --- | --- | --- | ---\ndolo | 1 per tablet | Morning, Night | 5 | -\n"
    )

    note_sections = _parse_note_sections(note_content)
    vitals_rows, medicines_table, eye_exam_table = _classify_structured_tables(note_sections)

    assert len(vitals_rows) == 4
    assert medicines_table is not None
    assert medicines_table[0] == ["Medicine", "Quantity", "Schedule", "Duration", "Notes"]
    assert eye_exam_table is not None
    assert eye_exam_table[0] == ["Eye", "Sphere", "Cylinder", "Axis", "Vision"]


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
