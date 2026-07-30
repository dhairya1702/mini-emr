from datetime import UTC, datetime

from test_app import client as _client  # noqa: F401 - configures the backend test import path

from app.formatting import format_display_date


def test_format_display_date_uses_day_month_year_without_time() -> None:
    value = datetime(2026, 7, 30, 18, 45)

    assert format_display_date(value) == "30/07/2026"


def test_format_display_date_applies_clinic_timezone_before_selecting_date() -> None:
    value = datetime(2026, 7, 30, 20, 0, tzinfo=UTC)

    assert format_display_date(value, "Asia/Kolkata") == "31/07/2026"
