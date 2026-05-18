from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.repositories.base import BaseSupabaseRepository
from app.schema_domains.case_studies import CaseStudyCreate


class CaseStudiesRepositoryMixin(BaseSupabaseRepository):
    async def create_case_study(self, org_id: str, created_by: str, payload: CaseStudyCreate) -> dict[str, Any]:
        case_study_id = str(uuid4())

        def _create() -> dict[str, Any]:
            patient = self.client.table("patients").select("id").eq("org_id", org_id).eq("id", str(payload.patient_id)).single().execute().data
            if not patient:
                raise ValueError("Patient not found for this organization.")
            return (
                self.client.table("case_studies")
                .insert(
                    {
                        "id": case_study_id,
                        "org_id": org_id,
                        "patient_id": str(payload.patient_id),
                        "title": payload.title.strip(),
                        "status": payload.status,
                        "template_key": payload.template_key,
                        "anonymized": payload.anonymized,
                        "author_instructions": payload.author_instructions.strip(),
                        "generated_content": payload.generated_content,
                        "source_snapshot": payload.source_snapshot,
                        "created_by": created_by,
                        "updated_at": datetime.now(UTC).isoformat(),
                    }
                )
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_create)

    async def list_case_studies(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("case_studies")
            .select("*")
            .eq("org_id", org_id)
            .order("updated_at", desc=True)
            .execute()
            .data
        )

    async def get_case_study(self, org_id: str, case_study_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("case_studies")
            .select("*")
            .eq("org_id", org_id)
            .eq("id", case_study_id)
            .single()
            .execute()
            .data
        )

    async def update_case_study(self, org_id: str, case_study_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            case_study = (
                self.client.table("case_studies")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", case_study_id)
                .single()
                .execute()
                .data
            )
            if not case_study:
                raise ValueError("Case study not found for this organization.")
            normalized_updates: dict[str, Any] = {}
            for key, value in updates.items():
                if key == "patient_id":
                    patient = self.client.table("patients").select("id").eq("org_id", org_id).eq("id", str(value)).single().execute().data
                    if not patient:
                        raise ValueError("Patient not found for this organization.")
                    normalized_updates[key] = str(value)
                elif hasattr(value, "isoformat"):
                    normalized_updates[key] = value.isoformat()
                elif isinstance(value, str):
                    normalized_updates[key] = value.strip() if key != "generated_content" else value
                else:
                    normalized_updates[key] = value
            normalized_updates["updated_at"] = datetime.now(UTC).isoformat()
            updated = (
                self.client.table("case_studies")
                .update(normalized_updates)
                .eq("org_id", org_id)
                .eq("id", case_study_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to update case study.")
            return updated[0]

        return await asyncio.to_thread(_update)
