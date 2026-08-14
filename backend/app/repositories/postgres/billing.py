from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.postgres import PostgresConnectionManager
from app.repositories.base import (
    attach_invoice_balances,
    decimal_money,
    decimal_quantity,
    normalize_invoice_amount_paid,
    round_money,
)
from app.repositories.postgres.ai_usage import _row_to_dict
from app.repositories.postgres.audit import AuditEventFactory, insert_audit_events
from app.repositories.postgres.care_programs import (
    activate_pending_program_enrollments,
    provision_program_enrollments_for_invoice,
)
from app.schema_domains.billing import CatalogItemCreate, CatalogItemUpdate, CatalogStockUpdate, InvoiceCreate


CATALOG_ITEM_COLUMNS = [
    "id",
    "org_id",
    "name",
    "item_type",
    "description",
    "program_key",
    "program_definition",
    "is_active",
    "default_price",
    "track_inventory",
    "stock_quantity",
    "low_stock_threshold",
    "unit",
    "hsn_sac_code",
    "gst_rate",
    "aliases",
    "created_at",
]

INVOICE_COLUMNS = [
    "id",
    "org_id",
    "patient_id",
    "visit_id",
    "subtotal",
    "tax_total",
    "cgst_total",
    "sgst_total",
    "total",
    "supplier_gstin",
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
    "org_id",
    "invoice_id",
    "catalog_item_id",
    "item_type",
    "label",
    "quantity",
    "unit_price",
    "line_total",
    "hsn_sac_code",
    "gst_rate",
    "taxable_value",
    "tax_amount",
    "cgst_amount",
    "sgst_amount",
    "created_at",
]


def _columns_sql(columns: list[str]) -> str:
    return ", ".join(columns)


