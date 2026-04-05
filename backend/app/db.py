import asyncio
from typing import Any

from supabase import Client, create_client

from app.config import get_settings
from app.schemas import ClinicSettingsUpdate, NoteCreate, PatientCreate, UserRole


def _display_name(row: dict[str, Any]) -> str:
    stored_name = str(row.get("name") or "").strip()
    if stored_name:
        return stored_name

    identifier = str(row.get("identifier") or "").strip()
    if "@" in identifier:
        local_part = identifier.split("@", 1)[0]
        return local_part.replace(".", " ").replace("_", " ").strip().title() or "User"
    return identifier or "User"


class SupabaseRepository:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase environment variables are not configured.")
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    async def create_organization(self, clinic_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("organizations")
            .insert({"name": clinic_name.strip()})
            .execute()
            .data[0]
        )

    async def list_patients(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .eq("org_id", org_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )

    async def create_patient(self, org_id: str, payload: PatientCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def update_patient(self, org_id: str, patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .update(payload)
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .execute()
            .data[0]
        )

    async def get_patient(self, org_id: str, patient_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .single()
            .execute()
            .data
        )

    async def create_note(self, org_id: str, payload: NoteCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .insert(
                {
                    "org_id": org_id,
                    "patient_id": str(payload.patient_id),
                    "content": payload.content,
                }
            )
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
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .upsert({"org_id": org_id, **payload.model_dump()}, on_conflict="org_id")
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
            user["name"] = _display_name(user)
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
        user["name"] = _display_name(user)
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
        created["name"] = _display_name(created)
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
        return [{**row, "name": _display_name(row)} for row in rows]

    async def count_users(self) -> int:
        def _count() -> int:
            rows = self.client.table("clinic_users").select("id", count="exact").execute()
            return rows.count or 0

        return await asyncio.to_thread(_count)


def get_repository() -> SupabaseRepository:
    return SupabaseRepository()
