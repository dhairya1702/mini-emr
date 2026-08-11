from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException

from app.db import AppRepository
from app.formatting import format_display_date
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.referrals import (
    ReferralDeliveryOut, ReferralPackageCreate, ReferralPackageOut, ReferralPackageSend,
    ReferralPackageSendResponse, ReferralSendRecipient,
)
from app.services.audit_service import get_actor_name, write_audit_event
from app.services.document_helpers import build_document_context_for_user
from app.services.email_service import send_clinic_email_message
from app.services.note_workflow import hydrate_note_assets_for_pdf
from app.services.pdf_service import build_note_pdf
from app.services.referral_pdf_service import build_referral_package_pdf
from app.services.whatsapp_document_workflow import _send_pdf_document, normalize_whatsapp_recipient
from app.storage import PatientAttachmentStorage


def _json_value(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_value(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(child) for child in value]
    return value


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip()).strip("_")
    return cleaned or "patient"


def _delivery_status(deliveries: list[dict[str, Any]]) -> str:
    if not deliveries:
        return "draft"
    successful = [row for row in deliveries if str(row.get("status")) != "failed"]
    if not successful:
        return "failed"
    return "sent" if len(successful) == len(deliveries) else "partially_sent"


async def _package_out(repo: AppRepository, org_id: str, row: dict[str, Any]) -> ReferralPackageOut:
    deliveries = await repo.list_referral_deliveries(org_id, str(row["id"]))
    return ReferralPackageOut(
        **{key: value for key, value in row.items() if key not in {"org_id", "snapshot", "storage_path", "file_sha256"}},
        status=_delivery_status(deliveries),
        deliveries=[ReferralDeliveryOut(**delivery) for delivery in deliveries],
    )


