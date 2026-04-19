from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
import re
from time import monotonic

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.auth import (
    SESSION_EXPIRES_AT_HEADER,
    SESSION_TOKEN_HEADER,
    clear_session,
    get_current_user,
    hash_password,
    issue_session_headers,
    require_admin,
    verify_password,
)
from app.config import get_settings
from app.db import SupabaseRepository, get_repository
from app.db import DuplicateCheckInCandidateError
from app.exports import (
    build_csv_response,
    build_history_visit_rows,
    filter_rows_by_created_at,
    get_export_range_start,
)
from app.formatting import format_display_datetime, format_money
from app.schemas import (
    AuditEventOut,
    AppointmentCreate,
    AppointmentCheckInRequest,
    AppointmentOut,
    AppointmentStatus,
    AppointmentUpdate,
    AuthResponse,
    CatalogItemCreate,
    CatalogItemOut,
    CatalogStockUpdate,
    ClinicSettingsOut,
    ClinicSettingsUpdate,
    FollowUpCreate,
    FollowUpOut,
    FollowUpStatus,
    FollowUpUpdate,
    FinalizeNoteRequest,
    InvoiceCreate,
    InvoiceOut,
    GenerateLetterPdfRequest,
    GenerateLetterRequest,
    GenerateLetterResponse,
    LoginRequest,
    NoteOut,
    PatientTimelineEvent,
    GeneratePdfRequest,
    GenerateNoteRequest,
    GenerateNoteResponse,
    NoteCreate,
    PatientCreate,
    PatientMatchOut,
    PatientOut,
    PatientUpdate,
    PatientVisitCreate,
    PatientVisitOut,
    SendInvoiceRequest,
    SendLetterRequest,
    SendNoteRequest,
    SendNoteResponse,
    StaffUserCreate,
    UserCreate,
    UserOut,
)
from app.clinic_context import build_clinic_context, build_measurements_context, build_patient_context
from app.services.anthropic_service import generate_clinic_letter, generate_soap_note
from app.services.pdf_service import build_invoice_pdf, build_letter_pdf, build_note_pdf
from app.timeline import build_patient_timeline


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
    expose_headers=[SESSION_TOKEN_HEADER, SESSION_EXPIRES_AT_HEADER],
)

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_PATTERN = re.compile(r"^\+?[0-9]{6,}$")
RATE_LIMIT_WINDOWS: dict[str, tuple[int, float]] = {
    "auth_login": (5, 60.0),
    "auth_register": (3, 300.0),
    "note_generation": (20, 300.0),
}
RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


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


def get_actor_name(current_user: UserOut) -> str:
    return current_user.name.strip() or current_user.identifier.strip() or "Clinic User"


def user_names_by_id(users: list[dict]) -> dict[str, str]:
    return {str(user["id"]): str(user.get("name") or "").strip() for user in users}


def enforce_rate_limit(scope: str, key: str) -> None:
    max_requests, window_seconds = RATE_LIMIT_WINDOWS[scope]
    bucket = RATE_LIMIT_BUCKETS[f"{scope}:{key}"]
    now = monotonic()
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= max_requests:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait and try again.")
    bucket.append(now)


