from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

from app.config import get_settings


BOOKING_TOKEN_TTL_DAYS = 30


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _secret() -> bytes:
    settings = get_settings()
    if not settings.auth_secret:
        raise RuntimeError("AUTH_SECRET must be configured.")
    return settings.auth_secret.encode("utf-8")


def create_follow_up_booking_token(*, org_id: str, patient_id: str, follow_up_id: str) -> str:
    payload = {
        "org_id": org_id,
        "patient_id": patient_id,
        "follow_up_id": follow_up_id,
        "exp": int((datetime.now(UTC) + timedelta(days=BOOKING_TOKEN_TTL_DAYS)).timestamp()),
    }
    payload_segment = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(_secret(), payload_segment.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_segment}.{_b64encode(signature)}"


def decode_follow_up_booking_token(token: str) -> dict[str, str | int]:
    try:
        payload_segment, signature_segment = token.split(".", 1)
        provided_signature = _b64decode(signature_segment)
        payload = json.loads(_b64decode(payload_segment).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid booking link.") from exc

    expected = hmac.new(_secret(), payload_segment.encode("utf-8"), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, provided_signature):
        raise HTTPException(status_code=400, detail="Invalid booking link.")
    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(datetime.now(UTC).timestamp()):
        raise HTTPException(status_code=400, detail="Booking link has expired.")
    return payload
