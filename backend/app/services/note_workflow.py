from datetime import datetime

from fastapi import HTTPException

from app.clinic_context import build_clinic_context, build_measurements_context, build_patient_context
from app.db import SupabaseRepository
from app.formatting import format_display_datetime
from app.schemas import (
    FinalizeNoteRequest,
    GenerateNoteRequest,
    GenerateNoteResponse,
    NoteCreate,
    NoteOut,
    SendNoteRequest,
    SendNoteResponse,
    UserOut,
)
from app.services.anthropic_service import generate_clinic_letter, generate_soap_note
from app.services.audit_service import get_actor_name, write_audit_event
from app.services.auth_flow import enforce_rate_limit
from app.services.email_service import send_clinic_email_message
from app.services.pdf_service import build_letter_pdf, build_note_pdf


async def generate_note_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: GenerateNoteRequest,
) -> GenerateNoteResponse:
    enforce_rate_limit("note_generation", str(current_user.id))
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
    if payload.patient_id:
        patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
        if payload.note_id:
            existing_note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
            if str(existing_note["patient_id"]) != str(payload.patient_id):
                raise HTTPException(status_code=400, detail="Note does not belong to that patient.")
            if existing_note.get("status") == "draft":
                note = await repo.update_note_draft(str(current_user.org_id), str(payload.note_id), content)
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
                    },
                )
            else:
                note = await repo.create_note_amendment(str(current_user.org_id), str(payload.note_id), content)
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
                    },
                )
        else:
            note = await repo.create_note(
                str(current_user.org_id),
                NoteCreate(patient_id=payload.patient_id, content=content),
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
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    doctor_profile = await repo.get_user(str(current_user.id))
    clinic_settings = {
        **clinic_settings,
        "doctor_name": str(doctor_profile.get("name") or clinic_settings.get("doctor_name") or "").strip(),
        "doctor_signature_name": doctor_profile.get("doctor_signature_name"),
        "doctor_signature_content_type": doctor_profile.get("doctor_signature_content_type"),
        "doctor_signature_data_base64": doctor_profile.get("doctor_signature_data_base64"),
    }
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
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    doctor_profile = await repo.get_user(str(current_user.id))
    clinic_settings = {
        **clinic_settings,
        "doctor_name": str(doctor_profile.get("name") or clinic_settings.get("doctor_name") or "").strip(),
        "doctor_signature_name": doctor_profile.get("doctor_signature_name"),
        "doctor_signature_content_type": doctor_profile.get("doctor_signature_content_type"),
        "doctor_signature_data_base64": doctor_profile.get("doctor_signature_data_base64"),
    }
    finalized_note = note if note.get("status") in {"final", "sent"} else await repo.finalize_note(
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
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
