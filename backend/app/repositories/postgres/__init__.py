from app.repositories.postgres.ai_usage import PostgresAIUsageRepository
from app.repositories.postgres.audit import PostgresAuditRepository
from app.repositories.postgres.auth_settings import PostgresAuthSettingsRepository
from app.repositories.postgres.attachments import PostgresAttachmentsRepository
from app.repositories.postgres.billing import PostgresBillingRepository
from app.repositories.postgres.case_studies import PostgresCaseStudiesRepository
from app.repositories.postgres.care_programs import PostgresCareProgramsRepository
from app.repositories.postgres.checkins import PostgresCheckInsRepository
from app.repositories.postgres.controlroom import PostgresControlRoomRepository
from app.repositories.postgres.myopia import PostgresMyopiaRepository
from app.repositories.postgres.patient_flow import PostgresPatientFlowRepository
from app.repositories.postgres.platform_errors import PostgresPlatformErrorsRepository
from app.repositories.postgres.platform_email import PostgresPlatformEmailRepository
from app.repositories.postgres.records import PostgresRecordsRepository
from app.repositories.postgres.specialty_tracks import PostgresSpecialtyTracksRepository
from app.repositories.postgres.whatsapp import PostgresWhatsAppRepository

__all__ = [
    "PostgresAIUsageRepository",
    "PostgresAuditRepository",
    "PostgresAuthSettingsRepository",
    "PostgresAttachmentsRepository",
    "PostgresBillingRepository",
    "PostgresCaseStudiesRepository",
    "PostgresCareProgramsRepository",
    "PostgresCheckInsRepository",
    "PostgresControlRoomRepository",
    "PostgresMyopiaRepository",
    "PostgresPatientFlowRepository",
    "PostgresPlatformErrorsRepository",
    "PostgresPlatformEmailRepository",
    "PostgresRecordsRepository",
    "PostgresSpecialtyTracksRepository",
    "PostgresWhatsAppRepository",
]
