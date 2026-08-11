import logging
from datetime import UTC, datetime, timedelta
from html import escape
from fastapi import HTTPException

from app.clinic_timezone import as_clinic_time, clinic_day_start_utc, clinic_now, clinic_today, get_clinic_timezone
from app.config import get_settings
from app.db import AppRepository
from app.formatting import format_display_datetime
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.patients import FollowUpCreate, FollowUpOut, FollowUpReminderOut, FollowUpReminderRequest, FollowUpUpdate
from app.services.audit_service import record_follow_up_created, record_follow_up_updated, write_audit_event
from app.services.followup_booking_service import create_follow_up_booking_token, decode_follow_up_booking_token
from app.services.email_service import EmailDeliveryError, send_clinic_email_message
from app.services.whatsapp_followup_workflow import send_follow_up_booking_invitation

FOLLOW_UP_SUGGESTION_DAYS = 7
logger = logging.getLogger(__name__)


def _as_utc_minute(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo:
        return parsed.astimezone(UTC).replace(second=0, microsecond=0)
    return parsed.replace(tzinfo=UTC, second=0, microsecond=0)


def _parse_time_minutes(value: object, fallback: str) -> int:
    raw = str(value or fallback).strip() or fallback
    try:
        parsed = datetime.strptime(raw, "%H:%M")
    except ValueError:
        parsed = datetime.strptime(fallback, "%H:%M")
    return parsed.hour * 60 + parsed.minute


def _appointments_per_hour(clinic_settings: dict) -> int:
    raw = clinic_settings.get("appointments_per_hour")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 4
    if value < 1 or value > 12 or 60 % value != 0:
        return 4
    return value


def _is_within_booking_window(candidate: datetime, clinic_settings: dict) -> bool:
    start_minutes = _parse_time_minutes(clinic_settings.get("appointment_start_time"), "09:00")
    end_minutes = _parse_time_minutes(clinic_settings.get("appointment_end_time"), "18:00")
    candidate_local = as_clinic_time(candidate, clinic_settings)
    candidate_minutes = candidate_local.hour * 60 + candidate_local.minute
    return start_minutes <= candidate_minutes < end_minutes


def _hour_bucket(candidate: datetime, clinic_settings: dict) -> datetime:
    return as_clinic_time(candidate, clinic_settings).replace(minute=0, second=0, microsecond=0)


def _follow_up_email_parts(
    *,
    clinic_name: str,
    doctor_name: str,
    patient_name: str,
    booking_link: str,
) -> tuple[str, str, str]:
    normalized_doctor_name = doctor_name.strip()
    if normalized_doctor_name and not normalized_doctor_name.lower().startswith(("dr.", "dr ", "doctor ")):
        normalized_doctor_name = f"Dr. {normalized_doctor_name}"
    follow_up_sender = normalized_doctor_name or clinic_name
    subject = f"Schedule your follow-up with {follow_up_sender}"
    scheduling_line = f"Schedule: {booking_link}" if booking_link else f"Please contact {clinic_name} to schedule."
    body = (
        f"Hello {patient_name},\n\n"
        f"{follow_up_sender} would like to see you again for a follow-up and check on your progress.\n\n"
        "Please choose a convenient time slot using the link below.\n\n"
        f"{scheduling_line}\n\n"
        f"Thank you,\n{clinic_name}\n"
    )
    safe_patient_name = escape(patient_name)
    safe_clinic_name = escape(clinic_name)
    safe_follow_up_sender = escape(follow_up_sender)
    if booking_link:
        safe_booking_link = escape(booking_link, quote=True)
        booking_action = (
            '<div style="margin:28px 0;text-align:center;">'
            f'<a href="{safe_booking_link}" '
            'style="display:inline-block;border-radius:10px;background:#0f172a;color:#ffffff;'
            'font-size:15px;font-weight:700;line-height:1;padding:15px 24px;text-decoration:none;">'
            "Schedule"
            "</a>"
            "</div>"
        )
    else:
        booking_action = (
            '<p style="margin:24px 0 0;color:#334155;font-size:15px;line-height:24px;text-align:center;">'
            f"Please contact {safe_clinic_name} to schedule."
            "</p>"
        )
    html_body = (
        '<div style="margin:0;background:#f1f5f9;padding:28px 12px;font-family:Arial,sans-serif;color:#0f172a;">'
        '<div style="margin:0 auto;max-width:600px;overflow:hidden;border:1px solid #dbe7ef;'
        'border-radius:16px;background:#ffffff;">'
        '<div style="padding:28px 30px;">'
        '<p style="margin:0 0 20px;font-size:16px;line-height:24px;">'
        f"Hello {safe_patient_name},"
        "</p>"
        '<p style="margin:0 0 18px;font-size:16px;line-height:25px;">'
        f"<strong>{safe_follow_up_sender}</strong> would like to see you again for a follow-up "
        "and check on your progress."
        "</p>"
        '<p style="margin:0;font-size:16px;line-height:25px;">'
        "Please choose a convenient time slot using the button below."
        "</p>"
        f"{booking_action}"
        '<p style="margin:30px 0 0;font-size:15px;line-height:24px;">'
        f"Thank you,<br><strong>{safe_clinic_name}</strong>"
        "</p>"
        "</div>"
        "</div>"
        "</div>"
    )
    return subject, body, html_body


async def _suggest_follow_up_slots(
    repo: AppRepository,
    org_id: str,
    clinic_settings: dict,
    *,
    earliest_at: datetime | None = None,
) -> list[datetime]:
    timezone = get_clinic_timezone(clinic_settings)
    now_local = clinic_now(clinic_settings).replace(second=0, microsecond=0)
    earliest_local = now_local
    if earliest_at is not None:
        earliest_local = max(earliest_local, as_clinic_time(earliest_at, clinic_settings).replace(second=0, microsecond=0))
    window_start = datetime.combine(earliest_local.date(), datetime.min.time(), tzinfo=timezone).astimezone(UTC)
    window_end = (window_start.astimezone(timezone) + timedelta(days=FOLLOW_UP_SUGGESTION_DAYS)).astimezone(UTC)
    occupied = [
        _as_utc_minute(value)
        for value in await repo.list_scheduled_appointment_times(
            org_id,
            window_start.isoformat(),
            window_end.isoformat(),
        )
    ]
    occupied_exact = set(occupied)
    capacity = _appointments_per_hour(clinic_settings)
    slot_interval_minutes = 60 // capacity
    start_minutes = _parse_time_minutes(clinic_settings.get("appointment_start_time"), "09:00")
    end_minutes = _parse_time_minutes(clinic_settings.get("appointment_end_time"), "18:00")
    occupied_by_hour: dict[datetime, int] = {}
    for appointment_time in occupied:
        bucket = _hour_bucket(appointment_time, clinic_settings)
        occupied_by_hour[bucket] = occupied_by_hour.get(bucket, 0) + 1
    suggestions: list[datetime] = []
    for day_offset in range(FOLLOW_UP_SUGGESTION_DAYS):
        day = (earliest_local + timedelta(days=day_offset)).date()
        if day.weekday() == 6:
            continue
        for minute_of_day in range(start_minutes, end_minutes, slot_interval_minutes):
            hour, minute = divmod(minute_of_day, 60)
            candidate_local = datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone)
            if candidate_local <= earliest_local:
                continue
            candidate = candidate_local.astimezone(UTC)
            hour_bucket = _hour_bucket(candidate, clinic_settings)
            if occupied_by_hour.get(hour_bucket, 0) >= capacity:
                continue
            if candidate in occupied_exact:
                continue
            suggestions.append(candidate)
            if len(suggestions) >= 10:
                return suggestions
    return suggestions


