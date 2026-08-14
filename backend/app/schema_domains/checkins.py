from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.email_validation import normalize_single_email
from app.schema_domains.common import SexAtBirth


CheckInRequestStatus = Literal["pending", "approved", "rejected", "expired"]


class PublicCheckInContextOut(BaseModel):
    clinic_name: str
    clinic_address: str = ""
    clinic_phone: str = ""


class PublicCheckInCreate(BaseModel):
    token: UUID
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=30)
    email: str = Field(default="", max_length=200)
    date_of_birth: date
    sex_at_birth: SexAtBirth
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if not value.strip():
            return ""
        return normalize_single_email(value)


class PublicCheckInSubmittedOut(BaseModel):
    id: UUID
    status: CheckInRequestStatus
    clinic_name: str
    tracking_token: str


class PublicCheckInStatusOut(BaseModel):
    status: CheckInRequestStatus


class PublicAppointmentSlotsOut(BaseModel):
    clinic_name: str
    timezone: str
    suggested_slots: list[datetime] = Field(default_factory=list)


class PublicAppointmentCreate(PublicCheckInCreate):
    scheduled_for: datetime


class PublicAppointmentOut(BaseModel):
    appointment_id: UUID
    patient_name: str
    clinic_name: str
    timezone: str
    scheduled_for: datetime
    status: str
    booking_token: str
    suggested_slots: list[datetime] = Field(default_factory=list)


class PublicAppointmentManageRequest(BaseModel):
    booking_token: str = Field(min_length=20)
    scheduled_for: datetime | None = None


class CheckInConfigOut(BaseModel):
    enabled: bool
    public_url: str
    token: UUID


class CheckInConfigUpdate(BaseModel):
    enabled: bool


class CheckInCandidateOut(BaseModel):
    id: UUID
    name: str
    phone: str
    date_of_birth: date | None = None
    last_visit_at: datetime
    status: str
    match_reasons: list[str] = Field(default_factory=list)
    confidence: Literal["strong", "likely", "possible"]


class CheckInRequestOut(BaseModel):
    id: UUID
    submitted_name: str
    submitted_phone: str
    submitted_email: str = ""
    submitted_date_of_birth: date
    submitted_sex_at_birth: SexAtBirth | None = None
    submitted_reason: str
    status: CheckInRequestStatus
    approved_patient_id: UUID | None = None
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
    expires_at: datetime
    candidates: list[CheckInCandidateOut] = Field(default_factory=list)


class CheckInRequestsStatusOut(BaseModel):
    pending_count: int = Field(ge=0)
    revision: str


class CheckInApproveRequest(BaseModel):
    existing_patient_id: UUID | None = None
    force_new: bool = False
    assigned_doctor_id: UUID | None = None

    @model_validator(mode="after")
    def validate_choice(self) -> "CheckInApproveRequest":
        if bool(self.existing_patient_id) == bool(self.force_new):
            raise ValueError("Choose an existing patient or create a new patient.")
        return self


class CheckInRejectRequest(BaseModel):
    reason: str = Field(default="", max_length=200)
