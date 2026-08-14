import csv
from collections.abc import AsyncIterator, Iterable, Iterator
from datetime import UTC, datetime, timedelta
from io import StringIO

from fastapi.responses import StreamingResponse

from app.formatting import format_export_datetime
from app.schema_domains.patients import PatientVisitOut

DATETIME_FIELDS = {
    "created_at",
    "updated_at",
    "last_visit_at",
    "scheduled_for",
    "checked_in_at",
    "completed_at",
    "paid_at",
    "sent_at",
}

EXPORT_PAGE_SIZE = 500

_MIN_DATETIME = datetime.min.replace(tzinfo=UTC)


def build_csv_response(filename: str, rows: Iterable[dict], fieldnames: list[str]) -> StreamingResponse:
    return StreamingResponse(
        iter_csv_chunks(rows, fieldnames),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def iter_csv_chunks(rows: Iterable[dict], fieldnames: list[str], chunk_size: int = EXPORT_PAGE_SIZE) -> Iterator[str]:
    yield _csv_header(fieldnames)
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    written = 0
    for row in rows:
        writer.writerow(_serialize_row(row, fieldnames))
        written += 1
        if written % chunk_size == 0:
            yield buffer.getvalue()
            buffer = StringIO()
            writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    tail = buffer.getvalue()
    if tail:
        yield tail


async def stream_csv_chunks(
    async_rows: AsyncIterator[dict],
    fieldnames: list[str],
    *,
    chunk_size: int = EXPORT_PAGE_SIZE,
    on_complete=None,
) -> AsyncIterator[str]:
    yield _csv_header(fieldnames)
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    written = 0
    async for row in async_rows:
        writer.writerow(_serialize_row(row, fieldnames))
        written += 1
        if written % chunk_size == 0:
            yield buffer.getvalue()
            buffer = StringIO()
            writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    tail = buffer.getvalue()
    if tail:
        yield tail
    if on_complete is not None:
        await on_complete(written)


def _csv_header(fieldnames: list[str]) -> str:
    buffer = StringIO()
    csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore").writeheader()
    return buffer.getvalue()


def _serialize_row(row: dict, fieldnames: list[str]) -> dict:
    return {
        key: (
            format_export_datetime(row.get(key))
            if key in DATETIME_FIELDS
            else _csv_safe_value(row.get(key))
        )
        for key in fieldnames
    }


def _csv_safe_value(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def invoice_export_row(invoice: dict) -> dict:
    return {
        "patient_name": invoice.get("patient_name") or "",
        "payment_status": invoice.get("payment_status"),
        "amount_paid": invoice.get("amount_paid"),
        "balance_due": invoice.get("balance_due"),
        "total": invoice.get("total"),
        "paid_at": invoice.get("paid_at"),
        "sent_at": invoice.get("sent_at"),
        "created_at": invoice.get("created_at"),
        "item_count": len(invoice.get("items") or []),
    }


def queue_patient_export_row(patient: dict) -> dict:
    return {
        **patient,
        "source": "queue",
        "created_at": patient.get("last_visit_at"),
    }


def coerce_created_at(value) -> datetime | None:
    if isinstance(value, datetime):
        created_at = value
    else:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            created_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    return created_at


def created_at_key(value) -> datetime:
    return coerce_created_at(value) or _MIN_DATETIME


async def merge_sorted_descending(
    left: AsyncIterator[dict],
    right: AsyncIterator[dict],
    *,
    key,
) -> AsyncIterator[dict]:
    left_iter = left.__aiter__()
    right_iter = right.__aiter__()

    left_peek: dict | None = None
    right_peek: dict | None = None
    left_done = False
    right_done = False

    async def _advance_left() -> None:
        nonlocal left_peek, left_done
        if left_done:
            left_peek = None
            return
        try:
            left_peek = await left_iter.__anext__()
        except StopAsyncIteration:
            left_done = True
            left_peek = None

    async def _advance_right() -> None:
        nonlocal right_peek, right_done
        if right_done:
            right_peek = None
            return
        try:
            right_peek = await right_iter.__anext__()
        except StopAsyncIteration:
            right_done = True
            right_peek = None

    await _advance_left()
    await _advance_right()
    while left_peek is not None or right_peek is not None:
        if right_peek is None or (left_peek is not None and key(left_peek) >= key(right_peek)):
            row = left_peek
            await _advance_left()
        else:
            row = right_peek
            await _advance_right()
        yield row


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