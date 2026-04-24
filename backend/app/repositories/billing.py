from __future__ import annotations

import asyncio
from typing import Any

from app.repositories.base import (
    BaseSupabaseRepository,
    attach_invoice_balances,
    normalize_invoice_amount_paid,
    round_money,
    rpc_single,
)
from app.schemas import CatalogItemCreate, CatalogStockUpdate, InvoiceCreate


class BillingRepositoryMixin(BaseSupabaseRepository):
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

    async def get_catalog_item(self, org_id: str, item_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            lambda: self.client.table("catalog_items").select("*").eq("org_id", org_id).eq("id", item_id).single().execute().data
        )

    async def update_catalog_stock(self, org_id: str, item_id: str, payload: CatalogStockUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            if payload.delta == 0:
                raise ValueError("Stock adjustment must be non-zero.")
            item = self.client.table("catalog_items").select("*").eq("org_id", org_id).eq("id", item_id).single().execute().data
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
            lambda: self.client.table("catalog_items").delete().eq("org_id", org_id).eq("id", item_id).execute()
        )

    async def create_invoice(self, org_id: str, payload: InvoiceCreate) -> dict[str, Any]:
        def _create() -> dict[str, Any]:
            invoice_total = round_money(sum(item.quantity * item.unit_price for item in payload.items))
            normalized_amount_paid = normalize_invoice_amount_paid(payload.payment_status, payload.amount_paid, invoice_total)
            result = (
                self.client.rpc(
                    "create_invoice_atomic",
                    {
                        "p_org_id": org_id,
                        "p_patient_id": str(payload.patient_id),
                        "p_payment_status": payload.payment_status,
                        "p_amount_paid": normalized_amount_paid,
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
            invoice = rpc_single(result)
            if not invoice:
                raise ValueError("Failed to create invoice.")
            return attach_invoice_balances(invoice)

        return await asyncio.to_thread(_create)

    async def finalize_invoice(self, org_id: str, invoice_id: str, *, completed_by: str) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            result = (
                self.client.rpc(
                    "finalize_invoice_atomic",
                    {
                        "p_org_id": org_id,
                        "p_invoice_id": invoice_id,
                        "p_completed_by": completed_by,
                    },
                )
                .execute()
                .data
            )
            finalized = rpc_single(result)
            if not finalized:
                raise ValueError("Failed to finalize invoice.")
            return finalized

        return await asyncio.to_thread(_finalize)

    async def get_invoice(self, org_id: str, invoice_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            invoice = self.client.table("invoices").select("*").eq("org_id", org_id).eq("id", invoice_id).single().execute().data
            items = (
                self.client.table("invoice_items").select("*").eq("invoice_id", invoice_id).order("created_at", desc=False).execute().data
            )
            invoice["items"] = items
            return attach_invoice_balances(invoice)

        return await asyncio.to_thread(_get)

    async def list_invoices(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            invoices = self.client.table("invoices").select("*").eq("org_id", org_id).order("created_at", desc=True).execute().data
            for invoice in invoices:
                invoice["items"] = (
                    self.client.table("invoice_items").select("*").eq("invoice_id", invoice["id"]).order("created_at", desc=False).execute().data
                )
            return [attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)

    async def list_invoices_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            invoices = (
                self.client.table("invoices").select("*").eq("org_id", org_id).eq("patient_id", patient_id).order("created_at", desc=True).execute().data
            )
            for invoice in invoices:
                invoice["items"] = (
                    self.client.table("invoice_items").select("*").eq("invoice_id", invoice["id"]).order("created_at", desc=False).execute().data
                )
            return [attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)
