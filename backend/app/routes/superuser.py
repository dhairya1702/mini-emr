from __future__ import annotations

from collections import Counter
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import require_super_admin
from app.db import SupabaseRepository, get_repository
from app.schema_domains.admin import (
    PlatformErrorOut,
    SuperuserOrgDetailOut,
    SuperuserOrgSummaryOut,
    SuperuserOrgUserOut,
    SuperuserUsageSummaryOut,
)
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.patients import AuditEventOut


router = APIRouter()


@router.get("/superuser/orgs", response_model=list[SuperuserOrgSummaryOut])
async def list_superuser_orgs(
    current_user: UserOut = Depends(require_super_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[SuperuserOrgSummaryOut]:
    del current_user
    rows = await repo.list_all_organizations()
    return [SuperuserOrgSummaryOut(**row) for row in rows]


@router.get("/superuser/orgs/{org_id}", response_model=SuperuserOrgDetailOut)
async def get_superuser_org_detail(
    org_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: SupabaseRepository = Depends(get_repository),
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


@router.get("/superuser/errors", response_model=list[PlatformErrorOut])
async def list_superuser_errors(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserOut = Depends(require_super_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[PlatformErrorOut]:
    del current_user
    rows = await repo.list_platform_errors(limit=limit)
    return [PlatformErrorOut(**row) for row in rows]


@router.delete("/superuser/users/{user_id}", status_code=200, response_class=Response)
async def delete_superuser_user(
    user_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    if str(current_user.id) == str(user_id):
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    try:
        await repo.get_user(str(user_id))
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    await repo.delete_user_any(str(user_id))


@router.delete("/superuser/orgs/{org_id}", status_code=200, response_class=Response)
async def delete_superuser_org(
    org_id: UUID,
    current_user: UserOut = Depends(require_super_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    if str(current_user.org_id) == str(org_id):
        raise HTTPException(status_code=400, detail="You cannot delete your own organization.")
    await repo.delete_organization(str(org_id))
