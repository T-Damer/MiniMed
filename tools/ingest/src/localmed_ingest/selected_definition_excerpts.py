"""Compile deliberately selected short definitions, not article introductions or model summaries.

The authoring record is an inspected excerpt, not a snapshot of the full web page. Its digest
must not be presented as the original HTML digest or as evidence of clinical approval.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Collection
from datetime import date
from urllib.parse import urljoin, urlsplit

from .definition_reference_pack import (
    digest,
    encoded,
    normalized_name,
    number,
    obj,
    seq,
    source_path,
    strings,
    text,
)

FORMAT = "minimed-selected-definition-excerpts-v1"


def compile_selected_definitions(
    payload: object, existing_definition_names: Collection[str] = ()
) -> tuple[dict[str, object], dict[str, object]]:
    """Existing names only defer acquisition; they never prove equivalence or erase a record."""
    root = obj(payload)
    if (
        set(root) != {"format", "id", "inspectedAt", "sources", "entries"}
        or root["format"] != FORMAT
    ):
        raise ValueError("Unsupported selected-definition authoring contract")
    catalog_id = text(root["id"], 256)
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", catalog_id):
        raise ValueError("Invalid catalog identity")
    inspected_at = text(root["inspectedAt"], 10)
    date.fromisoformat(inspected_at)
    sources: dict[int, dict[str, object]] = {}
    for value in seq(root["sources"], 32):
        source = obj(value).copy()
        identifier = number(source.get("id"))
        if identifier in sources or source.get("releaseEligible") is not False:
            raise ValueError("Duplicate or release-eligible excerpt source")
        if source.get("rightsStatus") != "requires-review" or source.get("language") != "ru":
            raise ValueError("Missing source rights/language boundary")
        text(source.get("title"))
        text(source.get("sourceType"), 80)
        source_path(source, "")
        if source.get("authority") != "third-party":
            raise ValueError("Do not automatically promote a website to clinical authority")
        sources[identifier] = source
    if not sources:
        raise ValueError("Missing excerpt sources")
    rows = seq(root["entries"], 500)
    if not rows:
        raise ValueError("Missing selected definitions")
    validated: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    page_words: Counter[str] = Counter()
    for value in rows:
        row = obj(value)
        if set(row) != {
            "id",
            "title",
            "kind",
            "aliases",
            "source",
            "path",
            "definition",
            "locator",
            "authors",
            "reviewers",
            "sourceUpdated",
            "classification",
            "population",
        }:
            raise ValueError("Missing fields or unexpected source prose")
        identifier = text(row["id"], 256)
        if not re.fullmatch(r"medical\.definition\.[a-z0-9]+(?:[.-][a-z0-9]+)*", identifier):
            raise ValueError("Invalid source-local definition identity")
        title = text(row["title"], 256)
        normalized = normalized_name(title)
        if identifier in seen_ids or normalized in seen_titles:
            raise ValueError("Select one definition per title in an acquisition batch")
        seen_ids.add(identifier)
        seen_titles.add(normalized)
        if row["kind"] not in {"term", "symptom", "syndrome"}:
            raise ValueError("This short-definition intake does not create instruments")
        source_id = number(row["source"])
        if source_id not in sources:
            raise ValueError("Unresolved shared source")
        path = source_path(sources[source_id], row["path"])
        url = urljoin(str(sources[source_id]["baseUrl"]), path)
        if urlsplit(url).fragment:
            raise ValueError("Use an explicit source locator, not an ambiguous URL fragment")
        body = text(row["definition"], 4096)
        if body != body.strip() or not body.endswith(".") or "…" in body or "..." in body:
            raise ValueError("Expected a complete selected sentence, never automatic truncation")
        page_words[url] += len(body.split())
        if page_words[url] > 25:
            raise ValueError("Selected page excerpt exceeds this intake's short-quote budget")
        text(row["locator"], 1000)
        aliases = strings(row["aliases"], 8)
        for alias in aliases:
            if normalized_name(alias) not in normalized_name(body):
                raise ValueError("Alias needs explicit evidence in the selected definition")
        strings(row["authors"], 8)
        strings(row["reviewers"], 8)
        updated = row["sourceUpdated"]
        if updated is not None:
            date.fromisoformat(text(updated, 7) + "-01")
        for key in ("classification", "population"):
            if row[key] is not None:
                text(row[key], 500)
        validated.append(row)
    existing = {normalized_name(name) for name in existing_definition_names}
    selected = [row for row in validated if normalized_name(str(row["title"])) not in existing]
    deferred = [
        {
            "id": row["id"],
            "title": row["title"],
            "reason": "existing-definition-name-needs-sense-review",
        }
        for row in validated
        if normalized_name(str(row["title"])) in existing
    ]
    blocks: list[dict[str, object]] = []
    terms: list[dict[str, object]] = []
    for row in selected:
        block_id = len(blocks) + 1
        body = str(row["definition"])
        blocks.append(
            {
                "id": block_id,
                "source": row["source"],
                "text": body,
                "textSha256": digest(body),
                "path": row["path"],
                "locator": row["locator"],
                "authors": row["authors"],
                "reviewers": row["reviewers"],
                "sourceUpdated": row["sourceUpdated"],
                "classification": row["classification"],
                "population": row["population"],
                "inspectedAt": inspected_at,
                "acquisitionMethod": "inspected-web-excerpt",
                "fullPageSnapshotAvailable": False,
                "medicalReview": "requires-review",
            }
        )
        terms.append(
            {
                "id": row["id"],
                "title": row["title"],
                "kind": row["kind"],
                "aliases": row["aliases"],
                "coverage": "definition",
                "blockIds": [block_id],
            }
        )
    used_sources = {number(row["source"]) for row in selected}
    catalog: dict[str, object] = {
        "version": 3,
        "id": catalog_id,
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [source for key, source in sources.items() if key in used_sources],
        "blocks": blocks,
        "terms": terms,
    }
    report: dict[str, object] = {
        "authoringSha256": digest(encoded(root)),
        "candidates": len(validated),
        "selectedDefinitions": len(selected),
        "selectedIds": [row["id"] for row in selected],
        "deferred": deferred,
        "sourcePagesInspected": len(page_words),
        "maximumWordsPerPage": max(page_words.values()),
        "newInstruments": 0,
        "boundary": (
            "One source sentence per selected title; no article cards, whole-page imports, "
            "medical rewriting, same-as relations, popularity claim or clinical approval. "
            "Name-based deferral is a coverage heuristic, not semantic reconciliation."
        ),
    }
    return catalog, report
