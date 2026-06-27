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
from app.services.audit_service import (
    record_appointment_checked_in,
    record_appointment_created,
    record_appointment_updated,
)
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
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    if not _is_within_booking_window(scheduled_for, clinic_settings):
        raise ValueError("Appointment time must be within clinic booking hours.")
    created = await repo.create_appointment(
        str(current_user.org_id),
        payload,
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    await record_appointment_created(repo, current_user, created)
    return AppointmentOut(**created)


async def check_in_appointment_workflow(
    repo: AppRepository,
    current_user: UserOut,
    appointment_id: str,
    payload: AppointmentCheckInRequest | None = None,
) -> PatientOut:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    try:
        _appointment, patient = await repo.check_in_appointment(
            str(current_user.org_id),
            appointment_id,
            payload or AppointmentCheckInRequest(),
        )
    except DuplicateCheckInCandidateError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Possible duplicate active patients found.",
                "matches": [PatientMatchOut(**match).model_dump(mode="json") for match in exc.matches],
            },
        ) from exc

    await record_appointment_checked_in(repo, current_user, appointment_id, patient)
    return PatientOut(**patient)


async def update_appointment_workflow(
    repo: AppRepository,
    current_user: UserOut,
    appointment_id: str,
    payload: AppointmentUpdate,
) -> AppointmentOut:
    await expire_stale_schedule_workflow(repo, str(current_user.org_id))
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    if payload.scheduled_for is not None:
        scheduled_for = _as_utc_minute(payload.scheduled_for)
        if scheduled_for <= datetime.now(UTC):
            raise ValueError("Appointment time must be in the future.")
        if not _is_within_booking_window(scheduled_for, clinic_settings):
            raise ValueError("Appointment time must be within clinic booking hours.")
    updated = await repo.update_appointment(
        str(current_user.org_id),
        appointment_id,
        payload,
        appointments_per_hour=_appointments_per_hour(clinic_settings),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
    )
    changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
    await record_appointment_updated(repo, current_user, updated, changed_fields)
    return AppointmentOut(**updated)
