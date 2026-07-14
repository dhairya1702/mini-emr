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
