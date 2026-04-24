from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage


GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587


def _build_sender(clinic_settings: dict) -> str:
    sender_email = str(clinic_settings.get("sender_email") or "").strip()
    sender_name = str(clinic_settings.get("sender_name") or "").strip()
    if not sender_email:
        raise RuntimeError("Clinic sender email is not configured.")
    return f"{sender_name} <{sender_email}>" if sender_name else sender_email


def _send_email_sync(message: EmailMessage, *, sender_email: str, app_password: str) -> None:
    with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, timeout=20) as server:
        server.starttls()
        server.login(sender_email, app_password)
        server.send_message(message)


async def send_clinic_email_message(
    *,
    clinic_settings: dict,
    recipient: str,
    subject: str,
    text_content: str,
    html_content: str | None = None,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> None:
    sender_email = str(clinic_settings.get("sender_email") or "").strip()
    app_password = str(clinic_settings.get("sender_email_app_password") or "").strip()
    if not sender_email:
        raise RuntimeError("Clinic sender email is not configured.")
    if not app_password:
        raise RuntimeError("Clinic Gmail app password is not configured.")

    message = EmailMessage()
    message["To"] = recipient.strip()
    message["From"] = _build_sender(clinic_settings)
    message["Reply-To"] = sender_email
    message["Subject"] = subject.strip()
    message.set_content(text_content)
    if html_content:
        message.add_alternative(html_content, subtype="html")
    for filename, content, mime_type in attachments or []:
        maintype, subtype = mime_type.split("/", 1)
        message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

    await asyncio.to_thread(_send_email_sync, message, sender_email=sender_email, app_password=app_password)
