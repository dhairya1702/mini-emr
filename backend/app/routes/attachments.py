from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user
from app.db import AppRepository, get_repository
from app.file_validation import validate_pdf_bytes
from app.schema_domains.attachments import (
    PatientAttachmentOut,
    SendPatientAttachmentRequest,
    SendPatientAttachmentResponse,
)
from app.schema_domains.auth_settings import UserOut
from app.services.audit_service import write_audit_event, write_audit_event_best_effort
from app.services.document_helpers import build_document_context_for_user
from app.services.email_service import EmailDeliveryError, send_clinic_email_message
from app.storage import PatientAttachmentStorage, get_patient_attachment_storage


router = APIRouter()

ALLOWED_PATIENT_ATTACHMENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "video/mp4",
    "video/quicktime",
    "video/webm",
}
ALLOWED_PATIENT_ATTACHMENT_EXTENSIONS = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}
MAX_PATIENT_ATTACHMENT_BYTES = 50 * 1024 * 1024


def _content_matches_type(raw_bytes: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg":
        return raw_bytes.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return raw_bytes.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return raw_bytes.startswith(b"RIFF") and raw_bytes[8:12] == b"WEBP"
    if content_type == "application/pdf":
        return raw_bytes.startswith(b"%PDF-")
    if content_type in {"video/mp4", "video/quicktime"}:
        return len(raw_bytes) >= 12 and raw_bytes[4:8] == b"ftyp"
    if content_type == "video/webm":
        return raw_bytes.startswith(b"\x1aE\xdf\xa3")
    return False


def _byte_range(range_header: str, length: int) -> tuple[int, int]:
    if length <= 0 or not range_header.startswith("bytes=") or "," in range_header:
        raise ValueError("Invalid byte range.")
    range_spec = range_header.removeprefix("bytes=").strip()
    start_raw, separator, end_raw = range_spec.partition("-")
    if separator != "-" or (not start_raw and not end_raw):
        raise ValueError("Invalid byte range.")
    try:
        if not start_raw:
            suffix_length = int(end_raw)
            if suffix_length <= 0:
                raise ValueError
            start = max(length - suffix_length, 0)
            end = length - 1
        else:
            start = int(start_raw)
            end = int(end_raw) if end_raw else length - 1
    except ValueError as exc:
        raise ValueError("Invalid byte range.") from exc
    if start < 0 or start >= length or end < start:
        raise ValueError("Requested byte range is not satisfiable.")
    return start, min(end, length - 1)


def _resolve_attachment_content_type(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").strip().lower()
    if content_type in ALLOWED_PATIENT_ATTACHMENT_TYPES:
        return content_type
    extension = Path(upload.filename or "").suffix.lower()
    if extension in ALLOWED_PATIENT_ATTACHMENT_EXTENSIONS:
        return ALLOWED_PATIENT_ATTACHMENT_EXTENSIONS[extension]
    raise HTTPException(
        status_code=400,
        detail="Only JPG, PNG, WEBP, PDF, MP4, MOV, and WEBM attachments are supported.",
    )


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
    raw_bytes = await file.read(MAX_PATIENT_ATTACHMENT_BYTES + 1)
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Attachment file is empty.")
    if len(raw_bytes) > MAX_PATIENT_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="Attachment must be 50 MB or smaller.")
    if not _content_matches_type(raw_bytes, content_type):
        raise HTTPException(status_code=400, detail="Attachment content does not match its file type.")
    if content_type == "application/pdf":
        try:
            validate_pdf_bytes(raw_bytes)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    uploaded_path = ""
    try:
        row = await repo.prepare_patient_attachment_metadata(
            str(current_user.org_id),
            patient_id,
            uploaded_by=str(current_user.id),
            filename=(file.filename or "attachment").strip() or "attachment",
            content_type=content_type,
            file_size=len(raw_bytes),
        )
        uploaded_path = str(row["storage_path"])
        await storage.upload(uploaded_path, raw_bytes, content_type)
        saved = await repo.create_patient_attachment_metadata(row)
        return PatientAttachmentOut(**saved)
    except ValueError as exc:
        if uploaded_path:
            try:
                await storage.delete(uploaded_path)
            except Exception:
                pass
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        if uploaded_path:
            try:
                await storage.delete(uploaded_path)
            except Exception:
                pass
        raise internal_server_error(exc, context="upload_patient_attachment") from exc


@router.get("/attachments/{attachment_id}/file")
async def download_patient_attachment(
    attachment_id: str,
    range_header: str | None = Header(default=None, alias="Range"),
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
):
    try:
        row = await repo.get_patient_attachment(str(current_user.org_id), attachment_id)
        if not row:
            raise ValueError("Attachment not found for this organization.")
        raw_bytes = await storage.download(str(row["storage_path"]))
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="patient_attachment",
            entity_id=attachment_id,
            action="patient_attachment_viewed",
            summary="Viewed or downloaded a patient attachment.",
            metadata={
                "patient_id": str(row.get("patient_id") or ""),
                "file_name": str(row.get("file_name") or ""),
            },
        )
        content_type = str(row.get("content_type") or "application/octet-stream")
        filename = str(row.get("file_name") or "attachment")
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Disposition": f'inline; filename="{filename}"',
        }
        if range_header:
            try:
                start, end = _byte_range(range_header, len(raw_bytes))
            except ValueError:
                return Response(
                    status_code=416,
                    headers={"Content-Range": f"bytes */{len(raw_bytes)}"},
                )
            chunk = raw_bytes[start:end + 1]
            return Response(
                content=chunk,
                status_code=206,
                media_type=content_type,
                headers={
                    **headers,
                    "Content-Range": f"bytes {start}-{end}/{len(raw_bytes)}",
                    "Content-Length": str(len(chunk)),
                },
            )
        return StreamingResponse(
            iter([raw_bytes]),
            media_type=content_type,
            headers={**headers, "Content-Length": str(len(raw_bytes))},
        )
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="download_patient_attachment") from exc


