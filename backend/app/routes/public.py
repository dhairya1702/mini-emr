from fastapi import APIRouter, Depends, HTTPException, Query

from app.api_errors import bad_request_error
from app.db import SupabaseRepository, get_repository
from app.schema_domains.patients import FollowUpBookingContextOut, FollowUpBookingRequest
from app.services.auth_flow import enforce_rate_limit
from app.services.followup_workflow import get_follow_up_booking_context_workflow, self_book_follow_up_workflow


router = APIRouter()


@router.get("/public/follow-up-booking", response_model=FollowUpBookingContextOut)
async def get_follow_up_booking_context(
    token: str = Query(..., min_length=20),
    repo: SupabaseRepository = Depends(get_repository),
) -> FollowUpBookingContextOut:
    try:
        enforce_rate_limit("public_follow_up_booking_get", token)
        follow_up, patient, clinic_settings, _token, suggested_slots = await get_follow_up_booking_context_workflow(repo, token)
        return FollowUpBookingContextOut(
            follow_up_id=follow_up["id"],
            patient_name=str(patient.get("name") or "Patient").strip() or "Patient",
            clinic_name=str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS",
            scheduled_for=follow_up["scheduled_for"],
            notes=str(follow_up.get("notes") or "").strip(),
            booking_token=token,
            suggested_slots=suggested_slots,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/follow-up-booking", status_code=204)
async def book_follow_up(
    payload: FollowUpBookingRequest,
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    try:
        enforce_rate_limit("public_follow_up_booking_post", payload.token)
        await self_book_follow_up_workflow(repo, payload.token, payload.scheduled_for)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc
