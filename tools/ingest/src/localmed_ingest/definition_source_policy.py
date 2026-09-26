"""The user's source-selection boundary, not a clinical quality or licensing decision."""

from __future__ import annotations

from collections.abc import Mapping
from urllib.parse import urlsplit

POLICY_ID = "specialist-medical-sources-2026-09-22"


def _wikipedia_origin(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    normalized = value.strip().casefold()
    if normalized == "wikipedia":
        return True
    # Compare the authority, never query parameters, bibliography text or a lookalike host.
    candidate = normalized
    if not candidate.startswith("//") and "://" not in candidate:
        candidate = "https://" + candidate
    try:
        host = (urlsplit(candidate).hostname or "").rstrip(".")
    except ValueError as exc:
        raise ValueError("Invalid reference source origin") from exc
    return host == "wikipedia.org" or host.endswith(".wikipedia.org")


def is_wikipedia_input(payload: Mapping[str, object]) -> bool:
    """Inspect source identity, not clinical text. Mixed-source inputs need an explicit split."""
    sources = payload.get("sources", [])
    if not isinstance(sources, list):
        raise ValueError("Definition source descriptors must be a list")
    for value in sources:
        if not isinstance(value, dict):
            raise ValueError("Invalid definition source descriptor")
        source: dict[str, object] = value
        source_type = source.get("sourceType")
        if isinstance(source_type, str):
            normalized = source_type.casefold().replace("_", "-")
            if normalized == "wikipedia" or normalized.startswith("wikipedia-"):
                return True
        for key in ("sourceProject", "project", "baseUrl", "url", "sourceUrl"):
            if _wikipedia_origin(source.get(key)):
                return True
    terms = payload.get("terms", [])
    if not isinstance(terms, list):
        raise ValueError("Definition terms must be a list")
    for value in terms:
        if not isinstance(value, dict):
            raise ValueError("Invalid definition term")
        identifier = value.get("id")
        if isinstance(identifier, str) and identifier.startswith("ruwiki.definition."):
            return True
    return False


def require_active_definition_source(payload: Mapping[str, object]) -> None:
    if is_wikipedia_input(payload):
        raise ValueError(
            "Wikipedia is excluded from the active reference by the specialist-source policy. "
            "Retain the original acquisition outside the application manifest."
        )
