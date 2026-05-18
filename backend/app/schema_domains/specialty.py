from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class StructuredModuleInput(BaseModel):
    module_type: str = Field(min_length=1, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)


class LongitudinalTrackRecordOut(BaseModel):
    id: str
    track_type: str
    patient_id: str
    org_id: str
    measured_at: datetime
    summary_fields: dict[str, Any] = Field(default_factory=dict)
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    derived_metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class LongitudinalTrackCreate(BaseModel):
    track_type: str = Field(min_length=1, max_length=120)
    measured_at: datetime
    summary_fields: dict[str, Any] = Field(default_factory=dict)
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    derived_metrics: dict[str, Any] = Field(default_factory=dict)


class PediatricGrowthMeasurementInput(BaseModel):
    measured_at: datetime
    height_cm: float = Field(gt=0, le=300)
    weight_kg: float = Field(gt=0, le=500)
    head_circumference_cm: float | None = Field(default=None, gt=0, le=100)
    visit_notes: str = Field(default="", max_length=1000)


class PediatricGrowthMeasurementOut(BaseModel):
    measured_at: datetime
    age_months: int | None = None
    height_cm: float
    weight_kg: float
    bmi: float
    head_circumference_cm: float | None = None
    visit_notes: str = ""
    track_id: str
    created_at: datetime


class PediatricGrowthDeltaOut(BaseModel):
    height_cm: float | None = None
    weight_kg: float | None = None
    bmi: float | None = None


class PediatricGrowthSummaryOut(BaseModel):
    patient_id: str
    latest_measurement: PediatricGrowthMeasurementOut | None = None
    previous_measurement: PediatricGrowthMeasurementOut | None = None
    interval_change: PediatricGrowthDeltaOut | None = None
    trend_summary: str = ""
    flags: list[str] = Field(default_factory=list)
    records: list[PediatricGrowthMeasurementOut] = Field(default_factory=list)


class WellChildVisitInput(BaseModel):
    visit_band: str = Field(min_length=1, max_length=50)
    nutrition_summary: str = Field(default="", max_length=1000)
    sleep_summary: str = Field(default="", max_length=1000)
    elimination_summary: str = Field(default="", max_length=1000)
    school_behavior_summary: str = Field(default="", max_length=1000)
    parent_concerns: str = Field(default="", max_length=1000)
    assessment_summary: str = Field(default="", max_length=1000)


class ParentHandoutRequestInput(BaseModel):
    template_key: str = Field(min_length=1, max_length=120)
    instructions: str = Field(default="", max_length=1000)


class PediatricFollowUpPlanInput(BaseModel):
    preset_key: str = Field(min_length=1, max_length=120)
    suggested_interval: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=500)
