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
    CLINIC_SETTINGS_COLUMNS,
    SUPERUSER_ORG_SUMMARY_COLUMNS,
    USER_COLUMNS,
    USER_LIST_COLUMNS,
    PostgresAuthSettingsRepository,
)
from app.repositories.postgres.billing import CATALOG_ITEM_COLUMNS, INVOICE_COLUMNS, INVOICE_ITEM_COLUMNS, PostgresBillingRepository
from app.repositories.postgres.case_studies import CASE_STUDY_COLUMNS, PostgresCaseStudiesRepository
from app.repositories.postgres.myopia import MYOPIA_MEASUREMENT_COLUMNS, PostgresMyopiaRepository
from app.repositories.postgres.patient_flow import (
    APPOINTMENT_COLUMNS,
    PATIENT_COLUMNS,
    PATIENT_VISIT_COLUMNS,
    PostgresPatientFlowRepository,
)
from app.repositories.postgres.platform_errors import PLATFORM_ERROR_COLUMNS, PostgresPlatformErrorsRepository
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


def test_postgres_database_backend_requires_database_url():
    settings = Settings(
        auth_secret="test-secret",
        app_origin="http://127.0.0.1:3000",
        database_backend="postgres",
        database_url="",
    )

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        settings.validate_runtime()


def test_invalid_database_backend_is_rejected():
    settings = Settings(
        auth_secret="test-secret",
        app_origin="http://127.0.0.1:3000",
        database_backend="sqlite",
    )

    with pytest.raises(RuntimeError, match="DATABASE_BACKEND"):
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
                "anthropic",
                "claude-test",
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
            provider="anthropic",
            model="claude-test",
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
        "anthropic",
        "claude-test",
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
                    "anthropic",
                    "claude-test",
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
            "provider": "anthropic",
            "model": "claude-test",
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


def test_postgres_auth_settings_repository_creates_organization_and_user():
    cursor = ScriptedCursor(
        descriptions=[["id", "name", "created_at"], USER_COLUMNS],
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


def test_postgres_auth_settings_repository_reads_and_updates_user_shapes():
    cursor = ScriptedCursor(
        descriptions=[USER_LIST_COLUMNS, USER_COLUMNS, USER_COLUMNS],
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

    assert users[0]["doctor_signature_url"] == "/users/user-1/signature/file"
    assert cursor.executed[1][1][:3] == ("Dr Updated", "1990-01-01", "Clinic Lane")
    assert updated["doctor_signature_url"] == "/users/user-1/signature/file"
    assert cursor.executed[2][1][0] == "staff"
    assert role_updated["role"] == "staff"


def test_postgres_auth_settings_repository_upserts_clinic_settings_with_defaults():
    clinic_settings_row = (
        "settings-1",
        "org-1",
        "Fika Clinic",
        "12 Main",
        "123",
        None,
        "09:00",
        "18:00",
        4,
        "",
        "",
        "",
        None,
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
        None,
        "09:00",
        "18:00",
        4,
        "",
        "",
        "",
        None,
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
        "2026-06-11T16:05:00+00:00",
    )
    clear_row = (
        "settings-1",
        "org-1",
        "Fika Clinic",
        "",
        "",
        None,
        "09:00",
        "18:00",
        4,
        "",
        "",
        "",
        None,
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
                    "2026-06-10T10:00:00+00:00",
                    2,
                    5,
                    4,
                    3,
                    1,
                    1200,
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
            "created_at": "2026-06-10T10:00:00+00:00",
            "user_count": 2,
            "patient_count": 5,
            "note_count": 4,
            "invoice_count": 3,
            "follow_up_count": 1,
            "total_tokens": 1200,
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


def _patient_row(patient_id: str = "patient-1", *, phone: str = "1234567890") -> tuple:
    return (
        patient_id,
        "org-1",
        "DL",
        phone,
        "dl@example.com",
        "Main Road",
        "fever",
        12,
        78,
        175,
        98,
        "waiting",
        False,
        "2026-06-11T17:00:00+00:00",
        "2026-06-11T17:00:00+00:00",
    )


def _appointment_row(*, status: str = "scheduled", phone: str = "1234567890") -> tuple:
    return (
        "appointment-1",
        "org-1",
        "DL",
        phone,
        "dl@example.com",
        "Main Road",
        "fever",
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
        content,
        status,
        1,
        None,
        None,
        None,
        [],
        [],
        [],
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
        descriptions=[PATIENT_COLUMNS, []],
        fetchone_rows=[_patient_row(phone="1234567890")],
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
        descriptions=[["check_in_appointment_atomic"]],
        fetchone_rows=[
            (
                {
                    "appointment": {"id": "appointment-1", "status": "checked_in"},
                    "patient": {"id": "patient-1", "status": "waiting"},
                },
            )
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

    assert cursor.executed[0][1][1:6] == (
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
    assert cursor.executed[3][1][2:4] == ("user-1", "patient@example.com")
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
        500,
        True,
        stock_quantity,
        2,
        "unit",
        "2026-06-11T20:00:00+00:00",
    )


def _invoice_row(*, amount_paid: float = 500) -> tuple:
    return (
        "invoice-1",
        "org-1",
        "patient-1",
        500,
        500,
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
        "invoice-1",
        "catalog-1",
        "service",
        "Consultation",
        1,
        500,
        500,
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

    assert cursor.executed[0][1] == ("org-1", "Consultation", "service", 500.0, True, 10.0, 2.0, "unit")
    assert cursor.executed[2][1] == (12.0, "org-1", "catalog-1")
    assert created["id"] == "catalog-1"
    assert updated["stock_quantity"] == 12


def test_postgres_billing_repository_invoice_rpc_and_invoice_items():
    cursor = ScriptedCursor(
        descriptions=[["create_invoice_atomic"], INVOICE_COLUMNS, INVOICE_ITEM_COLUMNS],
        fetchone_rows=[
            (
                {
                    "id": "invoice-1",
                    "org_id": "org-1",
                    "patient_id": "00000000-0000-0000-0000-000000000001",
                    "total": 500,
                    "amount_paid": 500,
                    "items": [],
                },
            ),
            _invoice_row(),
        ],
        fetchall_rows=[[_invoice_item_row()]],
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

    assert cursor.executed[0][1][0:4] == (
        "org-1",
        "00000000-0000-0000-0000-000000000001",
        "paid",
        500.0,
    )
    assert invoice["balance_due"] == 0
    assert loaded["items"][0]["id"] == "invoice-item-1"


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


def test_get_repository_selects_postgres_backend(monkeypatch):
    class FakeManager:
        def __init__(self) -> None:
            self.opened = False

        def open(self) -> None:
            self.opened = True

    manager = FakeManager()
    monkeypatch.setattr(
        db_module,
        "get_settings",
        lambda: Settings(
            auth_secret="test-secret",
            app_origin="http://127.0.0.1:3000",
            database_backend="postgres",
            database_url="postgresql://clinic:secret@localhost:5432/clinic",
        ),
    )
    monkeypatch.setattr(db_module, "get_postgres_connection_manager", lambda: manager)
    db_module.get_repository.cache_clear()

    repo = db_module.get_repository()

    assert isinstance(repo, db_module.PostgresRepository)
    assert manager.opened is True
    db_module.get_repository.cache_clear()
