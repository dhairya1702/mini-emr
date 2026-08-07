from pathlib import Path
from io import BytesIO
from uuid import uuid4
from PIL import Image

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.db import AppRepository, get_repository
from app.exports import build_history_visit_rows
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import InvoiceOut
from app.schema_domains.case_studies import PatientCaseStudySourceOut
from app.schema_domains.common import PatientStatus
from app.schema_domains.optometry import (
    MyopiaHistoryOut,
    MyopiaMeasurementCreate,
    MyopiaMeasurementOut,
    MyopiaMeasurementUpdate,
    OptometryHistoryOut,
    OptometryHistoryPayload,
    OptometryHistoryUpdate,
)
from app.schema_domains.patients import (
    NoteOut,
    PatientChartVisitOut,
    PatientCreate,
    PatientVisitDetailOut,
    PatientMatchOut,
    PatientOut,
    QueueOrderUpdate,
    PatientSummaryOut,
    PatientTimelineEvent,
    PatientUpdate,
    PatientVisitCreate,
    PatientVisitOut,
)
from app.schema_domains.specialty import (
    BinocularVisionEvaluationInput,
    BinocularVisionEvaluationOut,
    LongitudinalTrackCreate,
    LongitudinalTrackRecordOut,
    PediatricGrowthMeasurementInput,
    PediatricGrowthMeasurementOut,
    PediatricGrowthSummaryOut,
    TbiEvaluationInput,
    TbiEvaluationOut,
)
from app.services.case_study_workflow import build_case_study_source_view
from app.services.patient_summary_workflow import generate_patient_summary_workflow, load_or_generate_patient_summary_workflow
from app.services.patient_views import (
    build_patient_visit_detail_view,
    build_patient_growth_history_view,
    build_patient_myopia_history_view,
    build_patient_timeline_view,
    list_patient_tbi_evaluations_view,
    list_patient_binocular_vision_evaluations_view,
    list_patient_invoices_view,
    list_patient_chart_visits_view,
    list_patient_notes_view,
)
from app.services.patient_workflow import (
    create_patient_workflow,
    record_patient_visit_workflow,
    update_patient_workflow,
)
from app.services.auth_flow import enforce_repository_rate_limit
from app.services.audit_service import write_audit_event_best_effort
from app.storage import PatientAttachmentStorage, get_patient_attachment_storage


router = APIRouter()

ALLOWED_PATIENT_PROFILE_PHOTO_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
ALLOWED_PATIENT_PROFILE_PHOTO_EXTENSIONS = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
MAX_PATIENT_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024

SPECIALTY_MODULE_TRACKS = {
    "optometry": {
        "eye_exam",
        "contact_lens",
        "binocular_vision",
        "low_vision",
        "myopia_management",
        "tbi_evaluation",
    },
    "pediatrics": {
        "pediatric_growth_measurement",
        "well_child_visit",
        "parent_handout_request",
        "pediatric_follow_up_plan",
    },
    "general_physician": set(),
    "dentistry": set(),
}


async def _require_optometry_clinic(repo: AppRepository, org_id: str) -> None:
    settings = await repo.get_clinic_settings(org_id)
    if str(settings.get("clinic_specialty") or "").strip() != "optometry":
        raise ValueError("This optometry evaluation is only available for optometry clinics.")


async def _require_specialty_module(repo: AppRepository, org_id: str, module_type: str) -> None:
    settings = await repo.get_clinic_settings(org_id)
    clinic_specialty = str(settings.get("clinic_specialty") or "").strip()
    if module_type not in SPECIALTY_MODULE_TRACKS.get(clinic_specialty, set()):
        raise ValueError("This module is not available for the clinic specialty.")


def _tbi_summary_fields(payload: dict) -> dict:
    visual_acuity = payload.get("visual_acuity") if isinstance(payload.get("visual_acuity"), dict) else {}
    final_comments = str(payload.get("final_comments") or "").strip()
    management = str(payload.get("management_and_therapy_options") or "").strip()
    unaided = visual_acuity.get("unaided") if isinstance(visual_acuity.get("unaided"), dict) else {}
    summary_bits = []
    if any(str(unaided.get(eye) or "").strip() for eye in ("od", "os", "ou")):
        summary_bits.append(
            "Unaided VA "
            + " · ".join(
                f"{eye.upper()} {str(unaided.get(eye) or '').strip() or '-'}"
                for eye in ("od", "os", "ou")
            )
        )
    if final_comments:
        summary_bits.append(final_comments[:140])
    elif management:
        summary_bits.append(management[:140])
    return {"summary": " · ".join(summary_bits) or "Neurovision / TBI evaluation saved."}


def _value_at(payload: dict, *path: str) -> str:
    current = payload
    for part in path:
        if not isinstance(current, dict):
            return ""
        current = current.get(part)
    return str(current or "").strip() if current is not None else ""


def _binocular_vision_summary_fields(payload: dict) -> dict:
    summary_bits = [
        _value_at(payload, "impression"),
        _value_at(payload, "history", "main_complaints"),
        (
            f"NPC {_value_at(payload, 'motor_evaluation', 'npc_accommodative_target', 'objective')}"
            if _value_at(payload, "motor_evaluation", "npc_accommodative_target", "objective")
            else ""
        ),
        (
            f"Stereo N {_value_at(payload, 'sensory_evaluation', 'stereopsis', 'near')}"
            if _value_at(payload, "sensory_evaluation", "stereopsis", "near")
            else ""
        ),
    ]
    summary = " · ".join(bit[:140] for bit in summary_bits if bit)
    return {"summary": summary or "Binocular vision evaluation saved."}


def _resolve_profile_photo_content_type(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").strip().lower()
    if content_type in ALLOWED_PATIENT_PROFILE_PHOTO_TYPES:
        return content_type
    extension = Path(upload.filename or "").suffix.lower()
    if extension in ALLOWED_PATIENT_PROFILE_PHOTO_EXTENSIONS:
        return ALLOWED_PATIENT_PROFILE_PHOTO_EXTENSIONS[extension]
    raise HTTPException(status_code=400, detail="Only JPG, PNG, and WEBP patient photos are supported.")


def _profile_photo_extension(content_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }.get(content_type, ".jpg")


@router.get("/patients", response_model=list[PatientOut])
async def get_patients(
    active_only: bool = Query(default=False),
    status: PatientStatus | None = Query(default=None),
    billed: bool | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientOut]:
    try:
        rows = await repo.list_patients(
            str(current_user.org_id),
            active_only=active_only,
            status=status,
            billed=billed,
            query=q,
            limit=limit,
            offset=offset,
        )
        return [PatientOut(**row) for row in rows]
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patients") from exc


@router.get("/visits", response_model=list[PatientVisitOut])
async def get_patient_visits(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientVisitOut]:
    try:
        visits = await repo.list_patient_visits(str(current_user.org_id))
        patients = await repo.list_patients(str(current_user.org_id))
        return build_history_visit_rows(visits, patients)
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_visits") from exc


@router.get("/patients/lookup", response_model=list[PatientMatchOut])
async def lookup_patients_by_phone(
    phone: str = Query(min_length=6, max_length=30),
    limit: int = Query(default=10, ge=1, le=25),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientMatchOut]:
    try:
        matches = await repo.list_patient_matches_by_phone(str(current_user.org_id), phone, limit=limit)
        return [PatientMatchOut(**match) for match in matches]
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="lookup_patients_by_phone") from exc