async def create_referral_package_workflow(
    repo: AppRepository,
    storage: PatientAttachmentStorage,
    current_user: UserOut,
    patient_id: str,
    payload: ReferralPackageCreate,
) -> ReferralPackageOut:
    org_id = str(current_user.org_id)
    patient = await repo.get_patient(org_id, patient_id)
    note_ids = list(dict.fromkeys(str(value) for value in payload.consultation_note_ids))
    track_ids = list(dict.fromkeys(str(value) for value in payload.longitudinal_track_ids))
    attachment_ids = list(dict.fromkeys(str(value) for value in payload.attachment_ids))

    notes: list[dict[str, Any]] = []
    for note_id in note_ids:
        note = await repo.get_note(org_id, note_id)
        if str(note.get("patient_id")) != patient_id:
            raise ValueError("A selected consultation does not belong to this patient.")
        if str(note.get("status") or "") not in {"final", "sent"}:
            raise ValueError("Only finalized consultations can be included in a referral.")
        notes.append(note)

    tracks = await repo.list_longitudinal_tracks_by_ids(org_id, patient_id, track_ids)
    if len(tracks) != len(track_ids):
        raise ValueError("A selected test does not belong to this patient or organization.")

    attachments: list[dict[str, Any]] = []
    attachment_files: list[tuple[str, str, bytes]] = []
    for attachment_id in attachment_ids:
        attachment = await repo.get_patient_attachment(org_id, attachment_id)
        if str(attachment.get("patient_id")) != patient_id:
            raise ValueError("A selected attachment does not belong to this patient.")
        content_type = str(attachment.get("content_type") or "")
        if content_type != "application/pdf" and not content_type.startswith("image/"):
            raise ValueError(
                f"Attachment '{attachment.get('file_name') or 'file'}' cannot be embedded in a referral PDF."
            )
        raw_bytes = await storage.download(str(attachment["storage_path"]))
        attachments.append(attachment)
        attachment_files.append((str(attachment.get("file_name") or "Attachment"), content_type, raw_bytes))

    clinic = await build_document_context_for_user(repo, current_user)
    consultation_pdfs: list[bytes] = []
    for note in notes:
        snapshot_content = str(note.get("snapshot_content") or note.get("content") or "").strip()
        if not snapshot_content:
            raise ValueError("A selected consultation has no saved content.")
        note_assets = await hydrate_note_assets_for_pdf(
            repo,
            storage,
            org_id,
            note.get("snapshot_asset_payload") or note.get("asset_payload") or [],
        )
        note_date = note.get("sent_at") or note.get("finalized_at") or note.get("created_at") or datetime.now(UTC)
        consultation_pdfs.append(
            build_note_pdf(
                patient={**patient, **clinic},
                note_content=snapshot_content,
                generated_on=format_display_date(note_date, clinic.get("timezone")),
                assets=note_assets,
            )
        )
    history_row = None
    get_history = getattr(repo, "get_optometry_history", None)
    if callable(get_history):
        history_row = await get_history(org_id, patient_id)

    records: list[dict[str, Any]] = []
    included_records: list[dict[str, Any]] = []
    for note in notes:
        note_date = note.get("finalized_at") or note.get("created_at")
        records.append({
            "record_type": "consultation", "title": "Consultation",
            "date": _json_value(note_date), "status": note.get("status"),
            "content": str(note.get("snapshot_content") or note.get("content") or ""),
            "payload": {"structured_modules": note.get("structured_modules") or []},
        })
        included_records.append({
            "id": str(note["id"]), "type": "consultation", "title": "Consultation",
            "date": _json_value(note_date),
        })
    for track in tracks:
        title = str(track.get("track_type") or "Clinical test").replace("_", " ").title()
        records.append({
            "record_type": "test", "title": title, "date": _json_value(track.get("measured_at")),
            "payload": {
                "summary": track.get("summary_fields") or {},
                "findings": track.get("raw_payload") or {},
                "derived_metrics": track.get("derived_metrics") or {},
            },
        })
        included_records.append({
            "id": str(track["id"]), "type": "test", "title": title,
            "date": _json_value(track.get("measured_at")),
        })
    for attachment in attachments:
        included_records.append({
            "id": str(attachment["id"]), "type": "attachment",
            "title": str(attachment.get("file_name") or "Attachment"),
            "date": _json_value(attachment.get("created_at")),
        })

    package_id = str(uuid4())
    file_name = f"{_safe_filename(str(patient.get('name') or 'patient'))}_referral_{package_id[:8]}.pdf"
    storage_path = f"{org_id}/{patient_id}/referrals/{package_id}/{file_name}"
    public_clinic = {
        key: clinic.get(key) for key in (
            "clinic_name", "clinic_address", "clinic_phone", "clinic_specialty", "doctor_name",
            "custom_header", "custom_footer", "timezone",
        )
    }
    snapshot = _json_value({
        "schema_version": 2,
        "generated_at": datetime.now(UTC),
        "generated_by": {"id": str(current_user.id), "name": get_actor_name(current_user)},
        "clinic": public_clinic,
        "patient": {
            key: patient.get(key) for key in (
                "id", "name", "phone", "email", "address", "date_of_birth", "age", "sex_at_birth",
                "gender_identity", "ai_summary",
            )
        },
        "patient_history": (history_row or {}).get("payload") or {},
        "referral": {
            "recipient_type": payload.recipient_type,
            "receiving_doctor": payload.recipient_name,
            "specialty": payload.recipient_specialty,
            "clinic": payload.recipient_clinic,
            "urgency": payload.urgency,
            "reason": payload.reason,
            "clinical_question": payload.clinical_question,
            "referral_note": payload.referral_note,
        },
        "records": records,
        "included_records": included_records,
    })
    pdf_bytes, page_count = build_referral_package_pdf(
        snapshot,
        attachment_files,
        clinic_context=clinic,
        consultation_pdfs=consultation_pdfs,
    )
    await storage.upload(storage_path, pdf_bytes, "application/pdf")
    try:
        created = await repo.create_referral_package(org_id, {
            "id": package_id, "patient_id": patient_id, "created_by": str(current_user.id),
            "recipient_type": payload.recipient_type, "recipient_name": payload.recipient_name.strip(),
            "recipient_specialty": payload.recipient_specialty.strip(),
            "recipient_clinic": payload.recipient_clinic.strip(), "recipient_email": payload.recipient_email,
            "recipient_phone": payload.recipient_phone.strip(), "reason": payload.reason.strip(),
            "clinical_question": payload.clinical_question.strip(), "urgency": payload.urgency,
            "referral_note": payload.referral_note.strip(), "snapshot": snapshot,
            "included_records": included_records, "file_name": file_name, "storage_path": storage_path,
            "file_size": len(pdf_bytes), "file_sha256": hashlib.sha256(pdf_bytes).hexdigest(),
            "page_count": page_count,
        })
    except Exception:
        await storage.delete(storage_path)
        raise
    await write_audit_event(
        repo, current_user, entity_type="referral_package", entity_id=package_id,
        action="referral_package_created", summary=f"Created referral for {patient.get('name') or 'patient'}.",
        metadata={"patient_id": patient_id, "included_records": included_records, "file_size": len(pdf_bytes)},
    )
    return await _package_out(repo, org_id, created)


