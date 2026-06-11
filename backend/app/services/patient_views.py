from app.db import SupabaseRepository
from app.schema_domains.billing import InvoiceOut
from app.schema_domains.optometry import MyopiaDeltaOut, MyopiaHistoryOut, MyopiaMeasurementOut
from app.schema_domains.patients import (
    NoteOut,
    PatientChartVisitOut,
    PatientTimelineEvent,
    PatientVisitAttachmentRowOut,
    PatientVisitDetailOut,
    PatientVisitNoteDetailOut,
)
from app.schema_domains.specialty import (
    PediatricGrowthDeltaOut,
    PediatricGrowthMeasurementOut,
    PediatricGrowthSummaryOut,
)
from app.services.audit_service import user_names_by_id
from app.timeline import build_patient_timeline


def _build_myopia_delta(current: dict, previous: dict) -> MyopiaDeltaOut:
    return MyopiaDeltaOut(
        right_mm=round(float(current["axial_length_right_mm"]) - float(previous["axial_length_right_mm"]), 3),
        left_mm=round(float(current["axial_length_left_mm"]) - float(previous["axial_length_left_mm"]), 3),
    )


async def build_patient_myopia_history_view(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
) -> MyopiaHistoryOut:
    await repo.get_patient(org_id, patient_id)
    records = await repo.list_myopia_measurements_for_patient(org_id, patient_id)
    typed_records = [MyopiaMeasurementOut(**record) for record in records]

    baseline_delta = None
    last_delta = None
    annualized_growth = None

    if len(records) >= 2:
        baseline_delta = _build_myopia_delta(records[-1], records[0])
        last_delta = _build_myopia_delta(records[-1], records[-2])
        day_span = (typed_records[-1].measured_at - typed_records[0].measured_at).total_seconds() / 86400
        if day_span > 0:
            annualized_growth = MyopiaDeltaOut(
                right_mm=round(baseline_delta.right_mm / day_span * 365.25, 3),
                left_mm=round(baseline_delta.left_mm / day_span * 365.25, 3),
            )

    return MyopiaHistoryOut(
        patient_id=patient_id,
        records=typed_records,
        baseline_delta=baseline_delta,
        last_delta=last_delta,
        annualized_growth=annualized_growth,
        overlay_version="clinic-reference-v1",
    )


def _patient_age_months_on(measured_at, patient: dict) -> int | None:
    patient_age_years = patient.get("age")
    created_at = patient.get("created_at")
    if patient_age_years is None or created_at is None:
        return None
    day_span = (measured_at - created_at).total_seconds() / 86400
    approximate_months = round(float(patient_age_years) * 12 + (day_span / 30.4375))
    return max(approximate_months, 0)


def _build_growth_record(track: dict, patient: dict) -> PediatricGrowthMeasurementOut:
    raw = track.get("raw_payload") or {}
    derived = track.get("derived_metrics") or {}
    return PediatricGrowthMeasurementOut(
        measured_at=track["measured_at"],
        age_months=_patient_age_months_on(track["measured_at"], patient),
        height_cm=float(raw.get("height_cm") or track.get("summary_fields", {}).get("height_cm") or 0),
        weight_kg=float(raw.get("weight_kg") or track.get("summary_fields", {}).get("weight_kg") or 0),
        bmi=float(derived.get("bmi") or 0),
        head_circumference_cm=(
            float(raw["head_circumference_cm"])
            if raw.get("head_circumference_cm") is not None
            else None
        ),
        visit_notes=str(raw.get("visit_notes") or ""),
        track_id=str(track["id"]),
        created_at=track["created_at"],
    )


