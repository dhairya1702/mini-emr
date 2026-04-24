from fastapi import HTTPException, Response

from app.auth import hash_password, issue_session_headers, verify_password
from app.db import SupabaseRepository
from app.schemas import AuthResponse, ClinicSettingsUpdate, LoginRequest, StaffUserCreate, UserCreate, UserOut
from app.services.audit_service import write_audit_event
from app.services.auth_flow import enforce_rate_limit, normalize_identifier


def build_user_out(row: dict) -> UserOut:
    return UserOut(**{
        key: row.get(key)
        for key in (
            "id",
            "org_id",
            "identifier",
            "name",
            "role",
            "doctor_dob",
            "doctor_address",
            "doctor_signature_name",
            "doctor_signature_url",
            "doctor_signature_content_type",
            "created_at",
        )
    })


async def register_user_workflow(
    repo: SupabaseRepository,
    response: Response,
    payload: UserCreate,
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
    return AuthResponse(token=issue_session_headers(response, created), user=build_user_out(created))


async def login_user_workflow(
    repo: SupabaseRepository,
    response: Response,
    payload: LoginRequest,
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    enforce_rate_limit("auth_login", identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if not existing or not verify_password(payload.password, existing["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")
    return AuthResponse(token=issue_session_headers(response, existing), user=build_user_out(existing))


async def create_staff_user_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: StaffUserCreate,
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
    await write_audit_event(
        repo,
        current_user,
        entity_type="user",
        entity_id=str(created["id"]),
        action="staff_user_created",
        summary=f"Created staff user {identifier}.",
        metadata={"identifier": identifier, "role": "staff"},
    )
    return build_user_out(created)