@router.delete("/patients/{patient_id}/attachments/{attachment_id}", response_model=PatientAttachmentOut)
async def delete_patient_attachment(
    patient_id: str,
    attachment_id: str,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
) -> PatientAttachmentOut:
    try:
        row = await repo.get_patient_attachment(str(current_user.org_id), attachment_id)
        if str(row.get("patient_id") or "") != patient_id:
            raise ValueError("Attachment not found for this patient.")
        deleted = await repo.delete_patient_attachment_metadata(str(current_user.org_id), patient_id, attachment_id)
        try:
            await storage.delete(str(row["storage_path"]))
        except Exception:
            # Metadata deletion is authoritative. Bucket lifecycle cleanup can
            # safely remove an orphaned object without exposing a broken record.
            pass
        return PatientAttachmentOut(**deleted)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="delete_patient_attachment") from exc


@router.post(
    "/patients/{patient_id}/attachments/{attachment_id}/send",
    response_model=SendPatientAttachmentResponse,
)
async def send_patient_attachment(
    patient_id: str,
    attachment_id: str,
    payload: SendPatientAttachmentRequest,
    repo: AppRepository = Depends(get_repository),
    storage: PatientAttachmentStorage = Depends(get_patient_attachment_storage),
    current_user: UserOut = Depends(get_current_user),
) -> SendPatientAttachmentResponse:
    recipient_email = payload.recipient_email.strip()
    if "@" not in recipient_email:
        raise HTTPException(status_code=400, detail="Enter a valid recipient email.")
    try:
        row = await repo.get_patient_attachment(str(current_user.org_id), attachment_id)
        if str(row.get("patient_id") or "") != patient_id:
            raise ValueError("Attachment not found for this patient.")
        patient = await repo.get_patient(str(current_user.org_id), patient_id)
        raw_bytes = await storage.download(str(row["storage_path"]))
        clinic_settings = await build_document_context_for_user(repo, current_user)
        clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
        patient_name = str(patient.get("name") or "").strip() or "Patient"
        filename = str(row.get("file_name") or "attachment").strip() or "attachment"
        message = payload.message.strip() or (
            f"Please find attached {filename} for {patient_name}.\n\n"
            f"Sent from {clinic_name}."
        )
        await send_clinic_email_message(
            clinic_settings=clinic_settings,
            recipient=recipient_email,
            subject=payload.subject.strip(),
            text_content=message,
            attachments=[(filename, raw_bytes, str(row.get("content_type") or "application/octet-stream"))],
        )
        await write_audit_event(
            repo,
            current_user,
            entity_type="patient_attachment",
            entity_id=attachment_id,
            action="patient_attachment_sent",
            summary=f"Sent attachment {filename} for {patient_name} to {recipient_email}.",
            metadata={
                "patient_id": patient_id,
                "patient_name": patient_name,
                "file_name": filename,
                "content_type": row.get("content_type"),
                "recipient_email": recipient_email,
            },
        )
        return SendPatientAttachmentResponse(
            success=True,
            message=f"Attachment emailed to {recipient_email}.",
            recipient_email=recipient_email,
        )
    except EmailDeliveryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="send_patient_attachment") from exc
