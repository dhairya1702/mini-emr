from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.auth_settings import _clinic_settings_defaults, _hidden_clinic_template_defaults
from app.repositories.base import display_name
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.auth_settings import ClinicSettingsUpdate, UserAccountUpdate, UserRoleUpdate
from app.schema_domains.common import UserRole


CLINIC_SETTINGS_COLUMNS = [
    "id",
    "org_id",
    "clinic_name",
    "clinic_address",
    "clinic_phone",
    "clinic_specialty",
    "appointment_start_time",
    "appointment_end_time",
    "appointments_per_hour",
    "doctor_name",
    "sender_name",
    "sender_email",
    "sender_email_app_password",
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
    "updated_at",
]

CLINIC_SETTINGS_MUTABLE_COLUMNS = [
    "clinic_name",
    "clinic_address",
    "clinic_phone",
    "clinic_specialty",
    "appointment_start_time",
    "appointment_end_time",
    "appointments_per_hour",
    "doctor_name",
    "sender_name",
    "sender_email",
    "sender_email_app_password",
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
]

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
    "created_at",
    "user_count",
    "patient_count",
    "note_count",
    "invoice_count",
    "follow_up_count",
    "total_tokens",
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
    return {column: values.get(column) for column in CLINIC_SETTINGS_MUTABLE_COLUMNS}


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

    async def delete_organization(self, org_id: str) -> None:
        def _delete() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("delete from public.organizations where id = %s", (org_id,))

        await asyncio.to_thread(_delete)

    async def list_all_organizations(self) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          o.id as org_id,
                          coalesce(nullif(cs.clinic_name, ''), o.name) as clinic_name,
                          o.created_at,
                          coalesce(users.user_count, 0)::int as user_count,
                          coalesce(patients.patient_count, 0)::int as patient_count,
                          coalesce(notes.note_count, 0)::int as note_count,
                          coalesce(invoices.invoice_count, 0)::int as invoice_count,
                          coalesce(follow_ups.follow_up_count, 0)::int as follow_up_count,
                          coalesce(usage.total_tokens, 0)::int as total_tokens,
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
                        order by o.created_at desc
                        """,
                        (),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

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
                return _row_to_dict(row, cursor) if row else {}

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
                          doctor_signature_data_base64, created_at
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
                          doctor_signature_data_base64, password_hash, created_at
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
                          doctor_signature_name, doctor_signature_content_type, created_at
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
                          doctor_signature_data_base64, created_at
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
                          doctor_signature_data_base64, created_at
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
                        set password_hash = %s, updated_at = %s
                        where id = %s
                        returning id, org_id, identifier, name, role, doctor_dob, doctor_address,
                          doctor_signature_name, doctor_signature_content_type,
                          doctor_signature_data_base64, password_hash, created_at
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
                          doctor_signature_data_base64, created_at
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
                          doctor_signature_data_base64, created_at
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
