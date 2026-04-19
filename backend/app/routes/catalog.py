from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import CatalogItemCreate, CatalogItemOut, CatalogStockUpdate, UserOut
from app.services.audit_service import write_audit_event


router = APIRouter()


@router.get("/catalog", response_model=list[CatalogItemOut])
async def list_catalog(
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> list[CatalogItemOut]:
    items = await repo.list_catalog_items(str(current_user.org_id))
    return [CatalogItemOut(**item) for item in items]


@router.post("/catalog", response_model=CatalogItemOut, status_code=201)
async def create_catalog_item(
    payload: CatalogItemCreate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> CatalogItemOut:
    created = await repo.create_catalog_item(str(current_user.org_id), payload)
    return CatalogItemOut(**created)


@router.patch("/catalog/{item_id}/stock", response_model=CatalogItemOut)
async def update_catalog_stock(
    item_id: str,
    payload: CatalogStockUpdate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> CatalogItemOut:
    try:
        updated = await repo.update_catalog_stock(str(current_user.org_id), item_id, payload)
        await write_audit_event(
            repo,
            current_user,
            entity_type="catalog_item",
            entity_id=item_id,
            action="catalog_stock_adjusted",
            summary=f"Adjusted stock for {updated['name']} by {payload.delta:g}.",
            metadata={
                "catalog_item_id": item_id,
                "item_name": updated.get("name"),
                "delta": payload.delta,
                "stock_quantity": updated.get("stock_quantity"),
                "adjustment_source": "manual",
            },
        )
        return CatalogItemOut(**updated)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/catalog/{item_id}", status_code=204)
async def delete_catalog_item(
    item_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    await repo.delete_catalog_item(str(current_user.org_id), item_id)
