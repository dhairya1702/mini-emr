from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from app.config import get_settings
from app.db import AppRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import InvoiceActionResponse, InvoiceOut, SendInvoiceWhatsAppRequest
from app.schema_domains.documents import SendNoteResponse
from app.services.audit_service import record_invoice_completed, record_invoice_shared
from app.services.document_helpers import build_document_context_for_user
from app.services.pdf_service import build_invoice_pdf, build_letter_pdf
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
) -> None:
    await repo.record_whatsapp_message_event(
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
) -> str:
    client = build_whatsapp_client()
    try:
        media_id = client.upload_media(
            content=pdf_bytes,
            filename=filename,
            content_type="application/pdf",
        )
        result = client.send_document(
            to=recipient_wa_id,
            media_id=media_id,
            filename=filename,
            caption=caption,
        )
    except WhatsAppClientError as exc:
        await _record_document_event(
            repo,
            org_id=org_id,
            recipient_wa_id=recipient_wa_id,
            message_text=caption,
            intent=intent,
            status="failed",
            error=str(exc),
            raw_payload=raw_context,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await _record_document_event(
        repo,
        org_id=org_id,
        recipient_wa_id=recipient_wa_id,
        message_text=caption,
        intent=intent,
        status="sent",
        wa_message_id=result.message_id,
        raw_payload={
            **raw_context,
            "media_id": media_id,
            "provider_response": result.raw,
        },
    )
    return result.message_id


async def send_invoice_whatsapp_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: SendInvoiceWhatsAppRequest,
) -> InvoiceActionResponse:
    invoice = await repo.get_invoice(str(current_user.org_id), str(payload.invoice_id))
    patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
    raw_phone = str(payload.recipient_phone or patient.get("phone") or "").strip()
    recipient_wa_id = normalize_whatsapp_recipient(raw_phone)
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
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
    await _send_pdf_document(
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
    if not finalized.get("already_completed"):
        await record_invoice_completed(
            repo,
            current_user,
            output_invoice.model_dump(mode="json"),
            patient_name=patient_name,
            stock_deductions=finalized.get("stock_deductions", []),
        )
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
        message=(
            f"Invoice already sent on WhatsApp to {recipient_wa_id}."
            if finalized.get("already_sent")
            else f"Invoice sent on WhatsApp to {recipient_wa_id}."
        ),
        invoice=output_invoice,
    )


async def send_letter_whatsapp_workflow(
    repo: AppRepository,
    current_user: UserOut,
    *,
    recipient_phone: str,
    recipient_name: str,
    subject: str,
    content: str,
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
    await _send_pdf_document(
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
        },
    )
    return SendNoteResponse(
        success=True,
        message=f"Letter sent on WhatsApp to {recipient_wa_id} from {clinic_name}.",
    )