async def expire_stale_schedule_workflow(repo: AppRepository, org_id: str) -> None:
    clinic_settings = await repo.get_clinic_settings(org_id)
    stale_before = clinic_day_start_utc(clinic_settings).isoformat()
    await repo.cancel_expired_appointments(org_id, stale_before)


async def _send_follow_up_email(
    repo: AppRepository,
    current_user: UserOut,
    follow_up: dict,
    *,
    mark_automatic_reminder: bool,
    message_key: str,
) -> None:
    patient = await repo.get_patient(str(current_user.org_id), str(follow_up["patient_id"]))
    recipient = str(patient.get("email") or "").strip()
    if not recipient:
        raise RuntimeError("Patient email is not configured.")
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    booking_token = create_follow_up_booking_token(
        org_id=str(current_user.org_id),
        patient_id=str(follow_up["patient_id"]),
        follow_up_id=str(follow_up["id"]),
    )
    booking_link = f"{get_settings().app_origin.rstrip('/')}/follow-up?token={booking_token}"
    subject, text_content, html_content = _follow_up_email_parts(
        clinic_name=clinic_name,
        doctor_name=str(clinic_settings.get("doctor_name") or current_user.name or "").strip(),
        patient_name=str(patient.get("name") or "Patient").strip() or "Patient",
        booking_link=booking_link,
    )
    await send_clinic_email_message(
        repo=repo,
        clinic_settings=clinic_settings,
        recipient=recipient,
        subject=subject,
        text_content=text_content,
        html_content=html_content,
        message_id=f"<follow-up-{follow_up['id']}-{message_key}@clinicos>",
        include_automated_footer=False,
    )
    if mark_automatic_reminder:
        await repo.mark_follow_up_reminder_sent(str(current_user.org_id), str(follow_up["id"]))


