from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    auth_secret: str = ""
    database_url: str = ""
    gcs_patient_attachments_bucket: str = ""
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    gemini_model: str = "gemini-3.5-flash"
    internal_scheduler_token: str = ""
    app_origin: str = "http://127.0.0.1:3000"
    app_origins: str = ""
    super_admin_identifiers: str = ""
    control_room_identifiers: str = ""
    open_clinic_registration: bool = True
    follow_up_reminder_runner_enabled: bool = False
    follow_up_reminder_interval_seconds: int = 300
    follow_up_reminder_lead_hours: int = 24
    session_ttl_hours: int = 12
    db_pool_min_size: int = 1
    db_pool_max_size: int = 10
    db_pool_timeout_seconds: float = 10.0
    db_pool_max_lifetime_seconds: float = 1800.0
    db_pool_max_idle_seconds: float = 300.0
    db_pool_check_connections: bool = True
    whatsapp_enabled: bool = False
    whatsapp_verify_token: str = ""
    whatsapp_app_secret: str = ""
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_graph_api_version: str = "v23.0"
    whatsapp_skip_signature_check: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def cors_origins(self) -> list[str]:
        origins = [self.app_origin]
        if not str(self.app_origin or "").startswith("https://"):
            origins.extend(["http://localhost:3000", "http://127.0.0.1:3000"])
        extra = [
            origin.strip()
            for origin in str(self.app_origins or "").split(",")
            if origin.strip()
        ]
        deduped: list[str] = []
        for origin in [*origins, *extra]:
            if origin not in deduped:
                deduped.append(origin)
        return deduped

    def validate_runtime(self) -> None:
        missing: list[str] = []
        if not str(self.database_url or "").strip():
            missing.append("DATABASE_URL")
        if not str(self.auth_secret or "").strip():
            missing.append("AUTH_SECRET")
        if not str(self.app_origin or "").strip():
            missing.append("APP_ORIGIN")
        if not str(self.gcs_patient_attachments_bucket or "").strip():
            missing.append("GCS_PATIENT_ATTACHMENTS_BUCKET")
        if self.whatsapp_enabled:
            if not str(self.whatsapp_verify_token or "").strip():
                missing.append("WHATSAPP_VERIFY_TOKEN")
            if not str(self.whatsapp_access_token or "").strip():
                missing.append("WHATSAPP_ACCESS_TOKEN")
            if not str(self.whatsapp_phone_number_id or "").strip():
                missing.append("WHATSAPP_PHONE_NUMBER_ID")
            if (
                not bool(self.whatsapp_skip_signature_check)
                and not str(self.whatsapp_app_secret or "").strip()
            ):
                missing.append("WHATSAPP_APP_SECRET")
        if missing:
            raise RuntimeError(
                "Missing required environment variables: "
                + ", ".join(missing)
                + ". Copy backend/.env.example to backend/.env and fill in the required values."
            )

@lru_cache
def get_settings() -> Settings:
    return Settings()
