from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schema_domains.documents import GenerateNoteRequest


ClinicalQuestionType = Literal[
    "yes_no",
    "single_choice",
    "multi_choice",
    "short_text",
    "number",
    "duration",
    "module_request",
]
ClinicalQuestionPriority = Literal["high", "medium", "low"]
ClinicalAssistantSpecialty = Literal["optometry", "pediatrics", "general_physician", "dentistry"]
ClinicalAssistantModule = Literal[
    "eye_exam",
    "contact_lens",
    "binocular_vision",
    "low_vision",
    "myopia_management",
    "pediatric_growth_measurement",
    "well_child_visit",
    "parent_handout_request",
    "pediatric_follow_up_plan",
    "attachments",
    "medicines",
    "vitals",
]


class ClinicalAssistantQuestion(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    group: str = Field(default="Clarifying questions", max_length=120)
    label: str = Field(min_length=1, max_length=240)
    type: ClinicalQuestionType
    priority: ClinicalQuestionPriority = "medium"
    options: list[str] = Field(default_factory=list, max_length=8)
    rationale: str = Field(default="", max_length=400)


class ClinicalAssistantModuleSuggestion(BaseModel):
    module: ClinicalAssistantModule
    reason: str = Field(default="", max_length=300)


class ClinicalQuestionsRequest(BaseModel):
    patient_id: UUID
    consultation: GenerateNoteRequest = Field(default_factory=GenerateNoteRequest)


class ClinicalQuestionsResponse(BaseModel):
    assistant_specialty: ClinicalAssistantSpecialty = "general_physician"
    complaint_category: str = Field(default="general_eye_complaint", max_length=120)
    detected_factors: list[str] = Field(default_factory=list, max_length=12)
    questions: list[ClinicalAssistantQuestion] = Field(default_factory=list, max_length=12)
    module_suggestions: list[ClinicalAssistantModuleSuggestion] = Field(default_factory=list, max_length=6)
    safety_notice: str = "For clinician review only. Not a diagnosis."
    used_fallback: bool = False
    warning: str | None = None


class ClinicalAssistantAnswer(BaseModel):
    question_id: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=240)
    answer: str = Field(default="", max_length=500)


class ClinicalAnalysisRequest(BaseModel):
    patient_id: UUID
    consultation: GenerateNoteRequest = Field(default_factory=GenerateNoteRequest)
    answers: list[ClinicalAssistantAnswer] = Field(default_factory=list, max_length=20)


class ClinicalPossibility(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    likelihood: Literal["likely", "consider", "rule_out", "contextual"] = "consider"
    why: str = Field(default="", max_length=600)
    what_to_check: str = Field(default="", max_length=600)


class ClinicalRedFlag(BaseModel):
    label: str = Field(min_length=1, max_length=180)
    severity: Literal["routine", "caution", "urgent"] = "caution"
    present: bool | None = None


class ClinicalAnalysisResponse(BaseModel):
    assistant_specialty: ClinicalAssistantSpecialty = "general_physician"
    possibilities: list[ClinicalPossibility] = Field(default_factory=list, max_length=8)
    red_flags: list[ClinicalRedFlag] = Field(default_factory=list, max_length=10)
    suggested_tests: list[str] = Field(default_factory=list, max_length=10)
    documentation_gaps: list[str] = Field(default_factory=list, max_length=10)
    module_suggestions: list[ClinicalAssistantModule] = Field(default_factory=list, max_length=8)
    note_additions: str = Field(default="", max_length=2000)
    safety_notice: str = "For clinician review only. Not a diagnosis."
    used_fallback: bool = False
    warning: str | None = None
