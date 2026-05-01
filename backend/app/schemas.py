from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from pydantic import field_validator, model_validator


PatientStatus = Literal["waiting", "consultation", "done"]
UserRole = Literal["admin", "staff"]
ClinicSpecialty = Literal["optometry", "general_physician"]
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
    asset_payload: list[dict[str, Any]] = Field(default_factory=list)


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
    "myopia_measurement",
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


class NoteAssetInput(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["attachment", "drawing"]
    name: str = Field(min_length=1, max_length=160)
    content_type: str = Field(min_length=3, max_length=120)
    data_base64: str = Field(min_length=8)


class TestScoreEntry(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=120)


class EyeExamEntry(BaseModel):
    eye: Literal["right", "left"]
    sphere: str = Field(default="", max_length=40)
    cylinder: str = Field(default="", max_length=40)
    axis: str = Field(default="", max_length=40)
    vision: str = Field(default="", max_length=40)


class ContactLensEyeInput(BaseModel):
    eye: Literal["right", "left"]
    sphere: str = Field(default="", max_length=40)
    cylinder: str = Field(default="", max_length=40)
    axis: str = Field(default="", max_length=40)
    base_curve: str = Field(default="", max_length=40)
    diameter: str = Field(default="", max_length=40)
    add_power: str = Field(default="", max_length=40)
    visual_acuity: str = Field(default="", max_length=40)
    over_refraction: str = Field(default="", max_length=80)
    fit_notes: str = Field(default="", max_length=200)


class ContactLensInput(BaseModel):
    wearing_goal: str = Field(default="", max_length=200)
    current_lens_brand: str = Field(default="", max_length=120)
    current_wear_schedule: str = Field(default="", max_length=120)
    replacement_frequency: str = Field(default="", max_length=120)
    comfort_issues: str = Field(default="", max_length=300)
    dryness_symptoms: str = Field(default="", max_length=300)
    handling_issues: str = Field(default="", max_length=300)
    care_solution: str = Field(default="", max_length=120)
    allergy_history: str = Field(default="", max_length=200)
    assessment_notes: str = Field(default="", max_length=500)
    lens_type: str = Field(default="", max_length=80)
    manufacturer: str = Field(default="", max_length=120)
    brand: str = Field(default="", max_length=120)
    wear_modality: str = Field(default="", max_length=120)
    trial_lens_used: str = Field(default="", max_length=160)
    vendor_name: str = Field(default="", max_length=160)
    quantity: str = Field(default="", max_length=80)
    special_instructions: str = Field(default="", max_length=500)
    eyes: list[ContactLensEyeInput] = Field(default_factory=list)


class BinocularVisionInput(BaseModel):
    symptom_notes: str = Field(default="", max_length=500)
    asthenopia: bool = False
    headache: bool = False
    diplopia: bool = False
    blur_near: bool = False
    blur_distance: bool = False
    reading_difficulty: bool = False
    poor_concentration: bool = False
    distance_cover_test: str = Field(default="", max_length=120)
    near_cover_test: str = Field(default="", max_length=120)
    distance_deviation_pd: str = Field(default="", max_length=40)
    near_deviation_pd: str = Field(default="", max_length=40)
    binocular_visual_acuity_distance: str = Field(default="", max_length=40)
    binocular_visual_acuity_near: str = Field(default="", max_length=40)
    motility: str = Field(default="", max_length=160)
    pursuits: str = Field(default="", max_length=160)
    saccades: str = Field(default="", max_length=160)
    npc_break_cm: str = Field(default="", max_length=40)
    npc_recovery_cm: str = Field(default="", max_length=40)
    convergence_notes: str = Field(default="", max_length=300)
    bo_distance: str = Field(default="", max_length=80)
    bo_near: str = Field(default="", max_length=80)
    bi_distance: str = Field(default="", max_length=80)
    bi_near: str = Field(default="", max_length=80)
    vergence_notes: str = Field(default="", max_length=300)
    stereo_test_name: str = Field(default="", max_length=120)
    stereo_result_arcsec: str = Field(default="", max_length=40)
    worth_four_dot_distance: str = Field(default="", max_length=120)
    worth_four_dot_near: str = Field(default="", max_length=120)
    sensory_notes: str = Field(default="", max_length=300)
    amplitude_right: str = Field(default="", max_length=40)
    amplitude_left: str = Field(default="", max_length=40)
    facility_cpm: str = Field(default="", max_length=40)
    facility_lens: str = Field(default="", max_length=40)
    accommodation_notes: str = Field(default="", max_length=300)
    working_diagnosis: str = Field(default="", max_length=200)
    management_plan: str = Field(default="", max_length=500)
    follow_up_interval: str = Field(default="", max_length=120)


class LowVisionInput(BaseModel):
    primary_complaint: str = Field(default="", max_length=300)
    goals: str = Field(default="", max_length=500)
    reading_difficulty: bool = False
    distance_difficulty: bool = False
    mobility_difficulty: bool = False
    face_recognition_difficulty: bool = False
    glare_complaints: bool = False
    lighting_difficulty: bool = False
    distance_visual_acuity: str = Field(default="", max_length=40)
    near_visual_acuity: str = Field(default="", max_length=40)
    habitual_correction: str = Field(default="", max_length=120)
    best_correction: str = Field(default="", max_length=120)
    contrast_sensitivity: str = Field(default="", max_length=120)
    glare_function: str = Field(default="", max_length=120)
    central_vision: str = Field(default="", max_length=200)
    visual_field: str = Field(default="", max_length=200)
    functional_reading: str = Field(default="", max_length=200)
    sustained_near_task: str = Field(default="", max_length=200)
    tv_phone_mobility_notes: str = Field(default="", max_length=400)
    illumination_response: str = Field(default="", max_length=200)
    posture_working_distance: str = Field(default="", max_length=200)
    magnifier_type: str = Field(default="", max_length=120)
    magnification: str = Field(default="", max_length=80)
    near_add: str = Field(default="", max_length=80)
    electronic_aid: str = Field(default="", max_length=160)
    tint_filter: str = Field(default="", max_length=120)
    task_performance_with_device: str = Field(default="", max_length=400)
    device_recommended: str = Field(default="", max_length=200)
    lighting_advice: str = Field(default="", max_length=300)
    non_optical_aids: str = Field(default="", max_length=300)
    rehab_referral: str = Field(default="", max_length=200)
    support_referral: str = Field(default="", max_length=200)
    training_required: str = Field(default="", max_length=200)
    follow_up_plan: str = Field(default="", max_length=200)
    cause_of_low_vision: str = Field(default="", max_length=200)
    prognosis: str = Field(default="", max_length=200)
    emotional_support_notes: str = Field(default="", max_length=400)
    charles_bonnet_screening: str = Field(default="", max_length=200)
    final_plan: str = Field(default="", max_length=500)


class MyopiaMeasurementInput(BaseModel):
    measured_at: datetime
    age_years: float = Field(ge=0, le=130)
    axial_length_right_mm: float = Field(ge=0, le=60)
    axial_length_left_mm: float = Field(ge=0, le=60)
    treatment_type: str = Field(default="", max_length=160)
    treatment_notes: str = Field(default="", max_length=500)
    visit_notes: str = Field(default="", max_length=500)
    refraction_right: str = Field(default="", max_length=120)
    refraction_left: str = Field(default="", max_length=120)


class MyopiaMeasurementCreate(MyopiaMeasurementInput):
    pass


class MyopiaMeasurementUpdate(BaseModel):
    measured_at: datetime | None = None
    age_years: float | None = Field(default=None, ge=0, le=130)
    axial_length_right_mm: float | None = Field(default=None, ge=0, le=60)
    axial_length_left_mm: float | None = Field(default=None, ge=0, le=60)
    treatment_type: str | None = Field(default=None, max_length=160)
    treatment_notes: str | None = Field(default=None, max_length=500)
    visit_notes: str | None = Field(default=None, max_length=500)
    refraction_right: str | None = Field(default=None, max_length=120)
    refraction_left: str | None = Field(default=None, max_length=120)


class MyopiaMeasurementOut(MyopiaMeasurementInput):
    id: UUID
    org_id: UUID
    patient_id: UUID
    created_at: datetime


class MyopiaDeltaOut(BaseModel):
    right_mm: float
    left_mm: float


class MyopiaHistoryOut(BaseModel):
    patient_id: UUID
    records: list[MyopiaMeasurementOut] = Field(default_factory=list)
    baseline_delta: MyopiaDeltaOut | None = None
    last_delta: MyopiaDeltaOut | None = None
    annualized_growth: MyopiaDeltaOut | None = None
    overlay_version: str


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
    contact_lens: ContactLensInput | None = None
    binocular_vision: BinocularVisionInput | None = None
    low_vision: LowVisionInput | None = None
    myopia_measurement: MyopiaMeasurementInput | None = None
    assets: list[NoteAssetInput] = Field(default_factory=list)


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
    assets: list[NoteAssetInput] = Field(default_factory=list)


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
    patient_name: str | None = None
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


class SuperuserOrgSummaryOut(BaseModel):
    org_id: UUID
    clinic_name: str
    created_at: datetime
    user_count: int = 0
    patient_count: int = 0
    note_count: int = 0
    invoice_count: int = 0
    follow_up_count: int = 0
    total_tokens: int = 0
    last_activity_at: datetime | None = None


class SuperuserOrgUserOut(BaseModel):
    id: UUID
    org_id: UUID
    identifier: str
    name: str
    role: UserRole
    created_at: datetime


class PlatformErrorOut(BaseModel):
    id: UUID
    org_id: UUID | None = None
    user_id: UUID | None = None
    identifier: str = ""
    path: str
    method: str
    status_code: int | None = None
    error_type: str
    message: str
    details: str = ""
    context: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class SuperuserUsageSummaryOut(BaseModel):
    total_tokens: int = 0
    total_requests: int = 0
    by_feature: dict[str, int] = Field(default_factory=dict)


class SuperuserOrgDetailOut(BaseModel):
    summary: SuperuserOrgSummaryOut
    users: list[SuperuserOrgUserOut] = Field(default_factory=list)
    recent_errors: list[PlatformErrorOut] = Field(default_factory=list)
    usage: SuperuserUsageSummaryOut
    recent_audit_events: list[AuditEventOut] = Field(default_factory=list)


class ExportRow(BaseModel):
    row: dict[str, Any]


DEFAULT_DOCUMENT_TEMPLATE_MARGIN = 54.0


class ClinicSettingsUpdate(BaseModel):
    clinic_name: str | None = Field(default=None, min_length=1, max_length=120)
    clinic_address: str | None = Field(default=None, max_length=300)
    clinic_phone: str | None = Field(default=None, max_length=40)
    clinic_specialty: ClinicSpecialty | None = None
    appointment_start_time: str | None = Field(default=None, min_length=5, max_length=5)
    appointment_end_time: str | None = Field(default=None, min_length=5, max_length=5)
    appointments_per_hour: int | None = Field(default=None, ge=1, le=12)
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

    @field_validator("appointment_start_time", "appointment_end_time")
    @classmethod
    def validate_appointment_time(cls, value: str | None) -> str | None:
        if value is None:
            return value
        datetime.strptime(value, "%H:%M")
        return value

    @field_validator("appointments_per_hour")
    @classmethod
    def validate_appointments_per_hour(cls, value: int | None) -> int | None:
        if value is None:
            return value
        if 60 % value != 0:
            raise ValueError("Appointments per hour must divide evenly into 60 minutes.")
        return value

    @model_validator(mode="after")
    def validate_booking_window(self) -> "ClinicSettingsUpdate":
        if self.appointment_start_time and self.appointment_end_time:
            start = datetime.strptime(self.appointment_start_time, "%H:%M")
            end = datetime.strptime(self.appointment_end_time, "%H:%M")
            if start >= end:
                raise ValueError("Appointment closing time must be after opening time.")
        return self


class ClinicSettingsOut(BaseModel):
    clinic_name: str = "ClinicOS"
    clinic_address: str = ""
    clinic_phone: str = ""
    clinic_specialty: ClinicSpecialty | None = None
    appointment_start_time: str = "09:00"
    appointment_end_time: str = "18:00"
    appointments_per_hour: int = 4
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