async def _send_follow_up_email_if_needed(repo: AppRepository, current_user: UserOut, follow_up: dict) -> None:
    await _send_follow_up_email(
        repo,
        current_user,
        follow_up,
        mark_automatic_reminder=True,
        message_key="due-reminder",
    )


async def enrich_follow_up_tracking(repo: AppRepository, follow_up: dict) -> dict:
    tracking_getter = getattr(repo, "get_follow_up_tracking", None)
    if callable(tracking_getter):
        tracking = await tracking_getter(str(follow_up["org_id"]), str(follow_up["id"]))
    else:
        appointment = await repo.get_appointment_for_follow_up(str(follow_up["org_id"]), str(follow_up["id"]))
        events = [
            event
            for event in await repo.list_audit_events(str(follow_up["org_id"]), limit=500)
            if event.get("entity_type") == "follow_up"
            and str(event.get("entity_id")) == str(follow_up["id"])
            and event.get("action") in {"follow_up_invitation_sent", "follow_up_reminder_sent"}
        ]
        latest = events[0] if events else {}
        metadata = latest.get("metadata") or {}
        tracking = {
            "appointment_id": appointment.get("id") if appointment else None,
            "appointment_status": appointment.get("status") if appointment else None,
            "appointment_scheduled_for": appointment.get("scheduled_for") if appointment else None,
            "last_contacted_at": latest.get("created_at"),
            "last_contact_channels": metadata.get("channels") or [],
            "last_delivery_status": metadata.get("delivery_status"),
            "last_delivery_error": metadata.get("error"),
            "reminder_count": sum(event.get("action") == "follow_up_reminder_sent" for event in events),
        }
    return {
        **follow_up,
        **tracking,
        "last_contacted_at": tracking.get("last_contacted_at") or follow_up.get("reminder_sent_at"),
        "last_contact_channels": tracking.get("last_contact_channels") or (["email"] if follow_up.get("reminder_sent_at") else []),
        "reminder_count": int(tracking.get("reminder_count") or 0),
    }


