from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import StaffUserCreate, UserOut
from app.services.user_workflow import create_staff_user_workflow


router = APIRouter()


@router.post("/users/staff", response_model=UserOut, status_code=201)
async def create_staff_user(
    payload: StaffUserCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    return await create_staff_user_workflow(repo, current_user, payload)


@router.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[UserOut]:
    users = await repo.list_users(str(current_user.org_id))
    return [UserOut(**row) for row in users]
