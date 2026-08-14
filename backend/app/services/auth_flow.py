from collections import defaultdict, deque
from time import monotonic
import hashlib
import re

from fastapi import HTTPException


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_PATTERN = re.compile(r"^\+?[0-9]{6,}$")
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$")
RATE_LIMIT_WINDOWS: dict[str, tuple[int, float]] = {
    "auth_login": (5, 60.0),
    "auth_login_ip": (20, 60.0),
    "auth_register": (3, 300.0),
    "auth_register_invite": (5, 300.0),
    "note_generation": (20, 300.0),
    "letter_generation": (20, 300.0),
    "case_study_generation": (10, 300.0),
    "clinical_questions": (30, 300.0),
    "clinical_analysis": (20, 300.0),
    "patient_summary": (20, 300.0),
    "public_follow_up_booking_get": (20, 300.0),
    "public_follow_up_booking_post": (10, 300.0),
    "public_check_in_get": (60, 300.0),
    "public_check_in_post": (3, 300.0),
    "public_check_in_status": (60, 300.0),
    "public_appointment_get": (30, 300.0),
    "public_appointment_post": (5, 300.0),
    "public_appointment_post_ip": (10, 300.0),
    "public_appointment_post_clinic": (30, 300.0),
}
RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def normalize_identifier(identifier: str) -> str:
    value = identifier.strip()
    if EMAIL_PATTERN.match(value):
        return value.lower()

    compact = re.sub(r"[\s\-()]", "", value)
    if PHONE_PATTERN.match(compact):
        return compact

    if USERNAME_PATTERN.match(value):
        return value.lower()

    raise HTTPException(
        status_code=400,
        detail="Enter a valid username, email address, or phone number.",
    )


def normalize_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    return email


def enforce_rate_limit(scope: str, key: str) -> None:
    max_requests, window_seconds = RATE_LIMIT_WINDOWS[scope]
    bucket = RATE_LIMIT_BUCKETS[f"{scope}:{key}"]
    now = monotonic()
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= max_requests:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait and try again.")
    bucket.append(now)


def clear_rate_limit(scope: str, key: str) -> None:
    RATE_LIMIT_BUCKETS.pop(f"{scope}:{key}", None)


async def enforce_repository_rate_limit(repo, scope: str, key: str) -> None:
    max_requests, window_seconds = RATE_LIMIT_WINDOWS[scope]
    key_hash = hashlib.sha256(str(key or "unknown").encode("utf-8")).hexdigest()
    count = await repo.consume_rate_limit(
        scope=scope,
        key_hash=key_hash,
        max_window_seconds=int(window_seconds),
    )
    if count > max_requests:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait and try again.")
