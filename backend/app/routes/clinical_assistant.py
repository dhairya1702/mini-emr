from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api_errors import bad_request_error, internal_server_error
from app.auth import require_admin
from app.clinic_context import build_clinic_context, build_measurements_context, build_patient_context
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.clinical_assistant import (
    ClinicalAnalysisRequest,
    ClinicalAnalysisResponse,
    ClinicalQuestionsRequest,
    ClinicalQuestionsResponse,
)
from app.services.ai_generation_service import (
    generate_clinical_analysis,
    generate_clinical_questions,
)
from app.services.document_helpers import build_document_context_for_user


router = APIRouter()


def _consultation_context(payload: ClinicalQuestionsRequest | ClinicalAnalysisRequest) -> str:
    consultation = payload.consultation
    bits = [
        f"Symptoms: {consultation.symptoms.strip()}" if consultation.symptoms.strip() else "",
        f"Diagnosis: {consultation.diagnosis.strip()}" if consultation.diagnosis.strip() else "",
        f"Medications: {consultation.medications.strip()}" if consultation.medications.strip() else "",
        f"Clinical notes: {consultation.notes.strip()}" if consultation.notes.strip() else "",
    ]
    return "\n".join(bit for bit in bits if bit)


async def _build_common_context(
    repo: AppRepository,
    current_user: UserOut,
    payload: ClinicalQuestionsRequest | ClinicalAnalysisRequest,
) -> tuple[str, str, str, str, str]:
    clinic_settings = await build_document_context_for_user(repo, current_user)
    patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    return (
        str(clinic_settings.get("clinic_specialty") or "general_physician"),
        build_patient_context(patient),
        build_clinic_context(clinic_settings),
        _consultation_context(payload),
        build_measurements_context(payload.consultation),
    )


@router.post("/ai/clinical-questions", response_model=ClinicalQuestionsResponse)
async def create_clinical_questions(
    payload: ClinicalQuestionsRequest,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> ClinicalQuestionsResponse:
    try:
        clinic_specialty, patient_context, clinic_context, consultation_context, measurement_context = await _build_common_context(
            repo,
            current_user,
            payload,
        )
        return await generate_clinical_questions(
            repo,
            str(current_user.org_id),
            clinic_specialty=clinic_specialty,
            patient_context=patient_context,
            clinic_context=clinic_context,
            consultation_context=consultation_context,
            measurement_context=measurement_context,
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_clinical_questions") from exc


@router.post("/ai/clinical-analysis", response_model=ClinicalAnalysisResponse)
async def create_clinical_analysis(
    payload: ClinicalAnalysisRequest,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> ClinicalAnalysisResponse:
    try:
        clinic_specialty, patient_context, clinic_context, consultation_context, measurement_context = await _build_common_context(
            repo,
            current_user,
            payload,
        )
        return await generate_clinical_analysis(
            repo,
            str(current_user.org_id),
            clinic_specialty=clinic_specialty,
            patient_context=patient_context,
            clinic_context=clinic_context,
            consultation_context=consultation_context,
            measurement_context=measurement_context,
            answers=payload.answers,
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_clinical_analysis") from exc
