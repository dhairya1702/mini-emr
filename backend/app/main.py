import asyncio
import logging
import traceback
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from uuid import UUID
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.background import BackgroundTasks

from app import config as config_module
from app.auth import (
    SESSION_EXPIRES_AT_HEADER,
    SESSION_TOKEN_HEADER,
    issue_session_headers,
)
from app.db import get_repository
from app.postgres import get_postgres_connection_manager
from app.routes import (
    appointments_router,
    attachments_router,
    audit_router,
    auth_router,
    billing_router,
    case_studies_router,
    care_programs_router,
    checkins_router,
    catalog_router,
    clinical_assistant_router,
    controlroom_router,
    exports_router,
    followups_router,
    health_router,
    mobile_router,
    notes_router,
    patients_router,
    public_router,
    settings_router,
    superuser_router,
    users_router,
    whatsapp_router,
)
from app.schema_domains.auth_settings import UserOut
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
    settings = config_module.get_settings()
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
        interval_seconds = max(int(getattr(settings, "follow_up_reminder_interval_seconds", 300)), 60)
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = config_module.get_settings()
    validate_runtime = getattr(settings, "validate_runtime", None)
    if callable(validate_runtime):
        validate_runtime()
    postgres_manager = None
    if get_repository not in app.dependency_overrides:
        postgres_manager = get_postgres_connection_manager()
        postgres_manager.open()
    reminder_runner_enabled = bool(getattr(settings, "follow_up_reminder_runner_enabled", False))
    reminder_task = (
        asyncio.create_task(_run_follow_up_reminders(app))
        if reminder_runner_enabled
        else None
    )
    try:
        yield
    finally:
        if reminder_task is not None:
            reminder_task.cancel()
            with suppress(asyncio.CancelledError):
                await reminder_task
        if postgres_manager is not None:
            with suppress(Exception):
                postgres_manager.close()


settings = config_module.get_settings()
app = FastAPI(title="Clinic EMR API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[SESSION_EXPIRES_AT_HEADER],
)


@app.middleware("http")
async def refresh_authenticated_session(request: Request, call_next):
    request_id = str(request.headers.get("X-Request-ID") or "").strip()[:128] or uuid4().hex
    request.state.request_id = request_id

    async def record_request(status_code: int) -> None:
        if request.method == "OPTIONS" or request.url.path.startswith("/health"):
            return
        current_user = getattr(request.state, "current_user", None)
        try:
            repo_factory = request.app.dependency_overrides.get(get_repository, get_repository)
            repo = repo_factory()
            await repo.record_api_request(
                org_id=str(current_user.org_id) if current_user is not None else None,
                status_code=status_code,
            )
        except Exception:
            logger.exception("Failed to persist request metric for %s %s", request.method, request.url.path)

    try:
        response: Response = await call_next(request)
    except Exception as exc:  # pragma: no cover
        await record_request(500)
        if request.url.path != "/health":
            current_user = getattr(request.state, "current_user", None)
            try:
                repo_factory = request.app.dependency_overrides.get(get_repository, get_repository)
                repo = repo_factory()
                await repo.create_platform_error(
                    org_id=str(current_user.org_id) if current_user is not None else None,
                    user_id=str(current_user.id) if current_user is not None else None,
                    identifier=current_user.identifier if current_user is not None else None,
                    path=request.url.path,
                    method=request.method,
                    status_code=None,
                    error_type=type(exc).__name__,
                    message=str(exc),
                    details=traceback.format_exc(),
                    context={"request_id": request_id},
                )
            except Exception:
                logger.exception("Failed to persist platform error for %s %s", request.method, request.url.path)
        raise
    background = response.background
    if isinstance(background, BackgroundTasks):
        background.add_task(record_request, response.status_code)
    else:
        tasks = BackgroundTasks()
        if background is not None:
            tasks.add_task(background)
        tasks.add_task(record_request, response.status_code)
        response.background = tasks
    response.headers["X-Request-ID"] = request_id
    current_user = getattr(request.state, "current_user", None)
    if current_user is not None and not getattr(request.state, "suppress_session_refresh", False):
        issue_session_headers(
            response,
            {
                "id": str(current_user.id),
                "org_id": str(current_user.org_id),
                "role": current_user.role,
                "identifier": current_user.identifier,
                "session_version": current_user.session_version,
            },
        )
    return response

for router in (
    health_router,
    mobile_router,
    settings_router,
    audit_router,
    auth_router,
    users_router,
    catalog_router,
    clinical_assistant_router,
    controlroom_router,
    exports_router,
    patients_router,
    attachments_router,
    appointments_router,
    followups_router,
    public_router,
    superuser_router,
    notes_router,
    billing_router,
    case_studies_router,
    care_programs_router,
    checkins_router,
    whatsapp_router,
):
    app.include_router(router)
