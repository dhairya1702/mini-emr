from fastapi import HTTPException, Response

from app.clinic_timezone import DEFAULT_TIMEZONE
from app.auth import (
    hash_password,
    issue_session_headers,
    password_hash_needs_upgrade,
    verify_password,
)
from app import config as config_module
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
from app.services.auth_flow import enforce_repository_rate_limit, normalize_email, normalize_identifier


def _session_identity(row: dict) -> dict[str, str | int]:
    identity: dict[str, str | int] = {
        "id": str(row["id"]),
        "org_id": str(row["org_id"]),
        "role": str(row["role"]),
        "identifier": str(row["identifier"]),
        "session_version": int(row.get("session_version") or 1),
    }
    return identity


def build_user_out(row: dict) -> UserOut:
    values = {
        key: row.get(key)
        for key in (
            "id",
            "org_id",
            "identifier",
            "email",
            "phone",
            "name",
            "role",
            "doctor_dob",
            "doctor_address",
            "doctor_signature_name",
            "doctor_signature_url",
            "doctor_signature_content_type",
            "created_at",
            "session_version",
            "superdashboard_session_version",
        )
    }
    values["email"] = str(row.get("email") or "")
    values["phone"] = str(row.get("phone") or "")
    values["session_version"] = int(row.get("session_version") or 1)
    values["superdashboard_session_version"] = int(row.get("superdashboard_session_version") or 1)
    return UserOut(**values)


def _invalid_customer() -> HTTPException:
    return HTTPException(status_code=400, detail="Invalid customer ID or phone number.")


async def register_user_workflow(
    repo: AppRepository,
    response: Response,
    payload: UserCreate,
    client_ip: str = "unknown",
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    email = normalize_email(payload.email or (identifier if "@" in identifier else ""))
    phone = normalize_phone_number(payload.phone)
    customer_id = payload.customer_id.strip().upper()
    await enforce_repository_rate_limit(repo, "auth_register", client_ip or "unknown")
    if customer_id:
        await enforce_repository_rate_limit(repo, "auth_register_invite", customer_id)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    clinic_settings = ClinicSettingsUpdate(
        clinic_name=payload.clinic_name,
        clinic_address=payload.clinic_address,
        clinic_phone=payload.clinic_phone,
        timezone=DEFAULT_TIMEZONE,
        doctor_name=payload.doctor_name,
        onboarding_required=True,
        onboarding_completed_at=None,
        workspace_mode="team",
        users_allowed=2,
    )
    try:
        if customer_id:
            created = await repo.provision_customer_organization(
                customer_id=customer_id,
                expected_phone=normalize_phone_number(payload.clinic_phone),
                clinic_settings=clinic_settings,
                identifier=identifier,
                email=email,
                phone=phone,
                name=payload.admin_name,
                password_hash=hash_password(payload.password),
            )
        else:
            if not config_module.get_settings().open_clinic_registration:
                raise _invalid_customer()
            created = await repo.provision_open_organization(
                clinic_settings=clinic_settings,
                identifier=identifier,
                email=email,
                phone=phone,
                name=payload.admin_name,
                password_hash=hash_password(payload.password),
            )
    except HTTPException:
        raise
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
    return AuthResponse(
        token=issue_session_headers(
            response,
            _session_identity(existing),
        ),
        user=build_user_out(existing),
    )


async def create_staff_user_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: StaffUserCreate,
) -> UserOut:
    identifier = normalize_identifier(payload.identifier)
    email = normalize_email(payload.email)
    phone = normalize_phone_number(payload.phone)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    role = payload.role
    try:
        created = await repo.create_user(
            org_id=str(current_user.org_id),
            identifier=identifier,
            email=email,
            phone=phone,
            name=payload.name,
            password_hash=hash_password(payload.password),
            role=role,
        )
    except ValueError as exc:
        if "User limit reached for this customer." in str(exc):
            raise HTTPException(status_code=400, detail="User limit reached for this customer.") from exc
        raise
    role_label = str(role).replace("_", " ")
    action = "staff_user_created" if role == "staff" else "user_created"
    await write_audit_event(
        repo,
        current_user,
        entity_type="user",
        entity_id=str(created["id"]),
        action=action,
        summary=f"Created {role_label} user {identifier}.",
        metadata={"identifier": identifier, "email": email, "role": role},
    )
    return build_user_out(created)
