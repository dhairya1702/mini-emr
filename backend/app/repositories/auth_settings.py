from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.repositories.base import BaseSupabaseRepository, display_name
from app.schemas import ClinicSettingsUpdate, UserRole


class AuthSettingsRepositoryMixin(BaseSupabaseRepository):
    async def create_organization(self, clinic_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("organizations")
            .insert({"name": clinic_name.strip()})
            .execute()
            .data[0]
        )

    async def get_clinic_settings(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            rows = (
                self.client.table("clinic_settings")
                .select("*")
                .eq("org_id", org_id)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else {}

        return await asyncio.to_thread(_get)

    async def create_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def upsert_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .upsert(
                {
                    "org_id": org_id,
                    **payload.model_dump(),
                    "updated_at": timestamp,
                },
                on_conflict="org_id",
            )
            .execute()
            .data[0]
        )

    async def get_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            rows = (
                self.client.table("clinic_users")
                .select("*")
                .eq("identifier", identifier)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else None

        user = await asyncio.to_thread(_get)
        if user:
            user["name"] = display_name(user)
        return user

    async def get_user(self, user_id: str) -> dict[str, Any]:
        user = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .select("id, org_id, identifier, name, role, created_at")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
        user["name"] = display_name(user)
        return user

    async def create_user(self, org_id: str, identifier: str, password_hash: str, role: UserRole) -> dict[str, Any]:
        created = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .insert(
                {
                    "org_id": org_id,
                    "identifier": identifier,
                    "name": "",
                    "password_hash": password_hash,
                    "role": role,
                }
            )
            .execute()
            .data[0]
        )
        created["name"] = display_name(created)
        return created

    async def list_users(self, org_id: str) -> list[dict[str, Any]]:
        rows = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .select("id, org_id, identifier, name, role, created_at")
            .eq("org_id", org_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )
        return [{**row, "name": display_name(row)} for row in rows]

    async def count_users(self) -> int:
        def _count() -> int:
            rows = self.client.table("clinic_users").select("id", count="exact").execute()
            return rows.count or 0

        return await asyncio.to_thread(_count)
