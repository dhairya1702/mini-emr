from app.db import SupabaseRepository
from app.schemas import UserOut


def get_actor_name(current_user: UserOut) -> str:
    return current_user.name.strip() or current_user.identifier.strip() or "Clinic User"


def user_names_by_id(users: list[dict]) -> dict[str, str]:
    return {str(user["id"]): str(user.get("name") or "").strip() for user in users}


async def write_audit_event(
    repo: SupabaseRepository,
    current_user: UserOut,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    metadata: dict | None = None,
) -> None:
    await repo.create_audit_event(
        org_id=str(current_user.org_id),
        actor_user_id=str(current_user.id),
        actor_name=get_actor_name(current_user),
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        summary=summary,
        metadata=metadata,
    )


async def record_patient_created(repo: SupabaseRepository, current_user: UserOut, patient: dict) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="patient",
        entity_id=str(patient["id"]),
        action="patient_created",
        summary=f"Added patient {patient['name']} to the queue.",
        metadata={"status": patient.get("status"), "phone": patient.get("phone")},
    )


async def record_patient_visit(repo: SupabaseRepository, current_user: UserOut, patient: dict) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="patient",
        entity_id=str(patient["id"]),
        action="patient_visit_recorded",
        summary=f"Recorded a new visit for patient {patient['name']}.",
        metadata={"status": patient.get("status"), "phone": patient.get("phone")},
    )


async def record_patient_updated(
    repo: SupabaseRepository,
    current_user: UserOut,
    patient: dict,
    changed_fields: list[str],
) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="patient",
        entity_id=str(patient["id"]),
        action="patient_updated",
        summary=f"Updated patient {patient['name']}: {', '.join(changed_fields)}.",
        metadata={"changed_fields": changed_fields},
    )


async def record_appointment_created(repo: SupabaseRepository, current_user: UserOut, appointment: dict) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="appointment",
        entity_id=str(appointment["id"]),
        action="appointment_created",
        summary=f"Booked appointment for {appointment['name']} on {appointment['scheduled_for']}.",
        metadata={"patient_name": appointment.get("name"), "status": appointment.get("status")},
    )


async def record_appointment_checked_in(
    repo: SupabaseRepository,
    current_user: UserOut,
    appointment_id: str,
    patient: dict,
) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="appointment",
        entity_id=appointment_id,
        action="appointment_checked_in",
        summary=f"Checked in appointment into patient record {patient['name']}.",
        metadata={"checked_in_patient_id": str(patient["id"])},
    )


async def record_appointment_updated(
    repo: SupabaseRepository,
    current_user: UserOut,
    appointment: dict,
    changed_fields: list[str],
) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="appointment",
        entity_id=str(appointment["id"]),
        action="appointment_updated",
        summary=f"Updated appointment fields: {', '.join(changed_fields)}.",
        metadata={"changed_fields": changed_fields, "status": appointment.get("status")},
    )


async def record_follow_up_created(
    repo: SupabaseRepository,
    current_user: UserOut,
    follow_up: dict,
    patient_name: str,
    formatted_scheduled_for: str,
) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="follow_up",
        entity_id=str(follow_up["id"]),
        action="follow_up_created",
        summary=f"Scheduled follow-up for {patient_name} on {formatted_scheduled_for}.",
        metadata={
            "patient_id": str(follow_up["patient_id"]),
            "patient_name": patient_name,
            "status": follow_up.get("status"),
        },
    )


async def record_follow_up_updated(
    repo: SupabaseRepository,
    current_user: UserOut,
    follow_up: dict,
    changed_fields: list[str],
) -> None:
    action = "follow_up_completed" if follow_up.get("status") == "completed" else "follow_up_updated"
    await write_audit_event(
        repo,
        current_user,
        entity_type="follow_up",
        entity_id=str(follow_up["id"]),
        action=action,
        summary=f"Updated follow-up fields: {', '.join(changed_fields)}.",
        metadata={"changed_fields": changed_fields, "status": follow_up.get("status")},
    )


async def record_invoice_created(
    repo: SupabaseRepository,
    current_user: UserOut,
    invoice: dict,
    patient_name: str,
) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="invoice",
        entity_id=str(invoice["id"]),
        action="invoice_created",
        summary=f"Created invoice for {patient_name} totaling {float(invoice.get('total', 0)):.2f}.",
        metadata={
            "patient_id": str(invoice["patient_id"]),
            "patient_name": patient_name,
            "item_count": len(invoice.get("items", [])),
            "payment_status": invoice.get("payment_status"),
            "amount_paid": invoice.get("amount_paid"),
            "balance_due": invoice.get("balance_due"),
        },
    )


async def record_invoice_shared(
    repo: SupabaseRepository,
    current_user: UserOut,
    invoice_id: str,
    finalized: dict,
    *,
    patient_name: str,
    recipient: str,
    stock_deductions: list[dict],
    amount_paid: object,
    balance_due: object,
) -> None:
    await write_audit_event(
        repo,
        current_user,
        entity_type="invoice",
        entity_id=str(invoice_id),
        action="invoice_shared",
        summary=f"Shared invoice for {patient_name} with {recipient}.",
        metadata={
            "patient_id": finalized.get("patient_id"),
            "patient_name": patient_name,
            "recipient": recipient,
            "completed_at": finalized.get("completed_at"),
            "completed_by": finalized.get("completed_by"),
            "completed_by_name": get_actor_name(current_user),
            "sent_at": finalized.get("sent_at"),
            "already_finalized": finalized.get("already_finalized", False),
            "stock_deductions": finalized.get("stock_deductions", stock_deductions),
            "amount_paid": amount_paid,
            "balance_due": balance_due,
        },
    )
