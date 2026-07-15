from __future__ import annotations

from functools import lru_cache
from typing import Any, Callable

from app.config import get_settings


PoolFactory = Callable[[str], Any]


class PostgresConnectionManager:
    def __init__(self, database_url: str, pool_factory: PoolFactory | None = None) -> None:
        normalized_database_url = str(database_url or "").strip()
        if not normalized_database_url:
            raise RuntimeError("DATABASE_URL must be configured.")
        self.database_url = normalized_database_url
        self._pool_factory = pool_factory
        self._pool: Any | None = None

    def _build_pool(self) -> Any:
        if self._pool_factory is not None:
            return self._pool_factory(self.database_url)

        from psycopg_pool import ConnectionPool

        settings = get_settings()
        min_size = max(0, int(getattr(settings, "db_pool_min_size", 1)))
        max_size = max(min_size or 1, int(getattr(settings, "db_pool_max_size", 10)))
        timeout = max(1.0, float(getattr(settings, "db_pool_timeout_seconds", 10.0)))
        max_lifetime = max(60.0, float(getattr(settings, "db_pool_max_lifetime_seconds", 1800.0)))
        max_idle = max(30.0, float(getattr(settings, "db_pool_max_idle_seconds", 300.0)))
        check_connections = bool(getattr(settings, "db_pool_check_connections", True))
        return ConnectionPool(
            conninfo=self.database_url,
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            max_lifetime=max_lifetime,
            max_idle=max_idle,
            check=ConnectionPool.check_connection if check_connections else None,
            open=False,
        )

    @property
    def pool(self) -> Any:
        if self._pool is None:
            self._pool = self._build_pool()
        return self._pool

    def open(self) -> None:
        open_pool = getattr(self.pool, "open", None)
        if callable(open_pool):
            open_pool()

    def close(self) -> None:
        if self._pool is None:
            return
        close_pool = getattr(self._pool, "close", None)
        if callable(close_pool):
            close_pool()
        self._pool = None

    def health_check(self) -> bool:
        with self.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("select 1")
                row = cursor.fetchone()
        return bool(row and row[0] == 1)


@lru_cache
def get_postgres_connection_manager() -> PostgresConnectionManager:
    settings = get_settings()
    return PostgresConnectionManager(settings.database_url)
