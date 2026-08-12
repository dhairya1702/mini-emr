from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error, internal_server_error
from app.auth import require_admin
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import (
    BillingDashboardOut,
    BillingStatusOut,
    FinalizeInvoiceRequest,
    InvoiceActionResponse,
    InvoiceCreate,
    InvoiceOut,
    InvoiceSummaryOut,
    InvoicePaymentUpdate,
    SendInvoiceRequest,
    SendInvoiceWhatsAppRequest,
)
from app.schema_domains.clinical_extractions import BillingSuggestionsResponse
from app.services.billing_suggestion_service import build_note_billing_suggestions
from app.services.billing_workflow import (
    create_invoice_workflow,
    finalize_invoice_workflow,
    list_invoices_with_user_names,
    send_invoice_workflow,
    update_invoice_payment_workflow,
)
from app.services.document_helpers import build_document_context_for_user
from app.services.pdf_service import build_invoice_pdf
from app.services.whatsapp_document_workflow import send_invoice_whatsapp_workflow


router = APIRouter()


@router.get("/billing/status", response_model=BillingStatusOut)
async def get_billing_status(
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> BillingStatusOut:
    try:
        return BillingStatusOut(**await repo.get_billing_status(str(current_user.org_id)))
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_billing_status") from exc


@router.get("/billing/dashboard", response_model=BillingDashboardOut)
async def get_billing_dashboard(
    recent_invoice_limit: int = Query(default=5, ge=1, le=20),
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> BillingDashboardOut:
    try:
        return BillingDashboardOut(
            **await repo.get_billing_dashboard(
                str(current_user.org_id),
                recent_invoice_limit=recent_invoice_limit,
            )
        )
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="get_billing_dashboard") from exc


@router.get("/invoices/summaries", response_model=list[InvoiceSummaryOut])
async def list_invoice_summaries(
    limit: int = Query(default=5, ge=1, le=20),
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> list[InvoiceSummaryOut]:
    try:
        rows = await repo.list_invoice_summaries(str(current_user.org_id), limit=limit)
        return [InvoiceSummaryOut(**row) for row in rows]
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="list_invoice_summaries") from exc


@router.get("/notes/{note_id}/billing-suggestions", response_model=BillingSuggestionsResponse)
async def get_note_billing_suggestions(
    note_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> BillingSuggestionsResponse:
    try:
        return await build_note_billing_suggestions(repo, current_user, note_id)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/invoices", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    payload: InvoiceCreate,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> InvoiceOut:
    try:
        return await create_invoice_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> list[InvoiceOut]:
    return await list_invoices_with_user_names(
        repo,
        str(current_user.org_id),
        limit=limit,
        offset=offset,
    )


@router.post("/invoices/finalize", response_model=InvoiceActionResponse)
async def finalize_invoice(
    payload: FinalizeInvoiceRequest,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> InvoiceActionResponse:
    try:
        return await finalize_invoice_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.patch("/invoices/{invoice_id}/payment", response_model=InvoiceActionResponse)
async def update_invoice_payment(
    invoice_id: str,
    payload: InvoicePaymentUpdate,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> InvoiceActionResponse:
    try:
        return await update_invoice_payment_workflow(repo, current_user, invoice_id, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/send-invoice", response_model=InvoiceActionResponse)
async def send_invoice(
    payload: SendInvoiceRequest,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> InvoiceActionResponse:
    try:
        return await send_invoice_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.post("/send-invoice-whatsapp", response_model=InvoiceActionResponse)
async def send_invoice_whatsapp(
    payload: SendInvoiceWhatsAppRequest,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> InvoiceActionResponse:
    try:
        return await send_invoice_whatsapp_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise bad_request_error(exc) from exc


@router.get("/invoices/{invoice_id}/pdf")
async def generate_invoice_pdf(
    invoice_id: str,
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    try:
        invoice = await repo.get_invoice(str(current_user.org_id), invoice_id)
        patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
        clinic_settings = await build_document_context_for_user(repo, current_user)
        generated_on = datetime.now().strftime("%b %d, %Y %I:%M %p")
        pdf_bytes = build_invoice_pdf(
            clinic=clinic_settings,
            patient=patient,
            invoice=invoice,
            generated_on=generated_on,
        )
        filename = f"{patient['name'].strip().replace(' ', '_') or 'patient'}_invoice.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="generate_invoice_pdf") from exc
