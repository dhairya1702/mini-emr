from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime

import pytest

import test_app  # noqa: F401
from app.config import Settings
import app.db as db_module
from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import AI_USAGE_COLUMNS, PostgresAIUsageRepository
from app.repositories.postgres.attachments import PATIENT_ATTACHMENT_COLUMNS, PostgresAttachmentsRepository
from app.repositories.postgres.audit import AUDIT_EVENT_COLUMNS, PostgresAuditRepository
from app.repositories.postgres.auth_settings import (
    CLINIC_FRONTEND_SETTINGS_RESULT_COLUMNS,
    CLINIC_RUNTIME_SETTINGS_COLUMNS,
    CLINIC_SETTINGS_COLUMNS,
    SUPERUSER_ORG_SUMMARY_COLUMNS,
    USER_COLUMNS,
    USER_LIST_COLUMNS,
    PostgresAuthSettingsRepository,
)
from app.repositories.postgres.billing import CATALOG_ITEM_COLUMNS, INVOICE_COLUMNS, INVOICE_ITEM_COLUMNS, PostgresBillingRepository
from app.repositories.postgres.case_studies import CASE_STUDY_COLUMNS, PostgresCaseStudiesRepository
from app.repositories.postgres.checkins import CHECK_IN_REQUEST_COLUMNS, PostgresCheckInsRepository
from app.repositories.postgres.dashboard import PostgresDashboardRepository
from app.repositories.postgres.myopia import MYOPIA_MEASUREMENT_COLUMNS, PostgresMyopiaRepository
from app.repositories.postgres.patient_flow import (
    APPOINTMENT_COLUMNS,
    PATIENT_COLUMNS,
    PATIENT_LIST_COLUMNS,
    PATIENT_VISIT_COLUMNS,
    PostgresPatientFlowRepository,
)
from app.repositories.postgres.platform_errors import PLATFORM_ERROR_COLUMNS, PostgresPlatformErrorsRepository
from app.repositories.postgres.platform_email import PostgresPlatformEmailRepository
from app.repositories.postgres.records import FOLLOW_UP_COLUMNS, NOTE_COLUMNS, PostgresRecordsRepository
from app.repositories.postgres.specialty_tracks import LONGITUDINAL_TRACK_COLUMNS, PostgresSpecialtyTracksRepository
from app.schema_domains.auth_settings import ClinicSettingsUpdate, UserAccountUpdate, UserRoleUpdate
from app.schema_domains.billing import CatalogItemCreate, CatalogStockUpdate, InvoiceCreate, InvoiceItemInput
from app.schema_domains.case_studies import CaseStudyCreate
from app.schema_domains.optometry import MyopiaMeasurementCreate
from app.schema_domains.patients import (
    AppointmentCheckInRequest,
    AppointmentCreate,
    AppointmentUpdate,
    FollowUpCreate,
    FollowUpUpdate,
    NoteCreate,
    PatientCreate,
)
from app.schema_domains.specialty import LongitudinalTrackCreate


def test_settings_requires_database_url():
    settings = Settings(
        auth_secret="test-secret",
        app_origin="http://127.0.0.1:3000",
        database_url="",
        gcs_patient_attachments_bucket="clinic-media",
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        settings.validate_runtime()


def test_settings_requires_gcs_bucket():
    settings = Settings(
        auth_secret="test-secret",
        app_origin="http://127.0.0.1:3000",
        database_url="postgresql://clinic:secret@localhost:5432/clinic",
        gcs_patient_attachments_bucket="",
    )

    with pytest.raises(RuntimeError, match="GCS_PATIENT_ATTACHMENTS_BUCKET"):
        settings.validate_runtime()


def test_settings_requires_whatsapp_secret_when_enabled_without_bypass():
    settings = Settings(
        auth_secret="test-secret",
        app_origin="https://clinic.example",
        database_url="postgresql://clinic:secret@localhost:5432/clinic",
        gcs_patient_attachments_bucket="clinic-media",
        whatsapp_enabled=True,
        whatsapp_verify_token="verify-token",
        whatsapp_app_secret="",
        whatsapp_access_token="access-token",
        whatsapp_phone_number_id="phone-number-id",
    )

    with pytest.raises(RuntimeError, match="WHATSAPP_APP_SECRET"):
        settings.validate_runtime()


def test_postgres_connection_manager_requires_database_url():
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        PostgresConnectionManager("")


def test_postgres_connection_manager_uses_pool_for_health_check():
    class FakeCursor:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement: str) -> None:
            self.statements.append(statement)

        def fetchone(self):
            return (1,)

    class FakeConnection:
        def __init__(self, cursor: FakeCursor) -> None:
            self.cursor_instance = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return self.cursor_instance

    class FakePool:
        def __init__(self, conninfo: str) -> None:
            self.conninfo = conninfo
            self.opened = False
            self.closed = False
            self.cursor = FakeCursor()

        def connection(self):
            return FakeConnection(self.cursor)

        def open(self) -> None:
            self.opened = True

        def close(self) -> None:
            self.closed = True

    created_pools: list[FakePool] = []

    def fake_pool_factory(database_url: str) -> FakePool:
        pool = FakePool(database_url)
        created_pools.append(pool)
        return pool

    manager = PostgresConnectionManager(
        "postgresql://clinic:secret@localhost:5432/clinic",
        pool_factory=fake_pool_factory,
    )

    manager.open()
    assert manager.health_check() is True
    manager.close()

    pool = created_pools[0]
    assert pool.conninfo == "postgresql://clinic:secret@localhost:5432/clinic"
    assert pool.opened is True
    assert pool.closed is True
    assert pool.cursor.statements == ["select 1"]


def test_postgres_rate_limit_consumption_deletes_expired_rows_and_refreshes_ttl():
    cursor = ScriptedCursor(
        descriptions=[[], ["request_count"]],
        fetchone_rows=[(3,)],
    )
    repo = PostgresAIUsageRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    count = asyncio.run(
        repo.consume_rate_limit(
            scope="public_appointment_post_ip",
            key_hash="hashed-ip",
            max_window_seconds=300,
        )
    )

    assert count == 3
    assert "delete from public.api_rate_limits where expires_at <= now()" in cursor.executed[0][0]
    upsert, params = cursor.executed[1]
    assert "expires_at = now() + make_interval" in upsert
    assert params == ("public_appointment_post_ip", "hashed-ip", 300, 300, 300, 300)


def test_postgres_ai_usage_repository_creates_event_with_total_tokens():
    class FakeCursor:
        description = [(column,) for column in AI_USAGE_COLUMNS]

        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple]] = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement: str, params: tuple) -> None:
            self.executed.append((statement, params))

        def fetchone(self):
            return (
                "usage-1",
                "org-1",
                "gemini",
                "gemini-test",
                "consultation_note",
                10,
                20,
                3,
                4,
                37,
                {"source": "test"},
                "2026-06-11T10:00:00+00:00",
            )

    class FakeConnection:
        def __init__(self, cursor: FakeCursor) -> None:
            self.cursor_instance = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return self.cursor_instance

    class FakePool:
        def __init__(self) -> None:
            self.cursor = FakeCursor()

        def connection(self):
            return FakeConnection(self.cursor)

    class FakeManager:
        def __init__(self) -> None:
            self.pool = FakePool()

    manager = FakeManager()
    repo = PostgresAIUsageRepository(manager)  # type: ignore[arg-type]

    row = asyncio.run(
        repo.create_ai_usage_event(
            org_id="org-1",
            provider="gemini",
            model="gemini-test",
            feature="consultation_note",
            input_tokens=10,
            output_tokens=20,
            cache_creation_input_tokens=3,
            cache_read_input_tokens=4,
            metadata={"source": "test"},
        )
    )

    _statement, params = manager.pool.cursor.executed[0]
    assert params == (
        "org-1",
        "gemini",
        "gemini-test",
        "consultation_note",
        10,
        20,
        3,
        4,
        37,
        '{"source": "test"}',
    )
    assert row["id"] == "usage-1"
    assert row["total_tokens"] == 37
    assert row["metadata"] == {"source": "test"}


