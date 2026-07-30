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


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


class PostgresAIUsageRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def consume_rate_limit(
        self,
        *,
        scope: str,
        key_hash: str,
        max_window_seconds: int,
    ) -> int:
        def _consume() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "delete from public.api_rate_limits where expires_at <= now()"
                    )
                    cursor.execute(
                        """
                        insert into public.api_rate_limits (
                          scope, key_hash, window_started_at, request_count, updated_at, expires_at
                        )
                        values (%s, %s, now(), 1, now(), now() + make_interval(secs => %s))
                        on conflict (scope, key_hash) do update
                        set
                          request_count = case
                            when public.api_rate_limits.window_started_at
                              <= now() - make_interval(secs => %s)
                            then 1
                            else public.api_rate_limits.request_count + 1
                          end,
                          window_started_at = case
                            when public.api_rate_limits.window_started_at
                              <= now() - make_interval(secs => %s)
                            then now()
                            else public.api_rate_limits.window_started_at
                          end,
                          updated_at = now(),
                          expires_at = now() + make_interval(secs => %s)
                        returning request_count
                        """,
                        (
                            scope,
                            key_hash,
                            max_window_seconds,
                            max_window_seconds,
                            max_window_seconds,
                            max_window_seconds,
                        ),
                    )
                    row = cursor.fetchone()
                    return int(row[0] if row else 1)

        return await asyncio.to_thread(_consume)

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
                            _json_dumps(metadata or {}),
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

    async def get_superdashboard_ai_metrics(self, days: int = 7) -> dict[str, Any]:
        safe_days = max(1, min(int(days), 90))

        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select count(*)::bigint as request_count,
                          coalesce(sum(total_tokens), 0)::bigint as total_tokens
                        from public.ai_usage_events
                        where created_at >= current_date - (%s::int - 1) * interval '1 day'
                        """,
                        (safe_days,),
                    )
                    totals_row = cursor.fetchone()
                    totals = _row_to_dict(totals_row, cursor) if totals_row else {}
                    cursor.execute(
                        """
                        select created_at::date as date,
                          count(*)::bigint as request_count,
                          coalesce(sum(total_tokens), 0)::bigint as total_tokens
                        from public.ai_usage_events
                        where created_at >= current_date - (%s::int - 1) * interval '1 day'
                        group by created_at::date
                        order by created_at::date
                        """,
                        (safe_days,),
                    )
                    return {**totals, "daily": [_row_to_dict(row, cursor) for row in cursor.fetchall()]}

        return await asyncio.to_thread(_get)
