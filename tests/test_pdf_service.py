import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import test_app  # noqa: F401

from app.services.pdf_service import _template_content_start_y


def test_template_content_start_y_uses_safer_default_clearance_for_note_templates() -> None:
    page_height = 842.0
    # Default configured top margin is too shallow for branded letterheads.
    configured_top_y = page_height - 54.0

    start_y = _template_content_start_y(configured_top_y, page_height, "note")

    assert start_y < configured_top_y
    assert round(start_y, 1) == round(page_height - (2.6 * 72), 1)


def test_template_content_start_y_honors_more_conservative_user_margin() -> None:
    page_height = 842.0
    configured_top_y = page_height - 240.0

    start_y = _template_content_start_y(configured_top_y, page_height, "note")

    assert start_y == configured_top_y
