import asyncio

from fastapi import APIRouter, HTTPException

from app.migrations import verify_migrations
from app.postgres import get_postgres_connection_manager


router = APIRouter()


@router.get("/health/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


def _check_readiness() -> None:
    manager = get_postgres_connection_manager()
    with manager.pool.connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("select 1")
            if cursor.fetchone() != (1,):
                raise RuntimeError("Database health check failed.")
        verify_migrations(connection, ensure_table=False)


@router.get("/health/ready")
@router.get("/health")
async def readiness() -> dict[str, str]:
    try:
        await asyncio.to_thread(_check_readiness)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Service is not ready.") from exc
    return {"status": "ok"}
