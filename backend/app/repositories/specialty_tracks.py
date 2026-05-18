from __future__ import annotations

from typing import Any

from app.schema_domains.specialty import LongitudinalTrackCreate


class SpecialtyTracksRepositoryMixin:
    async def create_longitudinal_track(
        self,
        org_id: str,
        patient_id: str,
        payload: LongitudinalTrackCreate,
    ) -> dict[str, Any]:
        await self.get_patient(org_id, patient_id)
        row = payload.model_dump(mode="json")
        row.update({"org_id": org_id, "patient_id": patient_id})
        created = self.execute_with_retry(
            lambda: self.client.table("longitudinal_tracks").insert(row).execute().data
        )
        if not created:
            raise ValueError("Failed to create longitudinal track record.")
        return created[0]

    async def list_longitudinal_tracks_for_patient(
        self,
        org_id: str,
        patient_id: str,
        *,
        track_type: str | None = None,
    ) -> list[dict[str, Any]]:
        await self.get_patient(org_id, patient_id)

        def operation():
            query = (
                self.client.table("longitudinal_tracks")
                .select("*")
                .eq("org_id", org_id)
                .eq("patient_id", patient_id)
            )
            if track_type:
                query = query.eq("track_type", track_type)
            return query.order("measured_at", desc=False).execute().data

        return self.execute_with_retry(operation) or []

    async def update_longitudinal_track(
        self,
        org_id: str,
        patient_id: str,
        record_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any]:
        await self.get_patient(org_id, patient_id)
        updated = self.execute_with_retry(
            lambda: (
                self.client.table("longitudinal_tracks")
                .update(updates)
                .eq("org_id", org_id)
                .eq("patient_id", patient_id)
                .eq("id", record_id)
                .execute()
                .data
            )
        )
        if not updated:
            raise ValueError("Longitudinal track record not found for this patient.")
        return updated[0]
