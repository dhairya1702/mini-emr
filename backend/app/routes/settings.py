from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.db import SupabaseRepository, get_repository
from app.schemas import ClinicSettingsOut, ClinicSettingsUpdate, UserOut


router = APIRouter()


@router.get("/settings/clinic", response_model=ClinicSettingsOut)
async def get_clinic_settings(
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        settings_row = await repo.get_clinic_settings(str(current_user.org_id))
        if not settings_row:
            settings_row = await repo.upsert_clinic_settings(
                str(current_user.org_id),
                ClinicSettingsUpdate(),
            )
        return ClinicSettingsOut(**settings_row)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/settings/clinic", response_model=ClinicSettingsOut)
async def update_clinic_settings(
    payload: ClinicSettingsUpdate,
    repo: SupabaseRepository = Depends(get_repository),
    current_user: UserOut = Depends(get_current_user),
) -> ClinicSettingsOut:
    try:
        saved = await repo.upsert_clinic_settings(str(current_user.org_id), payload)
        return ClinicSettingsOut(**saved)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
