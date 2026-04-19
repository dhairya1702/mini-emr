from fastapi import HTTPException

from app.db import DuplicateCheckInCandidateError, SupabaseRepository
from app.schemas import AppointmentCheckInRequest, AppointmentCreate, AppointmentOut, AppointmentUpdate, PatientMatchOut, PatientOut, UserOut
from app.services.audit_service import (
    record_appointment_checked_in,
    record_appointment_created,
    record_appointment_updated,
)


async def create_appointment_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: AppointmentCreate,
) -> AppointmentOut:
    created = await repo.create_appointment(str(current_user.org_id), payload)
    await record_appointment_created(repo, current_user, created)
    return AppointmentOut(**created)


async def check_in_appointment_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    appointment_id: str,
    payload: AppointmentCheckInRequest | None = None,
) -> PatientOut:
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
    repo: SupabaseRepository,
    current_user: UserOut,
    appointment_id: str,
    payload: AppointmentUpdate,
) -> AppointmentOut:
    updated = await repo.update_appointment(str(current_user.org_id), appointment_id, payload)
    changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
    await record_appointment_updated(repo, current_user, updated, changed_fields)
    return AppointmentOut(**updated)
