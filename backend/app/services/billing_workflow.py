from datetime import datetime

from fastapi import HTTPException

from app.db import SupabaseRepository
from app.services.email_service import send_clinic_email_message
from app.services.pdf_service import build_invoice_pdf
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import InvoiceCreate, InvoiceOut, SendInvoiceRequest
from app.schema_domains.documents import SendNoteResponse
from app.services.audit_service import record_invoice_created, record_invoice_shared
from app.services.patient_views import (
    build_patient_name_map,
    build_user_name_map,
    enrich_invoices_with_completer_names,
    enrich_invoices_with_patient_names,
)


async def _record_invoice_delivery_failure(
    repo: SupabaseRepository,
    current_user: UserOut,
    *,
    invoice_id: str,
    patient_name: str,
    recipient_email: str,
    error_message: str,
) -> None:
    await repo.create_platform_error(
        org_id=str(current_user.org_id),
        user_id=str(current_user.id),
        identifier=current_user.identifier,
        path="/send-invoice",
        method="POST",
        status_code=502,
        error_type="EmailDeliveryError",
        message=error_message,
        details="Invoice was finalized before email delivery failed.",
        context={
            "invoice_id": invoice_id,
            "patient_name": patient_name,
            "recipient_email": recipient_email,
        },
    )


async def create_invoice_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: InvoiceCreate,
) -> InvoiceOut:
    created = await repo.create_invoice(str(current_user.org_id), payload)
    patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
    await record_invoice_created(repo, current_user, created, patient_name)
    return InvoiceOut(**{**created, "patient_name": patient_name})


async def list_invoices_with_user_names(repo: SupabaseRepository, org_id: str) -> list[InvoiceOut]:
    invoices = await repo.list_invoices(org_id)
    user_names = await build_user_name_map(repo, org_id)
    patient_names = await build_patient_name_map(repo, org_id)
    enriched = enrich_invoices_with_patient_names(
        enrich_invoices_with_completer_names(invoices, user_names),
        patient_names,
    )
    return [InvoiceOut(**invoice) for invoice in enriched]


async def send_invoice_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: SendInvoiceRequest,
) -> SendNoteResponse:
    recipient_email = payload.recipient_email.strip()
    if "@" not in recipient_email:
        raise HTTPException(status_code=400, detail="Enter a valid recipient email.")
    invoice = await repo.get_invoice(str(current_user.org_id), str(payload.invoice_id))
    patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
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
    )
    generated_on = datetime.now().strftime("%b %d, %Y %I:%M %p")
    pdf_bytes = build_invoice_pdf(
        clinic=clinic_settings,
        patient=patient,
        invoice=invoice,
        generated_on=generated_on,
    )
    clinic_name = str(clinic_settings.get("clinic_name") or "ClinicOS").strip() or "ClinicOS"
    try:
        await send_clinic_email_message(
            clinic_settings=clinic_settings,
            recipient=recipient_email,
            subject=f"{clinic_name} invoice for {patient_name}",
            text_content=(
                f"Invoice for {patient_name} is attached as a PDF.\n\n"
                f"Sent from {clinic_name}."
            ),
            attachments=[
                (f"{patient_name.replace(' ', '_') or 'patient'}_invoice.pdf", pdf_bytes, "application/pdf"),
            ],
        )
    except RuntimeError as exc:
        failure_message = (
            f"Invoice finalized for {patient_name}, but email delivery to {recipient_email} failed: {exc}"
        )
        await _record_invoice_delivery_failure(
            repo,
            current_user,
            invoice_id=str(payload.invoice_id),
            patient_name=patient_name,
            recipient_email=recipient_email,
            error_message=failure_message,
        )
        raise HTTPException(
            status_code=502,
            detail={
                "message": failure_message,
                "delivery_failed": True,
                "finalized": True,
            },
        ) from exc
    await record_invoice_shared(
        repo,
        current_user,
        str(payload.invoice_id),
        finalized,
        patient_name=patient_name,
        recipient=recipient_email,
        stock_deductions=stock_deductions,
        amount_paid=invoice.get("amount_paid"),
        balance_due=invoice.get("balance_due"),
    )
    return SendNoteResponse(
        success=True,
        message=(
            f"Invoice already finalized and emailed to {recipient_email}."
            if finalized.get("already_finalized")
            else f"Invoice emailed to {recipient_email}."
        ),
    )
