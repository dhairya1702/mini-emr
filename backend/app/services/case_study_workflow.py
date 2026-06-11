from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException

from app.clinic_context import build_clinic_context
from app.db import AppRepository
from app.formatting import format_display_datetime
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.case_studies import (
    CaseStudyCreate,
    CaseStudyOut,
    GenerateCaseStudyRequest,
    GenerateCaseStudyResponse,
    PatientCaseStudySourceOut,
)
from app.schema_domains.patients import NoteOut, PatientOut, PatientVisitOut
from app.services.anthropic_service import generate_case_study_document
from app.services.auth_flow import enforce_rate_limit
from app.services.audit_service import write_audit_event
from app.services.case_study_specialty import apply_case_study_specialty_enrichment
from app.services.document_helpers import normalize_structured_document_content
from app.services.patient_views import (
    build_patient_name_map,
    build_patient_timeline_view,
    build_user_name_map,
    enrich_notes_with_sender_names,
)

CASE_STUDY_TEMPLATE_GUIDANCE = {
    "conference_presentation": "Emphasize chronology, key findings, interventions, outcomes, and concise learning points for conference presentation.",
    "teaching_rounds": "Emphasize teaching value, diagnostic reasoning, and discussion points suitable for bedside or classroom rounds.",
    "hospital_case_discussion": "Emphasize multidisciplinary context, management decisions, and discussion for a hospital case conference.",
}

CASE_STUDY_SECTION_HEADINGS = [
    "Title:",
    "Abstract:",
    "Background / Chief Concern:",
    "Chronological History:",
    "Examination / Findings:",
    "Investigations / Relevant Tests:",
    "Management / Interventions:",
    "Outcome / Follow-up:",
    "Discussion:",
    "Learning Points:",
]

MAX_CASE_STUDY_NOTE_CHARS = 1400
MAX_CASE_STUDY_EVENT_CHARS = 320
MAX_CASE_STUDY_VISITS = 10
MAX_CASE_STUDY_EVENTS = 12
MAX_CASE_STUDY_NOTES = 6


def _truncate_text(value: str, limit: int) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(limit - 1, 0)].rstrip() + "…"


def _case_study_title(patient: dict[str, Any], title: str = "") -> str:
    normalized = title.strip()
    if normalized:
        return normalized
    reason = str(patient.get("reason") or "Clinical Case").strip() or "Clinical Case"
    patient_age = patient.get("age")
    age_prefix = f"Age {patient_age} - " if patient_age is not None else ""
    return f"{age_prefix}{reason.title()}"


def _redact_text(value: str, replacements: list[tuple[str, str]]) -> str:
    redacted = value
    for needle, replacement in replacements:
        if not needle:
            continue
        redacted = re.sub(re.escape(needle), replacement, redacted, flags=re.IGNORECASE)
    return redacted


def anonymize_case_study_source(source: PatientCaseStudySourceOut) -> PatientCaseStudySourceOut:
    patient = source.patient.model_copy(deep=True)
    replacements = [
        (patient.name, "Patient A"),
        (patient.phone, "[redacted phone]"),
        (patient.email, "[redacted email]"),
        (patient.address, "[redacted address]"),
    ]
    patient.name = "Patient A"
    patient.phone = "[redacted phone]"
    patient.email = "[redacted email]"
    patient.address = "[redacted address]"

    visits = [
        visit.model_copy(
            update={
                "name": "Patient A",
                "phone": "[redacted phone]",
                "email": "[redacted email]",
                "address": "[redacted address]",
                "reason": _redact_text(visit.reason, replacements),
            }
        )
        for visit in source.visits
    ]
    timeline = [
        event.model_copy(
            update={
                "title": _redact_text(event.title, replacements),
                "description": _redact_text(event.description, replacements),
                "details": {
                    key: _redact_text(str(value), replacements) if isinstance(value, str) else value
                    for key, value in event.details.items()
                },
            }
        )
        for event in source.timeline
    ]
    notes = [
        note.model_copy(
            update={
                "content": _redact_text(note.content, replacements),
                "snapshot_content": _redact_text(note.snapshot_content or "", replacements) or None,
                "sent_to": _redact_text(note.sent_to or "", replacements) or None,
            }
        )
        for note in source.notes
    ]
    return PatientCaseStudySourceOut(
        patient=patient,
        visits=visits,
        timeline=timeline,
        notes=notes,
        myopia_history=source.myopia_history,
        pediatric_growth_history=source.pediatric_growth_history,
    )


