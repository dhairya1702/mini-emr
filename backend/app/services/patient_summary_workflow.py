from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, TypedDict

from app.clinic_context import build_patient_context
from app.db import AppRepository
from app.formatting import format_display_datetime
from app.services.ai_generation_service import generate_patient_summary

# Cheap pre-pass scope: keep the prompt small and the cost negligible.
MAX_SUMMARY_VISITS = 2
MAX_SUMMARY_NOTES = 2
MAX_SUMMARY_NOTE_CHARS = 1200


class PatientSummaryResult(TypedDict):
    summary: str
    updated_at: datetime
    used_fallback: bool
    warning: str | None
    stale: bool


def _truncate(value: str, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _sorted_recent(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    def _key(row: dict[str, Any]) -> Any:
        return row.get("created_at") or datetime.min

    return sorted(rows, key=_key, reverse=True)[:limit]


def build_patient_history_context(
    visits: list[dict[str, Any]], notes: list[dict[str, Any]]
) -> str:
    finalized_notes = [
        note for note in notes if str(note.get("status") or "") == "finalized"
    ]
    recent_notes = _sorted_recent(finalized_notes, MAX_SUMMARY_NOTES)
    recent_visits = _sorted_recent(visits, MAX_SUMMARY_VISITS)

    lines: list[str] = ["Recent visits:"]
    if recent_visits:
        for visit in recent_visits:
            when = (
                format_display_datetime(visit["created_at"])
                if visit.get("created_at")
                else "Unknown date"
            )
            lines.append(f"- {when} | {_truncate(visit.get('reason'), 160)}")
    else:
        lines.append("- No prior visits recorded.")

    lines.extend(["", "Recent finalized notes:"])
    if recent_notes:
        for note in recent_notes:
            when = (
                format_display_datetime(note["created_at"])
                if note.get("created_at")
                else "Unknown date"
            )
            body = _truncate(
                str(note.get("snapshot_content") or note.get("content") or "").strip(),
                MAX_SUMMARY_NOTE_CHARS,
            )
            lines.append(f"- {when}\n{body}")
    else:
        lines.append("- No finalized consultation notes recorded.")

    return "\n".join(lines).strip()


async def generate_patient_summary_workflow(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
) -> PatientSummaryResult:
    patient = await repo.get_patient(org_id, patient_id)
    expected_revision = int(patient.get("ai_summary_revision") or 0)
    visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
    notes = await repo.list_notes_for_patient(org_id, patient_id)

    patient_context = build_patient_context(patient)
    history_context = build_patient_history_context(visits, notes)

    generation = await generate_patient_summary(
        repo,
        org_id,
        patient_context=patient_context,
        history_context=history_context,
    )

    updated_at = datetime.now(UTC)
    summary = generation["content"]
    saved = await repo.save_patient_summary(
        org_id,
        patient_id,
        summary,
        updated_at,
        expected_revision,
    )
    if not saved:
        latest = await repo.get_patient(org_id, patient_id)
        return {
            "summary": str(latest.get("ai_summary") or ""),
            "updated_at": latest.get("ai_summary_updated_at") or updated_at,
            "used_fallback": False,
            "warning": "The patient record changed while the summary was generated. Refresh it again.",
            "stale": True,
        }

    return {
        "summary": summary,
        "updated_at": updated_at,
        "used_fallback": generation["used_fallback"],
        "warning": generation.get("warning"),
        "stale": not saved,
    }
