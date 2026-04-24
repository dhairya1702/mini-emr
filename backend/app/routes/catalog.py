from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_admin
from app.db import SupabaseRepository, get_repository
from app.schemas import CatalogItemCreate, CatalogItemOut, CatalogStockUpdate, UserOut
from app.services.catalog_workflow import (
    create_catalog_item_workflow,
    delete_catalog_item_workflow,
    update_catalog_stock_workflow,
)


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
    try:
        return await create_catalog_item_workflow(repo, current_user, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/catalog/{item_id}/stock", response_model=CatalogItemOut)
async def update_catalog_stock(
    item_id: str,
    payload: CatalogStockUpdate,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> CatalogItemOut:
    try:
        return await update_catalog_stock_workflow(repo, current_user, item_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/catalog/{item_id}", status_code=204)
async def delete_catalog_item(
    item_id: str,
    current_user: UserOut = Depends(require_admin),
    repo: SupabaseRepository = Depends(get_repository),
) -> None:
    try:
        await delete_catalog_item_workflow(repo, current_user, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
