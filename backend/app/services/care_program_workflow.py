from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.db import AppRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.care_programs import (
    MYOPIA_PROGRAM_KEY,
    CareProgramOfferingOut,
    MyopiaOfferingUpdate,
    MyopiaProgramDefinition,
    ProgramEnrollmentOut,
    ProgramEnrollmentSummaryOut,
    ProgramReportOut,
    standard_myopia_definition,
)
from app.services.document_helpers import build_document_context_for_user
from app.services.pdf_service import build_letter_pdf
from app.services.whatsapp_document_workflow import (
    _send_pdf_document,
    normalize_whatsapp_recipient,
)


def _ensure_optometry(settings: dict[str, Any]) -> None:
    if settings.get("clinic_specialty") != "optometry":
        raise ValueError("Care Programs v1 is available to optometry clinics.")


def _summary(row: dict[str, Any]) -> ProgramEnrollmentSummaryOut:
    snapshot = row.get("program_snapshot") or {}
    return ProgramEnrollmentSummaryOut(
        **row,
        program_name=str(snapshot.get("name") or "Myopia Care"),
    )


async def get_offerings_workflow(
    repo: AppRepository, current_user: UserOut
) -> list[CareProgramOfferingOut]:
    settings = await repo.get_clinic_settings(str(current_user.org_id))
    _ensure_optometry(settings)
    item = await repo.get_myopia_program_catalog_item(str(current_user.org_id))
    definition = standard_myopia_definition()
    if item and item.get("program_definition"):
        definition = MyopiaProgramDefinition.model_validate(item["program_definition"])
    return [
        CareProgramOfferingOut(
            program_key=MYOPIA_PROGRAM_KEY,
            enabled=item is not None,
            catalog_item_id=item.get("id") if item else None,
            name=str(item.get("name") if item else "Child Myopia Care"),
            description=str(
                item.get("description")
                if item
                else "A structured year of axial-length and refraction monitoring with four clinical reviews."
            ),
            default_price=float(item.get("default_price") or 0) if item else None,
            is_active=bool(item.get("is_active")) if item else False,
            definition=definition,
        )
    ]


async def upsert_myopia_offering_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: MyopiaOfferingUpdate,
) -> CareProgramOfferingOut:
    settings = await repo.get_clinic_settings(str(current_user.org_id))
    _ensure_optometry(settings)
    item = await repo.upsert_myopia_program(str(current_user.org_id), payload)
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=current_user.name or current_user.identifier,
        entity_type="care_program",
        entity_id=str(item["id"]),
        action="care_program_configured",
        summary=f"Configured {item['name']}.",
        metadata={"program_key": MYOPIA_PROGRAM_KEY, "is_active": payload.is_active},
    )
    return CareProgramOfferingOut(
        program_key=MYOPIA_PROGRAM_KEY,
        enabled=True,
        catalog_item_id=item["id"],
        name=item["name"],
        description=item.get("description") or "",
        default_price=float(item.get("default_price") or 0),
        is_active=bool(item.get("is_active")),
        definition=MyopiaProgramDefinition.model_validate(item["program_definition"]),
    )


async def list_enrollments_workflow(
    repo: AppRepository,
    current_user: UserOut,
    *,
    patient_id: str | None = None,
    status: str | None = None,
) -> list[ProgramEnrollmentSummaryOut]:
    rows = await repo.list_program_enrollments(
        str(current_user.org_id), patient_id=patient_id, status=status
    )
    return [_summary(row) for row in rows]


async def get_enrollment_workflow(
    repo: AppRepository, current_user: UserOut, enrollment_id: str
) -> ProgramEnrollmentOut:
    row = await repo.get_program_enrollment(str(current_user.org_id), enrollment_id)
    summary = _summary(row)
    return ProgramEnrollmentOut(
        **summary.model_dump(),
        program_snapshot=row.get("program_snapshot") or {},
        events=row.get("events") or [],
    )


async def assign_enrollment_workflow(
    repo: AppRepository, current_user: UserOut, enrollment_id: str, responsible_user_id: str
) -> ProgramEnrollmentOut:
    await repo.assign_program_enrollment(
        str(current_user.org_id), enrollment_id, responsible_user_id
    )
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=current_user.name or current_user.identifier,
        entity_type="care_program_enrollment",
        entity_id=enrollment_id,
        action="care_program_assigned",
        summary="Assigned a responsible doctor to a care program.",
        metadata={"responsible_user_id": responsible_user_id},
    )
    return await get_enrollment_workflow(repo, current_user, enrollment_id)


async def cancel_enrollment_workflow(
    repo: AppRepository, current_user: UserOut, enrollment_id: str, reason: str
) -> ProgramEnrollmentOut:
    await repo.cancel_program_enrollment(
        str(current_user.org_id), enrollment_id, reason, str(current_user.id)
    )
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=current_user.name or current_user.identifier,
        entity_type="care_program_enrollment",
        entity_id=enrollment_id,
        action="care_program_cancelled",
        summary="Cancelled a care program enrollment.",
        metadata={"reason": reason},
    )
    return await get_enrollment_workflow(repo, current_user, enrollment_id)


