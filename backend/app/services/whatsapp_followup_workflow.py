from __future__ import annotations

import asyncio
from typing import Any

from app.config import get_settings
from app.db import AppRepository
from app.services.followup_booking_service import create_follow_up_booking_token
from app.services.whatsapp_document_workflow import build_whatsapp_client, normalize_whatsapp_recipient


def _first_name(value: object) -> str:
    cleaned = " ".join(str(value or "").strip().split())
    return cleaned.split(" ", 1)[0] if cleaned else "there"


def _follow_up_reason(value: object) -> str:
    cleaned = " ".join(str(value or "").strip().split())
    return cleaned[:200] or "your planned follow-up"


async def send_follow_up_booking_invitation(
    repo: AppRepository,
    *,
    org_id: str,
    follow_up: dict[str, Any],
    patient: dict[str, Any],
    clinic_settings: dict[str, Any],
) -> dict[str, Any] | None:
    settings = get_settings()
    template_name = str(getattr(settings, "whatsapp_follow_up_template_name", "") or "").strip()
    if not settings.whatsapp_enabled or not template_name:
        return None

    follow_up_id = str(follow_up["id"])
    idempotency_key = f"follow-up:{follow_up_id}:booking-invitation"
    existing = await repo.get_whatsapp_message_event_by_idempotency(org_id, idempotency_key)
    if existing:
        return existing

    recipient = normalize_whatsapp_recipient(str(patient.get("phone") or ""))
    booking_token = create_follow_up_booking_token(
        org_id=org_id,
        patient_id=str(follow_up["patient_id"]),
        follow_up_id=follow_up_id,
    )
    booking_url = f"{settings.app_origin.rstrip('/')}/follow-up?token={booking_token}"
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    message_text = (
        f"{clinic_name} invited the patient to book or manage a follow-up appointment."
    )
    raw_context = {
        "booking_url": booking_url,
        "follow_up_id": follow_up_id,
        "patient_id": str(follow_up["patient_id"]),
        "template_name": template_name,
    }
    event = await repo.record_whatsapp_message_event(
        org_id=org_id,
        binding_id=None,
        direction="outbound",
        recipient_wa_id=recipient,
        message_text=message_text,
        intent="follow_up_booking_invitation",
        status="queued",
        raw_payload=raw_context,
        document_type="follow_up",
        document_id=follow_up_id,
        idempotency_key=idempotency_key,
    )
    try:
        client = build_whatsapp_client()
        result = await asyncio.to_thread(
            client.send_follow_up_booking_template,
            to=recipient,
            template_name=template_name,
            language_code=str(getattr(settings, "whatsapp_follow_up_template_language", "en") or "en").strip() or "en",
            patient_first_name=_first_name(patient.get("name")),
            clinic_name=clinic_name,
            follow_up_reason=_follow_up_reason(follow_up.get("notes")),
            booking_token=booking_token,
        )
    except Exception as exc:
        await repo.update_whatsapp_message_event(
            str(event["id"]),
            status="failed",
            error=str(exc),
            raw_payload=raw_context,
        )
        message = str(exc.detail) if hasattr(exc, "detail") else str(exc)
        raise RuntimeError(message) from exc
    return await repo.update_whatsapp_message_event(
        str(event["id"]),
        status="accepted",
        wa_message_id=result.message_id,
        raw_payload={**raw_context, "provider_response": result.raw},
    )
