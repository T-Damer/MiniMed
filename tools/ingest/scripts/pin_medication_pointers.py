"""Pin the core.db medication pointer track to a fixed, committed set of document ids.

Why this exists: the ESKLP-MNN-based medication track (`build-core-catalog-pointers --family
medication`) needs an "esklp-mnn" coverage ledger built from a raw ESKLP archive
(`medbase-regulated-catalog esklp --archive ... --taxonomy ...`); no such archive is available on
this machine, only the already-built downloads (`data/build/release-esklp/*.db`, 15 modules,
3,324 documents total -- an exact match for the released core.db's medication pointer count) and
the released core.db itself. Re-deriving the ledger from those would risk drifting from what the
release actually shipped, and cannot use `official-grls-coverage-ledger.json` (that ledger's
records are raw GRLS product registrations, `drug.ru.*`, a different and much larger catalog --
confirmed by a real run: 38,815 documents, not 3,324, wrong id scheme entirely).

Coordinator decision (2026-09-27): fix the medication track to the released core's exact set,
reproducibly -- a pinned id list with a hash in the build manifest, not "whatever the current
ledger contains". This script implements that pin by bulk-copying (not hand-editing) the released
core.db's own medication `core_catalog_pointer` rows -- id, front matter/metadata, chunks/FTS
text, and their declared aliases (joined by title, since the `aliases` table has no per-document
foreign key) -- into a small schema-compatible SQLite file that `medbase compose` can ATTACH like
any other pointer-track input, exactly the way it already ATTACHes
core-catalog-pointers-clinical.db etc.

A first attempt copied the whole 422 MB source then cascade-deleted the ~16,663 unwanted
documents; that took over 10 minutes and was killed (see docs/research/core-build-
reconstruction-2026-09-27.md's profiling notes on cascading deletes). This version instead
initializes an empty schema and bulk `INSERT ... SELECT` from an ATTACHed read-only source,
scoped to the pinned id set from the start -- the same "insert only what's wanted" pattern that
made `medbase compose` itself fast (measured 29-65s for 55k-250k-row merges).

Usage:
    uv run --project tools/ingest python tools/ingest/scripts/pin_medication_pointers.py \
        --source apps/app/public/content/core.db \
        --pinned-ids tools/ingest/scripts/released-medication-pointer-ids-2026-09-08.json \
        --output data/build/core-medication-pointers-pinned.db \
        --report data/build/core-medication-pointers-pinned-report.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

from localmed_ingest.sqlite_builder import schema_sql, secondary_indexes_sql
from localmed_ingest.sqlite_composer import _rebuild_chunks_fts, _source_set_digest


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return f"sha256:{digest.hexdigest()}"


def pin_medication_pointers(source: Path, pinned_ids_path: Path, output: Path) -> dict[str, object]:
    source = source.resolve()
    output = output.resolve()
    if source == output:
        raise ValueError("Pinned output must differ from the source core database.")

    pinned_ids: list[str] = json.loads(pinned_ids_path.read_text(encoding="utf-8"))
    if len(pinned_ids) != len(set(pinned_ids)):
        raise ValueError("Pinned medication id list contains duplicates.")
    pinned_ids_hash = _sha256_file(pinned_ids_path)

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)

    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA page_size = 16384")
        connection.execute("PRAGMA journal_mode = OFF")
        connection.execute("PRAGMA synchronous = OFF")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.executescript(schema_sql(include_indexes=False))
        connection.execute("ATTACH DATABASE ? AS src", (str(source),))

        placeholders = ",".join("?" for _ in pinned_ids)
        found = {
            row[0]
            for row in connection.execute(
                f"SELECT id FROM src.documents WHERE id IN ({placeholders})", pinned_ids
            )
        }
        missing = sorted(set(pinned_ids) - found)

        connection.execute("BEGIN")
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('schema_version', "
            "(SELECT value FROM src.app_metadata WHERE key = 'schema_version'))"
        )
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('publication_state', 'local-dev')"
        )
        connection.execute(
            """INSERT INTO content_packs(id, version, schema_version, title, checksum, installed_at, enabled)
            SELECT 'minimed.core.medication.pinned', version, schema_version,
                   'MiniMed medication pointers (pinned to released core.db)', '', installed_at, 1
            FROM src.content_packs LIMIT 1"""
        )
        connection.execute(
            f"""INSERT INTO documents(id, content_pack_id, title, short_title, source_type,
                status, specialty_json, metadata_json, current_version_id)
            SELECT id, 'minimed.core.medication.pinned', title, short_title, source_type,
                   status, specialty_json, metadata_json, current_version_id
            FROM src.documents WHERE id IN ({placeholders})""",
            pinned_ids,
        )
        connection.execute(
            """INSERT INTO document_versions(id, document_id, version_label, effective_from,
                effective_to, source_checksum, extracted_at)
            SELECT dv.id, dv.document_id, dv.version_label, dv.effective_from,
                   dv.effective_to, dv.source_checksum, dv.extracted_at
            FROM src.document_versions dv
            JOIN main.documents d ON d.current_version_id = dv.id"""
        )
        connection.execute(
            """INSERT INTO sections(id, document_version_id, parent_section_id, title,
                normalized_title, section_type, depth, order_index, page_start, page_end,
                anchor, path_json)
            SELECT s.id, s.document_version_id, s.parent_section_id, s.title,
                   s.normalized_title, s.section_type, s.depth, s.order_index, s.page_start,
                   s.page_end, s.anchor, s.path_json
            FROM src.sections s
            JOIN main.document_versions dv ON dv.id = s.document_version_id"""
        )
        connection.execute(
            """INSERT INTO chunks(id, document_version_id, section_id, order_index,
                original_text, normalized_text, page_start, page_end, char_start, char_end,
                previous_chunk_id, next_chunk_id, anchor, metadata_json)
            SELECT c.id, c.document_version_id, c.section_id, c.order_index,
                   c.original_text, c.normalized_text, c.page_start, c.page_end, c.char_start,
                   c.char_end, c.previous_chunk_id, c.next_chunk_id, c.anchor, c.metadata_json
            FROM src.chunks c
            JOIN main.document_versions dv ON dv.id = c.document_version_id"""
        )
        # The flat `aliases` table has no per-document foreign key; each medication pointer's
        # declared aliases were written with canonical_term = the pointer's title
        # (_core_medication_pointer_document), so joining on title scopes them correctly.
        connection.execute(
            """INSERT INTO aliases(id, canonical_term, alias, category, weight)
            SELECT a.id, a.canonical_term, a.alias, a.category, a.weight
            FROM src.aliases a
            JOIN main.documents d ON d.title = a.canonical_term"""
        )
        documents_remaining = connection.execute("SELECT count(*) FROM documents").fetchone()[0]
        chunks_remaining = connection.execute("SELECT count(*) FROM chunks").fetchone()[0]
        aliases_remaining = connection.execute("SELECT count(*) FROM aliases").fetchone()[0]
        connection.commit()
        connection.execute("DETACH DATABASE src")

        for statement in secondary_indexes_sql():
            connection.execute(statement)
        _rebuild_chunks_fts(connection)
        digest = _source_set_digest(connection)
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('source_set_digest', ?)",
            (digest,),
        )
        connection.execute("UPDATE content_packs SET checksum = ?", (digest,))
        connection.commit()

        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        fk_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or fk_violations:
            raise ValueError(
                f"Pinned medication pointer pack failed integrity checks: {integrity}, "
                f"{len(fk_violations)} FK violations."
            )
    except Exception:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise
    connection.close()
    temporary.replace(output)

    return {
        "source": str(source),
        "pinnedIdsFile": str(pinned_ids_path),
        "pinnedIdsSha256": pinned_ids_hash,
        "pinnedCount": len(pinned_ids),
        "foundCount": len(found),
        "missingIds": missing,
        "documentsRemaining": documents_remaining,
        "chunksRemaining": chunks_remaining,
        "aliasesRemaining": aliases_remaining,
        "outputChecksum": _sha256_file(output),
        "sqliteIntegrity": "ok",
        "foreignKeyViolations": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--pinned-ids", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = pin_medication_pointers(args.source, args.pinned_ids, args.output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if report["missingIds"]:
        raise SystemExit(
            f"{len(report['missingIds'])} pinned medication ids were not found in {args.source} "
            "-- the source core.db no longer matches the pin. Investigate before proceeding."
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
