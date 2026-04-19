from app.db import SupabaseRepository
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
    invoice = await repo.get_invoice(str(current_user.org_id), str(payload.invoice_id))
    patient = await repo.get_patient(str(current_user.org_id), str(invoice["patient_id"]))
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
    await record_invoice_shared(
        repo,
        current_user,
        str(payload.invoice_id),
        finalized,
        patient_name=patient_name,
        recipient=payload.recipient,
        stock_deductions=stock_deductions,
        amount_paid=invoice.get("amount_paid"),
        balance_due=invoice.get("balance_due"),
    )
    return SendNoteResponse(
        success=True,
        message=(
            f"Invoice already finalized for {payload.recipient}."
            if finalized.get("already_finalized")
            else f"Invoice marked shared for {payload.recipient}."
        ),
    )
