from uuid import UUID

from pydantic import BaseModel

from app.schema_domains.patients import NoteOut, PatientOut


class MobileFinalizeConsultationRequest(BaseModel):
    patient_id: UUID
    note_id: UUID


class MobileFinalizeConsultationResponse(BaseModel):
    note: NoteOut
    patient: PatientOut
