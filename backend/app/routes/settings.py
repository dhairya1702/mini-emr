from base64 import b64decode, b64encode
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.api_errors import internal_server_error
from app.auth import get_current_user, require_admin
from app.db import AppRepository, get_repository
from app.file_validation import validate_pdf_bytes
from app.schema_domains.auth_settings import ClinicSettingsOut, ClinicSettingsUpdate, UserOut
from app.services.pdf_service import TemplateConfigurationError, build_template_note_preview_pdf


router = APIRouter()
ALLOWED_TEMPLATE_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}
ALLOWED_TEMPLATE_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}
MAX_TEMPLATE_BYTES = 10 * 1024 * 1024


async def _frontend_clinic_settings(repo: AppRepository, org_id: str) -> dict:
    getter = getattr(repo, "get_clinic_frontend_settings", None)
    if callable(getter):
        return await getter(org_id)
    return await repo.get_clinic_settings(org_id)


async def _platform_email_availability(repo: AppRepository) -> dict:
    getter = getattr(repo, "get_platform_email_availability", None)
    if callable(getter):
        return await getter()
    return await repo.get_platform_email_settings()


def _serialize_clinic_settings(settings_row: dict, platform_email_settings: dict | None = None) -> ClinicSettingsOut:
    nil_uuid = UUID("00000000-0000-0000-0000-000000000000")
    defaults = ClinicSettingsOut.model_construct(id=nil_uuid, org_id=nil_uuid).model_dump()
    row = {**defaults, **{key: value for key, value in dict(settings_row).items() if value is not None}}
    template_configured = settings_row.get("document_template_configured")
    has_template = bool(
        row.get("document_template_name")
        and (
            template_configured
            if template_configured is not None
            else settings_row.get("document_template_data_base64")
        )
    )
    row["document_template_url"] = "/settings/clinic/document-template/file" if has_template else None
    row["doctor_name"] = row.get("doctor_name") or ""
    clinic_password_configured = settings_row.get("clinic_email_password_configured")
    clinic_email_configured = bool(
        str(settings_row.get("sender_email") or "").strip()
        and (
            clinic_password_configured
            if clinic_password_configured is not None
            else str(settings_row.get("sender_email_app_password") or "").strip()
        )
    )
    platform_email_settings = platform_email_settings or {}
    clinicos_email_available = bool(
        platform_email_settings.get("is_enabled")
        and str(platform_email_settings.get("sender_email") or "").strip()
        and (
            platform_email_settings.get("credential_configured")
            if platform_email_settings.get("credential_configured") is not None
            else str(platform_email_settings.get("sender_email_app_password") or "").strip()
        )
    )
    mode = str(row.get("email_sender_mode") or "clinicos")
    row["clinic_email_configured"] = clinic_email_configured
    row["clinicos_email_available"] = clinicos_email_available
    row["email_configured"] = clinic_email_configured if mode == "clinic" else clinicos_email_available
    row.pop("sender_email_app_password", None)
    return ClinicSettingsOut(**row)


