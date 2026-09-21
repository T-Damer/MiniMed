"""Verbatim metadata deduplication in a new reference edition, not clinical rewriting."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections import Counter
from collections.abc import Iterator
from typing import cast

MARKER = '{"$p":1}'
MAX_METADATA = 65536
MAX_PARTS = 128
JSON_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')


def metadata_digest(database: sqlite3.Connection, *, restored: bool) -> tuple[int, str]:
    table = "definition_reference_chunks" if restored else "chunks"
    digest = hashlib.sha256()
    count = 0
    rows = cast(
        Iterator[tuple[str, object]],
        database.execute(f"SELECT id, metadata_json FROM {table} ORDER BY id"),
    )
    for identity, raw in rows:
        if not isinstance(raw, str):
            raise ValueError("Unresolved reference metadata")
        payload = json.dumps([identity, raw], ensure_ascii=False, separators=(",", ":"))
        digest.update(payload.encode("utf-8"))
        digest.update(b"\n")
        count += 1
    return count, digest.hexdigest()


def encode_metadata(raw: str, fragments: dict[str, int]) -> str | None:
    """Replace complete quoted tokens; preserve punctuation, escapes, numbers and whitespace."""
    parts: list[str | int] = []
    start = 0
    for match in JSON_STRING.finditer(raw):
        reference = fragments.get(match.group())
        if reference is None:
            continue
        if match.start() > start:
            parts.append(raw[start : match.start()])
        parts.append(reference)
        start = match.end()
    if not parts:
        return None
    if start < len(raw):
        parts.append(raw[start:])
    if len(parts) > MAX_PARTS:
        return None
    result = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    if len(result.encode("utf-8")) + 96 >= len(raw.encode("utf-8")):
        return None
    return result


def compact_reference_metadata(database: sqlite3.Connection) -> dict[str, object]:
    """Caller owns the staging handle. A savepoint protects it on any validation failure."""
    database.execute("SAVEPOINT compact_reference_metadata")
    try:
        for table in (
            "definition_reference_metadata_fragments",
            "definition_reference_metadata_programs",
        ):
            if database.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                raise ValueError("Metadata fragment tables must start empty")
        row = database.execute(
            "SELECT value FROM app_metadata WHERE key='definition_reference'"
        ).fetchone()
        manifest: object = json.loads(str(row[0])) if row else None
        if not isinstance(manifest, dict):
            raise ValueError("Missing reference manifest")
        manifest = cast(dict[str, object], manifest)
        if (
            manifest.get("contract") != 1
            or manifest.get("linkLayout") != "numeric-v1"
            or manifest.get("metadataLayout") is not None
            or manifest.get("publicationState") != "local-dev"
            or manifest.get("reviewStatus") != "requires-review"
            or manifest.get("identityStatus") != "source-local-proposed"
        ):
            raise ValueError("Only new unreviewed numeric reference editions may be transformed")
        invalid = database.execute("""
            SELECT 1 FROM chunks c
            LEFT JOIN definition_reference_chunk_keys k ON k.chunk_id=c.id
            WHERE k.local_id IS NULL OR NOT json_valid(c.metadata_json)
               OR json_type(c.metadata_json) IS NOT 'object'
               OR json_type(c.metadata_json,'$.definitionReference') IS NOT 'integer'
               OR json_extract(c.metadata_json,'$.definitionReference') IS NOT 1
            LIMIT 1
        """).fetchone()
        if invalid:
            raise ValueError("Invalid source reference metadata or key binding")
        before = metadata_digest(database, restored=False)
        frequencies: Counter[str] = Counter()
        raw_bytes = 0
        for (raw,) in cast(
            Iterator[tuple[str]], database.execute("SELECT metadata_json FROM chunks ORDER BY id")
        ):
            size = len(raw.encode("utf-8"))
            raw_bytes += size
            if size > MAX_METADATA:
                continue
            frequencies.update(
                match.group()
                for match in JSON_STRING.finditer(raw)
                if len(match.group().encode("utf-8")) >= 32
            )
        candidates = {
            fragment: count
            for fragment, count in frequencies.items()
            if count >= 3 and (len(fragment.encode("utf-8")) - 16) * (count - 1) >= 128
        }
        keys = {fragment: index + 1 for index, fragment in enumerate(sorted(candidates))}
        programs: list[tuple[int, str]] = []
        used: set[int] = set()
        replaced_bytes = 0
        for key, raw in cast(
            Iterator[tuple[int, str]],
            database.execute(
                "SELECT k.local_id, c.metadata_json FROM chunks c "
                "JOIN definition_reference_chunk_keys k ON k.chunk_id=c.id ORDER BY c.id"
            ),
        ):
            if len(raw.encode("utf-8")) > MAX_METADATA:
                continue
            encoded = encode_metadata(raw, keys)
            if encoded is not None:
                programs.append((key, encoded))
                replaced_bytes += len(raw.encode("utf-8"))
                for item in cast(list[str | int], json.loads(encoded)):
                    if isinstance(item, int):
                        used.add(item)
        selected = [(key, fragment) for fragment, key in keys.items() if key in used]
        fragment_bytes = sum(len(fragment.encode("utf-8")) for _, fragment in selected)
        program_bytes = sum(len(program.encode("utf-8")) for _, program in programs)
        representation_bytes = fragment_bytes + program_bytes + len(MARKER) * len(programs)
        # Conservative row/key allowance; no transformation that loses its logical size advantage.
        if representation_bytes + 32 * (len(programs) + len(selected)) >= replaced_bytes:
            programs, selected = [], []
            fragment_bytes = program_bytes = representation_bytes = replaced_bytes = 0
        database.executemany(
            "INSERT INTO definition_reference_metadata_fragments VALUES (?, ?)", selected
        )
        database.executemany(
            "INSERT INTO definition_reference_metadata_programs VALUES (?, ?)", programs
        )
        database.executemany(
            "UPDATE chunks SET metadata_json=? WHERE id=(SELECT chunk_id FROM "
            "definition_reference_chunk_keys WHERE local_id=?)",
            [(MARKER, key) for key, _ in programs],
        )
        after = metadata_digest(database, restored=True)
        if before != after:
            raise ValueError("Metadata transformation changed exact source representation")
        database.execute("RELEASE compact_reference_metadata")
        return {
            "layout": "fragments-v1",
            "chunks": before[0],
            "encodedChunks": len(programs),
            "fragments": len(selected),
            "originalMetadataBytes": raw_bytes,
            "encodedProgramBytes": program_bytes,
            "sharedFragmentBytes": fragment_bytes,
            "logicalRepresentationBytes": raw_bytes - replaced_bytes + representation_bytes,
            "metadataSha256": before[1],
            "exactRoundTripEqual": True,
        }
    except BaseException:
        database.execute("ROLLBACK TO compact_reference_metadata")
        database.execute("RELEASE compact_reference_metadata")
        raise
