from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error, internal_server_error
from app.auth import require_admin_or_doctor
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.referrals import (
    ReferralPackageCreate, ReferralPackageOut, ReferralPackageSend, ReferralPackageSendResponse,
)
from app.services.referral_workflow import (
    create_referral_package_workflow, download_referral_package_workflow,
    get_referral_package_workflow, list_referral_packages_workflow, send_referral_package_workflow,
)
from app.storage import PatientAttachmentStorage, get_patient_attachment_storage


router = APIRouter()


@router.post(
    "/patients/{patient_id}/referral-packages",
    response_model=ReferralPackageOut,
    status_code=201,
)
async def create_referral_package(
    patient_id: str,
    payload: ReferralPackageCreate,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(require_admin_or_doctor),
) -> ReferralPackageOut:
    try:
        return await create_referral_package_workflow(repo, storage, current_user, patient_id, payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_referral_package") from exc


@router.get("/patients/{patient_id}/referral-packages", response_model=list[ReferralPackageOut])
async def list_referral_packages(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin_or_doctor),
) -> list[ReferralPackageOut]:
    try:
        return await list_referral_packages_workflow(repo, current_user, patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/referral-packages/{package_id}", response_model=ReferralPackageOut)
async def get_referral_package(
    package_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin_or_doctor),
) -> ReferralPackageOut:
    try:
        return await get_referral_package_workflow(repo, current_user, package_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/referral-packages/{package_id}/file")
async def download_referral_package(
    package_id: str,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(require_admin_or_doctor),
) -> StreamingResponse:
    try:
        package, raw_bytes = await download_referral_package_workflow(repo, storage, current_user, package_id)
        return StreamingResponse(
            BytesIO(raw_bytes), media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{package["file_name"]}"'},
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="download_referral_package") from exc


@router.post("/referral-packages/{package_id}/send", response_model=ReferralPackageSendResponse)
async def send_referral_package(
    package_id: str,
    payload: ReferralPackageSend,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(require_admin_or_doctor),
) -> ReferralPackageSendResponse:
    try:
        return await send_referral_package_workflow(repo, storage, current_user, package_id, payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="send_referral_package") from exc
