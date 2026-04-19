from app.db import SupabaseRepository
from app.schemas import InvoiceOut, NoteOut, PatientTimelineEvent
from app.services.audit_service import user_names_by_id
from app.timeline import build_patient_timeline


async def build_user_name_map(repo: SupabaseRepository, org_id: str) -> dict[str, str]:
    users = await repo.list_users(org_id)
    return user_names_by_id(users)


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


async def list_patient_notes_view(repo: SupabaseRepository, org_id: str, patient_id: str) -> list[NoteOut]:
    await repo.get_patient(org_id, patient_id)
    notes = await repo.list_notes_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    return [NoteOut(**note) for note in enrich_notes_with_sender_names(notes, names)]


async def list_patient_invoices_view(repo: SupabaseRepository, org_id: str, patient_id: str) -> list[InvoiceOut]:
    await repo.get_patient(org_id, patient_id)
    invoices = await repo.list_invoices_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    return [InvoiceOut(**invoice) for invoice in enrich_invoices_with_completer_names(invoices, names)]


async def build_patient_timeline_view(
    repo: SupabaseRepository,
    org_id: str,
    patient_id: str,
) -> list[PatientTimelineEvent]:
    patient = await repo.get_patient(org_id, patient_id)
    visits = await repo.list_patient_visits_for_patient(org_id, patient_id)
    notes = await repo.list_notes_for_patient(org_id, patient_id)
    invoices = await repo.list_invoices_for_patient(org_id, patient_id)
    follow_ups = await repo.list_follow_ups_for_patient(org_id, patient_id)
    appointments = await repo.list_appointments_for_patient(org_id, patient_id)
    names = await build_user_name_map(repo, org_id)
    return build_patient_timeline(
        patient=patient,
        visits=visits,
        notes=enrich_notes_with_sender_names(notes, names),
        invoices=enrich_invoices_with_completer_names(invoices, names),
        follow_ups=follow_ups,
        appointments=appointments,
    )
