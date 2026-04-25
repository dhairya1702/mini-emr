from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.repositories.base import BaseSupabaseRepository
from app.schemas import FollowUpCreate, FollowUpUpdate, NoteCreate


class RecordsRepositoryMixin(BaseSupabaseRepository):
    async def create_note(self, org_id: str, payload: NoteCreate, *, version_number: int = 1, root_note_id: str | None = None, amended_from_note_id: str | None = None) -> dict[str, Any]:
        note_id = str(uuid4())
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .insert(
                {
                    "id": note_id,
                    "org_id": org_id,
                    "patient_id": str(payload.patient_id),
                    "content": payload.content,
                    "asset_payload": payload.asset_payload,
                    "status": "draft",
                    "version_number": version_number,
                    "root_note_id": root_note_id,
                    "amended_from_note_id": amended_from_note_id,
                    "snapshot_content": None,
                    "snapshot_asset_payload": [],
                    "finalized_at": None,
                    "sent_at": None,
                    "sent_by": None,
                    "sent_to": None,
                }
            )
            .execute()
            .data[0]
        )

    async def update_note_draft(self, org_id: str, note_id: str, content: str, asset_payload: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            note = self.client.table("notes").select("*").eq("org_id", org_id).eq("id", note_id).single().execute().data
            if not note:
                raise ValueError("Note not found for this organization.")
            if note.get("status") != "draft":
                raise ValueError("Only draft notes can be updated.")
            updated = self.client.table("notes").update(
                {
                    "content": content,
                    "asset_payload": asset_payload if asset_payload is not None else note.get("asset_payload") or [],
                }
            ).eq("org_id", org_id).eq("id", note_id).execute().data
            if not updated:
                raise ValueError("Failed to update note draft.")
            return updated[0]

        return await asyncio.to_thread(_update)

    async def get_note(self, org_id: str, note_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes").select("*").eq("org_id", org_id).eq("id", note_id).single().execute().data
        )

    async def finalize_note(self, org_id: str, note_id: str) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            note = self.client.table("notes").select("*").eq("org_id", org_id).eq("id", note_id).single().execute().data
            if not note:
                raise ValueError("Note not found for this organization.")
            if note.get("status") == "sent":
                raise ValueError("Sent notes cannot be changed.")
            if note.get("status") == "final" and note.get("snapshot_content"):
                return note
            updated = (
                self.client.table("notes")
                .update(
                    {
                        "status": "final",
                        "snapshot_content": note.get("content") or "",
                        "snapshot_asset_payload": note.get("asset_payload") or [],
                        "finalized_at": datetime.now(UTC).isoformat(),
                    }
                )
                .eq("org_id", org_id)
                .eq("id", note_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to finalize note.")
            return updated[0]

        return await asyncio.to_thread(_finalize)

    async def create_note_amendment(self, org_id: str, note_id: str, content: str, asset_payload: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        note = await self.get_note(org_id, note_id)
        patient_notes = await self.list_notes_for_patient(org_id, str(note["patient_id"]))
        root_note_id = str(note.get("root_note_id") or note["id"])
        existing_versions = [
            entry for entry in patient_notes if str(entry.get("root_note_id") or entry["id"]) == root_note_id
        ]
        next_version = max(int(entry.get("version_number") or 1) for entry in existing_versions) + 1
        return await self.create_note(
            org_id,
            NoteCreate(patient_id=note["patient_id"], content=content, asset_payload=asset_payload or note.get("asset_payload") or []),
            version_number=next_version,
            root_note_id=root_note_id,
            amended_from_note_id=str(note["id"]),
        )

    async def list_notes_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .select("*")
            .eq("org_id", org_id)
            .eq("patient_id", patient_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )

    async def mark_note_sent(self, org_id: str, note_id: str, *, sent_by: str, sent_to: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            note = self.client.table("notes").select("*").eq("org_id", org_id).eq("id", note_id).single().execute().data
            if not note:
                raise ValueError("Note not found for this organization.")
            if note.get("status") == "draft":
                raise ValueError("Finalize the note before sending it.")
            if note.get("sent_at"):
                return note
            updated = (
                self.client.table("notes")
                .update(
                    {
                        "status": "sent",
                        "snapshot_content": note.get("snapshot_content") or note.get("content") or "",
                        "snapshot_asset_payload": note.get("snapshot_asset_payload") or note.get("asset_payload") or [],
                        "sent_at": datetime.now(UTC).isoformat(),
                        "sent_by": sent_by,
                        "sent_to": sent_to,
                    }
                )
                .eq("org_id", org_id)
                .eq("id", note_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to mark note as sent.")
            return updated[0]

        return await asyncio.to_thread(_mark)

    async def create_follow_up(self, org_id: str, patient_id: str, created_by: str, payload: FollowUpCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = self.client.table("patients").select("id").eq("org_id", org_id).eq("id", patient_id).single().execute().data
            if not patient:
                raise ValueError("Patient not found for this organization.")
            return (
                self.client.table("follow_ups")
                .insert(
                    {
                        "org_id": org_id,
                        "patient_id": patient_id,
                        "created_by": created_by,
                        "scheduled_for": payload.scheduled_for.isoformat(),
                        "notes": payload.notes.strip(),
                        "status": "scheduled",
                        "reminder_sent_at": None,
                    }
                )
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_create)

    async def list_follow_ups(self, org_id: str, status: str | None = None, query: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            follow_ups_query = self.client.table("follow_ups").select("*").eq("org_id", org_id)
            if status:
                follow_ups_query = follow_ups_query.eq("status", status)
            follow_ups = follow_ups_query.order("scheduled_for", desc=False).limit(limit).execute().data
            if not follow_ups:
                return []
            patient_ids = sorted({str(follow_up["patient_id"]) for follow_up in follow_ups})
            patients = (
                self.client.table("patients").select("id, name").eq("org_id", org_id).in_("id", patient_ids).execute().data
            )
            patient_names = {str(patient["id"]): str(patient.get("name") or "").strip() for patient in patients}
            normalized_query = (query or "").strip().lower()
            rows = [{**follow_up, "patient_name": patient_names.get(str(follow_up["patient_id"]), "")} for follow_up in follow_ups]
            if normalized_query:
                rows = [
                    row
                    for row in rows
                    if normalized_query in row["patient_name"].lower()
                    or normalized_query in str(row.get("notes") or "").lower()
                ]
            return rows

        return await asyncio.to_thread(_list)

    async def list_follow_ups_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("follow_ups")
            .select("*")
            .eq("org_id", org_id)
            .eq("patient_id", patient_id)
            .order("scheduled_for", desc=True)
            .execute()
            .data
        )

    async def list_due_follow_ups(self, org_id: str, due_before_iso: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("follow_ups")
            .select("*")
            .eq("org_id", org_id)
            .eq("status", "scheduled")
            .is_("reminder_sent_at", "null")
            .lte("scheduled_for", due_before_iso)
            .order("scheduled_for", desc=False)
            .execute()
            .data
        )

    async def mark_follow_up_reminder_sent(self, org_id: str, follow_up_id: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            updated = (
                self.client.table("follow_ups")
                .update({"reminder_sent_at": datetime.now(UTC).isoformat()})
                .eq("org_id", org_id)
                .eq("id", follow_up_id)
                .execute()
                .data
            )
            if not updated:
                raise ValueError("Failed to mark follow-up reminder as sent.")
            return updated[0]

        return await asyncio.to_thread(_mark)

    async def update_follow_up(self, org_id: str, follow_up_id: str, payload: FollowUpUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            existing = self.client.table("follow_ups").select("*").eq("org_id", org_id).eq("id", follow_up_id).single().execute().data
            if not existing:
                raise ValueError("Follow-up not found for this organization.")
            update_payload: dict[str, Any] = {}
            if payload.scheduled_for is not None:
                update_payload["scheduled_for"] = payload.scheduled_for.isoformat()
            if payload.notes is not None:
                update_payload["notes"] = payload.notes.strip()
            if payload.status is not None:
                update_payload["status"] = payload.status
                if payload.status == "completed":
                    update_payload["completed_at"] = datetime.now(UTC).isoformat()
                elif payload.status in {"scheduled", "cancelled"}:
                    update_payload["completed_at"] = None
                    if payload.status == "scheduled":
                        update_payload["reminder_sent_at"] = None
            if not update_payload:
                raise ValueError("No follow-up updates provided.")
            return (
                self.client.table("follow_ups")
                .update(update_payload)
                .eq("org_id", org_id)
                .eq("id", follow_up_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_update)
