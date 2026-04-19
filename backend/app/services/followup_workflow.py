from app.db import SupabaseRepository
from app.formatting import format_display_datetime
from app.schemas import FollowUpCreate, FollowUpOut, FollowUpUpdate, UserOut
from app.services.audit_service import record_follow_up_created, record_follow_up_updated


async def create_follow_up_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    patient_id: str,
    payload: FollowUpCreate,
) -> FollowUpOut:
    created = await repo.create_follow_up(
        str(current_user.org_id),
        patient_id,
        str(current_user.id),
        payload,
    )
    patient = await repo.get_patient(str(current_user.org_id), str(created["patient_id"]))
    patient_name = str(patient.get("name") or "").strip() or "Unknown patient"
    await record_follow_up_created(
        repo,
        current_user,
        created,
        patient_name,
        format_display_datetime(created["scheduled_for"]),
    )
    return FollowUpOut(**created)


async def update_follow_up_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    follow_up_id: str,
    payload: FollowUpUpdate,
) -> FollowUpOut:
    updated = await repo.update_follow_up(str(current_user.org_id), follow_up_id, payload)
    changed_fields = sorted(payload.model_dump(exclude_none=True).keys())
    await record_follow_up_updated(repo, current_user, updated, changed_fields)
    return FollowUpOut(**updated)
