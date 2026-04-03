from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.db import SupabaseRepository, get_repository
from app.schemas import (
    GeneratePdfRequest,
    GenerateNoteRequest,
    GenerateNoteResponse,
    NoteCreate,
    PatientCreate,
    PatientOut,
    PatientUpdate,
    SendNoteRequest,
    SendNoteResponse,
)
from app.services.anthropic_service import generate_soap_note
from app.services.pdf_service import build_note_pdf


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


settings = get_settings()
app = FastAPI(title="Clinic EMR API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/patients", response_model=list[PatientOut])
async def get_patients(repo: SupabaseRepository = Depends(get_repository)) -> list[PatientOut]:
    try:
        rows = await repo.list_patients()
        return [PatientOut(**row) for row in rows]
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/patients", response_model=PatientOut, status_code=201)
async def create_patient(
    payload: PatientCreate,
    repo: SupabaseRepository = Depends(get_repository),
) -> PatientOut:
    try:
        created = await repo.create_patient(payload)
        return PatientOut(**created)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/patients/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: str,
    payload: PatientUpdate,
    repo: SupabaseRepository = Depends(get_repository),
) -> PatientOut:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided.")

    try:
        updated = await repo.update_patient(patient_id, updates)
        return PatientOut(**updated)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-note", response_model=GenerateNoteResponse)
async def create_generated_note(
    payload: GenerateNoteRequest,
) -> GenerateNoteResponse:
    try:
        patient_context = ""
        if payload.patient_id:
            repo = get_repository()
            patient = await repo.get_patient(str(payload.patient_id))
            generated_at = datetime.now().strftime("%b %d, %Y %I:%M %p")
            context_bits = [
                f"Name: {patient['name']}",
                f"Phone: {patient['phone']}",
                f"Age: {patient['age']}" if patient.get("age") is not None else "",
                f"Height: {patient['height']} cm" if patient.get("height") is not None else "",
                f"Weight: {patient['weight']} kg" if patient.get("weight") is not None else "",
                f"Temperature: {patient['temperature']} F" if patient.get("temperature") is not None else "",
                f"Reason for Visit: {patient['reason']}",
                f"Generated On: {generated_at}",
            ]
            patient_context = "\n".join(bit for bit in context_bits if bit)

        content = await generate_soap_note(
            symptoms=payload.symptoms,
            diagnosis=payload.diagnosis,
            medications=payload.medications,
            notes=payload.notes,
            patient_context=patient_context,
        )
        if payload.patient_id:
            await repo.create_note(NoteCreate(patient_id=payload.patient_id, content=content))
        return GenerateNoteResponse(content=content)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/send-note", response_model=SendNoteResponse)
async def send_note(payload: SendNoteRequest) -> SendNoteResponse:
    return SendNoteResponse(
        success=True,
        message=f"Mock WhatsApp send queued for {payload.phone}.",
    )


@app.post("/generate-note-pdf")
async def generate_note_pdf(
    payload: GeneratePdfRequest,
    repo: SupabaseRepository = Depends(get_repository),
) -> StreamingResponse:
    try:
        patient = await repo.get_patient(str(payload.patient_id))
        generated_on = datetime.now().strftime("%b %d, %Y %I:%M %p")
        pdf_bytes = build_note_pdf(
            patient=patient,
            note_content=payload.content,
            generated_on=generated_on,
        )
        filename = f"{patient['name'].strip().replace(' ', '_') or 'patient'}_note.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