def build_case_study_source_context(source: PatientCaseStudySourceOut, *, template_key: str, author_instructions: str) -> str:
    patient = source.patient
    lines = [
        f"Template Guidance: {CASE_STUDY_TEMPLATE_GUIDANCE.get(template_key, CASE_STUDY_TEMPLATE_GUIDANCE['conference_presentation'])}",
        f"Custom Author Instructions: {author_instructions.strip() or 'None provided'}",
        "",
        "Patient Summary:",
        f"- Name: {patient.name}",
        f"- Reason / presenting concern: {patient.reason}",
    ]
    if patient.age is not None:
        lines.append(f"- Age: {patient.age}")
    if patient.created_at:
        lines.append(f"- Record created: {format_display_datetime(patient.created_at)}")

    lines.extend(["", "Visit History:"])
    if source.visits:
        for visit in source.visits[-MAX_CASE_STUDY_VISITS:]:
            lines.append(
                f"- {format_display_datetime(visit.created_at)} | {_truncate_text(visit.reason, 120)} | age={visit.age if visit.age is not None else 'n/a'} | "
                f"weight={visit.weight if visit.weight is not None else 'n/a'} | height={visit.height if visit.height is not None else 'n/a'} | "
                f"temperature={visit.temperature if visit.temperature is not None else 'n/a'}"
            )
    else:
        lines.append("- No visit history recorded.")

    lines.extend(["", "Timeline Events:"])
    if source.timeline:
        for event in source.timeline[-MAX_CASE_STUDY_EVENTS:]:
            lines.append(
                f"- {format_display_datetime(event.timestamp)} | {_truncate_text(event.title, 100)} | "
                f"{_truncate_text(event.description, MAX_CASE_STUDY_EVENT_CHARS)}"
            )
    else:
        lines.append("- No timeline events recorded.")

    lines.extend(["", "Consultation Notes:"])
    if source.notes:
        for note in source.notes[:MAX_CASE_STUDY_NOTES]:
            snapshot = _truncate_text(str(note.snapshot_content or note.content or "").strip(), MAX_CASE_STUDY_NOTE_CHARS)
            lines.append(
                f"- {format_display_datetime(note.created_at)} | status={note.status} | version={note.version_number}\n{snapshot}"
            )
    else:
        lines.append("- No consultation notes recorded.")

    lines.extend(["", "Optometry Longitudinal Data:"])
    if source.myopia_history and source.myopia_history.records:
        for record in source.myopia_history.records[-10:]:
            lines.append(
                f"- {format_display_datetime(record.measured_at)} | age={record.age_years} | "
                f"OD axial length={record.axial_length_right_mm} mm | OS axial length={record.axial_length_left_mm} mm | "
                f"treatment={record.treatment_type or 'Not specified'} | notes={record.visit_notes or '-'}"
            )
    else:
        lines.append("- No specialty longitudinal measurements recorded.")
    lines.extend(["", "Pediatrics Growth Data:"])
    if source.pediatric_growth_history and source.pediatric_growth_history.records:
        for record in source.pediatric_growth_history.records[-10:]:
            lines.append(
                f"- {format_display_datetime(record.measured_at)} | "
                f"height={record.height_cm} cm | weight={record.weight_kg} kg | bmi={record.bmi} | "
                f"head circumference={record.head_circumference_cm if record.head_circumference_cm is not None else 'n/a'} | "
                f"notes={record.visit_notes or '-'}"
            )
    else:
        lines.append("- No pediatric growth measurements recorded.")
    return "\n".join(lines).strip()


async def build_base_case_study_source_view(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
) -> PatientCaseStudySourceOut:
    patient = PatientOut(**await repo.get_patient(org_id, patient_id))
    visits = [
        PatientVisitOut(
            **visit,
            status=patient.status,
            billed=patient.billed,
            last_visit_at=patient.last_visit_at,
        )
        for visit in await repo.list_patient_visits_for_patient(org_id, patient_id)
    ]
    notes = await repo.list_notes_for_patient(org_id, patient_id)
    user_names = await build_user_name_map(repo, org_id)
    note_rows = [NoteOut(**note) for note in enrich_notes_with_sender_names(notes, user_names)]
    timeline = await build_patient_timeline_view(repo, org_id, patient_id)
    return PatientCaseStudySourceOut(
        patient=patient,
        visits=visits,
        timeline=timeline,
        notes=note_rows,
        myopia_history=None,
        pediatric_growth_history=None,
    )


