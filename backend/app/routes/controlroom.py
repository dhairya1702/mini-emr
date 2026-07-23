from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import require_control_room_user
from app.config import get_settings
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.controlroom import (
    ControlRoomCheckOut,
    ControlRoomDatabaseOut,
    ControlRoomIncidentOut,
    ControlRoomIncidentsOut,
    ControlRoomRunbookOut,
    ControlRoomRunbookStepOut,
    ControlRoomRunbooksOut,
    ControlRoomStatusOut,
)


router = APIRouter()


def _status_for_count(count: int, *, warning_at: int = 1, failing_at: int = 10) -> str:
    if count >= failing_at:
        return "failing"
    if count >= warning_at:
        return "warning"
    return "healthy"


def _overall_status(checks: list[ControlRoomCheckOut]) -> str:
    statuses = {check.status for check in checks}
    if "failing" in statuses:
        return "failing"
    if "warning" in statuses:
        return "warning"
    if "unknown" in statuses:
        return "unknown"
    return "healthy"


def _check(
    *,
    key: str,
    label: str,
    status: str,
    evidence: str,
    checked_at: datetime,
    next_action: str = "",
) -> ControlRoomCheckOut:
    return ControlRoomCheckOut(
        key=key,
        label=label,
        status=status,
        evidence=evidence,
        next_action=next_action,
        checked_at=checked_at,
    )


@router.get("/controlroom/status", response_model=ControlRoomStatusOut)
async def get_controlroom_status(
    current_user: UserOut = Depends(require_control_room_user),
    repo: AppRepository = Depends(get_repository),
) -> ControlRoomStatusOut:
    del current_user
    checked_at = datetime.now(UTC)
    metrics = await repo.get_controlroom_status_metrics()
    database = metrics.get("database") or {}
    pending_migrations = database.get("pending_migrations") or []
    database_only = database.get("database_only_migrations") or []
    integrity_failures = [
        item for item in database.get("integrity_checks") or []
        if int(item.get("invalid_count") or 0) > 0
    ]
    request_metrics = metrics.get("request_metrics_24h") or {}
    errors_1h = metrics.get("errors_1h") or {}
    whatsapp = metrics.get("whatsapp_24h") or {}
    followups = metrics.get("followups_due") or {}
    ai_usage = metrics.get("ai_usage_24h") or {}
    email = metrics.get("email") or {}
    storage = metrics.get("storage") or {}
    settings = get_settings()
    request_count = int(request_metrics.get("request_count") or 0)
    error_response_count = int(request_metrics.get("error_response_count") or 0)
    error_rate = round((error_response_count / request_count) * 100, 2) if request_count else 0
    errors_last_hour = int(errors_1h.get("error_count") or 0)
    failed_whatsapp = int(whatsapp.get("failed_count") or 0)
    due_followups = int(followups.get("due_count") or 0)
    followup_errors = int(followups.get("error_count") or 0)
    checks = [
        _check(
            key="backend",
            label="Backend",
            status="healthy",
            evidence="Control room API responded.",
            checked_at=checked_at,
        ),
        _check(
            key="database",
            label="Database",
            status="healthy" if bool(database.get("reachable")) else "failing",
            evidence="Database read check succeeded." if bool(database.get("reachable")) else "Database read check failed.",
            checked_at=checked_at,
            next_action="Check Cloud SQL proxy/connectivity and /health/ready." if not bool(database.get("reachable")) else "",
        ),
        _check(
            key="migrations",
            label="Migrations",
            status="warning" if pending_migrations or database_only else "healthy",
            evidence=f"{len(pending_migrations)} pending, {len(database_only)} database-only records.",
            checked_at=checked_at,
            next_action="Run the repo migration status/verify commands before deploy." if pending_migrations or database_only else "",
        ),
        _check(
            key="tenant_integrity",
            label="Tenant Integrity",
            status="failing" if integrity_failures else "healthy",
            evidence=f"{len(integrity_failures)} failing integrity checks.",
            checked_at=checked_at,
            next_action="Open the Database tab and inspect invalid row counts." if integrity_failures else "",
        ),
        _check(
            key="error_rate",
            label="Error Rate",
            status="failing" if error_rate >= 5 else "warning" if error_rate >= 1 or errors_last_hour else "healthy",
            evidence=f"{error_rate}% 5xx responses over 24h; {errors_last_hour} platform errors in the last hour.",
            checked_at=checked_at,
            next_action="Open Incidents and inspect the top failing route." if error_rate >= 1 or errors_last_hour else "",
        ),
        _check(
            key="followups",
            label="Follow-up Runner",
            status="failing" if followup_errors else "warning" if due_followups else "healthy",
            evidence=f"{due_followups} due scheduled follow-ups; {followup_errors} with reminder errors.",
            checked_at=checked_at,
            next_action="Check the internal follow-up reminder route and Cloud Run logs." if followup_errors else "",
        ),
        _check(
            key="whatsapp",
            label="WhatsApp",
            status="unknown" if not bool(settings.whatsapp_enabled) else _status_for_count(failed_whatsapp, warning_at=1, failing_at=5),
            evidence="Disabled in runtime config." if not bool(settings.whatsapp_enabled) else f"{failed_whatsapp} failed message events in 24h.",
            checked_at=checked_at,
            next_action="Check webhook config and Meta delivery errors." if failed_whatsapp else "",
        ),
        _check(
            key="email",
            label="Email",
            status="healthy" if int(email.get("configured_org_count") or 0) else "warning",
            evidence=f"{int(email.get('configured_org_count') or 0)} orgs have sender email configured.",
            checked_at=checked_at,
            next_action="Verify clinic email settings before document-send workflows." if not int(email.get("configured_org_count") or 0) else "",
        ),
        _check(
            key="ai_usage",
            label="AI Usage",
            status="healthy",
            evidence=f"{int(ai_usage.get('request_count') or 0)} requests, {int(ai_usage.get('total_tokens') or 0)} tokens in 24h.",
            checked_at=checked_at,
        ),
        _check(
            key="storage",
            label="Storage",
            status="healthy",
            evidence=f"{int(storage.get('media_storage_bytes') or 0)} attachment bytes tracked.",
            checked_at=checked_at,
        ),
    ]
    return ControlRoomStatusOut(
        checked_at=checked_at,
        overall_status=_overall_status(checks),
        checks=checks,
    )


