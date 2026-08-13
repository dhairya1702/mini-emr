from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error
from app.auth import require_admin_or_doctor
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.care_programs import (
    CareProgramOfferingOut,
    MyopiaOfferingUpdate,
    ProgramAssigneeUpdate,
    ProgramCancellationRequest,
    ProgramEnrollmentOut,
    ProgramEnrollmentSummaryOut,
    ProgramReportCreate,
    ProgramReportOut,
    ProgramReportWhatsAppRequest,
    ProgramReviewCompleteRequest,
)
from app.services.care_program_workflow import (
    assign_enrollment_workflow,
    build_report_pdf_workflow,
    cancel_enrollment_workflow,
    complete_review_workflow,
    create_report_workflow,
    get_enrollment_workflow,
    get_offerings_workflow,
    list_enrollments_workflow,
    send_report_whatsapp_workflow,
    upsert_myopia_offering_workflow,
)


router = APIRouter()


@router.get("/care-programs/offerings", response_model=list[CareProgramOfferingOut])
async def get_care_program_offerings(
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> list[CareProgramOfferingOut]:
    try:
        return await get_offerings_workflow(repo, current_user)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.put("/care-programs/offerings/myopia-care", response_model=CareProgramOfferingOut)
async def put_myopia_care_offering(
    payload: MyopiaOfferingUpdate,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> CareProgramOfferingOut:
    try:
        return await upsert_myopia_offering_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/care-programs/enrollments", response_model=list[ProgramEnrollmentSummaryOut])
async def list_care_program_enrollments(
    patient_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> list[ProgramEnrollmentSummaryOut]:
    return await list_enrollments_workflow(
        repo, current_user, patient_id=patient_id, status=status
    )


@router.get("/care-programs/enrollments/{enrollment_id}", response_model=ProgramEnrollmentOut)
async def get_care_program_enrollment(
    enrollment_id: str,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> ProgramEnrollmentOut:
    try:
        return await get_enrollment_workflow(repo, current_user, enrollment_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.patch("/care-programs/enrollments/{enrollment_id}/assignee", response_model=ProgramEnrollmentOut)
async def assign_care_program_enrollment(
    enrollment_id: str,
    payload: ProgramAssigneeUpdate,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> ProgramEnrollmentOut:
    try:
        return await assign_enrollment_workflow(
            repo, current_user, enrollment_id, str(payload.responsible_user_id)
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/care-programs/enrollments/{enrollment_id}/cancel", response_model=ProgramEnrollmentOut)
async def cancel_care_program_enrollment(
    enrollment_id: str,
    payload: ProgramCancellationRequest,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> ProgramEnrollmentOut:
    try:
        return await cancel_enrollment_workflow(repo, current_user, enrollment_id, payload.reason)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post(
    "/care-programs/enrollments/{enrollment_id}/reviews/{event_id}/complete",
    response_model=ProgramEnrollmentOut,
)
async def complete_care_program_review(
    enrollment_id: str,
    event_id: str,
    payload: ProgramReviewCompleteRequest,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> ProgramEnrollmentOut:
    try:
        return await complete_review_workflow(
            repo, current_user, enrollment_id, event_id, str(payload.myopia_measurement_id)
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post(
    "/care-programs/enrollments/{enrollment_id}/reviews/{event_id}/reports",
    response_model=ProgramReportOut,
)
async def create_care_program_report(
    enrollment_id: str,
    event_id: str,
    payload: ProgramReportCreate,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> ProgramReportOut:
    try:
        return await create_report_workflow(
            repo, current_user, enrollment_id, event_id, payload.clinician_comment
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/care-program-reports/{report_id}/pdf")
async def get_care_program_report_pdf(
    report_id: str,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> StreamingResponse:
    try:
        pdf, _report = await build_report_pdf_workflow(repo, current_user, report_id)
        return StreamingResponse(
            BytesIO(pdf),
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="myopia_progress_report.pdf"'},
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/care-program-reports/{report_id}/send-whatsapp")
async def send_care_program_report_whatsapp(
    report_id: str,
    payload: ProgramReportWhatsAppRequest,
    current_user: UserOut = Depends(require_admin_or_doctor),
    repo: AppRepository = Depends(get_repository),
) -> dict[str, str | bool]:
    try:
        message_id = await send_report_whatsapp_workflow(
            repo, current_user, report_id, payload.recipient_phone
        )
        return {"success": True, "message_id": message_id}
    except ValueError as exc:
        raise bad_request_error(exc) from exc
