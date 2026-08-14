from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from html import escape

from fastapi import HTTPException

from app import config as config_module
from app.auth import hash_password
from app.db import AppRepository
from app.schema_domains.auth_settings import UserOut
from app.services.email_service import EmailDeliveryError, send_clinic_email_message


RESET_TOKEN_TTL = timedelta(hours=1)


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _reset_link(token: str) -> str:
    app_origin = str(config_module.get_settings().app_origin or "http://127.0.0.1:3000").rstrip("/")
    return f"{app_origin}/reset-password?token={token}"


async def send_password_reset_for_user(
    repo: AppRepository,
    *,
    target_user: dict,
    requested_by: UserOut | None,
    requester_realm: str,
) -> None:
    email = str(target_user.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="This user does not have a recovery email.")

    token = secrets.token_urlsafe(48)
    await repo.create_password_reset_token(
        user_id=str(target_user["id"]),
        token_hash=_hash_reset_token(token),
        requested_by_user_id=str(requested_by.id) if requested_by else None,
        requested_by_name=(requested_by.name or requested_by.identifier) if requested_by else "Self-service",
        requester_realm=requester_realm,
        expires_at=datetime.now(UTC) + RESET_TOKEN_TTL,
    )

    clinic_settings = await repo.get_clinic_settings(str(target_user["org_id"]))
    if not clinic_settings:
        raise HTTPException(status_code=404, detail="Clinic settings not found.")

    link = _reset_link(token)
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    target_name = str(target_user.get("name") or target_user.get("identifier") or "there").strip()
    text = (
        f"Hi {target_name},\n\n"
        f"A password reset was requested for your {clinic_name} account.\n\n"
        f"Reset your password within 1 hour:\n{link}\n\n"
        "If you did not expect this, contact your clinic admin."
    )
    html = (
        f"<p>Hi {escape(target_name)},</p>"
        f"<p>A password reset was requested for your {escape(clinic_name)} account.</p>"
        f"<p><a href=\"{escape(link)}\">Reset your password</a></p>"
        "<p>This link expires in 1 hour.</p>"
        "<p>If you did not expect this, contact your clinic admin.</p>"
    )
    try:
        await send_clinic_email_message(
            repo=repo,
            clinic_settings=clinic_settings,
            recipient=email,
            subject=f"Reset your {clinic_name} password",
            text_content=text,
            html_content=html,
            include_automated_footer=False,
        )
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def confirm_password_reset(repo: AppRepository, *, token: str, new_password: str) -> None:
    updated = await repo.consume_password_reset_token(_hash_reset_token(token), hash_password(new_password))
    if not updated:
        raise HTTPException(status_code=400, detail="Password reset link is invalid or expired.")
