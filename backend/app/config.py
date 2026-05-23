from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    auth_secret: str = ""
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-20250514"
    app_origin: str = "http://127.0.0.1:3000"
    app_origins: str = ""
    super_admin_identifiers: str = ""
    follow_up_reminder_runner_enabled: bool = False
    follow_up_reminder_interval_seconds: int = 300

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def cors_origins(self) -> list[str]:
        origins = [self.app_origin, "http://localhost:3000", "http://127.0.0.1:3000"]
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
        if not str(self.auth_secret or "").strip():
            missing.append("AUTH_SECRET")
        if not str(self.app_origin or "").strip():
            missing.append("APP_ORIGIN")
        if missing:
            raise RuntimeError(
                "Missing required environment variables: "
                + ", ".join(missing)
                + ". Copy backend/.env.example to backend/.env and fill in the required values."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
