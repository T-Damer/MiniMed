"""Compact the search storage of a finished module pack without touching its source text.

Two things are removed, both measured in ``docs/research/kb-audit-storage-2026-10.md`` §2.2:

* the FTS5 index keeps its own copy of every indexed string (``chunks_fts_content``) when it was
  built before migration 010; it becomes an external-content index over ``chunks_fts_source`` like
  the core's, with the same tokenizer and prefix options, so the index itself is unchanged;
* ``chunks.normalized_text`` is only read by the index rebuild. After the rebuild and the
  rank-1 integrity check it is emptied; nothing at runtime reads it (``ChunkRecord.normalizedText``
  has no consumer, FTS5 ``snippet()``/``highlight()`` are not used).

``original_text``, offsets, anchors and every identifier stay byte-exact. The staged migration
proves it: the output is accepted only when the token-instance fingerprint of the index, the bm25
top-50 of a deterministic query set and the hash of every other chunk column match the input. A pack
whose normalized text was emptied records that in ``app_metadata`` so a later index rebuild refuses
to run on it instead of silently producing an empty index.

Only finished module packs may be compacted. Inputs of ``compose`` or of a core build keep their
normalized text.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from itertools import pairwise
from pathlib import Path
from typing import cast

from .edition_manifest import sha256_file
from .sqlite_builder import (
    SEARCH_TEXT_EMPTIED,
    SEARCH_TEXT_STATE_KEY,
    chunks_fts_uses_external_content,
    rebuild_chunks_fts_index,
    repository_root,
    verify_chunks_fts,
)

MIGRATION_ID = "013-compact-module-search-text"
STATE_KEY = SEARCH_TEXT_STATE_KEY
STATE_EMPTIED = SEARCH_TEXT_EMPTIED
_DEFAULT_PREFIX = "2 3"
_DEFAULT_TOKENIZE = "unicode61 remove_diacritics 2"
_BM25_WEIGHTS = "0, 0, 0, 0, 0, 8.0, 4.0, 1.0"
_TOP_K = 50
_QUERY_TERMS = 24
_MASK = (1 << 64) - 1
_CHUNK_COLUMNS = (
    "id, document_version_id, section_id, order_index, original_text, page_start, page_end, "
    "char_start, char_end, previous_chunk_id, next_chunk_id, anchor, metadata_json"
)


def search_text_is_emptied(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        "SELECT value FROM app_metadata WHERE key = ?", (STATE_KEY,)
    ).fetchone()
    return row is not None and row[0] == STATE_EMPTIED


def _statements(sql: str) -> Iterator[str]:
    buffer = ""
    for line in sql.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()
            buffer = ""
            if statement and any(
                part.strip() and not part.lstrip().startswith("--")
                for part in statement.splitlines()
            ):
                yield statement


def _external_index_sql(prefix: str, tokenize: str) -> tuple[str, str]:
    """The view and virtual table of migration 010 with the pack's own FTS options."""
    source = (repository_root() / "schema/sql/010_compact_search_index.sql").read_text(
        encoding="utf-8"
    )
    view = table = None
    for statement in _statements(source):
        head = statement.lstrip().upper()
        if head.startswith("CREATE VIEW IF NOT EXISTS CHUNKS_FTS_SOURCE"):
            view = statement
        elif head.startswith("CREATE VIRTUAL TABLE IF NOT EXISTS CHUNKS_FTS"):
            table = statement
    if view is None or table is None:
        raise ValueError("Migration 010 no longer defines the external-content index.")
    table = re.sub(r"tokenize\s*=\s*'[^']*'", f"tokenize = '{tokenize}'", table)
    table = re.sub(r"prefix\s*=\s*'[^']*'", f"prefix = '{prefix}'", table)
    return view, table


def _fts_options(connection: sqlite3.Connection) -> tuple[str, str]:
    row = connection.execute("SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'").fetchone()
    if row is None:
        raise ValueError("chunks_fts is missing.")
    sql = str(row[0])
    prefix = re.search(r"prefix\s*=\s*'([^']*)'", sql)
    tokenize = re.search(r"tokenize\s*=\s*'([^']*)'", sql)
    return (
        prefix.group(1) if prefix else _DEFAULT_PREFIX,
        tokenize.group(1) if tokenize else _DEFAULT_TOKENIZE,
    )