def _resolve_template_content_type(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").strip().lower()
    if content_type in ALLOWED_TEMPLATE_CONTENT_TYPES:
        return content_type

    extension = Path(upload.filename or "").suffix.lower()
    if extension in ALLOWED_TEMPLATE_EXTENSIONS:
        return ALLOWED_TEMPLATE_EXTENSIONS[extension]

    raise HTTPException(status_code=400, detail="Template must be a PDF, JPG, or PNG file.")


def _has_required_onboarding(settings_row: dict) -> bool:
    return bool(
        settings_row.get("clinic_specialty")
        and settings_row.get("timezone")
        and settings_row.get("appointment_start_time")
        and settings_row.get("appointment_end_time")
        and int(settings_row.get("appointments_per_hour") or 0) > 0
    )


@router.get("/settings/clinic", response_model=ClinicSettingsOut)
async def get_clinic_settings(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        settings_row = await _frontend_clinic_settings(repo, str(current_user.org_id))
        if not settings_row:
            settings_row = await repo.upsert_clinic_settings(
                str(current_user.org_id),
                ClinicSettingsUpdate(),
            )
        settings_row["doctor_name"] = current_user.name or str(settings_row.get("doctor_name") or "")
        return _serialize_clinic_settings(settings_row, await _platform_email_availability(repo))
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_clinic_settings") from exc


@router.put("/settings/clinic", response_model=ClinicSettingsOut)
async def update_clinic_settings(
    payload: ClinicSettingsUpdate,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> ClinicSettingsOut:
    if {"workspace_mode", "users_allowed"} & payload.model_fields_set:
        raise HTTPException(status_code=403, detail="Workspace mode and user limits are managed by ClinicOS Ops.")
    try:
        if (
            "email_sender_mode" not in payload.model_fields_set
            and {"sender_email", "sender_email_app_password"} & payload.model_fields_set
        ):
            payload = payload.model_copy(update={"email_sender_mode": "clinic"})
        saved = await repo.upsert_clinic_settings(
            str(current_user.org_id),
            payload.model_copy(update={"doctor_name": None}),
        )
        saved["doctor_name"] = current_user.name or str(saved.get("doctor_name") or "")
        return _serialize_clinic_settings(saved, await _platform_email_availability(repo))
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="update_clinic_settings") from exc


@router.post("/settings/clinic/onboarding/complete", response_model=ClinicSettingsOut)
async def complete_clinic_onboarding(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> ClinicSettingsOut:
    try:
        settings_row = await repo.get_clinic_settings(str(current_user.org_id))
        if not settings_row or not _has_required_onboarding(settings_row):
            raise HTTPException(status_code=400, detail="Complete specialty and clinic hours before entering the workspace.")
        saved = await repo.upsert_clinic_settings(
            str(current_user.org_id),
            ClinicSettingsUpdate(
                onboarding_required=True,
                onboarding_completed_at=datetime.now(UTC),
            ),
        )
        saved["doctor_name"] = current_user.name or str(saved.get("doctor_name") or "")
        return _serialize_clinic_settings(saved, await _platform_email_availability(repo))
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="complete_clinic_onboarding") from exc


@router.post("/settings/clinic/document-template", response_model=ClinicSettingsOut)
async def upload_clinic_template(
    file: UploadFile = File(...),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> ClinicSettingsOut:
    content_type = _resolve_template_content_type(file)
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Template file is empty.")
    if len(raw_bytes) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="Template file must be 10 MB or smaller.")
    if content_type == "application/pdf":
        try:
            validate_pdf_bytes(raw_bytes)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        saved = await repo.set_clinic_document_template(
            str(current_user.org_id),
            filename=(file.filename or "clinic-template").strip() or "clinic-template",
            content_type=content_type,
            data_base64=b64encode(raw_bytes).decode("ascii"),
        )
        saved["doctor_name"] = current_user.name or str(saved.get("doctor_name") or "")
        return _serialize_clinic_settings(saved, await _platform_email_availability(repo))
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="upload_clinic_template") from exc


@router.get("/settings/clinic/document-template/file")
async def download_clinic_template(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> StreamingResponse:
    try:
        settings_row = await repo.get_clinic_settings(str(current_user.org_id))
        filename = str(settings_row.get("document_template_name") or "").strip()
        encoded = str(settings_row.get("document_template_data_base64") or "").strip()
        content_type = str(settings_row.get("document_template_content_type") or "application/octet-stream").strip()
        if not filename or not encoded:
            raise HTTPException(status_code=404, detail="No clinic document template found.")
        raw_bytes = b64decode(encoded)
        return StreamingResponse(
            iter([raw_bytes]),
            media_type=content_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="download_clinic_template") from exc


@router.get("/settings/clinic/document-template/preview-note")
async def preview_clinic_template_note(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> StreamingResponse:
    try:
        settings_row = await repo.get_clinic_settings(str(current_user.org_id))
        user_row = await repo.get_user(str(current_user.id))
        preview_context = {
            **settings_row,
            "doctor_name": current_user.name or str(settings_row.get("doctor_name") or ""),
            "doctor_signature_name": user_row.get("doctor_signature_name"),
            "doctor_signature_content_type": user_row.get("doctor_signature_content_type"),
            "doctor_signature_data_base64": user_row.get("doctor_signature_data_base64"),
        }
        pdf_bytes = build_template_note_preview_pdf(preview_context)
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="document-template-note-preview.pdf"'},
        )
    except TemplateConfigurationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="preview_clinic_template_note") from exc


@router.delete("/settings/clinic/document-template", response_model=ClinicSettingsOut)
async def delete_clinic_template(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> ClinicSettingsOut:
    try:
        saved = await repo.clear_clinic_document_template(str(current_user.org_id))
        saved["doctor_name"] = current_user.name or str(saved.get("doctor_name") or "")
        return _serialize_clinic_settings(saved, await _platform_email_availability(repo))
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="delete_clinic_template") from exc
