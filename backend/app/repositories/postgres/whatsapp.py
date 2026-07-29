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
    "document_type",
    "document_id",
    "idempotency_key",
    "created_at",
    "updated_at",
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
        document_type: str = "",
        document_id: str = "",
        idempotency_key: str = "",
    ) -> dict[str, Any]:
        def _record() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.whatsapp_message_events (
                          org_id, binding_id, direction, wa_message_id, sender_wa_id,
                          recipient_wa_id, message_text, intent, status, error, raw_payload,
                          document_type, document_id, idempotency_key
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
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
                            document_type.strip(),
                            document_id.strip(),
                            idempotency_key.strip(),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to record WhatsApp message event.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_record)

    async def get_whatsapp_message_event_by_idempotency(
        self,
        org_id: str,
        idempotency_key: str,
    ) -> dict[str, Any] | None:
        if not idempotency_key.strip():
            return None

        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(WHATSAPP_MESSAGE_EVENT_COLUMNS)}
                        from public.whatsapp_message_events
                        where org_id = %s and idempotency_key = %s
                        limit 1
                        """,
                        (org_id, idempotency_key.strip()),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None

        return await asyncio.to_thread(_get)

    async def update_whatsapp_message_status(
        self,
        wa_message_id: str,
        *,
        status: str,
        error: str = "",
        raw_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        rank = {"sent": 1, "accepted": 1, "delivered": 2, "read": 3, "failed": 4}
        if status not in rank or not wa_message_id.strip():
            return None

        def _update() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.whatsapp_message_events
                        set status = case
                              when status = 'failed' then status
                              when %s = 'failed' then 'failed'
                              when (case status when 'read' then 3 when 'delivered' then 2 else 1 end)
                                   <= (case %s when 'read' then 3 when 'delivered' then 2 else 1 end)
                                then %s
                              else status
                            end,
                            error = case when %s <> '' then %s else error end,
                            raw_payload = raw_payload || %s::jsonb,
                            updated_at = now()
                        where wa_message_id = %s
                        returning {_columns_sql(WHATSAPP_MESSAGE_EVENT_COLUMNS)}
                        """,
                        (
                            status,
                            status,
                            status,
                            error[:1000],
                            error[:1000],
                            _json_dumps(raw_payload or {}),
                            wa_message_id.strip(),
                        ),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None

        return await asyncio.to_thread(_update)

    async def update_whatsapp_message_event(
        self,
        event_id: str,
        *,
        status: str,
        wa_message_id: str = "",
        error: str = "",
        raw_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.whatsapp_message_events
                        set status = %s,
                            wa_message_id = case when %s <> '' then %s else wa_message_id end,
                            error = %s,
                            raw_payload = raw_payload || %s::jsonb,
                            updated_at = now()
                        where id = %s
                        returning {_columns_sql(WHATSAPP_MESSAGE_EVENT_COLUMNS)}
                        """,
                        (
                            status,
                            wa_message_id.strip(),
                            wa_message_id.strip(),
                            error[:1000],
                            _json_dumps(raw_payload or {}),
                            event_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("WhatsApp message event not found.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)

    async def get_latest_whatsapp_document_event(
        self,
        org_id: str,
        document_type: str,
        document_id: str,
    ) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(WHATSAPP_MESSAGE_EVENT_COLUMNS)}
                        from public.whatsapp_message_events
                        where org_id = %s and document_type = %s and document_id = %s
                        order by created_at desc
                        limit 1
                        """,
                        (org_id, document_type.strip(), document_id.strip()),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None

        return await asyncio.to_thread(_get)
