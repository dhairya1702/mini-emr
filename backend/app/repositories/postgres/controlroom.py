from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import hashlib
import re
from typing import Any

from app.migrations import MigrationError, discover_migrations, migration_status
from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict


INTEGRITY_CHECKS: tuple[tuple[str, str, str], ...] = (
    (
        "invoice_items_invoice_org",
        "Invoice item org matches invoice org",
        """
        select count(*)::bigint
        from public.invoice_items ii
        left join public.invoices i on i.id = ii.invoice_id
        where i.id is null or ii.org_id is distinct from i.org_id
        """,
    ),
    (
        "invoice_items_catalog_org",
        "Invoice item org matches catalog item org",
        """
        select count(*)::bigint
        from public.invoice_items ii
        join public.catalog_items ci on ci.id = ii.catalog_item_id
        where ii.org_id is distinct from ci.org_id
        """,
    ),
    (
        "users_valid_org",
        "Users belong to valid organizations",
        """
        select count(*)::bigint
        from public.clinic_users u
        left join public.organizations o on o.id = u.org_id
        where o.id is null
        """,
    ),
    (
        "settings_valid_org",
        "Clinic settings belong to valid organizations",
        """
        select count(*)::bigint
        from public.clinic_settings cs
        left join public.organizations o on o.id = cs.org_id
        where o.id is null
        """,
    ),
    (
        "patients_valid_org",
        "Patients belong to valid organizations",
        """
        select count(*)::bigint
        from public.patients p
        left join public.organizations o on o.id = p.org_id
        where o.id is null
        """,
    ),
    (
        "notes_patient_org",
        "Notes match patient organization",
        """
        select count(*)::bigint
        from public.notes n
        left join public.patients p on p.id = n.patient_id
        where p.id is null or n.org_id is distinct from p.org_id
        """,
    ),
    (
        "invoices_patient_org",
        "Invoices match patient organization",
        """
        select count(*)::bigint
        from public.invoices i
        left join public.patients p on p.id = i.patient_id
        where p.id is null or i.org_id is distinct from p.org_id
        """,
    ),
    (
        "followups_patient_org",
        "Follow-ups match patient organization",
        """
        select count(*)::bigint
        from public.follow_ups f
        left join public.patients p on p.id = f.patient_id
        where p.id is null or f.org_id is distinct from p.org_id
        """,
    ),
    (
        "attachments_patient_org",
        "Attachments match patient organization",
        """
        select count(*)::bigint
        from public.patient_attachments a
        left join public.patients p on p.id = a.patient_id
        where p.id is null or a.org_id is distinct from p.org_id
        """,
    ),
    (
        "whatsapp_binding_user_org",
        "WhatsApp bindings point to valid org/users",
        """
        select count(*)::bigint
        from public.whatsapp_owner_bindings b
        left join public.organizations o on o.id = b.org_id
        left join public.clinic_users u on u.id = b.user_id
        where o.id is null or (b.user_id is not null and (u.id is null or u.org_id is distinct from b.org_id))
        """,
    ),
)


def _normalize_message(value: str) -> str:
    compact = re.sub(r"\s+", " ", str(value or "").strip().lower())
    compact = re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27,}", "<uuid>", compact)
    compact = re.sub(r"\d+", "<n>", compact)
    return compact[:180]


def _serialize_platform_error_sample(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **row,
        "id": str(row["id"]) if row.get("id") is not None else "",
        "org_id": str(row["org_id"]) if row.get("org_id") is not None else None,
        "user_id": str(row["user_id"]) if row.get("user_id") is not None else None,
    }


class PostgresControlRoomRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def get_controlroom_database_overview(self) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            checked_at = datetime.now(UTC)
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select 1")
                    reachable = cursor.fetchone() == (1,)
                try:
                    expected = discover_migrations()
                    pending, unknown = migration_status(connection, expected, ensure_table=False)
                except MigrationError as exc:
                    pending = []
                    unknown = [str(exc)]
                with connection.cursor() as cursor:
                    cursor.execute("select to_regclass('public.schema_migrations')")
                    if cursor.fetchone()[0] is None:
                        applied_rows = []
                    else:
                        cursor.execute(
                            """
                            select migration_name as name, checksum_sha256, applied_at
                            from public.schema_migrations
                            order by migration_name desc
                            """
                        )
                        applied_rows = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    cursor.execute(
                        """
                        select relname as table_name, greatest(n_live_tup, 0)::bigint as estimated_rows
                        from pg_stat_user_tables
                        where schemaname = 'public'
                        order by n_live_tup desc, relname
                        limit 30
                        """
                    )
                    table_stats = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    integrity = []
                    for key, label, sql in INTEGRITY_CHECKS:
                        try:
                            cursor.execute(sql)
                            invalid_count = int(cursor.fetchone()[0] or 0)
                            status = "healthy" if invalid_count == 0 else "failing"
                            evidence = f"{invalid_count} invalid row{'s' if invalid_count != 1 else ''}."
                        except Exception as exc:
                            connection.rollback()
                            invalid_count = 0
                            status = "unknown"
                            evidence = f"Check failed: {type(exc).__name__}."
                        integrity.append(
                            {
                                "key": key,
                                "label": label,
                                "status": status,
                                "invalid_count": invalid_count,
                                "evidence": evidence,
                            }
                        )
                return {
                    "checked_at": checked_at,
                    "reachable": reachable,
                    "migration_status": "warning" if pending or unknown else "healthy",
                    "pending_migrations": [item.name for item in pending],
                    "database_only_migrations": unknown,
                    "applied_migrations": applied_rows,
                    "table_stats": table_stats,
                    "integrity_checks": integrity,
                }

        return await asyncio.to_thread(_get)

    async def get_controlroom_status_metrics(self) -> dict[str, Any]:
        database = await self.get_controlroom_database_overview()

        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select coalesce(sum(request_count), 0)::bigint as request_count,
                          coalesce(sum(error_response_count), 0)::bigint as error_response_count
                        from public.api_request_metrics
                        where metric_date >= current_date - interval '1 day'
                        """
                    )
                    request_metrics = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        """
                        select count(*)::bigint as error_count,
                          coalesce((
                            select coalesce(nullif(path, ''), error_type)
                            from public.platform_errors
                            where created_at >= now() - interval '1 hour'
                            group by coalesce(nullif(path, ''), error_type)
                            order by count(*) desc, coalesce(nullif(path, ''), error_type)
                            limit 1
                          ), '') as top_error_context
                        from public.platform_errors
                        where created_at >= now() - interval '1 hour'
                        """
                    )
                    errors_1h = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        """
                        select count(*)::bigint as failed_count, max(created_at) as last_failed_at
                        from public.whatsapp_message_events
                        where status = 'failed' and created_at >= now() - interval '24 hours'
                        """
                    )
                    whatsapp = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        """
                        select count(*)::bigint as due_count,
                          count(*) filter (where reminder_last_error <> '')::bigint as error_count
                        from public.follow_ups
                        where status = 'scheduled' and scheduled_for <= now()
                        """
                    )
                    followups = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        """
                        select count(*)::bigint as request_count,
                          coalesce(sum(total_tokens), 0)::bigint as total_tokens
                        from public.ai_usage_events
                        where created_at >= now() - interval '24 hours'
                        """
                    )
                    ai_usage = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        """
                        select count(*)::bigint as configured_org_count
                        from public.clinic_settings
                        where sender_email <> ''
                          and coalesce(sender_email_app_password, '') <> ''
                        """
                    )
                    email = _row_to_dict(cursor.fetchone(), cursor)
                    cursor.execute(
                        "select coalesce(sum(file_size), 0)::bigint as media_storage_bytes from public.patient_attachments"
                    )
                    storage = _row_to_dict(cursor.fetchone(), cursor)
            return {
                "database": database,
                "request_metrics_24h": request_metrics,
                "errors_1h": errors_1h,
                "whatsapp_24h": whatsapp,
                "followups_due": followups,
                "ai_usage_24h": ai_usage,
                "email": email,
                "storage": storage,
            }

        return await asyncio.to_thread(_get)

    async def list_controlroom_incidents(self, *, window_hours: int = 24, limit: int = 500) -> list[dict[str, Any]]:
        safe_window = max(1, min(int(window_hours), 168))
        safe_limit = max(1, min(int(limit), 1000))

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, org_id, user_id, identifier, path, method, status_code,
                          error_type, message, details, context, created_at
                        from public.platform_errors
                        where created_at >= %s
                        order by created_at desc
                        limit %s
                        """,
                        (datetime.now(UTC) - timedelta(hours=safe_window), safe_limit),
                    )
                    rows = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
            groups: dict[str, dict[str, Any]] = {}
            for row in rows:
                basis = "|".join(
                    [
                        str(row.get("method") or ""),
                        str(row.get("path") or ""),
                        str(row.get("status_code") or ""),
                        str(row.get("error_type") or ""),
                        _normalize_message(str(row.get("message") or "")),
                    ]
                )
                fingerprint = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]
                group = groups.setdefault(
                    fingerprint,
                    {
                        "fingerprint": fingerprint,
                        "method": str(row.get("method") or ""),
                        "path": str(row.get("path") or ""),
                        "status_code": row.get("status_code"),
                        "error_type": str(row.get("error_type") or ""),
                        "message": str(row.get("message") or ""),
                        "count": 0,
                        "org_ids": set(),
                        "user_ids": set(),
                        "first_seen_at": row["created_at"],
                        "last_seen_at": row["created_at"],
                        "latest_sample": row,
                    },
                )
                group["count"] += 1
                if row.get("org_id"):
                    group["org_ids"].add(str(row["org_id"]))
                if row.get("user_id"):
                    group["user_ids"].add(str(row["user_id"]))
                group["first_seen_at"] = min(group["first_seen_at"], row["created_at"])
                group["last_seen_at"] = max(group["last_seen_at"], row["created_at"])
                if row["created_at"] >= group["latest_sample"]["created_at"]:
                    group["latest_sample"] = row
            incidents = []
            for group in groups.values():
                status_code = int(group["status_code"] or 0)
                count = int(group["count"])
                severity = "critical" if status_code >= 500 and count >= 10 else "high" if status_code >= 500 else "medium" if count >= 5 else "low"
                incidents.append(
                    {
                        **group,
                        "severity": severity,
                        "affected_org_count": len(group.pop("org_ids")),
                        "affected_user_count": len(group.pop("user_ids")),
                        "latest_sample": _serialize_platform_error_sample(group["latest_sample"]),
                    }
                )
            return sorted(incidents, key=lambda item: (item["severity"] != "critical", -item["count"], item["last_seen_at"]), reverse=False)

        return await asyncio.to_thread(_list)
