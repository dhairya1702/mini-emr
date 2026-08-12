from app.routes.appointments import router as appointments_router
from app.routes.attachments import router as attachments_router
from app.routes.audit import router as audit_router
from app.routes.auth import router as auth_router
from app.routes.billing import router as billing_router
from app.routes.case_studies import router as case_studies_router
from app.routes.care_programs import router as care_programs_router
from app.routes.checkins import router as checkins_router
from app.routes.catalog import router as catalog_router
from app.routes.clinical_assistant import router as clinical_assistant_router
from app.routes.controlroom import router as controlroom_router
from app.routes.dashboard import router as dashboard_router
from app.routes.exports import router as exports_router
from app.routes.followups import router as followups_router
from app.routes.health import router as health_router
from app.routes.mobile import router as mobile_router
from app.routes.notes import router as notes_router
from app.routes.patients import router as patients_router
from app.routes.public import router as public_router
from app.routes.referrals import router as referrals_router
from app.routes.settings import router as settings_router
from app.routes.superuser import router as superuser_router
from app.routes.users import router as users_router
from app.routes.whatsapp import router as whatsapp_router

__all__ = [
    "appointments_router",
    "attachments_router",
    "audit_router",
    "auth_router",
    "billing_router",
    "case_studies_router",
    "care_programs_router",
    "checkins_router",
    "catalog_router",
    "clinical_assistant_router",
    "controlroom_router",
    "dashboard_router",
    "exports_router",
    "followups_router",
    "health_router",
    "mobile_router",
    "notes_router",
    "patients_router",
    "public_router",
    "referrals_router",
    "settings_router",
    "superuser_router",
    "users_router",
    "whatsapp_router",
]