async def complete_review_workflow(
    repo: AppRepository,
    current_user: UserOut,
    enrollment_id: str,
    event_id: str,
    measurement_id: str,
) -> ProgramEnrollmentOut:
    event = await repo.complete_program_review(
        str(current_user.org_id),
        enrollment_id,
        event_id,
        measurement_id,
        str(current_user.id),
    )
    if event.get("_already_completed"):
        existing = await get_enrollment_workflow(repo, current_user, enrollment_id)
        has_report = any(
            report.event_type == "progress_report"
            and str(report.source_event_id or "") == event_id
            for report in existing.events
        )
        if not has_report:
            await create_report_workflow(
                repo,
                current_user,
                enrollment_id,
                event_id,
                clinician_comment="",
            )
            return await get_enrollment_workflow(repo, current_user, enrollment_id)
        return existing
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=current_user.name or current_user.identifier,
        entity_type="care_program_event",
        entity_id=event_id,
        action="care_program_review_completed",
        summary=f"Completed {event['title']}.",
        metadata={"enrollment_id": enrollment_id, "myopia_measurement_id": measurement_id},
    )
    await create_report_workflow(
        repo,
        current_user,
        enrollment_id,
        event_id,
        clinician_comment="",
    )
    return await get_enrollment_workflow(repo, current_user, enrollment_id)


def _measurement_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "measured_at": row["measured_at"].isoformat(),
        "age_years": float(row["age_years"]),
        "axial_length_right_mm": float(row["axial_length_right_mm"]),
        "axial_length_left_mm": float(row["axial_length_left_mm"]),
        "refraction_right": str(row.get("refraction_right") or ""),
        "refraction_left": str(row.get("refraction_left") or ""),
        "treatment_type": str(row.get("treatment_type") or ""),
        "treatment_notes": str(row.get("treatment_notes") or ""),
        "visit_notes": str(row.get("visit_notes") or ""),
    }


async def create_report_workflow(
    repo: AppRepository,
    current_user: UserOut,
    enrollment_id: str,
    review_event_id: str,
    clinician_comment: str,
) -> ProgramReportOut:
    enrollment = await repo.get_program_enrollment(str(current_user.org_id), enrollment_id)
    if not enrollment.get("responsible_user_id"):
        raise ValueError("Assign a responsible doctor before generating a report.")
    review = next(
        (event for event in enrollment.get("events", []) if str(event["id"]) == review_event_id),
        None,
    )
    if not review or review.get("event_type") != "review" or review.get("status") != "completed":
        raise ValueError("Complete the program review before generating its report.")
    patient = await repo.get_patient(str(current_user.org_id), str(enrollment["patient_id"]))
    doctor = await repo.get_user_for_org(
        str(current_user.org_id), str(enrollment["responsible_user_id"])
    )
    measurements = await repo.list_myopia_measurements_for_patient(
        str(current_user.org_id), str(enrollment["patient_id"])
    )
    measurements.sort(key=lambda row: row["measured_at"])
    linked_id = str(review.get("linked_entity_id") or "")
    current_index = next(
        (index for index, row in enumerate(measurements) if str(row["id"]) == linked_id),
        None,
    )
    if current_index is None:
        raise ValueError("Linked myopia measurement was not found.")
    report_measurements = measurements[: current_index + 1]
    current = report_measurements[-1]
    baseline = report_measurements[0]
    elapsed_years = max(
        (current["measured_at"] - baseline["measured_at"]).total_seconds()
        / (365.25 * 24 * 60 * 60),
        0,
    )
    right_delta = float(current["axial_length_right_mm"]) - float(baseline["axial_length_right_mm"])
    left_delta = float(current["axial_length_left_mm"]) - float(baseline["axial_length_left_mm"])
    snapshot = {
        "generated_at": datetime.now(UTC).isoformat(),
        "program_name": (enrollment.get("program_snapshot") or {}).get("name") or "Myopia Care",
        "review_title": review["title"],
        "patient": {
            "id": str(patient["id"]),
            "name": patient.get("name") or "Patient",
            "date_of_birth": patient.get("date_of_birth").isoformat() if patient.get("date_of_birth") else None,
        },
        "doctor": {"id": str(doctor["id"]), "name": doctor.get("name") or doctor.get("identifier") or ""},
        "measurements": [_measurement_payload(row) for row in report_measurements],
        "baseline_delta": {
            "right_mm": right_delta,
            "left_mm": left_delta,
        },
        "annualized_growth": {
            "right_mm_per_year": right_delta / elapsed_years if elapsed_years else None,
            "left_mm_per_year": left_delta / elapsed_years if elapsed_years else None,
        },
        "clinician_comment": clinician_comment.strip(),
        "next_review": next(
            (
                {"title": event["title"], "due_at": event["due_at"].isoformat()}
                for event in enrollment.get("events", [])
                if event.get("event_type") == "review" and event.get("status") == "scheduled"
            ),
            None,
        ),
    }
    report = await repo.create_program_report_event(
        str(current_user.org_id),
        enrollment_id,
        review_event_id,
        snapshot,
        str(current_user.id),
    )
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=current_user.name or current_user.identifier,
        entity_type="care_program_event",
        entity_id=str(report["id"]),
        action="care_program_report_generated",
        summary=f"Generated {report['title']}.",
        metadata={"enrollment_id": enrollment_id, "review_event_id": review_event_id},
    )
    return ProgramReportOut(
        id=report["id"],
        enrollment_id=enrollment["id"],
        source_review_event_id=review["id"],
        version=int((report.get("payload") or {}).get("version") or 1),
        generated_at=report["completed_at"],
    )


