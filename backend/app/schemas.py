from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


PatientStatus = Literal["waiting", "consultation", "done"]
UserRole = Literal["admin", "staff"]
CatalogItemType = Literal["service", "medicine"]
PaymentStatus = Literal["unpaid", "paid", "partial"]
FollowUpStatus = Literal["scheduled", "completed", "cancelled"]
AppointmentStatus = Literal["scheduled", "checked_in", "cancelled"]


class PatientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
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
    reason: str | None = Field(default=None, min_length=1, max_length=200)
    age: int | None = Field(default=None, ge=0, le=130)
    weight: float | None = Field(default=None, gt=0, le=500)
    temperature: float | None = Field(default=None, ge=90, le=110)
    height: float | None = Field(default=None, gt=0, le=300)


class PatientOut(BaseModel):
    id: UUID
    name: str
    phone: str
    reason: str
    age: int | None = None
    weight: float | None = None
    temperature: float | None = None
    height: float | None = None
    status: PatientStatus
    billed: bool = False
    created_at: datetime


class AppointmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=30)
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
    reason: str
    age: int | None = None
    weight: float | None = None
    height: float | None = None
    temperature: float | None = None
    status: PatientStatus
    billed: bool = False
    created_at: datetime


class NoteCreate(BaseModel):
    patient_id: UUID
    content: str = Field(min_length=1)


class NoteOut(BaseModel):
    id: UUID
    patient_id: UUID
    content: str
    created_at: datetime


TimelineEventType = Literal[
    "patient_created",
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
    content: str


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
    recipient: str = Field(min_length=5, max_length=120)
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


class InvoiceOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    subtotal: float
    total: float
    payment_status: PaymentStatus
    paid_at: datetime | None = None
    sent_at: datetime | None = None
    created_at: datetime
    items: list[InvoiceItemOut]


class SendInvoiceRequest(BaseModel):
    invoice_id: UUID
    recipient: str = Field(min_length=5, max_length=120)


class SendNoteRequest(BaseModel):
    patient_id: UUID
    phone: str = Field(min_length=5, max_length=30)
    content: str = Field(min_length=1)


class SendNoteResponse(BaseModel):
    success: bool
    message: str


class ClinicSettingsBase(BaseModel):
    clinic_name: str = "ClinicOS"
    clinic_address: str = ""
    clinic_phone: str = ""
    doctor_name: str = ""
    custom_header: str = ""
    custom_footer: str = ""


class ClinicSettingsUpdate(ClinicSettingsBase):
    pass


class ClinicSettingsOut(ClinicSettingsBase):
    id: UUID
    org_id: UUID
    updated_at: datetime | None = None


class UserBase(BaseModel):
    identifier: str = Field(min_length=5, max_length=120)


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)
    clinic_name: str = Field(min_length=1, max_length=120)
    clinic_address: str = Field(min_length=1, max_length=300)
    clinic_phone: str = Field(default="", max_length=40)
    doctor_name: str = Field(default="", max_length=120)


class StaffUserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserOut(UserBase):
    id: UUID
    org_id: UUID
    name: str
    role: UserRole
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserOut
