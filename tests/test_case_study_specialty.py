from __future__ import annotations

import sys
from pathlib import Path
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.schema_domains.case_studies import PatientCaseStudySourceOut
from app.schema_domains.optometry import MyopiaDeltaOut, MyopiaHistoryOut, MyopiaMeasurementOut
from app.schema_domains.patients import NoteOut, PatientOut, PatientTimelineEvent, PatientVisitOut
from app.services import case_study_specialty


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _build_source() -> PatientCaseStudySourceOut:
    patient_id = uuid4()
    now = "2026-05-03T10:00:00+00:00"
    return PatientCaseStudySourceOut(
        patient=PatientOut(
            id=patient_id,
            name="Patient A",
            phone="5555555555",
            email="patient@example.com",
            address="1 Demo Street",
            reason="Blurred vision",
            age=12,
            weight=None,
            height=None,
            temperature=None,
            status="consultation",
            billed=False,
            created_at=now,
            last_visit_at=now,
        ),
        visits=[
            PatientVisitOut(
                id=uuid4(),
                patient_id=patient_id,
                name="Patient A",
                phone="5555555555",
                email="patient@example.com",
                address="1 Demo Street",
                reason="Blurred vision",
                age=12,
                weight=None,
                height=None,
                temperature=None,
                source="queue",
                appointment_id=None,
                created_at=now,
                status="consultation",
                billed=False,
                last_visit_at=now,
            ),
        ],
        timeline=[
            PatientTimelineEvent(
                id=str(uuid4()),
                type="visit_recorded",
                title="Visit recorded",
                timestamp=now,
                description="Blurred vision at presentation",
            ),
        ],
        notes=[
            NoteOut(
                id=uuid4(),
                patient_id=patient_id,
                content="Note content",
                status="draft",
                version_number=1,
                root_note_id=None,
                amended_from_note_id=None,
                snapshot_content=None,
                asset_payload=[],
                snapshot_asset_payload=[],
                finalized_at=None,
                sent_at=None,
                sent_by=None,
                sent_by_name=None,
                sent_to=None,
                created_at=now,
            ),
        ],
        myopia_history=None,
    )


def _build_myopia_history(patient_id):
    return MyopiaHistoryOut(
        patient_id=patient_id,
        records=[
            MyopiaMeasurementOut(
                id=uuid4(),
                org_id=uuid4(),
                patient_id=patient_id,
                measured_at="2026-01-01T10:00:00+00:00",
                age_years=11.0,
                axial_length_right_mm=24.10,
                axial_length_left_mm=24.04,
                treatment_type="Observation",
                treatment_notes="Baseline",
                visit_notes="Initial measurement",
                refraction_right="-1.50 DS",
                refraction_left="-1.25 DS",
                created_at="2026-01-01T10:05:00+00:00",
            ),
        ],
        baseline_delta=MyopiaDeltaOut(right_mm=0.0, left_mm=0.0),
        last_delta=MyopiaDeltaOut(right_mm=0.0, left_mm=0.0),
        annualized_growth=MyopiaDeltaOut(right_mm=0.20, left_mm=0.18),
        overlay_version="clinic-reference-v1",
    )


@pytest.mark.anyio
async def test_case_study_specialty_enrichment_skips_unknown_specialty():
    source = _build_source()

    result = await case_study_specialty.apply_case_study_specialty_enrichment(
        repo=object(),
        org_id="org-1",
        patient_id=str(source.patient.id),
        clinic_specialty="general_physician",
        source=source,
    )

    assert result is source
    assert result.myopia_history is None


@pytest.mark.anyio
async def test_case_study_specialty_enrichment_adds_optometry_history(monkeypatch):
    source = _build_source()
    history = _build_myopia_history(source.patient.id)

    async def fake_build_history(repo, org_id, patient_id):
        assert org_id == "org-1"
        assert patient_id == str(source.patient.id)
        return history

    monkeypatch.setattr(
        case_study_specialty,
        "build_patient_myopia_history_view",
        fake_build_history,
    )

    result = await case_study_specialty.apply_case_study_specialty_enrichment(
        repo=object(),
        org_id="org-1",
        patient_id=str(source.patient.id),
        clinic_specialty="optometry",
        source=source,
    )

    assert result is not source
    assert result.patient == source.patient
    assert result.myopia_history is not None
    assert result.myopia_history.overlay_version == "clinic-reference-v1"
    assert len(result.myopia_history.records) == 1


@pytest.mark.anyio
async def test_case_study_specialty_enrichment_omits_empty_optometry_history(monkeypatch):
    source = _build_source()
    empty_history = MyopiaHistoryOut(
        patient_id=source.patient.id,
        records=[],
        baseline_delta=None,
        last_delta=None,
        annualized_growth=None,
        overlay_version="clinic-reference-v1",
    )

    async def fake_build_history(_repo, _org_id, _patient_id):
        return empty_history

    monkeypatch.setattr(
        case_study_specialty,
        "build_patient_myopia_history_view",
        fake_build_history,
    )

    result = await case_study_specialty.apply_case_study_specialty_enrichment(
        repo=object(),
        org_id="org-1",
        patient_id=str(source.patient.id),
        clinic_specialty="optometry",
        source=source,
    )

    assert result.myopia_history is None


@pytest.mark.anyio
async def test_case_study_specialty_enrichment_adds_pediatric_growth_history(monkeypatch):
    source = _build_source()

    async def fake_build_growth_history(_repo, _org_id, _patient_id):
        return {
            "patient_id": str(source.patient.id),
            "latest_measurement": None,
            "previous_measurement": None,
            "interval_change": None,
            "trend_summary": "height +2 cm, weight +1 kg",
            "flags": [],
            "records": [
                {
                    "measured_at": "2026-05-01T10:00:00+00:00",
                    "age_months": 144,
                    "height_cm": 150.0,
                    "weight_kg": 42.0,
                    "bmi": 18.67,
                    "head_circumference_cm": None,
                    "visit_notes": "Well visit",
                    "track_id": str(uuid4()),
                    "created_at": "2026-05-01T10:05:00+00:00",
                }
            ],
        }

    monkeypatch.setattr(
        case_study_specialty,
        "build_patient_growth_history_view",
        fake_build_growth_history,
    )

    result = await case_study_specialty.apply_case_study_specialty_enrichment(
        repo=object(),
        org_id="org-1",
        patient_id=str(source.patient.id),
        clinic_specialty="pediatrics",
        source=source,
    )

    assert result.pediatric_growth_history is not None
    assert result.pediatric_growth_history.records[0].height_cm == 150.0
