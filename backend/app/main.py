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
    CatalogItemCreate,
    CatalogItemOut,
    CatalogStockUpdate,
    ClinicSettingsOut,
    ClinicSettingsUpdate,
    FollowUpCreate,
    FollowUpOut,
    FollowUpUpdate,
    InvoiceCreate,
    InvoiceOut,
    GenerateLetterPdfRequest,
    GenerateLetterRequest,
    GenerateLetterResponse,
    LoginRequest,
    PatientTimelineEvent,
    GeneratePdfRequest,
    GenerateNoteRequest,
    GenerateNoteResponse,
    NoteCreate,
    PatientCreate,
    PatientOut,
    PatientUpdate,
    SendInvoiceRequest,
    SendLetterRequest,
    SendNoteRequest,
    SendNoteResponse,
    StaffUserCreate,
    UserCreate,
    UserOut,
)
from app.services.anthropic_service import generate_clinic_letter, generate_soap_note
from app.services.pdf_service import build_invoice_pdf, build_letter_pdf, build_note_pdf


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


def format_display_datetime(value: datetime) -> str:
    month = value.strftime("%b")
    day = value.day
    hour = value.strftime("%I").lstrip("0") or "0"
    minute_period = value.strftime("%M %p")
    return f"{month} {day}, {hour}:{minute_period}"


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


