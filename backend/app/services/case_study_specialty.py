from __future__ import annotations

from app.db import AppRepository
from app.schema_domains.case_studies import PatientCaseStudySourceOut
from app.schema_domains.specialty import PediatricGrowthSummaryOut
from app.services.patient_views import build_patient_growth_history_view, build_patient_myopia_history_view
from app.services.specialty_registry import SPECIALTY_REGISTRY


async def enrich_optometry_case_study_source(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
    source: PatientCaseStudySourceOut,
) -> PatientCaseStudySourceOut:
    history = await build_patient_myopia_history_view(repo, org_id, patient_id)
    return source.model_copy(update={"myopia_history": history if history.records else None})


async def enrich_pediatrics_case_study_source(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
    source: PatientCaseStudySourceOut,
) -> PatientCaseStudySourceOut:
    history = await build_patient_growth_history_view(repo, org_id, patient_id)
    validated_history = history if isinstance(history, PediatricGrowthSummaryOut) else PediatricGrowthSummaryOut.model_validate(history)
    records = validated_history.records
    return source.model_copy(
        update={
            "pediatric_growth_history": validated_history if records else None,
        }
    )

SPECIALTY_REGISTRY["optometry"].case_study_enricher = enrich_optometry_case_study_source
SPECIALTY_REGISTRY["pediatrics"].case_study_enricher = enrich_pediatrics_case_study_source


async def apply_case_study_specialty_enrichment(
    repo: AppRepository,
    org_id: str,
    patient_id: str,
    clinic_specialty: str | None,
    source: PatientCaseStudySourceOut,
) -> PatientCaseStudySourceOut:
    enricher = SPECIALTY_REGISTRY.get(str(clinic_specialty or "").strip(), None)
    callback = enricher.case_study_enricher if enricher else None
    if not callback:
        return source
    return await callback(repo, org_id, patient_id, source)