async def list_referral_packages_workflow(
    repo: AppRepository, current_user: UserOut, patient_id: str
) -> list[ReferralPackageOut]:
    org_id = str(current_user.org_id)
    await repo.get_patient(org_id, patient_id)
    rows = await repo.list_referral_packages(org_id, patient_id)
    return [await _package_out(repo, org_id, row) for row in rows]


async def get_referral_package_workflow(
    repo: AppRepository, current_user: UserOut, package_id: str
) -> ReferralPackageOut:
    org_id = str(current_user.org_id)
    row = await repo.get_referral_package(org_id, package_id)
    return await _package_out(repo, org_id, row)


async def download_referral_package_workflow(
    repo: AppRepository, storage: PatientAttachmentStorage, current_user: UserOut, package_id: str
) -> tuple[dict[str, Any], bytes]:
    row = await repo.get_referral_package(str(current_user.org_id), package_id)
    raw_bytes = await storage.download(str(row["storage_path"]))
    if hashlib.sha256(raw_bytes).hexdigest() != str(row["file_sha256"]):
        raise RuntimeError("The saved referral failed its integrity check.")
    return row, raw_bytes


def _default_recipients(package: dict[str, Any], patient: dict[str, Any]) -> list[ReferralSendRecipient]:
    rows: list[ReferralSendRecipient] = []
    recipient_type = str(package.get("recipient_type") or "doctor")
    if recipient_type in {"patient", "both"}:
        rows.append(ReferralSendRecipient(
            recipient_type="patient", name=str(patient.get("name") or "Patient"),
            email=str(patient.get("email") or ""), phone=str(patient.get("phone") or ""),
        ))
    if recipient_type in {"doctor", "both"}:
        rows.append(ReferralSendRecipient(
            recipient_type="doctor", name=str(package.get("recipient_name") or "Doctor"),
            email=str(package.get("recipient_email") or ""), phone=str(package.get("recipient_phone") or ""),
        ))
    return rows


def _doctor_greeting(name: str) -> str:
    cleaned = re.sub(r"^dr\.?\s+", "", name.strip(), flags=re.IGNORECASE)
    return f"Dr. {cleaned}" if cleaned else "Doctor"


def _referral_delivery_message(
    recipient: ReferralSendRecipient,
    *,
    patient_name: str,
    clinic_name: str,
    reason: str,
) -> str:
    if recipient.recipient_type == "patient":
        return (
            f"Hello {patient_name}, your referral letter from {clinic_name} is attached. "
            "Please show it to the doctor or hospital you are visiting."
        )
    referral_reason = reason.strip() or "further evaluation"
    return (
        f"Hello {_doctor_greeting(recipient.name)}, {clinic_name} is referring {patient_name} "
        f"to you for {referral_reason}. The referral letter is attached."
    )


