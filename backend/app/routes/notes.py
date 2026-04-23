from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import get_current_user, require_admin
from app.db import SupabaseRepository, get_repository
from app.formatting import format_display_datetime
from app.schemas import (
    FinalizeNoteRequest,
    GenerateLetterPdfRequest,
    GenerateLetterRequest,
    GenerateLetterResponse,
    GeneratePdfRequest,
    GenerateNoteRequest,
    GenerateNoteResponse,
    NoteOut,
    SendLetterRequest,
    SendNoteRequest,
    SendNoteResponse,
    UserOut,
)
from app.services.note_workflow import (
    finalize_note_workflow,
    generate_letter_content,
    generate_note_workflow,
    send_note_workflow,
)
from app.services.pdf_service import build_letter_pdf, build_note_pdf


router = APIRouter()


@router.post("/generate-note", response_model=GenerateNoteResponse)
async def create_generated_note(
    payload: GenerateNoteRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> GenerateNoteResponse:
    try:
        return await generate_note_workflow(repo, current_user, payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/generate-letter", response_model=GenerateLetterResponse)
async def create_generated_letter(
    payload: GenerateLetterRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> GenerateLetterResponse:
    try:
        content = await generate_letter_content(
            repo,
            current_user,
            to=payload.to,
            subject=payload.subject,
            content=payload.content,
        )
        return GenerateLetterResponse(content=content)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/notes/finalize", response_model=NoteOut)
async def finalize_note(
    payload: FinalizeNoteRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> NoteOut:
    try:
        return await finalize_note_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/send-note", response_model=SendNoteResponse)
async def send_note(
    payload: SendNoteRequest,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> SendNoteResponse:
    try:
        return await send_note_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/send-letter", response_model=SendNoteResponse)
async def send_letter(
    payload: SendLetterRequest,
    _: UserOut = Depends(get_current_user),
) -> SendNoteResponse:
    return SendNoteResponse(
        success=True,
        message=f"Letter copied or shared outside ClinicOS for {payload.recipient}.",
    )


@router.post("/generate-note-pdf")
async def generate_note_pdf(
    payload: GeneratePdfRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    try:
        patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        generated_on = datetime.now().strftime("%b %d, %Y %I:%M %p")
        pdf_bytes = build_note_pdf(
            patient={**patient, **clinic_settings},
            note_content=payload.content,
            generated_on=generated_on,
        )
        filename = f"{patient['name'].strip().replace(' ', '_') or 'patient'}_note.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/notes/{note_id}/pdf")
async def generate_saved_note_pdf(
    note_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    try:
        note = await repo.get_note(str(current_user.org_id), note_id)
        patient = await repo.get_patient(str(current_user.org_id), str(note["patient_id"]))
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        snapshot_content = str(note.get("snapshot_content") or note.get("content") or "").strip()
        if not snapshot_content:
            raise HTTPException(status_code=400, detail="Saved note content is empty.")
        generated_on = format_display_datetime(note.get("finalized_at") or note.get("created_at") or datetime.now())
        pdf_bytes = build_note_pdf(
            patient={**patient, **clinic_settings},
            note_content=snapshot_content,
            generated_on=generated_on,
        )
        filename = f"{patient['name'].strip().replace(' ', '_') or 'patient'}_note_snapshot.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/generate-letter-pdf")
async def generate_letter_pdf(
    payload: GenerateLetterPdfRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> StreamingResponse:
    try:
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        generated_on = datetime.now().strftime("%b %d, %Y")
        pdf_bytes = build_letter_pdf(
            clinic=clinic_settings,
            letter_content=payload.content,
            generated_on=generated_on,
        )
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="clinic_letter.pdf"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
