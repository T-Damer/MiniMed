"""Recover source-local names; never promote a discovery page into a medical definition."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .definition_reference_pack import Projection

FORMAT = "minimed-discovered-names-v1"


def recover_names(root: Path, archive: Path) -> tuple[dict[str, object], dict[str, object]]:
    from .definition_reference_pack import digest, encoded, normalized_name, number, obj, seq, text
    from .definition_source_manifest import read_source_manifest
    from .definition_source_policy import is_wikipedia_input

    inputs, _ = read_source_manifest(root, archive)
    sources: list[dict[str, object]] = []
    source_ids: dict[str, int] = {}
    names: list[dict[str, object]] = []
    ids: set[str] = set()
    titles: set[str] = set()
    receipts: list[dict[str, object]] = []
    for path in inputs:
        raw = path.read_bytes()
        payload = obj(json.loads(raw))
        if not is_wikipedia_input(payload):
            continue
        if payload.get("version") != 3 or payload.get("textKind") != "source-excerpt":
            raise ValueError("Discovery import expects the archived V3 source shape")
        receipt = hashlib.sha256(raw).hexdigest()
        receipts.append({"path": path.relative_to(root).as_posix(), "sha256": receipt})
        local: dict[int, int] = {}
        for item in seq(payload["sources"], 1000):
            descriptor = obj(item).copy()
            local_id = number(descriptor.pop("id"))
            key = digest(encoded(descriptor))
            if key not in source_ids:
                source_ids[key] = len(sources) + 1
                # Keep attribution/license and discovery identity, but no source article body.
                sources.append({"id": source_ids[key], **descriptor})
            local[local_id] = source_ids[key]
        blocks = {number(obj(item)["id"]): obj(item) for item in seq(payload["blocks"], 100000)}
        for item in seq(payload["terms"], 50000):
            row = obj(item)
            identifier = text(row["id"], 256)
            if identifier in ids:
                raise ValueError("Duplicate original discovery identity")
            ids.add(identifier)
            first = blocks[number(seq(row["blockIds"], 1000)[0])]
            title = text(row["title"])
            titles.add(normalized_name(title))
            names.append(
                {
                    "id": identifier,
                    "title": title,
                    "kind": text(row["kind"], 40),
                    "aliases": seq(row.get("aliases", []), 128),
                    "source": local[number(first["source"])],
                    "path": text(first.get("path", ""), 2048, empty=True),
                    "locator": text(first["locator"], 4096),
                    "inputSha256": receipt,
                }
            )
    if not names:
        raise ValueError("No archived names found; refusing an empty replacement")
    names.sort(key=lambda row: str(row["id"]))
    inventory = {
        "format": FORMAT,
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "purpose": "discovery-only",
        "sources": sources,
        "names": names,
        "inputReceipts": receipts,
    }
    report = {
        "sourceLocalNames": len(names),
        "normalizedTitles": len(titles),
        "sourceInputs": len(receipts),
        "sources": len(sources),
        "medicalDefinitionsImported": 0,
        "byKind": dict(Counter(str(row["kind"]) for row in names)),
    }
    return inventory, report


def add_name_inventory(projection: Projection, inventory: object, receipt: str) -> int:
    from .definition_reference_pack import (
        KINDS,
        Entry,
        Source,
        digest,
        encoded,
        number,
        obj,
        seq,
        source_path,
        strings,
        text,
    )

    root = obj(inventory)
    if (
        root.get("format") != FORMAT
        or root.get("purpose") != "discovery-only"
        or root.get("publicationState") != "local-dev"
        or root.get("reviewStatus") != "requires-review"
    ):
        raise ValueError("Unsupported discovery inventory")
    if set(root) - {
        "format",
        "purpose",
        "publicationState",
        "reviewStatus",
        "sources",
        "names",
        "inputReceipts",
    }:
        raise ValueError("Discovery inventory must not carry unreviewed prose")
    local: dict[int, Source] = {}
    staged_sources: dict[str, Source] = {}
    for value in seq(root.get("sources"), 1000):
        descriptor = obj(value).copy()
        local_id = number(descriptor.pop("id"))
        if local_id in local or descriptor.get("releaseEligible") not in (None, False):
            raise ValueError("Invalid discovery source identity or publication state")
        text(descriptor.get("title"))
        source_path(descriptor, "")
        descriptor["discoveryOnly"] = True
        descriptor["releaseEligible"] = False
        key = digest(encoded(descriptor))
        source = projection.sources.get(key) or staged_sources.setdefault(
            key, Source("reference.source." + key, descriptor)
        )
        local[local_id] = source
    staged: list[tuple[dict[str, object], Source]] = []
    seen: set[str] = set()
    for value in seq(root.get("names"), 50000):
        row = obj(value)
        if set(row) != {
            "id",
            "title",
            "kind",
            "aliases",
            "source",
            "path",
            "locator",
            "inputSha256",
        }:
            raise ValueError("Name record contains missing fields or medical prose")
        identifier = text(row["id"], 256)
        if (
            not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", identifier)
            or identifier in seen
            or identifier in projection.entries
        ):
            raise ValueError("Invalid or conflicting discovery identity")
        seen.add(identifier)
        text(row["title"])
        if row["kind"] not in KINDS:
            raise ValueError("Unknown discovered-name kind")
        strings(row["aliases"])
        source = local.get(number(row["source"]))
        if source is None:
            raise ValueError("Unresolved discovery source")
        source_path(source.descriptor, row["path"])
        text(row["locator"], 4096)
        if not re.fullmatch(r"[a-f0-9]{64}", text(row["inputSha256"], 64)):
            raise ValueError("Missing original discovery receipt")
        staged.append((row, source))
    if not staged or len(staged) + len(projection.entries) > 100000:
        raise ValueError("Invalid combined name budget")
    projection.sources.update(staged_sources)
    for row, source in staged:
        # Only an annotation link: never enters definition-body FTS or becomes clinical evidence.
        origin = {
            "discoveryOnly": True,
            "path": row["path"],
            "locator": row["locator"],
            "originalInputSha256": row["inputSha256"],
            "definitionStatus": "needs-definition",
        }
        chunk_id = projection.block(
            source, encoded(origin), {"format": "name-discovery-json", **origin}
        )
        identifier, title = str(row["id"]), str(row["title"])
        projection.entries[identifier] = Entry(
            identifier,
            title,
            str(row["kind"]),
            list(dict.fromkeys([title, *strings(row["aliases"])])),
            "needs-definition",
            "source-excerpt",
            [("annotation", chunk_id)],
            receipt,
        )
    return len(staged)


def read_name_manifest(root: Path) -> tuple[Path, ...]:
    from .definition_reference_pack import MAX_INPUT_BYTES, contained, obj

    path = root / "content/definition-drafts/name-inputs.json"
    if not path.exists():
        return ()
    if path.stat().st_size > 65536:
        raise ValueError("Discovery manifest exceeds budget")
    row = obj(json.loads(path.read_bytes()))
    if set(row) != {"path", "bytes", "sha256", "format"} or row["format"] != FORMAT:
        raise ValueError("Invalid name manifest")
    candidate = Path(str(row["path"]))
    if candidate.is_absolute():
        raise ValueError("Absolute discovery path is not allowed")
    actual = contained(root, candidate)
    allowed = (root / "content/definition-drafts").resolve(strict=True)
    if not actual.is_relative_to(allowed) or actual.suffix != ".json":
        raise ValueError("Discovery input is outside the knowledge authoring directory")
    raw = actual.read_bytes()
    if (
        len(raw) > MAX_INPUT_BYTES
        or len(raw) != row["bytes"]
        or hashlib.sha256(raw).hexdigest() != row["sha256"]
    ):
        raise ValueError("Discovery input receipt mismatch")
    return (actual,)
