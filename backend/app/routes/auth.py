from base64 import b64decode, b64encode

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse

from app.api_errors import bad_request_error
from app.auth import clear_session, get_current_user, hash_password, issue_session_headers, verify_password
from app.db import AppRepository, get_repository
from app.schema_domains.auth_settings import (
    AuthResponse,
    LoginRequest,
    UserAccountUpdate,
    UserCreate,
    UserOut,
    UserPasswordUpdate,
)
from app.services.signature_service import MAX_SIGNATURE_UPLOAD_BYTES, normalize_signature_image
from app.services.user_workflow import login_user_workflow, register_user_workflow
from app.services.user_workflow import build_user_out


router = APIRouter()


@router.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register_user(
    payload: UserCreate,
    request: Request,
    response: Response,
    repo: AppRepository = Depends(get_repository),
) -> AuthResponse:
    return await register_user_workflow(
        repo,
        response,
        payload,
        client_ip=request.client.host if request.client else "unknown",
    )


@router.post("/auth/login", response_model=AuthResponse)
async def login_user(
    payload: LoginRequest,
    request: Request,
    response: Response,
    repo: AppRepository = Depends(get_repository),
) -> AuthResponse:
    return await login_user_workflow(
        repo,
        response,
        payload,
        client_ip=request.client.host if request.client else "unknown",
    )


@router.get("/auth/me", response_model=UserOut)
async def get_me(response: Response, current_user: UserOut = Depends(get_current_user)) -> UserOut:
    issue_session_headers(response, {
        "id": str(current_user.id),
        "org_id": str(current_user.org_id),
        "role": current_user.role,
        "identifier": current_user.identifier,
        "session_version": current_user.session_version,
    })
    return current_user


@router.patch("/auth/me", response_model=UserOut)
async def update_me(
    payload: UserAccountUpdate,
    response: Response,
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    updated = await repo.update_user_account(str(current_user.id), payload)
    issue_session_headers(response, {
        "id": str(updated["id"]),
        "org_id": str(updated["org_id"]),
        "role": updated["role"],
        "identifier": updated["identifier"],
        "session_version": int(updated.get("session_version") or current_user.session_version),
    })
    return build_user_out(updated)


@router.post("/auth/me/password", status_code=204)
async def update_my_password(
    payload: UserPasswordUpdate,
    response: Response,
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> None:
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current password.")

    existing = await repo.get_user_by_identifier(current_user.identifier)
    if not existing or not verify_password(payload.current_password, existing["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    updated = await repo.update_user_password_hash(str(current_user.id), hash_password(payload.new_password))
    issue_session_headers(response, {
        "id": str(current_user.id),
        "org_id": str(current_user.org_id),
        "role": current_user.role,
        "identifier": current_user.identifier,
        "session_version": int(updated.get("session_version") or current_user.session_version),
    })


@router.post("/auth/me/signature", response_model=UserOut)
async def upload_my_signature(
    file: UploadFile = File(...),
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
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

    saved = await repo.set_user_signature(
        str(current_user.id),
        filename=(file.filename or "signature").strip() or "signature",
        content_type=content_type,
        data_base64=b64encode(raw_bytes).decode("ascii"),
    )
    saved["doctor_signature_url"] = f"/users/{current_user.id}/signature/file"
    return build_user_out(saved)


@router.delete("/auth/me/signature", response_model=UserOut)
async def delete_my_signature(
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> UserOut:
    removed = await repo.clear_user_signature(str(current_user.id))
    removed["doctor_signature_url"] = None
    return build_user_out(removed)


@router.get("/auth/me/signature/file")
async def download_my_signature(
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> StreamingResponse:
    user = await repo.get_user(str(current_user.id))
    filename = str(user.get("doctor_signature_name") or "").strip()
    encoded = str(user.get("doctor_signature_data_base64") or "").strip()
    content_type = str(user.get("doctor_signature_content_type") or "application/octet-stream").strip()
    if not filename or not encoded:
        raise HTTPException(status_code=404, detail="No signature found.")

    return StreamingResponse(
        iter([b64decode(encoded)]),
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/auth/logout", status_code=204)
async def logout_user(
    request: Request,
    response: Response,
    current_user: UserOut = Depends(get_current_user),
    repo: AppRepository = Depends(get_repository),
) -> None:
    await repo.revoke_user_sessions(str(current_user.id))
    request.state.suppress_session_refresh = True
    clear_session(response)
