from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.db import AppRepository, get_repository
from app.schema_domains.attachments import PatientAttachmentOut
from app.schema_domains.auth_settings import UserOut
from app.storage import PatientAttachmentStorage, get_patient_attachment_storage


router = APIRouter()

ALLOWED_PATIENT_ATTACHMENT_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/webm",
}
ALLOWED_PATIENT_ATTACHMENT_EXTENSIONS = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}
MAX_PATIENT_ATTACHMENT_BYTES = 50 * 1024 * 1024


def _resolve_attachment_content_type(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").strip().lower()
    if content_type in ALLOWED_PATIENT_ATTACHMENT_TYPES:
        return content_type
    extension = Path(upload.filename or "").suffix.lower()
    if extension in ALLOWED_PATIENT_ATTACHMENT_EXTENSIONS:
        return ALLOWED_PATIENT_ATTACHMENT_EXTENSIONS[extension]
    raise HTTPException(status_code=400, detail="Only MP4, MOV, and WEBM videos are supported for patient media.")


@router.get("/patients/{patient_id}/attachments", response_model=list[PatientAttachmentOut])
async def list_patient_attachments(
    patient_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> list[PatientAttachmentOut]:
    try:
        rows = await repo.list_patient_attachments(str(current_user.org_id), patient_id)
        return [PatientAttachmentOut(**row) for row in rows]
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_patient_attachments") from exc


@router.post("/patients/{patient_id}/attachments", response_model=PatientAttachmentOut, status_code=201)
async def upload_patient_attachment(
    patient_id: str,
    file: UploadFile = File(...),
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
) -> PatientAttachmentOut:
    content_type = _resolve_attachment_content_type(file)
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Attachment file is empty.")
    if len(raw_bytes) > MAX_PATIENT_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="Attachment must be 50 MB or smaller.")
    try:
        row = await repo.prepare_patient_attachment_metadata(
            str(current_user.org_id),
            patient_id,
            uploaded_by=str(current_user.id),
            filename=(file.filename or "attachment").strip() or "attachment",
            content_type=content_type,
            file_size=len(raw_bytes),
        )
        await storage.upload(str(row["storage_path"]), raw_bytes, content_type)
        saved = await repo.create_patient_attachment_metadata(row)
        return PatientAttachmentOut(**saved)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="upload_patient_attachment") from exc


@router.get("/attachments/{attachment_id}/file")
async def download_patient_attachment(
    attachment_id: str,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
) -> StreamingResponse:
    try:
        row = await repo.get_patient_attachment(str(current_user.org_id), attachment_id)
        if not row:
            raise ValueError("Attachment not found for this organization.")
        raw_bytes = await storage.download(str(row["storage_path"]))
        return StreamingResponse(
            iter([raw_bytes]),
            media_type=str(row.get("content_type") or "application/octet-stream"),
            headers={"Content-Disposition": f'inline; filename="{row.get("file_name") or "attachment"}"'},
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="download_patient_attachment") from exc
