from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.auth import (
    clear_superdashboard_session,
    hash_password,
    is_super_admin_identifier,
    issue_superdashboard_session_headers,
    password_hash_needs_upgrade,
    require_super_admin,
    verify_password,
)
from app.db import AppRepository, get_repository
from app.repositories.base import normalize_phone_number
from app.schema_domains.admin import (
    CustomerOnboardingCreate,
    CustomerOnboardingOut,
    CustomerOnboardingUpdate,
    OrganizationWorkspaceModeOut,
    OrganizationWorkspaceModeUpdate,
    OrganizationUsersAllowedOut,
    OrganizationUsersAllowedUpdate,
    PlatformEmailSettingsOut,
    PlatformEmailSettingsTest,
    PlatformEmailSettingsUpdate,
    PlatformEmailTestOut,
    PlatformErrorOut,
    SuperdashboardDashboardOut,
    SuperdashboardMetricPointOut,
    SuperdashboardOnboardingOut,
    SuperdashboardOnboardingSummaryOut,
    SuperdashboardOrgUsageRowOut,
    SuperdashboardTrendsOut,
    SuperdashboardUsageByOrgOut,
    SuperuserOrgDetailOut,
    SuperuserOrgSummaryOut,
    SuperuserOrgUserOut,
    SuperuserUsageSummaryOut,
)
from app.schema_domains.auth_settings import (
    AuthResponse,
    ClinicSettingsOut,
    ClinicSettingsUpdate,
    LoginRequest,
    PasswordResetRequestOut,
    TemporaryPasswordSet,
    UserOut,
    UserRoleUpdate,
)
from app.schema_domains.patients import AuditEventOut
from app.email_validation import normalize_single_email
from app.services.email_service import EmailDeliveryError, test_email_credentials
from app.services.password_reset_service import send_password_reset_for_user
from app.services.auth_flow import enforce_repository_rate_limit, normalize_identifier
from app.services.user_workflow import build_user_out


router = APIRouter()


def _superdashboard_session_identity(row: dict) -> dict[str, str | int]:
    return {
        "id": str(row["id"]),
        "org_id": str(row["org_id"]),
        "role": str(row["role"]),
        "identifier": str(row["identifier"]),
        "superdashboard_session_version": int(row.get("superdashboard_session_version") or 1),
    }


