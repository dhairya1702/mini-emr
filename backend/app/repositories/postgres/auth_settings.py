from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.postgres import PostgresConnectionManager
from app.repositories.base import display_name, normalize_phone_number
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.auth_settings import ClinicSettingsOut, ClinicSettingsUpdate, UserAccountUpdate, UserRoleUpdate
from app.schema_domains.common import UserRole
from app.secret_crypto import decrypt_stored_secret, encrypt_stored_secret


CLINIC_SETTINGS_COLUMNS = [
    "id",
    "org_id",
    "clinic_name",
    "clinic_address",
    "clinic_phone",
    "clinic_specialty",
    "timezone",
    "appointment_start_time",
    "appointment_end_time",
    "appointments_per_hour",
    "doctor_name",
    "sender_name",
    "sender_email",
    "sender_email_app_password",
    "email_sender_mode",
    "custom_header",
    "custom_footer",
    "document_template_name",
    "document_template_url",
    "document_template_content_type",
    "document_template_data_base64",
    "document_template_notes_enabled",
    "document_template_letters_enabled",
    "document_template_invoices_enabled",
    "document_template_margin_top",
    "document_template_margin_right",
    "document_template_margin_bottom",
    "document_template_margin_left",
    "document_template_signature_x",
    "document_template_signature_y",
    "document_template_signature_width",
    "document_template_signature_height",
    "document_template_doctor_name_x",
    "document_template_doctor_name_y",
    "document_template_doctor_name_width",
    "document_template_doctor_name_height",
    "document_template_note_layout",
    "onboarding_required",
    "onboarding_completed_at",
    "users_allowed",
    "workspace_mode",
    "updated_at",
]

CLINIC_SETTINGS_MUTABLE_COLUMNS = [
    "clinic_name",
    "clinic_address",
    "clinic_phone",
    "clinic_specialty",
    "timezone",
    "appointment_start_time",
    "appointment_end_time",
    "appointments_per_hour",
    "doctor_name",
    "sender_name",
    "sender_email",
    "sender_email_app_password",
    "email_sender_mode",
    "custom_header",
    "custom_footer",
    "document_template_name",
    "document_template_url",
    "document_template_content_type",
    "document_template_data_base64",
    "document_template_notes_enabled",
    "document_template_letters_enabled",
    "document_template_invoices_enabled",
    "document_template_margin_top",
    "document_template_margin_right",
    "document_template_margin_bottom",
    "document_template_margin_left",
    "document_template_signature_x",
    "document_template_signature_y",
    "document_template_signature_width",
    "document_template_signature_height",
    "document_template_doctor_name_x",
    "document_template_doctor_name_y",
    "document_template_doctor_name_width",
    "document_template_doctor_name_height",
    "document_template_note_layout",
    "onboarding_required",
    "onboarding_completed_at",
    "users_allowed",
    "workspace_mode",
]


def _clinic_settings_defaults() -> dict[str, Any]:
    nil_uuid = UUID("00000000-0000-0000-0000-000000000000")
    field_names = {
        "clinic_name",
        "clinic_address",
        "clinic_phone",
        "clinic_specialty",
        "timezone",
        "appointment_start_time",
        "appointment_end_time",
        "appointments_per_hour",
        "doctor_name",
        "sender_name",
        "sender_email",
        "email_sender_mode",
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
        "document_template_signature_x",
        "document_template_signature_y",
        "document_template_signature_width",
        "document_template_signature_height",
        "document_template_doctor_name_x",
        "document_template_doctor_name_y",
        "document_template_doctor_name_width",
        "document_template_doctor_name_height",
        "document_template_note_layout",
        "onboarding_required",
        "onboarding_completed_at",
        "users_allowed",
        "workspace_mode",
    }
    return ClinicSettingsOut.model_construct(id=nil_uuid, org_id=nil_uuid).model_dump(include=field_names)


