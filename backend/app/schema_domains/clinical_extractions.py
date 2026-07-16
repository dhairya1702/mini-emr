from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictExtractionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PrescriptionInput(StrictExtractionModel):
    catalog_item_id: UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    strength: str = Field(default="", max_length=80)
    dose: str = Field(default="", max_length=80)
    route: str = Field(default="", max_length=80)
    schedule: str = Field(default="", max_length=120)
    duration: str = Field(default="", max_length=80)
    quantity: str = Field(default="", max_length=80)
    instructions: str = Field(default="", max_length=500)


class ServicePerformed(StrictExtractionModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: int = Field(default=1, ge=1, le=100)
    evidence: str = Field(default="", max_length=500)


class MedicationPrescribed(StrictExtractionModel):
    catalog_item_id: UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    strength: str = Field(default="", max_length=80)
    dose: str = Field(default="", max_length=80)
    route: str = Field(default="", max_length=80)
    schedule: str = Field(default="", max_length=120)
    duration: str = Field(default="", max_length=80)
    quantity: str = Field(default="", max_length=80)
    instructions: str = Field(default="", max_length=500)
    evidence: str = Field(default="", max_length=500)


class ExtractedMedicationCandidate(StrictExtractionModel):
    name: str = Field(min_length=1, max_length=120)
    strength: str = Field(default="", max_length=80)
    dose: str = Field(default="", max_length=80)
    route: str = Field(default="", max_length=80)
    schedule: str = Field(default="", max_length=120)
    duration: str = Field(default="", max_length=80)
    quantity: str = Field(default="", max_length=80)
    instructions: str = Field(default="", max_length=500)
    evidence: str = Field(default="", max_length=500)


class ClinicalExtractions(StrictExtractionModel):
    services_performed: list[ServicePerformed] = Field(default_factory=list, max_length=20)
    medications_prescribed: list[MedicationPrescribed] = Field(default_factory=list, max_length=30)


class NoteSections(StrictExtractionModel):
    presenting_complaint: str = Field(min_length=1, max_length=8000)
    diagnosis: str = Field(min_length=1, max_length=8000)
    clinical_notes: str = Field(min_length=1, max_length=12000)
    treatment: str = Field(min_length=1, max_length=12000)
    follow_up_advice: str = Field(min_length=1, max_length=8000)


class GeneratedConsultationPayload(StrictExtractionModel):
    note_sections: NoteSections
    services_performed: list[ServicePerformed] = Field(default_factory=list, max_length=20)
    medications_prescribed: list[ExtractedMedicationCandidate] = Field(default_factory=list, max_length=30)


BillingSuggestionStatus = Literal["auto_add", "possible_match", "unmatched", "unavailable"]
BillingSuggestionSource = Literal["default_consultation", "extracted_service", "prescribed_medicine"]


class CatalogSuggestionMatch(StrictExtractionModel):
    catalog_item_id: UUID
    label: str
    item_type: Literal["service", "medicine"]
    quantity: float = Field(gt=0, le=10000)
    unit_price: float = Field(ge=0, le=100000)
    match_type: Literal["exact", "alias", "fuzzy"]
    confidence: float = Field(ge=0, le=1)
    available: bool = True


class BillingSuggestion(StrictExtractionModel):
    source: BillingSuggestionSource
    extraction_name: str
    status: BillingSuggestionStatus
    catalog_match: CatalogSuggestionMatch | None = None


class BillingSuggestionsResponse(StrictExtractionModel):
    note_id: UUID
    visit_id: UUID | None = None
    suggestions: list[BillingSuggestion]
