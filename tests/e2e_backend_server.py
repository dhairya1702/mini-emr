from __future__ import annotations

import argparse
import os


def _configure_environment() -> None:
    os.environ["AUTH_SECRET"] = "playwright-e2e-secret"
    os.environ["DATABASE_URL"] = "postgresql://unused:unused@127.0.0.1:5432/unused"
    os.environ["GCS_PATIENT_ATTACHMENTS_BUCKET"] = "playwright-e2e-bucket"
    os.environ["APP_ORIGIN"] = "http://127.0.0.1:3117"
    os.environ["APP_ORIGINS"] = ",".join(
        [
            "http://127.0.0.1:3117",
            "http://localhost:3117",
            "http://127.0.0.1:3119",
            "http://localhost:3119",
        ],
    )
    os.environ["OPEN_CLINIC_REGISTRATION"] = "true"
    os.environ["GOOGLE_CLOUD_PROJECT"] = ""
    os.environ["GEMINI_MODEL"] = ""
    os.environ["SUPER_ADMIN_IDENTIFIERS"] = "ops-super@clinic.test"
    os.environ["INTERNAL_SCHEDULER_TOKEN"] = "playwright-internal-token"


_configure_environment()

import uvicorn

from app.db import get_repository
from app.main import RATE_LIMIT_BUCKETS, app
from app.services.followup_booking_service import create_follow_up_booking_token
from app.storage import get_patient_attachment_storage
from test_app import FakePatientAttachmentStorage, FakeRepo


repo_holder = {"repo": FakeRepo()}


def _repo() -> FakeRepo:
    return repo_holder["repo"]


def _storage() -> FakePatientAttachmentStorage:
    return FakePatientAttachmentStorage(_repo())


app.dependency_overrides[get_repository] = _repo
app.dependency_overrides[get_patient_attachment_storage] = _storage


@app.post("/__e2e/reset")
async def reset_e2e_state() -> dict[str, bool]:
    repo_holder["repo"] = FakeRepo()
    RATE_LIMIT_BUCKETS.clear()
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
    parser.add_argument("--port", type=int, default=8011)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
