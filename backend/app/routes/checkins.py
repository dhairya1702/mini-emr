from fastapi import APIRouter, Depends, HTTPException

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user, require_admin
from app.config import get_settings
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.checkins import (
    CheckInApproveRequest,
    CheckInConfigOut,
    CheckInConfigUpdate,
    CheckInRejectRequest,
    CheckInRequestOut,
)
from app.schema_domains.patients import PatientOut
from app.services.audit_service import write_audit_event_best_effort


router = APIRouter()


def _config_view(config: dict) -> CheckInConfigOut:
    return CheckInConfigOut(
        enabled=bool(config["enabled"]),
        token=config["token"],
        public_url=f"{get_settings().app_origin.rstrip('/')}/check-in?token={config['token']}",
    )


@router.get("/check-in/config", response_model=CheckInConfigOut)
async def get_check_in_config(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> CheckInConfigOut:
    try:
        return _config_view(await repo.get_public_check_in_config(str(current_user.org_id)))
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:
        raise internal_server_error(exc, context="get_check_in_config") from exc


@router.patch("/check-in/config", response_model=CheckInConfigOut)
async def update_check_in_config(
    payload: CheckInConfigUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> CheckInConfigOut:
    try:
        saved = await repo.update_public_check_in_enabled(str(current_user.org_id), payload.enabled)
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="clinic",
            entity_id=str(current_user.org_id),
            action="public_check_in_updated",
            summary=f"{'Enabled' if payload.enabled else 'Disabled'} public QR check-in.",
            metadata={"enabled": payload.enabled},
        )
        return _config_view(saved)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:
        raise internal_server_error(exc, context="update_check_in_config") from exc


@router.post("/check-in/config/regenerate", response_model=CheckInConfigOut)
async def regenerate_check_in_config(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> CheckInConfigOut:
    try:
        saved = await repo.regenerate_public_check_in_token(str(current_user.org_id))
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="clinic",
            entity_id=str(current_user.org_id),
            action="public_check_in_link_regenerated",
            summary="Regenerated the public QR check-in link.",
            metadata={},
        )
        return _config_view(saved)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:
        raise internal_server_error(exc, context="regenerate_check_in_config") from exc


@router.get("/check-in/requests", response_model=list[CheckInRequestOut])
async def list_check_in_requests(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[CheckInRequestOut]:
    try:
        return [
            CheckInRequestOut(**row)
            for row in await repo.list_public_check_in_requests(str(current_user.org_id))
        ]
    except Exception as exc:
        raise internal_server_error(exc, context="list_check_in_requests") from exc


@router.post("/check-in/requests/{request_id}/approve", response_model=PatientOut)
async def approve_check_in_request(
    request_id: str,
    payload: CheckInApproveRequest,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        patient = await repo.approve_public_check_in_request(
            org_id=str(current_user.org_id),
            request_id=request_id,
            reviewed_by=str(current_user.id),
            existing_patient_id=str(payload.existing_patient_id) if payload.existing_patient_id else None,
        )
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient",
            entity_id=str(patient["id"]),
            action="public_check_in_approved",
            summary=f"Approved QR check-in for {patient['name']}.",
            metadata={
                "check_in_request_id": request_id,
                "used_existing_patient": bool(payload.existing_patient_id),
            },
        )
        return PatientOut(**patient)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise internal_server_error(exc, context="approve_check_in_request") from exc


@router.post("/check-in/requests/{request_id}/reject", response_model=CheckInRequestOut)
async def reject_check_in_request(
    request_id: str,
    payload: CheckInRejectRequest,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> CheckInRequestOut:
    try:
        row = await repo.reject_public_check_in_request(
            org_id=str(current_user.org_id),
            request_id=request_id,
            reviewed_by=str(current_user.id),
            reason=payload.reason,
        )
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="check_in_request",
            entity_id=request_id,
            action="public_check_in_rejected",
            summary="Rejected a public QR check-in request.",
            metadata={},
        )
        return CheckInRequestOut(**{**row, "candidates": []})
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:
        raise internal_server_error(exc, context="reject_check_in_request") from exc
