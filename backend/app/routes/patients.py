from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.db import SupabaseRepository, get_repository
from app.exports import build_history_visit_rows
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import InvoiceOut
from app.schema_domains.case_studies import PatientCaseStudySourceOut
from app.schema_domains.optometry import MyopiaHistoryOut, MyopiaMeasurementCreate, MyopiaMeasurementOut, MyopiaMeasurementUpdate
from app.schema_domains.patients import (
    NoteOut,
    PatientCreate,
    PatientMatchOut,
    PatientOut,
    PatientTimelineEvent,
    PatientUpdate,
    PatientVisitCreate,
    PatientVisitOut,
)
from app.schema_domains.specialty import (
    LongitudinalTrackCreate,
    PediatricGrowthMeasurementInput,
    PediatricGrowthMeasurementOut,
    PediatricGrowthSummaryOut,
)
from app.services.case_study_workflow import build_case_study_source_view
from app.services.patient_views import (
    build_patient_growth_history_view,
    build_patient_myopia_history_view,
    build_patient_timeline_view,
    list_patient_invoices_view,
    list_patient_notes_view,
)
from app.services.patient_workflow import (
    create_patient_workflow,
    record_patient_visit_workflow,
    update_patient_workflow,
)


router = APIRouter()


@router.get("/patients", response_model=list[PatientOut])
async def get_patients(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientOut]:
    try:
        rows = await repo.list_patients(str(current_user.org_id))
        return [PatientOut(**row) for row in rows]
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/visits", response_model=list[PatientVisitOut])
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


@router.get("/patients/lookup", response_model=list[PatientMatchOut])
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


@router.post("/patients", response_model=PatientOut, status_code=201)
async def create_patient(
    payload: PatientCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        return await create_patient_workflow(repo, current_user, payload)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/patients/{patient_id}/visits", response_model=PatientOut)
async def create_patient_visit(
    patient_id: str,
    payload: PatientVisitCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        return await record_patient_visit_workflow(repo, current_user, patient_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/patients/{patient_id}", response_model=PatientOut)
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
        return await update_patient_workflow(repo, current_user, patient_id, payload)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/patients/{patient_id}/timeline", response_model=list[PatientTimelineEvent])
async def get_patient_timeline(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientTimelineEvent]:
    try:
        return await build_patient_timeline_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/patients/{patient_id}/myopia-history", response_model=MyopiaHistoryOut)
async def get_patient_myopia_history(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> MyopiaHistoryOut:
    try:
        return await build_patient_myopia_history_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/patients/{patient_id}/growth-history", response_model=PediatricGrowthSummaryOut)
async def get_patient_growth_history(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PediatricGrowthSummaryOut:
    try:
        return await build_patient_growth_history_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/patients/{patient_id}/growth-records", response_model=PediatricGrowthMeasurementOut, status_code=201)
async def create_patient_growth_record(
    patient_id: str,
    payload: PediatricGrowthMeasurementInput,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PediatricGrowthMeasurementOut:
    try:
        height_cm = round(float(payload.height_cm), 2)
        weight_kg = round(float(payload.weight_kg), 2)
        bmi = round(weight_kg / ((height_cm / 100) ** 2), 2)
        track = await repo.create_longitudinal_track(
            str(current_user.org_id),
            patient_id,
            LongitudinalTrackCreate(
                track_type="growth_measurement",
                measured_at=payload.measured_at,
                summary_fields={"height_cm": height_cm, "weight_kg": weight_kg},
                raw_payload=payload.model_dump(mode="json"),
                derived_metrics={"bmi": bmi},
            ),
        )
        history = await build_patient_growth_history_view(repo, str(current_user.org_id), patient_id)
        return history.records[-1]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/patients/{patient_id}/growth-records/{record_id}", response_model=PediatricGrowthMeasurementOut)
async def update_patient_growth_record(
    patient_id: str,
    record_id: str,
    payload: PediatricGrowthMeasurementInput,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PediatricGrowthMeasurementOut:
    try:
        height_cm = round(float(payload.height_cm), 2)
        weight_kg = round(float(payload.weight_kg), 2)
        bmi = round(weight_kg / ((height_cm / 100) ** 2), 2)
        await repo.update_longitudinal_track(
            str(current_user.org_id),
            patient_id,
            record_id,
            {
                "measured_at": payload.measured_at,
                "summary_fields": {"height_cm": height_cm, "weight_kg": weight_kg},
                "raw_payload": payload.model_dump(mode="json"),
                "derived_metrics": {"bmi": bmi},
            },
        )
        history = await build_patient_growth_history_view(repo, str(current_user.org_id), patient_id)
        updated = next((record for record in history.records if record.track_id == record_id), None)
        if not updated:
            raise ValueError("Growth record not found for this patient.")
        return updated
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/patients/{patient_id}/myopia-records", response_model=MyopiaMeasurementOut, status_code=201)
async def create_patient_myopia_record(
    patient_id: str,
    payload: MyopiaMeasurementCreate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> MyopiaMeasurementOut:
    try:
        row = await repo.create_myopia_measurement(str(current_user.org_id), patient_id, payload)
        return MyopiaMeasurementOut(**row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/patients/{patient_id}/myopia-records/{record_id}", response_model=MyopiaMeasurementOut)
async def update_patient_myopia_record(
    patient_id: str,
    record_id: str,
    payload: MyopiaMeasurementUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> MyopiaMeasurementOut:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided.")
    try:
        row = await repo.update_myopia_measurement(str(current_user.org_id), patient_id, record_id, updates)
        return MyopiaMeasurementOut(**row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/patients/{patient_id}/notes", response_model=list[NoteOut])
async def list_patient_notes(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[NoteOut]:
    try:
        return await list_patient_notes_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/patients/{patient_id}/case-study-source", response_model=PatientCaseStudySourceOut)
async def get_patient_case_study_source(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientCaseStudySourceOut:
    try:
        return await build_case_study_source_view(repo, str(current_user.org_id), patient_id, anonymized=False)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/patients/{patient_id}/invoices", response_model=list[InvoiceOut])
async def list_patient_invoices(
    patient_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[InvoiceOut]:
    try:
        return await list_patient_invoices_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
