from __future__ import annotations

from pathlib import Path

import pytest

import test_app  # noqa: F401 - establishes the backend import path for tests
from app.migrations import MigrationError, discover_migrations, migration_status


class FakeCursor:
    def __init__(self, applied: list[tuple[str, str]]) -> None:
        self.applied = applied
        self.rows: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql: str, _params=None) -> None:
        if "select migration_name" in sql:
            self.rows = list(self.applied)

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, applied: list[tuple[str, str]]) -> None:
        self.applied = applied

    def cursor(self):
        return FakeCursor(self.applied)

    def commit(self) -> None:
        pass


def test_migrations_are_discovered_in_filename_order(tmp_path: Path):
    (tmp_path / "2026-02-01_second.sql").write_text("select 2;", encoding="utf-8")
    (tmp_path / "2026-01-01_first.sql").write_text("select 1;", encoding="utf-8")
    migrations = discover_migrations(tmp_path)
    assert [migration.name for migration in migrations] == [
        "2026-01-01_first.sql",
        "2026-02-01_second.sql",
    ]
    assert all(len(migration.checksum) == 64 for migration in migrations)


def test_migration_status_rejects_changed_applied_file(tmp_path: Path):
    path = tmp_path / "2026-01-01_first.sql"
    path.write_text("select 1;", encoding="utf-8")
    migration = discover_migrations(tmp_path)[0]
    connection = FakeConnection([(migration.name, "wrong-checksum")])

    with pytest.raises(MigrationError, match="checksum mismatch"):
        migration_status(connection, [migration])


def test_tenant_integrity_schema_drift_migration_covers_invoice_items_and_indexes():
    root = Path(__file__).resolve().parents[1]
    migration_sql = (
        root / "db" / "migrations" / "2026-07-23_tenant_integrity_schema_drift.sql"
    ).read_text(encoding="utf-8")
    schema_sql = (root / "db" / "schema.sql").read_text(encoding="utf-8")

    assert "add column if not exists org_id uuid" in migration_sql
    assert "set org_id = invoice.org_id" in migration_sql
    assert "invoice_items_org_invoice_fk" in migration_sql
    assert "invoice_items_org_catalog_item_fk" in migration_sql
    assert "foreign key (org_id, invoice_id) references public.invoices(org_id, id)" in schema_sql
    assert (
        "foreign key (org_id, catalog_item_id) references public.catalog_items(org_id, id)"
        in schema_sql
    )
    assert "notes_org_visit_created_idx" in schema_sql
    assert "follow_ups_due_reminder_claim_idx" in schema_sql


def test_myopia_care_migration_keeps_program_data_model_consolidated():
    root = Path(__file__).resolve().parents[1]
    migration_sql = (
        root / "db" / "migrations" / "2026-07-29_myopia_care_program.sql"
    ).read_text(encoding="utf-8")

    assert "item_type in ('service', 'medicine', 'program')" in migration_sql
    assert "create table if not exists public.patient_program_enrollments" in migration_sql
    assert "create table if not exists public.care_program_events" in migration_sql
    assert "create table if not exists public.care_program_definitions" not in migration_sql
    assert "patient_program_enrollments_one_current_uidx" in migration_sql


def test_check_in_integrity_migration_adds_atomic_identity_indexes_and_tenant_fks():
    root = Path(__file__).resolve().parents[1]
    migration_sql = (
        root / "db" / "migrations" / "2026-07-30_check_in_tenant_integrity.sql"
    ).read_text(encoding="utf-8")
    schema_sql = (root / "db" / "schema.sql").read_text(encoding="utf-8")

    for sql in (migration_sql, schema_sql):
        assert "public_check_in_requests_pending_identity_uidx" in sql
        assert "public_check_in_requests_pending_expiry_idx" in sql
        assert "patient_attachments_org_patient_created_idx" in sql
        assert "patients_org_phone_match_key_idx" in sql
        assert "public_check_in_requests_org_approved_patient_fk" in sql
        assert "public_check_in_requests_org_reviewed_by_fk" in sql
        assert "appointments_org_follow_up_fk" in sql
        assert "patient_visits_org_follow_up_fk" in sql
        assert "patient_program_enrollments_org_invoice_item_fk" in sql
        assert "care_program_events_org_enrollment_fk" in sql
        assert "care_program_events_org_source_event_fk" in sql
        assert sql.count("on delete set null") >= 6
        assert sql.count("on delete restrict") >= 3


def test_tenant_fk_delete_semantics_only_nulls_nullable_reference_columns():
    root = Path(__file__).resolve().parents[1]
    migration_sql = (
        root / "db" / "migrations" / "2026-07-30_tenant_fk_delete_semantics.sql"
    ).read_text(encoding="utf-8")
    schema_sql = (root / "db" / "schema.sql").read_text(encoding="utf-8")

    nullable_columns = (
        "approved_patient_id",
        "reviewed_by",
        "follow_up_id",
        "responsible_user_id",
        "source_event_id",
        "created_by",
    )
    for column in nullable_columns:
        assert f"on delete set null ({column})" in migration_sql
        assert f"on delete set null ({column})" in schema_sql
    assert "on delete set null (org_id)" not in migration_sql


def test_dashboard_revision_notifications_publish_minimal_invalidations():
    root = Path(__file__).resolve().parents[1]
    migration_sql = (
        root / "db" / "migrations" / "2026-08-13_dashboard_revision_notifications.sql"
    ).read_text(encoding="utf-8")
    schema_sql = (root / "db" / "schema.sql").read_text(encoding="utf-8")

    for sql in (migration_sql, schema_sql):
        assert "clinic_dashboard_revisions" in sql
        assert "public.notify_dashboard_revision_change" in sql
        assert "pg_notify(" in sql
        assert "'changed', changed_counters" in sql
        assert "'queue_revision'" in sql
        assert "'check_in_revision'" in sql
        assert "'billing_patients_revision'" in sql
        assert "'billing_invoices_revision'" in sql
