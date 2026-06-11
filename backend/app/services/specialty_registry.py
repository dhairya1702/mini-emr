from __future__ import annotations

from collections.abc import Awaitable, Callable

from app.db import AppRepository
from app.schema_domains.case_studies import PatientCaseStudySourceOut
from app.schema_domains.patients import PatientTimelineEvent

CaseStudySourceEnricher = Callable[[AppRepository, str, str, PatientCaseStudySourceOut], Awaitable[PatientCaseStudySourceOut]]
TimelineContributor = Callable[[AppRepository, str, str], Awaitable[list[PatientTimelineEvent]]]


class SpecialtyDefinition:
    def __init__(
        self,
        *,
        consultation_modules: list[str] | None = None,
        case_study_enricher: CaseStudySourceEnricher | None = None,
        timeline_contributor: TimelineContributor | None = None,
        longitudinal_tracks: list[str] | None = None,
        handout_templates: list[str] | None = None,
        follow_up_presets: list[str] | None = None,
    ) -> None:
        self.consultation_modules = consultation_modules or []
        self.case_study_enricher = case_study_enricher
        self.timeline_contributor = timeline_contributor
        self.longitudinal_tracks = longitudinal_tracks or []
        self.handout_templates = handout_templates or []
        self.follow_up_presets = follow_up_presets or []


SPECIALTY_REGISTRY: dict[str, SpecialtyDefinition] = {
    "general_physician": SpecialtyDefinition(),
    "optometry": SpecialtyDefinition(
        consultation_modules=[
            "contact_lens",
            "binocular_vision",
            "low_vision",
            "myopia_management",
        ],
        longitudinal_tracks=["myopia_measurement"],
    ),
    "pediatrics": SpecialtyDefinition(
        consultation_modules=[
            "pediatric_growth_measurement",
            "well_child_visit",
            "parent_handout_request",
            "pediatric_follow_up_plan",
        ],
        longitudinal_tracks=["growth_measurement"],
        handout_templates=[
            "fever_home_care",
            "nutrition_guidance",
            "well_visit_summary",
            "hydration_uri_home_care",
        ],
        follow_up_presets=[
            "routine_review",
            "growth_recheck",
            "symptom_follow_up",
            "counseling_review",
        ],
    ),
}


def get_specialty_definition(clinic_specialty: str | None) -> SpecialtyDefinition:
    return SPECIALTY_REGISTRY.get(str(clinic_specialty or "").strip(), SpecialtyDefinition())
