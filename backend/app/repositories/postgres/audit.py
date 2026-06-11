from __future__ import annotations

import asyncio
import json
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict


AUDIT_EVENT_COLUMNS = [
    "id",
    "org_id",
    "actor_user_id",
    "actor_name",
    "entity_type",
    "entity_id",
    "action",
    "summary",
    "metadata",
    "created_at",
]


class PostgresAuditRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_audit_event(
        self,
        org_id: str,
        actor_user_id: str | None,
        actor_name: str,
        entity_type: str,
        entity_id: str,
        action: str,
        summary: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.audit_events (
                          org_id,
                          actor_user_id,
                          actor_name,
                          entity_type,
                          entity_id,
                          action,
                          summary,
                          metadata
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        returning id, org_id, actor_user_id, actor_name, entity_type, entity_id,
                          action, summary, metadata, created_at
                        """,
                        (
                            org_id,
                            actor_user_id,
                            actor_name.strip(),
                            entity_type,
                            entity_id,
                            action,
                            summary.strip(),
                            json.dumps(metadata or {}),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create audit event.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_audit_events(self, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, actor_user_id, actor_name, entity_type, entity_id,
                          action, summary, metadata, created_at
                        from public.audit_events
                        where org_id = %s
                        order by created_at desc
                        limit %s
                        """,
                        (org_id, limit),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)
