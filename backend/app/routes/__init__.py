from app.routes.appointments import router as appointments_router
from app.routes.audit import router as audit_router
from app.routes.auth import router as auth_router
from app.routes.billing import router as billing_router
from app.routes.catalog import router as catalog_router
from app.routes.exports import router as exports_router
from app.routes.followups import router as followups_router
from app.routes.health import router as health_router
from app.routes.notes import router as notes_router
from app.routes.patients import router as patients_router
from app.routes.public import router as public_router
from app.routes.settings import router as settings_router
from app.routes.users import router as users_router

__all__ = [
    "appointments_router",
    "audit_router",
    "auth_router",
    "billing_router",
    "catalog_router",
    "exports_router",
    "followups_router",
    "health_router",
    "notes_router",
    "patients_router",
    "public_router",
    "settings_router",
    "users_router",
]
