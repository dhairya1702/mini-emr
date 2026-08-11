from app.db import AppRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.billing import CatalogItemCreate, CatalogItemOut, CatalogItemUpdate, CatalogStockUpdate
from app.services.audit_service import (
    record_catalog_item_created,
    record_catalog_item_deleted,
    record_catalog_item_updated,
    record_catalog_stock_adjusted,
)


async def create_catalog_item_workflow(
    repo: AppRepository,
    current_user: UserOut,
    payload: CatalogItemCreate,
) -> CatalogItemOut:
    if (
        payload.item_type == "program"
        or payload.program_key is not None
        or payload.program_definition is not None
    ):
        raise ValueError("Configure care programs from the Care Programs page.")
    created = await repo.create_catalog_item(str(current_user.org_id), payload)
    await record_catalog_item_created(repo, current_user, created)
    return CatalogItemOut(**created)


async def update_catalog_stock_workflow(
    repo: AppRepository,
    current_user: UserOut,
    item_id: str,
    payload: CatalogStockUpdate,
) -> CatalogItemOut:
    updated = await repo.update_catalog_stock(str(current_user.org_id), item_id, payload)
    await record_catalog_stock_adjusted(repo, current_user, updated, delta=payload.delta)
    return CatalogItemOut(**updated)


async def update_catalog_item_workflow(
    repo: AppRepository,
    current_user: UserOut,
    item_id: str,
    payload: CatalogItemUpdate,
) -> CatalogItemOut:
    existing = dict(await repo.get_catalog_item(str(current_user.org_id), item_id))
    existing_type = str(existing.get("item_type") or "")
    if existing_type == "program" and payload.item_type != "program":
        raise ValueError("Change the program type from the Care Programs page.")
    if existing_type != "program" and payload.item_type == "program":
        raise ValueError("Configure care programs from the Care Programs page.")
    if payload.item_type == "program" and payload.track_inventory:
        raise ValueError("Care programs cannot track stock.")
    updated = await repo.update_catalog_item(str(current_user.org_id), item_id, payload)
    editable_fields = [
        "name", "item_type", "default_price", "track_inventory",
        "low_stock_threshold", "unit", "hsn_sac_code", "gst_rate", "aliases",
    ]
    changed_fields = [field for field in editable_fields if existing.get(field) != updated.get(field)]
    if changed_fields:
        await record_catalog_item_updated(repo, current_user, updated, changed_fields=changed_fields)
    return CatalogItemOut(**updated)


async def delete_catalog_item_workflow(
    repo: AppRepository,
    current_user: UserOut,
    item_id: str,
) -> None:
    existing = await repo.get_catalog_item(str(current_user.org_id), item_id)
    await repo.delete_catalog_item(str(current_user.org_id), item_id)
    await record_catalog_item_deleted(repo, current_user, existing)