async def build_patient_growth_history_view(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
) -> PediatricGrowthSummaryOut:
    patient = await repo.get_patient(org_id, patient_id)
    records = [
        _build_growth_record(track, patient)
        for track in await repo.list_longitudinal_tracks_for_patient(org_id, patient_id, track_type="growth_measurement")
    ]
    latest = records[-1] if records else None
    previous = records[-2] if len(records) > 1 else None
    interval_change = None
    if latest and previous:
        interval_change = PediatricGrowthDeltaOut(
            height_cm=round(latest.height_cm - previous.height_cm, 2),
            weight_kg=round(latest.weight_kg - previous.weight_kg, 2),
            bmi=round(latest.bmi - previous.bmi, 2),
        )
    trend_bits: list[str] = []
    if interval_change:
        if interval_change.height_cm:
            trend_bits.append(f"height {interval_change.height_cm:+g} cm")
        if interval_change.weight_kg:
            trend_bits.append(f"weight {interval_change.weight_kg:+g} kg")
    flags: list[str] = []
    if latest and latest.bmi < 13:
        flags.append("Low BMI review suggested.")
    if latest and latest.bmi > 25:
        flags.append("High BMI review suggested.")
    return PediatricGrowthSummaryOut(
        patient_id=patient_id,
        latest_measurement=latest,
        previous_measurement=previous,
        interval_change=interval_change,
        trend_summary=", ".join(trend_bits) if trend_bits else "Insufficient measurements for interval trend.",
        flags=flags,
        records=records,
    )


async def build_user_name_map(repo: SupabaseRepository, org_id: str) -> dict[str, str]:
    users = await repo.list_users(org_id)
    return user_names_by_id(users)


async def build_patient_name_map(repo: SupabaseRepository, org_id: str) -> dict[str, str]:
    patients = await repo.list_patients(org_id)
    return {
        str(patient["id"]): str(patient.get("name") or "").strip()
        for patient in patients
    }


async def build_patient_name_map_for_ids(repo: SupabaseRepository, org_id: str, patient_ids: list[str]) -> dict[str, str]:
    patients = await repo.list_patients_by_ids(org_id, patient_ids)
    return {
        str(patient["id"]): str(patient.get("name") or "").strip()
        for patient in patients
    }


def enrich_notes_with_sender_names(notes: list[dict], names: dict[str, str]) -> list[dict]:
    return [
        {
            **note,
            "sent_by_name": names.get(str(note.get("sent_by") or "")),
        }
        for note in notes
    ]


def enrich_invoices_with_completer_names(invoices: list[dict], names: dict[str, str]) -> list[dict]:
    return [
        {
            **invoice,
            "completed_by_name": names.get(str(invoice.get("completed_by") or "")),
        }
        for invoice in invoices
    ]


def enrich_invoices_with_patient_names(invoices: list[dict], names: dict[str, str]) -> list[dict]:
    return [
        {
            **invoice,
            "patient_name": names.get(str(invoice.get("patient_id") or "")) or None,
        }
        for invoice in invoices
    ]


async def list_patient_notes_view(repo: SupabaseRepository, org_id: str, patient_id: str) -> list[NoteOut]:
    await repo.get_patient(org_id, patient_id)
    notes = await repo.list_notes_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    return [NoteOut(**note) for note in enrich_notes_with_sender_names(notes, names)]


async def list_patient_invoices_view(repo: SupabaseRepository, org_id: str, patient_id: str) -> list[InvoiceOut]:
    patient = await repo.get_patient(org_id, patient_id)
    invoices = await repo.list_invoices_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    patient_names = {patient_id: str(patient.get("name") or "").strip()}
    enriched = enrich_invoices_with_patient_names(
        enrich_invoices_with_completer_names(invoices, names),
        patient_names,
    )
    return [InvoiceOut(**invoice) for invoice in enriched]


