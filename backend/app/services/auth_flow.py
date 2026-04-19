from collections import defaultdict, deque
from time import monotonic
import re

from fastapi import HTTPException


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_PATTERN = re.compile(r"^\+?[0-9]{6,}$")
RATE_LIMIT_WINDOWS: dict[str, tuple[int, float]] = {
    "auth_login": (5, 60.0),
    "auth_register": (3, 300.0),
    "note_generation": (20, 300.0),
}
RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def normalize_identifier(identifier: str) -> str:
    value = identifier.strip()
    if EMAIL_PATTERN.match(value):
        return value.lower()

    compact = re.sub(r"[\s\-()]", "", value)
    if PHONE_PATTERN.match(compact):
        return compact

    raise HTTPException(
        status_code=400,
        detail="Enter a valid email address or phone number.",
    )


def enforce_rate_limit(scope: str, key: str) -> None:
    max_requests, window_seconds = RATE_LIMIT_WINDOWS[scope]
    bucket = RATE_LIMIT_BUCKETS[f"{scope}:{key}"]
    now = monotonic()
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= max_requests:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait and try again.")
    bucket.append(now)