async def build_case_study_source_view(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
    *,
    anonymized: bool = False,
) -> PatientCaseStudySourceOut:
    base_source = await build_base_case_study_source_view(repo, org_id, patient_id)
    clinic_settings = await repo.get_clinic_settings(org_id)
    enriched_source = await apply_case_study_specialty_enrichment(
        repo,
        org_id,
        patient_id,
        clinic_settings.get("clinic_specialty"),
        base_source,
    )
    return anonymize_case_study_source(enriched_source) if anonymized else enriched_source


async def generate_case_study_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: GenerateCaseStudyRequest,
) -> GenerateCaseStudyResponse:
    enforce_rate_limit("case_study_generation", str(current_user.id))
    source = await build_case_study_source_view(
        repo,
        str(current_user.org_id),
        str(payload.patient_id),
        anonymized=payload.anonymized,
    )
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    doctor_profile = await repo.get_user(str(current_user.id))
    clinic_context = build_clinic_context(
        {
            **clinic_settings,
            "doctor_name": str(doctor_profile.get("name") or clinic_settings.get("doctor_name") or "").strip(),
        }
    )
    title = _case_study_title(source.patient.model_dump(mode="json"), payload.title)
    source_context = build_case_study_source_context(
        source,
        template_key=payload.template_key,
        author_instructions=payload.author_instructions,
    )
    content = await generate_case_study_document(
        repo,
        str(current_user.org_id),
        title=title,
        template_key=payload.template_key,
        author_instructions=payload.author_instructions,
        clinic_context=clinic_context,
        source_context=source_context,
        anonymized=payload.anonymized,
    )
    return GenerateCaseStudyResponse(
        title=title,
        content=normalize_structured_document_content(
            content,
            title=title,
            headings=CASE_STUDY_SECTION_HEADINGS,
            empty_message="Case study could not be generated from the available clinical history.",
        ),
        source=source,
    )


async def list_case_studies_view(repo: AppRepository, org_id: str) -> list[CaseStudyOut]:
    rows = await repo.list_case_studies(org_id)
    patient_names = await build_patient_name_map(repo, org_id)
    user_names = await build_user_name_map(repo, org_id)
    return [
        CaseStudyOut(
            **row,
            patient_name=patient_names.get(str(row.get("patient_id") or "")),
            created_by_name=user_names.get(str(row.get("created_by") or "")),
        )
        for row in rows
    ]


async def get_case_study_view(repo: AppRepository, org_id: str, case_study_id: str) -> CaseStudyOut:
    row = await repo.get_case_study(org_id, case_study_id)
    if not row:
        raise ValueError("Case study not found for this organization.")
    patient_names = await build_patient_name_map(repo, org_id)
    user_names = await build_user_name_map(repo, org_id)
    return CaseStudyOut(
        **row,
        patient_name=patient_names.get(str(row.get("patient_id") or "")),
        created_by_name=user_names.get(str(row.get("created_by") or "")),
    )


async def create_case_study_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: CaseStudyCreate,
) -> CaseStudyOut:
    saved = await repo.create_case_study(str(current_user.org_id), str(current_user.id), payload)
    patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    await write_audit_event(
        repo,
        current_user,
        entity_type="case_study",
        entity_id=str(saved["id"]),
        action="case_study_created",
        summary=f"Created {payload.status} case study for {patient.get('name') or 'patient'}.",
        metadata={
            "patient_id": str(payload.patient_id),
            "title": payload.title,
            "status": payload.status,
            "template_key": payload.template_key,
            "anonymized": payload.anonymized,
        },
    )
    return await get_case_study_view(repo, str(current_user.org_id), str(saved["id"]))


async def update_case_study_workflow(
    repo: AppRepository,
    current_user: UserOut,
    case_study_id: str,
    updates: dict[str, Any],
) -> CaseStudyOut:
    updated = await repo.update_case_study(str(current_user.org_id), case_study_id, updates)
    patient = await repo.get_patient(str(current_user.org_id), str(updated["patient_id"]))
    status = str(updated.get("status") or "draft")
    action = "case_study_finalized" if status == "final" else "case_study_updated"
    await write_audit_event(
        repo,
        current_user,
        entity_type="case_study",
        entity_id=str(updated["id"]),
        action=action,
        summary=f"Updated {status} case study for {patient.get('name') or 'patient'}.",
        metadata={
            "patient_id": str(updated["patient_id"]),
            "title": updated.get("title"),
            "status": status,
            "template_key": updated.get("template_key"),
            "anonymized": bool(updated.get("anonymized")),
        },
    )
    return await get_case_study_view(repo, str(current_user.org_id), case_study_id)


async def require_admin_case_study_access(current_user: UserOut) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required for case studies.")
