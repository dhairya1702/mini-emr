import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from uuid import UUID

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import SESSION_EXPIRES_AT_HEADER, SESSION_TOKEN_HEADER
from app.config import get_settings
from app.db import get_repository
from app.routes import (
    appointments_router,
    audit_router,
    auth_router,
    billing_router,
    catalog_router,
    exports_router,
    followups_router,
    health_router,
    notes_router,
    patients_router,
    public_router,
    settings_router,
    users_router,
)
from app.schemas import UserOut
from app.services.auth_flow import RATE_LIMIT_BUCKETS, RATE_LIMIT_WINDOWS
from app.services.followup_workflow import send_due_follow_up_emails_workflow

logger = logging.getLogger(__name__)


def _system_user_for_org(org_id: str) -> UserOut:
    return UserOut.model_construct(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        org_id=UUID(org_id),
        identifier="system-followup-reminder",
        name="System",
        role="admin",
        created_at=datetime.now(UTC),
    )


async def _run_follow_up_reminders(app: FastAPI) -> None:
    settings = get_settings()
    while True:
        try:
            repo_factory = app.dependency_overrides.get(get_repository, get_repository)
            repo = repo_factory()
            list_org_ids = getattr(repo, "list_organization_ids", None)
            if callable(list_org_ids):
                for org_id in await list_org_ids():
                    try:
                        await send_due_follow_up_emails_workflow(repo, _system_user_for_org(str(org_id)))
                    except Exception:  # pragma: no cover
                        logger.exception("Failed to send due follow-up reminders for org %s", org_id)
        except Exception:  # pragma: no cover
            logger.exception("Follow-up reminder loop failed.")
        await asyncio.sleep(max(settings.follow_up_reminder_interval_seconds, 60))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    reminder_task = (
        asyncio.create_task(_run_follow_up_reminders(app))
        if settings.follow_up_reminder_runner_enabled
        else None
    )
    try:
        yield
    finally:
        if reminder_task is not None:
            reminder_task.cancel()
            with suppress(asyncio.CancelledError):
                await reminder_task


settings = get_settings()
app = FastAPI(title="Clinic EMR API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[SESSION_TOKEN_HEADER, SESSION_EXPIRES_AT_HEADER],
)

for router in (
    health_router,
    settings_router,
    audit_router,
    auth_router,
    users_router,
    catalog_router,
    exports_router,
    patients_router,
    appointments_router,
    followups_router,
    public_router,
    notes_router,
    billing_router,
):
    app.include_router(router)
