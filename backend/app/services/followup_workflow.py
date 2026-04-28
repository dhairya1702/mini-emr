from datetime import UTC, datetime
from fastapi import HTTPException

from app.config import get_settings
from app.db import SupabaseRepository
from app.formatting import format_display_datetime
from app.schemas import AppointmentCreate, FollowUpCreate, FollowUpOut, FollowUpUpdate, UserOut
from app.services.audit_service import record_follow_up_created, record_follow_up_updated
from app.services.followup_booking_service import create_follow_up_booking_token, decode_follow_up_booking_token
from app.services.email_service import send_clinic_email_message

FOLLOW_UP_SUGGESTION_HOURS = (10, 12, 16, 18)
FOLLOW_UP_SUGGESTION_DAYS = 7


def _start_of_today_utc() -> datetime:
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def _as_utc_minute(value: object) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo:
        return parsed.astimezone(UTC).replace(second=0, microsecond=0)
    return parsed.replace(tzinfo=UTC, second=0, microsecond=0)


def _follow_up_email_parts(*, clinic_name: str, patient_name: str, scheduled_for: str, notes: str, clinic_phone: str, booking_link: str) -> tuple[str, str]:
    booking_line = f"To confirm or reschedule, use this link: {booking_link}" if booking_link else (
        f"To confirm or reschedule, contact the clinic{f' at {clinic_phone}' if clinic_phone else ''}."
    )
    subject = f"{clinic_name} follow-up reminder for {patient_name}"
    body = (
        f"Hello {patient_name},\n\n"
        f"This is a reminder for your follow-up with {clinic_name} on {scheduled_for}.\n\n"
        f"Notes: {notes or 'Please return for the planned review.'}\n\n"
        f"{booking_line}\n"
    )
    return subject, body


async def _suggest_follow_up_slots(repo: SupabaseRepository, org_id: str) -> list[datetime]:
    scheduled_appointments = await repo.list_appointments(org_id, status="scheduled", limit=500)
    occupied = {
        _as_utc_minute(appointment["scheduled_for"])
        for appointment in scheduled_appointments
    }
    suggestions: list[datetime] = []
    cursor = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    for day_offset in range(FOLLOW_UP_SUGGESTION_DAYS):
        day = cursor.date().fromordinal(cursor.date().toordinal() + day_offset)
        if day.weekday() == 6:
            continue
        for hour in FOLLOW_UP_SUGGESTION_HOURS:
            candidate = datetime(day.year, day.month, day.day, hour, 0, tzinfo=UTC)
            if candidate <= datetime.now(UTC):
                continue
            if candidate in occupied:
                continue
            suggestions.append(candidate)
            if len(suggestions) >= 10:
                return suggestions
    return suggestions


async def expire_stale_schedule_workflow(repo: SupabaseRepository, org_id: str) -> None:
    stale_before = _start_of_today_utc().isoformat()
    await repo.cancel_expired_appointments(org_id, stale_before)
    await repo.cancel_expired_follow_ups(org_id, stale_before)


async def _send_follow_up_email_if_needed(repo: SupabaseRepository, current_user: UserOut, follow_up: dict) -> None:
    patient = await repo.get_patient(str(current_user.org_id), str(follow_up["patient_id"]))
    recipient = str(patient.get("email") or "").strip()
    if not recipient:
        return
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    scheduled_for = format_display_datetime(follow_up["scheduled_for"])
    booking_token = create_follow_up_booking_token(
        org_id=str(current_user.org_id),
        patient_id=str(follow_up["patient_id"]),
        follow_up_id=str(follow_up["id"]),
    )
    booking_link = f"{get_settings().app_origin.rstrip('/')}/follow-up?token={booking_token}"
    subject, text_content = _follow_up_email_parts(
        clinic_name=clinic_name,
        patient_name=str(patient.get("name") or "Patient").strip() or "Patient",
        scheduled_for=scheduled_for,
        notes=str(follow_up.get("notes") or "").strip(),
        clinic_phone=str(clinic_settings.get("clinic_phone") or "").strip(),
        booking_link=booking_link,
    )
    try:
        await send_clinic_email_message(
            clinic_settings=clinic_settings,
            recipient=recipient,
            subject=subject,
            text_content=text_content,
        )
        await repo.mark_follow_up_reminder_sent(str(current_user.org_id), str(follow_up["id"]))
    except RuntimeError:
        return


