from datetime import datetime

from fastapi import HTTPException

from app.db import SupabaseRepository
from app.services.email_service import send_clinic_email_message
from app.services.pdf_service import build_invoice_pdf
from app.schemas import InvoiceCreate, InvoiceOut, SendInvoiceRequest, SendNoteResponse, UserOut
from app.services.audit_service import record_invoice_created, record_invoice_shared
from app.services.patient_views import build_user_name_map, enrich_invoices_with_completer_names


async def create_invoice_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: InvoiceCreate,
) -> InvoiceOut:
    created = await repo.create_invoice(str(current_user.org_id), payload)
    patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
    await record_invoice_created(repo, current_user, created, patient_name)
    return InvoiceOut(**created)


async def list_invoices_with_user_names(repo: SupabaseRepository, org_id: str) -> list[InvoiceOut]:
    invoices = await repo.list_invoices(org_id)
    names = await build_user_name_map(repo, org_id)
    return [InvoiceOut(**invoice) for invoice in enrich_invoices_with_completer_names(invoices, names)]


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
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
