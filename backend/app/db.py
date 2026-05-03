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
    CaseStudiesRepositoryMixin,
    DuplicateCheckInCandidateError,
    MyopiaRepositoryMixin,
    PatientFlowRepositoryMixin,
    RecordsRepositoryMixin,
    SuperuserRepositoryMixin,
)

if TYPE_CHECKING:
    from supabase._sync.client import SyncClient as Client


def _force_postgrest_http1(client: "Client") -> None:
    postgrest_client = client.postgrest
    existing_session = getattr(postgrest_client, "session", None)
    if existing_session is not None:
        existing_session.close()

    from postgrest.utils import SyncClient as PostgrestSyncClient

    postgrest_client.session = PostgrestSyncClient(
        base_url=postgrest_client.base_url,
        headers=postgrest_client.headers,
        timeout=postgrest_client.timeout,
        verify=postgrest_client.verify,
        proxy=postgrest_client.proxy,
        follow_redirects=True,
        http2=False,
        http1=True,
    )


class SupabaseRepository(
    AIUsageRepositoryMixin,
    AuditRepositoryMixin,
    AuthSettingsRepositoryMixin,
    PatientFlowRepositoryMixin,
    CaseStudiesRepositoryMixin,
    MyopiaRepositoryMixin,
    RecordsRepositoryMixin,
    BillingRepositoryMixin,
    SuperuserRepositoryMixin,
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
        _force_postgrest_http1(self.client)


@lru_cache
def get_repository() -> SupabaseRepository:
    return SupabaseRepository()


__all__ = ["DuplicateCheckInCandidateError", "SupabaseRepository", "get_repository"]
