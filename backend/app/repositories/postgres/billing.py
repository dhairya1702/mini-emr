from __future__ import annotations

import asyncio
import json
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.base import attach_invoice_balances, normalize_invoice_amount_paid, round_money
from app.repositories.postgres.ai_usage import _row_to_dict
from app.schema_domains.billing import CatalogItemCreate, CatalogStockUpdate, InvoiceCreate


CATALOG_ITEM_COLUMNS = [
    "id",
    "org_id",
    "name",
    "item_type",
    "default_price",
    "track_inventory",
    "stock_quantity",
    "low_stock_threshold",
    "unit",
    "created_at",
]

INVOICE_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "subtotal",
    "total",
    "payment_status",
    "amount_paid",
    "paid_at",
    "completed_at",
    "completed_by",
    "sent_at",
    "created_at",
]

INVOICE_ITEM_COLUMNS = [
    "id",
    "invoice_id",
    "catalog_item_id",
    "item_type",
    "label",
    "quantity",
    "unit_price",
    "line_total",
    "created_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


def _json_payload(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


class PostgresBillingRepository:
    def __init__(self, connection_manager: PostgresConnectionManager) -> None:
        self.connection_manager = connection_manager

    async def list_catalog_items(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        from public.catalog_items
                        where org_id = %s
                        order by item_type asc, name asc
                        """,
                        (org_id,),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def create_catalog_item(self, org_id: str, payload: CatalogItemCreate) -> dict[str, Any]:
        values = payload.model_dump()

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.catalog_items (
                          org_id, name, item_type, default_price, track_inventory,
                          stock_quantity, low_stock_threshold, unit
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s)
                        returning {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        """,
                        (
                            org_id,
                            values["name"],
                            values["item_type"],
                            values["default_price"],
                            values["track_inventory"],
                            values["stock_quantity"],
                            values["low_stock_threshold"],
                            values["unit"],
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Failed to create catalog item.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_create)

    async def get_catalog_item(self, org_id: str, item_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        from public.catalog_items
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, item_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Catalog item not found for this organization.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_get)

    async def update_catalog_stock(self, org_id: str, item_id: str, payload: CatalogStockUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            if payload.delta == 0:
                raise ValueError("Stock adjustment must be non-zero.")
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        from public.catalog_items
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, item_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Catalog item not found for this organization.")
                    item = _row_to_dict(row, cursor)
                    next_quantity = float(item.get("stock_quantity", 0)) + payload.delta
                    if next_quantity < 0:
                        raise ValueError("Stock cannot go below zero.")
                    cursor.execute(
                        f"""
                        update public.catalog_items
                        set stock_quantity = %s
                        where org_id = %s and id = %s
                        returning {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        """,
                        (next_quantity, org_id, item_id),
                    )
                    updated = cursor.fetchone()
                    if not updated:
                        raise ValueError("Failed to update catalog stock.")
                    return _row_to_dict(updated, cursor)

        return await asyncio.to_thread(_update)

    async def delete_catalog_item(self, org_id: str, item_id: str) -> None:
        def _delete() -> None:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("delete from public.catalog_items where org_id = %s and id = %s", (org_id, item_id))

        await asyncio.to_thread(_delete)

    async def create_invoice(self, org_id: str, payload: InvoiceCreate) -> dict[str, Any]:
        invoice_total = round_money(sum(item.quantity * item.unit_price for item in payload.items))
        normalized_amount_paid = normalize_invoice_amount_paid(
            payload.payment_status,
            payload.amount_paid,
            invoice_total,
        )
        item_payload = [
            {
                "catalog_item_id": str(item.catalog_item_id) if item.catalog_item_id else None,
                "item_type": item.item_type,
                "label": item.label,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
            }
            for item in payload.items
        ]

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select public.create_invoice_atomic(%s, %s, %s, %s, %s::jsonb)",
                        (
                            org_id,
                            str(payload.patient_id),
                            payload.payment_status,
                            normalized_amount_paid,
                            json.dumps(item_payload),
                        ),
                    )
                    row = cursor.fetchone()
                    invoice = _json_payload(row[0] if row else None)
                    if not invoice:
                        raise ValueError("Failed to create invoice.")
                    return attach_invoice_balances(invoice)

        return await asyncio.to_thread(_create)

    async def finalize_invoice(self, org_id: str, invoice_id: str, *, completed_by: str) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select public.finalize_invoice_atomic(%s, %s, %s)",
                        (org_id, invoice_id, completed_by),
                    )
                    row = cursor.fetchone()
                    finalized = _json_payload(row[0] if row else None)
                    if not finalized:
                        raise ValueError("Failed to finalize invoice.")
                    return finalized

        return await asyncio.to_thread(_finalize)

    async def get_invoice(self, org_id: str, invoice_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_COLUMNS)}
                        from public.invoices
                        where org_id = %s and id = %s
                        limit 1
                        """,
                        (org_id, invoice_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Invoice not found for this organization.")
                    invoice = _row_to_dict(row, cursor)
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_ITEM_COLUMNS)}
                        from public.invoice_items
                        where invoice_id = %s
                        order by created_at asc
                        """,
                        (invoice_id,),
                    )
                    invoice["items"] = [_row_to_dict(item, cursor) for item in cursor.fetchall()]
                    return attach_invoice_balances(invoice)

        return await asyncio.to_thread(_get)

    async def list_invoices(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("select public.list_invoices_with_details(%s)", (org_id,))
                    row = cursor.fetchone()
                    invoices = _json_payload(row[0] if row else []) or []
                    return [attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)

    async def list_invoices_for_patient(self, org_id: str, patient_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_COLUMNS)}
                        from public.invoices
                        where org_id = %s and patient_id = %s
                        order by created_at desc
                        """,
                        (org_id, patient_id),
                    )
                    invoices = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    invoice_ids = [str(invoice["id"]) for invoice in invoices]
                    items_by_invoice_id: dict[str, list[dict[str, Any]]] = {
                        invoice_id: [] for invoice_id in invoice_ids
                    }
                    if invoice_ids:
                        cursor.execute(
                            f"""
                            select {_columns_sql(INVOICE_ITEM_COLUMNS)}
                            from public.invoice_items
                            where invoice_id = any(%s::uuid[])
                            order by created_at asc
                            """,
                            (invoice_ids,),
                        )
                        for item_row in cursor.fetchall():
                            item = _row_to_dict(item_row, cursor)
                            items_by_invoice_id.setdefault(str(item["invoice_id"]), []).append(item)
                    for invoice in invoices:
                        invoice["items"] = items_by_invoice_id.get(str(invoice["id"]), [])
                    return [attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)
