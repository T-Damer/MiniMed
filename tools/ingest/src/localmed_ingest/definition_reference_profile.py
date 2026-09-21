"""Read-only size accounting for an immutable definition reference, with no text logging."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import zlib
from contextlib import closing
from pathlib import Path

TABLE_COLUMNS: dict[str, tuple[str, ...]] = {
    "app_metadata": ("key", "value"),
    "documents": ("id", "content_pack_id", "title", "metadata_json", "current_version_id"),
    "document_versions": ("id", "document_id", "source_checksum"),
    "sections": ("id", "document_version_id", "title", "anchor", "path_json"),
    "chunks": (
        "id", "document_version_id", "section_id", "original_text", "normalized_text",
        "previous_chunk_id", "next_chunk_id", "anchor", "metadata_json",
    ),
    "knowledge_entities": ("id", "canonical_name", "normalized_name", "metadata_json"),
    "knowledge_names": ("id", "entity_id", "name", "normalized_name"),
    "knowledge_document_links": (
        "id", "entity_id", "document_id", "document_version_id", "section_id", "chunk_id",
        "link_type", "metadata_json",
    ),
}


def file_receipt(path: Path) -> tuple[str, int, int]:
    """Count deterministic gzip bytes without loading or writing another corpus copy."""
    digest = hashlib.sha256()
    compressor = zlib.compressobj(level=9, wbits=31)
    size = compressed = 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            size += len(block)
            digest.update(block)
            compressed += len(compressor.compress(block))
    return digest.hexdigest(), size, compressed + len(compressor.flush())


def profile_reference(path: Path) -> dict[str, object]:
    """No SQL writes, extension loading, raw paths, source text or query logging."""
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("Expected a closed regular SQLite file")
    for suffix in ("-wal", "-journal"):
        sidecar = Path(str(resolved) + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError("Profile a closed immutable file, not an active journal/WAL")
    before = file_receipt(resolved)
    with closing(sqlite3.connect(resolved.as_uri() + "?mode=ro", uri=True)) as database:
        database.execute("PRAGMA query_only = ON")
        database.execute("PRAGMA cache_size = -2048")
        marker = database.execute(
            "SELECT value FROM app_metadata WHERE key = 'definition_reference'"
        ).fetchone()
        if marker is None or json.loads(str(marker[0])).get("contract") != 1:
            raise ValueError("Not an admitted definition reference")
        page_size = int(database.execute("PRAGMA page_size").fetchone()[0])
        page_count = int(database.execute("PRAGMA page_count").fetchone()[0])
        free_pages = int(database.execute("PRAGMA freelist_count").fetchone()[0])
        schema = {
            str(row[0]): (str(row[1]), str(row[2]))
            for row in database.execute("SELECT name, type, tbl_name FROM sqlite_schema")
        }
        try:
            rows = database.execute(
                "SELECT name, count(*), sum(pgsize), sum(payload), sum(unused) "
                "FROM dbstat GROUP BY name ORDER BY sum(pgsize) DESC, name"
            ).fetchall()
        except sqlite3.OperationalError as error:
            raise RuntimeError("Size profiling requires SQLite ENABLE_DBSTAT_VTAB") from error
        allocation = [
            {
                "name": str(row[0]),
                "type": schema.get(str(row[0]), ("internal", ""))[0],
                "owner": schema.get(str(row[0]), ("", str(row[0])))[1],
                "pages": int(row[1]), "bytes": int(row[2]),
                "payloadBytes": int(row[3]), "unusedBytes": int(row[4]),
            }
            for row in rows
        ]
        columns: dict[str, object] = {}
        for table, selected in TABLE_COLUMNS.items():
            if table not in schema:
                continue
            present = {
                str(row[1])
                for row in database.execute("SELECT * FROM pragma_table_info(?)", (table,))
            }
            # Identifiers are exclusively the source-code allowlist above, not caller strings.
            available = [name for name in selected if name in present]
            expressions = [
                f'coalesce(sum(length(CAST("{name}" AS BLOB))), 0)' for name in available
            ]
            result = database.execute(
                f'SELECT count(*), {", ".join(expressions)} FROM "{table}"'
            ).fetchone()
            columns[table] = {
                "rows": int(result[0]),
                "logicalColumnBytes": dict(zip(available, map(int, result[1:]), strict=True)),
            }
        duplicated_text = database.execute(
            "SELECT count(*), coalesce(sum(length(CAST(original_text AS BLOB))), 0) "
            "FROM chunks WHERE original_text = normalized_text AND original_text != ''"
        ).fetchone()
        integrity = str(database.execute("PRAGMA integrity_check").fetchone()[0])
        foreign_key_violations = sum(1 for _ in database.execute("PRAGMA foreign_key_check"))
    after = file_receipt(resolved)
    if before != after:
        raise ValueError("File changed during read-only profiling")
    if integrity != "ok" or foreign_key_violations:
        raise ValueError("Cannot profile a corrupt reference as a valid baseline")
    return {
        "schemaVersion": 1,
        "sqliteVersion": sqlite3.sqlite_version,
        "sqliteSha256": before[0], "sqliteBytes": before[1], "gzipBytes": before[2],
        "pageSize": page_size, "pageCount": page_count,
        "freePageBytes": free_pages * page_size,
        "accountedBtreeBytes": sum(int(item["bytes"]) for item in allocation),
        "allocation": allocation, "tables": columns,
        "identicalOriginalNormalized": {
            "rows": int(duplicated_text[0]), "duplicatedTextBytes": int(duplicated_text[1]),
        },
        "integrity": integrity, "foreignKeyViolations": foreign_key_violations,
        "readOnlyReceiptUnchanged": True,
        "boundaries": (
            "Closed-file host storage accounting. Logical column bytes exclude row/index overhead; "
            "DBSTAT excludes freelist/pointer-map pages. Gzip is a transport comparison. "
            "No device memory, clinical quality, or app qualification is implied."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("Report output must be a new path")
    report = profile_reference(args.database)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps(
        {key: report[key] for key in ("sqliteBytes", "gzipBytes", "integrity")}, indent=2,
    ))


if __name__ == "__main__":
    main()
