from __future__ import annotations

import asyncio
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.optometry import MyopiaMeasurementCreate


MYOPIA_MEASUREMENT_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "measured_at",
    "age_years",
    "axial_length_right_mm",
    "axial_length_left_mm",
    "treatment_type",
    "treatment_notes",
    "visit_notes",
    "refraction_right",
    "refraction_left",
    "created_at",
]

MYOPIA_MEASUREMENT_UPDATE_COLUMNS = {
    "measured_at",
    "age_years",
    "axial_length_right_mm",
    "axial_length_left_mm",
    "treatment_type",
    "treatment_notes",
    "visit_notes",
    "refraction_right",
    "refraction_left",
}


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


def _normalize_updates(updates: dict[str, Any]) -> dict[str, Any]:
    unsupported_columns = sorted(set(updates) - MYOPIA_MEASUREMENT_UPDATE_COLUMNS)
    if unsupported_columns:
        raise ValueError("Unsupported myopia measurement update fields: " + ", ".join(unsupported_columns))
    return {
        key: value.isoformat() if hasattr(value, "isoformat") else value.strip() if isinstance(value, str) else value
        for key, value in updates.items()
    }


class PostgresMyopiaRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def create_myopia_measurement(
        self,
        org_id: str,
        patient_id: str,
        payload: MyopiaMeasurementCreate,
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
                        insert into public.myopia_measurements (
                          org_id, patient_id, measured_at, age_years,
                          axial_length_right_mm, axial_length_left_mm,
                          treatment_type, treatment_notes, visit_notes,
                          refraction_right, refraction_left
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        returning {_columns_sql(MYOPIA_MEASUREMENT_COLUMNS)}
                        """,
                        (
                            org_id,
                            patient_id,
                            payload.measured_at.isoformat(),
                            payload.age_years,
                            payload.axial_length_right_mm,
                            payload.axial_length_left_mm,
                            payload.treatment_type.strip(),
                            payload.treatment_notes.strip(),
                            payload.visit_notes.strip(),
                            payload.refraction_right.strip(),
                            payload.refraction_left.strip(),
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create myopia measurement.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def list_myopia_measurements_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(MYOPIA_MEASUREMENT_COLUMNS)}
                        from public.myopia_measurements
                        where org_id = %s and patient_id = %s
                        order by measured_at asc
                        """,
                        (org_id, patient_id),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def update_myopia_measurement(
        self,
        org_id: str,
        patient_id: str,
        record_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_updates = _normalize_updates(updates)
        if not normalized_updates:
            raise ValueError("No myopia measurement updates provided.")

        def _update() -> dict[str, Any]:
            assignments = ", ".join(f"{column} = %s" for column in normalized_updates)
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id from public.myopia_measurements where org_id = %s and patient_id = %s and id = %s limit 1",
                        (org_id, patient_id, record_id),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Myopia measurement not found for this patient.")
                    cursor.execute(
                        f"""
                        update public.myopia_measurements
                        set {assignments}
                        where org_id = %s and patient_id = %s and id = %s
                        returning {_columns_sql(MYOPIA_MEASUREMENT_COLUMNS)}
                        """,
                        (*normalized_updates.values(), org_id, patient_id, record_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to update myopia measurement.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)
