import hmac
import logging
import asyncio
import base64
import json
from datetime import UTC, date, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.clinic_timezone import clinic_today, utc_day_bounds_for_clinic
from app.config import get_settings
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.common import FollowUpStatus
from app.schema_domains.patients import FollowUpCreate, FollowUpOut, FollowUpPageOut, FollowUpReminderOut, FollowUpReminderRequest, FollowUpUpdate
from app.services.followup_workflow import create_follow_up_workflow, enrich_follow_up_tracking, remind_follow_up_patient_workflow, send_due_follow_up_emails_workflow, update_follow_up_workflow
from app.services.clinic_settings_service import get_clinic_runtime_settings


logger = logging.getLogger(__name__)
router = APIRouter()
FollowUpView = Literal["needs_action", "delivery_issues", "history"]


def _encode_follow_up_cursor(scheduled_for: datetime, follow_up_id: UUID | str) -> str:
    payload = json.dumps(
        {"scheduled_for": scheduled_for.isoformat(), "id": str(follow_up_id)},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_follow_up_cursor(cursor: str | None) -> tuple[datetime | None, str | None]:
    if not cursor:
        return None, None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw)
        scheduled_for = datetime.fromisoformat(str(payload["scheduled_for"]).replace("Z", "+00:00"))
        follow_up_id = str(UUID(str(payload["id"])))
        return scheduled_for, follow_up_id
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid follow-up cursor.") from exc


def _system_user_for_org(org_id: str) -> UserOut:
    return UserOut.model_construct(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        org_id=UUID(org_id),
        identifier="scheduler-followup-reminder",
        name="System",
        role="admin",
        created_at=datetime.now(UTC),
    )


@router.post("/patients/{patient_id}/follow-ups", response_model=FollowUpOut, status_code=201)
async def create_follow_up(
    patient_id: str,
    payload: FollowUpCreate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        return await create_follow_up_workflow(repo, current_user, patient_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_follow_up") from exc


@router.get("/follow-ups", response_model=FollowUpPageOut)
async def list_follow_ups(
    view: FollowUpView = Query(default="needs_action"),
    status: FollowUpStatus | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    scheduled_date: date | None = Query(default=None),
    upcoming: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=500),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpPageOut:
    clinic_settings = await get_clinic_runtime_settings(repo, str(current_user.org_id))
    scheduled_from = None
    scheduled_to = None
    if scheduled_date is not None:
        scheduled_from, scheduled_to = utc_day_bounds_for_clinic(scheduled_date, clinic_settings)
    elif upcoming:
        scheduled_from, _ = utc_day_bounds_for_clinic(clinic_today(clinic_settings), clinic_settings)
        scheduled_to = None
    cursor_scheduled_for, cursor_id = _decode_follow_up_cursor(cursor)
    page_loader = getattr(repo, "list_follow_up_page", None)
    if callable(page_loader):
        page = await page_loader(
            str(current_user.org_id),
            view=view,
            limit=limit,
            cursor_scheduled_for=cursor_scheduled_for,
            cursor_id=cursor_id,
            status=status,
            query=q,
            scheduled_from=scheduled_from,
            scheduled_to=scheduled_to,
        )
        items = [FollowUpOut(**row) for row in page["items"]]
        next_cursor = (
            _encode_follow_up_cursor(items[-1].scheduled_for, items[-1].id)
            if page["has_more"] and items
            else None
        )
        return FollowUpPageOut(
            items=items,
            next_cursor=next_cursor,
            has_more=bool(page["has_more"]),
            counts=page["counts"],
        )

    # Compatibility for non-Postgres repository implementations used by local
    # training and tests. Production uses the batched query above.
    follow_ups = await repo.list_follow_ups(
        str(current_user.org_id), status=status, query=q, limit=500,
        scheduled_from=scheduled_from, scheduled_to=scheduled_to,
    )
    enriched = await asyncio.gather(*(enrich_follow_up_tracking(repo, row) for row in follow_ups))
    classified: dict[str, list[dict]] = {"needs_action": [], "delivery_issues": [], "history": []}
    for row in enriched:
        booked = bool(row.get("appointment_id") and row.get("appointment_status") != "cancelled")
        if row.get("status") != "scheduled" or booked:
            row_view = "history"
        elif row.get("last_delivery_status") in {"failed", "partial"}:
            row_view = "delivery_issues"
        else:
            row_view = "needs_action"
        classified[row_view].append(row)
    reverse = view == "history"
    rows = sorted(
        classified[view],
        key=lambda row: (row["scheduled_for"], str(row["id"])),
        reverse=reverse,
    )
    if cursor_scheduled_for and cursor_id:
        cursor_key = (cursor_scheduled_for, cursor_id)
        rows = [
            row for row in rows
            if ((row["scheduled_for"], str(row["id"])) < cursor_key if reverse else (row["scheduled_for"], str(row["id"])) > cursor_key)
        ]
    has_more = len(rows) > limit
    items = [FollowUpOut(**row) for row in rows[:limit]]
    return FollowUpPageOut(
        items=items,
        next_cursor=_encode_follow_up_cursor(items[-1].scheduled_for, items[-1].id) if has_more and items else None,
        has_more=has_more,
        counts={key: len(value) for key, value in classified.items()},
    )


@router.post("/follow-ups/{follow_up_id}/remind", response_model=FollowUpReminderOut)
async def remind_follow_up_patient(
    follow_up_id: str,
    payload: FollowUpReminderRequest,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpReminderOut:
    try:
        return await remind_follow_up_patient_workflow(repo, current_user, follow_up_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="remind_follow_up_patient") from exc


@router.patch("/follow-ups/{follow_up_id}", response_model=FollowUpOut)
async def update_follow_up(
    follow_up_id: str,
    payload: FollowUpUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        return await update_follow_up_workflow(repo, current_user, follow_up_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_follow_up") from exc


@router.post("/internal/run-follow-up-reminders")
async def run_follow_up_reminders(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    repo: AppRepository = Depends(get_repository),
) -> dict[str, int | bool | list[str]]:
    expected_token = str(get_settings().internal_scheduler_token or "").strip()
    provided_token = str(x_internal_token or "").strip()

    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_SCHEDULER_TOKEN is not configured.",
        )
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal token.",
        )

    processed = 0
    failed_orgs: list[str] = []
    for org_id in await repo.list_organization_ids():
        try:
            await send_due_follow_up_emails_workflow(repo, _system_user_for_org(str(org_id)))
            processed += 1
        except Exception:
            logger.exception("Failed to run follow-up reminders for org %s", org_id)
            failed_orgs.append(str(org_id))

    return {"success": not failed_orgs, "processed_orgs": processed, "failed_orgs": failed_orgs}
