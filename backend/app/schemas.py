from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


PatientStatus = Literal["waiting", "consultation", "done"]
UserRole = Literal["admin", "staff"]
CatalogItemType = Literal["service", "medicine"]
PaymentStatus = Literal["unpaid", "paid", "partial"]
FollowUpStatus = Literal["scheduled", "completed", "cancelled"]
AppointmentStatus = Literal["scheduled", "checked_in", "cancelled"]
NoteStatus = Literal["draft", "final", "sent"]


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


class NoteOut(BaseModel):
    id: UUID
    patient_id: UUID
    content: str
    status: NoteStatus = "draft"
    version_number: int = 1
    root_note_id: UUID | None = None
    amended_from_note_id: UUID | None = None
    snapshot_content: str | None = None
    finalized_at: datetime | None = None
    sent_at: datetime | None = None
    sent_by: UUID | None = None
    sent_by_name: str | None = None
    sent_to: str | None = None
    created_at: datetime


TimelineEventType = Literal[
    "patient_created",
    "visit_recorded",
    "appointment_booked",
    "appointment_checked_in",
    "consultation_note",
    "invoice_created",
    "bill_sent",
    "follow_up_scheduled",
    "follow_up_completed",
]


class PatientTimelineEvent(BaseModel):
    id: str
    type: TimelineEventType
    title: str
    timestamp: datetime
    description: str
    entity_type: str | None = None
    entity_id: str | None = None


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
    created_at: datetime


class TestScoreEntry(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=120)


class EyeExamEntry(BaseModel):
    eye: Literal["right", "left"]
    sphere: str = Field(default="", max_length=40)
    cylinder: str = Field(default="", max_length=40)
    axis: str = Field(default="", max_length=40)
    vision: str = Field(default="", max_length=40)


class GenerateNoteRequest(BaseModel):
    note_id: UUID | None = None
    patient_id: UUID | None = None
    symptoms: str = ""
    diagnosis: str = ""
    medications: str = ""
    notes: str = ""
    blood_pressure_systolic: int | None = Field(default=None, ge=40, le=300)
    blood_pressure_diastolic: int | None = Field(default=None, ge=20, le=200)
    pulse: int | None = Field(default=None, ge=20, le=250)
    spo2: int | None = Field(default=None, ge=40, le=100)
    blood_sugar: float | None = Field(default=None, ge=20, le=1000)
    test_scores: list[TestScoreEntry] = Field(default_factory=list)
    eye_exam: list[EyeExamEntry] = Field(default_factory=list)


class GenerateNoteResponse(BaseModel):
    note_id: UUID | None = None
    status: NoteStatus | None = None
    content: str


class FinalizeNoteRequest(BaseModel):
    note_id: UUID


class GenerateLetterRequest(BaseModel):
    to: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


class GenerateLetterResponse(BaseModel):
    content: str


class GeneratePdfRequest(BaseModel):
    patient_id: UUID
    content: str = Field(min_length=1)


class GenerateLetterPdfRequest(BaseModel):
    content: str = Field(min_length=1)


