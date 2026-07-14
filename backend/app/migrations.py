from __future__ import annotations

import argparse
import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from app.config import get_settings


MIGRATION_TABLE_SQL = """
create table if not exists public.schema_migrations (
  migration_name text primary key,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now()
)
"""


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    name: str
    path: Path
    checksum: str


def migrations_directory() -> Path:
    configured = str(os.getenv("MIGRATIONS_DIR") or "").strip()
    candidates = [
        Path(configured) if configured else None,
        Path.cwd() / "db" / "migrations",
        Path.cwd().parent / "db" / "migrations",
        Path(__file__).resolve().parents[2] / "db" / "migrations",
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_dir():
            return candidate
    raise MigrationError("Could not locate db/migrations. Set MIGRATIONS_DIR explicitly.")


def discover_migrations(directory: Path | None = None) -> list[Migration]:
    root = directory or migrations_directory()
    migrations: list[Migration] = []
    for path in sorted(root.glob("*.sql"), key=lambda item: item.name):
        raw = path.read_bytes()
        migrations.append(
            Migration(
                name=path.name,
                path=path,
                checksum=hashlib.sha256(raw).hexdigest(),
            )
        )
    if not migrations:
        raise MigrationError(f"No SQL migrations found in {root}.")
    return migrations


def _applied_migrations(connection, *, ensure_table: bool = True) -> dict[str, str]:
    with connection.cursor() as cursor:
        if ensure_table:
            cursor.execute(MIGRATION_TABLE_SQL)
        else:
            cursor.execute("select to_regclass('public.schema_migrations')")
            if cursor.fetchone()[0] is None:
                return {}
        cursor.execute(
            "select migration_name, checksum_sha256 from public.schema_migrations order by migration_name"
        )
        rows = cursor.fetchall()
    connection.commit()
    return {str(row[0]): str(row[1]) for row in rows}


def migration_status(
    connection,
    migrations: Iterable[Migration] | None = None,
    *,
    ensure_table: bool = True,
) -> tuple[list[Migration], list[str]]:
    expected = list(migrations or discover_migrations())
    applied = _applied_migrations(connection, ensure_table=ensure_table)
    changed = [migration.name for migration in expected if migration.name in applied and applied[migration.name] != migration.checksum]
    if changed:
        raise MigrationError(
            "Applied migration checksum mismatch: " + ", ".join(changed) + ". Never edit an applied migration."
        )
    pending = [migration for migration in expected if migration.name not in applied]
    unknown = sorted(set(applied) - {migration.name for migration in expected})
    return pending, unknown


def apply_migrations(connection, migrations: Iterable[Migration] | None = None) -> list[str]:
    expected = list(migrations or discover_migrations())
    pending, _unknown = migration_status(connection, expected)
    applied_names: list[str] = []
    for migration in pending:
        sql = migration.path.read_text(encoding="utf-8")
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql)
                cursor.execute(
                    """
                    insert into public.schema_migrations (migration_name, checksum_sha256)
                    values (%s, %s)
                    on conflict (migration_name) do nothing
                    """,
                    (migration.name, migration.checksum),
                )
            connection.commit()
        except Exception as exc:
            connection.rollback()
            raise MigrationError(f"Migration failed: {migration.name}") from exc
        applied_names.append(migration.name)
    return applied_names


def verify_migrations(connection, *, ensure_table: bool = False) -> None:
    pending, _unknown = migration_status(connection, ensure_table=ensure_table)
    if pending:
        raise MigrationError("Pending database migrations: " + ", ".join(item.name for item in pending))


def _connect():
    import psycopg

    database_url = str(get_settings().database_url or "").strip()
    if not database_url:
        raise MigrationError("DATABASE_URL must be configured.")
    return psycopg.connect(database_url)


def main() -> int:
    parser = argparse.ArgumentParser(description="ClinicOS database migration runner")
    parser.add_argument("command", choices=("status", "apply", "verify"))
    args = parser.parse_args()
    try:
        with _connect() as connection:
            if args.command == "apply":
                applied = apply_migrations(connection)
                print("Applied: " + (", ".join(applied) if applied else "none"))
            else:
                pending, unknown = migration_status(connection)
                if args.command == "verify" and pending:
                    raise MigrationError("Pending database migrations: " + ", ".join(item.name for item in pending))
                print("Pending: " + (", ".join(item.name for item in pending) if pending else "none"))
                print("Database-only records: " + (", ".join(unknown) if unknown else "none"))
    except MigrationError as exc:
        print(f"Migration error: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
