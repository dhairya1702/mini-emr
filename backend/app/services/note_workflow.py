from datetime import UTC, datetime

from fastapi import HTTPException

from app.clinic_context import build_clinic_context, build_measurements_context, build_patient_context
from app.db import SupabaseRepository
from app.formatting import format_display_datetime
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.documents import (
    FinalizeNoteRequest,
    GenerateParentHandoutRequest,
    GenerateParentHandoutResponse,
    GenerateNoteRequest,
    GenerateNoteResponse,
    SendNoteRequest,
    SendNoteResponse,
)
from app.schema_domains.patients import (
    NoteCreate,
    NoteOut,
)
from app.services.anthropic_service import generate_clinic_letter, generate_soap_note
from app.services.audit_service import get_actor_name, write_audit_event
from app.services.auth_flow import enforce_rate_limit
from app.services.document_helpers import build_document_context_for_user, serialize_note_assets
from app.services.email_service import send_clinic_email_message
from app.services.pdf_service import build_letter_pdf, build_note_pdf

PEDIATRIC_HANDOUT_TITLES = {
    "fever_home_care": "Fever Home Care",
    "nutrition_guidance": "Nutrition Guidance",
    "well_visit_summary": "Well-Visit Summary",
    "hydration_uri_home_care": "Hydration and Cold Care",
}


async def _record_note_delivery_failure(
    repo: SupabaseRepository,
    current_user: UserOut,
    *,
    note_id: str,
    patient_id: str,
    patient_name: str,
    recipient_email: str,
    finalized: bool,
    error_message: str,
) -> None:
    await repo.create_platform_error(
        org_id=str(current_user.org_id),
        user_id=str(current_user.id),
        identifier=current_user.identifier,
        path="/send-note",
        method="POST",
        status_code=502,
        error_type="EmailDeliveryError",
        message=error_message,
        details="Consultation note email delivery failed after note state was prepared.",
        context={
            "note_id": note_id,
            "patient_id": patient_id,
            "patient_name": patient_name,
            "recipient_email": recipient_email,
            "finalized": finalized,
        },
    )


async def generate_note_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: GenerateNoteRequest,
) -> GenerateNoteResponse:
    enforce_rate_limit("note_generation", str(current_user.id))
    clinic_context = build_clinic_context(await build_document_context_for_user(repo, current_user))
    patient = None
    if payload.patient_id:
        patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    patient_context = build_patient_context(patient)
    measurements_context = build_measurements_context(payload)

    content = await generate_soap_note(
        repo,
        str(current_user.org_id),
        symptoms=payload.symptoms,
        diagnosis=payload.diagnosis,
        medications=payload.medications,
        notes=payload.notes,
        patient_context=patient_context,
        clinic_context=clinic_context,
        measurements_context=measurements_context,
    )
    note = None
    asset_payload = serialize_note_assets(payload.assets)
    structured_modules = [module.model_dump(mode="json") for module in payload.structured_modules]
    if payload.patient_id:
        patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
        if payload.note_id:
            existing_note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
            if str(existing_note["patient_id"]) != str(payload.patient_id):
                raise HTTPException(status_code=400, detail="Note does not belong to that patient.")
            if existing_note.get("status") == "draft":
                note = await repo.update_note_draft(
                    str(current_user.org_id),
                    str(payload.note_id),
                    content,
                    asset_payload,
                    structured_modules,
                )
                await write_audit_event(
                    repo,
                    current_user,
                    entity_type="note",
                    entity_id=str(note["id"]),
                    action="consultation_note_updated",
                    summary=f"Updated draft consultation note for {patient_name}.",
                    metadata={
                        "patient_id": str(payload.patient_id),
                        "patient_name": patient_name,
                        "status": note.get("status"),
                        "version_number": note.get("version_number", 1),
                        "asset_count": len(asset_payload),
                    },
                )
            else:
                note = await repo.create_note_amendment(
                    str(current_user.org_id),
                    str(payload.note_id),
                    content,
                    asset_payload,
                    structured_modules,
                )
                await write_audit_event(
                    repo,
                    current_user,
                    entity_type="note",
                    entity_id=str(note["id"]),
                    action="consultation_note_amended",
                    summary=f"Created amended draft consultation note for {patient_name}.",
                    metadata={
                        "patient_id": str(payload.patient_id),
                        "patient_name": patient_name,
                        "status": note.get("status"),
                        "version_number": note.get("version_number", 1),
                        "amended_from_note_id": note.get("amended_from_note_id"),
                        "root_note_id": note.get("root_note_id"),
                        "asset_count": len(asset_payload),
                    },
                )
        else:
            note = await repo.create_note(
                str(current_user.org_id),
                NoteCreate(
                    patient_id=payload.patient_id,
                    content=content,
                    asset_payload=asset_payload,
                    structured_modules=structured_modules,
                ),
            )
            await write_audit_event(
                repo,
                current_user,
                entity_type="note",
                entity_id=str(note["id"]),
                action="consultation_note_created",
                summary=f"Generated consultation note draft for {patient_name}.",
                metadata={
                    "patient_id": str(payload.patient_id),
                    "patient_name": patient_name,
                    "status": note.get("status"),
                    "version_number": note.get("version_number", 1),
                    "asset_count": len(asset_payload),
                },
            )
    return GenerateNoteResponse(
        content=content,
        note_id=note["id"] if note else None,
        status=note.get("status") if note else None,
    )


