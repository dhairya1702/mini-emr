from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.db import SupabaseRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.common import AppointmentStatus
from app.schema_domains.patients import (
    AppointmentCheckInRequest,
    AppointmentCreate,
    AppointmentOut,
    AppointmentUpdate,
    PatientMatchOut,
    PatientOut,
)
from app.services.appointment_workflow import (
    check_in_appointment_workflow,
    create_appointment_workflow,
    update_appointment_workflow,
)


router = APIRouter()


def _utc_day_bounds(day: date) -> tuple[str, str]:
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


@router.post("/appointments", response_model=AppointmentOut, status_code=201)
async def create_appointment(
    payload: AppointmentCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> AppointmentOut:
    try:
        return await create_appointment_workflow(repo, current_user, payload)
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_appointment") from exc


@router.get("/appointments", response_model=list[AppointmentOut])
async def list_appointments(
    status: AppointmentStatus | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    scheduled_date: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[AppointmentOut]:
    effective_date = scheduled_date or datetime.now(UTC).date()
    scheduled_from, scheduled_to = _utc_day_bounds(effective_date)
    appointments = await repo.list_appointments(
        str(current_user.org_id),
        status=status,
        query=q,
        limit=limit,
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
    )
    return [AppointmentOut(**appointment) for appointment in appointments]


@router.post("/appointments/{appointment_id}/check-in", response_model=PatientOut)
async def check_in_appointment(
    appointment_id: str,
    payload: AppointmentCheckInRequest | None = None,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        return await check_in_appointment_workflow(repo, current_user, appointment_id, payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="check_in_appointment") from exc


@router.get("/appointments/{appointment_id}/check-in-preview", response_model=list[PatientMatchOut])
async def preview_check_in_appointment(
    appointment_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientMatchOut]:
    try:
        matches = await repo.list_potential_check_in_matches(str(current_user.org_id), appointment_id)
        return [PatientMatchOut(**match) for match in matches]
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="preview_check_in_appointment") from exc


@router.patch("/appointments/{appointment_id}", response_model=AppointmentOut)
async def update_appointment(
    appointment_id: str,
    payload: AppointmentUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> AppointmentOut:
    try:
        return await update_appointment_workflow(repo, current_user, appointment_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_appointment") from exc
