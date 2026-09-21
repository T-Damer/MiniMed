"""Build a new annotated reference edition using the existing numeric SQLite projection."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from .definition_reference_annotations import load_annotation_projection, write_reference_annotations
from .definition_reference_compact_pack import build_compact_definition_reference
from .definition_reference_layout import reference_content_digest
from .definition_reference_pack import digest, encoded, obj
from .definition_reference_profile import file_receipt
from .sqlite_builder import inspect_integrity


def build_annotated_definition_reference(
    inputs: tuple[Path, ...],
    output: Path,
    *,
    input_root: Path,
    edition_id: str,
    version: str,
    built_at: str,
) -> dict[str, object]:
    if output.exists():
        raise ValueError("Annotated edition needs a new immutable output path")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="reference-annotations-", dir=output.parent) as directory:
        staged = Path(directory) / "reference.db"
        baseline = build_compact_definition_reference(
            inputs, staged, input_root=input_root, edition_id=edition_id,
            version=version, built_at=built_at,
        )
        projection, block_maps = load_annotation_projection(inputs, input_root)
        if baseline["receipts"] != projection.receipts:
            raise ValueError("Input snapshot changed while preparing annotation bindings")
        with closing(sqlite3.connect(staged)) as database, database:
            database.execute("PRAGMA foreign_keys = ON")
            before = reference_content_digest(database, compact=True)
            counts = write_reference_annotations(database, projection, block_maps)
            row = database.execute(
                "SELECT value FROM app_metadata WHERE key = 'definition_reference'"
            ).fetchone()
            if row is None:
                raise ValueError("Missing reference manifest")
            manifest = obj(json.loads(str(row[0])))
            manifest["annotationLayout"] = "source-spans-v1"
            manifest["annotations"] = counts
            database.execute(
                "UPDATE app_metadata SET value = ? WHERE key = 'definition_reference'",
                (encoded(manifest),),
            )
            database.execute("UPDATE app_metadata SET value = '9' WHERE key = 'schema_version'")
            database.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (9, ?)", (built_at,),
            )
            database.execute(
                "UPDATE content_packs SET schema_version = 9, checksum = ? WHERE id = ?",
                ("sha256:" + digest(encoded(manifest)), edition_id),
            )
            if reference_content_digest(database, compact=True) != before:
                raise ValueError("Annotation binding altered existing source data")
            unbound = database.execute(
                "SELECT count(*) FROM definition_reference_annotation_spans a "
                "JOIN chunks c ON c.id = a.chunk_id WHERE a.end_offset > length(c.original_text) "
                "OR NOT EXISTS (SELECT 1 FROM definition_reference_annotation_links l "
                "WHERE l.annotation_id = a.id)"
            ).fetchone()
            if unbound is None or unbound[0] != 0:
                raise ValueError("Unbound or out-of-range annotation remains")
        with closing(sqlite3.connect(staged)) as database:
            database.execute("VACUUM")
        with closing(sqlite3.connect(staged)) as database, database:
            for table in ("definition_reference_fts", "knowledge_fts", "chunks_fts"):
                database.execute(f"INSERT INTO {table}({table}, rank) VALUES ('integrity-check', 1)")
            if reference_content_digest(database, compact=True) != before:
                raise ValueError("Final annotated edition no longer matches its source rows")
        integrity, foreign_keys, *_ = inspect_integrity(staged)
        if integrity != "ok" or foreign_keys:
            raise ValueError("Annotated edition failed integrity checks")
        checksum, size, transport = file_receipt(staged)
        report = {
            "contract": 1,
            "editionId": edition_id,
            "version": version,
            "schemaVersion": 9,
            "annotationLayout": "source-spans-v1",
            "linkLayout": "numeric-v1",
            "entries": baseline["entries"],
            "sources": baseline["sources"],
            "blocks": baseline["blocks"],
            "receipts": projection.receipts,
            "annotations": counts,
            "numericBaselineSqliteBytes": baseline["sqliteBytes"],
            "sqliteBytes": size,
            "gzipBytes": transport,
            "sqliteSha256": checksum,
            "existingLogicalRowsUnchanged": True,
            "integrity": integrity,
            "foreignKeyViolations": foreign_keys,
            "boundaries": (
                "Source-span bindings only, with unresolved person identity and review-required origin statements. "
                "No new biography, root translation, canonical relation, private upload or clinical qualification."
            ),
        }
        os.link(staged, output)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--input", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--built-at", required=True)
    args = parser.parse_args()
    if args.report.exists() or args.report.resolve() == args.output.resolve():
        parser.error("Use distinct new database/report paths")
    report = build_annotated_definition_reference(
        tuple(args.input), args.output, input_root=args.input_root, edition_id=args.edition_id,
        version=args.version, built_at=args.built_at,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(encoded(report))


if __name__ == "__main__":
    main()
