from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import clear_session, get_current_user, issue_session_headers
from app.db import SupabaseRepository, get_repository
from app.schemas import AuthResponse, LoginRequest, UserCreate, UserOut
from app.services.user_workflow import login_user_workflow, register_user_workflow


router = APIRouter()


@router.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register_user(
    payload: UserCreate,
    response: Response,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    return await register_user_workflow(repo, response, payload)


@router.post("/auth/login", response_model=AuthResponse)
async def login_user(
    payload: LoginRequest,
    response: Response,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    return await login_user_workflow(repo, response, payload)


@router.get("/auth/me", response_model=UserOut)
async def get_me(response: Response, current_user: UserOut = Depends(get_current_user)) -> UserOut:
    issue_session_headers(response, {
        "id": str(current_user.id),
        "org_id": str(current_user.org_id),
        "role": current_user.role,
        "identifier": current_user.identifier,
    })
    return current_user


@router.post("/auth/logout", status_code=204)
async def logout_user(response: Response) -> None:
    clear_session(response)
