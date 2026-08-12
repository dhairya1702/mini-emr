from __future__ import annotations

import hashlib
import hmac
import json
import re
import asyncio
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.clinic_timezone import as_clinic_time, clinic_today, utc_day_bounds_for_clinic
from app.db import AppRepository
from app.services.whatsapp_client import WhatsAppClient, WhatsAppClientError


HELP_TEXT = (
    "Try: today summary, revenue today, revenue this week, revenue this month, "
    "total revenue, patients today, patients this week, patients this month, "
    "total patients, today appointments, tomorrow appointments, appointments this week, "
    "pending payments, followups due."
)


@dataclass(frozen=True)
class WhatsAppInboundMessage:
    message_id: str
    from_wa_id: str
    text: str
    contact_name: str
    phone_number_id: str
    raw_payload: dict[str, Any]


@dataclass(frozen=True)
class WhatsAppDeliveryStatus:
    message_id: str
    status: str
    recipient_wa_id: str
    error: str
    raw_payload: dict[str, Any]


def verify_whatsapp_signature(*, app_secret: str, signature_header: str | None, body: bytes) -> bool:
    if not app_secret:
        return False
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(app_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def parse_whatsapp_messages(payload: dict[str, Any]) -> list[WhatsAppInboundMessage]:
    parsed: list[WhatsAppInboundMessage] = []
    for entry in payload.get("entry", []) if isinstance(payload, dict) else []:
        for change in entry.get("changes", []) if isinstance(entry, dict) else []:
            value = change.get("value") if isinstance(change, dict) else {}
            if not isinstance(value, dict):
                continue
            phone_number_id = str((value.get("metadata") or {}).get("phone_number_id") or "")
            contacts_by_wa_id = {
                str(contact.get("wa_id") or ""): str((contact.get("profile") or {}).get("name") or "")
                for contact in value.get("contacts", [])
                if isinstance(contact, dict)
            }
            for message in value.get("messages", []):
                if not isinstance(message, dict) or message.get("type") != "text":
                    continue
                from_wa_id = str(message.get("from") or "")
                text = str((message.get("text") or {}).get("body") or "").strip()
                if not from_wa_id or not text:
                    continue
                parsed.append(
                    WhatsAppInboundMessage(
                        message_id=str(message.get("id") or ""),
                        from_wa_id=from_wa_id,
                        text=text,
                        contact_name=contacts_by_wa_id.get(from_wa_id, ""),
                        phone_number_id=phone_number_id,
                        raw_payload=payload,
                    )
                )
    return parsed


def parse_whatsapp_statuses(payload: dict[str, Any]) -> list[WhatsAppDeliveryStatus]:
    parsed: list[WhatsAppDeliveryStatus] = []
    for entry in payload.get("entry", []) if isinstance(payload, dict) else []:
        for change in entry.get("changes", []) if isinstance(entry, dict) else []:
            value = change.get("value") if isinstance(change, dict) else {}
            if not isinstance(value, dict):
                continue
            for status_payload in value.get("statuses", []):
                if not isinstance(status_payload, dict):
                    continue
                message_id = str(status_payload.get("id") or "").strip()
                status = str(status_payload.get("status") or "").strip().lower()
                if not message_id or status not in {"sent", "delivered", "read", "failed"}:
                    continue
                errors = status_payload.get("errors") if isinstance(status_payload.get("errors"), list) else []
                error_parts: list[str] = []
                for item in errors:
                    if not isinstance(item, dict):
                        continue
                    code = str(item.get("code") or "").strip()
                    title = str(item.get("title") or item.get("message") or "").strip()
                    detail = str((item.get("error_data") or {}).get("details") or "").strip()
                    error_parts.append(" - ".join(part for part in (code, title, detail) if part))
                parsed.append(
                    WhatsAppDeliveryStatus(
                        message_id=message_id,
                        status=status,
                        recipient_wa_id=str(status_payload.get("recipient_id") or "").strip(),
                        error="; ".join(part for part in error_parts if part),
                        raw_payload={"provider_status": status_payload},
                    )
                )
    return parsed


def classify_intent(text: str) -> str:
    normalized = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized or normalized in {"help", "hi", "hello", "hey", "menu"}:
        return "help"
    if "appointment" in normalized and "week" in normalized:
        return "appointments_this_week"
    if "tomorrow" in normalized and ("appointment" in normalized or "coming" in normalized or "who" in normalized):
        return "appointments_tomorrow"
    if "today" in normalized and ("appointment" in normalized or "coming" in normalized or "who" in normalized):
        return "appointments_today"
    if "follow" in normalized or "review" in normalized:
        return "followups_due"
    if "pending" in normalized or "unpaid" in normalized or "due payment" in normalized:
        return "pending_payments"
    if "revenue" in normalized or "collection" in normalized or "how much" in normalized or "made" in normalized:
        if "month" in normalized:
            return "revenue_this_month"
        if "week" in normalized:
            return "revenue_this_week"
        if "yesterday" in normalized:
            return "revenue_yesterday"
        if "total" in normalized or "all time" in normalized or "lifetime" in normalized:
            return "total_revenue"
        return "revenue_today"
    if "total patient" in normalized:
        return "total_patients"
    if "patient" in normalized and "month" in normalized:
        return "patients_this_month"
    if "patient" in normalized and "week" in normalized:
        return "patients_this_week"
    if "patient" in normalized and "today" in normalized:
        return "patients_today"
    if "summary" in normalized and "today" in normalized:
        return "today_summary"
    return "help"


def _money(value: float) -> str:
    return f"Rs. {value:,.2f}"


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _in_range(value: Any, start_iso: str, end_iso: str) -> bool:
    parsed = _as_datetime(value)
    start = _as_datetime(start_iso)
    end = _as_datetime(end_iso)
    return start <= parsed < end


async def _day_bounds(repo: AppRepository, org_id: str, offset_days: int = 0) -> tuple[dict, date, str, str]:
    clinic_settings = await repo.get_clinic_settings(org_id)
    effective_day = clinic_today(clinic_settings) + timedelta(days=offset_days)
    start, end = utc_day_bounds_for_clinic(effective_day, clinic_settings)
    return clinic_settings, effective_day, start, end


def _week_bounds(effective_day: date, clinic_settings: dict) -> tuple[str, str]:
    start_day = effective_day - timedelta(days=effective_day.weekday())
    end_day = start_day + timedelta(days=7)
    start, _ = utc_day_bounds_for_clinic(start_day, clinic_settings)
    end, _unused = utc_day_bounds_for_clinic(end_day, clinic_settings)
    return start, end


def _month_bounds(effective_day: date, clinic_settings: dict) -> tuple[str, str]:
    start_day = effective_day.replace(day=1)
    if start_day.month == 12:
        end_day = start_day.replace(year=start_day.year + 1, month=1)
    else:
        end_day = start_day.replace(month=start_day.month + 1)
    start, _ = utc_day_bounds_for_clinic(start_day, clinic_settings)
    end, _unused = utc_day_bounds_for_clinic(end_day, clinic_settings)
    return start, end


def _format_time(value: Any, clinic_settings: dict) -> str:
    return as_clinic_time(_as_datetime(value), clinic_settings).strftime("%I:%M %p").lstrip("0")


def _revenue_for_invoices(invoices: list[dict[str, Any]], start: str | None = None, end: str | None = None) -> tuple[float, int]:
    filtered = [
        invoice for invoice in invoices
        if start is None or end is None or _in_range(invoice.get("created_at"), start, end)
    ]
    return sum(float(invoice.get("amount_paid") or 0) for invoice in filtered), len(filtered)


def _pending_total(invoices: list[dict[str, Any]]) -> tuple[float, int]:
    pending_invoices = [
        invoice for invoice in invoices
        if str(invoice.get("payment_status") or "") in {"unpaid", "partial"}
    ]
    total = sum(
        float(
            invoice.get("balance_due")
            if invoice.get("balance_due") is not None
            else float(invoice.get("total") or 0) - float(invoice.get("amount_paid") or 0)
        )
        for invoice in pending_invoices
    )
    return total, len(pending_invoices)


def _visits_in_range(visits: list[dict[str, Any]], start: str, end: str) -> list[dict[str, Any]]:
    return [visit for visit in visits if _in_range(visit.get("created_at"), start, end)]


async def build_assistant_reply(repo: AppRepository, org_id: str, intent: str) -> str:
    if intent == "help":
        return HELP_TEXT
    clinic_settings, effective_day, start, end = await _day_bounds(
        repo,
        org_id,
        offset_days=1 if intent == "appointments_tomorrow" else 0,
    )
    if intent in {"appointments_today", "appointments_tomorrow", "appointments_this_week"}:
        if intent == "appointments_this_week":
            start, end = _week_bounds(effective_day, clinic_settings)
        appointments = await repo.list_appointments(
            org_id,
            status="scheduled",
            limit=10,
            scheduled_from=start,
            scheduled_to=end,
        )
        label = (
            "This week"
            if intent == "appointments_this_week"
            else "Tomorrow"
            if intent == "appointments_tomorrow"
            else "Today"
        )
        if not appointments:
            return f"{label}: no scheduled appointments."
        lines = [f"{label}'s appointments ({len(appointments)} shown):"]
        for appointment in appointments:
            reason = str(appointment.get("reason") or "").strip()
            suffix = f" - {reason}" if reason else ""
            lines.append(f"{_format_time(appointment['scheduled_for'], clinic_settings)} - {appointment['name']}{suffix}")
        return "\n".join(lines)
    if intent == "followups_due":
        followups = await repo.list_follow_ups(
            org_id,
            status="scheduled",
            limit=10,
            scheduled_from=start,
            scheduled_to=end,
        )
        if not followups:
            return "Today: no follow-ups due."
        lines = [f"Follow-ups due today ({len(followups)} shown):"]
        for followup in followups:
            notes = str(followup.get("notes") or "").strip()
            suffix = f" - {notes}" if notes else ""
            lines.append(f"{_format_time(followup['scheduled_for'], clinic_settings)} - {followup.get('patient_name') or 'Patient'}{suffix}")
        return "\n".join(lines)

    invoices = await repo.list_invoices(org_id, limit=None)
    revenue_today, today_invoice_count = _revenue_for_invoices(invoices, start, end)
    pending_total, pending_count = _pending_total(invoices)
    if intent == "revenue_today":
        return f"Revenue recorded today: {_money(revenue_today)} from {today_invoice_count} invoice(s)."
    if intent == "revenue_yesterday":
        _settings, yesterday, yesterday_start, yesterday_end = await _day_bounds(repo, org_id, offset_days=-1)
        revenue, invoice_count = _revenue_for_invoices(invoices, yesterday_start, yesterday_end)
        return f"Revenue recorded yesterday ({yesterday.isoformat()}): {_money(revenue)} from {invoice_count} invoice(s)."
    if intent == "revenue_this_week":
        week_start, week_end = _week_bounds(effective_day, clinic_settings)
        revenue, invoice_count = _revenue_for_invoices(invoices, week_start, week_end)
        return f"Revenue recorded this week: {_money(revenue)} from {invoice_count} invoice(s)."
    if intent == "revenue_this_month":
        month_start, month_end = _month_bounds(effective_day, clinic_settings)
        revenue, invoice_count = _revenue_for_invoices(invoices, month_start, month_end)
        return f"Revenue recorded this month: {_money(revenue)} from {invoice_count} invoice(s)."
    if intent == "total_revenue":
        revenue, invoice_count = _revenue_for_invoices(invoices)
        return f"Total recorded revenue: {_money(revenue)} from {invoice_count} invoice(s)."
    if intent == "pending_payments":
        return f"Pending payments: {_money(pending_total)} across {pending_count} invoice(s)."

    visits = await repo.list_patient_visits(org_id)
    visits_today = _visits_in_range(visits, start, end)
    if intent == "patients_today":
        return f"Patients seen today: {len(visits_today)}."
    if intent == "patients_this_week":
        week_start, week_end = _week_bounds(effective_day, clinic_settings)
        return f"Patients seen this week: {len(_visits_in_range(visits, week_start, week_end))} visit(s)."
    if intent == "patients_this_month":
        month_start, month_end = _month_bounds(effective_day, clinic_settings)
        return f"Patients seen this month: {len(_visits_in_range(visits, month_start, month_end))} visit(s)."
    if intent == "total_patients":
        patients = await repo.list_patients(org_id, limit=10000, include_queue_context=False)
        return f"Total patient records: {len(patients)}."
    if intent == "today_summary":
        appointments_left = await repo.list_appointments(
            org_id,
            status="scheduled",
            limit=200,
            scheduled_from=start,
            scheduled_to=end,
        )
        followups_due = await repo.list_follow_ups(
            org_id,
            status="scheduled",
            limit=200,
            scheduled_from=start,
            scheduled_to=end,
        )
        return "\n".join(
            [
                f"Today summary ({effective_day.isoformat()}):",
                f"Patients seen: {len(visits_today)}",
                f"Revenue recorded: {_money(revenue_today)}",
                f"Pending payments: {_money(pending_total)}",
                f"Appointments left: {len(appointments_left)}",
                f"Follow-ups due: {len(followups_due)}",
            ]
        )
    return HELP_TEXT


async def handle_inbound_message(
    *,
    repo: AppRepository,
    client: WhatsAppClient,
    message: WhatsAppInboundMessage,
    enabled: bool,
) -> str:
    binding = await repo.get_whatsapp_owner_binding(message.from_wa_id)
    if not binding or not enabled:
        await repo.record_whatsapp_message_event(
            org_id=str(binding["org_id"]) if binding else None,
            binding_id=str(binding["id"]) if binding else None,
            direction="inbound",
            wa_message_id=message.message_id,
            sender_wa_id=message.from_wa_id,
            message_text=message.text,
            status="ignored",
            raw_payload=message.raw_payload,
        )
        return "ignored"

    org_id = str(binding["org_id"])
    binding_id = str(binding["id"])
    intent = classify_intent(message.text)
    await repo.record_whatsapp_message_event(
        org_id=org_id,
        binding_id=binding_id,
        direction="inbound",
        wa_message_id=message.message_id,
        sender_wa_id=message.from_wa_id,
        message_text=message.text,
        intent=intent,
        status="received",
        raw_payload=message.raw_payload,
    )
    reply = await build_assistant_reply(repo, org_id, intent)
    try:
        result = await asyncio.to_thread(
            client.send_text,
            to=message.from_wa_id,
            body=reply,
            reply_to_message_id=message.message_id,
        )
    except WhatsAppClientError as exc:
        await repo.record_whatsapp_message_event(
            org_id=org_id,
            binding_id=binding_id,
            direction="outbound",
            recipient_wa_id=message.from_wa_id,
            message_text=reply,
            intent=intent,
            status="failed",
            error=str(exc),
        )
        return "failed"
    await repo.record_whatsapp_message_event(
        org_id=org_id,
        binding_id=binding_id,
        direction="outbound",
        wa_message_id=result.message_id,
        recipient_wa_id=message.from_wa_id,
        message_text=reply,
        intent=intent,
        status="sent",
        raw_payload=result.raw,
    )
    return "sent"
