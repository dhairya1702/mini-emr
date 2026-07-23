from uuid import UUID

from pydantic import BaseModel, Field

from app.schema_domains.common import NoteStatus
from app.schema_domains.clinical_extractions import ClinicalExtractions, PrescriptionInput
from app.schema_domains.optometry import (
    BinocularVisionInput,
    ContactLensInput,
    EyeExamEntry,
    LowVisionInput,
    MyopiaMeasurementInput,
    NoteAssetInput,
    TestScoreEntry,
)
from app.schema_domains.specialty import StructuredModuleInput, WellChildVisitInput


class GenerateNoteRequest(BaseModel):
    note_id: UUID | None = None
    patient_id: UUID | None = None
    symptoms: str = Field(default="", max_length=8000)
    diagnosis: str = Field(default="", max_length=8000)
    medications: str = Field(default="", max_length=12000)
    notes: str = Field(default="", max_length=12000)
    blood_pressure_systolic: int | None = Field(default=None, ge=40, le=300)
    blood_pressure_diastolic: int | None = Field(default=None, ge=20, le=200)
    pulse: int | None = Field(default=None, ge=20, le=250)
    spo2: int | None = Field(default=None, ge=40, le=100)
    blood_sugar: float | None = Field(default=None, ge=20, le=1000)
    test_scores: list[TestScoreEntry] = Field(default_factory=list, max_length=30)
    eye_exam: list[EyeExamEntry] = Field(default_factory=list, max_length=2)
    contact_lens: ContactLensInput | None = None
    binocular_vision: BinocularVisionInput | None = None
    low_vision: LowVisionInput | None = None
    myopia_measurement: MyopiaMeasurementInput | None = None
    structured_modules: list[StructuredModuleInput] = Field(default_factory=list, max_length=20)
    assets: list[NoteAssetInput] = Field(default_factory=list, max_length=12)
    prescriptions: list[PrescriptionInput] = Field(default_factory=list, max_length=30)


class GenerateNoteResponse(BaseModel):
    note_id: UUID | None = None
    status: NoteStatus | None = None
    content: str
    used_fallback: bool = False
    warning: str | None = None
    extractions: ClinicalExtractions = Field(default_factory=ClinicalExtractions)


class FinalizeNoteRequest(BaseModel):
    note_id: UUID


class UpdateNoteDraftRequest(BaseModel):
    content: str = Field(min_length=1, max_length=50000)
    extractions: ClinicalExtractions | None = None


class GenerateLetterRequest(BaseModel):
    to: str = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20000)


class GenerateLetterResponse(BaseModel):
    content: str


class GenerateParentHandoutRequest(BaseModel):
    patient_id: UUID
    template_key: str = Field(min_length=1, max_length=120)
    instructions: str = Field(default="", max_length=1000)
    well_child_visit: WellChildVisitInput | None = None


class GenerateParentHandoutResponse(BaseModel):
    title: str
    content: str


class GeneratePdfRequest(BaseModel):
    patient_id: UUID
    content: str = Field(min_length=1, max_length=50000)
    assets: list[NoteAssetInput] = Field(default_factory=list, max_length=12)


class GenerateLetterPdfRequest(BaseModel):
    content: str = Field(min_length=1, max_length=50000)


class SendLetterRequest(BaseModel):
    recipient_email: str = Field(min_length=5, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)


class SendLetterWhatsAppRequest(BaseModel):
    recipient_phone: str = Field(min_length=5, max_length=40)
    recipient_name: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)


class SendNoteRequest(BaseModel):
    note_id: UUID
    patient_id: UUID
    recipient_email: str = Field(min_length=5, max_length=200)


class SendNoteWhatsAppRequest(BaseModel):
    note_id: UUID
    patient_id: UUID
    recipient_phone: str = Field(min_length=5, max_length=40)


class SendNoteResponse(BaseModel):
    success: bool
    message: str
