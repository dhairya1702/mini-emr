from datetime import datetime


def format_display_datetime(value: datetime | str) -> str:
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


def format_export_datetime(value: datetime | str) -> str:
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value or "").strip()
        if not raw:
            return ""
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw

    local_value = parsed.astimezone() if parsed.tzinfo else parsed
    return local_value.strftime("%d/%m/%Y %I:%M %p")


def format_money(value: float | int | None) -> str:
    return f"{float(value or 0):.2f}"


def build_visit_description(visit: dict) -> str:
    measurements: list[str] = []
    if visit.get("reason"):
        measurements.append(str(visit["reason"]))
    if visit.get("age") is not None:
        measurements.append(f"Age {visit['age']}")
    if visit.get("weight") is not None:
        measurements.append(f"Weight {float(visit['weight']):g} kg")
    if visit.get("height") is not None:
        measurements.append(f"Height {float(visit['height']):g} cm")
    if visit.get("temperature") is not None:
        measurements.append(f"Temp {float(visit['temperature']):g} F")
    return " · ".join(measurements) if measurements else "Visit recorded."
