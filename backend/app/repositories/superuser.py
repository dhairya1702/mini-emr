from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from app.repositories.base import BaseSupabaseRepository, display_name


def _max_datetime(current: datetime | None, candidate: Any) -> datetime | None:
    if isinstance(candidate, datetime):
        if current is None or candidate > current:
            return candidate
    return current


class SuperuserRepositoryMixin(BaseSupabaseRepository):
    async def list_all_organizations(self) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            organizations = self.execute_with_retry(
                lambda: self.client.table("organizations").select("*").order("created_at", desc=False).execute().data
            )
            clinic_settings = self.execute_with_retry(
                lambda: self.client.table("clinic_settings").select("org_id, clinic_name, updated_at").execute().data
            )
            users = self.execute_with_retry(
                lambda: self.client.table("clinic_users").select("id, org_id, created_at").execute().data
            )
            patients = self.execute_with_retry(
                lambda: self.client.table("patients").select("id, org_id, created_at, last_visit_at").execute().data
            )
            notes = self.execute_with_retry(
                lambda: self.client.table("notes").select("id, org_id, created_at").execute().data
            )
            invoices = self.execute_with_retry(
                lambda: self.client.table("invoices").select("id, org_id, created_at").execute().data
            )
            follow_ups = self.execute_with_retry(
                lambda: self.client.table("follow_ups").select("id, org_id, created_at, scheduled_for").execute().data
            )
            audit_events = self.execute_with_retry(
                lambda: self.client.table("audit_events").select("org_id, created_at").execute().data
            )
            usage_events = self.execute_with_retry(
                lambda: self.client.table("ai_usage_events").select("org_id, total_tokens").execute().data
            )

            settings_by_org = {str(row["org_id"]): row for row in clinic_settings}
            summaries: dict[str, dict[str, Any]] = {}
            for organization in organizations:
                org_id = str(organization["id"])
                settings = settings_by_org.get(org_id, {})
                created_at = organization.get("created_at")
                summaries[org_id] = {
                    "org_id": org_id,
                    "clinic_name": str(settings.get("clinic_name") or organization.get("name") or "Clinic").strip() or "Clinic",
                    "created_at": created_at,
                    "user_count": 0,
                    "patient_count": 0,
                    "note_count": 0,
                    "invoice_count": 0,
                    "follow_up_count": 0,
                    "total_tokens": 0,
                    "last_activity_at": settings.get("updated_at") or created_at,
                }

            def touch(org_id: str, candidate: Any) -> None:
                if org_id in summaries:
                    summaries[org_id]["last_activity_at"] = _max_datetime(summaries[org_id]["last_activity_at"], candidate)

            for row in users:
                org_id = str(row["org_id"])
                if org_id in summaries:
                    summaries[org_id]["user_count"] += 1
                    touch(org_id, row.get("created_at"))
            for row in patients:
                org_id = str(row["org_id"])
                if org_id in summaries:
                    summaries[org_id]["patient_count"] += 1
                    touch(org_id, row.get("last_visit_at") or row.get("created_at"))
            for row in notes:
                org_id = str(row["org_id"])
                if org_id in summaries:
                    summaries[org_id]["note_count"] += 1
                    touch(org_id, row.get("created_at"))
            for row in invoices:
                org_id = str(row["org_id"])
                if org_id in summaries:
                    summaries[org_id]["invoice_count"] += 1
                    touch(org_id, row.get("created_at"))
            for row in follow_ups:
                org_id = str(row["org_id"])
                if org_id in summaries:
                    summaries[org_id]["follow_up_count"] += 1
                    touch(org_id, row.get("scheduled_for") or row.get("created_at"))
            for row in audit_events:
                org_id = str(row["org_id"])
                touch(org_id, row.get("created_at"))
            for row in usage_events:
                org_id = str(row["org_id"])
                if org_id in summaries:
                    summaries[org_id]["total_tokens"] += int(row.get("total_tokens") or 0)

            return sorted(
                summaries.values(),
                key=lambda row: row.get("last_activity_at") or row.get("created_at"),
                reverse=True,
            )

        return await asyncio.to_thread(_list)

    async def list_users_for_org_any(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            rows = self.execute_with_retry(
                lambda: self.client.table("clinic_users")
                .select("id, org_id, identifier, name, role, created_at")
                .eq("org_id", org_id)
                .order("created_at", desc=False)
                .execute()
                .data
            )
            return [{**row, "name": display_name(row)} for row in rows]

        return await asyncio.to_thread(_list)

    async def list_ai_usage_events_for_org(self, org_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("ai_usage_events")
                .select("*")
                .eq("org_id", org_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
                .data
            )
        )

    async def create_platform_error(
        self,
        *,
        org_id: str | None,
        user_id: str | None,
        identifier: str | None,
        path: str,
        method: str,
        status_code: int | None,
        error_type: str,
        message: str,
        details: str = "",
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "org_id": org_id,
            "user_id": user_id,
            "identifier": identifier or "",
            "path": path,
            "method": method,
            "status_code": status_code,
            "error_type": error_type,
            "message": message[:500],
            "details": details[:4000],
            "context": context or {},
        }
        return await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("platform_errors").insert(payload).execute().data[0]
            )
        )

    async def list_platform_errors(self, limit: int = 100, org_id: str | None = None) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            query = self.client.table("platform_errors").select("*")
            if org_id:
                query = query.eq("org_id", org_id)
            return self.execute_with_retry(
                lambda: query.order("created_at", desc=True).limit(limit).execute().data
            )

        return await asyncio.to_thread(_list)

    async def delete_user_any(self, user_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("clinic_users").delete().eq("id", user_id).execute()
            )
        )

    async def delete_organization(self, org_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.execute_with_retry(
                lambda: self.client.table("organizations").delete().eq("id", org_id).execute()
            )
        )
