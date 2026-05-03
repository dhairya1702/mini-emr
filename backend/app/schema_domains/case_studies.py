from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schema_domains.common import CaseStudyStatus, CaseStudyTemplateKey
from app.schema_domains.optometry import MyopiaHistoryOut
from app.schema_domains.patients import NoteOut, PatientOut, PatientTimelineEvent, PatientVisitOut


class PatientCaseStudySourceOut(BaseModel):
    patient: PatientOut
    visits: list[PatientVisitOut] = Field(default_factory=list)
    timeline: list[PatientTimelineEvent] = Field(default_factory=list)
    notes: list[NoteOut] = Field(default_factory=list)
    myopia_history: MyopiaHistoryOut | None = None


class GenerateCaseStudyRequest(BaseModel):
    patient_id: UUID
    title: str = Field(default="", max_length=200)
    template_key: CaseStudyTemplateKey = "conference_presentation"
    anonymized: bool = True
    author_instructions: str = Field(default="", max_length=4000)


class GenerateCaseStudyResponse(BaseModel):
    title: str
    content: str
    source: PatientCaseStudySourceOut


class CaseStudyCreate(BaseModel):
    patient_id: UUID
    title: str = Field(min_length=1, max_length=200)
    status: CaseStudyStatus = "draft"
    template_key: CaseStudyTemplateKey = "conference_presentation"
    anonymized: bool = True
    author_instructions: str = Field(default="", max_length=4000)
    generated_content: str = Field(min_length=1)
    source_snapshot: dict[str, Any] = Field(default_factory=dict)


class CaseStudyUpdate(BaseModel):
    patient_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: CaseStudyStatus | None = None
    template_key: CaseStudyTemplateKey | None = None
    anonymized: bool | None = None
    author_instructions: str | None = Field(default=None, max_length=4000)
    generated_content: str | None = Field(default=None, min_length=1)
    source_snapshot: dict[str, Any] | None = None


class CaseStudyOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    patient_name: str | None = None
    title: str
    status: CaseStudyStatus
    template_key: CaseStudyTemplateKey
    anonymized: bool
    author_instructions: str
    generated_content: str
    source_snapshot: dict[str, Any] = Field(default_factory=dict)
    created_by: UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
