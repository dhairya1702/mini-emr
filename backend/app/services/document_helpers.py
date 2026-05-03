from __future__ import annotations

from typing import Iterable

from app.db import SupabaseRepository
from app.schemas import UserOut


async def build_document_context_for_user(repo: SupabaseRepository, current_user: UserOut) -> dict:
    clinic_settings = await repo.get_clinic_settings(str(current_user.org_id))
    doctor_profile = await repo.get_user(str(current_user.id))
    return {
        **clinic_settings,
        "doctor_name": str(doctor_profile.get("name") or clinic_settings.get("doctor_name") or "").strip(),
        "doctor_signature_name": doctor_profile.get("doctor_signature_name"),
        "doctor_signature_content_type": doctor_profile.get("doctor_signature_content_type"),
        "doctor_signature_data_base64": doctor_profile.get("doctor_signature_data_base64"),
    }


def normalize_structured_document_content(
    content: str,
    *,
    title: str,
    headings: Iterable[str],
    empty_message: str,
) -> str:
    normalized = (content or "").strip()
    ordered_headings = list(headings)
    if not normalized:
        fallback = [f"Title: {title}", ordered_headings[1], empty_message]
        for heading in ordered_headings[2:]:
            fallback.extend([heading, ""])
        return "\n".join(fallback).strip()

    if "Title:" not in normalized:
        normalized = f"Title: {title}\n\n{normalized}"
    for heading in ordered_headings[1:]:
        if heading not in normalized:
            normalized = f"{normalized}\n\n{heading}\n"
    return normalized.strip()
