from __future__ import annotations

import re
import asyncio
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException

from app.config import get_settings
from app.db import AppRepository
from app.formatting import format_display_date
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import InvoiceActionResponse, InvoiceOut, SendInvoiceWhatsAppRequest
from app.schema_domains.documents import SendNoteResponse, SendNoteWhatsAppRequest, WhatsAppDeliveryOut
from app.services.audit_service import record_invoice_shared
from app.services.audit_service import get_actor_name, write_audit_event
from app.services.document_helpers import build_document_context_for_user
from app.services.billing_workflow import _invoice_completion_audit_events
from app.services.note_workflow import hydrate_note_assets_for_pdf
from app.services.patient_summary_workflow import regenerate_patient_summary_after_finalization
from app.services.pdf_service import build_invoice_pdf, build_letter_pdf, build_note_pdf
from app.storage import PatientAttachmentStorage
from app.services.whatsapp_client import WhatsAppClient, WhatsAppClientError


def normalize_whatsapp_recipient(raw_phone: str) -> str:
    digits = re.sub(r"\D+", "", raw_phone or "")
    if len(digits) == 10:
        digits = f"91{digits}"
    if len(digits) < 11 or len(digits) > 15:
        raise HTTPException(status_code=400, detail="Enter a valid WhatsApp phone number with country code.")
    return digits


def _format_rupees(value: Any) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0
    return f"Rs. {amount:,.2f}"


def _first_name(name: str) -> str:
    cleaned = " ".join(str(name or "").strip().split())
    return cleaned.split(" ", 1)[0] if cleaned else "there"


def _document_label(subject: str) -> str:
    cleaned = " ".join(str(subject or "").strip().split())
    return cleaned or "document"


def build_whatsapp_client() -> WhatsAppClient:
    settings = get_settings()
    if not settings.whatsapp_enabled:
        raise HTTPException(status_code=400, detail="WhatsApp is not enabled for this environment.")
    if not settings.whatsapp_access_token or not settings.whatsapp_phone_number_id:
        raise HTTPException(status_code=400, detail="WhatsApp credentials are not configured.")
    return WhatsAppClient(
        access_token=settings.whatsapp_access_token,
        phone_number_id=settings.whatsapp_phone_number_id,
        graph_api_version=settings.whatsapp_graph_api_version,
    )


