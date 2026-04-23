from fastapi import APIRouter, Depends, HTTPException

from app.auth import hash_password, require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import StaffUserCreate, UserOut
from app.services.auth_flow import normalize_identifier


router = APIRouter()


@router.post("/users/staff", response_model=UserOut, status_code=201)
async def create_staff_user(
    payload: StaffUserCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    created = await repo.create_user(
        org_id=str(current_user.org_id),
        identifier=identifier,
        name="",
        password_hash=hash_password(payload.password),
        role="staff",
    )
    return UserOut(**{key: created[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})


@router.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[UserOut]:
    users = await repo.list_users(str(current_user.org_id))
    return [UserOut(**row) for row in users]
