from datetime import UTC, datetime
from uuid import uuid4

from app.db import AppRepository
from app.schema_domains.patients import AppointmentCreate, AppointmentUpdate
from app.services.followup_booking_service import (
    create_public_appointment_booking_token,
    decode_public_appointment_booking_token,
)
from app.services.followup_workflow import (
    _appointments_per_hour,
    _as_utc_minute,
    _is_within_booking_window,
    _suggest_follow_up_slots,
    expire_stale_schedule_workflow,
)


async def get_public_appointment_slots(
    repo: AppRepository,
    clinic_token: str,
) -> tuple[dict, dict, list[datetime]]:
    config = await repo.get_public_check_in_config_by_token(clinic_token)
    org_id = str(config["org_id"])
    await expire_stale_schedule_workflow(repo, org_id)
    clinic_settings = await repo.get_clinic_settings(org_id)
    slots = await _suggest_follow_up_slots(repo, org_id, clinic_settings)
    return config, clinic_settings, slots


async def create_public_appointment(
    repo: AppRepository,
    *,
    clinic_token: str,
    payload: AppointmentCreate,
) -> tuple[dict, dict, str, list[datetime]]:
    config = await repo.get_public_check_in_config_by_token(clinic_token)
    org_id = str(config["org_id"])
    clinic_settings = await repo.get_clinic_settings(org_id)
    scheduled_for = _as_utc_minute(payload.scheduled_for)
    if scheduled_for <= datetime.now(UTC):
        raise ValueError("Appointment time must be in the future.")
    if not _is_within_booking_window(scheduled_for, clinic_settings):
        raise ValueError("Appointment time must be within clinic booking hours.")
    normalized_payload = payload.model_copy(update={"scheduled_for": scheduled_for})
    actor_name = str(
        clinic_settings.get("doctor_name")
        or clinic_settings.get("clinic_name")
        or "Clinic Team"
    ).strip() or "Clinic Team"
    appointment_id = str(uuid4())
    token = create_public_appointment_booking_token(
        org_id=org_id,
        appointment_id=appointment_id,
    )
    appointment = await repo.create_appointment(
        org_id,
        normalized_payload,
        appointment_id=appointment_id,
        reject_duplicate_phone=True,
        audit_event_factory=lambda saved: [{
            "org_id": org_id,
            "actor_user_id": None,
            "actor_name": actor_name,
            "entity_type": "appointment",
            "entity_id": str(saved["id"]),
            "action": "appointment_created",
            "summary": f"Booked public appointment for {saved['name']} on {saved['scheduled_for']}.",
            "metadata": {
                "patient_name": saved.get("name"),
                "status": saved.get("status"),
                "source": "public_qr_booking",
            },
        }],
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    slots = await _suggest_follow_up_slots(repo, org_id, clinic_settings)
    return appointment, clinic_settings, token, slots


async def get_public_appointment_context(
    repo: AppRepository,
    booking_token: str,
) -> tuple[dict, dict, list[datetime]]:
    token_payload = decode_public_appointment_booking_token(booking_token)
    org_id = str(token_payload["org_id"])
    appointment_id = str(token_payload["appointment_id"])
    await expire_stale_schedule_workflow(repo, org_id)
    appointment = await repo.get_appointment(org_id, appointment_id)
    clinic_settings = await repo.get_clinic_settings(org_id)
    slots = (
        await _suggest_follow_up_slots(repo, org_id, clinic_settings)
        if str(appointment.get("status") or "") == "scheduled"
        else []
    )
    return appointment, clinic_settings, slots


async def reschedule_public_appointment(
    repo: AppRepository,
    *,
    booking_token: str,
    scheduled_for: datetime,
) -> tuple[dict, dict, list[datetime]]:
    token_payload = decode_public_appointment_booking_token(booking_token)
    org_id = str(token_payload["org_id"])
    appointment_id = str(token_payload["appointment_id"])
    clinic_settings = await repo.get_clinic_settings(org_id)
    normalized = _as_utc_minute(scheduled_for)
    if normalized <= datetime.now(UTC):
        raise ValueError("Appointment time must be in the future.")
    if not _is_within_booking_window(normalized, clinic_settings):
        raise ValueError("Appointment time must be within clinic booking hours.")
    actor_name = str(clinic_settings.get("clinic_name") or "Clinic Team").strip() or "Clinic Team"
    updated = await repo.update_appointment(
        org_id,
        appointment_id,
        AppointmentUpdate(scheduled_for=normalized),
        audit_event_factory=lambda saved: [{
            "org_id": org_id,
            "actor_user_id": None,
            "actor_name": actor_name,
            "entity_type": "appointment",
            "entity_id": appointment_id,
            "action": "appointment_rescheduled",
            "summary": f"Rescheduled public appointment for {saved['name']} to {saved['scheduled_for']}.",
            "metadata": {"source": "public_qr_booking"},
        }],
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    slots = await _suggest_follow_up_slots(repo, org_id, clinic_settings)
    return updated, clinic_settings, slots


async def cancel_public_appointment(
    repo: AppRepository,
    booking_token: str,
) -> tuple[dict, dict]:
    token_payload = decode_public_appointment_booking_token(booking_token)
    org_id = str(token_payload["org_id"])
    appointment_id = str(token_payload["appointment_id"])
    clinic_settings = await repo.get_clinic_settings(org_id)
    actor_name = str(clinic_settings.get("clinic_name") or "Clinic Team").strip() or "Clinic Team"
    cancelled = await repo.update_appointment(
        org_id,
        appointment_id,
        AppointmentUpdate(status="cancelled"),
        audit_event_factory=lambda saved: [{
            "org_id": org_id,
            "actor_user_id": None,
            "actor_name": actor_name,
            "entity_type": "appointment",
            "entity_id": appointment_id,
            "action": "appointment_cancelled",
            "summary": f"Cancelled public appointment for {saved['name']}.",
            "metadata": {"source": "public_qr_booking"},
        }],
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    return cancelled, clinic_settings
