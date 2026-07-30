from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schema_domains.common import AppointmentStatus, FollowUpStatus, NoteStatus, PatientStatus, QueuePriority, SexAtBirth, TimelineEventType, VisitKind


def calculate_age_from_dob(date_of_birth: date | None) -> int | None:
    if not date_of_birth:
        return None
    today = datetime.now(UTC).date()
    age = today.year - date_of_birth.year - ((today.month, today.day) < (date_of_birth.month, date_of_birth.day))
    return max(age, 0)


class PatientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    reason: str = Field(min_length=1, max_length=200)
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = Field(default="", max_length=80)
    age: int | None = Field(default=None, ge=0, le=130)
    weight: float | None = Field(default=None, gt=0, le=500)
    temperature: float | None = Field(default=None, ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class PatientUpdate(BaseModel):
    status: PatientStatus | None = None
    billed: bool | None = None
    queue_priority: QueuePriority | None = None
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=300)
    reason: str | None = Field(default=None, min_length=1, max_length=200)
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str | None = Field(default=None, max_length=80)
    age: int | None = Field(default=None, ge=0, le=130)
    weight: float | None = Field(default=None, gt=0, le=500)
    temperature: float | None = Field(default=None, ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class PatientSummaryOut(BaseModel):
    summary: str = ""
    updated_at: datetime | None = None
    stale: bool = False
    used_fallback: bool = False


class PatientOut(BaseModel):
    id: UUID
    name: str
    phone: str
    email: str = ""
    address: str = ""
    reason: str
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = ""
    age: int | None = None
    weight: float | None = None
    temperature: float | None = None
    height: float | None = None
    status: PatientStatus
    billed: bool = False
    queue_priority: QueuePriority = "normal"
    stage_entered_at: datetime
    queue_position: int = 0
    profile_photo_url: str | None = None
    profile_photo_content_type: str | None = None
    profile_photo_updated_at: datetime | None = None
    created_at: datetime
    last_visit_at: datetime
    current_visit: "CurrentVisitSummaryOut | None" = None
    billing_summary: "QueueBillingSummaryOut | None" = None
    billing_estimate: "QueueBillingEstimateOut | None" = None


class CurrentVisitSummaryOut(BaseModel):
    id: UUID
    kind: VisitKind = "new"
    source: str = "queue"
    scheduled_for: datetime | None = None


class QueueBillingSummaryOut(BaseModel):
    invoice_id: UUID
    total: float = 0
    payment_status: str = "unpaid"
    balance_due: float = 0
    item_count: int = 0
    medicine_count: int = 0
    completed_at: datetime | None = None
    sent_at: datetime | None = None


class QueueBillingEstimateOut(BaseModel):
    total: float = 0
    item_count: int = 0
    medicine_count: int = 0


class QueueOrderColumns(BaseModel):
    waiting: list[UUID] = Field(default_factory=list, max_length=500)
    consultation: list[UUID] = Field(default_factory=list, max_length=500)
    done: list[UUID] = Field(default_factory=list, max_length=500)


class QueueOrderUpdate(BaseModel):
    columns: QueueOrderColumns


class PatientVisitOut(BaseModel):
    id: UUID
    patient_id: UUID
    name: str
    phone: str
    email: str = ""
    address: str = ""
    reason: str
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = ""
    age: int | None = None
    weight: float | None = None
    temperature: float | None = None
    height: float | None = None
    source: str = ""
    appointment_id: UUID | None = None
    visit_kind: VisitKind = "new"
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
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = Field(default="", max_length=80)
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
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = ""
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
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = ""
    age: int | None = None
    weight: float | None = None
    height: float | None = None
    temperature: float | None = None
    status: PatientStatus
    billed: bool = False
    profile_photo_url: str | None = None
    profile_photo_content_type: str | None = None
    profile_photo_updated_at: datetime | None = None
    created_at: datetime
    last_visit_at: datetime


class PatientVisitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
    email: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=300)
    reason: str = Field(min_length=1, max_length=200)
    date_of_birth: date | None = None
    sex_at_birth: SexAtBirth | None = None
    gender_identity: str = Field(default="", max_length=80)
    age: int | None = Field(default=None, ge=0, le=130)
    weight: float | None = Field(default=None, gt=0, le=500)
    temperature: float | None = Field(default=None, ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class NoteCreate(BaseModel):
    patient_id: UUID
    visit_id: UUID | None = None
    content: str = Field(min_length=1)
    asset_payload: list[dict[str, Any]] = Field(default_factory=list)
    structured_modules: list[dict[str, Any]] = Field(default_factory=list)
    clinical_extractions: dict[str, Any] = Field(default_factory=dict)
    optometry_history: dict[str, Any] = Field(default_factory=dict)


class NoteOut(BaseModel):
    id: UUID
    patient_id: UUID
    visit_id: UUID | None = None
    content: str
    status: NoteStatus = "draft"
    version_number: int = 1
    root_note_id: UUID | None = None
    amended_from_note_id: UUID | None = None
    snapshot_content: str | None = None
    asset_payload: list[dict[str, Any]] = Field(default_factory=list)
    snapshot_asset_payload: list[dict[str, Any]] = Field(default_factory=list)
    structured_modules: list[dict[str, Any]] = Field(default_factory=list)
    clinical_extractions: dict[str, Any] = Field(default_factory=dict)
    snapshot_clinical_extractions: dict[str, Any] | None = None
    optometry_history: dict[str, Any] = Field(default_factory=dict)
    snapshot_optometry_history: dict[str, Any] | None = None
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
    timezone: str
    scheduled_for: datetime
    notes: str
    booking_token: str
    appointment_id: UUID | None = None
    appointment_status: str | None = None
    appointment_scheduled_for: datetime | None = None
    suggested_slots: list[datetime] = Field(default_factory=list)


class FollowUpBookingRequest(BaseModel):
    token: str = Field(min_length=20)
    scheduled_for: datetime


class FollowUpBookingCancelRequest(BaseModel):
    token: str = Field(min_length=20)
