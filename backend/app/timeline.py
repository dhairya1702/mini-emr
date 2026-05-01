from app.formatting import build_visit_description, format_display_datetime, format_money
from app.schemas import PatientTimelineEvent


def build_patient_timeline(
    *,
    patient: dict,
    visits: list[dict],
    notes: list[dict],
    myopia_measurements: list[dict],
    invoices: list[dict],
    follow_ups: list[dict],
    appointments: list[dict],
) -> list[PatientTimelineEvent]:
    events: list[PatientTimelineEvent] = [
        PatientTimelineEvent(
            id=f"patient-created-{patient['id']}",
            type="patient_created",
            title="Patient record created",
            timestamp=patient["created_at"],
            description=f"Record opened with {patient['reason']} as the visit reason.",
            entity_type="patient",
            entity_id=str(patient["id"]),
            details={
                "name": str(patient.get("name") or ""),
                "phone": str(patient.get("phone") or ""),
                "email": str(patient.get("email") or ""),
                "address": str(patient.get("address") or ""),
                "reason": str(patient.get("reason") or ""),
                "age": patient.get("age"),
                "weight": patient.get("weight"),
                "height": patient.get("height"),
                "temperature": patient.get("temperature"),
                "status": str(patient.get("status") or ""),
                "billed": bool(patient.get("billed") or False),
            },
        )
    ]

    for visit in visits:
        events.append(
            PatientTimelineEvent(
                id=f"visit-{visit['id']}",
                type="visit_recorded",
                title="Visit recorded",
                timestamp=visit["created_at"],
                description=build_visit_description(visit),
                entity_type="visit",
                entity_id=str(visit["id"]),
                details={
                    "name": str(visit.get("name") or ""),
                    "phone": str(visit.get("phone") or ""),
                    "email": str(visit.get("email") or ""),
                    "address": str(visit.get("address") or ""),
                    "reason": str(visit.get("reason") or ""),
                    "age": visit.get("age"),
                    "weight": visit.get("weight"),
                    "height": visit.get("height"),
                    "temperature": visit.get("temperature"),
                    "source": str(visit.get("source") or ""),
                    "appointment_id": str(visit.get("appointment_id") or "") or None,
                    "status": str(visit.get("status") or ""),
                    "billed": bool(visit.get("billed") or False),
                },
            )
        )

    for note in notes:
        excerpt = str(note.get("snapshot_content") or note.get("content") or "").strip().replace("\n", " ")
        if len(excerpt) > 160:
            excerpt = f"{excerpt[:157]}..."
        note_status = str(note.get("status") or "draft")
        version_number = int(note.get("version_number") or 1)
        shared_bits = []
        if note.get("sent_to"):
            shared_bits.append(f"shared to {note['sent_to']}")
        if note.get("sent_by_name"):
            shared_bits.append(f"by {note['sent_by_name']}")
        if note.get("sent_at"):
            shared_bits.append(f"on {format_display_datetime(note['sent_at'])}")
        events.append(
            PatientTimelineEvent(
                id=f"note-{note['id']}",
                type="consultation_note",
                title=(
                    "Consultation note sent"
                    if note_status == "sent"
                    else "Consultation note finalized"
                    if note_status == "final"
                    else "Consultation note drafted"
                ),
                timestamp=note.get("sent_at") or note.get("finalized_at") or note["created_at"],
                description=(
                    f"V{version_number} · {excerpt or 'SOAP note saved.'} · status {note_status.replace('_', ' ')}"
                    + (f" · {' '.join(shared_bits)}" if shared_bits else "")
                ),
                entity_type="note",
                entity_id=str(note["id"]),
                details={
                    "version_number": version_number,
                    "status": note_status,
                    "content": str(note.get("snapshot_content") or note.get("content") or "").strip(),
                    "excerpt": excerpt,
                    "finalized_at": note.get("finalized_at"),
                    "sent_at": note.get("sent_at"),
                    "sent_to": str(note.get("sent_to") or ""),
                    "sent_by_name": str(note.get("sent_by_name") or ""),
                },
            )
        )

    for measurement in myopia_measurements:
        treatment = str(measurement.get("treatment_type") or "").strip()
        treatment_label = f" · {treatment}" if treatment else ""
        events.append(
            PatientTimelineEvent(
                id=f"myopia-{measurement['id']}",
                type="myopia_measurement",
                title="Myopia measurement recorded",
                timestamp=measurement["measured_at"],
                description=(
                    f"OD {float(measurement.get('axial_length_right_mm') or 0):.2f} mm · "
                    f"OS {float(measurement.get('axial_length_left_mm') or 0):.2f} mm · "
                    f"age {float(measurement.get('age_years') or 0):.1f}y{treatment_label}"
                ),
                entity_type="myopia_measurement",
                entity_id=str(measurement["id"]),
                details={
                    "measured_at": measurement.get("measured_at"),
                    "age_years": float(measurement.get("age_years") or 0),
                    "axial_length_right_mm": float(measurement.get("axial_length_right_mm") or 0),
                    "axial_length_left_mm": float(measurement.get("axial_length_left_mm") or 0),
                    "treatment_type": treatment,
                    "treatment_notes": str(measurement.get("treatment_notes") or ""),
                    "visit_notes": str(measurement.get("visit_notes") or ""),
                    "refraction_right": str(measurement.get("refraction_right") or ""),
                    "refraction_left": str(measurement.get("refraction_left") or ""),
                },
            )
        )

    for appointment in appointments:
        display_date = format_display_datetime(appointment["scheduled_for"])
        events.append(
            PatientTimelineEvent(
                id=f"appointment-booked-{appointment['id']}",
                type="appointment_booked",
                title="Appointment scheduled",
                timestamp=appointment["created_at"],
                description=f"Visit scheduled for {display_date}.",
                entity_type="appointment",
                entity_id=str(appointment["id"]),
                details={
                    "name": str(appointment.get("name") or ""),
                    "phone": str(appointment.get("phone") or ""),
                    "email": str(appointment.get("email") or ""),
                    "address": str(appointment.get("address") or ""),
                    "reason": str(appointment.get("reason") or ""),
                    "scheduled_for": appointment.get("scheduled_for"),
                    "status": str(appointment.get("status") or ""),
                },
            )
        )
        if appointment.get("checked_in_at"):
            events.append(
                PatientTimelineEvent(
                    id=f"appointment-checked-in-{appointment['id']}",
                    type="appointment_checked_in",
                    title="Checked in from appointment",
                    timestamp=appointment["checked_in_at"],
                    description="Patient moved from the schedule into the active queue.",
                    entity_type="appointment",
                    entity_id=str(appointment["id"]),
                    details={
                        "checked_in_at": appointment.get("checked_in_at"),
                        "checked_in_patient_id": str(appointment.get("checked_in_patient_id") or "") or None,
                        "scheduled_for": appointment.get("scheduled_for"),
                        "status": str(appointment.get("status") or ""),
                    },
                )
            )

    for invoice in invoices:
        item_count = len(invoice.get("items", []))
        payment_status = str(invoice.get("payment_status") or "unpaid")
        payment_summary = (
            "Payment complete."
            if payment_status == "paid"
            else f"Partial payment recorded. {format_money(invoice.get('balance_due'))} still due."
            if payment_status == "partial"
            else f"Payment still pending. {format_money(invoice.get('balance_due'))} still due."
        )
        events.append(
            PatientTimelineEvent(
                id=f"invoice-created-{invoice['id']}",
                type="invoice_created",
                title="Receipt created",
                timestamp=invoice["created_at"],
                description=(
                    f"{item_count} item{'s' if item_count != 1 else ''} recorded · total {float(invoice.get('total', 0)):.2f} · "
                    f"paid {format_money(invoice.get('amount_paid'))} · due {format_money(invoice.get('balance_due'))} · "
                    f"{payment_status} · {payment_summary}"
                ),
                entity_type="invoice",
                entity_id=str(invoice["id"]),
                details={
                    "patient_name": str(invoice.get("patient_name") or ""),
                    "total": float(invoice.get("total", 0) or 0),
                    "subtotal": float(invoice.get("subtotal", 0) or 0),
                    "amount_paid": float(invoice.get("amount_paid", 0) or 0),
                    "balance_due": float(invoice.get("balance_due", 0) or 0),
                    "payment_status": payment_status,
                    "item_count": item_count,
                    "items": invoice.get("items", []),
                    "completed_at": invoice.get("completed_at"),
                    "completed_by_name": str(invoice.get("completed_by_name") or ""),
                    "sent_at": invoice.get("sent_at"),
                },
            )
        )
        if invoice.get("sent_at"):
            completion_bits = []
            if invoice.get("completed_by_name"):
                completion_bits.append(f"Completed by {invoice['completed_by_name']}.")
            if invoice.get("sent_at"):
                completion_bits.append(f"Shared on {format_display_datetime(invoice['sent_at'])}.")
            events.append(
                PatientTimelineEvent(
                    id=f"invoice-sent-{invoice['id']}",
                    type="bill_sent",
                    title="Receipt shared",
                    timestamp=invoice["sent_at"],
                    description=(" ".join(completion_bits) + f" {payment_summary}").strip(),
                    entity_type="invoice",
                    entity_id=str(invoice["id"]),
                    details={
                        "patient_name": str(invoice.get("patient_name") or ""),
                        "recipient": str(invoice.get("sent_to") or ""),
                        "total": float(invoice.get("total", 0) or 0),
                        "amount_paid": float(invoice.get("amount_paid", 0) or 0),
                        "balance_due": float(invoice.get("balance_due", 0) or 0),
                        "payment_status": payment_status,
                        "completed_at": invoice.get("completed_at"),
                        "completed_by_name": str(invoice.get("completed_by_name") or ""),
                        "sent_at": invoice.get("sent_at"),
                        "items": invoice.get("items", []),
                    },
                )
            )

    for follow_up in follow_ups:
        scheduled_for = follow_up["scheduled_for"]
        display_date = format_display_datetime(scheduled_for)
        description = (
            f"Scheduled for {display_date}."
            if not str(follow_up.get("notes") or "").strip()
            else f"Scheduled for {display_date} · {str(follow_up.get('notes') or '').strip()}"
        )
        events.append(
            PatientTimelineEvent(
                id=f"follow-up-{follow_up['id']}",
                type="follow_up_scheduled",
                title="Follow-up scheduled",
                timestamp=scheduled_for,
                description=description,
                entity_type="follow_up",
                entity_id=str(follow_up["id"]),
                details={
                    "scheduled_for": scheduled_for,
                    "notes": str(follow_up.get("notes") or ""),
                    "status": str(follow_up.get("status") or ""),
                    "completed_at": follow_up.get("completed_at"),
                },
            )
        )
        if follow_up.get("completed_at"):
            completed_at = follow_up["completed_at"]
            completed_display_date = format_display_datetime(completed_at)
            events.append(
                PatientTimelineEvent(
                    id=f"follow-up-completed-{follow_up['id']}",
                    type="follow_up_completed",
                    title="Follow-up completed",
                    timestamp=completed_at,
                    description=f"Follow-up marked complete on {completed_display_date}.",
                    entity_type="follow_up",
                    entity_id=str(follow_up["id"]),
                    details={
                        "scheduled_for": scheduled_for,
                        "notes": str(follow_up.get("notes") or ""),
                        "status": str(follow_up.get("status") or ""),
                        "completed_at": completed_at,
                    },
                )
            )

    return sorted(events, key=lambda event: event.timestamp, reverse=True)