async def _record_document_event(
    repo: AppRepository,
    *,
    org_id: str,
    recipient_wa_id: str,
    message_text: str,
    intent: str,
    status: str,
    error: str = "",
    raw_payload: dict[str, Any] | None = None,
    wa_message_id: str = "",
    document_type: str = "",
    document_id: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    return await repo.record_whatsapp_message_event(
        org_id=org_id,
        binding_id=None,
        direction="outbound",
        wa_message_id=wa_message_id,
        sender_wa_id="",
        recipient_wa_id=recipient_wa_id,
        message_text=message_text,
        intent=intent,
        status=status,
        error=error,
        raw_payload=raw_payload or {},
        document_type=document_type,
        document_id=document_id,
        idempotency_key=idempotency_key,
    )


async def _send_pdf_document(
    repo: AppRepository,
    *,
    org_id: str,
    recipient_wa_id: str,
    filename: str,
    caption: str,
    pdf_bytes: bytes,
    intent: str,
    raw_context: dict[str, Any],
    document_type: str,
    document_id: str,
    idempotency_key: str = "",
) -> WhatsAppDeliveryOut:
    settings = get_settings()
    client = build_whatsapp_client()
    if idempotency_key:
        existing = await repo.get_whatsapp_message_event_by_idempotency(org_id, idempotency_key)
        if existing:
            existing_status = str(existing.get("status") or "")
            if existing_status == "queued":
                raise HTTPException(status_code=409, detail="This WhatsApp document is already being sent.")
            if existing_status == "failed":
                raise HTTPException(
                    status_code=502,
                    detail=str(existing.get("error") or "The previous WhatsApp delivery attempt failed. Retry the send."),
                )
            return WhatsAppDeliveryOut(
                event_id=existing["id"],
                document_type=str(existing.get("document_type") or document_type),
                document_id=str(existing.get("document_id") or document_id),
                recipient=str(existing.get("recipient_wa_id") or recipient_wa_id),
                provider_message_id=str(existing.get("wa_message_id") or ""),
                status=existing_status,
                error=str(existing.get("error") or ""),
            )

    event = await _record_document_event(
        repo,
        org_id=org_id,
        recipient_wa_id=recipient_wa_id,
        message_text=caption,
        intent=intent,
        status="queued",
        raw_payload=raw_context,
        document_type=document_type,
        document_id=document_id,
        idempotency_key=idempotency_key,
    )
    try:
        media_id = await asyncio.to_thread(
            client.upload_media,
            content=pdf_bytes,
            filename=filename,
            content_type="application/pdf",
        )
        if settings.whatsapp_document_template_name.strip():
            result = await asyncio.to_thread(
                client.send_document_template,
                to=recipient_wa_id,
                media_id=media_id,
                filename=filename,
                template_name=settings.whatsapp_document_template_name.strip(),
                language_code=settings.whatsapp_document_template_language.strip() or "en",
            )
        else:
            result = await asyncio.to_thread(
                client.send_document,
                to=recipient_wa_id,
                media_id=media_id,
                filename=filename,
                caption=caption,
            )
    except WhatsAppClientError as exc:
        await repo.update_whatsapp_message_event(
            str(event["id"]),
            status="failed",
            error=str(exc),
            raw_payload=raw_context,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    accepted_event = await repo.update_whatsapp_message_event(
        str(event["id"]),
        status="accepted",
        wa_message_id=result.message_id,
        raw_payload={
            **raw_context,
            "media_id": media_id,
            "provider_response": result.raw,
        },
    )
    return WhatsAppDeliveryOut(
        event_id=accepted_event["id"],
        document_type=document_type,
        document_id=document_id,
        recipient=recipient_wa_id,
        provider_message_id=result.message_id,
        status="accepted",
    )


async def send_invoice_whatsapp_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: SendInvoiceWhatsAppRequest,
) -> InvoiceActionResponse:
    invoice = await repo.get_invoice(str(current_user.org_id), str(payload.invoice_id))
    patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
    raw_phone = str(payload.recipient_phone or patient.get("phone") or "").strip()
    recipient_wa_id = normalize_whatsapp_recipient(raw_phone)
    clinic_settings = await build_document_context_for_user(repo, current_user)
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
        mark_sent=False,
        audit_event_factory=_invoice_completion_audit_events(
            current_user,
            patient_name=patient_name,
        ),
    )
    refreshed_invoice = await repo.get_invoice(str(current_user.org_id), str(payload.invoice_id))
    generated_on = datetime.now().strftime("%b %d, %Y %I:%M %p")
    pdf_bytes = build_invoice_pdf(
        clinic=clinic_settings,
        patient=patient,
        invoice=refreshed_invoice,
        generated_on=generated_on,
    )
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    filename = f"{patient_name.replace(' ', '_') or 'patient'}_invoice.pdf"
    paid = str(refreshed_invoice.get("payment_status") or "").lower() == "paid"
    document_kind = "receipt" if paid else "invoice"
    amount_label = "Amount paid" if paid else "Balance due"
    amount_value = refreshed_invoice.get("amount_paid") if paid else refreshed_invoice.get("balance_due")
    caption = "\n\n".join(
        [
            f"Hi {_first_name(patient_name)},",
            f"Thank you for visiting {clinic_name}.",
            f"Here is your {document_kind} for today's visit.\n{amount_label}: {_format_rupees(amount_value)}",
            "Attached for your records.",
        ]
    )
    delivery = await _send_pdf_document(
        repo,
        org_id=str(current_user.org_id),
        recipient_wa_id=recipient_wa_id,
        filename=filename,
        caption=caption,
        pdf_bytes=pdf_bytes,
        intent="send_invoice_document",
        raw_context={
            "invoice_id": str(payload.invoice_id),
            "patient_id": str(patient.get("id") or refreshed_invoice.get("patient_id") or ""),
            "patient_name": patient_name,
            "recipient_phone": raw_phone,
            "recipient_wa_id": recipient_wa_id,
            "filename": filename,
        },
        document_type="invoice",
        document_id=str(payload.invoice_id),
        idempotency_key=payload.idempotency_key,
    )
    sent_invoice = await repo.mark_invoice_sent(
        str(current_user.org_id),
        str(payload.invoice_id),
    )
    refreshed_invoice = {
        **refreshed_invoice,
        "sent_at": sent_invoice.get("sent_at"),
    }
    output_invoice = InvoiceOut(**{**refreshed_invoice, "patient_name": patient_name})
    await record_invoice_shared(
        repo,
        current_user,
        str(payload.invoice_id),
        finalized,
        patient_name=patient_name,
        recipient=recipient_wa_id,
        stock_deductions=stock_deductions,
        amount_paid=refreshed_invoice.get("amount_paid"),
        balance_due=refreshed_invoice.get("balance_due"),
    )
    return InvoiceActionResponse(
        success=True,
        message=f"Invoice accepted by WhatsApp for {recipient_wa_id}.",
        invoice=output_invoice,
        program_enrollments=finalized.get("program_enrollments", []),
        delivery=delivery,
    )


