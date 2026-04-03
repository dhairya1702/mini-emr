import asyncio
from typing import Any

from supabase import Client, create_client

from app.config import get_settings
from app.schemas import NoteCreate, PatientCreate


class SupabaseRepository:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase environment variables are not configured.")
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    async def list_patients(self) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .order("created_at", desc=False)
            .execute()
            .data
        )

    async def create_patient(self, payload: PatientCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .insert(payload.model_dump())
            .execute()
            .data[0]
        )

    async def update_patient(self, patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .update(payload)
            .eq("id", patient_id)
            .execute()
            .data[0]
        )

    async def get_patient(self, patient_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .eq("id", patient_id)
            .single()
            .execute()
            .data
        )

    async def create_note(self, payload: NoteCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .insert(
                {
                    "patient_id": str(payload.patient_id),
                    "content": payload.content,
                }
            )
            .execute()
            .data[0]
        )


def get_repository() -> SupabaseRepository:
    return SupabaseRepository()