async def generate_letter_content(
    repo: SupabaseRepository,
    current_user: UserOut,
    *,
    to: str,
    subject: str,
    content: str,
) -> str:
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    doctor_profile = await repo.get_user(str(current_user.id))
    clinic_context = build_clinic_context(
        {
            **clinic_settings,
            "doctor_name": str(doctor_profile.get("name") or clinic_settings.get("doctor_name") or "").strip(),
            "doctor_signature_name": doctor_profile.get("doctor_signature_name"),
            "doctor_signature_content_type": doctor_profile.get("doctor_signature_content_type"),
            "doctor_signature_data_base64": doctor_profile.get("doctor_signature_data_base64"),
        }
    )
    return await generate_clinic_letter(
        repo,
        str(current_user.org_id),
        to=to,
        subject=subject,
        content=content,
        clinic_context=clinic_context,
    )


def _patient_display_name(patient: dict) -> str:
    return str(patient.get("name") or "Patient").strip() or "Patient"


def _clinic_display_name(clinic_settings: dict) -> str:
    return str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"


def _pediatric_handout_body(
    template_key: str,
    *,
    patient: dict,
    clinic_name: str,
    instructions: str,
    well_child_visit: dict | None,
) -> str:
    patient_name = _patient_display_name(patient)
    age = patient.get("age")
    age_line = f"Age: {age}" if age is not None else "Age: Not recorded"
    instructions_line = instructions.strip()
    well_child_visit = well_child_visit or {}
    visit_band = str(well_child_visit.get("visit_band") or "").replace("_", " ").strip()
    assessment_summary = str(well_child_visit.get("assessment_summary") or "").strip()
    parent_concerns = str(well_child_visit.get("parent_concerns") or "").strip()
    nutrition_summary = str(well_child_visit.get("nutrition_summary") or "").strip()
    sleep_summary = str(well_child_visit.get("sleep_summary") or "").strip()
    elimination_summary = str(well_child_visit.get("elimination_summary") or "").strip()

    common_lines = [
        f"Clinic: {clinic_name}",
        f"Patient: {patient_name}",
        age_line,
        "",
    ]

    if template_key == "fever_home_care":
        lines = common_lines + [
            "Fever Home Care",
            "",
            "What to do at home:",
            "- Encourage frequent fluids in small amounts.",
            "- Dress the child lightly and keep the room comfortably cool.",
            "- Use fever medicine exactly as advised by your clinician.",
            "- Let the child rest and monitor urine output and activity.",
            "",
            "Call the clinic urgently if:",
            "- Fever is not improving, the child is unusually sleepy, breathing is difficult, or fluids are not staying down.",
            "- There are seizures, persistent vomiting, severe pain, or signs of dehydration.",
        ]
    elif template_key == "nutrition_guidance":
        lines = common_lines + [
            "Nutrition Guidance",
            "",
            "Home goals:",
            "- Offer balanced meals with protein, fruit, vegetables, grains, and dairy or equivalent calcium sources.",
            "- Keep sugary drinks limited and prioritize water through the day.",
            "- Maintain predictable snack and meal timing.",
            "- Review growth again if appetite, weight, or energy changes noticeably.",
        ]
        if nutrition_summary:
            lines.extend(["", f"Today's nutrition notes: {nutrition_summary}"])
    elif template_key == "well_visit_summary":
        lines = common_lines + [
            "Well-Visit Summary",
            "",
            f"Visit band: {visit_band or 'General pediatric review'}",
            f"Assessment: {assessment_summary or 'Routine pediatric review completed.'}",
            f"Parent concerns: {parent_concerns or 'No additional concerns recorded.'}",
            f"Nutrition: {nutrition_summary or 'Discussed routine nutrition guidance.'}",
            f"Sleep: {sleep_summary or 'Discussed age-appropriate sleep routine.'}",
            f"Elimination: {elimination_summary or 'No specific elimination concerns recorded.'}",
            "",
            "Next steps:",
            "- Continue routine monitoring at home.",
            "- Follow the clinic plan for growth, symptoms, and the next review.",
        ]
    elif template_key == "hydration_uri_home_care":
        lines = common_lines + [
            "Hydration and Cold Care",
            "",
            "Home care reminders:",
            "- Encourage frequent sips of water, ORS, milk, or other tolerated fluids.",
            "- Use saline, steam, or humidified air if advised for congestion.",
            "- Keep meals simple and focus on hydration while appetite is reduced.",
            "- Rest and observe breathing, urine output, and activity level.",
            "",
            "Contact the clinic if symptoms worsen, breathing becomes difficult, or hydration drops.",
        ]
    else:
        raise HTTPException(status_code=400, detail="Unknown pediatric handout template.")

    if instructions_line:
        lines.extend(["", f"Clinic notes: {instructions_line}"])

    lines.extend([
        "",
        f"Prepared by {clinic_name} on {datetime.now(UTC).strftime('%b %d, %Y')}.",
    ])
    return "\n".join(lines).strip()


