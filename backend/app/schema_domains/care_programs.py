from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


MYOPIA_PROGRAM_KEY = "myopia_care"
MYOPIA_REVIEW_KEYS = ("baseline", "review_1", "review_2", "final_review")


class MyopiaReviewDefinition(BaseModel):
    key: Literal["baseline", "review_1", "review_2", "final_review"]
    label: str = Field(min_length=1, max_length=120)
    offset_days: int = Field(ge=0, le=730)


class MyopiaProgramDefinition(BaseModel):
    version: Literal[1] = 1
    program_type: Literal["myopia_monitoring"] = "myopia_monitoring"
    duration_days: int = Field(default=365, ge=90, le=730)
    reviews: list[MyopiaReviewDefinition] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_reviews(self) -> "MyopiaProgramDefinition":
        if tuple(review.key for review in self.reviews) != MYOPIA_REVIEW_KEYS:
            raise ValueError("Myopia Care must keep the standard four review stages in order.")
        offsets = [review.offset_days for review in self.reviews]
        if offsets[0] != 0 or offsets != sorted(set(offsets)):
            raise ValueError("Review timing must start at day zero and increase for every review.")
        if offsets[-1] > self.duration_days:
            raise ValueError("The final review must fall within the program duration.")
        return self


class MyopiaOfferingUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    default_price: float = Field(gt=0, le=100000)
    duration_days: int = Field(default=365, ge=90, le=730)
    reviews: list[MyopiaReviewDefinition] = Field(min_length=4, max_length=4)
    is_active: bool = True

    def definition(self) -> MyopiaProgramDefinition:
        return MyopiaProgramDefinition(
            duration_days=self.duration_days,
            reviews=self.reviews,
        )


class CareProgramOfferingOut(BaseModel):
    program_key: str
    enabled: bool
    catalog_item_id: UUID | None = None
    name: str
    description: str
    default_price: float | None = None
    is_active: bool
    definition: MyopiaProgramDefinition


ProgramEnrollmentStatus = Literal["pending", "active", "completed", "cancelled"]
ProgramEventStatus = Literal["scheduled", "completed", "cancelled"]


class CareProgramEventOut(BaseModel):
    id: UUID
    org_id: UUID
    enrollment_id: UUID
    event_type: str
    sequence: int | None = None
    status: ProgramEventStatus
    title: str
    due_at: datetime | None = None
    completed_at: datetime | None = None
    source_event_id: UUID | None = None
    linked_entity_type: str | None = None
    linked_entity_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ProgramEnrollmentSummaryOut(BaseModel):
    id: UUID
    org_id: UUID
    patient_id: UUID
    patient_name: str | None = None
    patient_phone: str = ""
    catalog_item_id: UUID
    program_name: str
    originating_invoice_id: UUID
    responsible_user_id: UUID | None = None
    responsible_user_name: str | None = None
    status: ProgramEnrollmentStatus
    agreed_price: float
    started_at: datetime | None = None
    ends_at: datetime | None = None
    next_action_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str = ""
    total_reviews: int = 0
    completed_reviews: int = 0
    next_review_title: str | None = None
    balance_due: float = 0
    created_at: datetime


class ProgramEnrollmentOut(ProgramEnrollmentSummaryOut):
    program_snapshot: dict[str, Any]
    events: list[CareProgramEventOut] = Field(default_factory=list)


class ProgramAssigneeUpdate(BaseModel):
    responsible_user_id: UUID


class ProgramCancellationRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class ProgramReviewCompleteRequest(BaseModel):
    myopia_measurement_id: UUID


class ProgramReportCreate(BaseModel):
    clinician_comment: str = Field(default="", max_length=2000)


class ProgramReportOut(BaseModel):
    id: UUID
    enrollment_id: UUID
    source_review_event_id: UUID
    version: int
    generated_at: datetime


class ProgramReportWhatsAppRequest(BaseModel):
    recipient_phone: str | None = Field(default=None, max_length=40)


def standard_myopia_definition() -> MyopiaProgramDefinition:
    return MyopiaProgramDefinition(
        duration_days=365,
        reviews=[
            MyopiaReviewDefinition(key="baseline", label="Baseline review", offset_days=0),
            MyopiaReviewDefinition(key="review_1", label="Three-month review", offset_days=90),
            MyopiaReviewDefinition(key="review_2", label="Six-month review", offset_days=180),
            MyopiaReviewDefinition(key="final_review", label="Annual review", offset_days=365),
        ],
    )
