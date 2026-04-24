from app.db import SupabaseRepository
from app.schemas import CatalogItemCreate, CatalogItemOut, CatalogStockUpdate, UserOut
from app.services.audit_service import (
    record_catalog_item_created,
    record_catalog_item_deleted,
    record_catalog_stock_adjusted,
)


async def create_catalog_item_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    payload: CatalogItemCreate,
) -> CatalogItemOut:
    created = await repo.create_catalog_item(str(current_user.org_id), payload)
    await record_catalog_item_created(repo, current_user, created)
    return CatalogItemOut(**created)


async def update_catalog_stock_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    item_id: str,
    payload: CatalogStockUpdate,
) -> CatalogItemOut:
    updated = await repo.update_catalog_stock(str(current_user.org_id), item_id, payload)
    await record_catalog_stock_adjusted(repo, current_user, updated, delta=payload.delta)
    return CatalogItemOut(**updated)


async def delete_catalog_item_workflow(
    repo: SupabaseRepository,
    current_user: UserOut,
    item_id: str,
) -> None:
    existing = await repo.get_catalog_item(str(current_user.org_id), item_id)
    await repo.delete_catalog_item(str(current_user.org_id), item_id)
    await record_catalog_item_deleted(repo, current_user, existing)
