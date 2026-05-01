from app.db import SupabaseRepository
from app.schemas import InvoiceOut, MyopiaDeltaOut, MyopiaHistoryOut, MyopiaMeasurementOut, NoteOut, PatientTimelineEvent
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


async def build_user_name_map(repo: SupabaseRepository, org_id: str) -> dict[str, str]:
    users = await repo.list_users(org_id)
    return user_names_by_id(users)


async def build_patient_name_map(repo: SupabaseRepository, org_id: str) -> dict[str, str]:
    patients = await repo.list_patients(org_id)
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
    await repo.get_patient(org_id, patient_id)
    invoices = await repo.list_invoices_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    patient_names = await build_patient_name_map(repo, org_id)
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
    patient = await repo.get_patient(org_id, patient_id)
    visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
    notes = await repo.list_notes_for_patient(org_id, patient_id)
    myopia_measurements = await repo.list_myopia_measurements_for_patient(org_id, patient_id)
    invoices = await repo.list_invoices_for_patient(org_id, patient_id)
    follow_ups = await repo.list_follow_ups_for_patient(org_id, patient_id)
    appointments = await repo.list_appointments_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    patient_names = await build_patient_name_map(repo, org_id)
    return build_patient_timeline(
        patient=patient,
        visits=visits,
        notes=enrich_notes_with_sender_names(notes, names),
        myopia_measurements=myopia_measurements,
        invoices=enrich_invoices_with_patient_names(
            enrich_invoices_with_completer_names(invoices, names),
            patient_names,
        ),
        follow_ups=follow_ups,
        appointments=appointments,
    )
