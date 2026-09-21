"""Lossless numeric navigation links inside a newly built reference edition only."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterable
from typing import cast

type Cell = str | int | float | None
LINK_COLUMNS = (
    "id, entity_id, document_id, document_version_id, section_id, chunk_id, "
    "link_type, weight, review_status, metadata_json"
)
LOGICAL_TABLES = (
    "documents",
    "document_versions",
    "sections",
    "chunks",
    "knowledge_entities",
    "knowledge_names",
    "knowledge_facts",
    "knowledge_relations",
)


def row_digest(rows: Iterable[tuple[Cell, ...]]) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        payload = json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        digest.update(payload.encode("utf-8"))
        digest.update(b"\n")
        count += 1
    return count, digest.hexdigest()


def link_digest(database: sqlite3.Connection, *, compact: bool) -> tuple[int, str]:
    table = "definition_reference_links" if compact else "knowledge_document_links"
    return row_digest(
        cast(
            Iterable[tuple[Cell, ...]],
            database.execute(f"SELECT {LINK_COLUMNS} FROM {table} ORDER BY id"),
        )
    )


def reference_content_digest(database: sqlite3.Connection, *, compact: bool) -> dict[str, object]:
    """Full logical source/text/identity comparison, not a sample or only row counts."""
    result: dict[str, object] = {}
    for table in LOGICAL_TABLES:
        count, checksum = row_digest(
            cast(
                Iterable[tuple[Cell, ...]], database.execute(f'SELECT * FROM "{table}" ORDER BY id')
            )
        )
        result[table] = {"rows": count, "sha256": checksum}
    count, checksum = link_digest(database, compact=compact)
    result["links"] = {"rows": count, "sha256": checksum}
    count, checksum = row_digest(
        cast(
            Iterable[tuple[Cell, ...]],
            database.execute(
                "SELECT key, value FROM app_metadata "
                "WHERE key LIKE 'definition_reference_annotations:%' ORDER BY key"
            ),
        )
    )
    result["annotations"] = {"rows": count, "sha256": checksum}
    return result


def compact_reference_links(database: sqlite3.Connection) -> dict[str, object]:
    """Fail closed unless every row is precisely the reversible R1 builder shape.

    The caller owns the connection/transaction; no installed or released database is opened
    here. A savepoint also protects callers that catch a validation error in a transaction.
    """
    database.execute("SAVEPOINT compact_reference_links")
    try:
        for table in (
            "definition_reference_entity_keys",
            "definition_reference_chunk_keys",
            "definition_reference_compact_links",
        ):
            if database.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone():
                raise ValueError("Compact reference keys must start empty")
        marker = database.execute(
            "SELECT value FROM app_metadata WHERE key='definition_reference'"
        ).fetchone()
        if marker is None:
            raise ValueError("Missing draft reference manifest")
        manifest: object = json.loads(str(marker[0]))
        if not isinstance(manifest, dict):
            raise ValueError("Invalid draft reference manifest")
        manifest = cast(dict[str, object], manifest)
        if (
            manifest.get("contract") != 1
            or manifest.get("publicationState") != "local-dev"
            or manifest.get("reviewStatus") != "requires-review"
            or manifest.get("identityStatus") != "source-local-proposed"
        ):
            raise ValueError("Only unreviewed local reference editions may be compacted")
        invalid = database.execute(
            """
            SELECT 1 FROM knowledge_document_links l
            LEFT JOIN chunks c ON c.id=l.chunk_id
            LEFT JOIN document_versions v ON v.id=c.document_version_id
            LEFT JOIN knowledge_entities e ON e.id=l.entity_id
            WHERE c.id IS NULL OR e.id IS NULL
               OR l.document_id IS NOT v.document_id
               OR l.document_version_id IS NOT c.document_version_id
               OR l.section_id IS NOT c.section_id
               OR l.review_status IS NOT 'proposed' OR l.weight IS NOT 1.0
               OR l.link_type NOT IN (
                 'reference:definition','reference:item','reference:context','reference:annotation')
               OR json_extract(e.metadata_json,'$.definitionReference') IS NOT 1
               OR json_extract(e.metadata_json,'$.editionId') IS NOT ?
               OR json_type(l.metadata_json,'$.ordinal') IS NOT 'integer'
               OR json_extract(l.metadata_json,'$.ordinal') NOT BETWEEN 0 AND 999999
               OR l.id IS NOT l.entity_id || '.reference.' ||
                    printf('%06d',json_extract(l.metadata_json,'$.ordinal'))
               OR l.metadata_json IS NOT json_object(
                    'ordinal',json_extract(l.metadata_json,'$.ordinal'),
                    'role',substr(l.link_type,11))
            LIMIT 1
        """,
            (str(manifest.get("editionId")),),
        ).fetchone()
        if invalid:
            raise ValueError("Navigation link has non-reconstructible source data")
        before = link_digest(database, compact=False)
        database.execute(
            """
            INSERT INTO definition_reference_entity_keys(local_id, entity_id)
            SELECT row_number() OVER (ORDER BY id), id FROM knowledge_entities
            WHERE json_extract(metadata_json,'$.definitionReference') = 1
              AND json_extract(metadata_json,'$.editionId') = ?
        """,
            (str(manifest.get("editionId")),),
        )
        database.execute("""
            INSERT INTO definition_reference_chunk_keys(local_id, chunk_id)
            SELECT row_number() OVER (ORDER BY id), id FROM chunks
        """)
        database.execute("""
            INSERT INTO definition_reference_compact_links(entity_key, ordinal, chunk_key, role)
            SELECT e.local_id, json_extract(l.metadata_json,'$.ordinal'), b.local_id,
                CASE l.link_type WHEN 'reference:definition' THEN 1 WHEN 'reference:item' THEN 2
                WHEN 'reference:context' THEN 3 ELSE 4 END
            FROM knowledge_document_links l
            JOIN definition_reference_entity_keys e ON e.entity_id=l.entity_id
            JOIN definition_reference_chunk_keys b ON b.chunk_id=l.chunk_id
        """)
        database.execute("DELETE FROM knowledge_document_links")
        after = link_digest(database, compact=True)
        if before != after:
            raise ValueError("Compact navigation changed the complete logical link set")
        database.execute("RELEASE compact_reference_links")
        return {"links": before[0], "logicalSha256": before[1], "roundTripEqual": True}
    except BaseException:
        database.execute("ROLLBACK TO compact_reference_links")
        database.execute("RELEASE compact_reference_links")
        raise
