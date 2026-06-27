from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


SECRET_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    secret = str(get_settings().auth_secret or "").encode("utf-8")
    if not secret:
        raise RuntimeError("AUTH_SECRET must be configured before encrypting stored secrets.")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_stored_secret(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if normalized.startswith(SECRET_PREFIX):
        return normalized
    encrypted = _fernet().encrypt(normalized.encode("utf-8")).decode("ascii")
    return f"{SECRET_PREFIX}{encrypted}"


def decrypt_stored_secret(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if not normalized.startswith(SECRET_PREFIX):
        # Existing deployments may still contain legacy plaintext. It is
        # re-encrypted the next time clinic settings are saved.
        return normalized
    try:
        return _fernet().decrypt(normalized.removeprefix(SECRET_PREFIX).encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored clinic email credential could not be decrypted.") from exc
