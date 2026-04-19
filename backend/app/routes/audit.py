from fastapi import APIRouter, Depends, Query

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import AuditEventOut, UserOut


router = APIRouter()


@router.get("/audit-events", response_model=list[AuditEventOut])
async def list_audit_events(
    limit: int = Query(default=100, ge=1, le=250),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> list[AuditEventOut]:
    rows = await repo.list_audit_events(str(current_user.org_id), limit=limit)
    return [AuditEventOut(**row) for row in rows]
