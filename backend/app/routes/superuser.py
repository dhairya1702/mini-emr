from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import require_super_admin
from app.db import AppRepository, get_repository
from app.repositories.base import normalize_phone_number
from app.schema_domains.admin import (
    CustomerOnboardingCreate,
    CustomerOnboardingOut,
    CustomerOnboardingUpdate,
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
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.patients import AuditEventOut


router = APIRouter()


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
        row = await repo.update_customer_onboarding(str(customer_onboarding_id), updates)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return CustomerOnboardingOut(**{**row, "users_used": row.get("users_used", 0), "claimed_org_name": row.get("claimed_org_name")})


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
        users=[SuperuserOrgUserOut(**row) for row in users],
        recent_errors=[PlatformErrorOut(**row) for row in recent_errors],
        usage=SuperuserUsageSummaryOut(
            total_tokens=total_tokens,
            total_requests=len(usage_events),
            by_feature=dict(feature_totals),
        ),
        recent_audit_events=[AuditEventOut(**row) for row in recent_audit_events],
    )


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
    await repo.delete_organization(str(org_id))
