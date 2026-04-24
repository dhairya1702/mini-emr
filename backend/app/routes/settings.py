from base64 import b64decode, b64encode
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.auth import get_current_user
from app.db import SupabaseRepository, get_repository
from app.schemas import ClinicSettingsOut, ClinicSettingsUpdate, UserOut


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


def _serialize_clinic_settings(settings_row: dict) -> ClinicSettingsOut:
    nil_uuid = UUID("00000000-0000-0000-0000-000000000000")
    defaults = ClinicSettingsOut.model_construct(id=nil_uuid, org_id=nil_uuid).model_dump()
    row = {**defaults, **{key: value for key, value in dict(settings_row).items() if value is not None}}
    has_template = bool(row.get("document_template_name") and settings_row.get("document_template_data_base64"))
    row["document_template_url"] = "/settings/clinic/document-template/file" if has_template else None
    row["email_configured"] = bool(
        str(settings_row.get("sender_email") or "").strip()
        and str(settings_row.get("sender_email_app_password") or "").strip()
    )
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


@router.get("/settings/clinic", response_model=ClinicSettingsOut)
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
        return _serialize_clinic_settings(settings_row)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/settings/clinic", response_model=ClinicSettingsOut)
async def update_clinic_settings(
    payload: ClinicSettingsUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        saved = await repo.upsert_clinic_settings(str(current_user.org_id), payload)
        return _serialize_clinic_settings(saved)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/settings/clinic/document-template", response_model=ClinicSettingsOut)
async def upload_clinic_template(
    file: UploadFile = File(...),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    content_type = _resolve_template_content_type(file)
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Template file is empty.")
    if len(raw_bytes) > MAX_TEMPLATE_BYTES:
        raise HTTPException(status_code=400, detail="Template file must be 10 MB or smaller.")

    try:
        saved = await repo.set_clinic_document_template(
            str(current_user.org_id),
            filename=(file.filename or "clinic-template").strip() or "clinic-template",
            content_type=content_type,
            data_base64=b64encode(raw_bytes).decode("ascii"),
        )
        return _serialize_clinic_settings(saved)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/settings/clinic/document-template/file")
async def download_clinic_template(
    repo: SupabaseRepository = Depends(get_repository),
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
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/settings/clinic/document-template", response_model=ClinicSettingsOut)
async def delete_clinic_template(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        saved = await repo.clear_clinic_document_template(str(current_user.org_id))
        return _serialize_clinic_settings(saved)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
