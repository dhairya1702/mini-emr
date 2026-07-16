from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from typing import Any

from app.db import AppRepository
from app.schema_domains.auth_settings import UserOut
from app.schema_domains.clinical_extractions import (
    BillingSuggestion,
    BillingSuggestionsResponse,
    CatalogSuggestionMatch,
)


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def _aliases(item: dict[str, Any]) -> list[str]:
    value = item.get("aliases") or []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    return [str(alias) for alias in value if str(alias).strip()] if isinstance(value, list) else []


def _is_available(item: dict[str, Any]) -> bool:
    return not bool(item.get("track_inventory")) or float(item.get("stock_quantity") or 0) > 0


def _match_payload(
    item: dict[str, Any],
    *,
    quantity: float,
    match_type: str,
    confidence: float,
) -> CatalogSuggestionMatch:
    return CatalogSuggestionMatch(
        catalog_item_id=item["id"],
        label=str(item["name"]),
        item_type=item["item_type"],
        quantity=quantity,
        unit_price=float(item.get("default_price") or 0),
        match_type=match_type,
        confidence=confidence,
        available=_is_available(item),
    )


def _find_catalog_match(
    name: str,
    items: list[dict[str, Any]],
    *,
    catalog_item_id: str | None = None,
) -> tuple[dict[str, Any] | None, str | None, float]:
    if catalog_item_id:
        direct = next((item for item in items if str(item.get("id")) == catalog_item_id), None)
        if direct:
            return direct, "exact", 1.0
    normalized = _normalize(name)
    if not normalized:
        return None, None, 0
    for item in items:
        if _normalize(str(item.get("name") or "")) == normalized:
            return item, "exact", 1.0
    for item in items:
        if normalized in {_normalize(alias) for alias in _aliases(item)}:
            return item, "alias", 1.0

    ranked = sorted(
        [(
            max(
                [SequenceMatcher(None, normalized, _normalize(str(item.get("name") or ""))).ratio()]
                + [SequenceMatcher(None, normalized, _normalize(alias)).ratio() for alias in _aliases(item)]
            ),
            item,
        ) for item in items],
        key=lambda candidate: candidate[0],
    )
    if not ranked:
        return None, None, 0
    best_score, best_item = ranked[-1]
    runner_up = ranked[-2][0] if len(ranked) > 1 else 0
    if best_score >= 0.88 and best_score - runner_up >= 0.05:
        return best_item, "fuzzy", best_score
    return None, None, best_score


def _numeric_quantity(value: Any, default: float = 1) -> float:
    match = re.search(r"\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return default
    quantity = float(match.group(0))
    return quantity if 0 < quantity <= 10000 else default


async def build_note_billing_suggestions(
    repo: AppRepository,
    current_user: UserOut,
    note_id: str,
) -> BillingSuggestionsResponse:
    org_id = str(current_user.org_id)
    note = await repo.get_note(org_id, note_id)
    catalog = await repo.list_catalog_items(org_id)
    services = [item for item in catalog if item.get("item_type") == "service"]
    medicines = [item for item in catalog if item.get("item_type") == "medicine"]
    extractions = (
        note.get("snapshot_clinical_extractions")
        if note.get("status") in {"final", "sent"} and note.get("snapshot_clinical_extractions")
        else note.get("clinical_extractions")
    ) or {}

    suggestions: list[BillingSuggestion] = []
    consultation = next(
        (
            item
            for item in services
            if _normalize(str(item.get("name") or "")) == "consultation"
            or "consultation" in {_normalize(alias) for alias in _aliases(item)}
        ),
        None,
    )
    suggestions.append(
        BillingSuggestion(
            source="default_consultation",
            extraction_name="Consultation",
            status="auto_add",
            catalog_match=_match_payload(
                consultation, quantity=1, match_type="exact", confidence=1
            ) if consultation else None,
        )
    )

    seen_catalog_ids: set[str] = {str(consultation["id"])} if consultation else set()
    for extracted in extractions.get("services_performed") or []:
        name = str(extracted.get("name") or "").strip()
        item, match_type, confidence = _find_catalog_match(name, services)
        quantity = _numeric_quantity(extracted.get("quantity"))
        match = _match_payload(item, quantity=quantity, match_type=match_type or "exact", confidence=confidence) if item else None
        status = "unmatched"
        if match_type == "fuzzy":
            status = "possible_match"
        elif match:
            status = "auto_add" if match.available else "unavailable"
        if match and str(match.catalog_item_id) in seen_catalog_ids:
            continue
        if match:
            seen_catalog_ids.add(str(match.catalog_item_id))
        suggestions.append(BillingSuggestion(source="extracted_service", extraction_name=name, status=status, catalog_match=match))

    for extracted in extractions.get("medications_prescribed") or []:
        name = str(extracted.get("name") or "").strip()
        strength = str(extracted.get("strength") or "").strip()
        lookup_name = f"{name} {strength}".strip() if strength else name
        item, match_type, confidence = _find_catalog_match(
            lookup_name,
            medicines,
            catalog_item_id=str(extracted.get("catalog_item_id")) if extracted.get("catalog_item_id") else None,
        )
        if not item and strength:
            item, match_type, confidence = _find_catalog_match(name, medicines)
        quantity = _numeric_quantity(extracted.get("quantity"))
        match = _match_payload(item, quantity=quantity, match_type=match_type or "exact", confidence=confidence) if item else None
        status = "unmatched"
        if match_type == "fuzzy":
            status = "possible_match"
        elif match:
            status = "auto_add" if match.available else "unavailable"
        if match and str(match.catalog_item_id) in seen_catalog_ids:
            continue
        if match:
            seen_catalog_ids.add(str(match.catalog_item_id))
        suggestions.append(BillingSuggestion(source="prescribed_medicine", extraction_name=name, status=status, catalog_match=match))

    return BillingSuggestionsResponse(
        note_id=note["id"],
        visit_id=note.get("visit_id"),
        suggestions=suggestions,
    )
