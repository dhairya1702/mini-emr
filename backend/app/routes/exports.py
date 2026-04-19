from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.exports import (
    build_csv_response,
    build_history_visit_rows,
    filter_rows_by_created_at,
    get_export_range_start,
)
from app.schemas import UserOut


router = APIRouter()


@router.get("/exports/patients.csv")
async def export_patients_csv(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    patients = await repo.list_patients(str(current_user.org_id))
    return build_csv_response(
        "patients.csv",
        patients,
        [
            "name",
            "phone",
            "reason",
            "age",
            "weight",
            "height",
            "created_at",
            "last_visit_at",
        ],
    )


@router.get("/exports/visits.csv")
async def export_visits_csv(
    range: str = Query(default="all", pattern="^(today|7d|30d|month|all)$"),
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    visits = await repo.list_patient_visits(str(current_user.org_id))
    patients = await repo.list_patients(str(current_user.org_id))
    history_rows = build_history_visit_rows(visits, patients)
    try:
        start_at = get_export_range_start(range)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    filtered_rows = filter_rows_by_created_at([row.model_dump() for row in history_rows], start_at)
    return build_csv_response(
        "patient_visits.csv",
        filtered_rows,
        [
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
        ],
    )


@router.get("/exports/invoices.csv")
async def export_invoices_csv(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(require_admin),
) -> StreamingResponse:
    invoices = await repo.list_invoices(str(current_user.org_id))
    patients = await repo.list_patients(str(current_user.org_id))
    patient_names = {str(patient.get("id")): patient.get("name", "") for patient in patients}
    rows: list[dict] = []
    for invoice in invoices:
        rows.append(
            {
                "patient_name": patient_names.get(str(invoice.get("patient_id")), ""),
                "payment_status": invoice.get("payment_status"),
                "amount_paid": invoice.get("amount_paid"),
                "balance_due": invoice.get("balance_due"),
                "total": invoice.get("total"),
                "paid_at": invoice.get("paid_at"),
                "sent_at": invoice.get("sent_at"),
                "created_at": invoice.get("created_at"),
                "item_count": len(invoice.get("items", [])),
            }
        )
    return build_csv_response(
        "invoices.csv",
        rows,
        [
            "patient_name",
            "payment_status",
            "amount_paid",
            "balance_due",
            "total",
            "paid_at",
            "sent_at",
            "created_at",
            "item_count",
        ],
    )
