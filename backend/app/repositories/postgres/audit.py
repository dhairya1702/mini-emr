from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping
from typing import Any, TypeAlias

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _json_dumps, _row_to_dict


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

AuditEventFactory: TypeAlias = Callable[
    [dict[str, Any]],
    Iterable[Mapping[str, Any]],
]


def insert_audit_event(cursor, event: Mapping[str, Any]) -> dict[str, Any]:
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
            event["org_id"],
            event.get("actor_user_id"),
            str(event["actor_name"]).strip(),
            event["entity_type"],
            event["entity_id"],
            event["action"],
            str(event["summary"]).strip(),
            _json_dumps(event.get("metadata") or {}),
        ),
    )
    row = cursor.fetchone()
    if not row:
        raise ValueError("Failed to create audit event.")
    return _row_to_dict(row, cursor)


def insert_audit_events(
    cursor,
    factory: AuditEventFactory | None,
    result: dict[str, Any],
) -> None:
    if factory is None:
        return
    for event in factory(result):
        insert_audit_event(cursor, event)


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
                    return insert_audit_event(
                        cursor,
                        {
                            "org_id": org_id,
                            "actor_user_id": actor_user_id,
                            "actor_name": actor_name,
                            "entity_type": entity_type,
                            "entity_id": entity_id,
                            "action": action,
                            "summary": summary,
                            "metadata": metadata or {},
                        },
                    )

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
