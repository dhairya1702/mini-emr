from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse


def _database_url() -> str:
    database_url = str(os.getenv("E2E_POSTGRES_DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("E2E_POSTGRES_DATABASE_URL must point at a disposable Postgres test database.")
    return database_url


def _assert_safe_database_url(database_url: str) -> None:
    if str(os.getenv("E2E_ALLOW_DATABASE_RESET") or "").strip().lower() not in {"1", "true", "yes"}:
        raise RuntimeError("Set E2E_ALLOW_DATABASE_RESET=true to allow truncating the Postgres E2E database.")

    parsed = urlparse(database_url)
    database_name = parsed.path.rsplit("/", 1)[-1].lower()
    if not any(marker in database_name for marker in ("test", "e2e", "playwright")):
        raise RuntimeError(
            "Refusing to reset Postgres database. Database name must contain test, e2e, or playwright.",
        )


def _configure_environment(database_url: str) -> None:
    os.environ["AUTH_SECRET"] = "playwright-postgres-e2e-secret"
    os.environ["DATABASE_URL"] = database_url
    os.environ["GCS_PATIENT_ATTACHMENTS_BUCKET"] = "playwright-postgres-e2e-bucket"
    os.environ["APP_ORIGIN"] = "http://127.0.0.1:3121"
    os.environ["APP_ORIGINS"] = "http://127.0.0.1:3121,http://localhost:3121"
    os.environ["OPEN_CLINIC_REGISTRATION"] = "true"
    os.environ["GOOGLE_CLOUD_PROJECT"] = ""
    os.environ["GEMINI_MODEL"] = ""
    os.environ["SUPER_ADMIN_IDENTIFIERS"] = "ops-super@clinic.test"
    os.environ["INTERNAL_SCHEDULER_TOKEN"] = "playwright-internal-token"
    os.environ["DB_POOL_MIN_SIZE"] = "0"
    os.environ["DB_POOL_MAX_SIZE"] = "4"


database_url = _database_url()
_assert_safe_database_url(database_url)
_configure_environment(database_url)

import psycopg
import uvicorn

from app.main import RATE_LIMIT_BUCKETS, app
from app.migrations import apply_migrations
from app.services.followup_booking_service import create_follow_up_booking_token
from app.storage import get_patient_attachment_storage


class E2EPatientAttachmentStorage:
    def __init__(self) -> None:
        self._files: dict[str, bytes] = {}

    async def upload(self, storage_path: str, raw_bytes: bytes, content_type: str) -> None:
        self._files[storage_path] = raw_bytes

    async def download(self, storage_path: str) -> bytes:
        return self._files[storage_path]

    async def delete(self, storage_path: str) -> None:
        self._files.pop(storage_path, None)


storage = E2EPatientAttachmentStorage()


def _storage() -> E2EPatientAttachmentStorage:
    return storage


app.dependency_overrides[get_patient_attachment_storage] = _storage


def _schema_path() -> Path:
    return Path(__file__).resolve().parents[1] / "db" / "schema.sql"


def _apply_schema() -> None:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(_schema_path().read_text(encoding="utf-8"))
        connection.commit()
        apply_migrations(connection)


def _reset_database() -> None:
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select tablename
                from pg_tables
                where schemaname = 'public'
                  and tablename <> 'schema_migrations'
                order by tablename
                """,
            )
            tables = [f'public."{row[0]}"' for row in cursor.fetchall()]
            if tables:
                cursor.execute(f"truncate table {', '.join(tables)} restart identity cascade")
        connection.commit()
    RATE_LIMIT_BUCKETS.clear()
    storage._files.clear()


_apply_schema()


@app.post("/__e2e/reset")
async def reset_e2e_state() -> dict[str, bool]:
    _reset_database()
    return {"ok": True}


@app.post("/__e2e/follow-up-booking-token")
async def create_e2e_follow_up_booking_token(payload: dict[str, str]) -> dict[str, str]:
    return {
        "token": create_follow_up_booking_token(
            org_id=payload["org_id"],
            patient_id=payload["patient_id"],
            follow_up_id=payload["follow_up_id"],
        )
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8015)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
