from __future__ import annotations

from typing import Any

from app.db import SupabaseRepository


def anthropic_usage_from_response(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    if not usage:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }

    return {
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "cache_creation_input_tokens": int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
        "cache_read_input_tokens": int(getattr(usage, "cache_read_input_tokens", 0) or 0),
    }


async def record_anthropic_usage(
    repo: SupabaseRepository,
    *,
    org_id: str,
    model: str,
    feature: str,
    response: Any,
    metadata: dict[str, Any] | None = None,
) -> None:
    usage = anthropic_usage_from_response(response)
    if not any(usage.values()):
        return

    await repo.create_ai_usage_event(
        org_id=org_id,
        provider="anthropic",
        model=model,
        feature=feature,
        input_tokens=usage["input_tokens"],
        output_tokens=usage["output_tokens"],
        cache_creation_input_tokens=usage["cache_creation_input_tokens"],
        cache_read_input_tokens=usage["cache_read_input_tokens"],
        metadata=metadata,
    )
