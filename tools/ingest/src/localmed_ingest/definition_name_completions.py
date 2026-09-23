"""Upgrade an explicitly bound empty name, preserving identity and discovery provenance.

The medical text uses the ordinary V3 source projection. No title-only same-as graph,
second dictionary, network request or automatic clinical approval is introduced.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import replace
from pathlib import Path

from .definition_reference_pack import (
    MAX_INPUT_BYTES,
    Projection,
    Source,
    contained,
    digest,
    normalized_name,
    obj,
    seq,
    text,
)
from .definition_source_policy import require_active_definition_source

FORMAT = "minimed-name-completions-v1"


def _sha(value: object) -> str:
    result = text(value, 64)
    if not re.fullmatch(r"[a-f0-9]{64}", result):
        raise ValueError("Invalid completion receipt")
    return result


def apply_name_completions(projection: Projection, payload: object, receipt: str) -> int:
    """Validate the whole transaction before modifying the shared projection."""
    _sha(receipt)
    root = obj(payload)
    if (
        set(root) != {"format", "catalog", "targets"}
        or root["format"] != FORMAT
    ):
        raise ValueError("Unsupported name completion contract")
    catalog = obj(root["catalog"])
    if catalog.get("version") != 3:
        raise ValueError("Name completions must contain literal V3 source excerpts")
    # A preserved discovery ID may contain 'ruwiki'; its new definition source must not.
    require_active_definition_source({"sources": catalog.get("sources"), "terms": []})
    staged = Projection()
    staged.add(catalog, receipt)
    targets: dict[str, dict[str, object]] = {}
    for value in seq(root["targets"], 1000):
        row = obj(value)
        if set(row) != {"id", "expectedTitle", "discoveryReceipt"}:
            raise ValueError("Invalid completion target fields")
        identifier = text(row["id"], 256)
        if identifier in targets:
            raise ValueError("Duplicate completion target")
        targets[identifier] = row
    if not targets or set(targets) != set(staged.entries):
        raise ValueError("Completion targets differ from the source record set")
    defined_titles = {
        normalized_name(entry.title)
        for entry in projection.entries.values()
        if entry.coverage in {"definition", "explicit-definition"}
        and entry.text_kind != "source-gloss"
    }
    expected_blocks: set[str] = set()
    for identifier, row in targets.items():
        old = projection.entries.get(identifier)
        new = staged.entries[identifier]
        if (
            old is None
            or old.coverage != "needs-definition"
            or old.receipt != _sha(row["discoveryReceipt"])
            or old.title != text(row["expectedTitle"])
            or new.title != old.title
            or new.kind != old.kind
            or normalized_name(old.title) in defined_titles
            or new.coverage != "definition"
            or new.text_kind != "source-excerpt"
            or len(new.links) != 1
            or new.links[0][0] != "definition"
            or not old.links
            or any(role != "annotation" for role, _ in old.links)
        ):
            raise ValueError("Completion conflicts with its empty name or existing definition")
        block_id = new.links[0][1]
        expected_blocks.add(block_id)
        chunk = staged.chunks[block_id][1]
        proof = obj(chunk.metadata.get("sourceVerification"))
        start, end = proof.get("start"), proof.get("end")
        if (
            proof.get("method") != "visible-paragraph-exact-v1"
            or proof.get("excerptSha256") != digest(chunk.original_text)
            or type(start) is not int
            or type(end) is not int
            or start < 0
            or end - start != len(chunk.original_text)
            or len(chunk.original_text) > 4096
        ):
            raise ValueError("Invalid completion source span")
        _sha(proof.get("responseSha256"))
        _sha(proof.get("paragraphSha256"))
        text(proof.get("retrievedAt"), 40)
    if expected_blocks != set(staged.chunks):
        raise ValueError("Completion must not import unrelated source content")
    # All source/category/span/target checks completed. Existing blocks are left untouched.
    for key, source in staged.sources.items():
        shared = projection.sources.setdefault(key, Source(source.id, source.descriptor))
        for chunk_id, chunk in source.chunks.items():
            metadata = dict(chunk.metadata)
            metadata.pop("definitionReference", None)
            if projection.block(shared, chunk.original_text, metadata) != chunk_id:
                raise AssertionError("Ordinary source projection identity changed")
    for identifier, new in staged.entries.items():
        old = projection.entries[identifier]
        projection.entries[identifier] = replace(
            new,
            names=list(old.names),
            links=[*new.links, *old.links],
        )
    return len(targets)


def read_completion_manifest(root: Path) -> tuple[Path, ...]:
    manifest = root / "content/definition-drafts/completion-inputs.json"
    if not manifest.exists():
        return ()
    if manifest.stat().st_size > 65536:
        raise ValueError("Completion manifest exceeds budget")
    value = obj(json.loads(manifest.read_bytes()))
    if set(value) != {"format", "inputs"} or value["format"] != FORMAT:
        raise ValueError("Invalid completion manifest")
    result: list[Path] = []
    seen: set[str] = set()
    for item in seq(value["inputs"], 16):
        row = obj(item)
        if set(row) != {"path", "bytes", "sha256"}:
            raise ValueError("Invalid completion input descriptor")
        relative = Path(text(row["path"]))
        if relative.is_absolute():
            raise ValueError("Absolute completion input is not allowed")
        actual = contained(root, relative)
        if not actual.is_relative_to((root / "content/definition-drafts").resolve()):
            raise ValueError("Completion input escapes the authoring tree")
        if actual.suffix != ".json" or actual.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("Invalid completion input file")
        raw = actual.read_bytes()
        checksum = _sha(row["sha256"])
        if (
            type(row["bytes"]) is not int
            or len(raw) != row["bytes"]
            or hashlib.sha256(raw).hexdigest() != checksum
            or checksum in seen
        ):
            raise ValueError("Completion input receipt mismatch or duplicate")
        seen.add(checksum)
        result.append(actual)
    return tuple(result)
