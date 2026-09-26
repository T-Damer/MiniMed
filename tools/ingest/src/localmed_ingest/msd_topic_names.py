"""Project MSD topic metadata into the existing discovery inventory, not a second database."""

from __future__ import annotations

import re
from collections.abc import Collection

from .definition_name_inventory import FORMAT as NAME_FORMAT
from .definition_reference_pack import normalized_name, obj, seq, text
from .msd_topic_inventory import FORMAT, HOST, public_path

OVERVIEW = re.compile(
    r"^(?:обзор\b|введение\b|подходы\s+к\b|общие\s+сведения\b|как\b|"
    r"дополнительная\s+информация\b|основы\b)",
    re.IGNORECASE,
)


def compile_msd_names(
    payload: object, existing_names: Collection[str]
) -> tuple[dict[str, object], dict[str, object]]:
    catalog = obj(payload)
    if (
        catalog.get("format") != FORMAT
        or catalog.get("scope") != "ru/professional public topic navigation"
    ):
        raise ValueError("Unsupported MSD topic metadata")
    receipts = seq(catalog.get("receipts"), 70)
    known_receipts = {
        text(obj(row).get("sha256"), 64): text(obj(row).get("path"), 4096) for row in receipts
    }
    existing = {normalized_name(name) for name in existing_names}
    unique: dict[str, dict[str, object]] = {}
    for value in seq(catalog.get("references"), 20000):
        row = obj(value)
        if set(row) != {
            "id",
            "title",
            "sourceTitle",
            "path",
            "sectionPath",
            "chapterTitle",
            "chapterPath",
            "indexSha256",
        }:
            raise ValueError("Only title and location metadata belong in this intake")
        identifier = text(row["id"], 128)
        title = text(row["title"], 1024)
        if not re.fullmatch(r"msd\.topic\.[a-f0-9]{32}", identifier):
            raise ValueError("Invalid MSD topic identifier")
        path = public_path(row["path"])
        if not path.startswith("/ru/professional/"):
            raise ValueError("Wrong source edition")
        receipt = text(row["indexSha256"], 64)
        if (
            not re.fullmatch(r"[a-f0-9]{64}", receipt)
            or known_receipts.get(receipt) != row["sectionPath"]
        ):
            raise ValueError("MSD topic has no inspected index receipt")
        previous = unique.get(identifier)
        if previous and previous["title"] != title:
            raise ValueError("Source identity title conflict")
        if previous is None or path < str(previous["path"]):
            unique[identifier] = row
    if not unique or len(unique) != catalog.get("uniqueSourceTopics"):
        raise ValueError("MSD identity count mismatch")
    added_names: set[str] = set()
    selected = []
    deferred = []
    for identifier, row in sorted(unique.items()):
        title = str(row["title"])
        normalized = normalized_name(title)
        reason = (
            "overview-or-navigation-title"
            if OVERVIEW.search(title)
            else "already-searchable-name-needs-sense-review"
            if normalized in existing
            else "same-new-title-needs-sense-review"
            if normalized in added_names
            else None
        )
        if reason:
            deferred.append({"id": identifier, "title": title, "reason": reason})
            continue
        added_names.add(normalized)
        selected.append(
            {
                "id": identifier,
                "title": title,
                "kind": "term",
                "aliases": [],
                "source": 1,
                "path": str(row["path"]).lstrip("/"),
                "locator": "Название темы в оглавлении: "
                + str(row["sectionPath"])
                + " → "
                + str(row["chapterTitle"]),
                "inputSha256": row["indexSha256"],
            }
        )
    result: dict[str, object] = {
        "format": NAME_FORMAT,
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "purpose": "discovery-only",
        "sources": [
            {
                "id": 1,
                "title": "Справочник MSD — оглавление профессиональной русской версии",
                "baseUrl": HOST + "/",
                "sourceType": "medical-topic-index",
                "authority": "third-party",
                "releaseEligible": False,
                "rightsStatus": "metadata-only-content-reuse-not-cleared",
                "language": "ru",
                "contentScope": "Названия и адреса тем; медицинские тексты не импортированы",
            }
        ],
        "names": selected,
        "inputReceipts": receipts,
    }
    return result, {
        "sourceTopics": len(unique),
        "newSearchableNames": len(selected),
        "deferred": deferred,
        "medicalDefinitionsImported": 0,
        "boundary": (
            "An index of medical topics is not a reviewed list of standalone terms. "
            "Missing exact names are candidates requiring definitions; overlaps stay in the "
            "source inventory and do not establish equivalence, aliases or popularity."
        ),
    }