async def remind_follow_up_patient_workflow(
    repo: AppRepository,
    current_user: UserOut,
    follow_up_id: str,
    payload: FollowUpReminderRequest,
) -> FollowUpReminderOut:
    org_id = str(current_user.org_id)
    follow_up = next(
        (item for item in await repo.list_follow_ups(org_id, limit=500) if str(item["id"]) == follow_up_id),
        None,
    )
    if not follow_up:
        raise ValueError("Follow-up not found for this organization.")
    if str(follow_up.get("status") or "") != "scheduled":
        raise ValueError("This patient has already left the active follow-up list.")
    appointment = await repo.get_appointment_for_follow_up(org_id, follow_up_id)
    if appointment and str(appointment.get("status") or "") in {"scheduled", "checked_in"}:
        raise ValueError("This patient has already scheduled an appointment.")

    tracked = await enrich_follow_up_tracking(repo, follow_up)
    last_contacted_at = tracked.get("last_contacted_at")
    if last_contacted_at:
        elapsed = datetime.now(UTC) - _as_utc_minute(last_contacted_at)
        if elapsed < timedelta(hours=24):
            retry_at = _as_utc_minute(last_contacted_at) + timedelta(hours=24)
            raise ValueError(f"A reminder was sent recently. Try again after {retry_at.isoformat()}.")

    patient = await repo.get_patient(org_id, str(follow_up["patient_id"]))
    clinic_settings = await repo.get_clinic_settings(org_id)
    requested_channels = list(dict.fromkeys(payload.channels))
    channel_statuses: dict[str, str] = {}
    errors: dict[str, str] = {}

    if "email" in requested_channels:
        try:
            await _send_follow_up_email(
                repo,
                current_user,
                follow_up,
                mark_automatic_reminder=False,
                message_key=f"manual-{payload.idempotency_key}",
            )
            channel_statuses["email"] = "sent"
        except Exception as exc:
            channel_statuses["email"] = "failed"
            errors["email"] = str(getattr(exc, "detail", exc))[:500]

    if "whatsapp" in requested_channels:
        try:
            event = await send_follow_up_booking_invitation(
                repo,
                org_id=org_id,
                follow_up=follow_up,
                patient=patient,
                clinic_settings=clinic_settings,
                idempotency_key=f"follow-up:{follow_up_id}:reminder:{payload.idempotency_key}",
                intent="follow_up_booking_reminder",
            )
            if event is None:
                raise RuntimeError("WhatsApp reminders are not configured.")
            channel_statuses["whatsapp"] = "sent"
        except Exception as exc:
            channel_statuses["whatsapp"] = "failed"
            errors["whatsapp"] = str(getattr(exc, "detail", exc))[:500]

    successful = sum(status == "sent" for status in channel_statuses.values())
    delivery_status = "sent" if successful == len(requested_channels) else "partial" if successful else "failed"
    sent_at = datetime.now(UTC)
    await write_audit_event(
        repo,
        current_user,
        entity_type="follow_up",
        entity_id=follow_up_id,
        action="follow_up_reminder_sent",
        summary=f"Sent a follow-up reminder to {str(patient.get('name') or 'the patient').strip()}.",
        metadata={
            "channels": requested_channels,
            "channel_statuses": channel_statuses,
            "delivery_status": delivery_status,
            "error": "; ".join(f"{channel}: {message}" for channel, message in errors.items()),
            "idempotency_key": payload.idempotency_key,
        },
    )
    return FollowUpReminderOut(
        follow_up_id=follow_up_id,
        sent_at=sent_at,
        delivery_status=delivery_status,
        channels=channel_statuses,
        errors=errors,
    )


async def _record_immediate_reminder_failure(
    repo: AppRepository,
    current_user: UserOut,
    follow_up: dict,
    exc: Exception,
) -> None:
    logger.warning(
        "Immediate follow-up reminder failed for org=%s follow_up=%s: %s",
        current_user.org_id,
        follow_up.get("id"),
        exc,
    )
    create_platform_error = getattr(repo, "create_platform_error", None)
    if not callable(create_platform_error):
        return
    try:
        await create_platform_error(
            org_id=str(current_user.org_id),
            user_id=str(current_user.id),
            identifier=current_user.identifier,
            path="/follow-ups/immediate-reminder",
            method="BACKGROUND",
            status_code=None,
            error_type=type(exc).__name__,
            message=str(exc),
            details="Immediate follow-up reminder email failed after create/update.",
            context={
                "follow_up_id": str(follow_up.get("id") or ""),
                "patient_id": str(follow_up.get("patient_id") or ""),
            },
        )
    except Exception:
        logger.exception("Failed to record immediate follow-up reminder delivery failure.")


async def _record_booking_invitation_failure(
    repo: AppRepository,
    current_user: UserOut,
    follow_up: dict,
    exc: Exception,
) -> None:
    logger.warning(
        "Follow-up WhatsApp invitation failed for org=%s follow_up=%s: %s",
        current_user.org_id,
        follow_up.get("id"),
        exc,
    )
    create_platform_error = getattr(repo, "create_platform_error", None)
    if not callable(create_platform_error):
        return
    try:
        await create_platform_error(
            org_id=str(current_user.org_id),
            user_id=str(current_user.id),
            identifier=current_user.identifier,
            path="/follow-ups/whatsapp-invitation",
            method="BACKGROUND",
            status_code=None,
            error_type=type(exc).__name__,
            message=str(exc),
            details="The one-time WhatsApp follow-up booking invitation failed after creation.",
            context={
                "follow_up_id": str(follow_up.get("id") or ""),
                "patient_id": str(follow_up.get("patient_id") or ""),
            },
        )
    except Exception:
        logger.exception("Failed to record WhatsApp follow-up invitation failure.")


