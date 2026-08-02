from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.email_validation import normalize_single_email


ReferralUrgency = Literal["routine", "urgent", "emergency"]
ReferralRecipientType = Literal["patient", "doctor", "both"]
ReferralChannel = Literal["email", "whatsapp"]


class ReferralPackageCreate(BaseModel):
    recipient_type: ReferralRecipientType = "doctor"
    recipient_name: str = Field(default="", max_length=200)
    recipient_specialty: str = Field(default="", max_length=200)
    recipient_clinic: str = Field(default="", max_length=240)
    recipient_email: str = Field(default="", max_length=320)
    recipient_phone: str = Field(default="", max_length=40)
    reason: str = Field(min_length=1, max_length=8000)
    clinical_question: str = Field(default="", max_length=8000)
    urgency: ReferralUrgency = "routine"
    referral_note: str = Field(default="", max_length=20000)
    consultation_note_ids: list[UUID] = Field(default_factory=list, max_length=30)
    longitudinal_track_ids: list[UUID] = Field(default_factory=list, max_length=50)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=30)

    @field_validator("recipient_email")
    @classmethod
    def validate_optional_email(cls, value: str) -> str:
        return normalize_single_email(value) if value.strip() else ""

    @model_validator(mode="after")
    def require_content(self) -> "ReferralPackageCreate":
        if not (self.consultation_note_ids or self.longitudinal_track_ids or self.attachment_ids):
            raise ValueError("Select at least one consultation, test, or attachment.")
        if self.recipient_type in {"doctor", "both"} and not self.recipient_name.strip():
            raise ValueError("Receiving doctor name is required.")
        return self


class ReferralSendRecipient(BaseModel):
    recipient_type: Literal["patient", "doctor"]
    name: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=40)

    @field_validator("email")
    @classmethod
    def validate_optional_email(cls, value: str) -> str:
        return normalize_single_email(value) if value.strip() else ""


class ReferralPackageSend(BaseModel):
    channels: list[ReferralChannel] = Field(min_length=1, max_length=2)
    recipients: list[ReferralSendRecipient] = Field(default_factory=list, max_length=4)
    message: str = Field(default="", max_length=5000)
    idempotency_key: str = Field(default="", max_length=200)

    @field_validator("channels")
    @classmethod
    def unique_channels(cls, value: list[ReferralChannel]) -> list[ReferralChannel]:
        return list(dict.fromkeys(value))


class ReferralDeliveryOut(BaseModel):
    id: UUID
    channel: ReferralChannel
    recipient_type: Literal["patient", "doctor"]
    recipient: str
    status: str
    provider_message_id: str = ""
    error: str = ""
    created_at: datetime


class ReferralPackageOut(BaseModel):
    id: UUID
    patient_id: UUID
    created_by: UUID
    status: str
    recipient_type: ReferralRecipientType
    recipient_name: str = ""
    recipient_specialty: str = ""
    recipient_clinic: str = ""
    recipient_email: str = ""
    recipient_phone: str = ""
    reason: str
    clinical_question: str = ""
    urgency: ReferralUrgency
    referral_note: str = ""
    included_records: list[dict[str, Any]] = Field(default_factory=list)
    page_count: int = 0
    file_name: str
    file_size: int
    deliveries: list[ReferralDeliveryOut] = Field(default_factory=list)
    created_at: datetime


class ReferralPackageSendResponse(BaseModel):
    success: bool
    message: str
    deliveries: list[ReferralDeliveryOut]