class SendLetterRequest(BaseModel):
    recipient_email: str = Field(min_length=5, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


class CatalogItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    item_type: CatalogItemType
    default_price: float = Field(ge=0, le=100000)
    track_inventory: bool = False
    stock_quantity: float = Field(default=0, ge=0, le=1000000)
    low_stock_threshold: float = Field(default=0, ge=0, le=1000000)
    unit: str = Field(default="", max_length=40)


class CatalogItemCreate(CatalogItemBase):
    pass


class CatalogItemOut(CatalogItemBase):
    id: UUID
    org_id: UUID
    created_at: datetime


class CatalogStockUpdate(BaseModel):
    delta: float = Field(ge=-1000000, le=1000000)


class InvoiceItemInput(BaseModel):
    catalog_item_id: UUID | None = None
    item_type: CatalogItemType
    label: str = Field(min_length=1, max_length=120)
    quantity: float = Field(gt=0, le=10000)
    unit_price: float = Field(ge=0, le=100000)


class InvoiceItemOut(InvoiceItemInput):
    id: UUID
    line_total: float


class InvoiceCreate(BaseModel):
    patient_id: UUID
    items: list[InvoiceItemInput] = Field(min_length=1)
    payment_status: PaymentStatus = "paid"
    amount_paid: float | None = Field(default=None, ge=0, le=100000000)


class InvoiceOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    subtotal: float
    total: float
    payment_status: PaymentStatus
    amount_paid: float = 0
    balance_due: float = 0
    paid_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by: UUID | None = None
    completed_by_name: str | None = None
    sent_at: datetime | None = None
    created_at: datetime
    items: list[InvoiceItemOut]


class SendInvoiceRequest(BaseModel):
    invoice_id: UUID
    recipient_email: str = Field(min_length=5, max_length=200)


class SendNoteRequest(BaseModel):
    note_id: UUID
    patient_id: UUID
    recipient_email: str = Field(min_length=5, max_length=200)


class SendNoteResponse(BaseModel):
    success: bool
    message: str


class ExportRow(BaseModel):
    row: dict[str, Any]


DEFAULT_DOCUMENT_TEMPLATE_MARGIN = 54.0


class ClinicSettingsUpdate(BaseModel):
    clinic_name: str | None = Field(default=None, min_length=1, max_length=120)
    clinic_address: str | None = Field(default=None, max_length=300)
    clinic_phone: str | None = Field(default=None, max_length=40)
    doctor_name: str | None = Field(default=None, max_length=120)
    sender_name: str | None = Field(default=None, max_length=120)
    sender_email: str | None = Field(default=None, max_length=200)
    sender_email_app_password: str | None = Field(default=None, max_length=128)
    email_configured: bool | None = None
    custom_header: str | None = Field(default=None, max_length=500)
    custom_footer: str | None = Field(default=None, max_length=500)
    document_template_name: str | None = Field(default=None, max_length=255)
    document_template_url: str | None = None
    document_template_notes_enabled: bool | None = None
    document_template_letters_enabled: bool | None = None
    document_template_invoices_enabled: bool | None = None
    document_template_margin_top: float | None = Field(default=None, ge=0, le=288)
    document_template_margin_right: float | None = Field(default=None, ge=0, le=288)
    document_template_margin_bottom: float | None = Field(default=None, ge=0, le=288)
    document_template_margin_left: float | None = Field(default=None, ge=0, le=288)


class ClinicSettingsOut(BaseModel):
    clinic_name: str = "ClinicOS"
    clinic_address: str = ""
    clinic_phone: str = ""
    doctor_name: str = ""
    sender_name: str = ""
    sender_email: str = ""
    email_configured: bool = False
    custom_header: str = ""
    custom_footer: str = ""
    document_template_name: str | None = None
    document_template_url: str | None = None
    document_template_notes_enabled: bool = False
    document_template_letters_enabled: bool = False
    document_template_invoices_enabled: bool = False
    document_template_margin_top: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    document_template_margin_right: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    document_template_margin_bottom: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    document_template_margin_left: float = DEFAULT_DOCUMENT_TEMPLATE_MARGIN
    id: UUID
    org_id: UUID
    updated_at: datetime | None = None


class UserBase(BaseModel):
    identifier: str = Field(min_length=5, max_length=120)


class UserCreate(UserBase):
    password: str = Field(min_length=6, max_length=128)
    admin_name: str = Field(min_length=1, max_length=120)
    clinic_name: str = Field(min_length=1, max_length=120)
    clinic_address: str = Field(min_length=1, max_length=300)
    clinic_phone: str = Field(default="", max_length=40)
    doctor_name: str = Field(default="", max_length=120)


class StaffUserCreate(UserBase):
    password: str = Field(min_length=6, max_length=128)


class UserRoleUpdate(BaseModel):
    role: UserRole


class LoginRequest(UserBase):
    password: str = Field(min_length=6, max_length=128)


class UserAccountUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    doctor_dob: date | None = None
    doctor_address: str = Field(default="", max_length=300)


class UserPasswordUpdate(BaseModel):
    current_password: str = Field(min_length=6, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class UserOut(UserBase):
    id: UUID
    org_id: UUID
    name: str
    role: UserRole
    doctor_dob: date | None = None
    doctor_address: str = ""
    doctor_signature_name: str | None = None
    doctor_signature_url: str | None = None
    doctor_signature_content_type: str | None = None
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserOut
