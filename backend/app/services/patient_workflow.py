from app.db import SupabaseRepository
from app.schemas import PatientCreate, PatientOut, PatientUpdate, PatientVisitCreate, UserOut
from app.services.audit_service import record_patient_created, record_patient_updated, record_patient_visit


async def create_patient_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: PatientCreate,
) -> PatientOut:
    created = await repo.create_patient(str(current_user.org_id), payload)
    await record_patient_created(repo, current_user, created)
    return PatientOut(**created)


async def record_patient_visit_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    patient_id: str,
    payload: PatientVisitCreate,
) -> PatientOut:
    updated = await repo.create_patient_visit(str(current_user.org_id), patient_id, payload)
    await record_patient_visit(repo, current_user, updated)
    return PatientOut(**updated)


async def update_patient_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    patient_id: str,
    payload: PatientUpdate,
) -> PatientOut:
    updates = payload.model_dump(exclude_none=True)
    updated = await repo.update_patient(str(current_user.org_id), patient_id, updates)
    changed_fields = sorted(updates.keys())
    await record_patient_updated(repo, current_user, updated, changed_fields)
    return PatientOut(**updated)
