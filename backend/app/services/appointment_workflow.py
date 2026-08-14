from datetime import UTC, datetime

from fastapi import HTTPException

from app.db import DuplicateCheckInCandidateError, AppRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.patients import (
    AppointmentCheckInRequest,
    AppointmentCreate,
    AppointmentOut,
    AppointmentUpdate,
    PatientMatchOut,
    PatientOut,
)
from app.services.audit_service import get_actor_name
from app.services.clinic_settings_service import get_clinic_runtime_settings
from app.services.patient_workflow import _validate_assigned_doctor
from app.services.followup_workflow import (
    _appointments_per_hour,
    _as_utc_minute,
    _is_within_booking_window,
    expire_stale_schedule_workflow,
)


async def create_appointment_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: AppointmentCreate,
) -> AppointmentOut:
    scheduled_for = _as_utc_minute(payload.scheduled_for)
    if scheduled_for <= datetime.now(UTC):
        raise ValueError("Appointment time must be in the future.")
    clinic_settings = await get_clinic_runtime_settings(repo, str(current_user.org_id))
    if not _is_within_booking_window(scheduled_for, clinic_settings):
        raise ValueError("Appointment time must be within clinic booking hours.")
    org_id = str(current_user.org_id)
    created = await repo.create_appointment(
        org_id,
        payload,
        audit_event_factory=lambda appointment: [{
            "org_id": org_id,
            "actor_user_id": str(current_user.id),
            "actor_name": get_actor_name(current_user),
            "entity_type": "appointment",
            "entity_id": str(appointment["id"]),
            "action": "appointment_created",
            "summary": f"Booked appointment for {appointment['name']} on {appointment['scheduled_for']}.",
            "metadata": {
                "patient_name": appointment.get("name"),
                "status": appointment.get("status"),
            },
        }],
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    return AppointmentOut(**created)


async def check_in_appointment_workflow(
    repo: AppRepository,
    current_user: UserOut,
    appointment_id: str,
    payload: AppointmentCheckInRequest | None = None,
) -> PatientOut:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    org_id = str(current_user.org_id)
    check_in_payload = payload or AppointmentCheckInRequest()
    await _validate_assigned_doctor(
        repo,
        current_user,
        str(check_in_payload.assigned_doctor_id) if check_in_payload.assigned_doctor_id else None,
    )
    try:
        _appointment, patient = await repo.check_in_appointment(
            org_id,
            appointment_id,
            check_in_payload,
            audit_event_factory=lambda result: [{
                "org_id": org_id,
                "actor_user_id": str(current_user.id),
                "actor_name": get_actor_name(current_user),
                "entity_type": "appointment",
                "entity_id": appointment_id,
                "action": "appointment_checked_in",
                "summary": f"Checked in appointment into patient record {result['patient']['name']}.",
                "metadata": {
                    "checked_in_patient_id": str(result["patient"]["id"]),
                    "patient_name": result["patient"].get("name"),
                },
            }],
        )
    except DuplicateCheckInCandidateError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Possible duplicate active patients found.",
                "matches": [PatientMatchOut(**match).model_dump(mode="json") for match in exc.matches],
            },
        ) from exc

    return PatientOut(**patient)


async def update_appointment_workflow(
    repo: AppRepository,
    current_user: UserOut,
    appointment_id: str,
    payload: AppointmentUpdate,
) -> AppointmentOut:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    clinic_settings = await get_clinic_runtime_settings(repo, str(current_user.org_id))
    if payload.scheduled_for is not None:
        scheduled_for = _as_utc_minute(payload.scheduled_for)
        if scheduled_for <= datetime.now(UTC):
            raise ValueError("Appointment time must be in the future.")
        if not _is_within_booking_window(scheduled_for, clinic_settings):
            raise ValueError("Appointment time must be within clinic booking hours.")
    org_id = str(current_user.org_id)
    changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
    updated = await repo.update_appointment(
        org_id,
        appointment_id,
        payload,
        audit_event_factory=lambda appointment: [{
            "org_id": org_id,
            "actor_user_id": str(current_user.id),
            "actor_name": get_actor_name(current_user),
            "entity_type": "appointment",
            "entity_id": str(appointment["id"]),
            "action": "appointment_updated",
            "summary": f"Updated appointment fields: {', '.join(changed_fields)}.",
            "metadata": {
                "changed_fields": changed_fields,
                "status": appointment.get("status"),
            },
        }],
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    return AppointmentOut(**updated)
