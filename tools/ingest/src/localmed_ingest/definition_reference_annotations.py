"""Bind supplied source spans without inferring translations, biographies or equivalence."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from .definition_reference_pack import (
    MAX_INPUT_BYTES,
    MAX_TEXT,
    Projection,
    contained,
    digest,
    encoded,
    number,
    obj,
    seq,
    source_path,
    text,
)

BlockMaps = dict[str, dict[int, str]]


def load_annotation_projection(
    inputs: tuple[Path, ...], input_root: Path
) -> tuple[Projection, BlockMaps]:
    """Use the ordinary validated projection and retain each input's numeric namespace."""
    if not inputs or len(inputs) > 32:
        raise ValueError("Expected 1..32 explicit annotation inputs")
    projection = Projection()
    maps: BlockMaps = {}
    for path in inputs:
        actual = contained(input_root, path)
        if actual.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("Annotation input exceeds its byte budget")
        raw = actual.read_bytes()
        receipt = hashlib.sha256(raw).hexdigest()
        if receipt in maps:
            raise ValueError("Duplicate annotation input snapshot")
        payload = obj(json.loads(raw))
        projection.add(payload, receipt)
        projection.receipts.append({"sha256": receipt, "bytes": len(raw)})
        local_blocks: dict[int, str] = {}
        maps[receipt] = local_blocks
        if payload.get("version") != 3:
            continue
        sources = {
            number(obj(row).get("id")): obj(row)
            for row in seq(payload.get("sources"), 1000)
        }
        for value in seq(payload.get("blocks"), 100000):
            row = obj(value)
            descriptor = sources[number(row.get("source"))].copy()
            descriptor.pop("id")
            source = projection.sources[digest(encoded(descriptor))]
            body = text(row.get("text"), MAX_TEXT)
            provenance = {
                key: val for key, val in row.items() if key not in {"id", "source", "text"}
            }
            provenance.update(
                {
                    "path": source_path(
                        source.descriptor, row.get("path", source.descriptor.get("path", ""))
                    ),
                    "locator": text(row.get("locator"), 4096),
                }
            )
            chunk_id = "reference.block." + digest(encoded([source.id, body, provenance]))
            if chunk_id not in projection.chunks:
                raise ValueError("Annotation mapping disagrees with the ordinary projection")
            local_blocks[number(row.get("id"))] = chunk_id
    return projection, maps


def _offset(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_TEXT:
        raise ValueError("Invalid annotation code-point offset")
    return value


def _spans(raw: object) -> list[tuple[str, str, dict[str, object], str | None]]:
    annotations = obj(raw)
    spans: list[tuple[str, str, dict[str, object], str | None]] = []
    for value in seq(annotations.get("etymologyStatements", []), 10000):
        row = obj(value)
        if row.get("reviewStatus") != "requires-review":
            raise ValueError("Unsupported etymology review state")
        spans.append(
            (
                "etymology",
                "Происхождение: формулировка источника",
                row,
                text(row.get("sourceStatement"), 4096),
            )
        )
    for value in seq(annotations.get("historicalMentions", []), 10000):
        row = obj(value)
        if (
            row.get("reviewStatus") != "requires-review"
            or row.get("identityStatus") != "unresolved"
            or row.get("biography") is not None
            or row.get("discoveryClaim") is not None
        ):
            raise ValueError("A source name does not establish biography or discovery priority")
        label = text(row.get("sourceName"), 256)
        references = seq(row.get("references"), 1000)
        if not references:
            raise ValueError("Historical mention needs a source span")
        for reference in references:
            spans.append(("historical-mention", label, obj(reference), None))
    if len(spans) > 20000:
        raise ValueError("Annotation span budget exceeded")
    return spans


def write_reference_annotations(
    database: sqlite3.Connection, projection: Projection, block_maps: BlockMaps
) -> dict[str, int]:
    """Write to a staged edition only. Invalid references roll back the entire operation."""
    owners: dict[tuple[str, str], set[str]] = defaultdict(set)
    for entry in projection.entries.values():
        for role, chunk_id in entry.links:
            if role in {"definition", "item", "context"}:
                owners[(entry.receipt, chunk_id)].add(entry.id)
    span_count = 0
    link_count = 0
    database.execute("SAVEPOINT reference_annotation_binding")
    try:
        for table in ("definition_reference_annotation_spans", "definition_reference_annotation_links"):
            if database.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise ValueError("Annotation target is not an empty staged edition")
        for receipt, raw in projection.annotations.items():
            local_blocks = block_maps.get(receipt, {})
            seen: set[str] = set()
            for kind, label, row, expected in _spans(raw):
                chunk_id = local_blocks.get(number(row.get("block")))
                if chunk_id is None:
                    raise ValueError("Unresolved input-local annotation block")
                _, chunk = projection.chunks[chunk_id]
                start, end = _offset(row.get("start")), _offset(row.get("end"))
                if not 0 <= start < end <= len(chunk.original_text) or end - start > 4096:
                    raise ValueError("Annotation span is outside its source block")
                statement = chunk.original_text[start:end]
                if expected is not None and statement != expected:
                    raise ValueError("Etymology statement differs from the supplied source span")
                associated = owners.get((receipt, chunk_id), set())
                if not associated:
                    raise ValueError("Annotation has no card/source-context membership")
                identity = "reference.annotation." + digest(
                    encoded([receipt, chunk_id, kind, label, start, end])
                )
                if identity in seen:
                    continue
                seen.add(identity)
                stored = database.execute(
                    "SELECT original_text FROM chunks WHERE id = ?", (chunk_id,)
                ).fetchone()
                if stored is None or stored[0] != chunk.original_text:
                    raise ValueError("Annotation source no longer matches the SQLite block")
                database.execute(
                    "INSERT INTO definition_reference_annotation_spans VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (identity, receipt, chunk_id, kind, label, start, end),
                )
                for entity_id in sorted(associated):
                    owner = database.execute(
                        "SELECT json_extract(metadata_json, '$.inputSha256') "
                        "FROM knowledge_entities WHERE id = ?", (entity_id,),
                    ).fetchone()
                    if owner is None or owner[0] != receipt:
                        raise ValueError("Annotation owner belongs to another input receipt")
                    database.execute(
                        "INSERT INTO definition_reference_annotation_links VALUES (?, ?)",
                        (entity_id, identity),
                    )
                    link_count += 1
                span_count += 1
        database.execute("RELEASE reference_annotation_binding")
    except BaseException:
        database.execute("ROLLBACK TO reference_annotation_binding")
        database.execute("RELEASE reference_annotation_binding")
        raise
    return {"spans": span_count, "links": link_count}
