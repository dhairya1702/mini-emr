import asyncio
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.config import get_settings
from app.schemas import (
    CatalogItemCreate,
    CatalogStockUpdate,
    ClinicSettingsUpdate,
    FollowUpCreate,
    FollowUpUpdate,
    InvoiceCreate,
    NoteCreate,
    PatientCreate,
    UserRole,
)


def _display_name(row: dict[str, Any]) -> str:
    stored_name = str(row.get("name") or "").strip()
    if stored_name:
        return stored_name

    identifier = str(row.get("identifier") or "").strip()
    if "@" in identifier:
        local_part = identifier.split("@", 1)[0]
        return local_part.replace(".", " ").replace("_", " ").strip().title() or "User"
    return identifier or "User"


def _rpc_single(result: Any) -> dict[str, Any]:
    if isinstance(result, list):
        return result[0] if result else {}
    return result or {}


class SupabaseRepository:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase environment variables are not configured.")
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)

    async def create_organization(self, clinic_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("organizations")
            .insert({"name": clinic_name.strip()})
            .execute()
            .data[0]
        )

    async def list_patients(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .eq("org_id", org_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )

    async def create_patient(self, org_id: str, payload: PatientCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def update_patient(self, org_id: str, patient_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .update(payload)
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .execute()
            .data[0]
        )

    async def get_patient(self, org_id: str, patient_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("patients")
            .select("*")
            .eq("org_id", org_id)
            .eq("id", patient_id)
            .single()
            .execute()
            .data
        )

    async def create_note(self, org_id: str, payload: NoteCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("notes")
            .insert(
                {
                    "org_id": org_id,
                    "patient_id": str(payload.patient_id),
                    "content": payload.content,
                }
            )
            .execute()
            .data[0]
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

    async def create_follow_up(
        self,
        org_id: str,
        patient_id: str,
        created_by: str,
        payload: FollowUpCreate,
    ) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            patient = (
                self.client.table("patients")
                .select("id")
                .eq("org_id", org_id)
                .eq("id", patient_id)
                .single()
                .execute()
                .data
            )
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
                    }
                )
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_create)

    async def list_follow_ups(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("follow_ups")
            .select("*")
            .eq("org_id", org_id)
            .order("scheduled_for", desc=False)
            .execute()
            .data
        )

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

    async def update_follow_up(self, org_id: str, follow_up_id: str, payload: FollowUpUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            existing = (
                self.client.table("follow_ups")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", follow_up_id)
                .single()
                .execute()
                .data
            )
            if not existing:
                raise ValueError("Follow-up not found for this organization.")
            update_payload: dict[str, Any] = {"status": payload.status}
            if payload.status == "completed":
                update_payload["completed_at"] = datetime.now(UTC).isoformat()
            elif payload.status == "cancelled":
                update_payload["completed_at"] = None
            return (
                self.client.table("follow_ups")
                .update(update_payload)
                .eq("org_id", org_id)
                .eq("id", follow_up_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_update)

    async def get_clinic_settings(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            rows = (
                self.client.table("clinic_settings")
                .select("*")
                .eq("org_id", org_id)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else {}

        return await asyncio.to_thread(_get)

    async def create_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def upsert_clinic_settings(self, org_id: str, payload: ClinicSettingsUpdate) -> dict[str, Any]:
        timestamp = datetime.now(UTC).isoformat()
        return await asyncio.to_thread(
            lambda: self.client.table("clinic_settings")
            .upsert(
                {
                    "org_id": org_id,
                    **payload.model_dump(),
                    "updated_at": timestamp,
                },
                on_conflict="org_id",
            )
            .execute()
            .data[0]
        )

    async def get_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        def _get() -> dict[str, Any] | None:
            rows = (
                self.client.table("clinic_users")
                .select("*")
                .eq("identifier", identifier)
                .limit(1)
                .execute()
                .data
            )
            return rows[0] if rows else None

        user = await asyncio.to_thread(_get)
        if user:
            user["name"] = _display_name(user)
        return user

    async def get_user(self, user_id: str) -> dict[str, Any]:
        user = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .select("id, org_id, identifier, name, role, created_at")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
        user["name"] = _display_name(user)
        return user

    async def create_user(self, org_id: str, identifier: str, password_hash: str, role: UserRole) -> dict[str, Any]:
        created = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .insert(
                {
                    "org_id": org_id,
                    "identifier": identifier,
                    "name": "",
                    "password_hash": password_hash,
                    "role": role,
                }
            )
            .execute()
            .data[0]
        )
        created["name"] = _display_name(created)
        return created

    async def list_users(self, org_id: str) -> list[dict[str, Any]]:
        rows = await asyncio.to_thread(
            lambda: self.client.table("clinic_users")
            .select("id, org_id, identifier, name, role, created_at")
            .eq("org_id", org_id)
            .order("created_at", desc=False)
            .execute()
            .data
        )
        return [{**row, "name": _display_name(row)} for row in rows]

    async def count_users(self) -> int:
        def _count() -> int:
            rows = self.client.table("clinic_users").select("id", count="exact").execute()
            return rows.count or 0

        return await asyncio.to_thread(_count)

    async def list_catalog_items(self, org_id: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(
            lambda: self.client.table("catalog_items")
            .select("*")
            .eq("org_id", org_id)
            .order("item_type", desc=False)
            .order("name", desc=False)
            .execute()
            .data
        )

    async def create_catalog_item(self, org_id: str, payload: CatalogItemCreate) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("catalog_items")
            .insert({"org_id": org_id, **payload.model_dump()})
            .execute()
            .data[0]
        )

    async def update_catalog_stock(
        self,
        org_id: str,
        item_id: str,
        payload: CatalogStockUpdate,
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            if payload.delta == 0:
                raise ValueError("Stock adjustment must be non-zero.")
            item = (
                self.client.table("catalog_items")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", item_id)
                .single()
                .execute()
                .data
            )
            next_quantity = float(item.get("stock_quantity", 0)) + payload.delta
            if next_quantity < 0:
                raise ValueError("Stock cannot go below zero.")
            return (
                self.client.table("catalog_items")
                .update({"stock_quantity": next_quantity})
                .eq("org_id", org_id)
                .eq("id", item_id)
                .execute()
                .data[0]
            )

        return await asyncio.to_thread(_update)

    async def delete_catalog_item(self, org_id: str, item_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.client.table("catalog_items")
            .delete()
            .eq("org_id", org_id)
            .eq("id", item_id)
            .execute()
        )

    async def create_invoice(self, org_id: str, payload: InvoiceCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            result = (
                self.client.rpc(
                    "create_invoice_atomic",
                    {
                        "p_org_id": org_id,
                        "p_patient_id": str(payload.patient_id),
                        "p_payment_status": payload.payment_status,
                        "p_items": [
                            {
                                "catalog_item_id": str(item.catalog_item_id) if item.catalog_item_id else None,
                                "item_type": item.item_type,
                                "label": item.label,
                                "quantity": item.quantity,
                                "unit_price": item.unit_price,
                            }
                            for item in payload.items
                        ],
                    },
                )
                .execute()
                .data
            )
            invoice = _rpc_single(result)
            if not invoice:
                raise ValueError("Failed to create invoice.")
            return invoice

        return await asyncio.to_thread(_create)

    async def finalize_invoice(self, org_id: str, invoice_id: str) -> str:
        def _finalize() -> str:
            result = (
                self.client.rpc(
                    "finalize_invoice_atomic",
                    {
                        "p_org_id": org_id,
                        "p_invoice_id": invoice_id,
                    },
                )
                .execute()
                .data
            )
            patient_id = result[0] if isinstance(result, list) and result else result
            if not patient_id:
                raise ValueError("Failed to finalize invoice.")
            return str(patient_id)

        return await asyncio.to_thread(_finalize)

    async def get_invoice(self, org_id: str, invoice_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            invoice = (
                self.client.table("invoices")
                .select("*")
                .eq("org_id", org_id)
                .eq("id", invoice_id)
                .single()
                .execute()
                .data
            )
            items = (
                self.client.table("invoice_items")
                .select("*")
                .eq("invoice_id", invoice_id)
                .order("created_at", desc=False)
                .execute()
                .data
            )
            invoice["items"] = items
            return invoice

        return await asyncio.to_thread(_get)

    async def list_invoices(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            invoices = (
                self.client.table("invoices")
                .select("*")
                .eq("org_id", org_id)
                .order("created_at", desc=True)
                .execute()
                .data
            )
            for invoice in invoices:
                invoice["items"] = (
                    self.client.table("invoice_items")
                    .select("*")
                    .eq("invoice_id", invoice["id"])
                    .order("created_at", desc=False)
                    .execute()
                    .data
                )
            return invoices

        return await asyncio.to_thread(_list)

    async def list_invoices_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            invoices = (
                self.client.table("invoices")
                .select("*")
                .eq("org_id", org_id)
                .eq("patient_id", patient_id)
                .order("created_at", desc=True)
                .execute()
                .data
            )
            for invoice in invoices:
                invoice["items"] = (
                    self.client.table("invoice_items")
                    .select("*")
                    .eq("invoice_id", invoice["id"])
                    .order("created_at", desc=False)
                    .execute()
                    .data
                )
            return invoices

        return await asyncio.to_thread(_list)


@lru_cache
def get_repository() -> SupabaseRepository:
    return SupabaseRepository()
