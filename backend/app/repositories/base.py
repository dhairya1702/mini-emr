from __future__ import annotations

from typing import Any

from supabase import Client

from app.schemas import PatientCreate, PatientVisitCreate


class DuplicateCheckInCandidateError(ValueError):
    def __init__(self, matches: list[dict[str, Any]]) -> None:
        super().__init__("Possible duplicate active patients found.")
        self.matches = matches


class BaseSupabaseRepository:
    client: Client


def display_name(row: dict[str, Any]) -> str:
    stored_name = str(row.get("name") or "").strip()
    if stored_name:
        return stored_name

    identifier = str(row.get("identifier") or "").strip()
    if "@" in identifier:
        local_part = identifier.split("@", 1)[0]
        return local_part.replace(".", " ").replace("_", " ").strip().title() or "User"
    return identifier or "User"


def rpc_single(result: Any) -> dict[str, Any]:
    if isinstance(result, list):
        return result[0] if result else {}
    return result or {}


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
    return round(float(value), 2)


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
        "reason": payload.reason.strip(),
        "age": payload.age,
        "weight": payload.weight,
        "height": payload.height,
        "temperature": payload.temperature,
    }


def find_check_in_matches(client: Client, org_id: str, appointment_id: str) -> list[dict[str, Any]]:
    appointment = (
        client.table("appointments")
        .select("*")
        .eq("org_id", org_id)
        .eq("id", appointment_id)
        .single()
        .execute()
        .data
    )
    if not appointment:
        raise ValueError("Appointment not found for this organization.")

    normalized_phone = normalize_phone_number(appointment.get("phone"))
    if not normalized_phone:
        return []

    candidates = (
        client.table("patients")
        .select("*")
        .eq("org_id", org_id)
        .eq("billed", False)
        .order("last_visit_at", desc=True)
        .limit(50)
        .execute()
        .data
    )
    return [
        candidate
        for candidate in candidates
        if normalize_phone_number(candidate.get("phone")) == normalized_phone
    ]