def _referral_email_subject(recipient: ReferralSendRecipient, *, patient_name: str, clinic_name: str) -> str:
    if recipient.recipient_type == "patient":
        return f"Your referral letter from {clinic_name}"
    return f"Referral for {patient_name}"


async def send_referral_package_workflow(
    repo: AppRepository,
    storage: PatientAttachmentStorage,
    current_user: UserOut,
    package_id: str,
    payload: ReferralPackageSend,
) -> ReferralPackageSendResponse:
    org_id = str(current_user.org_id)
    package, pdf_bytes = await download_referral_package_workflow(repo, storage, current_user, package_id)
    patient = await repo.get_patient(org_id, str(package["patient_id"]))
    clinic = await build_document_context_for_user(repo, current_user)
    recipients = payload.recipients or _default_recipients(package, patient)
    delivery_rows: list[dict[str, Any]] = []
    clinic_name = str(clinic.get("clinic_name") or "ClinicOS")
    patient_name = str(patient.get("name") or "the patient")
    custom_message = payload.message.strip()
    for recipient in recipients:
        message = custom_message or _referral_delivery_message(
            recipient,
            patient_name=patient_name,
            clinic_name=clinic_name,
            reason=str(package.get("reason") or ""),
        )
        for channel in payload.channels:
            destination = recipient.email if channel == "email" else recipient.phone
            if not destination.strip():
                continue
            provider_message_id = ""
            status = "accepted"
            error = ""
            normalized_destination = destination.strip()
            try:
                if channel == "email":
                    await send_clinic_email_message(
                        repo=repo, clinic_settings=clinic, recipient=normalized_destination,
                        subject=_referral_email_subject(
                            recipient, patient_name=patient_name, clinic_name=clinic_name
                        ),
                        text_content=message,
                        attachments=[(str(package["file_name"]), pdf_bytes, "application/pdf")],
                    )
                    status = "sent"
                else:
                    normalized_destination = normalize_whatsapp_recipient(normalized_destination)
                    suffix = f"{channel}:{recipient.recipient_type}:{normalized_destination}"
                    delivery = await _send_pdf_document(
                        repo, org_id=org_id, recipient_wa_id=normalized_destination,
                        filename=str(package["file_name"]), caption=message, pdf_bytes=pdf_bytes,
                        intent="send_referral_package_document",
                        raw_context={"referral_package_id": package_id, "patient_id": str(package["patient_id"]), "recipient_type": recipient.recipient_type},
                        document_type="referral_package", document_id=package_id,
                        idempotency_key=f"{payload.idempotency_key}:{suffix}" if payload.idempotency_key else "",
                    )
                    provider_message_id = delivery.provider_message_id
                    status = "accepted" if delivery.status == "accepted" else delivery.status
            except Exception as exc:
                status = "failed"
                error = str(getattr(exc, "detail", "") or exc)[:2000]
            row = await repo.create_referral_delivery(org_id, {
                "referral_package_id": package_id, "channel": channel,
                "recipient_type": recipient.recipient_type, "recipient": normalized_destination,
                "status": status, "provider_message_id": provider_message_id, "error": error,
            })
            delivery_rows.append(row)
    if not delivery_rows:
        raise ValueError("No recipient has a valid destination for the selected delivery channels.")
    successful = [row for row in delivery_rows if row["status"] != "failed"]
    await write_audit_event(
        repo, current_user, entity_type="referral_package", entity_id=package_id,
        action="referral_package_shared" if successful else "referral_package_delivery_failed",
        summary=f"Referral delivery completed with {len(successful)} of {len(delivery_rows)} successful attempts.",
        metadata={"patient_id": str(package["patient_id"]), "channels": payload.channels,
                  "deliveries": [{"channel": row["channel"], "recipient_type": row["recipient_type"], "recipient": row["recipient"], "status": row["status"]} for row in delivery_rows]},
    )
    return ReferralPackageSendResponse(
        success=bool(successful),
        message=f"Referral sent to {len(successful)} of {len(delivery_rows)} destinations.",
        deliveries=[ReferralDeliveryOut(**row) for row in delivery_rows],
    )
