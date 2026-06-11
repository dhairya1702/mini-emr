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
