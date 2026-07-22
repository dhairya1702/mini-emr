from __future__ import annotations

import asyncio
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _json_dumps, _row_to_dict


WHATSAPP_OWNER_BINDING_COLUMNS = [
    "id",
    "org_id",
    "user_id",
    "wa_id",
    "phone",
    "display_name",
    "role",
    "is_active",
    "created_at",
    "updated_at",
]

WHATSAPP_MESSAGE_EVENT_COLUMNS = [
    "id",
    "org_id",
    "binding_id",
    "direction",
    "wa_message_id",
    "sender_wa_id",
    "recipient_wa_id",
    "message_text",
    "intent",
    "status",
    "error",
    "raw_payload",
    "created_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


class PostgresWhatsAppRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def upsert_whatsapp_owner_binding(
        self,
        *,
        org_id: str,
        wa_id: str,
        phone: str = "",
        display_name: str = "",
        role: str = "owner",
        user_id: str | None = None,
        is_active: bool = True,
    ) -> dict[str, Any]:
        def _upsert() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.whatsapp_owner_bindings (
                          org_id, user_id, wa_id, phone, display_name, role, is_active, updated_at
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, now())
                        on conflict (wa_id) where is_active
                        do update set
                          org_id = excluded.org_id,
                          user_id = excluded.user_id,
                          phone = excluded.phone,
                          display_name = excluded.display_name,
                          role = excluded.role,
                          is_active = excluded.is_active,
                          updated_at = now()
                        returning {_columns_sql(WHATSAPP_OWNER_BINDING_COLUMNS)}
                        """,
                        (
                            org_id,
                            user_id,
                            wa_id.strip(),
                            phone.strip(),
                            display_name.strip(),
                            role,
                            is_active,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to upsert WhatsApp owner binding.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_upsert)

    async def get_whatsapp_owner_binding(self, wa_id: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(WHATSAPP_OWNER_BINDING_COLUMNS)}
                        from public.whatsapp_owner_bindings
                        where wa_id = %s and is_active = true
                        limit 1
                        """,
                        (wa_id.strip(),),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None

        return await asyncio.to_thread(_get)

    async def record_whatsapp_message_event(
        self,
        *,
        org_id: str | None,
        binding_id: str | None,
        direction: str,
        wa_message_id: str = "",
        sender_wa_id: str = "",
        recipient_wa_id: str = "",
        message_text: str = "",
        intent: str = "",
        status: str,
        error: str = "",
        raw_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _record() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.whatsapp_message_events (
                          org_id, binding_id, direction, wa_message_id, sender_wa_id,
                          recipient_wa_id, message_text, intent, status, error, raw_payload
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        returning {_columns_sql(WHATSAPP_MESSAGE_EVENT_COLUMNS)}
                        """,
                        (
                            org_id,
                            binding_id,
                            direction,
                            wa_message_id.strip(),
                            sender_wa_id.strip(),
                            recipient_wa_id.strip(),
                            message_text[:4000],
                            intent,
                            status,
                            error[:1000],
                            _json_dumps(raw_payload or {}),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to record WhatsApp message event.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_record)
