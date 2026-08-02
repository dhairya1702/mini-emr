from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict


REFERRAL_PACKAGE_COLUMNS = [
    "id", "org_id", "patient_id", "created_by", "recipient_type", "recipient_name",
    "recipient_specialty", "recipient_clinic", "recipient_email", "recipient_phone", "reason",
    "clinical_question", "urgency", "referral_note", "snapshot", "included_records", "file_name",
    "storage_path", "file_size", "file_sha256", "page_count", "created_at",
]
REFERRAL_DELIVERY_COLUMNS = [
    "id", "org_id", "referral_package_id", "channel", "recipient_type", "recipient", "status",
    "provider_message_id", "error", "created_at", "updated_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


class PostgresReferralsRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_referral_package(self, org_id: str, row: dict[str, Any]) -> dict[str, Any]:
        package_id = str(row.get("id") or uuid4())

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.referral_packages (
                          id, org_id, patient_id, created_by, recipient_type, recipient_name,
                          recipient_specialty, recipient_clinic, recipient_email, recipient_phone,
                          reason, clinical_question, urgency, referral_note, snapshot, included_records,
                          file_name, storage_path, file_size, file_sha256, page_count
                        ) values (
                          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                          %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s
                        ) returning {_columns_sql(REFERRAL_PACKAGE_COLUMNS)}
                        """,
                        (
                            package_id, org_id, row["patient_id"], row["created_by"], row["recipient_type"],
                            row.get("recipient_name", ""), row.get("recipient_specialty", ""),
                            row.get("recipient_clinic", ""), row.get("recipient_email", ""),
                            row.get("recipient_phone", ""), row["reason"], row.get("clinical_question", ""),
                            row.get("urgency", "routine"), row.get("referral_note", ""),
                            json.dumps(row["snapshot"]), json.dumps(row.get("included_records") or []),
                            row["file_name"], row["storage_path"], row["file_size"], row["file_sha256"],
                            row.get("page_count", 0),
                        ),
                    )
                    result = cursor.fetchone()
                    if not result:
                        raise ValueError("Failed to create referral package.")
                    return _row_to_dict(result, cursor)

        return await asyncio.to_thread(_create)

    async def get_referral_package(self, org_id: str, package_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"select {_columns_sql(REFERRAL_PACKAGE_COLUMNS)} from public.referral_packages where org_id = %s and id = %s limit 1",
                        (org_id, package_id),
                    )
                    result = cursor.fetchone()
                    if not result:
                        raise ValueError("Referral package not found for this organization.")
                    return _row_to_dict(result, cursor)

        return await asyncio.to_thread(_get)

    async def list_referral_packages(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"select {_columns_sql(REFERRAL_PACKAGE_COLUMNS)} from public.referral_packages where org_id = %s and patient_id = %s order by created_at desc",
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(result, cursor) for result in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def list_longitudinal_tracks_by_ids(
        self, org_id: str, patient_id: str, record_ids: list[str]
    ) -> list[dict[str, Any]]:
        if not record_ids:
            return []

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, patient_id, track_type, measured_at, summary_fields,
                               raw_payload, derived_metrics, created_at
                        from public.longitudinal_tracks
                        where org_id = %s and patient_id = %s and id = any(%s::uuid[])
                        order by measured_at asc
                        """,
                        (org_id, patient_id, record_ids),
                    )
                    return [_row_to_dict(result, cursor) for result in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def create_referral_delivery(self, org_id: str, row: dict[str, Any]) -> dict[str, Any]:
        delivery_id = str(row.get("id") or uuid4())

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.referral_package_deliveries (
                          id, org_id, referral_package_id, channel, recipient_type, recipient,
                          status, provider_message_id, error
                        ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        returning {_columns_sql(REFERRAL_DELIVERY_COLUMNS)}
                        """,
                        (
                            delivery_id, org_id, row["referral_package_id"], row["channel"],
                            row["recipient_type"], row["recipient"], row["status"],
                            row.get("provider_message_id", ""), row.get("error", ""),
                        ),
                    )
                    result = cursor.fetchone()
                    if not result:
                        raise ValueError("Failed to record referral delivery.")
                    return _row_to_dict(result, cursor)

        return await asyncio.to_thread(_create)

    async def list_referral_deliveries(self, org_id: str, package_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"select {_columns_sql(REFERRAL_DELIVERY_COLUMNS)} from public.referral_package_deliveries where org_id = %s and referral_package_id = %s order by created_at asc",
                        (org_id, package_id),
                    )
                    return [_row_to_dict(result, cursor) for result in cursor.fetchall()]

        return await asyncio.to_thread(_list)