async def write_audit_event(
    repo: SupabaseRepository,
    current_user: UserOut,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    metadata: dict | None = None,
) -> None:
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=get_actor_name(current_user),
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        summary=summary,
        metadata=metadata,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register_user(
    payload: UserCreate,
    response: Response,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    enforce_rate_limit("auth_register", identifier)
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
    return AuthResponse(token=issue_session_headers(response, created), user=user)


@app.post("/auth/login", response_model=AuthResponse)
async def login_user(
    payload: LoginRequest,
    response: Response,
    repo: SupabaseRepository = Depends(get_repository),
) -> AuthResponse:
    identifier = normalize_identifier(payload.identifier)
    enforce_rate_limit("auth_login", identifier)
    existing = await repo.get_user_by_identifier(identifier)
    if not existing or not verify_password(payload.password, existing["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/phone or password.")

    user = UserOut(**{key: existing[key] for key in ("id", "org_id", "identifier", "name", "role", "created_at")})
    return AuthResponse(token=issue_session_headers(response, existing), user=user)


@app.get("/auth/me", response_model=UserOut)
async def get_me(response: Response, current_user: UserOut = Depends(get_current_user)) -> UserOut:
    issue_session_headers(response, {
        "id": str(current_user.id),
        "org_id": str(current_user.org_id),
        "role": current_user.role,
        "identifier": current_user.identifier,
    })
    return current_user


@app.post("/auth/logout", status_code=204)
async def logout_user(response: Response) -> None:
    clear_session(response)


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
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[UserOut]:
    users = await repo.list_users(str(current_user.org_id))
    return [UserOut(**row) for row in users]


@app.get("/catalog", response_model=list[CatalogItemOut])
async def list_catalog(
    current_user: UserOut = Depends(require_admin),
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
        await write_audit_event(
            repo,
            current_user,
            entity_type="catalog_item",
            entity_id=item_id,
            action="catalog_stock_adjusted",
            summary=f"Adjusted stock for {updated['name']} by {payload.delta:g}.",
            metadata={
                "catalog_item_id": item_id,
                "item_name": updated.get("name"),
                "delta": payload.delta,
                "stock_quantity": updated.get("stock_quantity"),
                "adjustment_source": "manual",
            },
        )
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
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> InvoiceOut:
    try:
        created = await repo.create_invoice(str(current_user.org_id), payload)
        patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
        patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
        await write_audit_event(
            repo,
            current_user,
            entity_type="invoice",
            entity_id=str(created["id"]),
            action="invoice_created",
            summary=f"Created invoice for {patient_name} totaling {float(created.get('total', 0)):.2f}.",
            metadata={
                "patient_id": str(created["patient_id"]),
                "patient_name": patient_name,
                "item_count": len(created.get("items", [])),
                "payment_status": created.get("payment_status"),
                "amount_paid": created.get("amount_paid"),
                "balance_due": created.get("balance_due"),
            },
        )
        return InvoiceOut(**created)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[InvoiceOut]:
    invoices = await repo.list_invoices(str(current_user.org_id))
    users = await repo.list_users(str(current_user.org_id))
    names = user_names_by_id(users)
    return [
        InvoiceOut(**{**invoice, "completed_by_name": names.get(str(invoice.get("completed_by") or ""))})
        for invoice in invoices
    ]


@app.get("/audit-events", response_model=list[AuditEventOut])
async def list_audit_events(
    limit: int = Query(default=100, ge=1, le=250),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> list[AuditEventOut]:
    rows = await repo.list_audit_events(str(current_user.org_id), limit=limit)
    return [AuditEventOut(**row) for row in rows]


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


@app.get("/visits", response_model=list[PatientVisitOut])
async def get_patient_visits(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientVisitOut]:
    try:
        visits = await repo.list_patient_visits(str(current_user.org_id))
        patients = await repo.list_patients(str(current_user.org_id))
        return build_history_visit_rows(visits, patients)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/patients/lookup", response_model=list[PatientMatchOut])
async def lookup_patients_by_phone(
    phone: str = Query(min_length=6, max_length=30),
    limit: int = Query(default=10, ge=1, le=25),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientMatchOut]:
    try:
        matches = await repo.list_patient_matches_by_phone(str(current_user.org_id), phone, limit=limit)
        return [PatientMatchOut(**match) for match in matches]
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
        await write_audit_event(
            repo,
            current_user,
            entity_type="patient",
            entity_id=str(created["id"]),
            action="patient_created",
            summary=f"Added patient {created['name']} to the queue.",
            metadata={"status": created.get("status"), "phone": created.get("phone")},
        )
        return PatientOut(**created)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/patients/{patient_id}/visits", response_model=PatientOut)
async def create_patient_visit(
    patient_id: str,
    payload: PatientVisitCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        updated = await repo.create_patient_visit(str(current_user.org_id), patient_id, payload)
        await write_audit_event(
            repo,
            current_user,
            entity_type="patient",
            entity_id=str(updated["id"]),
            action="patient_visit_recorded",
            summary=f"Recorded a new visit for patient {updated['name']}.",
            metadata={"status": updated.get("status"), "phone": updated.get("phone")},
        )
        return PatientOut(**updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/appointments", response_model=AppointmentOut, status_code=201)
async def create_appointment(
    payload: AppointmentCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> AppointmentOut:
    try:
        created = await repo.create_appointment(str(current_user.org_id), payload)
        await write_audit_event(
            repo,
            current_user,
            entity_type="appointment",
            entity_id=str(created["id"]),
            action="appointment_created",
            summary=f"Booked appointment for {created['name']} on {format_display_datetime(created['scheduled_for'])}.",
            metadata={"patient_name": created.get("name"), "status": created.get("status")},
        )
        return AppointmentOut(**created)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/appointments", response_model=list[AppointmentOut])
async def list_appointments(
    status: AppointmentStatus | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[AppointmentOut]:
    appointments = await repo.list_appointments(str(current_user.org_id), status=status, query=q, limit=limit)
    return [AppointmentOut(**appointment) for appointment in appointments]


@app.post("/appointments/{appointment_id}/check-in", response_model=PatientOut)
async def check_in_appointment(
    appointment_id: str,
    payload: AppointmentCheckInRequest | None = None,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        _appointment, patient = await repo.check_in_appointment(
            str(current_user.org_id),
            appointment_id,
            payload or AppointmentCheckInRequest(),
        )
        await write_audit_event(
            repo,
            current_user,
            entity_type="appointment",
            entity_id=appointment_id,
            action="appointment_checked_in",
            summary=f"Checked in appointment into patient record {patient['name']}.",
            metadata={"checked_in_patient_id": str(patient["id"])},
        )
        return PatientOut(**patient)
    except DuplicateCheckInCandidateError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Possible duplicate active patients found.",
                "matches": [PatientMatchOut(**match).model_dump(mode="json") for match in exc.matches],
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/appointments/{appointment_id}/check-in-preview", response_model=list[PatientMatchOut])
async def preview_check_in_appointment(
    appointment_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientMatchOut]:
    try:
        matches = await repo.list_potential_check_in_matches(str(current_user.org_id), appointment_id)
        return [PatientMatchOut(**match) for match in matches]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.patch("/appointments/{appointment_id}", response_model=AppointmentOut)
async def update_appointment(
    appointment_id: str,
    payload: AppointmentUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> AppointmentOut:
    try:
        updated = await repo.update_appointment(str(current_user.org_id), appointment_id, payload)
        changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
        await write_audit_event(
            repo,
            current_user,
            entity_type="appointment",
            entity_id=str(updated["id"]),
            action="appointment_updated",
            summary=f"Updated appointment fields: {', '.join(changed_fields)}.",
            metadata={"changed_fields": changed_fields, "status": updated.get("status")},
        )
        return AppointmentOut(**updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
        changed_fields = sorted(updates.keys())
        await write_audit_event(
            repo,
            current_user,
            entity_type="patient",
            entity_id=str(updated["id"]),
            action="patient_updated",
            summary=f"Updated patient {updated['name']}: {', '.join(changed_fields)}.",
            metadata={"changed_fields": changed_fields},
        )
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
        visits = await repo.list_patient_visits_for_patient(str(current_user.org_id), patient_id)
        notes = await repo.list_notes_for_patient(str(current_user.org_id), patient_id)
        invoices = await repo.list_invoices_for_patient(str(current_user.org_id), patient_id)
        follow_ups = await repo.list_follow_ups_for_patient(str(current_user.org_id), patient_id)
        appointments = await repo.list_appointments_for_patient(str(current_user.org_id), patient_id)
        users = await repo.list_users(str(current_user.org_id))
        names = user_names_by_id(users)
        notes = [{**note, "sent_by_name": names.get(str(note.get("sent_by") or ""))} for note in notes]
        invoices = [{**invoice, "completed_by_name": names.get(str(invoice.get("completed_by") or ""))} for invoice in invoices]
        return build_patient_timeline(
            patient=patient,
            visits=visits,
            notes=notes,
            invoices=invoices,
            follow_ups=follow_ups,
            appointments=appointments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/patients/{patient_id}/notes", response_model=list[NoteOut])
async def list_patient_notes(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[NoteOut]:
    try:
        await repo.get_patient(str(current_user.org_id), patient_id)
        notes = await repo.list_notes_for_patient(str(current_user.org_id), patient_id)
        users = await repo.list_users(str(current_user.org_id))
        names = user_names_by_id(users)
        enriched = [
            {
                **note,
                "sent_by_name": names.get(str(note.get("sent_by") or "")),
            }
            for note in notes
        ]
        return [NoteOut(**note) for note in enriched]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/patients/{patient_id}/invoices", response_model=list[InvoiceOut])
async def list_patient_invoices(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[InvoiceOut]:
    try:
        await repo.get_patient(str(current_user.org_id), patient_id)
        invoices = await repo.list_invoices_for_patient(str(current_user.org_id), patient_id)
        users = await repo.list_users(str(current_user.org_id))
        names = user_names_by_id(users)
        enriched = [
            {
                **invoice,
                "completed_by_name": names.get(str(invoice.get("completed_by") or "")),
            }
            for invoice in invoices
        ]
        return [InvoiceOut(**invoice) for invoice in enriched]
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
        patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
        patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
        await write_audit_event(
            repo,
            current_user,
            entity_type="follow_up",
            entity_id=str(created["id"]),
            action="follow_up_created",
            summary=f"Scheduled follow-up for {patient_name} on {format_display_datetime(created['scheduled_for'])}.",
            metadata={"patient_id": str(created["patient_id"]), "patient_name": patient_name, "status": created.get("status")},
        )
        return FollowUpOut(**created)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/follow-ups", response_model=list[FollowUpOut])
async def list_follow_ups(
    status: FollowUpStatus | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=200, ge=1, le=500),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[FollowUpOut]:
    follow_ups = await repo.list_follow_ups(str(current_user.org_id), status=status, query=q, limit=limit)
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
        changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
        action = "follow_up_completed" if updated.get("status") == "completed" else "follow_up_updated"
        await write_audit_event(
            repo,
            current_user,
            entity_type="follow_up",
            entity_id=str(updated["id"]),
            action=action,
            summary=f"Updated follow-up fields: {', '.join(changed_fields)}.",
            metadata={"changed_fields": changed_fields, "status": updated.get("status")},
        )
        return FollowUpOut(**updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-note", response_model=GenerateNoteResponse)
async def create_generated_note(
    payload: GenerateNoteRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> GenerateNoteResponse:
    try:
        enforce_rate_limit("note_generation", str(current_user.id))
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        clinic_context = build_clinic_context(clinic_settings)
        patient = None
        if payload.patient_id:
            patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
        patient_context = build_patient_context(patient)
        measurements_context = build_measurements_context(payload)

        content = await generate_soap_note(
            symptoms=payload.symptoms,
            diagnosis=payload.diagnosis,
            medications=payload.medications,
            notes=payload.notes,
            patient_context=patient_context,
            clinic_context=clinic_context,
            measurements_context=measurements_context,
        )
        note = None
        if payload.patient_id:
            patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
            if payload.note_id:
                existing_note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
                if str(existing_note["patient_id"]) != str(payload.patient_id):
                    raise HTTPException(status_code=400, detail="Note does not belong to that patient.")
                if existing_note.get("status") == "draft":
                    note = await repo.update_note_draft(str(current_user.org_id), str(payload.note_id), content)
                    await write_audit_event(
                        repo,
                        current_user,
                        entity_type="note",
                        entity_id=str(note["id"]),
                        action="consultation_note_updated",
                        summary=f"Updated draft consultation note for {patient_name}.",
                        metadata={
                            "patient_id": str(payload.patient_id),
                            "patient_name": patient_name,
                            "status": note.get("status"),
                            "version_number": note.get("version_number", 1),
                        },
                    )
                else:
                    note = await repo.create_note_amendment(str(current_user.org_id), str(payload.note_id), content)
                    await write_audit_event(
                        repo,
                        current_user,
                        entity_type="note",
                        entity_id=str(note["id"]),
                        action="consultation_note_amended",
                        summary=f"Created amended draft note v{note.get('version_number', 1)} for {patient_name}.",
                        metadata={
                            "patient_id": str(payload.patient_id),
                            "patient_name": patient_name,
                            "status": note.get("status"),
                            "version_number": note.get("version_number", 1),
                            "amended_from_note_id": note.get("amended_from_note_id"),
                            "root_note_id": note.get("root_note_id"),
                        },
                    )
            else:
                note = await repo.create_note(
                    str(current_user.org_id),
                    NoteCreate(patient_id=payload.patient_id, content=content),
                )
                await write_audit_event(
                    repo,
                    current_user,
                    entity_type="note",
                    entity_id=str(note["id"]),
                    action="consultation_note_created",
                    summary=f"Generated draft consultation note for {patient_name}.",
                    metadata={
                        "patient_id": str(payload.patient_id),
                        "patient_name": patient_name,
                        "status": note.get("status"),
                        "version_number": note.get("version_number", 1),
                    },
                )
        return GenerateNoteResponse(
            content=content,
            note_id=note["id"] if note else None,
            status=note.get("status") if note else None,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-letter", response_model=GenerateLetterResponse)
async def create_generated_letter(
    payload: GenerateLetterRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> GenerateLetterResponse:
    try:
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
        clinic_context = build_clinic_context(clinic_settings)
        content = await generate_clinic_letter(
            to=payload.to,
            subject=payload.subject,
            content=payload.content,
            clinic_context=clinic_context,
        )
        return GenerateLetterResponse(content=content)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/notes/finalize", response_model=NoteOut)
async def finalize_note(
    payload: FinalizeNoteRequest,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> NoteOut:
    try:
        note = await repo.finalize_note(str(current_user.org_id), str(payload.note_id))
        await write_audit_event(
            repo,
            current_user,
            entity_type="note",
            entity_id=str(payload.note_id),
            action="consultation_note_finalized",
            summary=f"Finalized consultation note v{note.get('version_number', 1)}.",
            metadata={
                "patient_id": str(note["patient_id"]),
                "status": note.get("status"),
                "version_number": note.get("version_number", 1),
                "root_note_id": note.get("root_note_id"),
                "amended_from_note_id": note.get("amended_from_note_id"),
            },
        )
        return NoteOut(**note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/send-note", response_model=SendNoteResponse)
async def send_note(
    payload: SendNoteRequest,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> SendNoteResponse:
    try:
        note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
        if str(note["patient_id"]) != str(payload.patient_id):
            raise HTTPException(status_code=400, detail="Note does not belong to that patient.")
        sent_note = await repo.mark_note_sent(
            str(current_user.org_id),
            str(payload.note_id),
            sent_by=str(current_user.id),
            sent_to=payload.phone,
        )
        await write_audit_event(
            repo,
            current_user,
            entity_type="note",
            entity_id=str(payload.note_id),
            action="consultation_note_shared",
            summary=f"Shared consultation note v{sent_note.get('version_number', 1)} with {payload.phone}.",
            metadata={
                "patient_id": str(payload.patient_id),
                "recipient": payload.phone,
                "sent_at": sent_note.get("sent_at"),
                "sent_by": str(current_user.id),
                "sent_by_name": get_actor_name(current_user),
                "sent_to": payload.phone,
                "version_number": sent_note.get("version_number", 1),
                "root_note_id": sent_note.get("root_note_id"),
                "amended_from_note_id": sent_note.get("amended_from_note_id"),
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SendNoteResponse(
        success=True,
        message=f"Saved note locked and ready to share with {payload.phone}.",
    )


@app.post("/send-letter", response_model=SendNoteResponse)
async def send_letter(
    payload: SendLetterRequest,
    _: UserOut = Depends(get_current_user),
) -> SendNoteResponse:
    return SendNoteResponse(
        success=True,
        message=f"Letter copied or shared outside ClinicOS for {payload.recipient}.",
    )


@app.post("/send-invoice", response_model=SendNoteResponse)
async def send_invoice(
    payload: SendInvoiceRequest,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> SendNoteResponse:
    try:
        invoice = await repo.get_invoice(str(current_user.org_id), str(payload.invoice_id))
        patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
        patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
        catalog_items = await repo.list_catalog_items(str(current_user.org_id))
        catalog_by_id = {str(item["id"]): item for item in catalog_items}
        stock_deductions = []
        for item in invoice.get("items", []):
            catalog_item_id = item.get("catalog_item_id")
            if not catalog_item_id:
                continue
            catalog_item = catalog_by_id.get(str(catalog_item_id))
            if catalog_item and catalog_item.get("track_inventory"):
                stock_deductions.append(
                    {
                        "catalog_item_id": str(catalog_item_id),
                        "item_name": item.get("label"),
                        "quantity": item.get("quantity"),
                    }
                )
        finalized = await repo.finalize_invoice(
            str(current_user.org_id),
            str(payload.invoice_id),
            completed_by=str(current_user.id),
        )
        await write_audit_event(
            repo,
            current_user,
            entity_type="invoice",
            entity_id=str(payload.invoice_id),
            action="invoice_shared",
            summary=f"Shared invoice for {patient_name} with {payload.recipient}.",
            metadata={
                "patient_id": finalized.get("patient_id"),
                "patient_name": patient_name,
                "recipient": payload.recipient,
                "completed_at": finalized.get("completed_at"),
                "completed_by": finalized.get("completed_by"),
                "completed_by_name": get_actor_name(current_user),
                "sent_at": finalized.get("sent_at"),
                "already_finalized": finalized.get("already_finalized", False),
                "stock_deductions": finalized.get("stock_deductions", stock_deductions),
                "amount_paid": invoice.get("amount_paid"),
                "balance_due": invoice.get("balance_due"),
            },
        )
        return SendNoteResponse(
            success=True,
            message=(
                f"Invoice already finalized for {payload.recipient}."
                if finalized.get("already_finalized")
                else f"Invoice marked shared for {payload.recipient}."
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/exports/patients.csv")
async def export_patients_csv(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    patients = await repo.list_patients(str(current_user.org_id))
    return build_csv_response(
        "patients.csv",
        patients,
        [
            "name",
            "phone",
            "reason",
            "age",
            "weight",
            "height",
            "created_at",
            "last_visit_at",
        ],
    )


@app.get("/exports/visits.csv")
async def export_visits_csv(
    range: str = Query(default="all", pattern="^(today|7d|30d|month|all)$"),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    visits = await repo.list_patient_visits(str(current_user.org_id))
    patients = await repo.list_patients(str(current_user.org_id))
    history_rows = build_history_visit_rows(visits, patients)
    try:
        start_at = get_export_range_start(range)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    filtered_rows = filter_rows_by_created_at([row.model_dump() for row in history_rows], start_at)
    return build_csv_response(
        "patient_visits.csv",
        filtered_rows,
        [
            "name",
            "phone",
            "reason",
            "age",
            "weight",
            "height",
            "source",
            "status",
            "billed",
            "created_at",
            "last_visit_at",
        ],
    )


@app.get("/exports/invoices.csv")
async def export_invoices_csv(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    invoices = await repo.list_invoices(str(current_user.org_id))
    patients = await repo.list_patients(str(current_user.org_id))
    patient_names = {str(patient.get("id")): patient.get("name", "") for patient in patients}
    rows: list[dict] = []
    for invoice in invoices:
        rows.append(
            {
                "patient_name": patient_names.get(str(invoice.get("patient_id")), ""),
                "payment_status": invoice.get("payment_status"),
                "amount_paid": invoice.get("amount_paid"),
                "balance_due": invoice.get("balance_due"),
                "total": invoice.get("total"),
                "paid_at": invoice.get("paid_at"),
                "sent_at": invoice.get("sent_at"),
                "created_at": invoice.get("created_at"),
                "item_count": len(invoice.get("items", [])),
            }
        )
    return build_csv_response(
        "invoices.csv",
        rows,
        [
            "patient_name",
            "payment_status",
            "amount_paid",
            "balance_due",
            "total",
            "paid_at",
            "sent_at",
            "created_at",
            "item_count",
        ],
    )


@app.post("/generate-note-pdf")
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
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/notes/{note_id}/pdf")
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
    current_user: UserOut = Depends(require_admin),
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
