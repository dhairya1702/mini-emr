from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.db import SupabaseRepository, get_repository
from app.schemas import FollowUpCreate, FollowUpOut, FollowUpStatus, FollowUpUpdate, UserOut
from app.services.followup_workflow import create_follow_up_workflow, update_follow_up_workflow


router = APIRouter()


@router.post("/patients/{patient_id}/follow-ups", response_model=FollowUpOut, status_code=201)
async def create_follow_up(
    patient_id: str,
    payload: FollowUpCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        return await create_follow_up_workflow(repo, current_user, patient_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/follow-ups", response_model=list[FollowUpOut])
async def list_follow_ups(
    status: FollowUpStatus | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[FollowUpOut]:
    follow_ups = await repo.list_follow_ups(str(current_user.org_id), status=status, query=q, limit=limit)
    return [FollowUpOut(**follow_up) for follow_up in follow_ups]


@router.patch("/follow-ups/{follow_up_id}", response_model=FollowUpOut)
async def update_follow_up(
    follow_up_id: str,
    payload: FollowUpUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        return await update_follow_up_workflow(repo, current_user, follow_up_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