def test_postgres_ai_usage_repository_lists_org_events():
    class FakeCursor:
        description = [(column,) for column in AI_USAGE_COLUMNS]

        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple]] = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement: str, params: tuple) -> None:
            self.executed.append((statement, params))

        def fetchall(self):
            return [
                (
                    "usage-2",
                    "org-1",
                    "gemini",
                    "gemini-test",
                    "clinic_letter",
                    5,
                    7,
                    0,
                    0,
                    12,
                    {},
                    "2026-06-11T11:00:00+00:00",
                )
            ]

    class FakeConnection:
        def __init__(self, cursor: FakeCursor) -> None:
            self.cursor_instance = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return self.cursor_instance

    class FakePool:
        def __init__(self) -> None:
            self.cursor = FakeCursor()

        def connection(self):
            return FakeConnection(self.cursor)

    class FakeManager:
        def __init__(self) -> None:
            self.pool = FakePool()

    manager = FakeManager()
    repo = PostgresAIUsageRepository(manager)  # type: ignore[arg-type]

    rows = asyncio.run(repo.list_ai_usage_events_for_org("org-1", limit=25))

    _statement, params = manager.pool.cursor.executed[0]
    assert params == ("org-1", 25)
    assert rows == [
        {
            "id": "usage-2",
            "org_id": "org-1",
            "provider": "gemini",
            "model": "gemini-test",
            "feature": "clinic_letter",
            "input_tokens": 5,
            "output_tokens": 7,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "total_tokens": 12,
            "metadata": {},
            "created_at": "2026-06-11T11:00:00+00:00",
        }
    ]


def test_postgres_audit_repository_creates_event():
    class FakeCursor:
        description = [(column,) for column in AUDIT_EVENT_COLUMNS]

        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple]] = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement: str, params: tuple) -> None:
            self.executed.append((statement, params))

        def fetchone(self):
            return (
                "audit-1",
                "org-1",
                "user-1",
                "Dr Test",
                "patient",
                "patient-1",
                "patient_created",
                "Created patient",
                {"patient_id": "patient-1"},
                "2026-06-11T12:00:00+00:00",
            )

    class FakeConnection:
        def __init__(self, cursor: FakeCursor) -> None:
            self.cursor_instance = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return self.cursor_instance

    class FakePool:
        def __init__(self) -> None:
            self.cursor = FakeCursor()

        def connection(self):
            return FakeConnection(self.cursor)

    class FakeManager:
        def __init__(self) -> None:
            self.pool = FakePool()

    manager = FakeManager()
    repo = PostgresAuditRepository(manager)  # type: ignore[arg-type]

    row = asyncio.run(
        repo.create_audit_event(
            "org-1",
            "user-1",
            "  Dr Test  ",
            "patient",
            "patient-1",
            "patient_created",
            "  Created patient  ",
            {"patient_id": "patient-1"},
        )
    )

    _statement, params = manager.pool.cursor.executed[0]
    assert params == (
        "org-1",
        "user-1",
        "Dr Test",
        "patient",
        "patient-1",
        "patient_created",
        "Created patient",
        '{"patient_id": "patient-1"}',
    )
    assert row["id"] == "audit-1"
    assert row["metadata"] == {"patient_id": "patient-1"}


def test_postgres_audit_repository_lists_org_events():
    class FakeCursor:
        description = [(column,) for column in AUDIT_EVENT_COLUMNS]

        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple]] = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement: str, params: tuple) -> None:
            self.executed.append((statement, params))

        def fetchall(self):
            return [
                (
                    "audit-2",
                    "org-1",
                    None,
                    "System",
                    "follow_up",
                    "follow-up-1",
                    "follow_up_completed",
                    "Completed follow-up",
                    {},
                    "2026-06-11T13:00:00+00:00",
                )
            ]

    class FakeConnection:
        def __init__(self, cursor: FakeCursor) -> None:
            self.cursor_instance = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return self.cursor_instance

    class FakePool:
        def __init__(self) -> None:
            self.cursor = FakeCursor()

        def connection(self):
            return FakeConnection(self.cursor)

    class FakeManager:
        def __init__(self) -> None:
            self.pool = FakePool()

    manager = FakeManager()
    repo = PostgresAuditRepository(manager)  # type: ignore[arg-type]

    rows = asyncio.run(repo.list_audit_events("org-1", limit=25))

    _statement, params = manager.pool.cursor.executed[0]
    assert params == ("org-1", 25)
    assert rows == [
        {
            "id": "audit-2",
            "org_id": "org-1",
            "actor_user_id": None,
            "actor_name": "System",
            "entity_type": "follow_up",
            "entity_id": "follow-up-1",
            "action": "follow_up_completed",
            "summary": "Completed follow-up",
            "metadata": {},
            "created_at": "2026-06-11T13:00:00+00:00",
        }
    ]


def test_postgres_audit_repository_serializes_datetime_metadata():
    class FakeCursor:
        description = [(column,) for column in AUDIT_EVENT_COLUMNS]

        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple]] = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement: str, params: tuple) -> None:
            self.executed.append((statement, params))

        def fetchone(self):
            return (
                "audit-4",
                "org-1",
                "user-1",
                "Dr Test",
                "note",
                "note-1",
                "note_sent",
                "Sent note",
                {"sent_at": "2026-06-16 09:00:00+00:00"},
                "2026-06-16T09:00:01+00:00",
            )

    class FakeConnection:
        def __init__(self, cursor: FakeCursor) -> None:
            self.cursor_instance = cursor

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return self.cursor_instance

    class FakePool:
        def __init__(self) -> None:
            self.cursor = FakeCursor()

        def connection(self):
            return FakeConnection(self.cursor)

    class FakeManager:
        def __init__(self) -> None:
            self.pool = FakePool()

    manager = FakeManager()
    repo = PostgresAuditRepository(manager)  # type: ignore[arg-type]

    row = asyncio.run(
        repo.create_audit_event(
            "org-1",
            "user-1",
            "Dr Test",
            "note",
            "note-1",
            "note_sent",
            "Sent note",
            {"sent_at": datetime(2026, 6, 16, 9, 0, tzinfo=UTC)},
        )
    )

    _statement, params = manager.pool.cursor.executed[0]
    assert params[7] == '{"sent_at": "2026-06-16 09:00:00+00:00"}'
    assert row["id"] == "audit-4"


class ScriptedCursor:
    def __init__(
        self,
        *,
        descriptions: list[list[str]],
        fetchone_rows: list[tuple | None] | None = None,
        fetchall_rows: list[list[tuple]] | None = None,
    ) -> None:
        self.descriptions = [[(column,) for column in columns] for columns in descriptions]
        self.fetchone_rows = list(fetchone_rows or [])
        self.fetchall_rows = list(fetchall_rows or [])
        self.executed: list[tuple[str, tuple]] = []
        self.description = self.descriptions[0] if self.descriptions else []
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, statement: str, params: tuple = ()) -> None:
        self.executed.append((statement, params))
        index = min(len(self.executed) - 1, len(self.descriptions) - 1)
        if self.descriptions:
            self.description = self.descriptions[index]

    def fetchone(self):
        return self.fetchone_rows.pop(0) if self.fetchone_rows else None

    def fetchall(self):
        return self.fetchall_rows.pop(0) if self.fetchall_rows else []


class ScriptedConnection:
    def __init__(self, cursor: ScriptedCursor) -> None:
        self.cursor_instance = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def cursor(self):
        return self.cursor_instance


class ScriptedPool:
    def __init__(self, cursor: ScriptedCursor) -> None:
        self.cursor = cursor

    def connection(self):
        return ScriptedConnection(self.cursor)


class ScriptedManager:
    def __init__(self, cursor: ScriptedCursor) -> None:
        self.pool = ScriptedPool(cursor)


def test_postgres_dashboard_status_uses_one_read_only_statement_and_expiry_aware_token():
    cursor = ScriptedCursor(
        descriptions=[["queue_revision", "active_patient_count", "check_in_revision", "pending_check_in_count"]],
        fetchone_rows=[("184", 7, "41", 2)],
    )
    repo = PostgresDashboardRepository()
    repo.connection_manager = ScriptedManager(cursor)  # type: ignore[attr-defined]

    status = asyncio.run(repo.get_dashboard_status("org-1"))

    assert status == {
        "queue_revision": "184",
        "active_patient_count": 7,
        "check_in_revision": "41:2",
        "pending_check_in_count": 2,
    }
    assert len(cursor.executed) == 1
    statement, params = cursor.executed[0]
    assert statement.lstrip().lower().startswith("select")
    assert "update " not in statement.lower()
    assert params == ("org-1", "org-1", "org-1")