def _report_text(snapshot: dict[str, Any]) -> str:
    patient = snapshot.get("patient") or {}
    rows = snapshot.get("measurements") or []
    lines = [
        str(snapshot.get("program_name") or "Myopia Care"),
        f"Progress report: {snapshot.get('review_title') or 'Clinical review'}",
        "",
        f"Patient: {patient.get('name') or 'Patient'}",
        "",
        "Recorded progression",
    ]
    for row in rows:
        date_label = str(row.get("measured_at") or "")[:10]
        lines.append(
            f"{date_label}: OD {float(row.get('axial_length_right_mm') or 0):.2f} mm, "
            f"OS {float(row.get('axial_length_left_mm') or 0):.2f} mm; "
            f"Refraction OD {row.get('refraction_right') or '-'}, OS {row.get('refraction_left') or '-'}"
        )
    delta = snapshot.get("baseline_delta") or {}
    annualized = snapshot.get("annualized_growth") or {}
    lines.extend(
        [
            "",
            f"Change from baseline: OD {float(delta.get('right_mm') or 0):+.2f} mm, "
            f"OS {float(delta.get('left_mm') or 0):+.2f} mm",
        ]
    )
    if annualized.get("right_mm_per_year") is not None:
        lines.append(
            f"Annualized axial growth: OD {float(annualized['right_mm_per_year']):.2f} mm/year, "
            f"OS {float(annualized['left_mm_per_year']):.2f} mm/year"
        )
    if snapshot.get("clinician_comment"):
        lines.extend(["", "Clinician comment", str(snapshot["clinician_comment"])])
    if snapshot.get("next_review"):
        next_review = snapshot["next_review"]
        lines.extend(["", f"Next review: {next_review['title']} on {str(next_review['due_at'])[:10]}"])
    lines.extend(
        [
            "",
            "This report summarizes measurements recorded by the clinic. It is a planning aid and does not replace clinical assessment.",
        ]
    )
    return "\n".join(lines)


async def build_report_pdf_workflow(
    repo: AppRepository, current_user: UserOut, report_id: str
) -> tuple[bytes, dict[str, Any]]:
    report = await repo.get_program_report_event(str(current_user.org_id), report_id)
    clinic = await build_document_context_for_user(repo, current_user)
    snapshot = report.get("payload") or {}
    pdf = build_letter_pdf(
        clinic=clinic,
        letter_content=_report_text(snapshot),
        generated_on=str(snapshot.get("generated_at") or "")[:10],
    )
    return pdf, report


async def send_report_whatsapp_workflow(
    repo: AppRepository,
    current_user: UserOut,
    report_id: str,
    recipient_phone: str | None,
) -> str:
    pdf, report = await build_report_pdf_workflow(repo, current_user, report_id)
    enrollment = await repo.get_program_enrollment(
        str(current_user.org_id), str(report["enrollment_id"])
    )
    patient = await repo.get_patient(str(current_user.org_id), str(enrollment["patient_id"]))
    raw_phone = str(recipient_phone or patient.get("phone") or "").strip()
    recipient = normalize_whatsapp_recipient(raw_phone)
    snapshot = report.get("payload") or {}
    delivery = await _send_pdf_document(
        repo,
        org_id=str(current_user.org_id),
        recipient_wa_id=recipient,
        filename=f"{str(patient.get('name') or 'patient').replace(' ', '_')}_myopia_progress.pdf",
        caption=f"Here is the clinician-approved {snapshot.get('program_name') or 'Myopia Care'} progress report.",
        pdf_bytes=pdf,
        intent="send_care_program_report",
        raw_context={
            "report_event_id": str(report_id),
            "enrollment_id": str(enrollment["id"]),
            "patient_id": str(patient["id"]),
        },
        document_type="care_program_report",
        document_id=str(report_id),
    )
    return delivery.provider_message_id
