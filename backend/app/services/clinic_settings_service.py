from __future__ import annotations

from typing import Any

from app.db import AppRepository


async def get_clinic_runtime_settings(repo: AppRepository, org_id: str) -> dict[str, Any]:
    """Read the lightweight settings projection when the repository supports it."""
    getter = getattr(repo, "get_clinic_runtime_settings", None)
    if callable(getter):
        return await getter(org_id)
    return await repo.get_clinic_settings(org_id)
