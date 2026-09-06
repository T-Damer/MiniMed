"""Apply the GRLS label clarification from prepared registry summaries to a staged core."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from pathlib import Path
from typing import cast

from .edition_manifest import sha256_file
from .markdown_parser import parse_markdown_document
from .normalization import normalize_for_index
from .sqlite_composer import _rebuild_chunks_fts, _source_set_digest, _validate_fts

MIGRATION_ID = "007-registry-summary-label"
OLD_LABEL = "В государственном реестре предельных отпускных цен присутствует"
NEW_LABEL = "В ГРЛС, в разделе предельных отпускных цен, указан"


def migrate_registry_copy(
    source: Path, output: Path, prepared: Path, *, built_at: str
) -> dict[str, object]:
    source, output = source.resolve(), output.resolve()
    if source == output:
        raise ValueError("Use a separate staged output for registry copy migration.")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".partial")
    if temporary.exists():
        raise ValueError(f"A staged output already exists: {temporary}")
    shutil.copyfile(source, temporary)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        changed = 0
        checksums: dict[str, str] = {}
        for path in sorted(prepared.glob("*.md")):
            document = parse_markdown_document(path, extracted_at=built_at)
            if document.source_type != "official_registry_summary":
                continue
            chunks = [chunk for section in document.sections for chunk in section.chunks]
            new_chunks = [chunk for chunk in chunks if NEW_LABEL in chunk.original_text]
            if len(new_chunks) != 1:
                raise ValueError(f"Expected one clarified registration summary in {path}")
            new_chunk = new_chunks[0]
            row = connection.execute(
                "SELECT c.id, c.original_text, c.metadata_json FROM chunks c "
                "JOIN documents d ON d.current_version_id = c.document_version_id "
                "WHERE d.id = ? AND instr(c.original_text, ?) > 0",
                (document.id, OLD_LABEL),
            ).fetchall()
            if len(row) != 1:
                raise ValueError(f"Expected one original registry paragraph for {document.id}")
            chunk_id, old_text, metadata_json = row[0]
            if str(old_text).replace(OLD_LABEL, NEW_LABEL) != new_chunk.original_text:
                raise ValueError(f"Registry migration must only clarify the source label: {path}")
            metadata = cast(dict[str, object], json.loads(str(metadata_json)))
            projection = str(metadata.get("knowledgeProjectionText", ""))
            connection.execute(
                "UPDATE chunks SET original_text = ?, normalized_text = ? WHERE id = ?",
                (
                    new_chunk.original_text,
                    normalize_for_index(f"{new_chunk.normalized_text} {projection}"),
                    chunk_id,
                ),
            )
            connection.execute(
                "UPDATE knowledge_evidence SET evidence_quote = replace(evidence_quote, ?, ?) "
                "WHERE document_id = ? AND chunk_id = ?",
                (OLD_LABEL, NEW_LABEL, document.id, chunk_id),
            )
            connection.execute(
                "UPDATE document_versions SET source_checksum = ? WHERE id = ?",
                (document.version.source_checksum, document.version.id),
            )
            checksums[document.id] = sha256_file(path)
            changed += 1
        if not changed:
            raise ValueError("No prepared registry summaries found.")
        digest = _source_set_digest(connection)
        connection.execute(
            "UPDATE app_metadata SET value = ? WHERE key = 'source_set_digest'", (digest,)
        )
        connection.execute("UPDATE content_packs SET checksum = ?", (digest,))
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('registry_copy_migration', ?)",
            (MIGRATION_ID,),
        )
        _rebuild_chunks_fts(connection)
        _validate_fts(connection)
        connection.commit()
        if (
            connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or connection.execute("PRAGMA foreign_key_check").fetchone()
        ):
            raise ValueError("Registry copy migration failed SQLite integrity checks.")
        connection.close()
        temporary.replace(output)
        return {
            "migration": MIGRATION_ID,
            "summariesUpdated": changed,
            "builtAt": built_at,
            "sourceChecksums": checksums,
            "inputChecksum": sha256_file(source),
            "outputChecksum": sha256_file(output),
            "sqliteIntegrity": "ok",
            "foreignKeyViolations": 0,
        }
    except Exception:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--built-at", required=True)
    args = parser.parse_args()
    report = migrate_registry_copy(args.input, args.output, args.prepared, built_at=args.built_at)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
