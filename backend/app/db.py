from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING
import warnings

from app.config import get_settings
from app.repositories import (
    AIUsageRepositoryMixin,
    AuditRepositoryMixin,
    AuthSettingsRepositoryMixin,
    BillingRepositoryMixin,
    DuplicateCheckInCandidateError,
    PatientFlowRepositoryMixin,
    RecordsRepositoryMixin,
)

if TYPE_CHECKING:
    from supabase._sync.client import SyncClient as Client


class SupabaseRepository(
    AIUsageRepositoryMixin,
    AuditRepositoryMixin,
    AuthSettingsRepositoryMixin,
    PatientFlowRepositoryMixin,
    RecordsRepositoryMixin,
    BillingRepositoryMixin,
):
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase environment variables are not configured.")
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="The `gotrue` package is deprecated.*",
                category=DeprecationWarning,
            )
            from supabase._sync.client import create_client

        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)


@lru_cache
def get_repository() -> SupabaseRepository:
    return SupabaseRepository()


__all__ = ["DuplicateCheckInCandidateError", "SupabaseRepository", "get_repository"]
