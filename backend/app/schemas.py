from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


PatientStatus = Literal["waiting", "consultation", "done"]
UserRole = Literal["admin", "staff"]


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
    created_at: datetime


class NoteCreate(BaseModel):
    patient_id: UUID
    content: str = Field(min_length=1)


class NoteOut(BaseModel):
    id: UUID
    patient_id: UUID
    content: str
    created_at: datetime


class GenerateNoteRequest(BaseModel):
    patient_id: UUID | None = None
    symptoms: str = ""
    diagnosis: str = ""
    medications: str = ""
    notes: str = ""


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
