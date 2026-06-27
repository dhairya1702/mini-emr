from typing import Any
from decimal import Decimal, ROUND_HALF_UP

from app.schema_domains.patients import PatientCreate, PatientVisitCreate, calculate_age_from_dob


class DuplicateCheckInCandidateError(ValueError):
    def __init__(self, matches: list[dict[str, Any]]) -> None:
        super().__init__("Possible duplicate active patients found.")
        self.matches = matches


def display_name(row: dict[str, Any]) -> str:
    stored_name = str(row.get("name") or "").strip()
    if stored_name:
        return stored_name

    identifier = str(row.get("identifier") or "").strip()
    if "@" in identifier:
        local_part = identifier.split("@", 1)[0]
        return local_part.replace(".", " ").replace("_", " ").strip().title() or "User"
    return identifier or "User"


def escape_ilike(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_").replace(",", "\\,")


def normalize_phone_number(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    digits = "".join(char for char in raw if char.isdigit())
    if raw.startswith("+") and digits:
        return f"+{digits}"
    return digits


def round_money(value: float) -> float:
    return float(
        Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    )


def decimal_quantity(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def decimal_money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def normalize_invoice_amount_paid(payment_status: str, amount_paid: float | None, total: float) -> float:
    normalized_total = round_money(total)
    if payment_status == "paid":
        return normalized_total
    if payment_status == "unpaid":
        return 0.0
    if amount_paid is None:
        raise ValueError("Enter the amount received for a partial invoice.")
    normalized_paid = round_money(amount_paid)
    if normalized_paid <= 0:
        raise ValueError("Partial invoices must record an amount greater than zero.")
    if normalized_paid >= normalized_total:
        raise ValueError("Partial invoice amount must be less than the invoice total.")
    return normalized_paid


def attach_invoice_balances(invoice: dict[str, Any]) -> dict[str, Any]:
    total = round_money(invoice.get("total") or 0)
    amount_paid = round_money(invoice.get("amount_paid") or 0)
    return {
        **invoice,
        "amount_paid": amount_paid,
        "balance_due": round_money(max(total - amount_paid, 0)),
    }


def visit_payload(payload: PatientCreate | PatientVisitCreate) -> dict[str, Any]:
    return {
        "name": payload.name.strip(),
        "phone": normalize_phone_number(payload.phone),
        "email": payload.email.strip().lower(),
        "address": payload.address.strip(),
        "reason": payload.reason.strip(),
        "date_of_birth": payload.date_of_birth.isoformat() if payload.date_of_birth else None,
        "age": payload.age if payload.age is not None else calculate_age_from_dob(payload.date_of_birth),
        "weight": payload.weight,
        "height": payload.height,
        "temperature": payload.temperature,
    }
