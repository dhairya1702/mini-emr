from app.db import AppRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.patients import PatientCreate, PatientOut, PatientUpdate, PatientVisitCreate
from app.services.audit_service import record_patient_created, record_patient_updated, record_patient_visit


async def _validate_assigned_doctor(
    repo: AppRepository,
    current_user: UserOut,
    assigned_doctor_id: str | None,
) -> None:
    if not assigned_doctor_id:
        return
    settings = await repo.get_clinic_settings(str(current_user.org_id))
    if str(settings.get("workspace_mode") or "solo") != "multi_doctor":
        raise ValueError("Doctor assignment is only available in Multi-Doctor mode.")
    try:
        provider = await repo.get_user_for_org(str(current_user.org_id), assigned_doctor_id)
    except (IndexError, KeyError) as exc:
        raise ValueError("Assigned doctor not found for this clinic.") from exc
    if str(provider.get("role") or "") not in {"admin", "doctor"}:
        raise ValueError("Patients can only be assigned to admins or doctors.")


async def create_patient_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: PatientCreate,
) -> PatientOut:
    await _validate_assigned_doctor(
        repo,
        current_user,
        str(payload.assigned_doctor_id) if payload.assigned_doctor_id else None,
    )
    created = await repo.create_patient(str(current_user.org_id), payload)
    await record_patient_created(repo, current_user, created)
    return PatientOut(**created)


async def record_patient_visit_workflow(
    repo: AppRepository,
    current_user: UserOut,
    patient_id: str,
    payload: PatientVisitCreate,
) -> PatientOut:
    await _validate_assigned_doctor(
        repo,
        current_user,
        str(payload.assigned_doctor_id) if payload.assigned_doctor_id else None,
    )
    updated = await repo.create_patient_visit(str(current_user.org_id), patient_id, payload)
    await record_patient_visit(repo, current_user, updated)
    return PatientOut(**updated)


async def update_patient_workflow(
    repo: AppRepository,
    current_user: UserOut,
    patient_id: str,
    payload: PatientUpdate,
) -> PatientOut:
    updates = payload.model_dump(exclude_unset=True, mode="json")
    if "assigned_doctor_id" in updates:
        await _validate_assigned_doctor(repo, current_user, updates.get("assigned_doctor_id"))
    if updates.get("status") == "consultation" and "assigned_doctor_id" not in updates and current_user.role in {"admin", "doctor"}:
        settings = await repo.get_clinic_settings(str(current_user.org_id))
        if str(settings.get("workspace_mode") or "solo") == "multi_doctor":
            current_patient = await repo.get_patient(str(current_user.org_id), patient_id)
            if not current_patient.get("assigned_doctor_id"):
                updates["assigned_doctor_id"] = str(current_user.id)
    updated = await repo.update_patient(str(current_user.org_id), patient_id, updates)
    if set(updates) - {"status", "billed", "queue_priority", "assigned_doctor_id"}:
        await repo.mark_patient_summary_stale(str(current_user.org_id), patient_id)
    changed_fields = sorted(updates.keys())
    await record_patient_updated(repo, current_user, updated, changed_fields)
    return PatientOut(**updated)
