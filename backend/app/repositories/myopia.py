from __future__ import annotations

import asyncio
from typing import Any

from app.repositories.base import BaseSupabaseRepository
from app.schemas import MyopiaMeasurementCreate


class MyopiaRepositoryMixin(BaseSupabaseRepository):
    async def create_myopia_measurement(self, org_id: str, patient_id: str, payload: MyopiaMeasurementCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = self.client.table("patients").select("id").eq("org_id", org_id).eq("id", patient_id).single().execute().data
            if not patient:
                raise ValueError("Patient not found for this organization.")
            return (
                self.client.table("myopia_measurements")
                .insert(
                    {
                        "org_id": org_id,
                        "patient_id": patient_id,
                        "measured_at": payload.measured_at.isoformat(),
                        "age_years": payload.age_years,
                        "axial_length_right_mm": payload.axial_length_right_mm,
                        "axial_length_left_mm": payload.axial_length_left_mm,
                        "treatment_type": payload.treatment_type.strip(),
                        "treatment_notes": payload.treatment_notes.strip(),
                        "visit_notes": payload.visit_notes.strip(),
                        "refraction_right": payload.refraction_right.strip(),
                        "refraction_left": payload.refraction_left.strip(),
                    }
                )
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_create)

    async def list_myopia_measurements_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("myopia_measurements")
            .select("*")
            .eq("org_id", org_id)
            .eq("patient_id", patient_id)
            .order("measured_at", desc=False)
            .execute()
            .data
        )

    async def update_myopia_measurement(self, org_id: str, patient_id: str, record_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            record = (
                self.client.table("myopia_measurements")
                .select("*")
                .eq("org_id", org_id)
                .eq("patient_id", patient_id)
                .eq("id", record_id)
                .single()
                .execute()
                .data
            )
            if not record:
                raise ValueError("Myopia measurement not found for this patient.")
            normalized_updates = {
                key: value.isoformat() if hasattr(value, "isoformat") else value.strip() if isinstance(value, str) else value
                for key, value in updates.items()
            }
            updated = (
                self.client.table("myopia_measurements")
                .update(normalized_updates)
                .eq("org_id", org_id)
                .eq("patient_id", patient_id)
                .eq("id", record_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to update myopia measurement.")
            return updated[0]

        return await asyncio.to_thread(_update)
