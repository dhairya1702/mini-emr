from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from uuid import UUID

from app.db import get_repository
from app.schemas import UserOut
from app.services.followup_workflow import send_due_follow_up_emails_workflow


def _system_user_for_org(org_id: str) -> UserOut:
    return UserOut.model_construct(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        org_id=UUID(org_id),
        identifier="cron-followup-reminder",
        name="System",
        role="admin",
        created_at=datetime.now(UTC),
    )


async def _run() -> None:
    repo = get_repository()
    org_ids = await repo.list_organization_ids()
    processed = 0
    for org_id in org_ids:
        await send_due_follow_up_emails_workflow(repo, _system_user_for_org(str(org_id)))
        processed += 1
    print(json.dumps({"processed_orgs": processed}))


if __name__ == "__main__":
    asyncio.run(_run())
