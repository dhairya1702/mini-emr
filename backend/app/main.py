from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
import re

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.auth import create_access_token, get_current_user, hash_password, require_admin, verify_password
from app.config import get_settings
from app.db import SupabaseRepository, get_repository
from app.schemas import (
    AuthResponse,
    ClinicSettingsOut,
    ClinicSettingsUpdate,
    GenerateLetterPdfRequest,
    GenerateLetterRequest,
    GenerateLetterResponse,
    LoginRequest,
    GeneratePdfRequest,
    GenerateNoteRequest,
    GenerateNoteResponse,
    NoteCreate,
    PatientCreate,
    PatientOut,
    PatientUpdate,
    SendLetterRequest,
    SendNoteRequest,
    SendNoteResponse,
    StaffUserCreate,
    UserCreate,
    UserOut,
)
from app.services.anthropic_service import generate_clinic_letter, generate_soap_note
from app.services.pdf_service import build_letter_pdf, build_note_pdf


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

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_PATTERN = re.compile(r"^\+?[0-9]{6,}$")


def normalize_identifier(identifier: str) -> str:
    value = identifier.strip()
    if EMAIL_PATTERN.match(value):
        return value.lower()

    compact = re.sub(r"[\s\-()]", "", value)
    if PHONE_PATTERN.match(compact):
        return compact

    raise HTTPException(
        status_code=400,
        detail="Enter a valid email address or phone number.",
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register_user(
    payload: UserCreate,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    organization = await repo.create_organization(payload.clinic_name)
    org_id = str(organization["id"])
    await repo.create_clinic_settings(
        org_id=org_id,
        payload=ClinicSettingsUpdate(
            clinic_name=payload.clinic_name,
            clinic_address=payload.clinic_address,
            clinic_phone=payload.clinic_phone,
            doctor_name=payload.doctor_name,
        ),
    )
    created = await repo.create_user(
        org_id=org_id,
        identifier=identifier,
        password_hash=hash_password(payload.password),
        role="admin",
    )
    user = UserOut(**{key: created[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})
    return AuthResponse(token=create_access_token(created), user=user)


@app.post("/auth/login", response_model=AuthResponse)
async def login_user(
    payload: LoginRequest,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if not existing or not verify_password(payload.password, existing["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")

    user = UserOut(**{key: existing[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})
    return AuthResponse(token=create_access_token(existing), user=user)


@app.get("/auth/me", response_model=UserOut)
async def get_me(current_user: UserOut = Depends(get_current_user)) -> UserOut:
    return current_user


@app.post("/users/staff", response_model=UserOut, status_code=201)
async def create_staff_user(
    payload: StaffUserCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    identifier = normalize_identifier(payload.identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if existing:
        raise HTTPException(status_code=409, detail="An account with that email or phone already exists.")

    created = await repo.create_user(
        org_id=str(current_user.org_id),
        identifier=identifier,
        password_hash=hash_password(payload.password),
        role="staff",
    )
    return UserOut(**{key: created[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})


@app.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: UserOut = Depends(get_current_user),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[UserOut]:
    users = await repo.list_users(str(current_user.org_id))
    return [UserOut(**row) for row in users]


@app.get("/patients", response_model=list[PatientOut])
async def get_patients(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientOut]:
    try:
        rows = await repo.list_patients(str(current_user.org_id))
        return [PatientOut(**row) for row in rows]
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/patients", response_model=PatientOut, status_code=201)
async def create_patient(
    payload: PatientCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        created = await repo.create_patient(str(current_user.org_id), payload)
        return PatientOut(**created)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/patients/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: str,
    payload: PatientUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided.")

    try:
        updated = await repo.update_patient(str(current_user.org_id), patient_id, updates)
        return PatientOut(**updated)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-note", response_model=GenerateNoteResponse)
async def create_generated_note(
    payload: GenerateNoteRequest,
    current_user: UserOut = Depends(get_current_user),
) -> GenerateNoteResponse:
    try:
        patient_context = ""
        clinic_context = ""
        repo = get_repository()
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        clinic_context_bits = [
            f"Clinic Name: {clinic_settings.get('clinic_name', 'ClinicOS') or 'ClinicOS'}",
            f"Clinic Address: {clinic_settings.get('clinic_address', '')}" if clinic_settings.get("clinic_address") else "",
            f"Clinic Phone: {clinic_settings.get('clinic_phone', '')}" if clinic_settings.get("clinic_phone") else "",
            f"Doctor Name: {clinic_settings.get('doctor_name', '')}" if clinic_settings.get("doctor_name") else "",
            f"Custom Header: {clinic_settings.get('custom_header', '')}" if clinic_settings.get("custom_header") else "",
            f"Custom Footer: {clinic_settings.get('custom_footer', '')}" if clinic_settings.get("custom_footer") else "",
        ]
        clinic_context = "\n".join(bit for bit in clinic_context_bits if bit)
        if payload.patient_id:
            patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
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
            clinic_context=clinic_context,
        )
        if payload.patient_id:
            await repo.create_note(
                str(current_user.org_id),
                NoteCreate(patient_id=payload.patient_id, content=content),
            )
        return GenerateNoteResponse(content=content)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-letter", response_model=GenerateLetterResponse)
async def create_generated_letter(
    payload: GenerateLetterRequest,
    current_user: UserOut = Depends(get_current_user),
) -> GenerateLetterResponse:
    try:
        repo = get_repository()
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        clinic_context_bits = [
            f"Clinic Name: {clinic_settings.get('clinic_name', 'ClinicOS') or 'ClinicOS'}",
            f"Clinic Address: {clinic_settings.get('clinic_address', '')}" if clinic_settings.get("clinic_address") else "",
            f"Clinic Phone: {clinic_settings.get('clinic_phone', '')}" if clinic_settings.get("clinic_phone") else "",
            f"Doctor Name: {clinic_settings.get('doctor_name', '')}" if clinic_settings.get("doctor_name") else "",
            f"Custom Header: {clinic_settings.get('custom_header', '')}" if clinic_settings.get("custom_header") else "",
            f"Custom Footer: {clinic_settings.get('custom_footer', '')}" if clinic_settings.get("custom_footer") else "",
        ]
        clinic_context = "\n".join(bit for bit in clinic_context_bits if bit)
        content = await generate_clinic_letter(
            to=payload.to,
            subject=payload.subject,
            content=payload.content,
            clinic_context=clinic_context,
        )
        return GenerateLetterResponse(content=content)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/send-note", response_model=SendNoteResponse)
async def send_note(
    payload: SendNoteRequest,
    _: UserOut = Depends(get_current_user),
) -> SendNoteResponse:
    return SendNoteResponse(
        success=True,
        message=f"Mock WhatsApp send queued for {payload.phone}.",
    )


@app.post("/send-letter", response_model=SendNoteResponse)
async def send_letter(
    payload: SendLetterRequest,
    _: UserOut = Depends(get_current_user),
) -> SendNoteResponse:
    return SendNoteResponse(
        success=True,
        message=f"Mock letter send queued for {payload.recipient}.",
    )


@app.post("/generate-note-pdf")
async def generate_note_pdf(
    payload: GeneratePdfRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
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
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-letter-pdf")
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
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/settings/clinic", response_model=ClinicSettingsOut)
async def get_clinic_settings(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        settings_row = await repo.get_clinic_settings(str(current_user.org_id))
        if not settings_row:
            settings_row = await repo.upsert_clinic_settings(
                str(current_user.org_id),
                ClinicSettingsUpdate(),
            )
        return ClinicSettingsOut(**settings_row)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.put("/settings/clinic", response_model=ClinicSettingsOut)
async def update_clinic_settings(
    payload: ClinicSettingsUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        saved = await repo.upsert_clinic_settings(str(current_user.org_id), payload)
        return ClinicSettingsOut(**saved)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