async def generate_parent_handout_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: GenerateParentHandoutRequest,
) -> GenerateParentHandoutResponse:
    patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    clinic_settings = await build_document_context_for_user(repo, current_user)
    title = PEDIATRIC_HANDOUT_TITLES.get(payload.template_key)
    if not title:
        raise HTTPException(status_code=400, detail="Unknown pediatric handout template.")
    content = _pediatric_handout_body(
        payload.template_key,
        patient=patient,
        clinic_name=_clinic_display_name(clinic_settings),
        instructions=payload.instructions,
        well_child_visit=payload.well_child_visit.model_dump(mode="json") if payload.well_child_visit else None,
    )
    return GenerateParentHandoutResponse(title=title, content=content)


async def send_letter_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    *,
    recipient_email: str,
    subject: str,
    content: str,
) -> SendNoteResponse:
    normalized_email = recipient_email.strip()
    if "@" not in normalized_email:
        raise HTTPException(status_code=400, detail="Enter a valid recipient email.")
    clinic_settings = await build_document_context_for_user(repo, current_user)
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    generated_on = datetime.now().strftime("%b %d, %Y")
    pdf_bytes = build_letter_pdf(
        clinic=clinic_settings,
        letter_content=content.strip(),
        generated_on=generated_on,
    )
    try:
        await send_clinic_email_message(
            clinic_settings=clinic_settings,
            recipient=normalized_email,
            subject=subject.strip(),
            text_content=content.strip(),
            attachments=[("clinic_letter.pdf", pdf_bytes, "application/pdf")],
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SendNoteResponse(
        success=True,
        message=f"Letter emailed to {normalized_email} from {clinic_name}.",
    )


async def finalize_note_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: FinalizeNoteRequest,
) -> NoteOut:
    note = await repo.finalize_note(str(current_user.org_id), str(payload.note_id))
    patient = await repo.get_patient(str(current_user.org_id), str(note["patient_id"]))
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
    await write_audit_event(
        repo,
        current_user,
        entity_type="note",
        entity_id=str(payload.note_id),
        action="consultation_note_finalized",
        summary=f"Finalized consultation note for {patient_name}.",
        metadata={
            "patient_id": str(note["patient_id"]),
            "patient_name": patient_name,
            "status": note.get("status"),
            "version_number": note.get("version_number", 1),
            "root_note_id": note.get("root_note_id"),
            "amended_from_note_id": note.get("amended_from_note_id"),
        },
    )
    return NoteOut(**note)


