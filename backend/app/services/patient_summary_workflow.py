from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from typing import Any, TypedDict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.db import AppRepository
from app.services.clinic_settings_service import get_clinic_runtime_settings
from app.schema_domains.patients import calculate_age_from_dob
from app.services.ai_generation_service import generate_patient_summary

MAX_SUMMARY_VISITS = 2
MAX_SUMMARY_NOTE_CHARS = 3000
logger = logging.getLogger(__name__)


class PatientSummaryResult(TypedDict):
    summary: str
    updated_at: datetime | None
    used_fallback: bool
    warning: str | None
    stale: bool


class PatientSummarySource(TypedDict):
    context: dict[str, Any]
    source_hash: str


def _truncate(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _timestamp(row: dict[str, Any]) -> datetime:
    value = row.get("finalized_at") or row.get("sent_at") or row.get("created_at")
    return value if isinstance(value, datetime) else datetime.min.replace(tzinfo=UTC)


def _local_date(value: datetime, timezone_name: str):
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone = UTC
    aware = value if value.tzinfo else value.replace(tzinfo=UTC)
    return aware.astimezone(timezone).date()


def _visit_note(
    visit: dict[str, Any],
    recent_visits: list[dict[str, Any]],
    notes: list[dict[str, Any]],
    timezone_name: str,
) -> dict[str, Any] | None:
    visit_id = str(visit.get("id") or "")
    eligible = [note for note in notes if str(note.get("status") or "") in {"final", "sent"}]
    linked = [note for note in eligible if str(note.get("visit_id") or "") == visit_id]

    if not linked and visit.get("created_at"):
        visit_day = _local_date(visit["created_at"], timezone_name)
        visits_on_day = [
            item for item in recent_visits
            if item.get("created_at") and _local_date(item["created_at"], timezone_name) == visit_day
        ]
        if len(visits_on_day) == 1:
            linked = [
                note for note in eligible
                if not note.get("visit_id")
                and note.get("created_at")
                and _local_date(note["created_at"], timezone_name) == visit_day
            ]

    if not linked:
        return None

    # Amendments share a root. The newest finalized/sent version is the legally
    # relevant snapshot, and the newest relevant root is the visit summary input.
    newest_by_root: dict[str, dict[str, Any]] = {}
    for note in linked:
        root = str(note.get("root_note_id") or note.get("id") or "")
        if root not in newest_by_root or _timestamp(note) > _timestamp(newest_by_root[root]):
            newest_by_root[root] = note
    return max(newest_by_root.values(), key=_timestamp)


def build_patient_summary_source(
    patient: dict[str, Any],
    visits: list[dict[str, Any]],
    notes: list[dict[str, Any]],
    *,
    timezone_name: str = "UTC",
) -> PatientSummarySource:
    recent_visits = sorted(
        visits,
        key=lambda row: row.get("created_at") or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )[:MAX_SUMMARY_VISITS]

    demographics: dict[str, Any] = {}
    date_of_birth = patient.get("date_of_birth")
    age = calculate_age_from_dob(date_of_birth) if date_of_birth else patient.get("age")
    if age is not None:
        demographics["age_years"] = int(age)
    if patient.get("sex_at_birth"):
        demographics["sex"] = str(patient["sex_at_birth"])

    visit_context: list[dict[str, Any]] = []
    for visit in recent_visits:
        entry: dict[str, Any] = {
            "visit_id": str(visit.get("id") or ""),
            "occurred_at": visit["created_at"].isoformat() if visit.get("created_at") else None,
            "reason": _truncate(visit.get("reason"), 240),
            "visit_kind": str(visit.get("visit_kind") or "new"),
        }
        vitals = {
            key: visit.get(key)
            for key in ("temperature", "weight", "height")
            if visit.get(key) is not None
        }
        if vitals:
            entry["vitals"] = vitals
        note = _visit_note(visit, recent_visits, notes, timezone_name)
        if note:
            entry["consultation_note"] = _truncate(
                note.get("snapshot_content") or note.get("content"),
                MAX_SUMMARY_NOTE_CHARS,
            )
        visit_context.append({key: value for key, value in entry.items() if value not in (None, "")})

    context: dict[str, Any] = {"recent_visits": visit_context}
    if demographics:
        context["demographics"] = demographics
    canonical = json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return {
        "context": context,
        "source_hash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }


async def load_patient_summary_source(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
    *,
    patient: dict[str, Any] | None = None,
) -> PatientSummarySource:
    current_patient = patient or await repo.get_patient(org_id, patient_id)
    visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
    notes = await repo.list_notes_for_patient(org_id, patient_id)
    clinic_settings = await get_clinic_runtime_settings(repo, org_id)
    return build_patient_summary_source(
        current_patient,
        visits,
        notes,
        timezone_name=str(clinic_settings.get("timezone") or "UTC"),
    )


async def generate_patient_summary_workflow(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
) -> PatientSummaryResult:
    patient = await repo.get_patient(org_id, patient_id)
    expected_revision = int(patient.get("ai_summary_revision") or 0)
    source = await load_patient_summary_source(repo, org_id, patient_id, patient=patient)

    generation = await generate_patient_summary(
        repo,
        org_id,
        source_context=source["context"],
    )

    updated_at = datetime.now(UTC)
    summary = generation["content"]
    saved = await repo.save_patient_summary(
        org_id,
        patient_id,
        summary,
        updated_at,
        expected_revision,
        source["source_hash"],
    )
    if not saved:
        latest = await repo.get_patient(org_id, patient_id)
        return {
            "summary": str(latest.get("ai_summary") or ""),
            "updated_at": latest.get("ai_summary_updated_at") or updated_at,
            "used_fallback": False,
            "warning": None,
            "stale": True,
        }

    return {
        "summary": summary,
        "updated_at": updated_at,
        "used_fallback": generation["used_fallback"],
        "warning": generation.get("warning"),
        "stale": False,
    }


async def load_cached_patient_summary_workflow(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
) -> PatientSummaryResult:
    patient = await repo.get_patient(org_id, patient_id)
    cached = str(patient.get("ai_summary") or "").strip()
    return {
        "summary": cached,
        "updated_at": patient.get("ai_summary_updated_at"),
        "used_fallback": False,
        "warning": None,
        "stale": bool(cached and patient.get("ai_summary_stale")),
    }


async def regenerate_patient_summary_after_finalization(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
) -> None:
    """Refresh the stored summary without ever jeopardizing a finalized note."""
    try:
        await repo.mark_patient_summary_stale(org_id, patient_id)
        await generate_patient_summary_workflow(repo, org_id, patient_id)
    except Exception:
        logger.exception(
            "Patient summary regeneration failed after note finalization for org=%s patient=%s",
            org_id,
            patient_id,
        )
