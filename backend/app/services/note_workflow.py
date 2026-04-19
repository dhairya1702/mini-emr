from fastapi import HTTPException

from app.clinic_context import build_clinic_context, build_measurements_context, build_patient_context
from app.db import SupabaseRepository
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


async def generate_note_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: GenerateNoteRequest,
) -> GenerateNoteResponse:
    enforce_rate_limit("note_generation", str(current_user.id))
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    clinic_context = build_clinic_context(clinic_settings)
    patient = None
    if payload.patient_id:
        patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    patient_context = build_patient_context(patient)
    measurements_context = build_measurements_context(payload)

    content = await generate_soap_note(
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
                    summary=f"Created amended draft note v{note.get('version_number', 1)} for {patient_name}.",
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
                summary=f"Generated draft consultation note for {patient_name}.",
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
    clinic_context = build_clinic_context(clinic_settings)
    return await generate_clinic_letter(
        to=to,
        subject=subject,
        content=content,
        clinic_context=clinic_context,
    )


async def finalize_note_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: FinalizeNoteRequest,
) -> NoteOut:
    note = await repo.finalize_note(str(current_user.org_id), str(payload.note_id))
    await write_audit_event(
        repo,
        current_user,
        entity_type="note",
        entity_id=str(payload.note_id),
        action="consultation_note_finalized",
        summary=f"Finalized consultation note v{note.get('version_number', 1)}.",
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
    note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
    if str(note["patient_id"]) != str(payload.patient_id):
        raise HTTPException(status_code=400, detail="Note does not belong to that patient.")
    sent_note = await repo.mark_note_sent(
        str(current_user.org_id),
        str(payload.note_id),
        sent_by=str(current_user.id),
        sent_to=payload.phone,
    )
    await write_audit_event(
        repo,
        current_user,
        entity_type="note",
        entity_id=str(payload.note_id),
        action="consultation_note_shared",
        summary=f"Shared consultation note v{sent_note.get('version_number', 1)} with {payload.phone}.",
        metadata={
            "patient_id": str(payload.patient_id),
            "recipient": payload.phone,
            "sent_at": sent_note.get("sent_at"),
            "sent_by": str(current_user.id),
            "sent_by_name": get_actor_name(current_user),
            "sent_to": payload.phone,
            "version_number": sent_note.get("version_number", 1),
            "root_note_id": sent_note.get("root_note_id"),
            "amended_from_note_id": sent_note.get("amended_from_note_id"),
        },
    )
    return SendNoteResponse(
        success=True,
        message=f"Saved note locked and ready to share with {payload.phone}.",
    )