def convert_to_external_content(connection: sqlite3.Connection) -> bool:
    """Replace a self-contained chunks_fts by migration 010's layout. False if already external."""
    if chunks_fts_uses_external_content(connection):
        return False
    prefix, tokenize = _fts_options(connection)
    view, table = _external_index_sql(prefix, tokenize)
    connection.execute("DROP TABLE chunks_fts")
    connection.execute("DROP VIEW IF EXISTS chunks_fts_source")
    connection.execute(view)
    connection.execute(table)
    rebuild_chunks_fts_index(connection)
    return True


def empty_normalized_text(connection: sqlite3.Connection) -> int:
    """Empty chunks.normalized_text and record it. Run only after the final index rebuild."""
    if not chunks_fts_uses_external_content(connection):
        raise ValueError("normalized_text may only be emptied behind an external-content index.")
    # Rank 1 compares the index with its rows; it needs the text that is about to disappear.
    verify_chunks_fts(connection)
    changed = connection.execute(
        "UPDATE chunks SET normalized_text = '' WHERE normalized_text != ''"
    ).rowcount
    connection.execute(
        "INSERT OR REPLACE INTO app_metadata(key, value) VALUES (?, ?)", (STATE_KEY, STATE_EMPTIED)
    )
    connection.commit()
    return int(changed)


def compact_search_text(connection: sqlite3.Connection) -> dict[str, object]:
    """Convert (if needed), verify and empty, in place. The caller VACUUMs and validates."""
    if search_text_is_emptied(connection):
        raise ValueError("The pack's normalized text is already emptied.")
    converted = convert_to_external_content(connection)
    return {
        "convertedToExternalContent": converted,
        "emptiedChunks": empty_normalized_text(connection),
    }


def _row_hash(parts: tuple[object, ...]) -> int:
    return hash(parts) & _MASK


def index_fingerprint(connection: sqlite3.Connection) -> dict[str, int]:
    """Order-independent fingerprint of every token occurrence: (term, chunk, column, offset)."""
    chunk_ids = {
        int(rowid): str(chunk_id)
        for rowid, chunk_id in connection.execute("SELECT rowid, chunk_id FROM chunks_fts")
    }
    connection.execute("DROP TABLE IF EXISTS temp.fts_instances")
    connection.execute(
        "CREATE VIRTUAL TABLE temp.fts_instances USING fts5vocab('main', 'chunks_fts', 'instance')"
    )
    total = 0
    digest = 0
    try:
        for term, document, column, offset in connection.execute(
            "SELECT term, doc, col, offset FROM temp.fts_instances"
        ):
            total += 1
            digest = (digest + _row_hash((term, chunk_ids[int(document)], column, offset))) & _MASK
    finally:
        connection.execute("DROP TABLE temp.fts_instances")
    return {"chunks": len(chunk_ids), "instances": total, "digest": digest}