async def build_patient_timeline_view(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
) -> list[PatientTimelineEvent]:
    source = await repo.get_patient_timeline_source(org_id, patient_id)
    patient = source.get("patient") or {}
    clinic_settings = source.get("clinic_settings") or {}
    visits = source.get("visits") or []
    notes = source.get("notes") or []
    myopia_measurements = source.get("myopia_measurements") or []
    longitudinal_tracks = source.get("longitudinal_tracks") or []
    invoices = source.get("invoices") or []
    follow_ups = source.get("follow_ups") or []
    appointments = source.get("appointments") or []
    return build_patient_timeline(
        patient=patient,
        visits=visits,
        notes=notes,
        myopia_measurements=myopia_measurements,
        invoices=invoices,
        follow_ups=follow_ups,
        appointments=appointments,
        longitudinal_tracks=longitudinal_tracks,
        clinic_specialty=clinic_settings.get("clinic_specialty"),
    )


async def list_patient_chart_visits_view(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
) -> list[PatientChartVisitOut]:
    await repo.get_patient(org_id, patient_id)
    visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
    visits.sort(key=lambda row: row["created_at"], reverse=True)
    return [
        PatientChartVisitOut(
            id=visit["id"],
            patient_id=visit["patient_id"],
            reason=str(visit.get("reason") or ""),
            created_at=visit["created_at"],
        )
        for visit in visits
    ]


async def build_patient_visit_detail_view(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
    visit_id: str,
) -> PatientVisitDetailOut:
    visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
    selected_visit = next((visit for visit in visits if str(visit["id"]) == visit_id), None)
    if not selected_visit:
        raise ValueError("Visit not found for this patient.")

    notes = await list_patient_notes_view(repo, org_id, patient_id)
    patient_attachments = await repo.list_patient_attachments(org_id, patient_id)
    timeline = await build_patient_timeline_view(repo, org_id, patient_id)
    selected_visit_event = next(
        (event for event in timeline if event.type == "visit_recorded" and str(event.entity_id or "") == visit_id),
        None,
    )
    if selected_visit_event is None:
        raise ValueError("Visit timeline could not be resolved.")

    visit_day = selected_visit_event.timestamp.date()
    visit_notes = sorted(
        [note for note in notes if (note.finalized_at or note.created_at).date() == visit_day],
        key=lambda note: note.finalized_at or note.created_at,
        reverse=True,
    )
    primary_note = visit_notes[0] if visit_notes else None

    attachment_rows: list[PatientVisitAttachmentRowOut] = []
    for note in visit_notes:
        assets = note.snapshot_asset_payload if note.snapshot_asset_payload else note.asset_payload
        for asset in assets:
            if asset.get("kind") != "attachment":
                continue
            attachment_rows.append(
                PatientVisitAttachmentRowOut(
                    id=f"note-{note.id}-{asset.get('id')}",
                    label=str(asset.get("name") or "Attachment"),
                    timestamp=note.finalized_at or note.created_at,
                    source_type="note_attachment",
                    content_type=str(asset.get("content_type") or ""),
                    data_base64=str(asset.get("data_base64") or ""),
                )
            )

    for attachment in patient_attachments:
        if attachment["created_at"].date() != visit_day:
            continue
        attachment_rows.append(
            PatientVisitAttachmentRowOut(
                id=f"patient-{attachment['id']}",
                label=str(attachment.get("file_name") or "Attachment"),
                timestamp=attachment["created_at"],
                source_type="patient_attachment",
                content_type=str(attachment.get("content_type") or ""),
                attachment_id=attachment["id"],
            )
        )

    attachment_rows.sort(key=lambda row: row.timestamp, reverse=True)
    related_timeline = [
        event
        for event in timeline
        if event.id != selected_visit_event.id
        and event.timestamp.date() == visit_day
        and event.type != "consultation_note"
    ]

    return PatientVisitDetailOut(
        visit_id=selected_visit["id"],
        reason=str(selected_visit.get("reason") or ""),
        timestamp=selected_visit["created_at"],
        consultation_note=(
            PatientVisitNoteDetailOut(
                status=str(primary_note.status),
                content=str(primary_note.snapshot_content or primary_note.content or "").strip(),
            )
            if primary_note
            else None
        ),
        attachments=attachment_rows,
        timeline=related_timeline,
    )
