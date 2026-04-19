import csv
from datetime import UTC, datetime, timedelta
from io import StringIO

from fastapi.responses import StreamingResponse

from app.formatting import format_export_datetime
from app.schemas import PatientVisitOut


def build_csv_response(filename: str, rows: list[dict], fieldnames: list[str]) -> StreamingResponse:
    datetime_fields = {
        "created_at",
        "updated_at",
        "last_visit_at",
        "scheduled_for",
        "checked_in_at",
        "completed_at",
        "paid_at",
        "sent_at",
    }
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                key: format_export_datetime(row.get(key)) if key in datetime_fields else row.get(key)
                for key in fieldnames
            }
        )
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def build_history_visit_rows(visits: list[dict], patients: list[dict]) -> list[PatientVisitOut]:
    patients_by_id = {str(patient["id"]): patient for patient in patients}
    visit_counts_by_patient: dict[str, int] = {}
    rows: list[PatientVisitOut] = []
    for visit in visits:
        patient_id = str(visit["patient_id"])
        visit_counts_by_patient[patient_id] = visit_counts_by_patient.get(patient_id, 0) + 1
        patient = patients_by_id.get(patient_id)
        if not patient:
            continue
        rows.append(
            PatientVisitOut(
                **visit,
                status=patient["status"],
                billed=patient.get("billed", False),
                last_visit_at=patient["last_visit_at"],
            )
        )

    for patient in patients:
        patient_id = str(patient["id"])
        if visit_counts_by_patient.get(patient_id):
            continue
        rows.append(
            PatientVisitOut(
                id=patient["id"],
                patient_id=patient["id"],
                name=patient["name"],
                phone=patient["phone"],
                reason=patient["reason"],
                age=patient.get("age"),
                weight=patient.get("weight"),
                height=patient.get("height"),
                temperature=patient.get("temperature"),
                source="queue",
                appointment_id=None,
                created_at=patient["last_visit_at"],
                status=patient["status"],
                billed=patient.get("billed", False),
                last_visit_at=patient["last_visit_at"],
            )
        )

    rows.sort(key=lambda visit: visit.created_at, reverse=True)
    return rows


def get_export_range_start(range_name: str | None) -> datetime | None:
    if not range_name or range_name == "all":
        return None

    now = datetime.now().astimezone()
    if range_name == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if range_name == "7d":
        return now - timedelta(days=7)
    if range_name == "30d":
        return now - timedelta(days=30)
    if range_name == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    raise ValueError("Invalid export range.")


def filter_rows_by_created_at(rows: list[dict], start_at: datetime | None) -> list[dict]:
    if start_at is None:
        return rows

    filtered: list[dict] = []
    for row in rows:
        raw_value = row.get("created_at")
        if not raw_value:
            continue
        if isinstance(raw_value, datetime):
            created_at = raw_value
        else:
            try:
                created_at = datetime.fromisoformat(str(raw_value).replace("Z", "+00:00"))
            except ValueError:
                continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if created_at.astimezone(start_at.tzinfo) >= start_at:
            filtered.append(row)
    return filtered
