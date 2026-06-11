from __future__ import annotations

import asyncio
import json
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.specialty import LongitudinalTrackCreate


LONGITUDINAL_TRACK_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "track_type",
    "measured_at",
    "summary_fields",
    "raw_payload",
    "derived_metrics",
    "created_at",
]

LONGITUDINAL_TRACK_UPDATE_COLUMNS = {
    "track_type",
    "measured_at",
    "summary_fields",
    "raw_payload",
    "derived_metrics",
}


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


class PostgresSpecialtyTracksRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_longitudinal_track(
        self,
        org_id: str,
        patient_id: str,
        payload: LongitudinalTrackCreate,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    cursor.execute(
                        f"""
                        insert into public.longitudinal_tracks (
                          org_id, patient_id, track_type, measured_at,
                          summary_fields, raw_payload, derived_metrics
                        )
                        values (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
                        returning {_columns_sql(LONGITUDINAL_TRACK_COLUMNS)}
                        """,
                        (
                            org_id,
                            patient_id,
                            payload.track_type,
                            payload.measured_at.isoformat(),
                            json.dumps(payload.summary_fields),
                            json.dumps(payload.raw_payload),
                            json.dumps(payload.derived_metrics),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create longitudinal track record.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_longitudinal_tracks_for_patient(
        self,
        org_id: str,
        patient_id: str,
        *,
        track_type: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["org_id = %s", "patient_id = %s"]
        params: list[Any] = [org_id, patient_id]
        if track_type:
            clauses.append("track_type = %s")
            params.append(track_type)

        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    cursor.execute(
                        f"""
                        select {_columns_sql(LONGITUDINAL_TRACK_COLUMNS)}
                        from public.longitudinal_tracks
                        where {" and ".join(clauses)}
                        order by measured_at asc
                        """,
                        tuple(params),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def update_longitudinal_track(
        self,
        org_id: str,
        patient_id: str,
        record_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        unsupported_columns = sorted(set(updates) - LONGITUDINAL_TRACK_UPDATE_COLUMNS)
        if unsupported_columns:
            raise ValueError("Unsupported longitudinal track update fields: " + ", ".join(unsupported_columns))
        normalized_updates = {
            key: json.dumps(value)
            if key in {"summary_fields", "raw_payload", "derived_metrics"}
            else value.isoformat()
            if hasattr(value, "isoformat")
            else value
            for key, value in updates.items()
        }
        if not normalized_updates:
            raise ValueError("No longitudinal track updates provided.")

        def _update() -> dict[str, Any]:
            assignments = ", ".join(
                f"{column} = %s::jsonb" if column in {"summary_fields", "raw_payload", "derived_metrics"} else f"{column} = %s"
                for column in normalized_updates
            )
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, patient_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")
                    cursor.execute(
                        f"""
                        update public.longitudinal_tracks
                        set {assignments}
                        where org_id = %s and patient_id = %s and id = %s
                        returning {_columns_sql(LONGITUDINAL_TRACK_COLUMNS)}
                        """,
                        (*normalized_updates.values(), org_id, patient_id, record_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Longitudinal track record not found for this patient.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)
