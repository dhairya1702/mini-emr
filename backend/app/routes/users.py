from base64 import b64encode

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.auth import get_current_user, require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import StaffUserCreate, UserOut, UserRoleUpdate
from app.services.user_workflow import create_staff_user_workflow


router = APIRouter()


@router.post("/users/staff", response_model=UserOut, status_code=201)
async def create_staff_user(
    payload: StaffUserCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    return await create_staff_user_workflow(repo, current_user, payload)


@router.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[UserOut]:
    users = await repo.list_users(str(current_user.org_id))
    return [UserOut(**row) for row in users]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user_role(
    user_id: str,
    payload: UserRoleUpdate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    try:
        updated = await repo.update_user_role(user_id, payload)
        return UserOut(**updated)
    except IndexError as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    try:
        target_user = await repo.get_user(user_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc

    if str(target_user.get("org_id")) != str(current_user.org_id):
        raise HTTPException(status_code=404, detail="User not found.")

    await repo.delete_user(user_id)


@router.post("/users/{user_id}/signature", response_model=UserOut)
async def upload_user_signature(
    user_id: str,
    file: UploadFile = File(...),
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    content_type = (file.content_type or "").strip().lower()
    if content_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=400, detail="Signature must be a JPG or PNG file.")
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Signature file is empty.")
    try:
        saved = await repo.set_user_signature(
            user_id,
            filename=(file.filename or "signature").strip() or "signature",
            content_type=content_type,
            data_base64=b64encode(raw_bytes).decode("ascii"),
        )
        saved["doctor_signature_url"] = f"/users/{user_id}/signature/file"
        return UserOut(**saved)
    except IndexError as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.delete("/users/{user_id}/signature", response_model=UserOut)
async def delete_user_signature(
    user_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> UserOut:
    try:
        removed = await repo.clear_user_signature(user_id)
        removed["doctor_signature_url"] = None
        return UserOut(**removed)
    except IndexError as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.get("/users/{user_id}/signature/file")
async def download_user_signature(
    user_id: str,
    current_user: UserOut = Depends(get_current_user),
    repo: SupabaseRepository = Depends(get_repository),
) -> StreamingResponse:
    try:
        if current_user.role != "admin" and str(current_user.id) != user_id:
            raise HTTPException(status_code=403, detail="You can only view your own signature.")
        user = await repo.get_user(user_id)
        filename = str(user.get("doctor_signature_name") or "").strip()
        encoded = str(user.get("doctor_signature_data_base64") or "").strip()
        content_type = str(user.get("doctor_signature_content_type") or "application/octet-stream").strip()
        if not filename or not encoded:
            raise HTTPException(status_code=404, detail="No signature found.")
        from base64 import b64decode

        return StreamingResponse(
            iter([b64decode(encoded)]),
            media_type=content_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=str(exc)) from exc