async def send_due_follow_up_emails_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
) -> None:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    due_follow_ups = await repo.list_due_follow_ups(str(current_user.org_id), datetime.now(UTC).isoformat())
    for follow_up in due_follow_ups:
        await _send_follow_up_email_if_needed(repo, current_user, follow_up)


async def get_follow_up_booking_context_workflow(
    repo: SupabaseRepository,
    token: str,
) -> tuple[dict, dict, dict, str, list[datetime]]:
    payload = decode_follow_up_booking_token(token)
    org_id = str(payload["org_id"])
    patient_id = str(payload["patient_id"])
    follow_up_id = str(payload["follow_up_id"])
    await expire_stale_schedule_workflow(repo, org_id)
    follow_up = next((item for item in await repo.list_follow_ups_for_patient(org_id, patient_id) if str(item["id"]) == follow_up_id), None)
    if not follow_up:
        raise HTTPException(status_code=404, detail="Follow-up not found.")
    if str(follow_up.get("status") or "") != "scheduled":
        raise HTTPException(status_code=400, detail="This follow-up is no longer available for booking.")
    patient = await repo.get_patient(org_id, patient_id)
    clinic_settings = await repo.get_clinic_settings(org_id)
    suggested_slots = await _suggest_follow_up_slots(repo, org_id)
    return follow_up, patient, clinic_settings, token, suggested_slots


async def self_book_follow_up_workflow(
    repo: SupabaseRepository,
    token: str,
    scheduled_for: datetime,
) -> None:
    follow_up, patient, clinic_settings, _token, _suggested_slots = await get_follow_up_booking_context_workflow(repo, token)
    org_id = str(follow_up["org_id"])
    patient_id = str(follow_up["patient_id"])
    follow_up_id = str(follow_up["id"])
    if scheduled_for < datetime.now(UTC):
        raise HTTPException(status_code=400, detail="Follow-up time must be in the future.")
    patient = await repo.get_patient(org_id, patient_id)
    await repo.update_follow_up(org_id, follow_up_id, FollowUpUpdate(scheduled_for=scheduled_for, status="completed"))
    created = await repo.create_appointment(
        org_id,
        AppointmentCreate(
            name=str(patient.get("name") or "").strip(),
            phone=str(patient.get("phone") or "").strip(),
            email=str(patient.get("email") or "").strip(),
            address=str(patient.get("address") or "").strip(),
            reason=f"Follow-up: {str(patient.get('reason') or '').strip() or 'Review'}",
            age=patient.get("age"),
            weight=patient.get("weight"),
            height=patient.get("height"),
            temperature=patient.get("temperature"),
            scheduled_for=scheduled_for,
        ),
    )
    actor_name = str(clinic_settings.get("doctor_name") or clinic_settings.get("clinic_name") or "Clinic Team").strip() or "Clinic Team"
    await repo.create_audit_event(
        org_id=org_id,
        actor_user_id=None,
        actor_name=actor_name,
        entity_type="appointment",
        entity_id=str(created["id"]),
        action="appointment_created",
        summary=f"Booked appointment for {created['name']} on {created['scheduled_for']}.",
        metadata={
            "patient_name": created.get("name"),
            "status": created.get("status"),
            "source": "public_follow_up_booking",
        },
    )


async def create_follow_up_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    patient_id: str,
    payload: FollowUpCreate,
) -> FollowUpOut:
    created = await repo.create_follow_up(
        str(current_user.org_id),
        patient_id,
        str(current_user.id),
        payload,
    )
    patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
    await record_follow_up_created(
        repo,
        current_user,
        created,
        patient_name,
        format_display_datetime(created["scheduled_for"]),
    )
    scheduled_date = payload.scheduled_for.astimezone(UTC).date() if payload.scheduled_for.tzinfo else payload.scheduled_for.date()
    if scheduled_date <= datetime.now(UTC).date():
        await _send_follow_up_email_if_needed(repo, current_user, created)
    return FollowUpOut(**created)


async def update_follow_up_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    follow_up_id: str,
    payload: FollowUpUpdate,
) -> FollowUpOut:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    updated = await repo.update_follow_up(str(current_user.org_id), follow_up_id, payload)
    changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
    await record_follow_up_updated(repo, current_user, updated, changed_fields)
    if updated.get("status") == "scheduled":
        scheduled_at = updated["scheduled_for"]
        scheduled_date = scheduled_at.astimezone(UTC).date() if getattr(scheduled_at, "tzinfo", None) else scheduled_at.date()
        if scheduled_date <= datetime.now(UTC).date():
            await _send_follow_up_email_if_needed(repo, current_user, updated)
    return FollowUpOut(**updated)
