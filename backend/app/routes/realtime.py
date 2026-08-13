from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from starlette.responses import StreamingResponse

from app.auth import get_current_user
from app.schema_domains.auth_settings import UserOut
from app.services.realtime import HEARTBEAT_SECONDS, DashboardRealtimeHub


router = APIRouter()


def _sse_message(event: str, data: dict | None = None) -> str:
    lines = [f"event: {event}"]
    if data is not None:
        lines.append(f"data: {json.dumps(data, separators=(',', ':'))}")
    return "\n".join(lines) + "\n\n"


@router.get("/dashboard/events")
async def dashboard_events(
    request: Request,
    current_user: UserOut = Depends(get_current_user),
) -> StreamingResponse:
    request.state.suppress_session_refresh = True
    hub: DashboardRealtimeHub = request.app.state.dashboard_realtime_hub
    subscriber = await hub.subscribe(str(current_user.org_id))

    async def stream():
        try:
            yield _sse_message("ready")
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(
                        subscriber.queue.get(),
                        timeout=HEARTBEAT_SECONDS,
                    )
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield _sse_message("dashboard", event.to_sse_payload())
        finally:
            await hub.unsubscribe(subscriber)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
