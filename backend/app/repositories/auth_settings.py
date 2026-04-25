from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.repositories.base import BaseSupabaseRepository, display_name
from app.schemas import (
    ClinicSettingsOut,
    ClinicSettingsUpdate,
    UserAccountUpdate,
    UserRole,
    UserRoleUpdate,
)


def _clinic_settings_defaults() -> dict[str, Any]:
    nil_uuid = UUID("00000000-0000-0000-0000-000000000000")
    field_names = {
        "clinic_name",
        "clinic_address",
        "clinic_phone",
        "doctor_name",
        "sender_name",
        "sender_email",
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
        "sender_email_app_password": None,
    }


class AuthSettingsRepositoryMixin(BaseSupabaseRepository):
    async def list_organization_ids(self) -> list[str]:
        rows = await asyncio.to_thread(
            lambda: self.client.table("organizations").select("id").execute().data
        )
        return [str(row["id"]) for row in rows]

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
        payload_values = {
            key: value
            for key, value in payload.model_dump(exclude_unset=True, exclude={"email_configured"}).items()
            if key != "doctor_name"
        }
        values = {
            **_clinic_settings_defaults(),
            **_hidden_clinic_template_defaults(),
            **payload_values,
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
            payload_values = {
                key: value
                for key, value in payload.model_dump(exclude_unset=True, exclude={"email_configured"}).items()
                if key != "doctor_name"
            }
            values = {
                **_clinic_settings_defaults(),
                **_hidden_clinic_template_defaults(),
                **current,
                **payload_values,
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
            .select(
                "id, org_id, identifier, name, role, doctor_dob, doctor_address, doctor_signature_name, "
                "doctor_signature_content_type, doctor_signature_data_base64, created_at"
            )
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
        user["name"] = display_name(user)
        user["doctor_signature_url"] = "/users/{}/signature/file".format(user_id) if user.get("doctor_signature_name") and user.get("doctor_signature_data_base64") else None
        return user

    async def set_user_signature(
        self,
        user_id: str,
        *,
        filename: str,
        content_type: str,
        data_base64: str,
    ) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _set() -> dict[str, Any]:
            return (
                self.client.table("clinic_users")
                .update(
                    {
                        "doctor_signature_name": filename,
                        "doctor_signature_content_type": content_type,
                        "doctor_signature_data_base64": data_base64,
                        "updated_at": timestamp,
                    }
                )
                .eq("id", user_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_set)

    async def clear_user_signature(self, user_id: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _clear() -> dict[str, Any]:
            return (
                self.client.table("clinic_users")
                .update(
                    {
                        "doctor_signature_name": None,
                        "doctor_signature_content_type": None,
                        "doctor_signature_data_base64": None,
                        "updated_at": timestamp,
                    }
                )
                .eq("id", user_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_clear)

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
                    "doctor_dob": None,
                    "doctor_address": "",
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
            .select(
                "id, org_id, identifier, name, role, doctor_dob, doctor_address, doctor_signature_name, "
                "doctor_signature_content_type, created_at"
            )
            .eq("org_id", org_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )
        return [
            {
                **row,
                "name": display_name(row),
                "doctor_signature_url": "/users/{}/signature/file".format(row["id"])
                if row.get("doctor_signature_name")
                else None,
            }
            for row in rows
        ]

    async def update_user_role(self, user_id: str, payload: UserRoleUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _update() -> dict[str, Any]:
            updated = (
                self.client.table("clinic_users")
                .update({"role": payload.role, "updated_at": timestamp})
                .eq("id", user_id)
                .execute()
                .data[0]
            )
            updated["name"] = display_name(updated)
            return updated

        return await asyncio.to_thread(_update)

    async def update_user_account(self, user_id: str, payload: UserAccountUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()
        updates = {
            "name": payload.name.strip(),
            "doctor_dob": payload.doctor_dob.isoformat() if payload.doctor_dob else None,
            "doctor_address": payload.doctor_address.strip(),
            "updated_at": timestamp,
        }

        def _update() -> dict[str, Any]:
            updated = (
                self.client.table("clinic_users")
                .update(updates)
                .eq("id", user_id)
                .execute()
                .data[0]
            )
            updated["name"] = display_name(updated)
            updated["doctor_signature_url"] = "/users/{}/signature/file".format(user_id) if updated.get("doctor_signature_name") and updated.get("doctor_signature_data_base64") else None
            return updated

        return await asyncio.to_thread(_update)

    async def update_user_password_hash(self, user_id: str, password_hash: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _update() -> dict[str, Any]:
            updated = (
                self.client.table("clinic_users")
                .update({"password_hash": password_hash, "updated_at": timestamp})
                .eq("id", user_id)
                .execute()
                .data[0]
            )
            updated["name"] = display_name(updated)
            return updated

        return await asyncio.to_thread(_update)

    async def delete_user(self, user_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .delete()
            .eq("id", user_id)
            .execute()
        )

    async def count_users(self) -> int:
        def _count() -> int:
            rows = self.client.table("clinic_users").select("id", count="exact").execute()
            return rows.count or 0

        return await asyncio.to_thread(_count)
