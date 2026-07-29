from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage
from html import escape


GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587
SMTP_TIMEOUT_SECONDS = 15


class EmailDeliveryError(RuntimeError):
    pass


AUTOMATED_EMAIL_FOOTER = (
    "This is an automated message sent through ClinicOS. "
    "This mailbox is not monitored. Contact the clinic directly if you need assistance."
)


def _build_sender(*, sender_name: str, sender_email: str) -> str:
    if not sender_email:
        raise RuntimeError("Email sender is not configured.")
    return f"{sender_name} <{sender_email}>" if sender_name else sender_email


def _send_email_sync(message: EmailMessage, *, sender_email: str, app_password: str) -> None:
    with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
        server.starttls()
        server.login(sender_email, app_password)
        server.send_message(message)


def _test_email_credentials_sync(*, sender_email: str, app_password: str) -> None:
    with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
        server.starttls()
        server.login(sender_email, app_password)


async def test_email_credentials(*, sender_email: str, app_password: str) -> None:
    try:
        await asyncio.to_thread(
            _test_email_credentials_sync,
            sender_email=sender_email.strip(),
            app_password=app_password.strip(),
        )
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        raise EmailDeliveryError("Gmail authentication failed. Verify the address and app password.") from exc


def _resolve_sender(clinic_settings: dict, platform_settings: dict) -> tuple[str, str, str, bool]:
    mode = str(clinic_settings.get("email_sender_mode") or "clinicos").strip()
    if mode == "clinic":
        sender_email = str(clinic_settings.get("sender_email") or "").strip()
        app_password = str(clinic_settings.get("sender_email_app_password") or "").strip()
        sender_name = str(clinic_settings.get("sender_name") or "").strip()
        if not sender_email or not app_password:
            raise RuntimeError("Clinic Gmail is selected but its address or app password is not configured.")
        return sender_name, sender_email, app_password, False

    sender_email = str(platform_settings.get("sender_email") or "").strip()
    app_password = str(platform_settings.get("sender_email_app_password") or "").strip()
    if not platform_settings.get("is_enabled") or not sender_email or not app_password:
        raise RuntimeError("ClinicOS email delivery is not configured. Ask ClinicOS Ops to enable it.")
    clinic_name = str(clinic_settings.get("clinic_name") or "").strip()
    platform_name = str(platform_settings.get("sender_name") or "ClinicOS").strip() or "ClinicOS"
    sender_name = f"{clinic_name} via {platform_name}" if clinic_name else platform_name
    return sender_name, sender_email, app_password, True


async def send_clinic_email_message(
    *,
    repo,
    clinic_settings: dict,
    recipient: str,
    subject: str,
    text_content: str,
    html_content: str | None = None,
    attachments: list[tuple[str, bytes, str]] | None = None,
    message_id: str | None = None,
) -> None:
    platform_settings = await repo.get_platform_email_settings()
    sender_name, sender_email, app_password, uses_clinicos_sender = _resolve_sender(
        clinic_settings,
        platform_settings,
    )
    if uses_clinicos_sender:
        text_content = f"{text_content.rstrip()}\n\n{AUTOMATED_EMAIL_FOOTER}"
        if html_content:
            html_content = f"{html_content}<p>{escape(AUTOMATED_EMAIL_FOOTER)}</p>"

    message = EmailMessage()
    message["To"] = recipient.strip()
    message["From"] = _build_sender(sender_name=sender_name, sender_email=sender_email)
    message["Subject"] = subject.strip()
    if message_id:
        message["Message-ID"] = message_id
    message.set_content(text_content)
    if html_content:
        message.add_alternative(html_content, subtype="html")
    for filename, content, mime_type in attachments or []:
        maintype, subtype = mime_type.split("/", 1)
        message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

    try:
        await asyncio.to_thread(
            _send_email_sync,
            message,
            sender_email=sender_email,
            app_password=app_password,
        )
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        raise EmailDeliveryError("Email delivery failed. Verify the sender credentials and try again.") from exc