@router.post("/patients", response_model=PatientOut, status_code=201)
async def create_patient(
    payload: PatientCreate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        return await create_patient_workflow(repo, current_user, payload)
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient") from exc


@router.put("/patients/queue/order", response_model=list[PatientOut])
async def update_queue_order(
    payload: QueueOrderUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientOut]:
    try:
        rows = await repo.reorder_queue(
            str(current_user.org_id),
            {
                "waiting": [str(patient_id) for patient_id in payload.columns.waiting],
                "consultation": [str(patient_id) for patient_id in payload.columns.consultation],
                "done": [str(patient_id) for patient_id in payload.columns.done],
            },
            role=current_user.role,
        )
        return [PatientOut(**row) for row in rows]
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_queue_order") from exc


@router.get("/patients/{patient_id}", response_model=PatientOut)
async def get_patient(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        patient = await repo.get_patient(str(current_user.org_id), patient_id)
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient",
            entity_id=patient_id,
            action="patient_record_viewed",
            summary="Viewed a patient record.",
            metadata={},
        )
        return PatientOut(**patient)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient") from exc


@router.post("/patients/{patient_id}/visits", response_model=PatientOut)
async def create_patient_visit(
    patient_id: str,
    payload: PatientVisitCreate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        return await record_patient_visit_workflow(repo, current_user, patient_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient_visit") from exc


@router.get("/patients/{patient_id}/visits", response_model=list[PatientChartVisitOut])
async def list_patient_chart_visits(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientChartVisitOut]:
    try:
        return await list_patient_chart_visits_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_chart_visits") from exc


@router.get("/patients/{patient_id}/visits/{visit_id}/details", response_model=PatientVisitDetailOut)
async def get_patient_visit_detail(
    patient_id: str,
    visit_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientVisitDetailOut:
    try:
        detail = await build_patient_visit_detail_view(repo, str(current_user.org_id), patient_id, visit_id)
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient_visit",
            entity_id=visit_id,
            action="patient_visit_viewed",
            summary="Viewed detailed patient visit information.",
            metadata={"patient_id": patient_id},
        )
        return detail
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_visit_detail") from exc


@router.patch("/patients/{patient_id}", response_model=PatientOut)
async def update_patient(
    patient_id: str,
    payload: PatientUpdate,
    repo: AppRepository = Depends(get_repository),
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
        raise internal_server_error(exc, context="update_patient") from exc


@router.post("/patients/{patient_id}/profile-photo", response_model=PatientOut)
async def upload_patient_profile_photo(
    patient_id: str,
    file: UploadFile = File(...),
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    content_type = _resolve_profile_photo_content_type(file)
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Patient photo file is empty.")
    if len(raw_bytes) > MAX_PATIENT_PROFILE_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Patient photo must be 5 MB or smaller.")
    try:
        image = Image.open(BytesIO(raw_bytes))
        image.verify()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Patient photo is not a valid image.") from exc

    storage_path = ""
    metadata_updated = False
    try:
        existing = await repo.get_patient(str(current_user.org_id), patient_id)
        old_storage_path = str(existing.get("profile_photo_storage_path") or "").strip()
        storage_path = (
            f"{current_user.org_id}/{patient_id}/profile-photo/"
            f"{uuid4()}{_profile_photo_extension(content_type)}"
        )
        await storage.upload(storage_path, raw_bytes, content_type)
        updated = await repo.update_patient_profile_photo(
            str(current_user.org_id),
            patient_id,
            storage_path=storage_path,
            content_type=content_type,
        )
        metadata_updated = True
        if old_storage_path and old_storage_path != storage_path:
            try:
                await storage.delete(old_storage_path)
            except Exception:
                pass
        await repo.create_audit_event(
            org_id=str(current_user.org_id),
            actor_user_id=str(current_user.id),
            actor_name=current_user.name.strip() or current_user.identifier.strip() or "Clinic User",
            entity_type="patient",
            entity_id=patient_id,
            action="patient_profile_photo_uploaded",
            summary=f"Updated profile photo for patient {updated['name']}.",
            metadata={"patient_name": updated.get("name"), "content_type": content_type},
        )
        return PatientOut(**updated)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        if storage_path and not metadata_updated:
            try:
                await storage.delete(storage_path)
            except Exception:
                pass
        raise internal_server_error(exc, context="upload_patient_profile_photo") from exc


@router.get("/patients/{patient_id}/profile-photo/file")
async def download_patient_profile_photo(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
):
    try:
        patient = await repo.get_patient(str(current_user.org_id), patient_id)
        storage_path = str(patient.get("profile_photo_storage_path") or "").strip()
        if not storage_path:
            raise ValueError("Patient photo not found.")
        raw_bytes = await storage.download(storage_path)
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient",
            entity_id=patient_id,
            action="patient_profile_photo_viewed",
            summary="Viewed a patient profile photo.",
            metadata={},
        )
        content_type = str(patient.get("profile_photo_content_type") or "image/jpeg")
        return StreamingResponse(
            iter([raw_bytes]),
            media_type=content_type,
            headers={"Content-Length": str(len(raw_bytes)), "Cache-Control": "private, max-age=300"},
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="download_patient_profile_photo") from exc


@router.delete("/patients/{patient_id}/profile-photo", response_model=PatientOut)
async def delete_patient_profile_photo(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
) -> PatientOut:
    try:
        existing = await repo.get_patient(str(current_user.org_id), patient_id)
        old_storage_path = str(existing.get("profile_photo_storage_path") or "").strip()
        if not old_storage_path:
            raise ValueError("Patient photo not found.")
        updated = await repo.clear_patient_profile_photo(str(current_user.org_id), patient_id)
        await storage.delete(old_storage_path)
        await repo.create_audit_event(
            org_id=str(current_user.org_id),
            actor_user_id=str(current_user.id),
            actor_name=current_user.name.strip() or current_user.identifier.strip() or "Clinic User",
            entity_type="patient",
            entity_id=patient_id,
            action="patient_profile_photo_deleted",
            summary=f"Removed profile photo for patient {updated['name']}.",
            metadata={"patient_name": updated.get("name")},
        )
        return PatientOut(**updated)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="delete_patient_profile_photo") from exc


@router.get("/patients/{patient_id}/timeline", response_model=list[PatientTimelineEvent])
async def get_patient_timeline(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientTimelineEvent]:
    try:
        return await build_patient_timeline_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_timeline") from exc


@router.get("/patients/{patient_id}/summary", response_model=PatientSummaryOut)
async def get_patient_summary(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientSummaryOut:
    try:
        org_id = str(current_user.org_id)
        result = await load_or_generate_patient_summary_workflow(repo, org_id, patient_id)
        return PatientSummaryOut(
            summary=result["summary"],
            updated_at=result["updated_at"],
            stale=False,
            used_fallback=result["used_fallback"],
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_summary") from exc


@router.post("/patients/{patient_id}/summary/regenerate", response_model=PatientSummaryOut)
async def regenerate_patient_summary(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientSummaryOut:
    try:
        org_id = str(current_user.org_id)
        await enforce_repository_rate_limit(repo, "patient_summary", str(current_user.id))
        result = await generate_patient_summary_workflow(repo, org_id, patient_id)
        return PatientSummaryOut(
            summary=result["summary"],
            updated_at=result["updated_at"],
            stale=result["stale"],
            used_fallback=result["used_fallback"],
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="regenerate_patient_summary") from exc


@router.get("/patients/{patient_id}/myopia-history", response_model=MyopiaHistoryOut)
async def get_patient_myopia_history(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> MyopiaHistoryOut:
    try:
        return await build_patient_myopia_history_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_myopia_history") from exc


@router.get("/patients/{patient_id}/growth-history", response_model=PediatricGrowthSummaryOut)
async def get_patient_growth_history(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PediatricGrowthSummaryOut:
    try:
        return await build_patient_growth_history_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_growth_history") from exc


@router.get("/patients/{patient_id}/tbi-evaluations", response_model=list[TbiEvaluationOut])
async def list_patient_tbi_evaluations(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[TbiEvaluationOut]:
    try:
        org_id = str(current_user.org_id)
        await _require_optometry_clinic(repo, org_id)
        return await list_patient_tbi_evaluations_view(repo, org_id, patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_tbi_evaluations") from exc


@router.get("/patients/{patient_id}/binocular-vision-evaluations", response_model=list[BinocularVisionEvaluationOut])
async def list_patient_binocular_vision_evaluations(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[BinocularVisionEvaluationOut]:
    try:
        org_id = str(current_user.org_id)
        await _require_optometry_clinic(repo, org_id)
        return await list_patient_binocular_vision_evaluations_view(repo, org_id, patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_binocular_vision_evaluations") from exc


@router.get("/patients/{patient_id}/module-entries", response_model=list[LongitudinalTrackRecordOut])
async def list_patient_module_entries(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[LongitudinalTrackRecordOut]:
    try:
        rows = await repo.list_longitudinal_tracks_for_patient(str(current_user.org_id), patient_id)
        return [LongitudinalTrackRecordOut.model_validate(row) for row in rows]
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_module_entries") from exc


@router.post("/patients/{patient_id}/module-entries", response_model=LongitudinalTrackRecordOut, status_code=201)
async def create_patient_module_entry(
    patient_id: str,
    payload: LongitudinalTrackCreate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> LongitudinalTrackRecordOut:
    try:
        org_id = str(current_user.org_id)
        await _require_specialty_module(repo, org_id, payload.track_type)
        row = await repo.create_longitudinal_track(org_id, patient_id, payload)
        return LongitudinalTrackRecordOut.model_validate(row)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient_module_entry") from exc


@router.post("/patients/{patient_id}/tbi-evaluations", response_model=TbiEvaluationOut, status_code=201)
async def create_patient_tbi_evaluation(
    patient_id: str,
    payload: TbiEvaluationInput,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> TbiEvaluationOut:
    try:
        org_id = str(current_user.org_id)
        await _require_optometry_clinic(repo, org_id)
        track = await repo.create_longitudinal_track(
            org_id,
            patient_id,
            LongitudinalTrackCreate(
                track_type="tbi_evaluation",
                measured_at=payload.measured_at,
                summary_fields=_tbi_summary_fields(payload.payload),
                raw_payload=payload.payload,
                derived_metrics={},
            ),
        )
        return TbiEvaluationOut(
            id=str(track["id"]),
            org_id=str(track["org_id"]),
            patient_id=str(track["patient_id"]),
            measured_at=track["measured_at"],
            payload=track.get("raw_payload") or {},
            summary_fields=track.get("summary_fields") or {},
            created_at=track["created_at"],
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient_tbi_evaluation") from exc


@router.post("/patients/{patient_id}/binocular-vision-evaluations", response_model=BinocularVisionEvaluationOut, status_code=201)
async def create_patient_binocular_vision_evaluation(
    patient_id: str,
    payload: BinocularVisionEvaluationInput,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> BinocularVisionEvaluationOut:
    try:
        org_id = str(current_user.org_id)
        await _require_optometry_clinic(repo, org_id)
        track = await repo.create_longitudinal_track(
            org_id,
            patient_id,
            LongitudinalTrackCreate(
                track_type="binocular_vision",
                measured_at=payload.measured_at,
                summary_fields=_binocular_vision_summary_fields(payload.payload),
                raw_payload=payload.payload,
                derived_metrics={},
            ),
        )
        return BinocularVisionEvaluationOut(
            id=str(track["id"]),
            org_id=str(track["org_id"]),
            patient_id=str(track["patient_id"]),
            measured_at=track["measured_at"],
            payload=track.get("raw_payload") or {},
            summary_fields=track.get("summary_fields") or {},
            created_at=track["created_at"],
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient_binocular_vision_evaluation") from exc


@router.post("/patients/{patient_id}/growth-records", response_model=PediatricGrowthMeasurementOut, status_code=201)
async def create_patient_growth_record(
    patient_id: str,
    payload: PediatricGrowthMeasurementInput,
    repo: AppRepository = Depends(get_repository),
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
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient_growth_record") from exc


@router.patch("/patients/{patient_id}/growth-records/{record_id}", response_model=PediatricGrowthMeasurementOut)
async def update_patient_growth_record(
    patient_id: str,
    record_id: str,
    payload: PediatricGrowthMeasurementInput,
    repo: AppRepository = Depends(get_repository),
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
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_patient_growth_record") from exc


@router.post("/patients/{patient_id}/myopia-records", response_model=MyopiaMeasurementOut, status_code=201)
async def create_patient_myopia_record(
    patient_id: str,
    payload: MyopiaMeasurementCreate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> MyopiaMeasurementOut:
    try:
        row = await repo.create_myopia_measurement(str(current_user.org_id), patient_id, payload)
        return MyopiaMeasurementOut(**row)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="create_patient_myopia_record") from exc


@router.patch("/patients/{patient_id}/myopia-records/{record_id}", response_model=MyopiaMeasurementOut)
async def update_patient_myopia_record(
    patient_id: str,
    record_id: str,
    payload: MyopiaMeasurementUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> MyopiaMeasurementOut:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided.")
    try:
        row = await repo.update_myopia_measurement(str(current_user.org_id), patient_id, record_id, updates)
        return MyopiaMeasurementOut(**row)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_patient_myopia_record") from exc


@router.get("/patients/{patient_id}/notes", response_model=list[NoteOut])
async def list_patient_notes(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[NoteOut]:
    try:
        return await list_patient_notes_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_notes") from exc


@router.get(
    "/patients/{patient_id}/optometry-history",
    response_model=OptometryHistoryOut,
)
async def get_patient_optometry_history(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> OptometryHistoryOut:
    org_id = str(current_user.org_id)
    try:
        await _require_optometry_clinic(repo, org_id)
        patient = await repo.get_patient(org_id, patient_id)
        current_visit_id = str(patient.get("current_visit_id") or "") or None
        row = await repo.get_optometry_history(org_id, patient_id, current_visit_id)
        if not row:
            return OptometryHistoryOut(
                patient_id=patient["id"],
                visit_id=current_visit_id,
                payload=OptometryHistoryPayload(),
            )
        return OptometryHistoryOut(exists=True, **row)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_optometry_history") from exc


@router.put(
    "/patients/{patient_id}/optometry-history",
    response_model=OptometryHistoryOut,
)
async def save_patient_optometry_history(
    patient_id: str,
    payload: OptometryHistoryUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> OptometryHistoryOut:
    org_id = str(current_user.org_id)
    try:
        await _require_optometry_clinic(repo, org_id)
        patient = await repo.get_patient(org_id, patient_id)
        current_visit_id = str(patient.get("current_visit_id") or "") or None
        saved = await repo.save_optometry_history(
            org_id=org_id,
            patient_id=patient_id,
            visit_id=current_visit_id,
            updated_by=str(current_user.id),
            expected_revision=payload.expected_revision,
            payload=payload.payload.model_dump(mode="json"),
        )
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient",
            entity_id=patient_id,
            action="optometry_history_updated",
            summary="Updated optometry details for a patient.",
            metadata={"revision": saved.get("revision")},
        )
        return OptometryHistoryOut(exists=True, **saved)
    except ValueError as exc:
        message = str(exc)
        if message.startswith("OPTOMETRY_HISTORY_REVISION_CONFLICT:"):
            current_revision = message.partition(":")[2]
            raise HTTPException(
                status_code=409,
                detail=(
                    "These details were updated elsewhere. "
                    f"Reload the latest version (revision {current_revision}) before saving."
                ),
            ) from exc
        raise bad_request_error(exc) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="save_patient_optometry_history") from exc


@router.get(
    "/patients/{patient_id}/visits/{visit_id}/optometry-history",
    response_model=OptometryHistoryOut,
)
async def get_patient_visit_optometry_history(
    patient_id: str,
    visit_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> OptometryHistoryOut:
    org_id = str(current_user.org_id)
    try:
        await _require_optometry_clinic(repo, org_id)
        visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
        if not any(str(visit["id"]) == visit_id for visit in visits):
            raise ValueError("Visit not found for this patient.")
        row = await repo.get_optometry_history(org_id, patient_id, visit_id)
        if not row:
            return OptometryHistoryOut(
                patient_id=patient_id,
                visit_id=visit_id,
                payload=OptometryHistoryPayload(),
            )
        return OptometryHistoryOut(exists=True, **row)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_visit_optometry_history") from exc


@router.put(
    "/patients/{patient_id}/visits/{visit_id}/optometry-history",
    response_model=OptometryHistoryOut,
)
async def save_patient_visit_optometry_history(
    patient_id: str,
    visit_id: str,
    payload: OptometryHistoryUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> OptometryHistoryOut:
    org_id = str(current_user.org_id)
    try:
        await _require_optometry_clinic(repo, org_id)
        saved = await repo.save_optometry_history(
            org_id=org_id,
            patient_id=patient_id,
            visit_id=visit_id,
            updated_by=str(current_user.id),
            expected_revision=payload.expected_revision,
            payload=payload.payload.model_dump(mode="json"),
        )
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient_visit",
            entity_id=visit_id,
            action="optometry_history_updated",
            summary="Updated optometry history for a patient visit.",
            metadata={"patient_id": patient_id, "revision": saved.get("revision")},
        )
        return OptometryHistoryOut(exists=True, **saved)
    except ValueError as exc:
        message = str(exc)
        if message.startswith("OPTOMETRY_HISTORY_REVISION_CONFLICT:"):
            current_revision = message.partition(":")[2]
            raise HTTPException(
                status_code=409,
                detail=(
                    "This visit history was updated elsewhere. "
                    f"Reload the latest version (revision {current_revision}) before saving."
                ),
            ) from exc
        raise bad_request_error(exc) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="save_patient_visit_optometry_history") from exc


@router.get("/patients/{patient_id}/case-study-source", response_model=PatientCaseStudySourceOut)
async def get_patient_case_study_source(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> PatientCaseStudySourceOut:
    try:
        source = await build_case_study_source_view(repo, str(current_user.org_id), patient_id, anonymized=False)
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient",
            entity_id=patient_id,
            action="case_study_source_viewed",
            summary="Viewed patient data prepared for a case study.",
            metadata={},
        )
        return source
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_patient_case_study_source") from exc


@router.get("/patients/{patient_id}/invoices", response_model=list[InvoiceOut])
async def list_patient_invoices(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[InvoiceOut]:
    try:
        return await list_patient_invoices_view(repo, str(current_user.org_id), patient_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_invoices") from exc
