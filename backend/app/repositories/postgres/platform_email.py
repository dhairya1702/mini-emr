from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict
from app.secret_crypto import decrypt_stored_secret, encrypt_stored_secret


class PostgresPlatformEmailRepository:
    connection_manager: PostgresConnectionManager

    async def get_platform_email_availability(self) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select sender_email, is_enabled,
                          sender_email_app_password is not null as credential_configured
                        from public.platform_email_settings
                        where id = 'default'
                        limit 1
                        """
                    )
                    row = cursor.fetchone()
                    return _row_to_dict(row, cursor) if row else {}

        return await asyncio.to_thread(_get)

    async def get_platform_email_settings(self) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select sender_name, sender_email, sender_email_app_password,
                               is_enabled, last_tested_at, last_test_succeeded,
                               last_error, updated_by, updated_at
                        from public.platform_email_settings
                        where id = 'default'
                        limit 1
                        """
                    )
                    row = cursor.fetchone()
                    settings = _row_to_dict(row, cursor) if row else {}
                    if settings:
                        settings["sender_email_app_password"] = decrypt_stored_secret(
                            settings.get("sender_email_app_password")
                        )
                    return settings

        return await asyncio.to_thread(_get)

    async def upsert_platform_email_settings(
        self,
        *,
        sender_name: str,
        sender_email: str,
        sender_email_app_password: str,
        is_enabled: bool,
        last_test_succeeded: bool,
        last_error: str,
        updated_by: str,
    ) -> dict[str, Any]:
        timestamp = datetime.now(UTC)
        encrypted_password = encrypt_stored_secret(sender_email_app_password)

        def _upsert() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.platform_email_settings (
                            id, sender_name, sender_email, sender_email_app_password,
                            is_enabled, last_tested_at, last_test_succeeded,
                            last_error, updated_by, updated_at
                        )
                        values ('default', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (id) do update set
                            sender_name = excluded.sender_name,
                            sender_email = excluded.sender_email,
                            sender_email_app_password = excluded.sender_email_app_password,
                            is_enabled = excluded.is_enabled,
                            last_tested_at = excluded.last_tested_at,
                            last_test_succeeded = excluded.last_test_succeeded,
                            last_error = excluded.last_error,
                            updated_by = excluded.updated_by,
                            updated_at = excluded.updated_at
                        returning sender_name, sender_email, sender_email_app_password,
                                  is_enabled, last_tested_at, last_test_succeeded,
                                  last_error, updated_by, updated_at
                        """,
                        (
                            sender_name,
                            sender_email,
                            encrypted_password,
                            is_enabled,
                            timestamp,
                            last_test_succeeded,
                            last_error,
                            updated_by,
                            timestamp,
                        ),
                    )
                    row = cursor.fetchone()
                    settings = _row_to_dict(row, cursor)
                    settings["sender_email_app_password"] = decrypt_stored_secret(
                        settings.get("sender_email_app_password")
                    )
                    return settings

        return await asyncio.to_thread(_upsert)
