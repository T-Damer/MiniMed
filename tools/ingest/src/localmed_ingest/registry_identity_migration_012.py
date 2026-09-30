"""Restore the eight issued public-pilot chunk identities retained by migration 007."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from pathlib import Path
from typing import cast

from localmed_ingest.edition_manifest import sha256_file
from localmed_ingest.markdown_parser import parse_markdown_document, stable_id
from localmed_ingest.normalization import normalize_surface_text
from localmed_ingest.registry_copy_migration_007 import NEW_LABEL, OLD_LABEL
from localmed_ingest.sqlite_composer import (
    _rebuild_chunks_fts,  # pyright: ignore[reportPrivateUsage]
    _validate_fts,  # pyright: ignore[reportPrivateUsage]
)

MIGRATION_ID = "012-registry-issued-chunk-identities"
ISSUED_IDENTITIES = {
    "drug.rf.amoxicillin-clavulanate.suspension-400-57": "chunk.5ef6c7113d8f5fdf",
    "drug.rf.amoxicillin.tablets-500": "chunk.35fef50290ecf58f",
    "drug.rf.azithromycin.suspension-200mg-5ml": "chunk.7142363f43639b5c",
    "drug.rf.ceftriaxone.injection-1g": "chunk.a0322c4239fad577",
    "drug.rf.ibuprofen.pediatric-suspension": "chunk.77115f24d182141d",
    "drug.rf.oral-rehydration-salts.powder-18-9g": "chunk.a3db70a869d4b4eb",
    "drug.rf.oseltamivir.capsules-30mg": "chunk.bf824f9cc712e695",
    "drug.rf.paracetamol.pediatric-suspension": "chunk.c6571f9984f6462b",
}


def _identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _remap_json(value: object, replacements: dict[str, str]) -> object:
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [_remap_json(item, replacements) for item in cast(list[object], value)]
    if isinstance(value, dict):
        return {
            replacements.get(key, key): _remap_json(item, replacements)
            for key, item in cast(dict[str, object], value).items()
        }
    return value


def _restore(connection: sqlite3.Connection, prepared: Path) -> tuple[int, int]:
    documents = [
        parse_markdown_document(path, extracted_at="2026-09-06T00:00:00Z")
        for path in sorted(prepared.glob("*.md"))
    ]
    if len({d.id for d in documents}) != len(documents):
        raise ValueError("Duplicate prepared document identity.")
    actual_ids = {str(row[0]) for row in connection.execute("SELECT id FROM documents")}
    if actual_ids != {d.id for d in documents}:
        raise ValueError("Candidate must contain only the corresponding prepared pilot pack.")
    plans: list[tuple[str, str, str, str]] = []
    found: set[str] = set()
    restored = 0
    for document in documents:
        matching = [
            (section, chunk)
            for section in document.sections
            for chunk in section.chunks
            if NEW_LABEL in chunk.original_text
        ]
        if document.id not in ISSUED_IDENTITIES:
            if matching:
                raise ValueError("Unexpected clarified registry paragraph.")
            continue
        if document.source_type != "official_registry_summary" or len(matching) != 1:
            raise ValueError(f"Expected one administrative registry paragraph: {document.id}")
        section, chunk = matching[0]
        if chunk.original_text.count(NEW_LABEL) != 1 or OLD_LABEL in chunk.original_text:
            raise ValueError(f"Unexpected registry clarification: {document.id}")
        local_order = chunk.metadata.get("localOrder")
        if not isinstance(local_order, int) or isinstance(local_order, bool):
            raise ValueError("Missing prepared localOrder.")
        original_surface = normalize_surface_text(chunk.original_text.replace(NEW_LABEL, OLD_LABEL))
        issued_id = stable_id("chunk", f"{section.id}|{original_surface}|{local_order}")
        if issued_id != ISSUED_IDENTITIES[document.id]:
            raise ValueError(f"Prepared paragraph differs from issued identity: {document.id}")
        issued_anchor = chunk.anchor.rsplit("#chunk-", 1)[0] + "#chunk-" + issued_id[6:14]
        rows = connection.execute(
            """SELECT c.id,c.anchor,c.metadata_json,c.page_start,c.page_end,c.char_start,
                      c.char_end,c.order_index,v.id,v.source_checksum,d.source_type,
                      d.current_version_id,s.anchor,s.title,s.section_type,
                      v.version_label,v.effective_from,v.effective_to
               FROM chunks c JOIN document_versions v ON v.id=c.document_version_id
               JOIN documents d ON d.id=v.document_id JOIN sections s ON s.id=c.section_id
               WHERE d.id=? AND c.section_id=? AND c.original_text=?""",
            (document.id, section.id, chunk.original_text),
        ).fetchall()
        if len(rows) != 1:
            raise ValueError(f"Registry paragraph correspondence is not unique: {document.id}")
        row = rows[0]
        metadata_value: object = json.loads(str(row[2]))
        if not isinstance(metadata_value, dict):
            raise ValueError("Registry chunk metadata must be an object.")
        metadata = cast(dict[str, object], metadata_value)
        if (
            tuple(row[3:8])
            != (
                chunk.page_start,
                chunk.page_end,
                chunk.char_start,
                chunk.char_end,
                chunk.order_index,
            )
            or tuple(row[8:15])
            != (
                document.version.id,
                document.version.source_checksum,
                document.source_type,
                document.version.id,
                section.anchor,
                section.title,
                section.section_type,
            )
            or metadata.get("localOrder") != local_order
            or metadata.get("sourceSpans") != chunk.metadata.get("sourceSpans")
            or tuple(row[15:18])
            != (
                document.version.label,
                document.version.effective_from,
                document.version.effective_to,
            )
        ):
            raise ValueError(f"Registry source/version/span correspondence mismatch: {document.id}")
        current_id, current_anchor = str(row[0]), str(row[1])
        if current_id == issued_id and current_anchor == issued_anchor:
            restored += 1
        elif current_id == chunk.id and current_anchor == chunk.anchor:
            if connection.execute(
                "SELECT id FROM chunks WHERE id=? OR anchor=?", (issued_id, issued_anchor)
            ).fetchone():
                raise ValueError(f"Issued chunk identity collision: {document.id}")
            plans.append((current_id, issued_id, current_anchor, issued_anchor))
        else:
            raise ValueError(f"Unexpected registry chunk identity/anchor: {document.id}")
        found.add(document.id)
    if found != ISSUED_IDENTITIES.keys() or len(plans) + restored != 8:
        raise ValueError("Expected exactly eight issued registry identities.")
    if not plans:
        _validate_fts(connection)
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Restored registry candidate has invalid foreign keys.")
        return 0, restored

    connection.execute("PRAGMA defer_foreign_keys=ON")
    replacements = {key: value for a, b, c, d in plans for key, value in [(a, b), (c, d)]}
    tables = [
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        if not str(row[0]).startswith("chunks_fts")
    ]
    for table in tables:
        quoted = _identifier(table)
        foreign_keys = connection.execute(f"PRAGMA foreign_key_list({quoted})").fetchall()
        for foreign_key in foreign_keys:
            if foreign_key[2] == "chunks" and foreign_key[4] == "id":
                column = _identifier(str(foreign_key[3]))
                for previous, issued, _, _ in plans:
                    connection.execute(
                        f"UPDATE {quoted} SET {column}=? WHERE {column}=?", (issued, previous)
                    )
        columns = connection.execute(f"PRAGMA table_info({quoted})").fetchall()
        for column_info in columns:
            name = str(column_info[1])
            column = _identifier(name)
            if name == "anchor" or name.endswith("_anchor"):
                for _, _, previous_anchor, issued_anchor in plans:
                    connection.execute(
                        f"UPDATE {quoted} SET {column}=? WHERE {column}=?",
                        (issued_anchor, previous_anchor),
                    )
            elif name.endswith("_json"):
                for (payload,) in connection.execute(
                    f"SELECT DISTINCT {column} FROM {quoted} WHERE {column} IS NOT NULL"
                ).fetchall():
                    value = cast(object, json.loads(str(payload)))
                    remapped = _remap_json(value, replacements)
                    if remapped != value:
                        connection.execute(
                            f"UPDATE {quoted} SET {column}=? WHERE {column}=?",
                            (
                                json.dumps(remapped, ensure_ascii=False, separators=(",", ":")),
                                payload,
                            ),
                        )
    for previous, issued, _, issued_anchor in plans:
        connection.execute(
            "UPDATE chunks SET id=?,anchor=? WHERE id=?", (issued, issued_anchor, previous)
        )
    connection.execute(
        "INSERT INTO app_metadata(key,value) VALUES ('registry_identity_migration',?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (MIGRATION_ID,),
    )
    _rebuild_chunks_fts(connection)
    _validate_fts(connection)
    if connection.execute("PRAGMA foreign_key_check").fetchone():
        raise ValueError("Registry identity migration broke foreign keys.")
    return len(plans), restored


def migrate_registry_identities(candidate: Path, prepared: Path) -> dict[str, object]:
    candidate, prepared = candidate.resolve(), prepared.resolve()
    root = Path(__file__).resolve().parents[4]
    if any(candidate.is_relative_to(root / path) for path in ["apps", "output", "content"]):
        raise ValueError("Only a generated candidate input may be migrated.")
    before = sha256_file(candidate)
    temporary = candidate.with_suffix(candidate.suffix + ".migration012.partial")
    if temporary.exists():
        raise ValueError("Registry identity migration staging file already exists.")
    shutil.copyfile(candidate, temporary)
    connection = sqlite3.connect(temporary)
    try:
        with connection:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("BEGIN IMMEDIATE")
            changed, restored = _restore(connection, prepared)
            if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Registry identity migration failed integrity checks.")
        connection.close()
        if sha256_file(candidate) != before:
            raise ValueError("Candidate input changed during migration.")
        temporary.replace(candidate)
    finally:
        connection.close()
        temporary.unlink(missing_ok=True)
    return {
        "migration": MIGRATION_ID,
        "candidate": str(candidate),
        "prepared": str(prepared),
        "identitiesRestored": changed,
        "identitiesAlreadyRestored": restored,
        "issuedIdentities": dict(ISSUED_IDENTITIES),
        "sourceFileChecksums": {
            path.name: sha256_file(path) for path in sorted(prepared.glob("*.md"))
        },
        "inputChecksum": before,
        "outputChecksum": sha256_file(candidate),
        "sqliteIntegrity": "ok",
        "foreignKeyViolations": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-database", type=Path, required=True)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = migrate_registry_identities(args.candidate_database, args.prepared)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
