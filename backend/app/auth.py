import binascii
import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status

from app.config import get_settings
from app.db import get_repository
from app.schema_domains.auth_settings import UserOut


LEGACY_PASSWORD_ITERATIONS = 120_000
PASSWORD_ITERATIONS = 600_000
SESSION_TOKEN_HEADER = "X-Session-Token"
SESSION_EXPIRES_AT_HEADER = "X-Session-Expires-At"
SESSION_COOKIE_NAME = "clinic_session"


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${_b64encode(salt)}${_b64encode(password_hash)}"


def verify_password(password: str, stored_value: str) -> bool:
    try:
        if stored_value.startswith("pbkdf2_sha256$"):
            algorithm, iterations_raw, salt_raw, hash_raw = stored_value.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            iterations = int(iterations_raw)
            if iterations < LEGACY_PASSWORD_ITERATIONS or iterations > 2_000_000:
                return False
        else:
            salt_raw, hash_raw = stored_value.split(":", 1)
            iterations = LEGACY_PASSWORD_ITERATIONS
        salt = _b64decode(salt_raw)
        expected_hash = _b64decode(hash_raw)
    except (TypeError, ValueError):
        return False

    candidate_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate_hash, expected_hash)


def password_hash_needs_upgrade(stored_value: str) -> bool:
    if not stored_value.startswith("pbkdf2_sha256$"):
        return True
    try:
        return int(stored_value.split("$", 3)[1]) < PASSWORD_ITERATIONS
    except (IndexError, ValueError):
        return True


def _get_token_secret() -> bytes:
    settings = get_settings()
    if not settings.auth_secret:
        raise RuntimeError("AUTH_SECRET must be configured.")
    return settings.auth_secret.encode("utf-8")


def _build_access_token_payload(user: dict[str, str | int]) -> dict[str, str | int]:
    issued_at = datetime.now(UTC)
    ttl_hours = max(1, min(int(getattr(get_settings(), "session_ttl_hours", 12)), 168))
    expires_at = issued_at + timedelta(hours=ttl_hours)
    payload: dict[str, str | int] = {
        "sub": user["id"],
        "org_id": user["org_id"],
        "role": user["role"],
        "identifier": user["identifier"],
        "session_version": int(user.get("session_version") or 1),
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": secrets.token_hex(8),
    }
    return payload


def _encode_access_token(payload: dict[str, str | int]) -> str:
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_segment = _b64encode(payload_json)
    signature = hmac.new(_get_token_secret(), payload_segment.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_segment}.{_b64encode(signature)}"


def create_access_token(user: dict[str, str | int]) -> str:
    return _encode_access_token(_build_access_token_payload(user))


def issue_session_headers(response: Response, user: dict[str, str | int], *, secure: bool | None = None) -> str:
    payload = _build_access_token_payload(user)
    token = _encode_access_token(payload)
    settings = get_settings()
    app_origin = getattr(settings, "app_origin", "")
    response.headers[SESSION_TOKEN_HEADER] = token
    response.headers[SESSION_EXPIRES_AT_HEADER] = str(payload["exp"])
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        max_age=int(payload["exp"]) - int(payload["iat"]),
        expires=int(payload["exp"]),
        samesite="lax",
        secure=secure if secure is not None else str(app_origin).startswith("https://"),
        path="/",
    )
    return token


def clear_session(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        path="/",
    )


def decode_access_token(token: str) -> dict[str, str | int]:
    try:
        payload_segment, signature_segment = token.split(".", 1)
        provided_signature = _b64decode(signature_segment)
        payload = json.loads(_b64decode(payload_segment).decode("utf-8"))
    except (ValueError, binascii.Error, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc

    expected_signature = hmac.new(
        _get_token_secret(),
        payload_segment.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected_signature, provided_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int) or expires_at < int(datetime.now(UTC).timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired.")
    return payload


async def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> UserOut:
    bearer_token = ""
    cookie_token = session_token.strip() if session_token else ""
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.split(" ", 1)[1].strip()

    if not bearer_token and not cookie_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    payload = None
    valid_payloads: list[dict[str, str | int]] = []
    last_error: HTTPException | None = None
    for token in [bearer_token, cookie_token]:
        if not token:
            continue
        try:
            valid_payloads.append(decode_access_token(token))
        except HTTPException as exc:
            last_error = exc

    if valid_payloads:
        payload = max(
            valid_payloads,
            key=lambda candidate: int(candidate.get("iat") or 0),
        )

    if payload is None:
        raise last_error or HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    repo_factory = request.app.dependency_overrides.get(get_repository, get_repository)
    repo = repo_factory()
    try:
        user = await repo.get_auth_user(user_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc
    token_session_version = payload.get("session_version")
    current_session_version = int(user.get("session_version") or 1)
    if not isinstance(token_session_version, int) or token_session_version != current_session_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    current_user = UserOut(
        **user,
    )
    request.state.current_user = current_user
    return current_user


async def require_admin(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return current_user


def _super_admin_identifiers() -> set[str]:
    settings = get_settings()
    raw = str(getattr(settings, "super_admin_identifiers", "") or "")
    return {
        identifier.strip().lower()
        for identifier in raw.split(",")
        if identifier.strip()
    }

def is_super_admin_identifier(identifier: str) -> bool:
    return identifier.strip().lower() in _super_admin_identifiers()


async def require_super_admin(
    current_user: UserOut = Depends(get_current_user),
) -> UserOut:
    if (
        current_user.role != "admin"
        or not is_super_admin_identifier(current_user.identifier)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superdashboard access required.")
    return current_user