def _json_payload(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def _invoice_item_payload(payload: InvoiceCreate) -> list[dict[str, Any]]:
    return [
        {
            "catalog_item_id": str(item.catalog_item_id) if item.catalog_item_id else None,
            "item_type": item.item_type,
            "label": item.label,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "line_total": decimal_money(
                decimal_quantity(item.quantity) * decimal_money(item.unit_price)
            ),
            "hsn_sac_code": "",
            "gst_rate": None,
            "taxable_value": decimal_money(0),
            "tax_amount": decimal_money(0),
            "cgst_amount": decimal_money(0),
            "sgst_amount": decimal_money(0),
        }
        for item in payload.items
    ]


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

    async def list_active_medicines(self, org_id: str) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select id, name, unit, default_price, track_inventory, stock_quantity
                        from public.catalog_items
                        where org_id = %s and item_type = 'medicine' and is_active = true
                        order by name asc
                        """,
                        (org_id,),
                    )
                    columns = ["id", "name", "unit", "default_price", "track_inventory", "stock_quantity"]
                    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def create_catalog_item(self, org_id: str, payload: CatalogItemCreate) -> dict[str, Any]:
        values = payload.model_dump()

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        insert into public.catalog_items (
                          org_id, name, item_type, description, program_key, program_definition, is_active,
                          default_price, track_inventory,
                          stock_quantity, low_stock_threshold, unit, hsn_sac_code, gst_rate
                          , aliases
                        )
                        values (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                        returning {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        """,
                        (
                            org_id,
                            values["name"],
                            values["item_type"],
                            values["description"],
                            values["program_key"],
                            json.dumps(values["program_definition"]) if values["program_definition"] is not None else None,
                            values["is_active"],
                            values["default_price"],
                            values["track_inventory"],
                            values["stock_quantity"],
                            values["low_stock_threshold"],
                            values["unit"],
                            values["hsn_sac_code"],
                            values["gst_rate"],
                            json.dumps(values["aliases"]),
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

    async def update_catalog_item(self, org_id: str, item_id: str, payload: CatalogItemUpdate) -> dict[str, Any]:
        values = payload.model_dump()
        values["name"] = values["name"].strip()
        values["unit"] = values["unit"].strip()

        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.catalog_items
                        set name = %s, item_type = %s, default_price = %s,
                          track_inventory = %s, low_stock_threshold = %s,
                          unit = %s, hsn_sac_code = %s, gst_rate = %s,
                          aliases = %s::jsonb
                        where org_id = %s and id = %s
                        returning {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        """,
                        (
                            values["name"], values["item_type"], values["default_price"],
                            values["track_inventory"], values["low_stock_threshold"],
                            values["unit"], values["hsn_sac_code"], values["gst_rate"],
                            json.dumps(values["aliases"]), org_id, item_id,
                        ),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Catalog item not found for this organization.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_update)

    async def update_catalog_stock(self, org_id: str, item_id: str, payload: CatalogStockUpdate) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            normalized_delta = decimal_quantity(payload.delta)
            if normalized_delta == 0:
                raise ValueError("Stock adjustment must be non-zero.")
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(CATALOG_ITEM_COLUMNS)}
                        from public.catalog_items
                        where org_id = %s and id = %s
                        limit 1
                        for update
                        """,
                        (org_id, item_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Catalog item not found for this organization.")
                    item = _row_to_dict(row, cursor)
                    next_quantity = decimal_quantity(item.get("stock_quantity", 0)) + normalized_delta
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
                    cursor.execute(
                        """
                        update public.invoice_items
                        set catalog_item_id = null
                        where org_id = %s and catalog_item_id = %s
                        """,
                        (org_id, item_id),
                    )
                    cursor.execute("delete from public.catalog_items where org_id = %s and id = %s", (org_id, item_id))

        await asyncio.to_thread(_delete)

    async def create_invoice(
        self,
        org_id: str,
        payload: InvoiceCreate,
        *,
        audit_event_factory: AuditEventFactory | None = None,
    ) -> dict[str, Any]:
        item_payload = _invoice_item_payload(payload)
        should_mark_paid = payload.payment_status == "paid"

        def _create() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "select id, current_visit_id from public.patients where org_id = %s and id = %s limit 1",
                        (org_id, str(payload.patient_id)),
                    )
                    patient_row = cursor.fetchone()
                    if not patient_row:
                        raise ValueError("Patient not found for this organization.")
                    current_visit_id = str(patient_row[1]) if patient_row[1] else None

                    if any(
                        item["item_type"] == "program" and not item["catalog_item_id"]
                        for item in item_payload
                    ):
                        raise ValueError("Care programs must be selected from the clinic catalog.")
                    catalog_item_ids = [item["catalog_item_id"] for item in item_payload if item["catalog_item_id"]]
                    if catalog_item_ids:
                        cursor.execute(
                            f"""
                            select id, item_type, is_active, program_key, hsn_sac_code, gst_rate
                            from public.catalog_items
                            where org_id = %s and id = any(%s::uuid[])
                            """,
                            (org_id, catalog_item_ids),
                        )
                        catalog_rows = cursor.fetchall()
                        found_ids = {str(row[0]) for row in catalog_rows}
                        if len(found_ids) != len(set(catalog_item_ids)):
                            raise ValueError("Inventory item not found for this organization.")
                        catalog_by_id = {str(row[0]): row for row in catalog_rows}
                        seen_program_keys: set[str] = set()
                        for item in item_payload:
                            if not item["catalog_item_id"]:
                                if item["item_type"] == "program":
                                    raise ValueError("Care programs must be selected from the clinic catalog.")
                                continue
                            catalog_row = catalog_by_id[item["catalog_item_id"]]
                            if item["item_type"] != str(catalog_row[1]):
                                raise ValueError("Invoice item type does not match its catalog item.")
                            if item["item_type"] == "program":
                                if not catalog_row[2]:
                                    raise ValueError("Care program is not active for this clinic.")
                                if decimal_quantity(item["quantity"]) != Decimal("1.000"):
                                    raise ValueError("Care programs must use quantity one.")
                                program_key = str(catalog_row[3] or "")
                                if program_key in seen_program_keys:
                                    raise ValueError("A care program can only appear once on an invoice.")
                                seen_program_keys.add(program_key)
                                cursor.execute(
                                    """
                                    select 1
                                    from public.patient_program_enrollments e
                                    join public.catalog_items c on c.id = e.catalog_item_id
                                    where e.org_id = %s and e.patient_id = %s
                                      and c.program_key = %s and e.status in ('pending', 'active')
                                    limit 1
                                    """,
                                    (org_id, str(payload.patient_id), program_key),
                                )
                                if cursor.fetchone():
                                    raise ValueError("Patient already has a current enrollment in this care program.")

                            hsn_sac_code = str(catalog_row[4] or "").strip()
                            gst_rate = (
                                Decimal(str(catalog_row[5]))
                                if catalog_row[5] is not None
                                else None
                            )
                            if hsn_sac_code and gst_rate is not None:
                                tax_amount = decimal_money(
                                    item["line_total"] * gst_rate / Decimal("100")
                                )
                                cgst_amount = decimal_money(tax_amount / Decimal("2"))
                                item.update(
                                    {
                                        "hsn_sac_code": hsn_sac_code,
                                        "gst_rate": gst_rate,
                                        "taxable_value": item["line_total"],
                                        "tax_amount": tax_amount,
                                        "cgst_amount": cgst_amount,
                                        "sgst_amount": decimal_money(tax_amount - cgst_amount),
                                    }
                                )

                    invoice_subtotal = decimal_money(
                        sum(
                            (item["line_total"] for item in item_payload),
                            start=decimal_money(0),
                        )
                    )
                    tax_total = decimal_money(
                        sum(
                            (item["tax_amount"] for item in item_payload),
                            start=decimal_money(0),
                        )
                    )
                    cgst_total = decimal_money(
                        sum(
                            (item["cgst_amount"] for item in item_payload),
                            start=decimal_money(0),
                        )
                    )
                    sgst_total = decimal_money(tax_total - cgst_total)
                    invoice_total = decimal_money(invoice_subtotal + tax_total)
                    normalized_amount_paid = normalize_invoice_amount_paid(
                        payload.payment_status,
                        payload.amount_paid,
                        invoice_total,
                    )
                    cursor.execute(
                        "select gstin from public.clinic_settings where org_id = %s limit 1",
                        (org_id,),
                    )
                    clinic_tax_row = cursor.fetchone()
                    supplier_gstin = str(clinic_tax_row[0] or "").strip() if clinic_tax_row else ""

                    invoice_id = str(payload.invoice_id) if payload.invoice_id else None
                    if invoice_id:
                        cursor.execute(
                            f"""
                            select {_columns_sql(INVOICE_COLUMNS)}
                            from public.invoices
                            where org_id = %s and id = %s and patient_id = %s and completed_at is null
                            limit 1
                            for update
                            """,
                            (org_id, invoice_id, str(payload.patient_id)),
                        )
                        existing_row = cursor.fetchone()
                        if not existing_row:
                            raise ValueError("Draft invoice not found for this patient.")
                        cursor.execute(
                            f"""
                            update public.invoices
                            set
                              visit_id = coalesce(visit_id, %s),
                              subtotal = %s,
                              tax_total = %s,
                              cgst_total = %s,
                              sgst_total = %s,
                              total = %s,
                              supplier_gstin = %s,
                              payment_status = %s,
                              amount_paid = %s,
                              paid_at = %s
                            where org_id = %s and id = %s
                            returning {_columns_sql(INVOICE_COLUMNS)}
                            """,
                            (
                                current_visit_id,
                                invoice_subtotal,
                                tax_total,
                                cgst_total,
                                sgst_total,
                                invoice_total,
                                supplier_gstin,
                                payload.payment_status,
                                normalized_amount_paid,
                                None,
                                org_id,
                                invoice_id,
                            ),
                        )
                    else:
                        cursor.execute(
                            f"""
                            insert into public.invoices (
                              org_id, patient_id, visit_id, subtotal, tax_total, cgst_total, sgst_total,
                              total, supplier_gstin, payment_status, amount_paid, paid_at
                            )
                            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            returning {_columns_sql(INVOICE_COLUMNS)}
                            """,
                            (
                                org_id,
                                str(payload.patient_id),
                                current_visit_id,
                                invoice_subtotal,
                                tax_total,
                                cgst_total,
                                sgst_total,
                                invoice_total,
                                supplier_gstin,
                                payload.payment_status,
                                normalized_amount_paid,
                                None,
                            ),
                        )
                    invoice_row = cursor.fetchone()
                    if not invoice_row:
                        raise ValueError("Failed to save invoice.")
                    invoice = _row_to_dict(invoice_row, cursor)
                    invoice_id = str(invoice["id"])
                    if should_mark_paid and invoice.get("paid_at") is None:
                        cursor.execute(
                            f"""
                            update public.invoices
                            set paid_at = now()
                            where id = %s
                            returning {_columns_sql(INVOICE_COLUMNS)}
                            """,
                            (invoice_id,),
                        )
                        invoice = _row_to_dict(cursor.fetchone(), cursor)

                    cursor.execute(
                        "delete from public.invoice_items where org_id = %s and invoice_id = %s",
                        (org_id, invoice_id),
                    )
                    for item in item_payload:
                        cursor.execute(
                            f"""
                            insert into public.invoice_items (
                              org_id, invoice_id, catalog_item_id, item_type, label, quantity, unit_price,
                              line_total, hsn_sac_code, gst_rate, taxable_value, tax_amount, cgst_amount, sgst_amount
                            )
                            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            returning {_columns_sql(INVOICE_ITEM_COLUMNS)}
                            """,
                            (
                                org_id,
                                invoice_id,
                                item["catalog_item_id"],
                                item["item_type"],
                                item["label"],
                                item["quantity"],
                                item["unit_price"],
                                item["line_total"],
                                item["hsn_sac_code"],
                                item["gst_rate"],
                                item["taxable_value"],
                                item["tax_amount"],
                                item["cgst_amount"],
                                item["sgst_amount"],
                            ),
                        )
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_ITEM_COLUMNS)}
                        from public.invoice_items
                        where org_id = %s and invoice_id = %s
                        order by created_at asc
                        """,
                        (org_id, invoice_id),
                    )
                    invoice["items"] = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    result = attach_invoice_balances(invoice)
                    insert_audit_events(cursor, audit_event_factory, result)
                    return result

        return await asyncio.to_thread(_create)

    async def finalize_invoice(
        self,
        org_id: str,
        invoice_id: str,
        *,
        completed_by: str,
        mark_sent: bool = False,
        audit_event_factory: AuditEventFactory | None = None,
    ) -> dict[str, Any]:
        def _finalize() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_COLUMNS)}
                        from public.invoices
                        where org_id = %s and id = %s
                        limit 1
                        for update
                        """,
                        (org_id, invoice_id),
                    )
                    invoice_row = cursor.fetchone()
                    if not invoice_row:
                        raise ValueError("Invoice not found for this organization.")
                    invoice = _row_to_dict(invoice_row, cursor)

                    cursor.execute(
                        "select id from public.patients where org_id = %s and id = %s limit 1 for update",
                        (org_id, str(invoice["patient_id"])),
                    )
                    if not cursor.fetchone():
                        raise ValueError("Patient not found for this organization.")

                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_ITEM_COLUMNS)}
                        from public.invoice_items
                        where org_id = %s and invoice_id = %s
                        order by created_at asc
                        """,
                        (org_id, invoice_id),
                    )
                    items = [_row_to_dict(row, cursor) for row in cursor.fetchall()]

                    already_completed = invoice.get("completed_at") is not None
                    already_sent = invoice.get("sent_at") is not None
                    stock_deductions: list[dict[str, Any]] = []

                    if not already_completed:
                        required_by_item: dict[str, Decimal] = {}
                        for item in items:
                            catalog_item_id = item.get("catalog_item_id")
                            if not catalog_item_id:
                                continue
                            required_by_item[str(catalog_item_id)] = (
                                required_by_item.get(str(catalog_item_id), 0)
                                + decimal_quantity(item.get("quantity"))
                            )

                        if required_by_item:
                            cursor.execute(
                                """
                                select id, name, stock_quantity, track_inventory
                                from public.catalog_items
                                where org_id = %s and id = any(%s::uuid[])
                                for update
                                """,
                                (org_id, list(required_by_item.keys())),
                            )
                            catalog_rows = {str(row[0]): row for row in cursor.fetchall()}
                            if len(catalog_rows) != len(required_by_item):
                                raise ValueError("Inventory item not found for this organization.")
                            for catalog_item_id, quantity in required_by_item.items():
                                row = catalog_rows[catalog_item_id]
                                if not row[3]:
                                    continue
                                if decimal_quantity(row[2]) < quantity:
                                    raise ValueError(f"Insufficient stock for {row[1]}.")
                            for catalog_item_id, quantity in required_by_item.items():
                                row = catalog_rows[catalog_item_id]
                                if not row[3]:
                                    continue
                                cursor.execute(
                                    """
                                    update public.catalog_items
                                    set stock_quantity = stock_quantity - %s
                                    where id = %s
                                    """,
                                    (quantity, catalog_item_id),
                                )
                                stock_deductions.append(
                                    {
                                        "catalog_item_id": catalog_item_id,
                                        "item_name": row[1],
                                        "quantity": quantity,
                                    }
                                )

                        cursor.execute(
                            """
                            update public.patients
                            set billed = true
                            where org_id = %s and id = %s
                            """,
                            (org_id, str(invoice["patient_id"])),
                        )
                        cursor.execute(
                            f"""
                            update public.invoices
                            set completed_at = coalesce(completed_at, now()),
                                completed_by = coalesce(completed_by, %s),
                                sent_at = case
                                  when %s and sent_at is null then now()
                                  else sent_at
                                end
                            where org_id = %s and id = %s
                            returning {_columns_sql(INVOICE_COLUMNS)}
                            """,
                            (completed_by, mark_sent, org_id, invoice_id),
                        )
                    elif mark_sent and not already_sent:
                        cursor.execute(
                            f"""
                            update public.invoices
                            set sent_at = now()
                            where org_id = %s and id = %s
                            returning {_columns_sql(INVOICE_COLUMNS)}
                            """,
                            (org_id, invoice_id),
                        )
                    else:
                        cursor.execute(
                            f"""
                            select {_columns_sql(INVOICE_COLUMNS)}
                            from public.invoices
                            where org_id = %s and id = %s
                            limit 1
                            """,
                            (org_id, invoice_id),
                        )
                    updated_row = cursor.fetchone()
                    updated = _row_to_dict(updated_row, cursor) if updated_row else invoice
                    updated["id"] = invoice_id
                    updated["items"] = items
                    program_enrollments = provision_program_enrollments_for_invoice(
                        cursor,
                        org_id=org_id,
                        invoice=updated,
                        items=items,
                        actor_user_id=completed_by,
                    )
                    result = {
                        "patient_id": updated["patient_id"],
                        "completed_at": updated.get("completed_at"),
                        "completed_by": updated.get("completed_by"),
                        "sent_at": updated.get("sent_at"),
                        "already_completed": already_completed,
                        "already_sent": already_sent,
                        "stock_deductions": stock_deductions,
                        "program_enrollments": program_enrollments,
                        "invoice": attach_invoice_balances(updated),
                    }
                    insert_audit_events(cursor, audit_event_factory, result)
                    return result

        return await asyncio.to_thread(_finalize)

    async def update_invoice_payment(
        self,
        org_id: str,
        invoice_id: str,
        *,
        amount_paid: float,
        actor_user_id: str,
        audit_event_factory: AuditEventFactory | None = None,
    ) -> dict[str, Any]:
        def _update() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_COLUMNS)}
                        from public.invoices
                        where org_id = %s and id = %s and completed_at is not null
                        for update
                        """,
                        (org_id, invoice_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Completed invoice not found for this organization.")
                    invoice = _row_to_dict(row, cursor)
                    previous = decimal_money(invoice.get("amount_paid") or 0)
                    requested = decimal_money(amount_paid)
                    total = decimal_money(invoice.get("total") or 0)
                    if requested < previous:
                        raise ValueError("Recorded payment cannot be reduced.")
                    if requested > total:
                        raise ValueError("Recorded payment cannot exceed the invoice total.")
                    payment_status = "paid" if requested == total else "partial"
                    cursor.execute(
                        f"""
                        update public.invoices
                        set amount_paid = %s, payment_status = %s,
                          paid_at = case when %s = 'paid' then coalesce(paid_at, now()) else paid_at end
                        where org_id = %s and id = %s
                        returning {_columns_sql(INVOICE_COLUMNS)}
                        """,
                        (requested, payment_status, payment_status, org_id, invoice_id),
                    )
                    updated = _row_to_dict(cursor.fetchone(), cursor)
                    activated = []
                    if previous == 0 and requested > 0:
                        activated = activate_pending_program_enrollments(
                            cursor,
                            org_id=org_id,
                            invoice_id=invoice_id,
                            actor_user_id=actor_user_id,
                        )
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_ITEM_COLUMNS)}
                        from public.invoice_items where org_id = %s and invoice_id = %s
                        order by created_at
                        """,
                        (org_id, invoice_id),
                    )
                    updated["items"] = [_row_to_dict(item, cursor) for item in cursor.fetchall()]
                    updated["program_enrollments"] = activated
                    updated["previous_amount_paid"] = float(previous)
                    result = attach_invoice_balances(updated)
                    insert_audit_events(cursor, audit_event_factory, result)
                    return result
        return await asyncio.to_thread(_update)

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
                        where org_id = %s and invoice_id = %s
                        order by created_at asc
                        """,
                        (org_id, invoice_id),
                    )
                    invoice["items"] = [_row_to_dict(item, cursor) for item in cursor.fetchall()]
                    return attach_invoice_balances(invoice)

        return await asyncio.to_thread(_get)

    async def mark_invoice_sent(self, org_id: str, invoice_id: str) -> dict[str, Any]:
        def _mark() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"""
                        update public.invoices
                        set sent_at = coalesce(sent_at, now())
                        where org_id = %s and id = %s and completed_at is not null
                        returning {_columns_sql(INVOICE_COLUMNS)}
                        """,
                        (org_id, invoice_id),
                    )
                    row = cursor.fetchone()
                    if not row:
                        raise ValueError("Completed invoice not found for this organization.")
                    return _row_to_dict(row, cursor)

        return await asyncio.to_thread(_mark)

    async def list_invoices(
        self,
        org_id: str,
        limit: int | None = None,
        offset: int = 0,
        cursor_created_at: datetime | None = None,
        cursor_id: str | None = None,
    ) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    clauses = ["org_id = %s"]
                    params: list[Any] = [org_id]
                    cursor_clause = ""
                    pagination_sql = ""
                    if cursor_created_at is not None and cursor_id is not None:
                        cursor_clause = "and (created_at, id) < (%s, %s::uuid)"
                        params.extend([cursor_created_at, cursor_id])
                    if limit is not None:
                        pagination_sql = " limit %s offset %s"
                        params.extend([limit, offset])
                    cursor.execute(
                        f"""
                        select {_columns_sql(INVOICE_COLUMNS)}
                        from public.invoices
                        where {' and '.join(clauses)}
                        {cursor_clause}
                        order by created_at desc, id desc
                        {pagination_sql}
                        """,
                        tuple(params),
                    )
                    invoices = [_row_to_dict(row, cursor) for row in cursor.fetchall()]
                    invoice_ids = [str(invoice["id"]) for invoice in invoices]
                    patient_ids = list({str(invoice["patient_id"]) for invoice in invoices})
                    patient_names: dict[str, str] = {}
                    if patient_ids:
                        cursor.execute(
                            "select id, name from public.patients where org_id = %s and id = any(%s::uuid[])",
                            (org_id, patient_ids),
                        )
                        patient_names = {str(row[0]): str(row[1] or "") for row in cursor.fetchall()}
                    user_ids = list({
                        str(invoice["completed_by"])
                        for invoice in invoices
                        if invoice.get("completed_by")
                    })
                    user_names: dict[str, str] = {}
                    if user_ids:
                        cursor.execute(
                            "select id, name from public.clinic_users where org_id = %s and id = any(%s::uuid[])",
                            (org_id, user_ids),
                        )
                        user_names = {str(row[0]): str(row[1] or "") for row in cursor.fetchall()}
                    items_by_invoice_id: dict[str, list[dict[str, Any]]] = {
                        invoice_id: [] for invoice_id in invoice_ids
                    }
                    if invoice_ids:
                        cursor.execute(
                            f"""
                            select {_columns_sql(INVOICE_ITEM_COLUMNS)}
                            from public.invoice_items
                            where org_id = %s and invoice_id = any(%s::uuid[])
                            order by created_at asc
                            """,
                            (org_id, invoice_ids),
                        )
                        for item_row in cursor.fetchall():
                            item = _row_to_dict(item_row, cursor)
                            items_by_invoice_id.setdefault(str(item["invoice_id"]), []).append(item)
                    for invoice in invoices:
                        invoice["items"] = items_by_invoice_id.get(str(invoice["id"]), [])
                        invoice["patient_name"] = patient_names.get(str(invoice["patient_id"]))
                        invoice["completed_by_name"] = user_names.get(str(invoice.get("completed_by") or ""))
                    return [attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)

    async def iter_invoices_for_export(
        self,
        org_id: str,
        *,
        page_size: int = 500,
    ) -> AsyncIterator[dict[str, Any]]:
        cursor_created_at: datetime | None = None
        cursor_id: str | None = None
        while True:
            page = await self.list_invoices(
                org_id,
                limit=page_size,
                cursor_created_at=cursor_created_at,
                cursor_id=cursor_id,
            )
            if not page:
                return
            for invoice in page:
                yield invoice
            if len(page) < page_size:
                return
            last = page[-1]
            cursor_created_at = last["created_at"]
            cursor_id = str(last["id"])

    async def get_billing_status(self, org_id: str) -> dict[str, Any]:
        def _get() -> dict[str, Any]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          coalesce(revisions.billing_patients_revision, 0)::text,
                          (
                            select count(*)
                            from public.patients
                            where org_id = %s and status = 'done' and billed = false
                          )::integer,
                          coalesce(revisions.billing_invoices_revision, 0)::text
                        from (values (1)) as singleton(value)
                        left join public.dashboard_revisions revisions on revisions.org_id = %s
                        """,
                        (org_id, org_id),
                    )
                    row = cursor.fetchone()
                    return {
                        "billable_patients_revision": str(row[0]),
                        "billable_patient_count": int(row[1]),
                        "invoices_revision": str(row[2]),
                    }

        return await asyncio.to_thread(_get)

    async def list_invoice_summaries(self, org_id: str, limit: int = 5) -> list[dict[str, Any]]:
        def _list() -> list[dict[str, Any]]:
            with self.connection_manager.pool.connection() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select
                          invoice.id,
                          invoice.patient_id,
                          patient.name as patient_name,
                          (
                            select count(*)
                            from public.invoice_items item
                            where item.org_id = invoice.org_id and item.invoice_id = invoice.id
                          )::integer as item_count,
                          invoice.total,
                          invoice.payment_status,
                          invoice.amount_paid,
                          greatest(invoice.total - invoice.amount_paid, 0) as balance_due,
                          invoice.created_at
                        from public.invoices invoice
                        left join public.patients patient
                          on patient.org_id = invoice.org_id and patient.id = invoice.patient_id
                        where invoice.org_id = %s
                        order by invoice.created_at desc
                        limit %s
                        """,
                        (org_id, limit),
                    )
                    return [_row_to_dict(row, cursor) for row in cursor.fetchall()]

        return await asyncio.to_thread(_list)

    async def get_billing_dashboard(self, org_id: str, recent_invoice_limit: int = 5) -> dict[str, Any]:
        # Read the token first. If a mutation commits before the summaries are
        # loaded, the next heartbeat sees the newer token and safely refreshes.
        status = await self.get_billing_status(org_id)
        recent_invoices = await self.list_invoice_summaries(
            org_id,
            limit=recent_invoice_limit,
        )
        return {**status, "recent_invoices": recent_invoices}

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
                            where org_id = %s and invoice_id = any(%s::uuid[])
                            order by created_at asc
                            """,
                            (org_id, invoice_ids),
                        )
                        for item_row in cursor.fetchall():
                            item = _row_to_dict(item_row, cursor)
                            items_by_invoice_id.setdefault(str(item["invoice_id"]), []).append(item)
                    for invoice in invoices:
                        invoice["items"] = items_by_invoice_id.get(str(invoice["id"]), [])
                    return [attach_invoice_balances(invoice) for invoice in invoices]

        return await asyncio.to_thread(_list)
