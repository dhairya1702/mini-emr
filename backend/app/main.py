from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import SESSION_EXPIRES_AT_HEADER, SESSION_TOKEN_HEADER
from app.config import get_settings
from app.routes import (
    appointments_router,
    audit_router,
    auth_router,
    billing_router,
    catalog_router,
    exports_router,
    followups_router,
    health_router,
    notes_router,
    patients_router,
    settings_router,
    users_router,
)
from app.services.auth_flow import RATE_LIMIT_BUCKETS, RATE_LIMIT_WINDOWS


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


settings = get_settings()
app = FastAPI(title="Clinic EMR API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[SESSION_TOKEN_HEADER, SESSION_EXPIRES_AT_HEADER],
)

for router in (
    health_router,
    settings_router,
    audit_router,
    auth_router,
    users_router,
    catalog_router,
    exports_router,
    patients_router,
    appointments_router,
    followups_router,
    notes_router,
    billing_router,
):
    app.include_router(router)
