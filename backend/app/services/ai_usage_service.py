from __future__ import annotations

from typing import Any
import logging

from app.db import AppRepository


logger = logging.getLogger(__name__)


def _read_int(container: Any, *keys: str) -> int:
    for key in keys:
        if isinstance(container, dict) and key in container:
            return int(container.get(key, 0) or 0)
        value = getattr(container, key, None)
        if value is not None:
            return int(value or 0)
    return 0


def model_usage_from_response(response: Any) -> dict[str, int]:
    usage = None
    if isinstance(response, dict):
        usage = response.get("usageMetadata") or response.get("usage_metadata")
    if usage is None:
        usage = getattr(response, "usage_metadata", None) or getattr(response, "usageMetadata", None)
    if usage is None:
        usage = getattr(response, "usage", None)
    if not usage:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }

    input_tokens = _read_int(usage, "promptTokenCount", "prompt_token_count", "input_tokens")
    output_tokens = _read_int(
        usage,
        "candidatesTokenCount",
        "candidates_token_count",
        "outputTokenCount",
        "output_token_count",
        "output_tokens",
    )
    cache_creation_input_tokens = _read_int(
        usage,
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
    )
    cache_read_input_tokens = _read_int(
        usage,
        "cachedContentTokenCount",
        "cached_content_token_count",
        "cache_read_input_tokens",
        "cacheReadInputTokens",
    )

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_input_tokens": cache_creation_input_tokens,
        "cache_read_input_tokens": cache_read_input_tokens,
    }


async def record_model_usage(
    repo: AppRepository,
    *,
    org_id: str,
    provider: str,
    model: str,
    feature: str,
    response: Any,
    metadata: dict[str, Any] | None = None,
) -> None:
    usage = model_usage_from_response(response)
    if not any(usage.values()):
        return

    try:
        await repo.create_ai_usage_event(
            org_id=org_id,
            provider=provider,
            model=model,
            feature=feature,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            cache_creation_input_tokens=usage["cache_creation_input_tokens"],
            cache_read_input_tokens=usage["cache_read_input_tokens"],
            metadata=metadata,
        )
    except Exception:
        logger.exception("Failed to persist AI usage for feature %s.", feature)
