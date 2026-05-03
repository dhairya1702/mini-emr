from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import (
    CaseStudyCreate,
    CaseStudyOut,
    CaseStudyUpdate,
    GenerateCaseStudyRequest,
    GenerateCaseStudyResponse,
    UserOut,
)
from app.services.case_study_workflow import (
    create_case_study_workflow,
    generate_case_study_workflow,
    get_case_study_view,
    list_case_studies_view,
    update_case_study_workflow,
)
from app.services.document_helpers import build_document_context_for_user
from app.services.pdf_service import build_case_study_pdf


router = APIRouter()


@router.get("/case-studies", response_model=list[CaseStudyOut])
async def list_case_studies(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> list[CaseStudyOut]:
    try:
        return await list_case_studies_view(repo, str(current_user.org_id))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/case-studies/{case_study_id}", response_model=CaseStudyOut)
async def get_case_study(
    case_study_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> CaseStudyOut:
    try:
        return await get_case_study_view(repo, str(current_user.org_id), case_study_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/generate-case-study", response_model=GenerateCaseStudyResponse)
async def generate_case_study(
    payload: GenerateCaseStudyRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> GenerateCaseStudyResponse:
    try:
        return await generate_case_study_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/case-studies", response_model=CaseStudyOut, status_code=201)
async def create_case_study(
    payload: CaseStudyCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> CaseStudyOut:
    try:
        return await create_case_study_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/case-studies/{case_study_id}", response_model=CaseStudyOut)
async def update_case_study(
    case_study_id: str,
    payload: CaseStudyUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> CaseStudyOut:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided.")
    try:
        return await update_case_study_workflow(repo, current_user, case_study_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/case-studies/{case_study_id}/pdf")
async def generate_case_study_pdf(
    case_study_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    try:
        case_study = await get_case_study_view(repo, str(current_user.org_id), case_study_id)
        clinic_settings = await build_document_context_for_user(repo, current_user)
        generated_on = datetime.now().strftime("%b %d, %Y")
        pdf_bytes = build_case_study_pdf(
            clinic_settings,
            case_study.title,
            case_study.generated_content,
            generated_on,
        )
        filename = f"{case_study.title.strip().replace(' ', '_') or 'case_study'}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
