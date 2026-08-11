from ipaddress import ip_address

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.api_errors import bad_request_error
from app.db import AppRepository, get_repository
from app.schema_domains.patients import (
    AppointmentCreate,
    FollowUpBookingCancelRequest,
    FollowUpBookingContextOut,
    FollowUpBookingRequest,
)
from app.schema_domains.checkins import (
    PublicAppointmentCreate,
    PublicAppointmentManageRequest,
    PublicAppointmentOut,
    PublicAppointmentSlotsOut,
    PublicCheckInContextOut,
    PublicCheckInCreate,
    PublicCheckInStatusOut,
    PublicCheckInSubmittedOut,
)
from app.services.auth_flow import enforce_repository_rate_limit
from app.services.followup_workflow import (
    cancel_self_booked_follow_up_workflow,
    get_follow_up_booking_context_workflow,
    self_book_follow_up_workflow,
)
from app.services.public_appointment_workflow import (
    cancel_public_appointment,
    create_public_appointment,
    get_public_appointment_context,
    get_public_appointment_slots,
    reschedule_public_appointment,
)


router = APIRouter()


def _public_client_ip(request: Request) -> str:
    # Google external load balancers append the verified client IP and then
    # the forwarding-rule IP. Any caller-supplied values remain to their left,
    # so the penultimate entry is the spoof-resistant client address.
    forwarded = [
        value.strip()
        for value in request.headers.get("x-forwarded-for", "").split(",")
        if value.strip()
    ]
    candidates = [forwarded[-2]] if len(forwarded) >= 2 else []
    if request.client and request.client.host:
        candidates.append(request.client.host)
    for candidate in candidates:
        try:
            return ip_address(candidate).compressed
        except ValueError:
            continue
    return "unknown"


def _public_appointment_view(
    appointment: dict,
    clinic_settings: dict,
    booking_token: str,
    suggested_slots: list,
) -> PublicAppointmentOut:
    return PublicAppointmentOut(
        appointment_id=appointment["id"],
        patient_name=appointment["name"],
        clinic_name=str(clinic_settings.get("clinic_name") or "ClinicOS"),
        timezone=str(clinic_settings.get("timezone") or "UTC"),
        scheduled_for=appointment["scheduled_for"],
        status=appointment["status"],
        booking_token=booking_token,
        suggested_slots=suggested_slots,
    )


