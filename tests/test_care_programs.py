from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

import test_app  # noqa: F401 - establishes the backend import path for tests
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import CatalogItemCreate
from app.schema_domains.care_programs import (
    MYOPIA_REVIEW_KEYS,
    MyopiaProgramDefinition,
    MyopiaReviewDefinition,
    standard_myopia_definition,
)
from app.services.care_program_workflow import _report_text
from app.services.catalog_workflow import create_catalog_item_workflow


def test_standard_myopia_program_has_four_stable_review_stages() -> None:
    definition = standard_myopia_definition()

    assert definition.duration_days == 365
    assert tuple(review.key for review in definition.reviews) == MYOPIA_REVIEW_KEYS
    assert [review.offset_days for review in definition.reviews] == [0, 90, 180, 365]


def test_myopia_program_rejects_reordered_or_duplicate_review_timing() -> None:
    with pytest.raises(ValidationError, match="four review stages"):
        MyopiaProgramDefinition(
            duration_days=365,
            reviews=[
                MyopiaReviewDefinition(key="review_1", label="Review", offset_days=0),
                MyopiaReviewDefinition(key="baseline", label="Baseline", offset_days=90),
                MyopiaReviewDefinition(key="review_2", label="Review", offset_days=180),
                MyopiaReviewDefinition(key="final_review", label="Final", offset_days=365),
            ],
        )

    with pytest.raises(ValidationError, match="increase for every review"):
        MyopiaProgramDefinition(
            duration_days=365,
            reviews=[
                MyopiaReviewDefinition(key="baseline", label="Baseline", offset_days=0),
                MyopiaReviewDefinition(key="review_1", label="Review", offset_days=90),
                MyopiaReviewDefinition(key="review_2", label="Review", offset_days=90),
                MyopiaReviewDefinition(key="final_review", label="Final", offset_days=365),
            ],
        )


def test_generic_catalog_workflow_rejects_program_creation() -> None:
    class RepoThatMustNotBeCalled:
        async def create_catalog_item(self, *_args, **_kwargs):
            raise AssertionError("generic repository creation should not run")

    user = UserOut(
        id="00000000-0000-0000-0000-000000000001",
        org_id="00000000-0000-0000-0000-000000000002",
        identifier="doctor@example.com",
        name="Doctor",
        role="admin",
        created_at=datetime.now(UTC),
    )
    payload = CatalogItemCreate(
        name="Myopia Care",
        item_type="program",
        default_price=10000,
        program_key="myopia_care",
        program_definition=standard_myopia_definition().model_dump(mode="json"),
    )

    with pytest.raises(ValueError, match="Care Programs page"):
        asyncio.run(create_catalog_item_workflow(RepoThatMustNotBeCalled(), user, payload))


def test_progress_report_text_includes_annualized_growth() -> None:
    text = _report_text(
        {
            "program_name": "Child Myopia Care",
            "review_title": "Six-month review",
            "patient": {"name": "Test Patient"},
            "measurements": [],
            "baseline_delta": {"right_mm": 0.2, "left_mm": 0.15},
            "annualized_growth": {
                "right_mm_per_year": 0.4,
                "left_mm_per_year": 0.3,
            },
        }
    )

    assert "Annualized axial growth: OD 0.40 mm/year, OS 0.30 mm/year" in text
