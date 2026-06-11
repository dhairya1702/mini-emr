from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.common import FollowUpStatus
from app.schema_domains.patients import FollowUpCreate, FollowUpOut, FollowUpUpdate
from app.services.followup_workflow import create_follow_up_workflow, update_follow_up_workflow


router = APIRouter()


def _utc_day_bounds(day: date) -> tuple[str, str]:
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


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
    limit: int = Query(default=200, ge=1, le=500),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[FollowUpOut]:
    effective_date = scheduled_date or datetime.now(UTC).date()
    scheduled_from, scheduled_to = _utc_day_bounds(effective_date)
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