@app.get("/catalog", response_model=list[CatalogItemOut])
async def list_catalog(
    current_user: UserOut = Depends(get_current_user),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[CatalogItemOut]:
    items = await repo.list_catalog_items(str(current_user.org_id))
    return [CatalogItemOut(**item) for item in items]


@app.post("/catalog", response_model=CatalogItemOut, status_code=201)
async def create_catalog_item(
    payload: CatalogItemCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> CatalogItemOut:
    created = await repo.create_catalog_item(str(current_user.org_id), payload)
    return CatalogItemOut(**created)


@app.patch("/catalog/{item_id}/stock", response_model=CatalogItemOut)
async def update_catalog_stock(
    item_id: str,
    payload: CatalogStockUpdate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> CatalogItemOut:
    try:
        updated = await repo.update_catalog_stock(str(current_user.org_id), item_id, payload)
        return CatalogItemOut(**updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/catalog/{item_id}", status_code=204)
async def delete_catalog_item(
    item_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    await repo.delete_catalog_item(str(current_user.org_id), item_id)


@app.post("/invoices", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    payload: InvoiceCreate,
    current_user: UserOut = Depends(get_current_user),
    repo: SupabaseRepository = Depends(get_repository),
) -> InvoiceOut:
    try:
        created = await repo.create_invoice(str(current_user.org_id), payload)
        return InvoiceOut(**created)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[InvoiceOut]:
    invoices = await repo.list_invoices(str(current_user.org_id))
    return [InvoiceOut(**invoice) for invoice in invoices]


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
    if current_user.role != "admin" and updates.get("status") == "consultation":
        raise HTTPException(status_code=403, detail="Admin access required to start consultation.")

    try:
        updated = await repo.update_patient(str(current_user.org_id), patient_id, updates)
        return PatientOut(**updated)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/patients/{patient_id}/timeline", response_model=list[PatientTimelineEvent])
async def get_patient_timeline(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientTimelineEvent]:
    try:
        patient = await repo.get_patient(str(current_user.org_id), patient_id)
        notes = await repo.list_notes_for_patient(str(current_user.org_id), patient_id)
        invoices = await repo.list_invoices_for_patient(str(current_user.org_id), patient_id)
        follow_ups = await repo.list_follow_ups_for_patient(str(current_user.org_id), patient_id)

        events: list[PatientTimelineEvent] = [
            PatientTimelineEvent(
                id=f"patient-created-{patient['id']}",
                type="patient_created",
                title="Patient added to queue",
                timestamp=patient["created_at"],
                description=f"{patient['name']} was added with status {patient['status']}.",
            )
        ]

        for note in notes:
            excerpt = str(note.get("content", "")).strip().replace("\n", " ")
            if len(excerpt) > 160:
                excerpt = f"{excerpt[:157]}..."
            events.append(
                PatientTimelineEvent(
                    id=f"note-{note['id']}",
                    type="consultation_note",
                    title="Consultation note generated",
                    timestamp=note["created_at"],
                    description=excerpt or "SOAP note saved.",
                )
            )

        for invoice in invoices:
            item_count = len(invoice.get("items", []))
            events.append(
                PatientTimelineEvent(
                    id=f"invoice-created-{invoice['id']}",
                    type="invoice_created",
                    title="Invoice created",
                    timestamp=invoice["created_at"],
                    description=f"{item_count} item{'s' if item_count != 1 else ''} · total {float(invoice.get('total', 0)):.2f}",
                )
            )
            if invoice.get("sent_at"):
                events.append(
                    PatientTimelineEvent(
                        id=f"invoice-sent-{invoice['id']}",
                        type="bill_sent",
                        title="Bill sent",
                        timestamp=invoice["sent_at"],
                        description=f"Bill sent to patient and marked paid on {invoice.get('paid_at') or invoice['created_at']}.",
                    )
                )

        for follow_up in follow_ups:
            scheduled_for = follow_up["scheduled_for"]
            display_date = format_display_datetime(scheduled_for)
            description = (
                f"Scheduled for {display_date}."
                if not str(follow_up.get("notes") or "").strip()
                else f"Scheduled for {display_date} · {str(follow_up.get('notes') or '').strip()}"
            )
            events.append(
                PatientTimelineEvent(
                    id=f"follow-up-{follow_up['id']}",
                    type="follow_up_scheduled",
                    title="Follow-up scheduled",
                    timestamp=scheduled_for,
                    description=description,
                )
            )

        return sorted(events, key=lambda event: event.timestamp, reverse=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/patients/{patient_id}/follow-ups", response_model=FollowUpOut, status_code=201)
async def create_follow_up(
    patient_id: str,
    payload: FollowUpCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        created = await repo.create_follow_up(
            str(current_user.org_id),
            patient_id,
            str(current_user.id),
            payload,
        )
        return FollowUpOut(**created)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/follow-ups", response_model=list[FollowUpOut])
async def list_follow_ups(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[FollowUpOut]:
    follow_ups = await repo.list_follow_ups(str(current_user.org_id))
    return [FollowUpOut(**follow_up) for follow_up in follow_ups]


@app.patch("/follow-ups/{follow_up_id}", response_model=FollowUpOut)
async def update_follow_up(
    follow_up_id: str,
    payload: FollowUpUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> FollowUpOut:
    try:
        updated = await repo.update_follow_up(str(current_user.org_id), follow_up_id, payload)
        return FollowUpOut(**updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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

        measurement_bits: list[str] = []
        if payload.blood_pressure_systolic is not None and payload.blood_pressure_diastolic is not None:
            measurement_bits.append(
                f"Blood Pressure: {payload.blood_pressure_systolic}/{payload.blood_pressure_diastolic} mmHg"
            )
        elif payload.blood_pressure_systolic is not None or payload.blood_pressure_diastolic is not None:
            bp_parts = [
                str(payload.blood_pressure_systolic) if payload.blood_pressure_systolic is not None else "?",
                str(payload.blood_pressure_diastolic) if payload.blood_pressure_diastolic is not None else "?",
            ]
            measurement_bits.append(f"Blood Pressure: {'/'.join(bp_parts)} mmHg")
        if payload.pulse is not None:
            measurement_bits.append(f"Pulse: {payload.pulse} bpm")
        if payload.spo2 is not None:
            measurement_bits.append(f"SpO2: {payload.spo2}%")
        if payload.blood_sugar is not None:
            measurement_bits.append(f"Blood Sugar: {payload.blood_sugar}")
        for score in payload.test_scores:
            measurement_bits.append(f"{score.label}: {score.value}")
        if payload.eye_exam:
            eye_exam_lines = ["Eye Exam:"]
            for entry in payload.eye_exam:
                row_bits = [
                    f"Sphere {entry.sphere}" if entry.sphere else "",
                    f"Cylinder {entry.cylinder}" if entry.cylinder else "",
                    f"Axis {entry.axis}" if entry.axis else "",
                    f"Vision {entry.vision}" if entry.vision else "",
                ]
                eye_exam_lines.append(
                    f"- {entry.eye.title()} Eye: " + ", ".join(bit for bit in row_bits if bit)
                )
            measurement_bits.append("\n".join(line for line in eye_exam_lines if line.strip()))
        measurements_context = "\n".join(bit for bit in measurement_bits if bit)

        content = await generate_soap_note(
            symptoms=payload.symptoms,
            diagnosis=payload.diagnosis,
            medications=payload.medications,
            notes=payload.notes,
            patient_context=patient_context,
            clinic_context=clinic_context,
            measurements_context=measurements_context,
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


@app.post("/send-invoice", response_model=SendNoteResponse)
async def send_invoice(
    payload: SendInvoiceRequest,
    current_user: UserOut = Depends(get_current_user),
    repo: SupabaseRepository = Depends(get_repository),
) -> SendNoteResponse:
    try:
        await repo.finalize_invoice(str(current_user.org_id), str(payload.invoice_id))
        return SendNoteResponse(
            success=True,
            message=f"Mock invoice send queued for {payload.recipient}.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@app.get("/invoices/{invoice_id}/pdf")
async def generate_invoice_pdf(
    invoice_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> StreamingResponse:
    try:
        invoice = await repo.get_invoice(str(current_user.org_id), invoice_id)
        patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        generated_on = datetime.now().strftime("%b %d, %Y %I:%M %p")
        pdf_bytes = build_invoice_pdf(
            clinic=clinic_settings,
            patient=patient,
            invoice=invoice,
            generated_on=generated_on,
        )
        filename = f"{patient['name'].strip().replace(' ', '_') or 'patient'}_invoice.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
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