def _hidden_clinic_template_defaults() -> dict[str, Any]:
    return {
        "document_template_content_type": None,
        "document_template_data_base64": None,
        "sender_email_app_password": None,
    }

USER_COLUMNS = [
    "id",
    "org_id",
    "identifier",
    "name",
    "role",
    "doctor_dob",
    "doctor_address",
    "doctor_signature_name",
    "doctor_signature_content_type",
    "doctor_signature_data_base64",
    "created_at",
]

USER_LIST_COLUMNS = [
    "id",
    "org_id",
    "identifier",
    "name",
    "role",
    "doctor_dob",
    "doctor_address",
    "doctor_signature_name",
    "doctor_signature_content_type",
    "created_at",
]

SUPERUSER_ORG_SUMMARY_COLUMNS = [
    "org_id",
    "clinic_name",
    "workspace_mode",
    "users_allowed",
    "created_at",
    "user_count",
    "patient_count",
    "note_count",
    "invoice_count",
    "follow_up_count",
    "total_tokens",
    "media_storage_bytes",
    "recent_error_count",
    "last_activity_at",
]


def _settings_returning_clause() -> str:
    return ", ".join(CLINIC_SETTINGS_COLUMNS)


def _settings_values(payload: ClinicSettingsUpdate, current: dict[str, Any] | None = None) -> dict[str, Any]:
    payload_values = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True, exclude={"email_configured"}).items()
        if key != "doctor_name"
    }
    values = {
        **_clinic_settings_defaults(),
        **_hidden_clinic_template_defaults(),
        **(current or {}),
        **payload_values,
    }
    if isinstance(values.get("document_template_note_layout"), str):
        try:
            values["document_template_note_layout"] = json.loads(values["document_template_note_layout"])
        except json.JSONDecodeError:
            values["document_template_note_layout"] = {}
    values["sender_email_app_password"] = encrypt_stored_secret(
        values.get("sender_email_app_password")
    )
    normalized = {column: values.get(column) for column in CLINIC_SETTINGS_MUTABLE_COLUMNS}
    normalized["document_template_note_layout"] = json.dumps(normalized.get("document_template_note_layout") or {})
    return normalized


def _signature_url(row: dict[str, Any], *, require_data: bool) -> str | None:
    if not row.get("doctor_signature_name"):
        return None
    if require_data and not row.get("doctor_signature_data_base64"):
        return None
    return "/users/{}/signature/file".format(row["id"])


def _user_with_display_name(row: dict[str, Any], *, require_signature_data: bool = False) -> dict[str, Any]:
    return {
        **row,
        "name": display_name(row),
        "doctor_signature_url": _signature_url(row, require_data=require_signature_data),
    }


class PostgresAuthSettingsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def list_organization_ids(self) -> list[str]:
        def _list() -> list[str]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select id from public.organizations order by created_at asc", ())
                    return [str(row[0]) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def create_organization(self, clinic_name: str) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.organizations (name)
                        values (%s)
                        returning id, name, created_at
                        """,
                        (clinic_name.strip(),),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create organization.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def delete_organization(self, org_id: str) -> bool:
        def _delete() -> bool:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("delete from public.organizations where id = %s", (org_id,))
                    return int(cursor.rowcount or 0) > 0

        return await asyncio.to_thread(_delete)

    async def list_all_organizations(self) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          o.id as org_id,
                          coalesce(nullif(cs.clinic_name, ''), o.name) as clinic_name,
                          coalesce(cs.workspace_mode, 'solo') as workspace_mode,
                          coalesce(cs.users_allowed, 2)::int as users_allowed,
                          cs.clinic_specialty,
                          o.created_at,
                          coalesce(users.user_count, 0)::int as user_count,
                          coalesce(patients.patient_count, 0)::int as patient_count,
                          coalesce(notes.note_count, 0)::int as note_count,
                          coalesce(invoices.invoice_count, 0)::int as invoice_count,
                          coalesce(follow_ups.follow_up_count, 0)::int as follow_up_count,
                          coalesce(usage.total_tokens, 0)::int as total_tokens,
                          coalesce(patient_attachments.media_storage_bytes, 0)::bigint as media_storage_bytes,
                          coalesce(platform_errors.recent_error_count, 0)::int as recent_error_count,
                          greatest(
                            o.created_at,
                            coalesce(users.last_activity_at, o.created_at),
                            coalesce(patients.last_activity_at, o.created_at),
                            coalesce(notes.last_activity_at, o.created_at),
                            coalesce(invoices.last_activity_at, o.created_at),
                            coalesce(follow_ups.last_activity_at, o.created_at),
                            coalesce(audit.last_activity_at, o.created_at)
                          ) as last_activity_at
                        from public.organizations o
                        left join public.clinic_settings cs on cs.org_id = o.id
                        left join lateral (
                          select count(*) as user_count, max(created_at) as last_activity_at
                          from public.clinic_users
                          where org_id = o.id
                        ) users on true
                        left join lateral (
                          select count(*) as patient_count, max(coalesce(last_visit_at, created_at)) as last_activity_at
                          from public.patients
                          where org_id = o.id
                        ) patients on true
                        left join lateral (
                          select count(*) as note_count, max(created_at) as last_activity_at
                          from public.notes
                          where org_id = o.id
                        ) notes on true
                        left join lateral (
                          select count(*) as invoice_count, max(created_at) as last_activity_at
                          from public.invoices
                          where org_id = o.id
                        ) invoices on true
                        left join lateral (
                          select count(*) as follow_up_count, max(scheduled_for) as last_activity_at
                          from public.follow_ups
                          where org_id = o.id
                        ) follow_ups on true
                        left join lateral (
                          select max(created_at) as last_activity_at
                          from public.audit_events
                          where org_id = o.id
                        ) audit on true
                        left join lateral (
                          select sum(total_tokens) as total_tokens
                          from public.ai_usage_events
                          where org_id = o.id
                        ) usage on true
                        left join lateral (
                          select sum(file_size) as media_storage_bytes
                          from public.patient_attachments
                          where org_id = o.id
                        ) patient_attachments on true
                        left join lateral (
                          select count(*)::int as recent_error_count
                          from public.platform_errors
                          where org_id = o.id
                            and created_at >= now() - interval '7 days'
                        ) platform_errors on true
                        order by o.created_at desc
                        """,
                        (),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def create_customer_onboarding(
        self,
        *,
        customer_id: str,
        customer_name: str,
        phone: str,
        users_allowed: int,
        workspace_mode: str = "solo",
        created_by: str | None = None,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.customer_onboarding (
                          customer_id,
                          customer_name,
                          phone,
                          users_allowed,
                          workspace_mode,
                          created_by
                        )
                        values (%s, %s, %s, %s, %s, %s)
                        returning id, customer_id, customer_name, phone, users_allowed, workspace_mode, status,
                          claimed_org_id, claimed_at, created_by, created_at, updated_at
                        """,
                        (customer_id, customer_name, phone, users_allowed, workspace_mode, created_by),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create customer onboarding record.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_customer_onboarding(self) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          co.id,
                          co.customer_id,
                          co.customer_name,
                          co.phone,
                          co.users_allowed,
                          co.workspace_mode,
                          co.status,
                          co.claimed_org_id,
                          co.claimed_at,
                          co.created_by,
                          co.created_at,
                          co.updated_at,
                          coalesce(nullif(trim(cs.clinic_name), ''), o.name) as claimed_org_name,
                          coalesce(users.users_used, 0)::int as users_used
                        from public.customer_onboarding co
                        left join public.organizations o on o.id = co.claimed_org_id
                        left join public.clinic_settings cs on cs.org_id = co.claimed_org_id
                        left join lateral (
                          select count(*) as users_used
                          from public.clinic_users cu
                          where cu.org_id = co.claimed_org_id
                        ) users on true
                        order by co.created_at desc
                        """
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def get_customer_onboarding_by_customer_id(self, customer_id: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, customer_id, customer_name, phone, users_allowed, workspace_mode, status,
                          claimed_org_id, claimed_at, created_by, created_at, updated_at
                        from public.customer_onboarding
                        where customer_id = %s
                        limit 1
                        """,
                        (customer_id,),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None

        return await asyncio.to_thread(_get)

    async def provision_customer_organization(
        self,
        *,
        customer_id: str,
        expected_phone: str,
        clinic_settings: ClinicSettingsUpdate,
        identifier: str,
        name: str,
        password_hash: str,
    ) -> dict[str, Any]:
        settings_values = _settings_values(clinic_settings)
        settings_columns = list(CLINIC_SETTINGS_MUTABLE_COLUMNS)

        def _provision() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, phone, status, workspace_mode, users_allowed
                        from public.customer_onboarding
                        where customer_id = %s
                        for update
                        """,
                        (customer_id,),
                    )
                    onboarding = cursor.fetchone()
                    if (
                        not onboarding
                        or str(onboarding[2]) != "pending"
                        or normalize_phone_number(onboarding[1]) != normalize_phone_number(expected_phone)
                    ):
                        raise ValueError("Invalid customer ID or phone number.")

                    settings_values["workspace_mode"] = str(onboarding[3] or "solo")
                    settings_values["users_allowed"] = int(onboarding[4] or 2)

                    cursor.execute(
                        "select 1 from public.clinic_users where identifier = %s limit 1",
                        (identifier,),
                    )
                    if cursor.fetchone():
                        raise ValueError("An account with that email or phone already exists.")

                    cursor.execute(
                        """
                        insert into public.organizations (name)
                        values (%s)
                        returning id
                        """,
                        (str(clinic_settings.clinic_name or "").strip(),),
                    )
                    organization = cursor.fetchone()
                    if not organization:
                        raise ValueError("Failed to create organization.")
                    org_id = str(organization[0])

                    cursor.execute(
                        f"""
                        insert into public.clinic_settings (org_id, {", ".join(settings_columns)})
                        values ({", ".join(["%s"] * (len(settings_columns) + 1))})
                        returning {_settings_returning_clause()}
                        """,
                        (org_id, *(settings_values[column] for column in settings_columns)),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Failed to create clinic settings.")

                    cursor.execute(
                        """
                        insert into public.clinic_users (
                          org_id, identifier, name, password_hash, role, doctor_dob,
                          doctor_address, session_version
                        )
                        values (%s, %s, %s, %s, 'admin', null, '', 1)
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (org_id, identifier, name.strip(), password_hash),
                    )
                    user_row = cursor.fetchone()
                    if not user_row:
                        raise ValueError("Failed to create user.")
                    user = _row_to_dict(user_row, cursor)
                    user["name"] = display_name(user)

                    cursor.execute(
                        """
                        update public.customer_onboarding
                        set status = 'claimed',
                          claimed_org_id = %s,
                          claimed_at = now(),
                          updated_at = now()
                        where customer_id = %s and status = 'pending'
                        returning id
                        """,
                        (org_id, customer_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Invalid customer ID or phone number.")
                    return user

        return await asyncio.to_thread(_provision)

    async def provision_open_organization(
        self,
        *,
        clinic_settings: ClinicSettingsUpdate,
        identifier: str,
        name: str,
        password_hash: str,
    ) -> dict[str, Any]:
        settings_values = _settings_values(clinic_settings)
        settings_columns = list(CLINIC_SETTINGS_MUTABLE_COLUMNS)

        def _provision() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select 1 from public.clinic_users where identifier = %s limit 1",
                        (identifier,),
                    )
                    if cursor.fetchone():
                        raise ValueError("An account with that email or phone already exists.")

                    cursor.execute(
                        """
                        insert into public.organizations (name)
                        values (%s)
                        returning id
                        """,
                        (str(clinic_settings.clinic_name or "").strip(),),
                    )
                    organization = cursor.fetchone()
                    if not organization:
                        raise ValueError("Failed to create organization.")
                    org_id = str(organization[0])

                    cursor.execute(
                        f"""
                        insert into public.clinic_settings (org_id, {", ".join(settings_columns)})
                        values ({", ".join(["%s"] * (len(settings_columns) + 1))})
                        returning {_settings_returning_clause()}
                        """,
                        (org_id, *(settings_values[column] for column in settings_columns)),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Failed to create clinic settings.")

                    cursor.execute(
                        """
                        insert into public.clinic_users (
                          org_id, identifier, name, password_hash, role, doctor_dob,
                          doctor_address, session_version
                        )
                        values (%s, %s, %s, %s, 'admin', null, '', 1)
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (org_id, identifier, name.strip(), password_hash),
                    )
                    user_row = cursor.fetchone()
                    if not user_row:
                        raise ValueError("Failed to create user.")
                    user = _row_to_dict(user_row, cursor)
                    user["name"] = display_name(user)
                    return user

        return await asyncio.to_thread(_provision)

    async def get_customer_onboarding_for_org(self, org_id: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, customer_id, customer_name, phone, users_allowed, workspace_mode, status,
                          claimed_org_id, claimed_at, created_by, created_at, updated_at
                        from public.customer_onboarding
                        where claimed_org_id = %s
                        limit 1
                        """,
                        (org_id,),
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else None

        return await asyncio.to_thread(_get)

    async def claim_customer_onboarding(self, customer_id: str, org_id: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _claim() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.customer_onboarding
                        set status = 'claimed',
                          claimed_org_id = %s,
                          claimed_at = %s,
                          updated_at = %s
                        where customer_id = %s and status = 'pending'
                        returning id, customer_id, customer_name, phone, users_allowed, workspace_mode, status,
                          claimed_org_id, claimed_at, created_by, created_at, updated_at
                        """,
                        (org_id, timestamp, timestamp, customer_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Invalid customer ID or phone number.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_claim)

    async def update_customer_onboarding(self, onboarding_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {"customer_name", "phone", "users_allowed", "workspace_mode", "status"}
        updates = {key: value for key, value in payload.items() if key in allowed and value is not None}
        if not updates:
            raise ValueError("No updates provided.")
        updates["updated_at"] = datetime.now(UTC).isoformat()
        assignments = ", ".join(f"{key} = %s" for key in updates)

        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.customer_onboarding
                        set {assignments}
                        where id = %s
                        returning id, customer_id, customer_name, phone, users_allowed, workspace_mode, status,
                          claimed_org_id, claimed_at, created_by, created_at, updated_at
                        """,
                        (*updates.values(), onboarding_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Customer onboarding record not found.")
                    saved = _row_to_dict(row, cursor)
                    claimed_org_id = saved.get("claimed_org_id")
                    if "workspace_mode" in updates and claimed_org_id:
                        cursor.execute(
                            """
                            update public.clinic_settings
                            set workspace_mode = %s, updated_at = now()
                            where org_id = %s
                            """,
                            (saved["workspace_mode"], claimed_org_id),
                        )
                    if "users_allowed" in updates and claimed_org_id:
                        cursor.execute(
                            "select count(*)::int from public.clinic_users where org_id = %s",
                            (claimed_org_id,),
                        )
                        count_row = cursor.fetchone()
                        users_used = int(count_row[0] if count_row else 0)
                        users_allowed = int(saved["users_allowed"])
                        if users_allowed < users_used:
                            raise ValueError(
                                f"User limit cannot be lower than the {users_used} existing users."
                            )
                        cursor.execute(
                            """
                            update public.clinic_settings
                            set users_allowed = %s, updated_at = now()
                            where org_id = %s
                            """,
                            (users_allowed, claimed_org_id),
                        )
                    return saved

        return await asyncio.to_thread(_update)

    async def disable_customer_onboarding(self, onboarding_id: str) -> dict[str, Any]:
        return await self.update_customer_onboarding(onboarding_id, {"status": "disabled"})

    async def update_organization_workspace_mode(self, org_id: str, workspace_mode: str) -> str:
        def _update() -> str:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_settings
                        set workspace_mode = %s, updated_at = now()
                        where org_id = %s
                        returning workspace_mode
                        """,
                        (workspace_mode, org_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Organization settings not found.")
                    cursor.execute(
                        """
                        update public.customer_onboarding
                        set workspace_mode = %s, updated_at = now()
                        where claimed_org_id = %s
                        """,
                        (workspace_mode, org_id),
                    )
                    return str(row[0])

        return await asyncio.to_thread(_update)

    async def update_organization_users_allowed(self, org_id: str, users_allowed: int) -> int:
        def _update() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select count(*)::int from public.clinic_users where org_id = %s",
                        (org_id,),
                    )
                    row = cursor.fetchone()
                    users_used = int(row[0] if row else 0)
                    if users_allowed < users_used:
                        raise ValueError(f"User limit cannot be lower than the {users_used} existing users.")
                    cursor.execute(
                        """
                        update public.clinic_settings
                        set users_allowed = %s, updated_at = now()
                        where org_id = %s
                        returning users_allowed
                        """,
                        (users_allowed, org_id),
                    )
                    saved = cursor.fetchone()
                    if not saved:
                        raise ValueError("Organization settings not found.")
                    cursor.execute(
                        """
                        update public.customer_onboarding
                        set users_allowed = %s, updated_at = now()
                        where claimed_org_id = %s
                        """,
                        (users_allowed, org_id),
                    )
                    return int(saved[0])

        return await asyncio.to_thread(_update)

    async def count_users_for_org(self, org_id: str) -> int:
        def _count() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select count(*) from public.clinic_users where org_id = %s", (org_id,))
                    row = cursor.fetchone()
                    return int(row[0] if row else 0)

        return await asyncio.to_thread(_count)

    async def count_admins_for_org(self, org_id: str) -> int:
        def _count() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select count(*)
                        from public.clinic_users
                        where org_id = %s and role = 'admin'
                        """,
                        (org_id,),
                    )
                    row = cursor.fetchone()
                    return int(row[0] if row else 0)

        return await asyncio.to_thread(_count)

    async def create_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        values = _settings_values(payload)
        columns = ["org_id", *CLINIC_SETTINGS_MUTABLE_COLUMNS]
        placeholders = ", ".join(["%s"] * len(columns))

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.clinic_settings ({", ".join(columns)})
                        values ({placeholders})
                        returning {_settings_returning_clause()}
                        """,
                        (org_id, *(values[column] for column in CLINIC_SETTINGS_MUTABLE_COLUMNS)),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create clinic settings.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def get_clinic_settings(self, org_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(lambda: self.get_clinic_settings_sync(org_id))

    def get_clinic_settings_sync(self, org_id: str) -> dict[str, Any]:
        with self.connection_manager.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    select {_settings_returning_clause()}
                    from public.clinic_settings
                    where org_id = %s
                    limit 1
                    """,
                    (org_id,),
                )
                row = cursor.fetchone()
                settings = _row_to_dict(row, cursor) if row else {}
                if settings:
                    settings["sender_email_app_password"] = decrypt_stored_secret(
                        settings.get("sender_email_app_password")
                    )
                return settings

    async def upsert_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _upsert() -> dict[str, Any]:
            current = self.get_clinic_settings_sync(org_id)
            values = _settings_values(payload, current)
            insert_columns = ["org_id", *CLINIC_SETTINGS_MUTABLE_COLUMNS, "updated_at"]
            placeholders = ", ".join(["%s"] * len(insert_columns))
            update_assignments = ", ".join(
                f"{column} = excluded.{column}" for column in [*CLINIC_SETTINGS_MUTABLE_COLUMNS, "updated_at"]
            )
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.clinic_settings ({", ".join(insert_columns)})
                        values ({placeholders})
                        on conflict (org_id) do update set {update_assignments}
                        returning {_settings_returning_clause()}
                        """,
                        (org_id, *(values[column] for column in CLINIC_SETTINGS_MUTABLE_COLUMNS), timestamp),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to save clinic settings.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_upsert)

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
                **_settings_values(ClinicSettingsUpdate(), current),
                "document_template_name": filename,
                "document_template_url": "/settings/clinic/document-template/file",
                "document_template_content_type": content_type,
                "document_template_data_base64": data_base64,
                "document_template_notes_enabled": True,
                "document_template_letters_enabled": True,
                "document_template_invoices_enabled": True,
            }
            return self._upsert_clinic_settings_values(org_id, values, timestamp)

        return await asyncio.to_thread(_set)

    async def clear_clinic_document_template(self, org_id: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _clear() -> dict[str, Any]:
            current = self.get_clinic_settings_sync(org_id)
            values = {
                **_settings_values(ClinicSettingsUpdate(), current),
                "document_template_name": None,
                "document_template_url": None,
                "document_template_content_type": None,
                "document_template_data_base64": None,
                "document_template_notes_enabled": False,
                "document_template_letters_enabled": False,
                "document_template_invoices_enabled": False,
            }
            return self._upsert_clinic_settings_values(org_id, values, timestamp)

        return await asyncio.to_thread(_clear)

    def _upsert_clinic_settings_values(
        self,
        org_id: str,
        values: dict[str, Any],
        timestamp: str,
    ) -> dict[str, Any]:
        insert_columns = ["org_id", *CLINIC_SETTINGS_MUTABLE_COLUMNS, "updated_at"]
        placeholders = ", ".join(
            "%s::jsonb" if column == "document_template_note_layout" else "%s"
            for column in insert_columns
        )
        update_assignments = ", ".join(
            f"{column} = excluded.{column}" for column in [*CLINIC_SETTINGS_MUTABLE_COLUMNS, "updated_at"]
        )
        with self.connection_manager.pool.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    insert into public.clinic_settings ({", ".join(insert_columns)})
                    values ({placeholders})
                    on conflict (org_id) do update set {update_assignments}
                    returning {_settings_returning_clause()}
                    """,
                    (org_id, *(values[column] for column in CLINIC_SETTINGS_MUTABLE_COLUMNS), timestamp),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError("Failed to save clinic settings.")
                return _row_to_dict(row, cursor)

    async def create_user(
        self,
        org_id: str,
        identifier: str,
        name: str,
        password_hash: str,
        role: UserRole,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.clinic_users (
                          org_id,
                          identifier,
                          name,
                          password_hash,
                          role,
                          doctor_dob,
                          doctor_address
                        )
                        values (%s, %s, %s, %s, %s, null, '')
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (org_id, identifier, name.strip(), password_hash, role),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create user.")
                    return _user_with_display_name(_row_to_dict(row, cursor), require_signature_data=True)

        return await asyncio.to_thread(_create)

    async def get_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, password_hash, created_at, session_version
                        from public.clinic_users
                        where identifier = %s
                        limit 1
                        """,
                        (identifier,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        return None
                    user = _row_to_dict(row, cursor)
                    user["name"] = display_name(user)
                    return user

        return await asyncio.to_thread(_get)

    async def get_user(self, user_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at
                        from public.clinic_users
                        where id = %s
                        limit 1
                        """,
                        (user_id,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    return _user_with_display_name(_row_to_dict(row, cursor), require_signature_data=True)

        return await asyncio.to_thread(_get)

    async def get_auth_user(self, user_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type, created_at,
                          session_version
                        from public.clinic_users
                        where id = %s
                        limit 1
                        """,
                        (user_id,),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    return _user_with_display_name(_row_to_dict(row, cursor), require_signature_data=False)

        return await asyncio.to_thread(_get)

    async def get_user_for_org(self, org_id: str, user_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at
                        from public.clinic_users
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, user_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    return _user_with_display_name(_row_to_dict(row, cursor), require_signature_data=True)

        return await asyncio.to_thread(_get)

    async def list_users(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type, created_at
                        from public.clinic_users
                        where org_id = %s
                        order by created_at asc
                        """,
                        (org_id,),
                    )
                    return [
                        _user_with_display_name(_row_to_dict(row, cursor), require_signature_data=False)
                        for row in cursor.fetchall()
                    ]

        return await asyncio.to_thread(_list)

    async def list_users_for_org_any(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, identifier, name, role, created_at
                        from public.clinic_users
                        where org_id = %s
                        order by created_at asc
                        """,
                        (org_id,),
                    )
                    return [
                        {**_row_to_dict(row, cursor), "name": display_name(_row_to_dict(row, cursor))}
                        for row in cursor.fetchall()
                    ]

        return await asyncio.to_thread(_list)

    async def update_user_role(self, user_id: str, payload: UserRoleUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_users
                        set role = %s, updated_at = %s
                        where id = %s
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (payload.role, timestamp, user_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    user = _row_to_dict(row, cursor)
                    user["name"] = display_name(user)
                    return user

        return await asyncio.to_thread(_update)

    async def update_user_account(self, user_id: str, payload: UserAccountUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_users
                        set name = %s, doctor_dob = %s, doctor_address = %s, updated_at = %s
                        where id = %s
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (
                            payload.name.strip(),
                            payload.doctor_dob.isoformat() if payload.doctor_dob else None,
                            payload.doctor_address.strip(),
                            timestamp,
                            user_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    return _user_with_display_name(_row_to_dict(row, cursor), require_signature_data=True)

        return await asyncio.to_thread(_update)

    async def update_user_password_hash(self, user_id: str, password_hash: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_users
                        set password_hash = %s,
                          session_version = session_version + 1,
                          updated_at = %s
                        where id = %s
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, password_hash, created_at, session_version
                        """,
                        (password_hash, timestamp, user_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    user = _row_to_dict(row, cursor)
                    user["name"] = display_name(user)
                    return user

        return await asyncio.to_thread(_update)

    async def revoke_user_sessions(self, user_id: str) -> None:
        def _revoke() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_users
                        set session_version = session_version + 1,
                          updated_at = now()
                        where id = %s
                        """,
                        (user_id,),
                    )
                    if cursor.rowcount != 1:
                        raise IndexError(user_id)

        await asyncio.to_thread(_revoke)

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
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_users
                        set doctor_signature_name = %s,
                          doctor_signature_content_type = %s,
                          doctor_signature_data_base64 = %s,
                          updated_at = %s
                        where id = %s
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (filename, content_type, data_base64, timestamp, user_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_set)

    async def clear_user_signature(self, user_id: str) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()

        def _clear() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        update public.clinic_users
                        set doctor_signature_name = null,
                          doctor_signature_content_type = null,
                          doctor_signature_data_base64 = null,
                          updated_at = %s
                        where id = %s
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, created_at, session_version
                        """,
                        (timestamp, user_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise IndexError(user_id)
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_clear)

    async def delete_user(self, user_id: str) -> None:
        await self.delete_user_any(user_id)

    async def delete_user_any(self, user_id: str) -> None:
        def _delete() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("delete from public.clinic_users where id = %s", (user_id,))

        await asyncio.to_thread(_delete)

    async def count_users(self) -> int:
        def _count() -> int:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select count(*) from public.clinic_users", ())
                    row = cursor.fetchone()
                    return int(row[0] if row else 0)

        return await asyncio.to_thread(_count)