@router.post("/superdashboard/auth/login", response_model=AuthResponse)
async def login_superdashboard(
    payload: LoginRequest,
    request: Request,
    response: Response,
    repo: AppRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    is_authorized = bool(
        existing
        and verify_password(payload.password, str(existing["password_hash"]))
        and existing.get("role") == "admin"
        and is_super_admin_identifier(str(existing.get("identifier") or ""))
    )
    if not is_authorized or existing is None:
        await enforce_repository_rate_limit(repo, "auth_login", identifier)
        await enforce_repository_rate_limit(repo, "auth_login_ip", request.client.host if request.client else "unknown")
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")
    if password_hash_needs_upgrade(str(existing["password_hash"])):
        existing = await repo.update_user_password_hash(str(existing["id"]), hash_password(payload.password))
    return AuthResponse(
        token=issue_superdashboard_session_headers(response, _superdashboard_session_identity(existing)),
        user=build_user_out(existing),
    )


@router.get("/superdashboard/auth/session", response_model=UserOut)
async def get_superdashboard_session(
    current_user: UserOut = Depends(require_super_admin),
) -> UserOut:
    return current_user


@router.post("/superdashboard/auth/logout", status_code=204, response_class=Response)
async def logout_superdashboard(
    response: Response,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> Response:
    await repo.revoke_superdashboard_sessions(str(current_user.id))
    clear_superdashboard_session(response)
    response.status_code = 204
    return response


def _serialize_platform_email(settings: dict) -> PlatformEmailSettingsOut:
    return PlatformEmailSettingsOut(
        sender_name=str(settings.get("sender_name") or "ClinicOS"),
        sender_email=str(settings.get("sender_email") or ""),
        is_enabled=bool(settings.get("is_enabled")),
        is_configured=bool(
            str(settings.get("sender_email") or "").strip()
            and str(settings.get("sender_email_app_password") or "").strip()
        ),
        last_tested_at=settings.get("last_tested_at"),
        last_test_succeeded=bool(settings.get("last_test_succeeded")),
        last_error=str(settings.get("last_error") or ""),
        updated_at=settings.get("updated_at"),
    )


@router.get("/superdashboard/settings/email", response_model=PlatformEmailSettingsOut)
async def get_platform_email_settings(
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> PlatformEmailSettingsOut:
    del current_user
    return _serialize_platform_email(await repo.get_platform_email_settings())


@router.post("/superdashboard/settings/email/test", response_model=PlatformEmailTestOut)
async def test_platform_email_settings(
    payload: PlatformEmailSettingsTest,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> PlatformEmailTestOut:
    del current_user
    current = await repo.get_platform_email_settings()
    try:
        sender_email = normalize_single_email(payload.sender_email or str(current.get("sender_email") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Enter a valid Gmail address.") from exc
    app_password = str(payload.sender_email_app_password or current.get("sender_email_app_password") or "").strip()
    if not app_password:
        raise HTTPException(status_code=400, detail="Enter a Gmail app password.")
    try:
        await test_email_credentials(sender_email=sender_email, app_password=app_password)
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PlatformEmailTestOut(success=True, message="Gmail authentication succeeded.")


@router.put("/superdashboard/settings/email", response_model=PlatformEmailSettingsOut)
async def update_platform_email_settings(
    payload: PlatformEmailSettingsUpdate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> PlatformEmailSettingsOut:
    current = await repo.get_platform_email_settings()
    try:
        sender_email = normalize_single_email(payload.sender_email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Enter a valid Gmail address.") from exc
    app_password = str(payload.sender_email_app_password or current.get("sender_email_app_password") or "").strip()
    if not app_password:
        raise HTTPException(status_code=400, detail="Enter a Gmail app password.")

    test_succeeded = False
    last_error = ""
    if payload.is_enabled:
        try:
            await test_email_credentials(sender_email=sender_email, app_password=app_password)
            test_succeeded = True
        except EmailDeliveryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    saved = await repo.upsert_platform_email_settings(
        sender_name=payload.sender_name.strip(),
        sender_email=sender_email,
        sender_email_app_password=app_password,
        is_enabled=payload.is_enabled,
        last_test_succeeded=test_succeeded,
        last_error=last_error,
        updated_by=str(current_user.id),
    )
    return _serialize_platform_email(saved)


def _parse_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _blank_metric(days: int = 7) -> dict[str, int]:
    today = datetime.now(UTC).date()
    return {
        (today - timedelta(days=offset)).isoformat(): 0
        for offset in range(days - 1, -1, -1)
    }


def _metric_points(values: dict[str, int | float]) -> list[SuperdashboardMetricPointOut]:
    return [SuperdashboardMetricPointOut(date=date, value=value) for date, value in values.items()]


def _customer_prefix(customer_name: str) -> str:
    words = ["".join(char for char in part.upper() if char.isalnum()) for part in customer_name.split()]
    initials = "".join(word[0] for word in words if word)
    if len(initials) >= 3:
        return initials[:3]
    compact = "".join(words)
    return (compact[:3] or "CID").ljust(3, "X")


async def _generate_customer_id(repo: AppRepository, customer_name: str) -> str:
    prefix = _customer_prefix(customer_name)
    for _ in range(20):
        candidate = f"CID-{prefix}-{secrets.token_urlsafe(24)}"
        existing = await repo.get_customer_onboarding_by_customer_id(candidate)
        if not existing:
            return candidate
    raise HTTPException(status_code=500, detail="Could not generate a unique customer ID.")


@router.get("/superdashboard/dashboard", response_model=SuperdashboardDashboardOut)
async def get_superdashboard_dashboard(
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> SuperdashboardDashboardOut:
    del current_user
    orgs = await repo.list_all_organizations()
    ai_metrics = await repo.get_superdashboard_ai_metrics(days=7)
    request_metrics = await repo.get_superdashboard_request_metrics(days=7)
    active_since = datetime.now(UTC) - timedelta(days=30)
    request_count = int(request_metrics.get("request_count") or 0)
    error_response_count = int(request_metrics.get("error_response_count") or 0)
    return SuperdashboardDashboardOut(
        org_count=len(orgs),
        active_org_count=sum(
            1
            for org in orgs
            if (_parse_datetime(org.get("last_activity_at")) or datetime.min.replace(tzinfo=UTC))
            >= active_since
        ),
        user_count=sum(int(org.get("user_count") or 0) for org in orgs),
        patient_count=sum(int(org.get("patient_count") or 0) for org in orgs),
        note_count=sum(int(org.get("note_count") or 0) for org in orgs),
        invoice_count=sum(int(org.get("invoice_count") or 0) for org in orgs),
        follow_up_count=sum(int(org.get("follow_up_count") or 0) for org in orgs),
        ai_tokens_7d=int(ai_metrics.get("total_tokens") or 0),
        ai_requests_7d=int(ai_metrics.get("request_count") or 0),
        media_storage_bytes=sum(int(org.get("media_storage_bytes") or 0) for org in orgs),
        error_count_7d=int(request_metrics.get("error_count") or 0),
        error_rate_7d=round((error_response_count / request_count) * 100, 2) if request_count else 0,
        top_error_context=str(request_metrics.get("top_error_context") or ""),
    )


@router.get("/superdashboard/dashboard/trends", response_model=SuperdashboardTrendsOut)
async def get_superdashboard_trends(
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> SuperdashboardTrendsOut:
    del current_user
    orgs = await repo.list_all_organizations()
    ai_metrics = await repo.get_superdashboard_ai_metrics(days=7)
    request_metrics = await repo.get_superdashboard_request_metrics(days=7)
    request_points = _blank_metric()
    token_points = _blank_metric()
    error_points = _blank_metric()
    current_storage = sum(int(org.get("media_storage_bytes") or 0) for org in orgs)
    for event in ai_metrics.get("daily") or []:
        key = str(event.get("date") or "")
        if key in request_points:
            request_points[key] = int(event.get("request_count") or 0)
            token_points[key] += int(event.get("total_tokens") or 0)
    for metric in request_metrics.get("daily") or []:
        key = str(metric.get("date") or "")
        if key in error_points:
            error_points[key] = int(metric.get("error_response_count") or 0)
    return SuperdashboardTrendsOut(
        requests=_metric_points(request_points),
        tokens=_metric_points(token_points),
        storage=[
            SuperdashboardMetricPointOut(
                date=datetime.now(UTC).date().isoformat(),
                value=current_storage,
            )
        ],
        errors=_metric_points(error_points),
    )


@router.get("/superdashboard/dashboard/usage-by-org", response_model=SuperdashboardUsageByOrgOut)
async def get_superdashboard_usage_by_org(
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> SuperdashboardUsageByOrgOut:
    del current_user
    orgs = await repo.list_all_organizations()
    rows = [
        SuperdashboardOrgUsageRowOut(
            org_id=org["org_id"],
            clinic_name=org["clinic_name"],
            total_tokens=int(org.get("total_tokens") or 0),
            media_storage_bytes=int(org.get("media_storage_bytes") or 0),
        )
        for org in orgs
    ]
    return SuperdashboardUsageByOrgOut(
        ai_usage=sorted(rows, key=lambda row: row.total_tokens, reverse=True)[:10],
        media_storage=sorted(rows, key=lambda row: row.media_storage_bytes, reverse=True)[:10],
    )


@router.get("/superdashboard/onboarding", response_model=SuperdashboardOnboardingOut)
async def list_superdashboard_onboarding(
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> SuperdashboardOnboardingOut:
    del current_user
    rows = await repo.list_customer_onboarding()
    status_counts = Counter(str(row.get("status") or "pending") for row in rows)
    return SuperdashboardOnboardingOut(
        summary=SuperdashboardOnboardingSummaryOut(
            pending_count=status_counts.get("pending", 0),
            claimed_count=status_counts.get("claimed", 0),
            disabled_count=status_counts.get("disabled", 0),
            default_users_allowed=2,
        ),
        customers=[CustomerOnboardingOut(**row) for row in rows],
    )


@router.post("/superdashboard/onboarding/customers", response_model=CustomerOnboardingOut, status_code=201)
async def create_superdashboard_customer(
    payload: CustomerOnboardingCreate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> CustomerOnboardingOut:
    customer_id = await _generate_customer_id(repo, payload.customer_name)
    try:
        row = await repo.create_customer_onboarding(
            customer_id=customer_id,
            customer_name=payload.customer_name.strip(),
            phone=normalize_phone_number(payload.phone),
            users_allowed=payload.users_allowed,
            workspace_mode=payload.workspace_mode,
            created_by=str(current_user.id),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not create customer onboarding record.") from exc
    return CustomerOnboardingOut(**{**row, "users_used": 0, "claimed_org_name": None})


@router.patch("/superdashboard/onboarding/customers/{customer_onboarding_id}", response_model=CustomerOnboardingOut)
async def update_superdashboard_customer(
    customer_onboarding_id: UUID,
    payload: CustomerOnboardingUpdate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> CustomerOnboardingOut:
    del current_user
    updates = payload.model_dump(exclude_unset=True)
    if "phone" in updates and updates["phone"] is not None:
        updates["phone"] = normalize_phone_number(updates["phone"])
    try:
        await repo.update_customer_onboarding(str(customer_onboarding_id), updates)
        refreshed_rows = await repo.list_customer_onboarding()
        row = next((item for item in refreshed_rows if str(item["id"]) == str(customer_onboarding_id)), None)
        if row is None:
            raise ValueError("Customer onboarding record not found.")
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return CustomerOnboardingOut(**row)


@router.post("/superdashboard/onboarding/customers/{customer_onboarding_id}/disable", response_model=CustomerOnboardingOut)
async def disable_superdashboard_customer(
    customer_onboarding_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> CustomerOnboardingOut:
    del current_user
    try:
        row = await repo.disable_customer_onboarding(str(customer_onboarding_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return CustomerOnboardingOut(**{**row, "users_used": row.get("users_used", 0), "claimed_org_name": row.get("claimed_org_name")})


@router.get("/superdashboard/orgs", response_model=list[SuperuserOrgSummaryOut])
@router.get("/superuser/orgs", response_model=list[SuperuserOrgSummaryOut])
async def list_superuser_orgs(
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> list[SuperuserOrgSummaryOut]:
    del current_user
    rows = await repo.list_all_organizations()
    return [SuperuserOrgSummaryOut(**row) for row in rows]


@router.get("/superdashboard/orgs/{org_id}", response_model=SuperuserOrgDetailOut)
@router.get("/superuser/orgs/{org_id}", response_model=SuperuserOrgDetailOut)
async def get_superuser_org_detail(
    org_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> SuperuserOrgDetailOut:
    del current_user
    summaries = await repo.list_all_organizations()
    summary = next((row for row in summaries if str(row["org_id"]) == str(org_id)), None)
    if summary is None:
        raise HTTPException(status_code=404, detail="Organization not found.")

    users = await repo.list_users_for_org_any(str(org_id))
    settings = await repo.get_clinic_settings(str(org_id))
    recent_errors = await repo.list_platform_errors(limit=50, org_id=str(org_id))
    usage_events = await repo.list_ai_usage_events_for_org(str(org_id), limit=200)
    recent_audit_events = await repo.list_audit_events(str(org_id), limit=50)
    feature_totals = Counter()
    total_tokens = 0
    for event in usage_events:
        tokens = int(event.get("total_tokens") or 0)
        total_tokens += tokens
        feature_totals[str(event.get("feature") or "unknown")] += tokens

    return SuperuserOrgDetailOut(
        summary=SuperuserOrgSummaryOut(**summary),
        settings=ClinicSettingsOut(**settings) if settings else None,
        users=[SuperuserOrgUserOut(**row) for row in users],
        recent_errors=[PlatformErrorOut(**row) for row in recent_errors],
        usage=SuperuserUsageSummaryOut(
            total_tokens=total_tokens,
            total_requests=len(usage_events),
            by_feature=dict(feature_totals),
        ),
        recent_audit_events=[AuditEventOut(**row) for row in recent_audit_events],
    )


@router.patch("/superdashboard/orgs/{org_id}/workspace-mode", response_model=OrganizationWorkspaceModeOut)
async def update_superdashboard_org_workspace_mode(
    org_id: UUID,
    payload: OrganizationWorkspaceModeUpdate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> OrganizationWorkspaceModeOut:
    del current_user
    settings = await repo.get_clinic_settings(str(org_id))
    if not settings:
        raise HTTPException(status_code=404, detail="Organization settings not found.")
    try:
        saved_mode = await repo.update_organization_workspace_mode(str(org_id), payload.workspace_mode)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return OrganizationWorkspaceModeOut(org_id=org_id, workspace_mode=saved_mode)


@router.patch("/superdashboard/orgs/{org_id}/users-allowed", response_model=OrganizationUsersAllowedOut)
async def update_superdashboard_org_users_allowed(
    org_id: UUID,
    payload: OrganizationUsersAllowedUpdate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> OrganizationUsersAllowedOut:
    del current_user
    settings = await repo.get_clinic_settings(str(org_id))
    if not settings:
        raise HTTPException(status_code=404, detail="Organization settings not found.")
    try:
        saved_limit = await repo.update_organization_users_allowed(str(org_id), payload.users_allowed)
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return OrganizationUsersAllowedOut(org_id=org_id, users_allowed=saved_limit)


@router.patch("/superdashboard/orgs/{org_id}/settings", response_model=ClinicSettingsOut)
@router.patch("/superuser/orgs/{org_id}/settings", response_model=ClinicSettingsOut)
async def update_superdashboard_org_settings(
    org_id: UUID,
    payload: ClinicSettingsUpdate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> ClinicSettingsOut:
    del current_user
    current_settings = await repo.get_clinic_settings(str(org_id))
    if not current_settings:
        raise HTTPException(status_code=404, detail="Organization settings not found.")
    updates = payload.model_dump(exclude_unset=True)
    if "users_allowed" in updates or "workspace_mode" in updates:
        raise HTTPException(
            status_code=400,
            detail="Use the dedicated Superdashboard endpoints for user limit or workspace mode changes.",
        )
    try:
        saved = await repo.upsert_clinic_settings(str(org_id), payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ClinicSettingsOut(**saved)


@router.patch("/superdashboard/users/{user_id}/role", response_model=SuperuserOrgUserOut)
@router.patch("/superuser/users/{user_id}/role", response_model=SuperuserOrgUserOut)
async def update_superdashboard_user_role(
    user_id: UUID,
    payload: UserRoleUpdate,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> SuperuserOrgUserOut:
    del current_user
    try:
        target_user = await repo.get_user(str(user_id))
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    previous_role = str(target_user.get("role") or "")
    target_org_id = str(target_user["org_id"])
    if previous_role == payload.role:
        return SuperuserOrgUserOut(**target_user)
    if previous_role == "admin" and payload.role != "admin":
        admin_count = await repo.count_admins_for_org(target_org_id)
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Organization must keep at least one admin.")
    updated = await repo.update_user_role(str(user_id), payload)
    return SuperuserOrgUserOut(**updated)


@router.post("/superdashboard/users/{user_id}/password-reset", response_model=PasswordResetRequestOut)
@router.post("/superuser/users/{user_id}/password-reset", response_model=PasswordResetRequestOut)
async def send_superdashboard_user_password_reset(
    user_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> PasswordResetRequestOut:
    try:
        target_user = await repo.get_user(str(user_id))
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    await send_password_reset_for_user(
        repo,
        target_user=target_user,
        requested_by=current_user,
        requester_realm="superdashboard",
    )
    return PasswordResetRequestOut(message=f"Password reset email sent to {target_user['email']}.")


@router.post("/superdashboard/users/{user_id}/temporary-password", response_model=PasswordResetRequestOut)
@router.post("/superuser/users/{user_id}/temporary-password", response_model=PasswordResetRequestOut)
async def set_superdashboard_user_temporary_password(
    user_id: UUID,
    payload: TemporaryPasswordSet,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> PasswordResetRequestOut:
    del current_user
    try:
        await repo.update_user_password_hash(str(user_id), hash_password(payload.password))
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    return PasswordResetRequestOut(message="Temporary password updated. Share it with the user securely.")


@router.get("/superdashboard/errors", response_model=list[PlatformErrorOut])
@router.get("/superuser/errors", response_model=list[PlatformErrorOut])
async def list_superuser_errors(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> list[PlatformErrorOut]:
    del current_user
    rows = await repo.list_platform_errors(limit=limit)
    return [PlatformErrorOut(**row) for row in rows]


@router.delete("/superdashboard/users/{user_id}", status_code=200, response_class=Response)
@router.delete("/superuser/users/{user_id}", status_code=200, response_class=Response)
async def delete_superuser_user(
    user_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> None:
    if str(current_user.id) == str(user_id):
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    try:
        await repo.get_user(str(user_id))
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    await repo.delete_user_any(str(user_id))


@router.delete("/superdashboard/orgs/{org_id}", status_code=200, response_class=Response)
@router.delete("/superuser/orgs/{org_id}", status_code=200, response_class=Response)
async def delete_superuser_org(
    org_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: AppRepository = Depends(get_repository),
) -> None:
    if str(current_user.org_id) == str(org_id):
        raise HTTPException(status_code=400, detail="You cannot delete your own organization.")
    deleted = await repo.delete_organization(str(org_id))
    if deleted is False:
        raise HTTPException(status_code=404, detail="Organization not found.")
