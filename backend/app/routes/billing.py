from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import InvoiceCreate, InvoiceOut, SendInvoiceRequest, SendNoteResponse, UserOut
from app.services.billing_workflow import create_invoice_workflow, list_invoices_with_user_names, send_invoice_workflow
from app.services.pdf_service import build_invoice_pdf


router = APIRouter()


@router.post("/invoices", response_model=InvoiceOut, status_code=201)
async def create_invoice(
    payload: InvoiceCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> InvoiceOut:
    try:
        return await create_invoice_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[InvoiceOut]:
    return await list_invoices_with_user_names(repo, str(current_user.org_id))


@router.post("/send-invoice", response_model=SendNoteResponse)
async def send_invoice(
    payload: SendInvoiceRequest,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> SendNoteResponse:
    try:
        return await send_invoice_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/invoices/{invoice_id}/pdf")
async def generate_invoice_pdf(
    invoice_id: str,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    try:
        invoice = await repo.get_invoice(str(current_user.org_id), invoice_id)
        patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
        clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
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
        raise HTTPException(status_code=500, detail=str(exc)) from exc
