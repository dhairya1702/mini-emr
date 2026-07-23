from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.email_validation import normalize_single_email


class PatientAttachmentOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    uploaded_by: UUID | None = None
    file_name: str
    content_type: str
    file_size: int
    storage_path: str
    created_at: datetime


class SendPatientAttachmentRequest(BaseModel):
    recipient_email: str = Field(min_length=5, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(default="", max_length=2000)

    @field_validator("recipient_email")
    @classmethod
    def validate_recipient_email(cls, value: str) -> str:
        return normalize_single_email(value)


class SendPatientAttachmentResponse(BaseModel):
    success: bool
    message: str
    recipient_email: str = Field(min_length=5, max_length=200)
