from app.db import SupabaseRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.mobile import (
    MobileFinalizeConsultationRequest,
    MobileFinalizeConsultationResponse,
)
from app.schema_domains.patients import NoteOut, PatientOut
from app.services.audit_service import write_audit_event


async def finalize_mobile_consultation_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: MobileFinalizeConsultationRequest,
) -> MobileFinalizeConsultationResponse:
    org_id = str(current_user.org_id)
    patient_id = str(payload.patient_id)
    note_id = str(payload.note_id)

    note = await repo.get_note(org_id, note_id)
    if str(note.get("patient_id")) != patient_id:
        raise ValueError("Note does not belong to that patient.")

    finalized_note = await repo.finalize_note(org_id, note_id)
    patient = await repo.update_patient(org_id, patient_id, {"status": "done"})
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"

    await write_audit_event(
        repo,
        current_user,
        entity_type="note",
        entity_id=note_id,
        action="consultation_note_finalized",
        summary=f"Finalized consultation note for {patient_name}.",
        metadata={
            "patient_id": patient_id,
            "patient_name": patient_name,
            "status": finalized_note.get("status"),
            "version_number": finalized_note.get("version_number", 1),
            "root_note_id": finalized_note.get("root_note_id"),
            "amended_from_note_id": finalized_note.get("amended_from_note_id"),
            "source": "mobile",
        },
    )
    await write_audit_event(
        repo,
        current_user,
        entity_type="patient",
        entity_id=patient_id,
        action="mobile_consultation_completed",
        summary=f"Completed mobile consultation for {patient_name}.",
        metadata={
            "patient_id": patient_id,
            "patient_name": patient_name,
            "note_id": note_id,
            "status": patient.get("status"),
        },
    )

    return MobileFinalizeConsultationResponse(
        note=NoteOut(**finalized_note),
        patient=PatientOut(**patient),
    )