async def send_due_follow_up_emails_workflow(
    repo: AppRepository,
    current_user: UserOut,
) -> None:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    now = datetime.now(UTC)
    lead_hours = max(
        1,
        min(int(getattr(get_settings(), "follow_up_reminder_lead_hours", 24)), 168),
    )
    due_follow_ups = await repo.claim_due_follow_ups(
        str(current_user.org_id),
        now.isoformat(),
        (now + timedelta(hours=lead_hours)).isoformat(),
    )
    for follow_up in due_follow_ups:
        try:
            await _send_follow_up_email_if_needed(repo, current_user, follow_up)
        except (RuntimeError, EmailDeliveryError) as exc:
            await repo.release_follow_up_reminder_claim(
                str(current_user.org_id),
                str(follow_up["id"]),
                str(exc),
            )


async def get_follow_up_booking_context_workflow(
    repo: AppRepository,
    token: str,
) -> tuple[dict, dict, dict, dict | None, list[datetime]]:
    payload = decode_follow_up_booking_token(token)
    org_id = str(payload["org_id"])
    patient_id = str(payload["patient_id"])
    follow_up_id = str(payload["follow_up_id"])
    await expire_stale_schedule_workflow(repo, org_id)
    follow_up = next((item for item in await repo.list_follow_ups_for_patient(org_id, patient_id) if str(item["id"]) == follow_up_id), None)
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found.")
    appointment = await repo.get_appointment_for_follow_up(org_id, follow_up_id)
    if str(follow_up.get("status") or "") != "scheduled" and not appointment:
        raise HTTPException(status_code=400, detail="This follow-up is no longer available for booking.")
    patient = await repo.get_patient(org_id, patient_id)
    clinic_settings = await repo.get_clinic_settings(org_id)
    suggested_slots = await _suggest_follow_up_slots(repo, org_id, clinic_settings, earliest_at=_as_utc_minute(follow_up["scheduled_for"]))
    return follow_up, patient, clinic_settings, appointment, suggested_slots


async def self_book_follow_up_workflow(
    repo: AppRepository,
    token: str,
    scheduled_for: datetime,
) -> None:
    follow_up, patient, clinic_settings, existing_appointment, _suggested_slots = await get_follow_up_booking_context_workflow(repo, token)
    org_id = str(follow_up["org_id"])
    patient_id = str(follow_up["patient_id"])
    follow_up_id = str(follow_up["id"])
    scheduled_for = _as_utc_minute(scheduled_for)
    if scheduled_for < datetime.now(UTC):
        raise HTTPException(status_code=400, detail="Follow-up time must be in the future.")
    if not _is_within_booking_window(scheduled_for, clinic_settings):
        raise HTTPException(status_code=400, detail="Follow-up time must be within clinic booking hours.")
    capacity = _appointments_per_hour(clinic_settings)
    timezone = str(clinic_settings.get("timezone") or "UTC")
    if existing_appointment and str(existing_appointment.get("status") or "") == "checked_in":
        raise HTTPException(status_code=400, detail="This appointment has already been checked in.")
    actor_name = str(clinic_settings.get("doctor_name") or clinic_settings.get("clinic_name") or "Clinic Team").strip() or "Clinic Team"
    was_rescheduled = bool(existing_appointment)
    await repo.self_book_follow_up_atomic(
        org_id=org_id,
        patient_id=patient_id,
        follow_up_id=follow_up_id,
        scheduled_for=scheduled_for,
        appointments_per_hour=capacity,
        timezone=timezone,
        audit_event_factory=lambda saved: [{
            "org_id": org_id,
            "actor_user_id": None,
            "actor_name": actor_name,
            "entity_type": "appointment",
            "entity_id": str(saved["id"]),
            "action": "appointment_rescheduled" if was_rescheduled else "appointment_created",
            "summary": (
                f"Rescheduled appointment for {saved['name']} to {saved['scheduled_for']}."
                if was_rescheduled
                else f"Booked appointment for {saved['name']} on {saved['scheduled_for']}."
            ),
            "metadata": {
                "patient_name": saved.get("name"),
                "status": saved.get("status"),
                "source": "public_follow_up_booking",
            },
        }],
    )


