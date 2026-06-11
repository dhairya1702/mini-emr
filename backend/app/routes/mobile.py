from fastapi import APIRouter, Depends

from app.api_errors import bad_request_error, internal_server_error
from app.auth import require_admin
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.mobile import (
    MobileFinalizeConsultationRequest,
    MobileFinalizeConsultationResponse,
)
from app.services.mobile_workflow import finalize_mobile_consultation_workflow


router = APIRouter()


@router.post("/mobile/consultations/finalize", response_model=MobileFinalizeConsultationResponse)
async def finalize_mobile_consultation(
    payload: MobileFinalizeConsultationRequest,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> MobileFinalizeConsultationResponse:
    try:
        return await finalize_mobile_consultation_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="finalize_mobile_consultation") from exc