def test_postgres_billing_status_is_lightweight_and_invoice_summaries_skip_item_payloads():
    status_cursor = ScriptedCursor(
        descriptions=[["billing_patients_revision", "billable_patient_count", "billing_invoices_revision"]],
        fetchone_rows=[("12", 3, "29")],
    )
    status_repo = PostgresBillingRepository(ScriptedManager(status_cursor))  # type: ignore[arg-type]

    status = asyncio.run(status_repo.get_billing_status("org-1"))

    assert status == {
        "billable_patients_revision": "12",
        "billable_patient_count": 3,
        "invoices_revision": "29",
    }
    assert len(status_cursor.executed) == 1
    assert status_cursor.executed[0][1] == ("org-1", "org-1")
    assert "invoice_items" not in status_cursor.executed[0][0]

    summary_cursor = ScriptedCursor(
        descriptions=[[
            "id", "patient_id", "patient_name", "item_count", "total",
            "payment_status", "amount_paid", "balance_due", "created_at",
        ]],
        fetchall_rows=[[(
            "invoice-1", "patient-1", "Patient One", 2, 800.0,
            "partial", 100.0, 700.0, datetime(2026, 8, 12, tzinfo=UTC),
        )]],
    )
    summary_repo = PostgresBillingRepository(ScriptedManager(summary_cursor))  # type: ignore[arg-type]

    summaries = asyncio.run(summary_repo.list_invoice_summaries("org-1", limit=5))

    assert summaries[0]["item_count"] == 2
    assert "items" not in summaries[0]
    assert "completed_by_name" not in summaries[0]
    assert len(summary_cursor.executed) == 1
    assert summary_cursor.executed[0][1] == ("org-1", 5)
    statement = summary_cursor.executed[0][0].lower()
    assert "clinic_users" not in statement
    assert "select count(*)" in statement


def test_postgres_platform_errors_repository_creates_trimmed_error():
    cursor = ScriptedCursor(
        descriptions=[PLATFORM_ERROR_COLUMNS],
        fetchone_rows=[
            (
                "error-1",
                "org-1",
                "user-1",
                "",
                "/patients",
                "GET",
                500,
                "RuntimeError",
                "m" * 500,
                "d" * 4000,
                {"request_id": "req-1"},
                "2026-06-11T14:00:00+00:00",
            )
        ],
    )
    repo = PostgresPlatformErrorsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    row = asyncio.run(
        repo.create_platform_error(
            org_id="org-1",
            user_id="user-1",
            identifier=None,
            path="/patients",
            method="GET",
            status_code=500,
            error_type="RuntimeError",
            message="m" * 550,
            details="d" * 4100,
            context={"request_id": "req-1"},
        )
    )

    _statement, params = cursor.executed[0]
    assert params == (
        "org-1",
        "user-1",
        "",
        "/patients",
        "GET",
        500,
        "RuntimeError",
        "m" * 500,
        "d" * 4000,
        '{"request_id": "req-1"}',
    )
    assert row["id"] == "error-1"
    assert row["context"] == {"request_id": "req-1"}


def test_postgres_platform_errors_repository_lists_errors_for_org():
    cursor = ScriptedCursor(
        descriptions=[PLATFORM_ERROR_COLUMNS],
        fetchall_rows=[
            [
                (
                    "error-2",
                    "org-1",
                    None,
                    "admin@example.com",
                    "/settings",
                    "POST",
                    400,
                    "HTTPException",
                    "Bad request",
                    "",
                    {},
                    "2026-06-11T14:30:00+00:00",
                )
            ]
        ],
    )
    repo = PostgresPlatformErrorsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    rows = asyncio.run(repo.list_platform_errors(limit=20, org_id="org-1"))

    _statement, params = cursor.executed[0]
    assert params == ("org-1", 20)
    assert rows[0]["id"] == "error-2"
    assert rows[0]["identifier"] == "admin@example.com"


def test_postgres_platform_errors_repository_records_request_metric_batch():
    cursor = ScriptedCursor(descriptions=[])
    repo = PostgresPlatformErrorsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    asyncio.run(
        repo.record_api_request_batch(
            [
                {
                    "metric_date": "2026-07-30",
                    "org_id": "11111111-1111-1111-1111-111111111111",
                    "request_count": 12,
                    "error_response_count": 2,
                },
                {
                    "metric_date": "2026-07-30",
                    "org_id": "",
                    "request_count": 3,
                    "error_response_count": 0,
                },
            ]
        )
    )

    statement, params = cursor.executed[0]
    payload = __import__("json").loads(params[1])
    assert "jsonb_to_recordset" in statement
    assert "metrics.request_count + excluded.request_count" in statement
    assert params[0] == "00000000-0000-0000-0000-000000000000"
    assert payload[0]["request_count"] == 12
    assert payload[1]["org_id"] == ""


