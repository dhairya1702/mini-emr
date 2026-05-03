from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.db import SupabaseRepository
from app.schemas import PatientCaseStudySourceOut
from app.services.patient_views import build_patient_myopia_history_view


CaseStudySourceEnricher = Callable[[SupabaseRepository, str, str, PatientCaseStudySourceOut], Awaitable[PatientCaseStudySourceOut]]


async def enrich_optometry_case_study_source(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
    source: PatientCaseStudySourceOut,
) -> PatientCaseStudySourceOut:
    history = await build_patient_myopia_history_view(repo, org_id, patient_id)
    return source.model_copy(update={"myopia_history": history if history.records else None})


CASE_STUDY_SPECIALTY_ENRICHERS: dict[str, CaseStudySourceEnricher] = {
    "optometry": enrich_optometry_case_study_source,
}


async def apply_case_study_specialty_enrichment(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
    clinic_specialty: str | None,
    source: PatientCaseStudySourceOut,
) -> PatientCaseStudySourceOut:
    enricher = CASE_STUDY_SPECIALTY_ENRICHERS.get(str(clinic_specialty or "").strip())
    if not enricher:
        return source
    return await enricher(repo, org_id, patient_id, source)