@router.get("/controlroom/database", response_model=ControlRoomDatabaseOut)
async def get_controlroom_database(
    current_user: UserOut = Depends(require_control_room_user),
    repo: AppRepository = Depends(get_repository),
) -> ControlRoomDatabaseOut:
    del current_user
    return ControlRoomDatabaseOut(**await repo.get_controlroom_database_overview())


@router.get("/controlroom/incidents", response_model=ControlRoomIncidentsOut)
async def get_controlroom_incidents(
    window_hours: int = Query(default=24, ge=1, le=168),
    current_user: UserOut = Depends(require_control_room_user),
    repo: AppRepository = Depends(get_repository),
) -> ControlRoomIncidentsOut:
    del current_user
    checked_at = datetime.now(UTC)
    incidents = await repo.list_controlroom_incidents(window_hours=window_hours)
    return ControlRoomIncidentsOut(
        checked_at=checked_at,
        window_hours=window_hours,
        incidents=[ControlRoomIncidentOut(**incident) for incident in incidents],
    )


def _runbooks() -> list[dict[str, Any]]:
    return [
        {
            "key": "deploy_backend",
            "title": "Deploy backend",
            "summary": "Prepare a backend Cloud Run revision with the repo deploy script.",
            "steps": [
                {"label": "Verify gcloud target", "command": "gcloud config configurations list"},
                {"label": "Deploy backend", "command": "./scripts/deploy-backend.sh"},
                {"label": "Verify health", "command": "curl -sS https://clinic-emr-backend-388811826415.asia-south1.run.app/health"},
            ],
        },
        {
            "key": "deploy_web",
            "title": "Deploy web",
            "summary": "Prepare a web Cloud Run revision with the repo deploy script.",
            "steps": [
                {"label": "Verify gcloud target", "command": "gcloud config configurations list"},
                {"label": "Deploy web", "command": "./scripts/deploy-web.sh"},
                {"label": "Verify web", "command": "curl -I -sS https://clinic-os-ai-388811826415.asia-south1.run.app"},
            ],
        },
        {
            "key": "apply_migration",
            "title": "Apply migration",
            "summary": "Apply pending migrations through the existing migration runner.",
            "steps": [
                {"label": "Check proxy port", "command": "lsof -nP -iTCP:5433 -sTCP:LISTEN"},
                {"label": "Start Cloud SQL proxy if needed", "command": "cloud-sql-proxy --port 5433 project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod"},
                {"label": "Check status", "command": "cd backend; set -a; source .env; set +a; .venv/bin/python -m app.migrations status"},
                {"label": "Apply", "command": "cd backend; set -a; source .env; set +a; .venv/bin/python -m app.migrations apply", "dangerous": True},
                {"label": "Verify", "command": "cd backend; set -a; source .env; set +a; .venv/bin/python -m app.migrations verify"},
            ],
        },
        {
            "key": "rollback",
            "title": "Rollback Cloud Run",
            "summary": "Move traffic back to a known-good revision.",
            "steps": [
                {"label": "List backend revisions", "command": "gcloud run revisions list --service=clinic-emr-backend --region=asia-south1"},
                {"label": "List web revisions", "command": "gcloud run revisions list --service=clinic-os-ai --region=asia-south1"},
                {"label": "Update traffic", "command": "gcloud run services update-traffic SERVICE --to-revisions REVISION=100 --region=asia-south1", "dangerous": True},
            ],
        },
        {
            "key": "investigate_500s",
            "title": "Investigate 500s",
            "summary": "Find the failing route, request ID, and Cloud Run logs.",
            "steps": [
                {"label": "Open Incidents tab", "note": "Start with the highest-count 5xx group."},
                {"label": "Read Cloud Run logs", "command": "gcloud logging read 'resource.type=\"cloud_run_revision\" severity>=ERROR' --limit=50"},
                {"label": "Check backend health", "command": "curl -sS https://clinic-emr-backend-388811826415.asia-south1.run.app/health"},
            ],
        },
    ]


@router.get("/controlroom/runbooks", response_model=ControlRoomRunbooksOut)
async def get_controlroom_runbooks(
    current_user: UserOut = Depends(require_control_room_user),
) -> ControlRoomRunbooksOut:
    del current_user
    return ControlRoomRunbooksOut(
        runbooks=[
            ControlRoomRunbookOut(
                **{
                    **runbook,
                    "steps": [ControlRoomRunbookStepOut(**step) for step in runbook["steps"]],
                }
            )
            for runbook in _runbooks()
        ]
    )
