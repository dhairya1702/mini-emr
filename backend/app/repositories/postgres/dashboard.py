from __future__ import annotations

import asyncio
from typing import Any


class PostgresDashboardRepository:
    async def get_dashboard_status(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          coalesce(revisions.queue_revision, 0)::text as queue_revision,
                          (
                            select count(*)
                            from public.patients
                            where org_id = %s
                              and (
                                status in ('waiting', 'consultation')
                                or (status = 'done' and billed = false)
                              )
                          )::integer as active_patient_count,
                          coalesce(revisions.check_in_revision, 0)::text as check_in_revision,
                          (
                            select count(*)
                            from public.public_check_in_requests
                            where org_id = %s
                              and status = 'pending'
                              and expires_at > now()
                          )::integer as pending_check_in_count
                        from (values (1)) as singleton(value)
                        left join public.dashboard_revisions revisions on revisions.org_id = %s
                        """,
                        (org_id, org_id, org_id),
                    )
                    row = cursor.fetchone()
                    pending_count = int(row[3])
                    return {
                        "queue_revision": str(row[0]),
                        "active_patient_count": int(row[1]),
                        # Count is part of the token so time-based expiry is visible
                        # without turning this read endpoint into a write operation.
                        "check_in_revision": f"{row[2]}:{pending_count}",
                        "pending_check_in_count": pending_count,
                    }

        return await asyncio.to_thread(_get)

    async def get_dashboard_queue_revision(self, org_id: str) -> str:
        def _get() -> str:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select coalesce(
                          (select queue_revision from public.dashboard_revisions where org_id = %s),
                          0
                        )::text
                        """,
                        (org_id,),
                    )
                    return str(cursor.fetchone()[0])

        return await asyncio.to_thread(_get)
