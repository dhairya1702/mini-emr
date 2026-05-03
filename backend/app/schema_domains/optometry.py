from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


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
