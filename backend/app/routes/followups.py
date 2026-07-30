import hmac
import logging
from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.clinic_timezone import clinic_today, utc_day_bounds_for_clinic
from app.config import get_settings
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.common import FollowUpStatus
from app.schema_domains.patients import FollowUpCreate, FollowUpOut, FollowUpUpdate
from app.services.followup_workflow import create_follow_up_workflow, send_due_follow_up_emails_workflow, update_follow_up_workflow


logger = logging.getLogger(__name__)
router = APIRouter()
def _system_user_for_org(org_id: str) -> UserOut:
    return UserOut.model_construct(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        org_id=UUID(org_id),
        identifier="scheduler-followup-reminder",
        name="System",
        role="admin",
        created_at=datetime.now(UTC),
    )


@router.post("/patients/{patient_id}/follow-ups", response_model=FollowUpOut, status_code=201)
async def create_follow_up(
    patient_id: str,
    payload: FollowUpCreate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        return await create_follow_up_workflow(repo, current_user, patient_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_follow_up") from exc


@router.get("/follow-ups", response_model=list[FollowUpOut])
async def list_follow_ups(
    status: FollowUpStatus | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    scheduled_date: date | None = Query(default=None),
    upcoming: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[FollowUpOut]:
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    effective_date = scheduled_date or clinic_today(clinic_settings)
    scheduled_from, scheduled_to = utc_day_bounds_for_clinic(effective_date, clinic_settings)
    if upcoming and scheduled_date is None:
        scheduled_to = None
    follow_ups = await repo.list_follow_ups(
        str(current_user.org_id),
        status=status,
        query=q,
        limit=limit,
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
    )
    return [FollowUpOut(**follow_up) for follow_up in follow_ups]


@router.patch("/follow-ups/{follow_up_id}", response_model=FollowUpOut)
async def update_follow_up(
    follow_up_id: str,
    payload: FollowUpUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        return await update_follow_up_workflow(repo, current_user, follow_up_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_follow_up") from exc


@router.post("/internal/run-follow-up-reminders")
async def run_follow_up_reminders(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    repo: AppRepository = Depends(get_repository),
) -> dict[str, int | bool | list[str]]:
    expected_token = str(get_settings().internal_scheduler_token or "").strip()
    provided_token = str(x_internal_token or "").strip()

    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_SCHEDULER_TOKEN is not configured.",
        )
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal token.",
        )

    processed = 0
    failed_orgs: list[str] = []
    for org_id in await repo.list_organization_ids():
        try:
            await send_due_follow_up_emails_workflow(repo, _system_user_for_org(str(org_id)))
            processed += 1
        except Exception:
            logger.exception("Failed to run follow-up reminders for org %s", org_id)
            failed_orgs.append(str(org_id))

    return {"success": not failed_orgs, "processed_orgs": processed, "failed_orgs": failed_orgs}
