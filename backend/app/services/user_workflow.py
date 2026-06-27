from fastapi import HTTPException, Response

from app.auth import (
    hash_password,
    is_super_admin_identifier,
    issue_session_headers,
    password_hash_needs_upgrade,
    verify_password,
    verify_super_admin_totp,
)
from datetime import UTC, datetime, timedelta
from app.db import AppRepository
from app.repositories.base import normalize_phone_number
from app.schema_domains.auth_settings import (
    AuthResponse,
    ClinicSettingsUpdate,
    LoginRequest,
    StaffUserCreate,
    UserCreate,
    UserOut,
)
from app.services.audit_service import write_audit_event
from app.services.auth_flow import enforce_repository_rate_limit, normalize_identifier


def _session_identity(row: dict, *, mfa_verified_until: int = 0) -> dict[str, str | int]:
    identity: dict[str, str | int] = {
        "id": str(row["id"]),
        "org_id": str(row["org_id"]),
        "role": str(row["role"]),
        "identifier": str(row["identifier"]),
        "session_version": int(row.get("session_version") or 1),
    }
    if mfa_verified_until:
        identity["mfa_verified_until"] = mfa_verified_until
    return identity


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
            "session_version",
        )
    })


def _invalid_customer() -> HTTPException:
    return HTTPException(status_code=400, detail="Invalid customer ID or phone number.")


async def register_user_workflow(
    repo: AppRepository,
    response: Response,
    payload: UserCreate,
    client_ip: str = "unknown",
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    customer_id = payload.customer_id.strip().upper()
    await enforce_repository_rate_limit(repo, "auth_register", client_ip or "unknown")
    await enforce_repository_rate_limit(repo, "auth_register_invite", customer_id)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    try:
        created = await repo.provision_customer_organization(
            customer_id=customer_id,
            expected_phone=normalize_phone_number(payload.clinic_phone),
            clinic_settings=ClinicSettingsUpdate(
                clinic_name=payload.clinic_name,
                clinic_address=payload.clinic_address,
                clinic_phone=payload.clinic_phone,
                doctor_name=payload.doctor_name,
                onboarding_required=True,
                onboarding_completed_at=None,
                workspace_mode="solo",
            ),
            identifier=identifier,
            name=payload.admin_name,
            password_hash=hash_password(payload.password),
        )
    except ValueError as exc:
        raise _invalid_customer() from exc
    return AuthResponse(token=issue_session_headers(response, _session_identity(created)), user=build_user_out(created))


async def login_user_workflow(
    repo: AppRepository,
    response: Response,
    payload: LoginRequest,
    client_ip: str = "unknown",
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if not existing or not verify_password(payload.password, existing["password_hash"]):
        await enforce_repository_rate_limit(repo, "auth_login", identifier)
        await enforce_repository_rate_limit(repo, "auth_login_ip", client_ip or "unknown")
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")
    if password_hash_needs_upgrade(str(existing["password_hash"])):
        existing = await repo.update_user_password_hash(
            str(existing["id"]),
            hash_password(payload.password),
        )
    mfa_verified_until = 0
    if not verify_super_admin_totp(identifier, payload.totp_code):
        await enforce_repository_rate_limit(repo, "auth_login", identifier)
        await enforce_repository_rate_limit(repo, "auth_login_ip", client_ip or "unknown")
        raise HTTPException(status_code=401, detail="Invalid or missing authenticator code.")
    if is_super_admin_identifier(identifier):
        mfa_verified_until = int((datetime.now(UTC) + timedelta(hours=12)).timestamp())
    return AuthResponse(
        token=issue_session_headers(
            response,
            _session_identity(existing, mfa_verified_until=mfa_verified_until),
        ),
        user=build_user_out(existing),
    )


async def create_staff_user_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: StaffUserCreate,
) -> UserOut:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    onboarding = await repo.get_customer_onboarding_for_org(str(current_user.org_id))
    if onboarding:
        users_used = await repo.count_users_for_org(str(current_user.org_id))
        users_allowed = int(onboarding.get("users_allowed") or 0)
        if users_allowed > 0 and users_used >= users_allowed:
            raise HTTPException(status_code=400, detail="User limit reached for this customer.")

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
    await repo.upsert_clinic_settings(
        str(current_user.org_id),
        ClinicSettingsUpdate(workspace_mode="team"),
    )
    return build_user_out(created)
