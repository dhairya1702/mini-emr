from __future__ import annotations

import asyncio
from typing import Any

from app.repositories.base import BaseSupabaseRepository


class AIUsageRepositoryMixin(BaseSupabaseRepository):
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
        payload = {
            "org_id": org_id,
            "provider": provider,
            "model": model,
            "feature": feature,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_creation_input_tokens": cache_creation_input_tokens,
            "cache_read_input_tokens": cache_read_input_tokens,
            "total_tokens": total_tokens,
            "metadata": metadata or {},
        }
        return await asyncio.to_thread(
            lambda: self.client.table("ai_usage_events")
            .insert(payload)
            .execute()
            .data[0]
        )
