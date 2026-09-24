"""Build a new losslessly compacted definition edition; never rewrite an installed pack."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from .definition_reference_layout import compact_reference_links, reference_content_digest
from .definition_reference_metadata import compact_reference_metadata
from .definition_reference_pack import build_definition_reference, digest, encoded, obj
from .definition_reference_profile import file_receipt, profile_reference
from .sqlite_builder import inspect_integrity


def build_compact_definition_reference(
    inputs: tuple[Path, ...],
    output: Path,
    *,
    input_root: Path,
    edition_id: str,
    version: str,
    built_at: str,
    profile: bool = False,
    compact_metadata: bool = False,
    definitions_only: bool = False,
    discovery_inputs: tuple[Path, ...] = (),
    completion_inputs: tuple[Path, ...] = (),
    supplied_root: Path | None = None,
    supplied_manifest: Path | None = None,
) -> dict[str, object]:
    if output.exists():
        raise ValueError("Compact edition output must be a new immutable path")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="reference-compact-", dir=output.parent) as directory:
        staged = Path(directory) / "reference.db"
        baseline = build_definition_reference(
            inputs,
            staged,
            input_root=input_root,
            edition_id=edition_id,
            version=version,
            built_at=built_at,
            definitions_only=definitions_only,
            discovery_inputs=discovery_inputs,
            completion_inputs=completion_inputs,
            supplied_root=supplied_root,
            supplied_manifest=supplied_manifest,
        )
        allocation_before = profile_reference(staged) if profile else None
        with closing(sqlite3.connect(staged)) as database, database:
            database.execute("PRAGMA foreign_keys = ON")
            before = reference_content_digest(database, compact=False)
            links = compact_reference_links(database)
            row = database.execute(
                "SELECT value FROM app_metadata WHERE key='definition_reference'"
            ).fetchone()
            if row is None:
                raise ValueError("Missing built reference manifest")
            manifest = obj(json.loads(str(row[0])))
            manifest["linkLayout"] = "numeric-v1"
            database.execute(
                "UPDATE app_metadata SET value=? WHERE key='definition_reference'",
                (encoded(manifest),),
            )
            metadata = compact_reference_metadata(database) if compact_metadata else None
            schema_version = 8 if compact_metadata else 7
            if compact_metadata:
                manifest["metadataLayout"] = "fragments-v1"
                database.execute(
                    "UPDATE app_metadata SET value=? WHERE key='definition_reference'",
                    (encoded(manifest),),
                )
                database.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (8, ?)",
                    (built_at,),
                )
            database.execute(
                "UPDATE app_metadata SET value=? WHERE key='schema_version'",
                (str(schema_version),),
            )
            database.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (7, ?)", (built_at,)
            )
            database.execute(
                "UPDATE content_packs SET schema_version=?, checksum=? WHERE id=?",
                (schema_version, "sha256:" + digest(encoded(manifest)), edition_id),
            )
            # R1 clears this ordinary index. Rebuild from its empty content to discard
            # obsolete postings as well; no document/body index configuration is changed.
            if database.execute("SELECT 1 FROM chunks_fts LIMIT 1").fetchone():
                raise ValueError("Reference-only pack unexpectedly contains ordinary FTS rows")
            database.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
        with closing(sqlite3.connect(staged)) as database:
            database.execute("VACUUM")
        with closing(sqlite3.connect(staged)) as database, database:
            # Run these after VACUUM, not just before physical compaction.
            for table in ("definition_reference_fts", "knowledge_fts", "chunks_fts"):
                database.execute(
                    f"INSERT INTO {table}({table}, rank) VALUES ('integrity-check', 1)"
                )
            after = reference_content_digest(
                database, compact=True, restored_metadata=compact_metadata
            )
            if before != after:
                raise ValueError("Compaction changed source text, identities, links or annotations")
        integrity, foreign_keys, *_ = inspect_integrity(staged)
        if integrity != "ok" or foreign_keys:
            raise ValueError("Compacted reference failed integrity/foreign-key checks")
        allocation_after = profile_reference(staged) if profile else None
        checksum, size, transport = file_receipt(staged)
        # Hard-link publication is atomic and refuses an output created during the build.
        os.link(staged, output)
    return {
        "contract": 1,
        "editionId": edition_id,
        "version": version,
        "schemaVersion": schema_version,
        "metadataCompaction": metadata,
        "linkLayout": "numeric-v1",
        "entries": baseline["entries"],
        "suppliedSources": baseline.get("suppliedSources"),
        "discoveredNames": baseline.get("discoveredNames", 0),
        "completedNames": baseline.get("completedNames", 0),
        "selection": baseline.get("selection"),
        "sources": baseline["sources"],
        "blocks": baseline["blocks"],
        "receipts": baseline["receipts"],
        "baselineSqliteBytes": baseline["sqliteBytes"],
        "sqliteBytes": size,
        "gzipBytes": transport,
        "sqliteSha256": checksum,
        "logicalRoundTripEqual": True,
        "logicalTables": after,
        "linkCompaction": links,
        "postVacuumFtsIntegrity": "ok",
        "integrity": integrity,
        "foreignKeyViolations": foreign_keys,
        "allocationBefore": allocation_before,
        "allocationAfter": allocation_after,
        "boundaries": (
            "New local-dev source reference only; original IDs/text/provenance are unchanged. "
            "No released database mutation, canonical merge, app/Android qualification or model."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--input", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--built-at", required=True)
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--compact-metadata", action="store_true")
    args = parser.parse_args()
    if args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error("Choose distinct new output/report paths")
    report = build_compact_definition_reference(
        tuple(args.input),
        args.output,
        input_root=args.input_root,
        edition_id=args.edition_id,
        version=args.version,
        built_at=args.built_at,
        profile=args.profile,
        compact_metadata=args.compact_metadata,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "entries",
                    "baselineSqliteBytes",
                    "sqliteBytes",
                    "gzipBytes",
                    "logicalRoundTripEqual",
                )
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
