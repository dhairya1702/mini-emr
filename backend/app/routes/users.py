from base64 import b64encode

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error, internal_server_error
from app.auth import get_current_user, require_admin
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import PasswordResetRequestOut, StaffUserCreate, UserOut, UserRoleUpdate
from app.services.password_reset_service import send_password_reset_for_user
from app.services.signature_service import MAX_SIGNATURE_UPLOAD_BYTES, normalize_signature_image
from app.services.user_workflow import build_user_out, create_staff_user_workflow


router = APIRouter()


@router.post("/users/staff", response_model=UserOut, status_code=201)
async def create_staff_user(
    payload: StaffUserCreate,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    return await create_staff_user_workflow(
        repo,
        current_user,
        StaffUserCreate(
            identifier=payload.identifier,
            email=payload.email,
            phone=payload.phone,
            name=payload.name,
            password=payload.password,
            role="staff",
        ),
    )


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    payload: StaffUserCreate,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    return await create_staff_user_workflow(repo, current_user, payload)


@router.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> list[UserOut]:
    users = await repo.list_users(str(current_user.org_id))
    return [build_user_out(row) for row in users]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user_role(
    user_id: str,
    payload: UserRoleUpdate,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    try:
        updated = await repo.update_user_role(str(current_user.org_id), user_id, payload)
        return build_user_out(updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> None:
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")
    try:
        await repo.delete_user(str(current_user.org_id), user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.post("/users/{user_id}/password-reset", response_model=PasswordResetRequestOut)
async def send_user_password_reset(
    user_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> PasswordResetRequestOut:
    try:
        target = await repo.get_user_for_org(str(current_user.org_id), user_id)
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    await send_password_reset_for_user(
        repo,
        target_user=target,
        requested_by=current_user,
        requester_realm="clinic",
    )
    return PasswordResetRequestOut(message=f"Password reset email sent to {target['email']}.")


@router.post("/users/{user_id}/signature", response_model=UserOut)
async def upload_user_signature(
    user_id: str,
    file: UploadFile = File(...),
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    try:
        await repo.get_user_for_org(str(current_user.org_id), user_id)
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc

    content_type = (file.content_type or "").strip().lower()
    if content_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=400, detail="Signature must be a JPG or PNG file.")
    raw_bytes = await file.read(MAX_SIGNATURE_UPLOAD_BYTES + 1)
    if len(raw_bytes) > MAX_SIGNATURE_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Signature must be 2 MB or smaller.")
    try:
        raw_bytes, content_type = normalize_signature_image(raw_bytes, content_type)
    except ValueError as exc:
        raise bad_request_error(exc) from exc
    try:
        saved = await repo.set_user_signature(
            user_id,
            filename=(file.filename or "signature").strip() or "signature",
            content_type=content_type,
            data_base64=b64encode(raw_bytes).decode("ascii"),
        )
        saved["doctor_signature_url"] = f"/users/{user_id}/signature/file"
        return build_user_out(saved)
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.delete("/users/{user_id}/signature", response_model=UserOut)
async def delete_user_signature(
    user_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    try:
        await repo.get_user_for_org(str(current_user.org_id), user_id)
        removed = await repo.clear_user_signature(user_id)
        removed["doctor_signature_url"] = None
        return build_user_out(removed)
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.get("/users/{user_id}/signature/file")
async def download_user_signature(
    user_id: str,
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> StreamingResponse:
    try:
        if current_user.role != "admin" and str(current_user.id) != user_id:
            raise HTTPException(status_code=403, detail="You can only view your own signature.")
        if current_user.role == "admin":
            user = await repo.get_user_for_org(str(current_user.org_id), user_id)
        else:
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
    except (IndexError, KeyError) as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    except Exception as exc:  # pragma: no cover
        raise internal_server_error(exc, context="download_user_signature") from exc
