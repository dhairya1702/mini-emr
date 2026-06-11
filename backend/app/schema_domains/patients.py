from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schema_domains.common import AppointmentStatus, FollowUpStatus, NoteStatus, PatientStatus, TimelineEventType


class PatientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    reason: str = Field(min_length=1, max_length=200)
    age: int = Field(ge=0, le=130)
    weight: float = Field(gt=0, le=500)
    temperature: float = Field(ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class PatientUpdate(BaseModel):
    status: PatientStatus | None = None
    billed: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    reason: str | None = Field(default=None, min_length=1, max_length=200)
    age: int | None = Field(default=None, ge=0, le=130)
    weight: float | None = Field(default=None, gt=0, le=500)
    temperature: float | None = Field(default=None, ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class PatientOut(BaseModel):
    id: UUID
    name: str
    phone: str
    email: str = ""
    address: str = ""
    reason: str
    age: int | None = None
    weight: float | None = None
    temperature: float | None = None
    height: float | None = None
    status: PatientStatus
    billed: bool = False
    created_at: datetime
    last_visit_at: datetime


class PatientVisitOut(BaseModel):
    id: UUID
    patient_id: UUID
    name: str
    phone: str
    email: str = ""
    address: str = ""
    reason: str
    age: int | None = None
    weight: float | None = None
    temperature: float | None = None
    height: float | None = None
    source: str = ""
    appointment_id: UUID | None = None
    created_at: datetime
    status: PatientStatus
    billed: bool = False
    last_visit_at: datetime


class PatientChartVisitOut(BaseModel):
    id: UUID
    patient_id: UUID
    reason: str = ""
    created_at: datetime


class PatientVisitNoteDetailOut(BaseModel):
    status: str
    content: str


class PatientVisitAttachmentRowOut(BaseModel):
    id: str
    label: str
    timestamp: datetime
    source_type: str
    content_type: str = ""
    attachment_id: UUID | None = None
    data_base64: str | None = None


class PatientVisitDetailOut(BaseModel):
    visit_id: UUID
    reason: str = ""
    timestamp: datetime
    consultation_note: PatientVisitNoteDetailOut | None = None
    attachments: list[PatientVisitAttachmentRowOut] = Field(default_factory=list)
    timeline: list["PatientTimelineEvent"] = Field(default_factory=list)


class AppointmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    reason: str = Field(min_length=1, max_length=200)
    age: int | None = Field(default=None, ge=0, le=130)
    weight: float | None = Field(default=None, gt=0, le=500)
    temperature: float | None = Field(default=None, ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)
    scheduled_for: datetime


class AppointmentOut(BaseModel):
    id: UUID
    org_id: UUID
    name: str
    phone: str
    email: str = ""
    address: str = ""
    reason: str
    age: int | None = None
    weight: float | None = None
    temperature: float | None = None
    height: float | None = None
    scheduled_for: datetime
    status: AppointmentStatus
    checked_in_patient_id: UUID | None = None
    checked_in_at: datetime | None = None
    created_at: datetime


class AppointmentUpdate(BaseModel):
    scheduled_for: datetime | None = None
    status: AppointmentStatus | None = None


class AppointmentCheckInRequest(BaseModel):
    existing_patient_id: UUID | None = None
    force_new: bool = False


class PatientMatchOut(BaseModel):
    id: UUID
    name: str
    phone: str
    email: str = ""
    address: str = ""
    reason: str
    age: int | None = None
    weight: float | None = None
    height: float | None = None
    temperature: float | None = None
    status: PatientStatus
    billed: bool = False
    created_at: datetime
    last_visit_at: datetime


class PatientVisitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    reason: str = Field(min_length=1, max_length=200)
    age: int = Field(ge=0, le=130)
    weight: float = Field(gt=0, le=500)
    temperature: float = Field(ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class NoteCreate(BaseModel):
    patient_id: UUID
    content: str = Field(min_length=1)
    asset_payload: list[dict[str, Any]] = Field(default_factory=list)
    structured_modules: list[dict[str, Any]] = Field(default_factory=list)


class NoteOut(BaseModel):
    id: UUID
    patient_id: UUID
    content: str
    status: NoteStatus = "draft"
    version_number: int = 1
    root_note_id: UUID | None = None
    amended_from_note_id: UUID | None = None
    snapshot_content: str | None = None
    asset_payload: list[dict[str, Any]] = Field(default_factory=list)
    snapshot_asset_payload: list[dict[str, Any]] = Field(default_factory=list)
    structured_modules: list[dict[str, Any]] = Field(default_factory=list)
    finalized_at: datetime | None = None
    sent_at: datetime | None = None
    sent_by: UUID | None = None
    sent_by_name: str | None = None
    sent_to: str | None = None
    created_at: datetime


class PatientTimelineEvent(BaseModel):
    id: str
    type: TimelineEventType
    title: str
    timestamp: datetime
    description: str
    entity_type: str | None = None
    entity_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class AuditEventOut(BaseModel):
    id: UUID
    org_id: UUID
    actor_user_id: UUID | None = None
    actor_name: str
    entity_type: str
    entity_id: str
    action: str
    summary: str
    metadata: dict = Field(default_factory=dict)
    created_at: datetime


class FollowUpCreate(BaseModel):
    scheduled_for: datetime
    notes: str = Field(default="", max_length=500)


class FollowUpUpdate(BaseModel):
    status: FollowUpStatus | None = None
    scheduled_for: datetime | None = None
    notes: str | None = Field(default=None, max_length=500)


class FollowUpOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    patient_name: str | None = None
    created_by: UUID | None = None
    scheduled_for: datetime
    notes: str
    status: FollowUpStatus
    completed_at: datetime | None = None
    reminder_sent_at: datetime | None = None
    created_at: datetime


class FollowUpBookingContextOut(BaseModel):
    follow_up_id: UUID
    patient_name: str
    clinic_name: str
    scheduled_for: datetime
    notes: str
    booking_token: str
    suggested_slots: list[datetime] = Field(default_factory=list)


class FollowUpBookingRequest(BaseModel):
    token: str = Field(min_length=20)
    scheduled_for: datetime
