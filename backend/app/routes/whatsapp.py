from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from starlette.responses import PlainTextResponse

from app import config as config_module
from app.db import AppRepository, get_repository
from app.services.whatsapp_assistant import (
    handle_inbound_message,
    parse_whatsapp_messages,
    verify_whatsapp_signature,
)
from app.services.whatsapp_client import WhatsAppClient


router = APIRouter()


class WhatsAppOwnerBindingRequest(BaseModel):
    org_id: str = Field(min_length=1)
    wa_id: str = Field(min_length=1)
    phone: str = ""
    display_name: str = ""
    role: str = "owner"
    user_id: str | None = None
    is_active: bool = True


@router.get("/webhooks/whatsapp")
async def verify_whatsapp_webhook(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
) -> PlainTextResponse:
    settings = config_module.get_settings()
    if (
        hub_mode == "subscribe"
        and settings.whatsapp_verify_token
        and hub_verify_token == settings.whatsapp_verify_token
    ):
        return PlainTextResponse(hub_challenge)
    raise HTTPException(status_code=403, detail="Invalid WhatsApp webhook verification token.")


@router.post("/webhooks/whatsapp")
async def receive_whatsapp_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    repo: AppRepository = Depends(get_repository),
) -> dict[str, str | int]:
    settings = config_module.get_settings()
    body = await request.body()
    skip_signature_check = bool(getattr(settings, "whatsapp_skip_signature_check", False))
    if not skip_signature_check and not verify_whatsapp_signature(
        app_secret=settings.whatsapp_app_secret,
        signature_header=x_hub_signature_256,
        body=body,
    ):
        raise HTTPException(status_code=403, detail="Invalid WhatsApp webhook signature.")
    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid WhatsApp webhook payload.") from exc
    messages = parse_whatsapp_messages(payload)
    client = WhatsAppClient(
        access_token=settings.whatsapp_access_token,
        phone_number_id=settings.whatsapp_phone_number_id,
        graph_api_version=settings.whatsapp_graph_api_version,
    )
    processed = 0
    for message in messages:
        await handle_inbound_message(
            repo=repo,
            client=client,
            message=message,
            enabled=bool(settings.whatsapp_enabled),
        )
        processed += 1
    return {"status": "ok", "processed": processed}


@router.post("/internal/whatsapp/owner-bindings")
async def upsert_whatsapp_owner_binding(
    payload: WhatsAppOwnerBindingRequest,
    x_internal_scheduler_token: str | None = Header(default=None, alias="X-Internal-Scheduler-Token"),
    repo: AppRepository = Depends(get_repository),
) -> dict:
    settings = config_module.get_settings()
    if not settings.internal_scheduler_token or x_internal_scheduler_token != settings.internal_scheduler_token:
        raise HTTPException(status_code=403, detail="Invalid internal token.")
    if payload.role not in {"admin", "owner", "staff"}:
        raise HTTPException(status_code=400, detail="Invalid WhatsApp owner binding role.")
    return await repo.upsert_whatsapp_owner_binding(
        org_id=payload.org_id,
        user_id=payload.user_id,
        wa_id=payload.wa_id,
        phone=payload.phone,
        display_name=payload.display_name,
        role=payload.role,
        is_active=payload.is_active,
    )
