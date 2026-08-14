from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error
from app.auth import require_admin
from app.db import AppRepository, get_repository
from app.exports import (
    EXPORT_PAGE_SIZE,
    coerce_created_at,
    created_at_key,
    get_export_range_start,
    invoice_export_row,
    merge_sorted_descending,
    queue_patient_export_row,
    stream_csv_chunks,
)
from app.schema_domains.auth_settings import UserOut
from app.services.audit_service import write_audit_event_best_effort


router = APIRouter()

PATIENT_EXPORT_FIELDNAMES = [
    "name",
    "phone",
    "reason",
    "age",
    "weight",
    "height",
    "created_at",
    "last_visit_at",
]

VISIT_EXPORT_FIELDNAMES = [
    "name",
    "phone",
    "reason",
    "age",
    "weight",
    "height",
    "source",
    "status",
    "billed",
    "created_at",
    "last_visit_at",
]

INVOICE_EXPORT_FIELDNAMES = [
    "patient_name",
    "payment_status",
    "amount_paid",
    "balance_due",
    "total",
    "paid_at",
    "sent_at",
    "created_at",
    "item_count",
]


def _csv_response(async_rows, filename: str, fieldnames: list[str], on_complete=None) -> StreamingResponse:
    return StreamingResponse(
        stream_csv_chunks(async_rows, fieldnames, chunk_size=EXPORT_PAGE_SIZE, on_complete=on_complete),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/exports/patients.csv")
async def export_patients_csv(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    org_id = str(current_user.org_id)

    async def _rows():
        async for patient in repo.iter_patients_for_export(org_id):
            yield patient

    async def _audit(row_count: int) -> None:
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="export",
            entity_id=org_id,
            action="patients_exported",
            summary="Exported the patient registry as CSV.",
            metadata={"row_count": row_count, "format": "csv"},
        )

    return _csv_response(_rows(), "patients.csv", PATIENT_EXPORT_FIELDNAMES, on_complete=_audit)


@router.get("/exports/visits.csv")
async def export_visits_csv(
    range: str = Query(default="all", pattern="^(today|7d|30d|month|all)$"),
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    org_id = str(current_user.org_id)
    try:
        start_at = get_export_range_start(range)
    except ValueError as exc:
        raise bad_request_error(exc) from exc

    async def _visit_rows():
        async for visit in repo.iter_visits_for_export(org_id):
            yield visit

    async def _queue_rows():
        async for patient in repo.iter_patients_without_visits_for_export(org_id):
            yield queue_patient_export_row(patient)

    merged = merge_sorted_descending(_visit_rows(), _queue_rows(), key=created_at_key)

    async def _rows():
        async for row in merged:
            created_at = coerce_created_at(row.get("created_at"))
            if created_at is None:
                continue
            if start_at is None or created_at >= start_at:
                yield row
            else:
                return

    async def _audit(row_count: int) -> None:
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="export",
            entity_id=org_id,
            action="visits_exported",
            summary="Exported patient visits as CSV.",
            metadata={"row_count": row_count, "range": range, "format": "csv"},
        )

    return _csv_response(_rows(), "patient_visits.csv", VISIT_EXPORT_FIELDNAMES, on_complete=_audit)


@router.get("/exports/invoices.csv")
async def export_invoices_csv(
    repo: AppRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    org_id = str(current_user.org_id)

    async def _rows():
        async for invoice in repo.iter_invoices_for_export(org_id):
            yield invoice_export_row(invoice)

    async def _audit(row_count: int) -> None:
        await write_audit_event_best_effort(
            repo,
            current_user,
            entity_type="export",
            entity_id=org_id,
            action="invoices_exported",
            summary="Exported invoices as CSV.",
            metadata={"row_count": row_count, "format": "csv"},
        )

    return _csv_response(_rows(), "invoices.csv", INVOICE_EXPORT_FIELDNAMES, on_complete=_audit)