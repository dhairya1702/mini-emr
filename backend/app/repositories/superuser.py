from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from app.repositories.base import BaseSupabaseRepository, display_name, rpc_json_array


def _max_datetime(current: datetime | None, candidate: Any) -> datetime | None:
    if isinstance(candidate, datetime):
        if current is None or candidate > current:
            return candidate
    return current


class SuperuserRepositoryMixin(BaseSupabaseRepository):
    async def list_all_organizations(self) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            result = self.execute_with_retry(
                lambda: self.client.rpc("list_superuser_org_summaries").execute().data
            )
            return rpc_json_array(result, "list_superuser_org_summaries")

        return await asyncio.to_thread(_list)

    async def list_users_for_org_any(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            rows = self.execute_with_retry(
                lambda: self.client.table("clinic_users")
                .select("id, org_id, identifier, name, role, created_at")
                .eq("org_id", org_id)
                .order("created_at", desc=False)
                .execute()
                .data
            )
            return [{**row, "name": display_name(row)} for row in rows]

        return await asyncio.to_thread(_list)

    async def list_ai_usage_events_for_org(self, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("ai_usage_events")
                .select("*")
                .eq("org_id", org_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
                .data
            )
        )

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
        payload = {
            "org_id": org_id,
            "user_id": user_id,
            "identifier": identifier or "",
            "path": path,
            "method": method,
            "status_code": status_code,
            "error_type": error_type,
            "message": message[:500],
            "details": details[:4000],
            "context": context or {},
        }
        return await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("platform_errors").insert(payload).execute().data[0]
            )
        )

    async def list_platform_errors(self, limit: int = 100, org_id: str | None = None) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            query = self.client.table("platform_errors").select("*")
            if org_id:
                query = query.eq("org_id", org_id)
            return self.execute_with_retry(
                lambda: query.order("created_at", desc=True).limit(limit).execute().data
            )

        return await asyncio.to_thread(_list)

    async def delete_user_any(self, user_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("clinic_users").delete().eq("id", user_id).execute()
            )
        )

    async def delete_organization(self, org_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("organizations").delete().eq("id", org_id).execute()
            )
        )
