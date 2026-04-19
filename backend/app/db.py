from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings
from app.repositories import (
    AuditRepositoryMixin,
    AuthSettingsRepositoryMixin,
    BillingRepositoryMixin,
    DuplicateCheckInCandidateError,
    PatientFlowRepositoryMixin,
    RecordsRepositoryMixin,
)


class SupabaseRepository(
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
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)


@lru_cache
def get_repository() -> SupabaseRepository:
    return SupabaseRepository()


__all__ = ["DuplicateCheckInCandidateError", "SupabaseRepository", "get_repository"]
