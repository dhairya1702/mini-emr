from fastapi import APIRouter, Depends, HTTPException, Query

from app.api_errors import bad_request_error
from app.db import AppRepository, get_repository
from app.schema_domains.patients import (
    FollowUpBookingCancelRequest,
    FollowUpBookingContextOut,
    FollowUpBookingRequest,
)
from app.services.auth_flow import enforce_repository_rate_limit
from app.services.followup_workflow import (
    cancel_self_booked_follow_up_workflow,
    get_follow_up_booking_context_workflow,
    self_book_follow_up_workflow,
)


router = APIRouter()


@router.get("/public/follow-up-booking", response_model=FollowUpBookingContextOut)
async def get_follow_up_booking_context(
    token: str = Query(..., min_length=20),
    repo: AppRepository = Depends(get_repository),
) -> FollowUpBookingContextOut:
    try:
        await enforce_repository_rate_limit(repo, "public_follow_up_booking_get", token)
        follow_up, patient, clinic_settings, appointment, suggested_slots = await get_follow_up_booking_context_workflow(repo, token)
        return FollowUpBookingContextOut(
            follow_up_id=follow_up["id"],
            patient_name=str(patient.get("name") or "Patient").strip() or "Patient",
            clinic_name=str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS",
            timezone=str(clinic_settings.get("timezone") or "UTC"),
            scheduled_for=follow_up["scheduled_for"],
            notes=str(follow_up.get("notes") or "").strip(),
            booking_token=token,
            appointment_id=appointment.get("id") if appointment else None,
            appointment_status=(str(appointment.get("status") or "") or None) if appointment else None,
            appointment_scheduled_for=appointment.get("scheduled_for") if appointment else None,
            suggested_slots=suggested_slots,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/follow-up-booking/cancel", status_code=204)
async def cancel_follow_up_booking(
    payload: FollowUpBookingCancelRequest,
    repo: AppRepository = Depends(get_repository),
) -> None:
    try:
        await enforce_repository_rate_limit(repo, "public_follow_up_booking_post", payload.token)
        await cancel_self_booked_follow_up_workflow(repo, payload.token)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/follow-up-booking", status_code=204)
async def book_follow_up(
    payload: FollowUpBookingRequest,
    repo: AppRepository = Depends(get_repository),
) -> None:
    try:
        await enforce_repository_rate_limit(repo, "public_follow_up_booking_post", payload.token)
        await self_book_follow_up_workflow(repo, payload.token, payload.scheduled_for)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc
