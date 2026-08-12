from fastapi import APIRouter, Depends

from app.api_errors import internal_server_error
from app.auth import get_current_user
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.dashboard import DashboardStatusOut


router = APIRouter()


@router.get("/dashboard/status", response_model=DashboardStatusOut)
async def get_dashboard_status(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> DashboardStatusOut:
    try:
        return DashboardStatusOut(
            **await repo.get_dashboard_status(str(current_user.org_id))
        )
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_dashboard_status") from exc
