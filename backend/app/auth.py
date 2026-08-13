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
SUPERDASHBOARD_SESSION_COOKIE_NAME = "superdashboard_session"
CLINIC_SESSION_REALM = "clinic"
SUPERDASHBOARD_SESSION_REALM = "superdashboard"
SAFE_HTTP_METHODS = {"GET", "HEAD", "OPTIONS"}


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


def _build_access_token_payload(
    user: dict[str, str | int],
    *,
    realm: str = CLINIC_SESSION_REALM,
    ttl_hours: int | None = None,
) -> dict[str, str | int]:
    issued_at = datetime.now(UTC)
    configured_ttl = (
        int(ttl_hours)
        if ttl_hours is not None
        else int(getattr(get_settings(), "session_ttl_hours", 12))
    )
    bounded_ttl_hours = max(1, min(configured_ttl, 168))
    expires_at = issued_at + timedelta(hours=bounded_ttl_hours)
    payload: dict[str, str | int] = {
        "sub": user["id"],
        "org_id": user["org_id"],
        "role": user["role"],
        "identifier": user["identifier"],
        "session_version": int(user.get("session_version") or 1),
        "realm": realm,
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


def _issue_session_headers(
    response: Response,
    user: dict[str, str | int],
    *,
    cookie_name: str,
    realm: str,
    ttl_hours: int,
    secure: bool | None = None,
) -> str:
    payload = _build_access_token_payload(user, realm=realm, ttl_hours=ttl_hours)
    token = _encode_access_token(payload)
    settings = get_settings()
    app_origin = getattr(settings, "app_origin", "")
    response.headers[SESSION_TOKEN_HEADER] = token
    response.headers[SESSION_EXPIRES_AT_HEADER] = str(payload["exp"])
    response.set_cookie(
        key=cookie_name,
        value=token,
        httponly=True,
        max_age=int(payload["exp"]) - int(payload["iat"]),
        expires=int(payload["exp"]),
        samesite="lax",
        secure=secure if secure is not None else str(app_origin).startswith("https://"),
        path="/",
    )
    return token


def issue_session_headers(response: Response, user: dict[str, str | int], *, secure: bool | None = None) -> str:
    return _issue_session_headers(
        response,
        user,
        cookie_name=SESSION_COOKIE_NAME,
        realm=CLINIC_SESSION_REALM,
        ttl_hours=int(getattr(get_settings(), "session_ttl_hours", 12)),
        secure=secure,
    )


def issue_superdashboard_session_headers(
    response: Response,
    user: dict[str, str | int],
    *,
    secure: bool | None = None,
) -> str:
    return _issue_session_headers(
        response,
        {
            **user,
            "session_version": int(user.get("superdashboard_session_version") or 1),
        },
        cookie_name=SUPERDASHBOARD_SESSION_COOKIE_NAME,
        realm=SUPERDASHBOARD_SESSION_REALM,
        ttl_hours=int(getattr(get_settings(), "superdashboard_session_ttl_hours", 4)),
        secure=secure,
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_superdashboard_session(response: Response) -> None:
    response.delete_cookie(
        key=SUPERDASHBOARD_SESSION_COOKIE_NAME,
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


def _allowed_request_origins() -> set[str]:
    settings = get_settings()
    cors_origins = getattr(settings, "cors_origins", None)
    if callable(cors_origins):
        configured = cors_origins()
    else:
        configured = [getattr(settings, "app_origin", "")]
    return {
        str(item).rstrip("/")
        for item in configured
        if str(item).strip()
    }


async def _get_authenticated_user(
    request: Request,
    *,
    authorization: str | None,
    session_token: str | None,
    expected_realm: str,
    session_version_field: str,
) -> UserOut:
    bearer_token = ""
    cookie_token = session_token.strip() if session_token else ""
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.split(" ", 1)[1].strip()

    if not bearer_token and not cookie_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    # An explicitly supplied bearer credential is always authoritative. Never
    # choose between identities by token issue time: doing so can turn a staff
    # bearer request into an admin cookie request in shared clients.
    if bearer_token:
        payload = decode_access_token(bearer_token)
        if cookie_token:
            try:
                cookie_payload = decode_access_token(cookie_token)
            except HTTPException:
                cookie_payload = None
            if cookie_payload is not None and (
                cookie_payload.get("sub") != payload.get("sub")
                or cookie_payload.get("org_id") != payload.get("org_id")
            ):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Conflicting authentication credentials.",
                )
        request.state.auth_source = "bearer"
    else:
        payload = decode_access_token(cookie_token)
        request.state.auth_source = "cookie"
        if request.method.upper() not in SAFE_HTTP_METHODS:
            origin = str(request.headers.get("origin") or "").rstrip("/")
            allowed_origins = _allowed_request_origins()
            if not origin or origin not in allowed_origins:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid request origin.",
                )

    token_realm = payload.get("realm")
    if expected_realm == CLINIC_SESSION_REALM:
        if token_realm not in {None, CLINIC_SESSION_REALM}:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    elif token_realm != expected_realm:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

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
    current_session_version = int(user.get(session_version_field) or 1)
    if not isinstance(token_session_version, int) or token_session_version != current_session_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    current_user = UserOut(
        **user,
    )
    request.state.current_user = current_user
    request.state.auth_realm = expected_realm
    return current_user


async def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> UserOut:
    return await _get_authenticated_user(
        request,
        authorization=authorization,
        session_token=session_token,
        expected_realm=CLINIC_SESSION_REALM,
        session_version_field="session_version",
    )


async def get_current_superdashboard_user(
    request: Request,
    authorization: str | None = Header(default=None),
    session_token: str | None = Cookie(default=None, alias=SUPERDASHBOARD_SESSION_COOKIE_NAME),
) -> UserOut:
    return await _get_authenticated_user(
        request,
        authorization=authorization,
        session_token=session_token,
        expected_realm=SUPERDASHBOARD_SESSION_REALM,
        session_version_field="superdashboard_session_version",
    )


async def require_admin(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return current_user


async def require_admin_or_doctor(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    if current_user.role not in {"admin", "doctor"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Clinical access required.")
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


def _control_room_identifiers() -> set[str]:
    settings = get_settings()
    raw = str(getattr(settings, "control_room_identifiers", "") or "")
    return {
        identifier.strip().lower()
        for identifier in raw.split(",")
        if identifier.strip()
    }


def is_control_room_identifier(identifier: str) -> bool:
    return identifier.strip().lower() in _control_room_identifiers()


async def require_super_admin(
    current_user: UserOut = Depends(get_current_superdashboard_user),
) -> UserOut:
    if (
        current_user.role != "admin"
        or not is_super_admin_identifier(current_user.identifier)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superdashboard access required.")
    return current_user


async def require_control_room_user(
    current_user: UserOut = Depends(get_current_user),
) -> UserOut:
    if (
        current_user.role != "admin"
        or not is_control_room_identifier(current_user.identifier)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Control room access required.")
    return current_user
