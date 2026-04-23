from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import (
    clear_session,
    get_current_user,
    hash_password,
    issue_session_headers,
    verify_password,
)
from app.db import SupabaseRepository, get_repository
from app.schemas import AuthResponse, ClinicSettingsUpdate, LoginRequest, UserCreate, UserOut
from app.services.auth_flow import enforce_rate_limit, normalize_identifier


router = APIRouter()


@router.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register_user(
    payload: UserCreate,
    response: Response,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    enforce_rate_limit("auth_register", identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    organization = await repo.create_organization(payload.clinic_name)
    org_id = str(organization["id"])
    await repo.create_clinic_settings(
        org_id=org_id,
        payload=ClinicSettingsUpdate(
            clinic_name=payload.clinic_name,
            clinic_address=payload.clinic_address,
            clinic_phone=payload.clinic_phone,
            doctor_name=payload.doctor_name,
        ),
    )
    created = await repo.create_user(
        org_id=org_id,
        identifier=identifier,
        name=payload.admin_name,
        password_hash=hash_password(payload.password),
        role="admin",
    )
    user = UserOut(**{key: created[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})
    return AuthResponse(token=issue_session_headers(response, created), user=user)


@router.post("/auth/login", response_model=AuthResponse)
async def login_user(
    payload: LoginRequest,
    response: Response,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    enforce_rate_limit("auth_login", identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if not existing or not verify_password(payload.password, existing["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")

    user = UserOut(**{key: existing[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})
    return AuthResponse(token=issue_session_headers(response, existing), user=user)


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
