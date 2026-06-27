from __future__ import annotations

import asyncio
import json
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict


PLATFORM_ERROR_COLUMNS = [
    "id",
    "org_id",
    "user_id",
    "identifier",
    "path",
    "method",
    "status_code",
    "error_type",
    "message",
    "details",
    "context",
    "created_at",
]


class PostgresPlatformErrorsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_platform_error(
        self,
        *,
        org_id: str | None,
        user_id: str | None,
        identifier: str | None,
        path: str,
        method: str,
        status_code: int | None,
        error_type: str,
        message: str,
        details: str = "",
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.platform_errors (
                          org_id,
                          user_id,
                          identifier,
                          path,
                          method,
                          status_code,
                          error_type,
                          message,
                          details,
                          context
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        returning id, org_id, user_id, identifier, path, method, status_code,
                          error_type, message, details, context, created_at
                        """,
                        (
                            org_id,
                            user_id,
                            identifier or "",
                            path,
                            method,
                            status_code,
                            error_type,
                            message[:500],
                            details[:4000],
                            json.dumps(context or {}),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create platform error.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_platform_errors(self, limit: int = 100, org_id: str | None = None) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    if org_id:
                        cursor.execute(
                            """
                            select id, org_id, user_id, identifier, path, method, status_code,
                              error_type, message, details, context, created_at
                            from public.platform_errors
                            where org_id = %s
                            order by created_at desc
                            limit %s
                            """,
                            (org_id, limit),
                        )
                    else:
                        cursor.execute(
                            """
                            select id, org_id, user_id, identifier, path, method, status_code,
                              error_type, message, details, context, created_at
                            from public.platform_errors
                            order by created_at desc
                            limit %s
                            """,
                            (limit,),
                        )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def record_api_request(self, *, org_id: str | None, status_code: int) -> None:
        anonymous_org_id = "00000000-0000-0000-0000-000000000000"

        def _record() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.api_request_metrics (
                          metric_date, org_id, request_count, error_response_count
                        )
                        values (current_date, %s, 1, %s)
                        on conflict (metric_date, org_id)
                        do update set
                          request_count = public.api_request_metrics.request_count + 1,
                          error_response_count = public.api_request_metrics.error_response_count
                            + excluded.error_response_count,
                          updated_at = now()
                        """,
                        (org_id or anonymous_org_id, 1 if status_code >= 500 else 0),
                    )

        await asyncio.to_thread(_record)

    async def get_superdashboard_request_metrics(self, days: int = 7) -> dict[str, Any]:
        safe_days = max(1, min(int(days), 90))

        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select coalesce(sum(request_count), 0)::bigint as request_count,
                          coalesce(sum(error_response_count), 0)::bigint as error_response_count
                        from public.api_request_metrics
                        where metric_date >= current_date - (%s::int - 1)
                        """,
                        (safe_days,),
                    )
                    totals_row = cursor.fetchone()
                    totals = _row_to_dict(totals_row, cursor) if totals_row else {}
                    cursor.execute(
                        """
                        select metric_date as date,
                          sum(request_count)::bigint as request_count,
                          sum(error_response_count)::bigint as error_response_count
                        from public.api_request_metrics
                        where metric_date >= current_date - (%s::int - 1)
                        group by metric_date
                        order by metric_date
                        """,
                        (safe_days,),
                    )
                    daily = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    cursor.execute(
                        """
                        select count(*)::bigint as error_count,
                          coalesce((
                            select coalesce(nullif(path, ''), error_type)
                            from public.platform_errors
                            where created_at >= current_date - (%s::int - 1) * interval '1 day'
                            group by coalesce(nullif(path, ''), error_type)
                            order by count(*) desc, coalesce(nullif(path, ''), error_type)
                            limit 1
                          ), '') as top_error_context
                        from public.platform_errors
                        where created_at >= current_date - (%s::int - 1) * interval '1 day'
                        """,
                        (safe_days, safe_days),
                    )
                    errors_row = cursor.fetchone()
                    errors = _row_to_dict(errors_row, cursor) if errors_row else {}
                    return {**totals, **errors, "daily": daily}

        return await asyncio.to_thread(_get)