async def cancel_self_booked_follow_up_workflow(
    repo: AppRepository,
    token: str,
) -> None:
    follow_up, _patient, clinic_settings, appointment, _suggested_slots = await get_follow_up_booking_context_workflow(repo, token)
    if not appointment:
        raise HTTPException(status_code=400, detail="There is no booked appointment to cancel.")
    if str(appointment.get("status") or "") != "scheduled":
        raise HTTPException(status_code=400, detail="This appointment is not currently scheduled.")
    actor_name = str(clinic_settings.get("doctor_name") or clinic_settings.get("clinic_name") or "Clinic Team").strip() or "Clinic Team"
    await repo.cancel_self_booked_follow_up_appointment(
        org_id=str(follow_up["org_id"]),
        patient_id=str(follow_up["patient_id"]),
        follow_up_id=str(follow_up["id"]),
        audit_event_factory=lambda saved: [{
            "org_id": str(follow_up["org_id"]),
            "actor_user_id": None,
            "actor_name": actor_name,
            "entity_type": "appointment",
            "entity_id": str(saved["id"]),
            "action": "appointment_cancelled",
            "summary": f"Cancelled appointment for {saved['name']} scheduled on {saved['scheduled_for']}.",
            "metadata": {
                "patient_name": saved.get("name"),
                "status": saved.get("status"),
                "source": "public_follow_up_booking",
            },
        }],
    )


async def create_follow_up_workflow(
    repo: AppRepository,
    current_user: UserOut,
    patient_id: str,
    payload: FollowUpCreate,
) -> FollowUpOut:
    scheduled_for = _as_utc_minute(payload.scheduled_for)
    if scheduled_for <= datetime.now(UTC):
        raise ValueError("Follow-up time must be in the future.")
    created = await repo.create_follow_up(
        str(current_user.org_id),
        patient_id,
        str(current_user.id),
        payload,
    )
    patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    await record_follow_up_created(
        repo,
        current_user,
        created,
        patient_name,
        format_display_datetime(created["scheduled_for"], str(clinic_settings.get("timezone") or "UTC")),
    )
    invitation_channels: list[str] = []
    invitation_errors: dict[str, str] = {}
    try:
        whatsapp_event = await send_follow_up_booking_invitation(
            repo,
            org_id=str(current_user.org_id),
            follow_up=created,
            patient=patient,
            clinic_settings=clinic_settings,
        )
        if whatsapp_event is not None:
            invitation_channels.append("whatsapp")
    except Exception as exc:
        invitation_errors["whatsapp"] = str(getattr(exc, "detail", exc))[:500]
        await _record_booking_invitation_failure(repo, current_user, created, exc)
    try:
        await _send_follow_up_email(
            repo,
            current_user,
            created,
            mark_automatic_reminder=False,
            message_key="invitation",
        )
        invitation_channels.append("email")
    except (RuntimeError, EmailDeliveryError) as exc:
        invitation_errors["email"] = str(getattr(exc, "detail", exc))[:500]
        await _record_immediate_reminder_failure(repo, current_user, created, exc)
    delivery_status = (
        "sent"
        if invitation_channels and not invitation_errors
        else "partial"
        if invitation_channels
        else "failed"
    )
    await write_audit_event(
        repo,
        current_user,
        entity_type="follow_up",
        entity_id=str(created["id"]),
        action="follow_up_invitation_sent",
        summary=f"Sent a follow-up booking invitation to {patient_name}.",
        metadata={
            "channels": invitation_channels,
            "delivery_status": delivery_status,
            "error": "; ".join(f"{channel}: {message}" for channel, message in invitation_errors.items()),
        },
    )
    return FollowUpOut(**(await enrich_follow_up_tracking(repo, {**created, "patient_name": patient_name, "patient_email": patient.get("email"), "patient_phone": patient.get("phone")})))


async def update_follow_up_workflow(
    repo: AppRepository,
    current_user: UserOut,
    follow_up_id: str,
    payload: FollowUpUpdate,
) -> FollowUpOut:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    if payload.scheduled_for is not None and _as_utc_minute(payload.scheduled_for) <= datetime.now(UTC):
        raise ValueError("Follow-up time must be in the future.")
    updated = await repo.update_follow_up(str(current_user.org_id), follow_up_id, payload)
    changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
    await record_follow_up_updated(repo, current_user, updated, changed_fields)
    if updated.get("status") == "scheduled":
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        scheduled_at = updated["scheduled_for"]
        lead_hours = max(
            1,
            min(int(getattr(get_settings(), "follow_up_reminder_lead_hours", 24)), 168),
        )
        if _as_utc_minute(scheduled_at) <= datetime.now(UTC) + timedelta(hours=lead_hours):
            try:
                await _send_follow_up_email_if_needed(repo, current_user, updated)
            except (RuntimeError, EmailDeliveryError) as exc:
                await _record_immediate_reminder_failure(repo, current_user, updated, exc)
    return FollowUpOut(**updated)
