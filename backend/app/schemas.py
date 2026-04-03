from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


PatientStatus = Literal["waiting", "consultation", "done"]


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


class GeneratePdfRequest(BaseModel):
    patient_id: UUID
    content: str = Field(min_length=1)


class SendNoteRequest(BaseModel):
    patient_id: UUID
    phone: str = Field(min_length=5, max_length=30)
    content: str = Field(min_length=1)


class SendNoteResponse(BaseModel):
    success: bool
    message: str