async def send_note_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: SendNoteRequest,
) -> SendNoteResponse:
    recipient_email = payload.recipient_email.strip()
    if "@" not in recipient_email:
        raise HTTPException(status_code=400, detail="Enter a valid recipient email.")
    note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
    if str(note["patient_id"]) != str(payload.patient_id):
        raise HTTPException(status_code=400, detail="Note does not belong to that patient.")
    patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    clinic_settings = await build_document_context_for_user(repo, current_user)
    finalized_during_request = note.get("status") not in {"final", "sent"}
    finalized_note = note if not finalized_during_request else await repo.finalize_note(
        str(current_user.org_id),
        str(payload.note_id),
    )
    snapshot_content = str(finalized_note.get("snapshot_content") or finalized_note.get("content") or "").strip()
    if not snapshot_content:
        raise HTTPException(status_code=400, detail="Saved note content is empty.")
    generated_on = format_display_datetime(finalized_note.get("finalized_at") or finalized_note.get("created_at") or datetime.now())
    pdf_bytes = build_note_pdf(
        patient={**patient, **clinic_settings},
        note_content=snapshot_content,
        generated_on=generated_on,
        assets=finalized_note.get("snapshot_asset_payload") or finalized_note.get("asset_payload") or [],
    )
    patient_name = str(patient.get("name") or "").strip() or "Patient"
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    subject = f"{clinic_name} consultation note for {patient_name}"
    try:
        await send_clinic_email_message(
            clinic_settings=clinic_settings,
            recipient=recipient_email,
            subject=subject,
            text_content=(
                f"Consultation note for {patient_name} is attached as a PDF.\n\n"
                f"Sent from {clinic_name}."
            ),
            attachments=[
                (f"{patient_name.replace(' ', '_') or 'patient'}_consultation_note.pdf", pdf_bytes, "application/pdf"),
            ],
        )
    except RuntimeError as exc:
        if finalized_during_request:
            failure_message = (
                f"Consultation note finalized for {patient_name}, but email delivery to {recipient_email} failed: {exc}"
            )
        else:
            failure_message = (
                f"Consultation note email delivery to {recipient_email} failed: {exc}"
            )
        await _record_note_delivery_failure(
            repo,
            current_user,
            note_id=str(payload.note_id),
            patient_id=str(payload.patient_id),
            patient_name=patient_name,
            recipient_email=recipient_email,
            finalized=finalized_during_request or finalized_note.get("status") in {"final", "sent"},
            error_message=failure_message,
        )
        raise HTTPException(
            status_code=502,
            detail={
                "message": failure_message,
                "delivery_failed": True,
                "finalized": finalized_during_request or finalized_note.get("status") in {"final", "sent"},
            },
        ) from exc
    sent_note = await repo.mark_note_sent(
        str(current_user.org_id),
        str(payload.note_id),
        sent_by=str(current_user.id),
        sent_to=recipient_email,
    )
    await write_audit_event(
        repo,
        current_user,
        entity_type="note",
        entity_id=str(payload.note_id),
        action="consultation_note_shared",
        summary=f"Shared consultation note with {recipient_email}.",
        metadata={
            "patient_id": str(payload.patient_id),
            "patient_name": patient_name,
            "recipient": recipient_email,
            "sent_at": sent_note.get("sent_at"),
            "sent_by": str(current_user.id),
            "sent_by_name": get_actor_name(current_user),
            "sent_to": recipient_email,
            "version_number": sent_note.get("version_number", 1),
            "root_note_id": sent_note.get("root_note_id"),
            "amended_from_note_id": sent_note.get("amended_from_note_id"),
        },
    )
    return SendNoteResponse(
        success=True,
        message=f"Consultation note emailed to {recipient_email}.",
    )
