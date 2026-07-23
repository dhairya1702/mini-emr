from __future__ import annotations

from email.utils import parseaddr


def normalize_single_email(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("Enter a valid recipient email.")
    if any(char in normalized for char in ("\r", "\n", "\t", ",", ";")):
        raise ValueError("Enter a single valid recipient email.")
    display_name, parsed = parseaddr(normalized)
    if display_name or parsed != normalized:
        raise ValueError("Enter a single valid recipient email.")
    local_part, separator, domain = normalized.partition("@")
    if not separator or "@" in domain or not local_part or not domain:
        raise ValueError("Enter a valid recipient email.")
    if "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise ValueError("Enter a valid recipient email.")
    if any(part == "" for part in domain.split(".")):
        raise ValueError("Enter a valid recipient email.")
    return normalized.lower()