def test_postgres_auth_settings_repository_creates_organization_and_user():
    cursor = ScriptedCursor(
        descriptions=[["id", "name", "created_at"], [*USER_COLUMNS, "session_version", "superdashboard_session_version"]],
        fetchone_rows=[
            ("org-1", "Fika Clinic", "2026-06-11T15:00:00+00:00"),
            (
                "user-1",
                "org-1",
                "admin@example.com",
                "",
                "admin",
                None,
                "",
                None,
                None,
                None,
                "2026-06-11T15:01:00+00:00",
                1,
                1,
            ),
        ],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    org = asyncio.run(repo.create_organization("  Fika Clinic  "))
    user = asyncio.run(
        repo.create_user(
            org_id="org-1",
            identifier="admin@example.com",
            name="",
            password_hash="hashed",
            role="admin",
        )
    )

    assert cursor.executed[0][1] == ("Fika Clinic",)
    assert cursor.executed[1][1] == ("org-1", "admin@example.com", "", "hashed", "admin")
    assert org["name"] == "Fika Clinic"
    assert user["name"] == "Admin"
    assert user["doctor_signature_url"] is None


def test_postgres_auth_settings_repository_runtime_settings_exclude_large_and_secret_fields():
    cursor = ScriptedCursor(
        descriptions=[CLINIC_RUNTIME_SETTINGS_COLUMNS],
        fetchone_rows=[None],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    assert asyncio.run(repo.get_clinic_runtime_settings("org-1")) == {}
    statement, params = cursor.executed[0]
    assert "document_template_data_base64" not in statement
    assert "sender_email_app_password" not in statement
    assert "timezone" in statement
    assert params == ("org-1",)


def test_postgres_auth_settings_repository_frontend_settings_return_presence_flags_without_values(monkeypatch):
    cursor = ScriptedCursor(
        descriptions=[CLINIC_FRONTEND_SETTINGS_RESULT_COLUMNS],
        fetchone_rows=[tuple(
            True if column in {"document_template_configured", "clinic_email_password_configured"} else None
            for column in CLINIC_FRONTEND_SETTINGS_RESULT_COLUMNS
        )],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]
    monkeypatch.setattr(
        "app.repositories.postgres.auth_settings.decrypt_stored_secret",
        lambda _value: (_ for _ in ()).throw(AssertionError("frontend settings must not decrypt secrets")),
    )

    settings = asyncio.run(repo.get_clinic_frontend_settings("org-1"))

    statement, params = cursor.executed[0]
    assert "document_template_data_base64" not in CLINIC_FRONTEND_SETTINGS_RESULT_COLUMNS
    assert "sender_email_app_password" not in CLINIC_FRONTEND_SETTINGS_RESULT_COLUMNS
    assert "as document_template_configured" in statement
    assert "as clinic_email_password_configured" in statement
    assert settings["document_template_configured"] is True
    assert settings["clinic_email_password_configured"] is True
    assert "document_template_data_base64" not in settings
    assert "sender_email_app_password" not in settings
    assert params == ("org-1",)


def test_postgres_platform_email_availability_does_not_read_or_decrypt_credential(monkeypatch):
    cursor = ScriptedCursor(
        descriptions=[["sender_email", "is_enabled", "credential_configured"]],
        fetchone_rows=[("platform@example.com", True, True)],
    )
    repo = PostgresPlatformEmailRepository()
    repo.connection_manager = ScriptedManager(cursor)  # type: ignore[assignment]
    monkeypatch.setattr(
        "app.repositories.postgres.platform_email.decrypt_stored_secret",
        lambda _value: (_ for _ in ()).throw(AssertionError("availability must not decrypt secrets")),
    )

    availability = asyncio.run(repo.get_platform_email_availability())

    statement, params = cursor.executed[0]
    assert "select sender_email, is_enabled" in statement
    assert "as credential_configured" in statement
    assert availability == {
        "sender_email": "platform@example.com",
        "is_enabled": True,
        "credential_configured": True,
    }
    assert params == ()


def test_postgres_auth_settings_repository_reads_and_updates_user_shapes():
    cursor = ScriptedCursor(
        descriptions=[
            USER_LIST_COLUMNS,
            [*USER_COLUMNS, "session_version", "superdashboard_session_version"],
            [*USER_COLUMNS, "session_version", "superdashboard_session_version"],
            [*USER_COLUMNS, "session_version", "superdashboard_session_version"],
            [*USER_COLUMNS, "session_version", "superdashboard_session_version"],
        ],
        fetchall_rows=[
            [
                (
                    "user-1",
                    "org-1",
                    "doctor@example.com",
                    "Dr Test",
                    "admin",
                    None,
                    "",
                    "signature.png",
                    "image/png",
                    "2026-06-11T15:01:00+00:00",
                )
            ]
        ],
        fetchone_rows=[
            (
                "user-1",
                "org-1",
                "doctor@example.com",
                "Dr Updated",
                "admin",
                "1990-01-01",
                "Clinic Lane",
                "signature.png",
                "image/png",
                "base64",
                "2026-06-11T15:01:00+00:00",
                1,
                1,
            ),
            (
                "user-1",
                "org-1",
                "doctor@example.com",
                "Dr Updated",
                "staff",
                "1990-01-01",
                "Clinic Lane",
                "signature.png",
                "image/png",
                "base64",
                "2026-06-11T15:01:00+00:00",
                1,
                1,
            ),
            (
                "user-1",
                "org-1",
                "doctor@example.com",
                "Dr Updated",
                "staff",
                "1990-01-01",
                "Clinic Lane",
                "signature.png",
                "image/png",
                "base64",
                "2026-06-11T15:01:00+00:00",
                1,
                1,
            ),
            (
                "user-1",
                "org-1",
                "doctor@example.com",
                "Dr Updated",
                "staff",
                "1990-01-01",
                "Clinic Lane",
                None,
                None,
                None,
                "2026-06-11T15:01:00+00:00",
                1,
                1,
            ),
        ],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    users = asyncio.run(repo.list_users("org-1"))
    updated = asyncio.run(
        repo.update_user_account(
            "user-1",
            UserAccountUpdate(name="  Dr Updated  ", doctor_dob=date(1990, 1, 1), doctor_address="  Clinic Lane  "),
        )
    )
    role_updated = asyncio.run(repo.update_user_role("user-1", UserRoleUpdate(role="staff")))
    signature_updated = asyncio.run(
        repo.set_user_signature(
            "user-1",
            filename="signature.png",
            content_type="image/png",
            data_base64="base64",
        )
    )
    signature_removed = asyncio.run(repo.clear_user_signature("user-1"))

    assert users[0]["doctor_signature_url"] == "/users/user-1/signature/file"
    assert cursor.executed[1][1][:3] == ("Dr Updated", "1990-01-01", "Clinic Lane")
    assert updated["doctor_signature_url"] == "/users/user-1/signature/file"
    assert cursor.executed[2][1][0] == "staff"
    assert role_updated["role"] == "staff"
    assert signature_updated["superdashboard_session_version"] == 1
    assert signature_removed["doctor_signature_name"] is None
    assert signature_removed["superdashboard_session_version"] == 1


def test_postgres_auth_settings_repository_upserts_clinic_settings_with_defaults():
    clinic_settings_row = (
        "settings-1",
        "org-1",
        "Fika Clinic",
        "12 Main",
        "123",
        "",
        None,
        "UTC",
        "09:00",
        "18:00",
        4,
        "",
        "",
        "",
        None,
        "clinicos",
        "",
        "",
        None,
        None,
        None,
        None,
        False,
        False,
        False,
        54,
        54,
        54,
        54,
        0.1,
        0.78,
        0.24,
        0.08,
        0.1,
        0.87,
        0.24,
        0.04,
        {},
        False,
        None,
        2,
        "solo",
        "2026-06-11T16:00:00+00:00",
    )
    cursor = ScriptedCursor(
        descriptions=[CLINIC_SETTINGS_COLUMNS, CLINIC_SETTINGS_COLUMNS],
        fetchone_rows=[None, clinic_settings_row],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    row = asyncio.run(
        repo.upsert_clinic_settings(
            "org-1",
            ClinicSettingsUpdate(clinic_name="Fika Clinic", clinic_address="12 Main", clinic_phone="123"),
        )
    )

    assert cursor.executed[0][1] == ("org-1",)
    upsert_params = cursor.executed[1][1]
    assert upsert_params[0] == "org-1"
    assert upsert_params[1:4] == ("Fika Clinic", "12 Main", "123")
    assert row["clinic_name"] == "Fika Clinic"


def test_postgres_auth_settings_repository_sets_and_clears_template():
    set_row = (
        "settings-1",
        "org-1",
        "Fika Clinic",
        "",
        "",
        "",
        None,
        "UTC",
        "09:00",
        "18:00",
        4,
        "",
        "",
        "",
        None,
        "clinicos",
        "",
        "",
        "letter.docx",
        "/settings/clinic/document-template/file",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "base64",
        True,
        True,
        True,
        54,
        54,
        54,
        54,
        0.1,
        0.78,
        0.24,
        0.08,
        0.1,
        0.87,
        0.24,
        0.04,
        {},
        False,
        None,
        2,
        "solo",
        "2026-06-11T16:05:00+00:00",
    )
    clear_row = (
        "settings-1",
        "org-1",
        "Fika Clinic",
        "",
        "",
        "",
        None,
        "UTC",
        "09:00",
        "18:00",
        4,
        "",
        "",
        "",
        None,
        "clinicos",
        "",
        "",
        None,
        None,
        None,
        None,
        False,
        False,
        False,
        54,
        54,
        54,
        54,
        0.1,
        0.78,
        0.24,
        0.08,
        0.1,
        0.87,
        0.24,
        0.04,
        {},
        False,
        None,
        2,
        "solo",
        "2026-06-11T16:06:00+00:00",
    )
    cursor = ScriptedCursor(
        descriptions=[
            CLINIC_SETTINGS_COLUMNS,
            CLINIC_SETTINGS_COLUMNS,
            CLINIC_SETTINGS_COLUMNS,
            CLINIC_SETTINGS_COLUMNS,
        ],
        fetchone_rows=[None, set_row, set_row, clear_row],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    saved = asyncio.run(
        repo.set_clinic_document_template(
            "org-1",
            filename="letter.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            data_base64="base64",
        )
    )
    cleared = asyncio.run(repo.clear_clinic_document_template("org-1"))

    assert saved["document_template_name"] == "letter.docx"
    assert saved["document_template_notes_enabled"] is True
    assert cleared["document_template_name"] is None
    assert cleared["document_template_notes_enabled"] is False


def test_postgres_auth_settings_repository_lists_superuser_org_summaries():
    cursor = ScriptedCursor(
        descriptions=[SUPERUSER_ORG_SUMMARY_COLUMNS],
        fetchall_rows=[
            [
                (
                    "org-1",
                    "Fika Clinic",
                    "team",
                    6,
                    "2026-06-10T10:00:00+00:00",
                    2,
                    5,
                    4,
                    3,
                    1,
                    1200,
                    4096,
                    2,
                    "2026-06-11T16:10:00+00:00",
                )
            ]
        ],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    rows = asyncio.run(repo.list_all_organizations())

    assert cursor.executed[0][1] == ()
    assert rows == [
        {
            "org_id": "org-1",
            "clinic_name": "Fika Clinic",
            "workspace_mode": "team",
            "users_allowed": 6,
            "created_at": "2026-06-10T10:00:00+00:00",
            "user_count": 2,
            "patient_count": 5,
            "note_count": 4,
            "invoice_count": 3,
            "follow_up_count": 1,
            "total_tokens": 1200,
            "media_storage_bytes": 4096,
            "recent_error_count": 2,
            "last_activity_at": "2026-06-11T16:10:00+00:00",
        }
    ]


def test_postgres_auth_settings_repository_deletes_and_counts_users():
    cursor = ScriptedCursor(
        descriptions=[[], [], ["count"]],
        fetchone_rows=[(7,)],
    )
    repo = PostgresAuthSettingsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    asyncio.run(repo.delete_user("user-1"))
    asyncio.run(repo.delete_organization("org-1"))
    count = asyncio.run(repo.count_users())

    assert cursor.executed[0][1] == ("user-1",)
    assert cursor.executed[1][1] == ("org-1",)
    assert count == 7


def _patient_row(patient_id: str = "patient-1", *, phone: str = "1234567890", current_visit_id: str | None = None) -> tuple:
    return (
        patient_id,
        "org-1",
        "DL",
        phone,
        "dl@example.com",
        "Main Road",
        "fever",
        date(2014, 1, 20),
        "female",
        "",
        12,
        78,
        175,
        98,
        None,
        None,
        None,
        "waiting",
        False,
        None,
        "normal",
        "2026-06-11T17:00:00+00:00",
        1,
        current_visit_id,
        "",
        None,
        True,
        0,
        None,
        "2026-06-11T17:00:00+00:00",
        "2026-06-11T17:00:00+00:00",
    )


def _check_in_request_row(request_id: str = "check-in-1") -> tuple:
    return (
        request_id,
        "org-1",
        "DL",
        "+91 12345 67890",
        "+911234567890",
        "dl@example.com",
        date(2014, 1, 20),
        "female",
        "Eye exam",
        "pending",
        None,
        None,
        None,
        "",
        datetime(2026, 7, 30, 9, tzinfo=UTC),
        datetime(2026, 7, 30, 21, tzinfo=UTC),
    )


def test_postgres_check_in_creation_relies_on_atomic_pending_unique_index():
    cursor = ScriptedCursor(
        descriptions=[[], CHECK_IN_REQUEST_COLUMNS],
        fetchone_rows=[_check_in_request_row()],
    )
    repo = PostgresCheckInsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_public_check_in_request(
            org_id="org-1",
            name="DL",
            phone="+91 12345 67890",
            email="DL@example.com",
            date_of_birth=date(2014, 1, 20),
            sex_at_birth="female",
            reason="Eye exam",
        )
    )

    statements = [statement for statement, _params in cursor.executed]
    assert len(statements) == 2
    assert "set status = 'expired'" in statements[0]
    assert "insert into public.public_check_in_requests" in statements[1]
    assert not any("select id" in statement for statement in statements)
    assert created["id"] == "check-in-1"


def test_postgres_check_in_listing_bulk_loads_candidates_using_stored_match_keys():
    cursor = ScriptedCursor(
        descriptions=[
            CHECK_IN_REQUEST_COLUMNS,
            ["check_in_request_id", *PATIENT_COLUMNS],
        ],
        fetchall_rows=[
            [_check_in_request_row()],
            [("check-in-1", *_patient_row())],
        ],
    )
    repo = PostgresCheckInsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    requests = asyncio.run(repo.list_public_check_in_requests("org-1"))

    assert len(cursor.executed) == 2
    list_statement, _list_params = cursor.executed[0]
    assert "expires_at > now()" in list_statement
    assert "update public.public_check_in_requests" not in list_statement
    candidate_statement, candidate_params = cursor.executed[1]
    assert "check_in.id = any(%s::uuid[])" in candidate_statement
    assert "patient.phone_match_key = check_in.submitted_phone_match_key" in candidate_statement
    assert "patient.email_normalized = check_in.submitted_email_normalized" in candidate_statement
    assert "regexp_replace(phone" not in candidate_statement
    assert candidate_params == ("org-1", ["check-in-1"])
    assert requests[0]["candidates"][0]["id"] == "patient-1"
    assert requests[0]["candidates"][0]["confidence"] == "strong"


def test_postgres_check_in_status_is_a_single_read_query():
    cursor = ScriptedCursor(
        descriptions=[["id"]],
        fetchall_rows=[[('request-b',), ('request-a',)]],
    )
    repo = PostgresCheckInsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    status = asyncio.run(repo.get_public_check_in_requests_status("org-1"))

    assert len(cursor.executed) == 1
    statement, params = cursor.executed[0]
    assert statement.lstrip().lower().startswith("select")
    assert "status = 'pending'" in statement
    assert "expires_at > now()" in statement
    assert params == ("org-1",)
    assert status["pending_count"] == 2
    assert status["revision"]


def _appointment_row(*, status: str = "scheduled", phone: str = "1234567890") -> tuple:
    return (
        "appointment-1",
        "org-1",
        "DL",
        phone,
        "dl@example.com",
        "Main Road",
        "fever",
        date(2014, 1, 20),
        "female",
        "",
        12,
        78,
        175,
        98,
        "2026-06-12T10:00:00+00:00",
        status,
        None,
        None,
        "2026-06-11T17:00:00+00:00",
    )


def _note_row(*, status: str = "draft", content: str = "Visit note", sent_at: str | None = None) -> tuple:
    return (
        "note-1",
        "org-1",
        "patient-1",
        None,
        content,
        status,
        1,
        None,
        None,
        None,
        [],
        [],
        [],
        {},
        None,
        None,
        sent_at,
        None,
        None,
        "2026-06-11T18:00:00+00:00",
    )


def _follow_up_row(*, status: str = "scheduled", reminder_sent_at: str | None = None) -> tuple:
    return (
        "follow-up-1",
        "org-1",
        "patient-1",
        "user-1",
        "2026-06-12T09:00:00+00:00",
        "review",
        status,
        None,
        reminder_sent_at,
        "2026-06-11T18:30:00+00:00",
    )


def test_postgres_patient_flow_repository_creates_patient_and_visit():
    cursor = ScriptedCursor(
        descriptions=[PATIENT_COLUMNS, ["id"], PATIENT_COLUMNS],
        fetchone_rows=[_patient_row(phone="1234567890"), ("visit-1",), _patient_row(phone="1234567890", current_visit_id="visit-1")],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    patient = asyncio.run(
        repo.create_patient(
            "org-1",
            PatientCreate(
                name=" DL ",
                phone="123-456-7890",
                email=" DL@EXAMPLE.COM ",
                address=" Main Road ",
                reason=" fever ",
                age=12,
                weight=78,
                height=175,
                temperature=98,
            ),
        )
    )

    assert cursor.executed[0][1][1:6] == ("DL", "1234567890", "dl@example.com", "Main Road", "fever")
    assert cursor.executed[1][1][0:2] == ("org-1", "patient-1")
    assert patient["id"] == "patient-1"


def test_postgres_patient_list_skips_queue_enrichment_when_not_requested():
    full_patient = dict(zip(PATIENT_COLUMNS, _patient_row(current_visit_id="visit-1"), strict=True))
    list_row = tuple(full_patient[column] for column in PATIENT_LIST_COLUMNS)
    cursor = ScriptedCursor(
        descriptions=[PATIENT_LIST_COLUMNS],
        fetchall_rows=[[list_row]],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    patients = asyncio.run(repo.list_patients("org-1", limit=20))

    assert len(cursor.executed) == 1
    assert "ai_summary" not in cursor.executed[0][0]
    assert patients[0]["id"] == "patient-1"
    assert patients[0]["current_visit_id"] == "visit-1"


def test_postgres_patient_list_applies_stable_cursor_without_queue_enrichment():
    cursor = ScriptedCursor(descriptions=[PATIENT_LIST_COLUMNS], fetchall_rows=[[]])
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]
    cursor_time = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)

    patients = asyncio.run(
        repo.list_patients(
            "org-1",
            limit=21,
            cursor_last_visit_at=cursor_time,
            cursor_id="00000000-0000-0000-0000-000000000042",
        )
    )

    statement, params = cursor.executed[0]
    assert patients == []
    assert "(last_visit_at, id) < (%s, %s::uuid)" in statement
    assert "order by last_visit_at desc, id desc" in " ".join(statement.split())
    assert params == (
        "org-1",
        cursor_time,
        "00000000-0000-0000-0000-000000000042",
        21,
        0,
    )


def test_postgres_patient_flow_repository_lists_appointments_with_filters():
    cursor = ScriptedCursor(
        descriptions=[APPOINTMENT_COLUMNS],
        fetchall_rows=[[_appointment_row()]],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    rows = asyncio.run(
        repo.list_appointments(
            "org-1",
            status="scheduled",
            query="DL",
            limit=25,
            scheduled_from="2026-06-12T00:00:00+00:00",
            scheduled_to="2026-06-13T00:00:00+00:00",
        )
    )

    assert cursor.executed[0][1] == (
        "org-1",
        "scheduled",
        "2026-06-12T00:00:00+00:00",
        "2026-06-13T00:00:00+00:00",
        "%DL%",
        "%DL%",
        "%DL%",
        25,
    )
    assert rows[0]["id"] == "appointment-1"


def test_postgres_public_appointment_duplicate_check_is_locked_and_atomic():
    cursor = ScriptedCursor(
        descriptions=[[], [], ["exists"]],
        fetchone_rows=[(1,)],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    with pytest.raises(
        ValueError,
        match="An active appointment already exists for this phone number",
    ):
        asyncio.run(
            repo.create_appointment(
                "org-1",
                AppointmentCreate(
                    name="Duplicate Patient",
                    phone="(555) 010-7002",
                    reason="Review",
                    scheduled_for=datetime(2026, 8, 1, 10, tzinfo=UTC),
                ),
                reject_duplicate_phone=True,
            )
        )

    assert "public-appointment:5550107002" in cursor.executed[1][1]
    duplicate_query, duplicate_params = cursor.executed[2]
    assert "scheduled_for >= now()" in duplicate_query
    assert duplicate_params == ("org-1", "5550107002")
    assert not any("insert into public.appointments" in statement for statement, _ in cursor.executed)


def test_postgres_patient_flow_repository_detects_duplicate_check_in_matches():
    cursor = ScriptedCursor(
        descriptions=[APPOINTMENT_COLUMNS, PATIENT_COLUMNS],
        fetchone_rows=[_appointment_row(phone="1234567890")],
        fetchall_rows=[[_patient_row(phone="1234567890")]],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    with pytest.raises(Exception) as exc_info:
        asyncio.run(repo.check_in_appointment("org-1", "appointment-1", AppointmentCheckInRequest()))

    assert exc_info.type.__name__ == "DuplicateCheckInCandidateError"
    assert cursor.executed[0][1] == ("org-1", "appointment-1")
    assert cursor.executed[1][1] == ("org-1", "1234567890")


def test_postgres_patient_flow_repository_checks_in_via_schema_function_when_forced():
    cursor = ScriptedCursor(
        descriptions=[["check_in_appointment_atomic"], ["visit_kind"]],
        fetchone_rows=[
            (
                {
                    "appointment": {"id": "appointment-1", "status": "checked_in"},
                    "patient": {"id": "patient-1", "status": "waiting"},
                },
            ),
            ("follow_up",),
        ],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    appointment, patient = asyncio.run(
        repo.check_in_appointment(
            "org-1",
            "appointment-1",
            AppointmentCheckInRequest(force_new=True),
        )
    )

    assert cursor.executed[0][1] == ("org-1", "appointment-1", None)
    assert appointment["status"] == "checked_in"
    assert patient["id"] == "patient-1"


def test_postgres_patient_flow_repository_updates_appointment_with_validation():
    cursor = ScriptedCursor(
        descriptions=[APPOINTMENT_COLUMNS, APPOINTMENT_COLUMNS],
        fetchone_rows=[_appointment_row(status="scheduled"), _appointment_row(status="cancelled")],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    updated = asyncio.run(repo.update_appointment("org-1", "appointment-1", AppointmentUpdate(status="cancelled")))

    assert cursor.executed[1][1] == ("cancelled", "org-1", "appointment-1")
    assert updated["status"] == "cancelled"


def test_postgres_appointment_audit_failure_exits_the_mutation_transaction_with_error():
    class FailingAuditCursor(ScriptedCursor):
        def execute(self, statement: str, params: tuple = ()) -> None:
            if "insert into public.audit_events" in statement:
                raise RuntimeError("audit insert failed")
            super().execute(statement, params)

    class TrackingConnection(ScriptedConnection):
        exit_exception: type[BaseException] | None = None

        def __exit__(self, exc_type, *_args):
            self.exit_exception = exc_type
            return None

    class TrackingPool:
        def __init__(self, cursor: ScriptedCursor) -> None:
            self.connection_instance = TrackingConnection(cursor)

        def connection(self):
            return self.connection_instance

    class TrackingManager:
        def __init__(self, cursor: ScriptedCursor) -> None:
            self.pool = TrackingPool(cursor)

    cursor = FailingAuditCursor(
        descriptions=[APPOINTMENT_COLUMNS, APPOINTMENT_COLUMNS],
        fetchone_rows=[
            _appointment_row(status="scheduled"),
            _appointment_row(status="cancelled"),
        ],
    )
    manager = TrackingManager(cursor)
    repo = PostgresPatientFlowRepository(manager)  # type: ignore[arg-type]

    with pytest.raises(RuntimeError, match="audit insert failed"):
        asyncio.run(
            repo.update_appointment(
                "org-1",
                "appointment-1",
                AppointmentUpdate(status="cancelled"),
                audit_event_factory=lambda appointment: [{
                    "org_id": "org-1",
                    "actor_user_id": None,
                    "actor_name": "Clinic Team",
                    "entity_type": "appointment",
                    "entity_id": appointment["id"],
                    "action": "appointment_cancelled",
                    "summary": "Cancelled appointment.",
                    "metadata": {},
                }],
            )
        )

    assert any("update public.appointments" in statement for statement, _params in cursor.executed)
    assert manager.pool.connection_instance.exit_exception is RuntimeError


def test_postgres_invoice_payment_audit_failure_exits_the_mutation_transaction_with_error():
    class FailingAuditCursor(ScriptedCursor):
        def execute(self, statement: str, params: tuple = ()) -> None:
            if "insert into public.audit_events" in statement:
                raise RuntimeError("audit insert failed")
            super().execute(statement, params)

    class TrackingConnection(ScriptedConnection):
        exit_exception: type[BaseException] | None = None

        def __exit__(self, exc_type, *_args):
            self.exit_exception = exc_type
            return None

    class TrackingPool:
        def __init__(self, cursor: ScriptedCursor) -> None:
            self.connection_instance = TrackingConnection(cursor)

        def connection(self):
            return self.connection_instance

    class TrackingManager:
        def __init__(self, cursor: ScriptedCursor) -> None:
            self.pool = TrackingPool(cursor)

    cursor = FailingAuditCursor(
        descriptions=[
            INVOICE_COLUMNS,
            INVOICE_COLUMNS,
            INVOICE_ITEM_COLUMNS,
        ],
        fetchone_rows=[
            _invoice_row(amount_paid=100),
            _invoice_row(amount_paid=200),
        ],
        fetchall_rows=[[_invoice_item_row()]],
    )
    manager = TrackingManager(cursor)
    repo = PostgresBillingRepository(manager)  # type: ignore[arg-type]

    with pytest.raises(RuntimeError, match="audit insert failed"):
        asyncio.run(
            repo.update_invoice_payment(
                "org-1",
                "invoice-1",
                amount_paid=200,
                actor_user_id="user-1",
                audit_event_factory=lambda invoice: [{
                    "org_id": "org-1",
                    "actor_user_id": "user-1",
                    "actor_name": "Dr Test",
                    "entity_type": "invoice",
                    "entity_id": invoice["id"],
                    "action": "invoice_payment_updated",
                    "summary": "Updated payment.",
                    "metadata": {},
                }],
            )
        )

    assert any("update public.invoices" in statement for statement, _params in cursor.executed)
    assert manager.pool.connection_instance.exit_exception is RuntimeError


def test_postgres_patient_flow_repository_gets_timeline_source():
    cursor = ScriptedCursor(
        descriptions=[["get_patient_timeline_source"]],
        fetchone_rows=[
            (
                {
                    "patient": {"id": "patient-1"},
                    "visits": [],
                    "notes": [],
                    "follow_ups": [],
                },
            )
        ],
    )
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    payload = asyncio.run(repo.get_patient_timeline_source("org-1", "patient-1"))

    assert cursor.executed[0][1] == ("org-1", "patient-1")
    assert payload["patient"]["id"] == "patient-1"


def test_postgres_patient_flow_repository_rejects_unknown_patient_update_fields():
    cursor = ScriptedCursor(descriptions=[])
    repo = PostgresPatientFlowRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Unsupported patient update fields"):
        asyncio.run(repo.update_patient("org-1", "patient-1", {"org_id": "other-org"}))


def test_postgres_records_repository_creates_and_updates_note_draft():
    cursor = ScriptedCursor(
        descriptions=[NOTE_COLUMNS, NOTE_COLUMNS, NOTE_COLUMNS],
        fetchone_rows=[_note_row(), _note_row(), _note_row(content="Updated")],
    )
    repo = PostgresRecordsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_note(
            "org-1",
            NoteCreate(
                patient_id="00000000-0000-0000-0000-000000000001",
                content="Visit note",
                asset_payload=[{"name": "photo.png"}],
                structured_modules=[{"type": "exam"}],
            ),
        )
    )
    updated = asyncio.run(repo.update_note_draft("org-1", "note-1", "Updated"))

    assert cursor.executed[0][1][1:9] == (
        "org-1",
        "00000000-0000-0000-0000-000000000001",
        None,
        "org-1",
        "00000000-0000-0000-0000-000000000001",
        "Visit note",
        '[{"name": "photo.png"}]',
        '[{"type": "exam"}]',
    )
    assert cursor.executed[2][1][0] == "Updated"
    assert created["id"] == "note-1"
    assert updated["content"] == "Updated"


def test_postgres_records_repository_finalizes_and_marks_note_sent():
    cursor = ScriptedCursor(
        descriptions=[NOTE_COLUMNS, NOTE_COLUMNS, NOTE_COLUMNS, NOTE_COLUMNS],
        fetchone_rows=[
            _note_row(status="draft"),
            _note_row(status="final", content="Visit note"),
            _note_row(status="final", content="Visit note"),
            _note_row(status="sent", content="Visit note", sent_at="2026-06-11T19:00:00+00:00"),
        ],
    )
    repo = PostgresRecordsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    finalized = asyncio.run(repo.finalize_note("org-1", "note-1"))
    sent = asyncio.run(repo.mark_note_sent("org-1", "note-1", sent_by="user-1", sent_to="patient@example.com"))

    assert cursor.executed[1][1][0] == "Visit note"
    assert cursor.executed[1][1][1] == "[]"
    assert cursor.executed[3][1][1] == "[]"
    assert cursor.executed[3][1][5:7] == ("user-1", "patient@example.com")
    assert finalized["status"] == "final"
    assert sent["status"] == "sent"


def test_postgres_records_repository_lists_follow_ups_with_patient_names_and_query_filter():
    cursor = ScriptedCursor(
        descriptions=[FOLLOW_UP_COLUMNS, ["id", "name"]],
        fetchall_rows=[
            [_follow_up_row()],
            [("patient-1", "DL")],
        ],
    )
    repo = PostgresRecordsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    rows = asyncio.run(repo.list_follow_ups("org-1", query="dl", limit=50))

    assert cursor.executed[0][1] == ("org-1", 50)
    assert cursor.executed[1][1] == ("org-1", ["patient-1"])
    assert rows[0]["patient_name"] == "DL"


def test_postgres_records_repository_pages_follow_ups_and_returns_global_counts():
    page_columns = [
        *FOLLOW_UP_COLUMNS,
        "patient_name",
        "patient_email",
        "patient_phone",
        "appointment_id",
        "appointment_status",
        "appointment_scheduled_for",
        "last_contacted_at",
        "last_contact_channels",
        "last_delivery_status",
        "last_delivery_error",
        "reminder_count",
        "follow_up_view",
    ]
    cursor = ScriptedCursor(
        descriptions=[page_columns, ["needs_action", "delivery_issues", "history"]],
        fetchall_rows=[[]],
        fetchone_rows=[(7, 2, 11)],
    )
    repo = PostgresRecordsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    page = asyncio.run(
        repo.list_follow_up_page(
            "org-1",
            view="needs_action",
            query="review",
            limit=20,
        )
    )

    assert page == {
        "items": [],
        "has_more": False,
        "counts": {"needs_action": 7, "delivery_issues": 2, "history": 11},
    }
    page_statement, page_params = cursor.executed[0]
    assert "left join lateral" in page_statement
    assert "limit %s" in page_statement
    assert page_params[-2:] == ("needs_action", 21)
    count_statement, count_params = cursor.executed[1]
    assert "count(*) filter" in count_statement
    assert count_params == ("org-1",)


def test_postgres_records_repository_creates_and_updates_follow_up():
    cursor = ScriptedCursor(
        descriptions=[["id"], FOLLOW_UP_COLUMNS, FOLLOW_UP_COLUMNS, FOLLOW_UP_COLUMNS],
        fetchone_rows=[
            ("patient-1",),
            _follow_up_row(),
            _follow_up_row(status="scheduled"),
            _follow_up_row(status="completed"),
        ],
    )
    repo = PostgresRecordsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_follow_up(
            "org-1",
            "patient-1",
            "user-1",
            FollowUpCreate(scheduled_for=datetime(2026, 6, 12, 9, 0, tzinfo=UTC), notes=" review "),
        )
    )
    updated = asyncio.run(repo.update_follow_up("org-1", "follow-up-1", FollowUpUpdate(status="completed")))

    assert cursor.executed[1][1] == (
        "org-1",
        "patient-1",
        "user-1",
        "2026-06-12T09:00:00+00:00",
        "review",
    )
    assert cursor.executed[3][1][0] == "completed"
    assert created["id"] == "follow-up-1"
    assert updated["status"] == "completed"


def _catalog_item_row(*, stock_quantity: float = 10) -> tuple:
    return (
        "catalog-1",
        "org-1",
        "Consultation",
        "service",
        "",
        None,
        None,
        True,
        500,
        True,
        stock_quantity,
        2,
        "unit",
        "",
        None,
        [],
        "2026-06-11T20:00:00+00:00",
    )


def _invoice_row(*, amount_paid: float = 500) -> tuple:
    return (
        "invoice-1",
        "org-1",
        "patient-1",
        "visit-1",
        500,
        0,
        0,
        0,
        500,
        "",
        "paid",
        amount_paid,
        "2026-06-11T20:01:00+00:00",
        None,
        None,
        None,
        "2026-06-11T20:00:00+00:00",
    )


def _invoice_item_row() -> tuple:
    return (
        "invoice-item-1",
        "org-1",
        "invoice-1",
        "catalog-1",
        "service",
        "Consultation",
        1,
        500,
        500,
        "",
        None,
        0,
        0,
        0,
        0,
        "2026-06-11T20:00:00+00:00",
    )


def _attachment_row() -> tuple:
    return (
        "attachment-1",
        "org-1",
        "patient-1",
        "user-1",
        "scan.pdf",
        "application/pdf",
        1234,
        "org-1/patient-1/attachment-1/scan.pdf",
        "2026-06-11T20:10:00+00:00",
    )


def _myopia_row() -> tuple:
    return (
        "myopia-1",
        "org-1",
        "patient-1",
        "2026-06-11T20:20:00+00:00",
        12,
        24.1,
        24.2,
        "Atropine",
        "Nightly",
        "Stable",
        "-1.00",
        "-1.25",
        "2026-06-11T20:21:00+00:00",
    )


def _track_row() -> tuple:
    return (
        "track-1",
        "org-1",
        "patient-1",
        "growth",
        "2026-06-11T20:30:00+00:00",
        {"height_cm": 120},
        {"weight_kg": 22},
        {"bmi": 15.3},
        "2026-06-11T20:31:00+00:00",
    )


def _case_study_row() -> tuple:
    return (
        "case-1",
        "org-1",
        "patient-1",
        "Case title",
        "draft",
        "conference_presentation",
        True,
        "Focus on diagnosis",
        "Generated content",
        {"patient": {"id": "patient-1"}},
        "user-1",
        "2026-06-11T20:40:00+00:00",
        "2026-06-11T20:41:00+00:00",
    )


def test_postgres_active_medicines_uses_a_single_minimal_filtered_query():
    cursor = ScriptedCursor(
        descriptions=[["id", "name", "unit", "default_price", "track_inventory", "stock_quantity"]],
        fetchall_rows=[[('medicine-1', 'Amoxicillin', 'tablet', 12.5, True, 24)]],
    )
    repo = PostgresBillingRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    medicines = asyncio.run(repo.list_active_medicines("org-1"))

    assert len(cursor.executed) == 1
    statement, params = cursor.executed[0]
    assert "item_type = 'medicine'" in statement
    assert "is_active = true" in statement
    assert "order by name asc" in statement
    assert "org_id, name" not in statement
    assert params == ("org-1",)
    assert medicines == [{
        "id": "medicine-1",
        "name": "Amoxicillin",
        "unit": "tablet",
        "default_price": 12.5,
        "track_inventory": True,
        "stock_quantity": 24,
    }]


def test_postgres_billing_repository_catalog_and_stock_flow():
    cursor = ScriptedCursor(
        descriptions=[CATALOG_ITEM_COLUMNS, CATALOG_ITEM_COLUMNS, CATALOG_ITEM_COLUMNS],
        fetchone_rows=[_catalog_item_row(stock_quantity=10), _catalog_item_row(stock_quantity=10), _catalog_item_row(stock_quantity=12)],
    )
    repo = PostgresBillingRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_catalog_item(
            "org-1",
            CatalogItemCreate(
                name="Consultation",
                item_type="service",
                default_price=500,
                track_inventory=True,
                stock_quantity=10,
                low_stock_threshold=2,
                unit="unit",
            ),
        )
    )
    updated = asyncio.run(repo.update_catalog_stock("org-1", "catalog-1", CatalogStockUpdate(delta=2)))

    assert cursor.executed[0][1] == (
        "org-1",
        "Consultation",
        "service",
        "",
        None,
        None,
        True,
        500.0,
        True,
        10.0,
        2.0,
        "unit",
        "",
        None,
        "[]",
    )
    assert cursor.executed[2][1] == (12.0, "org-1", "catalog-1")
    assert created["id"] == "catalog-1"
    assert updated["stock_quantity"] == 12


def test_postgres_billing_repository_invoice_rpc_and_invoice_items():
    cursor = ScriptedCursor(
        descriptions=[
            ["id", "current_visit_id"],
            ["id"],
            ["gstin"],
            INVOICE_COLUMNS,
            INVOICE_COLUMNS,
            [],
            INVOICE_ITEM_COLUMNS,
            INVOICE_ITEM_COLUMNS,
            INVOICE_COLUMNS,
            INVOICE_ITEM_COLUMNS,
        ],
        fetchone_rows=[
            ("patient-1", "visit-1"),
            ("",),
            _invoice_row(),
            _invoice_row(),
            _invoice_row(),
        ],
        fetchall_rows=[
            [("00000000-0000-0000-0000-000000000002", "service", True, None, "", None)],
            [_invoice_item_row()],
            [_invoice_item_row()],
        ],
    )
    repo = PostgresBillingRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    invoice = asyncio.run(
        repo.create_invoice(
            "org-1",
            InvoiceCreate(
                patient_id="00000000-0000-0000-0000-000000000001",
                payment_status="paid",
                items=[
                    InvoiceItemInput(
                        catalog_item_id="00000000-0000-0000-0000-000000000002",
                        item_type="service",
                        label="Consultation",
                        quantity=1,
                        unit_price=500,
                    )
                ],
            ),
        )
    )
    loaded = asyncio.run(repo.get_invoice("org-1", "invoice-1"))

    assert cursor.executed[3][1][0:5] == (
        "org-1",
        "00000000-0000-0000-0000-000000000001",
        "visit-1",
        500.0,
        0.0,
    )
    assert invoice["balance_due"] == 0
    assert loaded["items"][0]["id"] == "invoice-item-1"


def test_postgres_billing_repository_finalize_interpolates_returning_columns():
    finalized_row = list(_invoice_row())
    finalized_row[13] = "2026-06-11T20:05:00+00:00"
    finalized_row[14] = "user-1"
    cursor = ScriptedCursor(
        descriptions=[
            INVOICE_COLUMNS,
            ["id"],
            INVOICE_ITEM_COLUMNS,
            [],
            INVOICE_COLUMNS,
        ],
        fetchone_rows=[_invoice_row(), ("patient-1",), tuple(finalized_row)],
        fetchall_rows=[[]],
    )
    repo = PostgresBillingRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    result = asyncio.run(
        repo.finalize_invoice(
            "org-1",
            "invoice-1",
            completed_by="user-1",
        )
    )

    finalize_statement, params = cursor.executed[4]
    assert "returning id, org_id, patient_id" in finalize_statement
    assert "{_columns_sql" not in finalize_statement
    assert params == ("user-1", False, "org-1", "invoice-1")
    assert result["completed_by"] == "user-1"


def test_postgres_attachments_repository_metadata_flow():
    cursor = ScriptedCursor(
        descriptions=[["id"], PATIENT_ATTACHMENT_COLUMNS, PATIENT_ATTACHMENT_COLUMNS],
        fetchone_rows=[("patient-1",), _attachment_row(), _attachment_row()],
    )
    repo = PostgresAttachmentsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    prepared = asyncio.run(
        repo.prepare_patient_attachment_metadata(
            "org-1",
            "patient-1",
            uploaded_by="user-1",
            filename="../scan file.pdf",
            content_type="application/pdf",
            file_size=1234,
        )
    )
    created = asyncio.run(repo.create_patient_attachment_metadata({**prepared, "id": "attachment-1"}))

    assert prepared["file_name"] == "scan-file.pdf"
    assert cursor.executed[1][1][0] == "attachment-1"
    assert created["storage_path"] == "org-1/patient-1/attachment-1/scan.pdf"


def test_postgres_attachments_repository_deletes_attachment_metadata():
    cursor = ScriptedCursor(
        descriptions=[PATIENT_ATTACHMENT_COLUMNS],
        fetchone_rows=[_attachment_row()],
    )
    repo = PostgresAttachmentsRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    deleted = asyncio.run(repo.delete_patient_attachment_metadata("org-1", "patient-1", "attachment-1"))

    assert cursor.executed[0][1] == ("org-1", "patient-1", "attachment-1")
    assert deleted["id"] == "attachment-1"


def test_postgres_myopia_repository_create_list_update():
    cursor = ScriptedCursor(
        descriptions=[["id"], MYOPIA_MEASUREMENT_COLUMNS, MYOPIA_MEASUREMENT_COLUMNS, ["id"], MYOPIA_MEASUREMENT_COLUMNS],
        fetchone_rows=[("patient-1",), _myopia_row(), ("myopia-1",), _myopia_row()],
        fetchall_rows=[[_myopia_row()]],
    )
    repo = PostgresMyopiaRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_myopia_measurement(
            "org-1",
            "patient-1",
            MyopiaMeasurementCreate(
                measured_at=datetime(2026, 6, 11, 20, 20, tzinfo=UTC),
                age_years=12,
                axial_length_right_mm=24.1,
                axial_length_left_mm=24.2,
                treatment_type=" Atropine ",
                treatment_notes=" Nightly ",
                visit_notes=" Stable ",
                refraction_right=" -1.00 ",
                refraction_left=" -1.25 ",
            ),
        )
    )
    rows = asyncio.run(repo.list_myopia_measurements_for_patient("org-1", "patient-1"))
    updated = asyncio.run(repo.update_myopia_measurement("org-1", "patient-1", "myopia-1", {"treatment_type": " Updated "}))

    assert cursor.executed[1][1][6:11] == ("Atropine", "Nightly", "Stable", "-1.00", "-1.25")
    assert created["id"] == "myopia-1"
    assert rows[0]["id"] == "myopia-1"
    assert cursor.executed[4][1][0] == "Updated"
    assert updated["id"] == "myopia-1"


def test_postgres_myopia_repository_rejects_unknown_update_fields():
    cursor = ScriptedCursor(descriptions=[])
    repo = PostgresMyopiaRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Unsupported myopia measurement update fields"):
        asyncio.run(repo.update_myopia_measurement("org-1", "patient-1", "myopia-1", {"org_id": "other-org"}))


def test_postgres_specialty_tracks_repository_create_list_update():
    cursor = ScriptedCursor(
        descriptions=[["id"], LONGITUDINAL_TRACK_COLUMNS, ["id"], LONGITUDINAL_TRACK_COLUMNS, ["id"], LONGITUDINAL_TRACK_COLUMNS],
        fetchone_rows=[("patient-1",), _track_row(), ("patient-1",), ("patient-1",), _track_row()],
        fetchall_rows=[[_track_row()]],
    )
    repo = PostgresSpecialtyTracksRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_longitudinal_track(
            "org-1",
            "patient-1",
            LongitudinalTrackCreate(
                track_type="growth",
                measured_at=datetime(2026, 6, 11, 20, 30, tzinfo=UTC),
                summary_fields={"height_cm": 120},
                raw_payload={"weight_kg": 22},
                derived_metrics={"bmi": 15.3},
            ),
        )
    )
    rows = asyncio.run(repo.list_longitudinal_tracks_for_patient("org-1", "patient-1", track_type="growth"))
    updated = asyncio.run(
        repo.update_longitudinal_track("org-1", "patient-1", "track-1", {"summary_fields": {"height_cm": 121}})
    )

    assert cursor.executed[1][1][4:] == ('{"height_cm": 120}', '{"weight_kg": 22}', '{"bmi": 15.3}')
    assert rows[0]["id"] == "track-1"
    assert cursor.executed[5][1][0] == '{"height_cm": 121}'
    assert created["id"] == updated["id"] == "track-1"


def test_postgres_specialty_tracks_repository_rejects_unknown_update_fields():
    cursor = ScriptedCursor(descriptions=[])
    repo = PostgresSpecialtyTracksRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Unsupported longitudinal track update fields"):
        asyncio.run(repo.update_longitudinal_track("org-1", "patient-1", "track-1", {"org_id": "other-org"}))


def test_postgres_case_studies_repository_create_and_update():
    cursor = ScriptedCursor(
        descriptions=[["id"], CASE_STUDY_COLUMNS, ["id"], ["id"], CASE_STUDY_COLUMNS],
        fetchone_rows=[("patient-1",), _case_study_row(), ("case-1",), ("patient-2",), _case_study_row()],
    )
    repo = PostgresCaseStudiesRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    created = asyncio.run(
        repo.create_case_study(
            "org-1",
            "user-1",
            CaseStudyCreate(
                patient_id="00000000-0000-0000-0000-000000000001",
                title=" Case title ",
                generated_content="Generated content",
                author_instructions=" Focus on diagnosis ",
                source_snapshot={"patient": {"id": "patient-1"}},
            ),
        )
    )
    updated = asyncio.run(
        repo.update_case_study(
            "org-1",
            "case-1",
            {
                "patient_id": "00000000-0000-0000-0000-000000000002",
                "title": " Updated case ",
                "source_snapshot": {"patient": {"id": "patient-2"}},
            },
        )
    )

    assert cursor.executed[1][1][3] == "Case title"
    assert cursor.executed[4][1][0:3] == (
        "00000000-0000-0000-0000-000000000002",
        "Updated case",
        '{"patient": {"id": "patient-2"}}',
    )
    assert created["id"] == updated["id"] == "case-1"


def test_postgres_case_studies_repository_rejects_unknown_update_fields():
    cursor = ScriptedCursor(
        descriptions=[["id"]],
        fetchone_rows=[("case-1",)],
    )
    repo = PostgresCaseStudiesRepository(ScriptedManager(cursor))  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="Unsupported case study update fields"):
        asyncio.run(repo.update_case_study("org-1", "case-1", {"org_id": "other-org"}))


def test_get_repository_returns_postgres_repository(monkeypatch):
    class FakeManager:
        def __init__(self) -> None:
            self.opened = False

        def open(self) -> None:
            self.opened = True

    manager = FakeManager()
    monkeypatch.setattr(db_module, "get_postgres_connection_manager", lambda: manager)

    repo = db_module.get_repository()

    assert isinstance(repo, db_module.PostgresRepository)
    assert manager.opened is True


def test_get_repository_returns_new_repository_instances(monkeypatch):
    class FakeManager:
        def open(self) -> None:
            return None

    manager = FakeManager()
    monkeypatch.setattr(db_module, "get_postgres_connection_manager", lambda: manager)

    first = db_module.get_repository()
    second = db_module.get_repository()

    assert first is not second
