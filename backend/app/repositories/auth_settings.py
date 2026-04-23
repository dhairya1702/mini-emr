from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.repositories.base import BaseSupabaseRepository, display_name
from app.schemas import ClinicSettingsOut, ClinicSettingsUpdate, UserRole


def _clinic_settings_defaults() -> dict[str, Any]:
    nil_uuid = UUID("00000000-0000-0000-0000-000000000000")
    field_names = {
        "clinic_name",
        "clinic_address",
        "clinic_phone",
        "doctor_name",
        "custom_header",
        "custom_footer",
        "document_template_name",
        "document_template_url",
        "document_template_notes_enabled",
        "document_template_letters_enabled",
        "document_template_invoices_enabled",
        "document_template_margin_top",
        "document_template_margin_right",
        "document_template_margin_bottom",
        "document_template_margin_left",
    }
    return ClinicSettingsOut.model_construct(id=nil_uuid, org_id=nil_uuid).model_dump(include=field_names)


def _hidden_clinic_template_defaults() -> dict[str, Any]:
    return {
        "document_template_content_type": None,
        "document_template_data_base64": None,
    }


class AuthSettingsRepositoryMixin(BaseSupabaseRepository):
    async def create_organization(self, clinic_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("organizations")
            .insert({"name": clinic_name.strip()})
            .execute()
            .data[0]
        )

    async def get_clinic_settings(self, org_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(lambda: self.get_clinic_settings_sync(org_id))

    async def create_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        values = {
            **_clinic_settings_defaults(),
            **_hidden_clinic_template_defaults(),
            **payload.model_dump(exclude_unset=True),
        }
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .insert({"org_id": org_id, **values})
            .execute()
            .data[0]
        )

    async def upsert_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _upsert() -> dict[str, Any]:
            current = self.get_clinic_settings_sync(org_id)
            values = {
                **_clinic_settings_defaults(),
                **_hidden_clinic_template_defaults(),
                **current,
                **payload.model_dump(exclude_unset=True),
                "org_id": org_id,
                "updated_at": timestamp,
            }
            return (
                self.client.table("clinic_settings")
                .upsert(values, on_conflict="org_id")
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_upsert)

    def get_clinic_settings_sync(self, org_id: str) -> dict[str, Any]:
        rows = (
            self.client.table("clinic_settings")
            .select("*")
            .eq("org_id", org_id)
            .limit(1)
            .execute()
            .data
        )
        return rows[0] if rows else {}

    async def set_clinic_document_template(
        self,
        org_id: str,
        *,
        filename: str,
        content_type: str,
        data_base64: str,
    ) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _set() -> dict[str, Any]:
            current = self.get_clinic_settings_sync(org_id)
            values = {
                **_clinic_settings_defaults(),
                **_hidden_clinic_template_defaults(),
                **current,
                "org_id": org_id,
                "document_template_name": filename,
                "document_template_url": "/settings/clinic/document-template/file",
                "document_template_content_type": content_type,
                "document_template_data_base64": data_base64,
                "document_template_notes_enabled": True,
                "document_template_letters_enabled": True,
                "document_template_invoices_enabled": True,
                "updated_at": timestamp,
            }
            return (
                self.client.table("clinic_settings")
                .upsert(values, on_conflict="org_id")
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_set)

    async def clear_clinic_document_template(self, org_id: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _clear() -> dict[str, Any]:
            current = self.get_clinic_settings_sync(org_id)
            values = {
                **_clinic_settings_defaults(),
                **_hidden_clinic_template_defaults(),
                **current,
                "org_id": org_id,
                "document_template_name": None,
                "document_template_url": None,
                "document_template_content_type": None,
                "document_template_data_base64": None,
                "document_template_notes_enabled": False,
                "document_template_letters_enabled": False,
                "document_template_invoices_enabled": False,
                "updated_at": timestamp,
            }
            return (
                self.client.table("clinic_settings")
                .upsert(values, on_conflict="org_id")
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_clear)

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

    async def create_user(
        self,
        org_id: str,
        identifier: str,
        name: str,
        password_hash: str,
        role: UserRole,
    ) -> dict[str, Any]:
        created = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .insert(
                {
                    "org_id": org_id,
                    "identifier": identifier,
                    "name": name.strip(),
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
