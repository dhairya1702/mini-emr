from __future__ import annotations

import asyncio
from typing import Any

from app.repositories.base import BaseSupabaseRepository


class AuditRepositoryMixin(BaseSupabaseRepository):
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
        return await asyncio.to_thread(
            lambda: self.client.table("audit_events")
            .insert(
                {
                    "org_id": org_id,
                    "actor_user_id": actor_user_id,
                    "actor_name": actor_name.strip(),
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "action": action,
                    "summary": summary.strip(),
                    "metadata": metadata or {},
                }
            )
            .execute()
            .data[0]
        )

    async def list_audit_events(self, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("audit_events")
            .select("*")
            .eq("org_id", org_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
        )