async def send_letter_whatsapp_workflow(
    repo: AppRepository,
    current_user: UserOut,
    *,
    recipient_phone: str,
    recipient_name: str,
    subject: str,
    content: str,
    patient_id: str | None = None,
    idempotency_key: str = "",
) -> SendNoteResponse:
    recipient_wa_id = normalize_whatsapp_recipient(recipient_phone)
    normalized_name = " ".join(recipient_name.strip().split())
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Recipient name is required.")
    clinic_settings = await build_document_context_for_user(repo, current_user)
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    generated_on = datetime.now().strftime("%b %d, %Y")
    pdf_bytes = build_letter_pdf(
        clinic=clinic_settings,
        letter_content=content.strip(),
        generated_on=generated_on,
    )
    filename = "clinic_letter.pdf"
    caption = "\n\n".join(
        [
            f"Hi {_first_name(normalized_name)},",
            f"Thank you for visiting {clinic_name}.",
            f"Here is your {_document_label(subject)}.",
            "Attached for your records.",
        ]
    )
    document_id = str(patient_id or idempotency_key or "letter")
    delivery = await _send_pdf_document(
        repo,
        org_id=str(current_user.org_id),
        recipient_wa_id=recipient_wa_id,
        filename=filename,
        caption=caption,
        pdf_bytes=pdf_bytes,
        intent="send_letter_document",
        raw_context={
            "subject": subject.strip(),
            "recipient_phone": recipient_phone.strip(),
            "recipient_name": normalized_name,
            "recipient_wa_id": recipient_wa_id,
            "filename": filename,
            "patient_id": str(patient_id or ""),
        },
        document_type="letter",
        document_id=document_id,
        idempotency_key=idempotency_key,
    )
    return SendNoteResponse(
        success=True,
        message=f"Letter accepted by WhatsApp for {recipient_wa_id}.",
        delivery=delivery,
    )


async def send_note_whatsapp_workflow(
    repo: AppRepository,
    storage: PatientAttachmentStorage,
    current_user: UserOut,
    payload: SendNoteWhatsAppRequest,
) -> SendNoteResponse:
    note = await repo.get_note(str(current_user.org_id), str(payload.note_id))
    if str(note["patient_id"]) != str(payload.patient_id):
        raise HTTPException(status_code=400, detail="Note does not belong to that patient.")

    patient = await repo.get_patient(str(current_user.org_id), str(payload.patient_id))
    raw_phone = str(payload.recipient_phone or patient.get("phone") or "").strip()
    recipient_wa_id = normalize_whatsapp_recipient(raw_phone)
    clinic_settings = await build_document_context_for_user(repo, current_user)
    finalized_during_request = note.get("status") not in {"final", "sent"}
    finalized_note = note if not finalized_during_request else await repo.finalize_note(
        str(current_user.org_id),
        str(payload.note_id),
    )
    if finalized_during_request:
        await regenerate_patient_summary_after_finalization(
            repo,
            str(current_user.org_id),
            str(payload.patient_id),
        )

    snapshot_content = str(finalized_note.get("snapshot_content") or finalized_note.get("content") or "").strip()
    if not snapshot_content:
        raise HTTPException(status_code=400, detail="Saved note content is empty.")

    generated_on = format_display_date(datetime.now(UTC), clinic_settings.get("timezone"))
    note_assets = await hydrate_note_assets_for_pdf(
        repo,
        storage,
        str(current_user.org_id),
        finalized_note.get("snapshot_asset_payload") or finalized_note.get("asset_payload") or [],
    )
    patient_name = str(patient.get("name") or "").strip() or "Patient"
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    pdf_bytes = build_note_pdf(
        patient={**patient, **clinic_settings},
        note_content=snapshot_content,
        generated_on=generated_on,
        assets=note_assets,
    )
    filename = f"{patient_name.replace(' ', '_') or 'patient'}_consultation_note.pdf"
    caption = "\n\n".join(
        [
            f"Hi {_first_name(patient_name)},",
            f"Thank you for visiting {clinic_name}.",
            "Here is your consultation note.",
            "Attached for your records.",
        ]
    )
    delivery = await _send_pdf_document(
        repo,
        org_id=str(current_user.org_id),
        recipient_wa_id=recipient_wa_id,
        filename=filename,
        caption=caption,
        pdf_bytes=pdf_bytes,
        intent="send_consultation_note_document",
        raw_context={
            "note_id": str(payload.note_id),
            "patient_id": str(payload.patient_id),
            "patient_name": patient_name,
            "recipient_phone": raw_phone,
            "recipient_wa_id": recipient_wa_id,
            "filename": filename,
        },
        document_type="consultation_note",
        document_id=str(payload.note_id),
        idempotency_key=payload.idempotency_key,
    )
    sent_note = await repo.mark_note_sent(
        str(current_user.org_id),
        str(payload.note_id),
        sent_by=str(current_user.id),
        sent_to=recipient_wa_id,
    )
    await write_audit_event(
        repo,
        current_user,
        entity_type="note",
        entity_id=str(payload.note_id),
        action="consultation_note_shared",
        summary=f"Shared consultation note on WhatsApp with {recipient_wa_id}.",
        metadata={
            "patient_id": str(payload.patient_id),
            "patient_name": patient_name,
            "recipient": recipient_wa_id,
            "sent_at": sent_note.get("sent_at"),
            "sent_by": str(current_user.id),
            "sent_by_name": get_actor_name(current_user),
            "sent_to": recipient_wa_id,
            "version_number": sent_note.get("version_number", 1),
            "root_note_id": sent_note.get("root_note_id"),
            "amended_from_note_id": sent_note.get("amended_from_note_id"),
        },
    )
    return SendNoteResponse(
        success=True,
        message=f"Consultation note accepted by WhatsApp for {recipient_wa_id}.",
        delivery=delivery,
    )