@router.get("/public/check-in", response_model=PublicCheckInContextOut)
async def get_public_check_in(
    token: str = Query(..., min_length=36, max_length=36),
    repo: AppRepository = Depends(get_repository),
) -> PublicCheckInContextOut:
    try:
        await enforce_repository_rate_limit(repo, "public_check_in_get", token)
        config = await repo.get_public_check_in_config_by_token(token)
        return PublicCheckInContextOut(
            clinic_name=config["clinic_name"],
            clinic_address=config["clinic_address"],
            clinic_phone=config["clinic_phone"],
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/check-in", response_model=PublicCheckInSubmittedOut, status_code=201)
async def create_public_check_in(
    payload: PublicCheckInCreate,
    repo: AppRepository = Depends(get_repository),
) -> PublicCheckInSubmittedOut:
    try:
        config = await repo.get_public_check_in_config_by_token(str(payload.token))
        await enforce_repository_rate_limit(
            repo,
            "public_check_in_post",
            f"{payload.token}:{payload.phone}",
        )
        created = await repo.create_public_check_in_request(
            org_id=config["org_id"],
            name=payload.name,
            phone=payload.phone,
            email=payload.email,
            date_of_birth=payload.date_of_birth,
            sex_at_birth=payload.sex_at_birth,
            reason=payload.reason,
        )
        return PublicCheckInSubmittedOut(
            id=created["id"],
            status=created["status"],
            clinic_name=config["clinic_name"],
            tracking_token=created["tracking_token"],
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/public/check-in/status", response_model=PublicCheckInStatusOut)
async def get_public_check_in_status(
    x_check_in_token: str = Header(..., min_length=32, max_length=200),
    repo: AppRepository = Depends(get_repository),
) -> PublicCheckInStatusOut:
    try:
        await enforce_repository_rate_limit(repo, "public_check_in_status", x_check_in_token)
        row = await repo.get_public_check_in_status(x_check_in_token)
        return PublicCheckInStatusOut(status=row["status"])
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Check-in request not found.") from exc


@router.get("/public/check-in/appointment-slots", response_model=PublicAppointmentSlotsOut)
async def list_public_appointment_slots(
    token: str = Query(..., min_length=36, max_length=36),
    repo: AppRepository = Depends(get_repository),
) -> PublicAppointmentSlotsOut:
    try:
        await enforce_repository_rate_limit(repo, "public_appointment_get", token)
        config, clinic_settings, slots = await get_public_appointment_slots(repo, token)
        return PublicAppointmentSlotsOut(
            clinic_name=config["clinic_name"],
            timezone=str(clinic_settings.get("timezone") or "UTC"),
            suggested_slots=slots,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/check-in/appointment", response_model=PublicAppointmentOut, status_code=201)
async def book_public_appointment(
    payload: PublicAppointmentCreate,
    request: Request,
    repo: AppRepository = Depends(get_repository),
) -> PublicAppointmentOut:
    try:
        config = await repo.get_public_check_in_config_by_token(str(payload.token))
        await enforce_repository_rate_limit(
            repo,
            "public_appointment_post_ip",
            _public_client_ip(request),
        )
        await enforce_repository_rate_limit(
            repo,
            "public_appointment_post_clinic",
            str(config["org_id"]),
        )
        await enforce_repository_rate_limit(
            repo,
            "public_appointment_post",
            f"{payload.token}:{payload.phone}",
        )
        appointment, clinic_settings, booking_token, slots = await create_public_appointment(
            repo,
            clinic_token=str(payload.token),
            payload=AppointmentCreate(
                name=payload.name,
                phone=payload.phone,
                email=payload.email,
                reason=payload.reason,
                date_of_birth=payload.date_of_birth,
                sex_at_birth=payload.sex_at_birth,
                scheduled_for=payload.scheduled_for,
            ),
        )
        return _public_appointment_view(appointment, clinic_settings, booking_token, slots)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/public/check-in/appointment", response_model=PublicAppointmentOut)
async def get_public_appointment(
    booking_token: str = Query(..., min_length=20),
    repo: AppRepository = Depends(get_repository),
) -> PublicAppointmentOut:
    try:
        await enforce_repository_rate_limit(repo, "public_appointment_get", booking_token)
        appointment, clinic_settings, slots = await get_public_appointment_context(repo, booking_token)
        return _public_appointment_view(appointment, clinic_settings, booking_token, slots)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/check-in/appointment/reschedule", response_model=PublicAppointmentOut)
async def reschedule_public_appointment_route(
    payload: PublicAppointmentManageRequest,
    repo: AppRepository = Depends(get_repository),
) -> PublicAppointmentOut:
    if payload.scheduled_for is None:
        raise bad_request_error(ValueError("Choose an appointment time."))
    try:
        await enforce_repository_rate_limit(repo, "public_appointment_post", payload.booking_token)
        appointment, clinic_settings, slots = await reschedule_public_appointment(
            repo,
            booking_token=payload.booking_token,
            scheduled_for=payload.scheduled_for,
        )
        return _public_appointment_view(
            appointment,
            clinic_settings,
            payload.booking_token,
            slots,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/public/check-in/appointment/cancel", response_model=PublicAppointmentOut)
async def cancel_public_appointment_route(
    payload: PublicAppointmentManageRequest,
    repo: AppRepository = Depends(get_repository),
) -> PublicAppointmentOut:
    try:
        await enforce_repository_rate_limit(repo, "public_appointment_post", payload.booking_token)
        appointment, clinic_settings = await cancel_public_appointment(repo, payload.booking_token)
        return _public_appointment_view(
            appointment,
            clinic_settings,
            payload.booking_token,
            [],
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc


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
