from __future__ import annotations

from typing import TypeAlias

from app.postgres import PostgresConnectionManager, get_postgres_connection_manager
from app.repositories import DuplicateCheckInCandidateError
from app.repositories.postgres import (
    PostgresAIUsageRepository,
    PostgresAttachmentsRepository,
    PostgresAuditRepository,
    PostgresAuthSettingsRepository,
    PostgresBillingRepository,
    PostgresCaseStudiesRepository,
    PostgresCareProgramsRepository,
    PostgresCheckInsRepository,
    PostgresControlRoomRepository,
    PostgresMyopiaRepository,
    PostgresOptometryHistoryRepository,
    PostgresPatientFlowRepository,
    PostgresPlatformErrorsRepository,
    PostgresPlatformEmailRepository,
    PostgresRecordsRepository,
    PostgresSpecialtyTracksRepository,
    PostgresWhatsAppRepository,
)


class PostgresRepository(
    PostgresAIUsageRepository,
    PostgresAuditRepository,
    PostgresAttachmentsRepository,
    PostgresAuthSettingsRepository,
    PostgresBillingRepository,
    PostgresCaseStudiesRepository,
    PostgresCareProgramsRepository,
    PostgresCheckInsRepository,
    PostgresControlRoomRepository,
    PostgresMyopiaRepository,
    PostgresOptometryHistoryRepository,
    PostgresPatientFlowRepository,
    PostgresPlatformErrorsRepository,
    PostgresPlatformEmailRepository,
    PostgresRecordsRepository,
    PostgresSpecialtyTracksRepository,
    PostgresWhatsAppRepository,
):
    def __init__(self, connection_manager: PostgresConnectionManager | None = None) -> None:
        self.connection_manager = connection_manager or get_postgres_connection_manager()
        self.connection_manager.open()


AppRepository: TypeAlias = PostgresRepository


def get_repository() -> AppRepository:
    return PostgresRepository()


__all__ = [
    "AppRepository",
    "DuplicateCheckInCandidateError",
    "PostgresRepository",
    "get_repository",
]