def _vocabulary_queries(connection: sqlite3.Connection) -> list[str]:
    connection.execute("DROP TABLE IF EXISTS temp.fts_terms")
    connection.execute(
        "CREATE VIRTUAL TABLE temp.fts_terms USING fts5vocab('main', 'chunks_fts', 'row')"
    )
    try:
        terms = [
            str(term)
            for (term,) in connection.execute(
                "SELECT term FROM temp.fts_terms WHERE doc BETWEEN 3 AND 5000 "
                "AND length(term) >= 4 ORDER BY term"
            )
            if re.fullmatch(r"\w+", str(term))
        ]
    finally:
        connection.execute("DROP TABLE temp.fts_terms")
    if not terms:
        return []
    stride = max(1, len(terms) // _QUERY_TERMS)
    picked = terms[::stride][:_QUERY_TERMS]
    queries = [f'"{term}"' for term in picked]
    queries += [f"{term[:4]}*" for term in picked[::3]]
    queries += [f'"{left}" "{right}"' for left, right in pairwise(picked)][::3]
    return queries


def search_snapshot(
    connection: sqlite3.Connection, queries: list[str]
) -> list[list[tuple[str, float]]]:
    """bm25 top-50 as the app asks for it, ties broken by chunk id so the comparison is exact."""
    sql = (
        f"SELECT chunk_id, bm25(chunks_fts, {_BM25_WEIGHTS}) AS score FROM chunks_fts "
        f"WHERE chunks_fts MATCH ? ORDER BY score, chunk_id LIMIT {_TOP_K}"
    )
    return [
        [
            (str(chunk_id), round(float(score), 9))
            for chunk_id, score in connection.execute(sql, (query,))
        ]
        for query in queries
    ]


def source_text_fingerprint(connection: sqlite3.Connection) -> dict[str, object]:
    """Hash of everything the reader shows or cites: all chunk columns except normalized_text."""
    digest = hashlib.sha256()
    count = 0
    for row in connection.execute(f"SELECT {_CHUNK_COLUMNS} FROM chunks ORDER BY id"):
        count += 1
        digest.update(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode())
        digest.update(b"\n")
    counts = {
        table: int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
        for table in ("documents", "document_versions", "sections", "chunks", "aliases")
    }
    return {"chunkColumnsSha256": digest.hexdigest(), "chunkRows": count, "rows": counts}


def _normalized_text_bytes(connection: sqlite3.Connection) -> int:
    return int(
        connection.execute(
            "SELECT coalesce(sum(length(normalized_text)), 0) FROM chunks"
        ).fetchone()[0]
    )


def _rowids_match(connection: sqlite3.Connection) -> bool:
    if chunks_fts_uses_external_content(connection):
        return True
    chunks = int(connection.execute("SELECT count(*) FROM chunks").fetchone()[0])
    matching = int(
        connection.execute(
            "SELECT count(*) FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid "
            "AND c.id = f.chunk_id"
        ).fetchone()[0]
    )
    return chunks == matching


def migrate_module_search(
    source: Path, output: Path, expected_checksum: str | None = None
) -> dict[str, object]:
    source, output = source.resolve(), output.resolve()
    if source == output:
        raise ValueError("Use a separate staged output for the search-compaction migration.")
    input_checksum = sha256_file(source)
    if expected_checksum is not None and input_checksum != expected_checksum:
        raise ValueError(f"Source pack checksum does not match the expected one: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".partial")
    if temporary.exists():
        raise ValueError(f"A staged output already exists: {temporary}")
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as reference:
        if search_text_is_emptied(reference):
            raise ValueError(f"The pack's normalized text is already emptied: {source}")
        if not _rowids_match(reference):
            raise ValueError("chunks_fts rowids differ from chunks; ties could rank differently.")
        queries = _vocabulary_queries(reference)
        before = {
            "index": index_fingerprint(reference),
            "text": source_text_fingerprint(reference),
            "search": search_snapshot(reference, queries),
            "layout": "external" if chunks_fts_uses_external_content(reference) else "internal",
            "normalizedTextBytes": _normalized_text_bytes(reference),
        }
    shutil.copyfile(source, temporary)
    try:
        with closing(sqlite3.connect(temporary)) as connection:
            connection.execute("PRAGMA journal_mode = OFF")
            connection.execute("PRAGMA synchronous = OFF")
            actions = compact_search_text(connection)
            connection.execute("VACUUM")
            if (
                connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
                or connection.execute("PRAGMA foreign_key_check").fetchone()
            ):
                raise ValueError("Search compaction failed SQLite integrity checks.")
            connection.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('integrity-check')")
            after = {
                "index": index_fingerprint(connection),
                "text": source_text_fingerprint(connection),
                "search": search_snapshot(connection, queries),
            }
        if after["index"] != before["index"]:
            raise ValueError("The token index changed during search compaction.")
        if after["text"] != before["text"]:
            raise ValueError("Source text columns changed during search compaction.")
        if after["search"] != before["search"]:
            raise ValueError("bm25 results changed during search compaction.")
        if sha256_file(source) != input_checksum:
            raise ValueError("Source pack changed during search compaction.")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "migration": MIGRATION_ID,
        "input": str(source),
        "output": str(output),
        "inputChecksum": input_checksum,
        "outputChecksum": sha256_file(output),
        "inputBytes": source.stat().st_size,
        "outputBytes": output.stat().st_size,
        "previousLayout": before["layout"],
        "normalizedTextBytesRemoved": before["normalizedTextBytes"],
        **actions,
        "indexInstances": cast(dict[str, int], after["index"])["instances"],
        "chunks": cast(dict[str, int], after["index"])["chunks"],
        "queriesCompared": len(queries),
        "sourceTextSha256": cast(dict[str, object], after["text"])["chunkColumnsSha256"],
        "sqliteIntegrity": "ok",
        "foreignKeyViolations": 0,
    }
