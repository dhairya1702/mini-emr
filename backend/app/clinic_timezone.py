from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEFAULT_TIMEZONE = "UTC"


def normalize_timezone_name(value: object) -> str:
    name = str(value or "").strip() or DEFAULT_TIMEZONE
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Enter a valid IANA timezone.") from exc
    return name


def get_clinic_timezone(clinic_settings: dict | None) -> ZoneInfo:
    return ZoneInfo(normalize_timezone_name((clinic_settings or {}).get("timezone")))


def clinic_now(clinic_settings: dict | None) -> datetime:
    return datetime.now(get_clinic_timezone(clinic_settings))


def clinic_today(clinic_settings: dict | None) -> date:
    return clinic_now(clinic_settings).date()


def utc_day_bounds_for_clinic(day: date, clinic_settings: dict | None) -> tuple[str, str]:
    timezone = get_clinic_timezone(clinic_settings)
    start_local = datetime(day.year, day.month, day.day, tzinfo=timezone)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC).isoformat(), end_local.astimezone(UTC).isoformat()


def clinic_day_start_utc(clinic_settings: dict | None, day: date | None = None) -> datetime:
    timezone = get_clinic_timezone(clinic_settings)
    effective_day = day or clinic_today(clinic_settings)
    start_local = datetime(effective_day.year, effective_day.month, effective_day.day, tzinfo=timezone)
    return start_local.astimezone(UTC)


def as_clinic_time(value: datetime | str, clinic_settings: dict | None) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(get_clinic_timezone(clinic_settings))
