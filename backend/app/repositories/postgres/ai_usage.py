from __future__ import annotations

import asyncio
import json
from typing import Any

from app.postgres import PostgresConnectionManager


AI_USAGE_COLUMNS = [
    "id",
    "org_id",
    "provider",
    "model",
    "feature",
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "total_tokens",
    "metadata",
    "created_at",
]


def _column_name(column: Any) -> str:
    name = getattr(column, "name", None)
    if name:
        return str(name)
    return str(column[0])


def _row_to_dict(row: Any, cursor: Any) -> dict[str, Any]:
    if isinstance(row, dict):
        return row
    columns = [_column_name(column) for column in cursor.description]
    return dict(zip(columns, row, strict=False))


class PostgresAIUsageRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_ai_usage_event(
        self,
        *,
        org_id: str,
        provider: str,
        model: str,
        feature: str,
        input_tokens: int,
        output_tokens: int,
        cache_creation_input_tokens: int = 0,
        cache_read_input_tokens: int = 0,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        total_tokens = input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.ai_usage_events (
                          org_id,
                          provider,
                          model,
                          feature,
                          input_tokens,
                          output_tokens,
                          cache_creation_input_tokens,
                          cache_read_input_tokens,
                          total_tokens,
                          metadata
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        returning id, org_id, provider, model, feature, input_tokens, output_tokens,
                          cache_creation_input_tokens, cache_read_input_tokens, total_tokens, metadata, created_at
                        """,
                        (
                            org_id,
                            provider,
                            model,
                            feature,
                            input_tokens,
                            output_tokens,
                            cache_creation_input_tokens,
                            cache_read_input_tokens,
                            total_tokens,
                            json.dumps(metadata or {}),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create AI usage event.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_ai_usage_events_for_org(self, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, provider, model, feature, input_tokens, output_tokens,
                          cache_creation_input_tokens, cache_read_input_tokens, total_tokens, metadata, created_at
                        from public.ai_usage_events
                        where org_id = %s
                        order by created_at desc
                        limit %s
                        """,
                        (org_id, limit),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)
