"""Append verified clinical-definition previews to a staged core database."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from pathlib import Path
from typing import cast

from .builder import read_yaml_mapping
from .catalog_module_builder import _load_ledger
from .markdown_parser import parse_markdown_document
from .models import PackDocument, PackSection
from .sqlite_composer import _rebuild_chunks_fts, _validate_fts

MIGRATION_ID = "006-clinical-definition-enrichment"
DEFAULT_VERSION = "2026.09.5"
_POINTER_PREFIX = "core.catalog.pointer.clinical."


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _normalized(value: object) -> str:
    return " ".join(str(value).replace("\xa0", " ").split())


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _database_path(root: Path, official_id: str) -> Path:
    if not official_id or "/" in official_id or "\\" in official_id:
        raise ValueError(f"Unsafe clinical official ID: {official_id!r}")
    database_root = root / "databases" if (root / "databases").is_dir() else root
    database_root = database_root.resolve()
    candidate = (database_root / f"{official_id}.db").resolve()
    if candidate.parent != database_root or candidate.name != f"{official_id}.db":
        raise ValueError(f"Unsafe clinical database path for official ID: {official_id!r}")
    if not candidate.is_file():
        raise ValueError(f"Clinical source database is missing: {candidate}")
    return candidate


def _stage_documents(
    pointer_root: Path, expected_version: str
) -> tuple[dict[str, PackDocument], str]:
    module_dir = pointer_root.resolve() / "minimed.core.ru"
    manifest_path = module_dir / "manifest.yaml"
    if not manifest_path.is_file():
        raise ValueError(f"Clinical pointer stage is missing manifest.yaml: {module_dir}")
    manifest = read_yaml_mapping(manifest_path)
    if manifest.get("version") != expected_version:
        raise ValueError(
            f"Clinical pointer stage is stale: {manifest.get('version')!r} != {expected_version!r}"
        )
    built_at = manifest.get("builtAt")
    if not isinstance(built_at, str) or not built_at.strip():
        raise ValueError("Clinical pointer stage manifest requires builtAt.")

    documents: dict[str, PackDocument] = {}
    for path in sorted(module_dir.glob("*.md")):
        document = parse_markdown_document(path, extracted_at=built_at)
        metadata = document.metadata
        if metadata.get("catalogFamily") != "clinical":
            continue
        target_id = metadata.get("targetDocumentId")
        if not isinstance(target_id, str) or not target_id:
            raise ValueError(f"Clinical pointer has no targetDocumentId: {document.id}")
        if not document.id.startswith(_POINTER_PREFIX):
            raise ValueError(f"Clinical pointer has invalid ID: {document.id}")
        if target_id in documents:
            raise ValueError(f"Clinical pointer stage has duplicate target: {target_id}")
        documents[target_id] = document
    if not documents:
        raise ValueError(f"Clinical pointer stage contains no clinical Markdown: {module_dir}")
    return documents, built_at


def _definition_section(document: PackDocument, target_id: str) -> PackSection:
    sections = [section for section in document.sections if section.title == "Определение"]
    if len(sections) != 1 or len(sections[0].chunks) != 1:
        raise ValueError(
            f"Clinical pointer {target_id} must contain one generated Определение section/chunk."
        )
    return sections[0]


def _validate_source_definition(
    record: dict[str, object], official_root: Path
) -> tuple[Path, str, dict[str, object]]:
    definition_value = record.get("canonicalDefinition")
    if not isinstance(definition_value, dict):
        raise ValueError(f"Clinical record {record.get('recordId')} has no definition object.")
    definition = cast(dict[str, object], definition_value)
    record_id = record.get("recordId")
    official_id = record.get("officialId")
    if not isinstance(record_id, str) or not isinstance(official_id, str):
        raise ValueError("Clinical definition record requires string recordId and officialId.")
    if definition.get("sourceDocumentId") != record_id:
        raise ValueError(f"Definition source document mismatch for {record_id}.")
    source_path = _database_path(official_root, official_id)
    connection = sqlite3.connect(f"{source_path.as_uri()}?mode=ro", uri=True)
    try:
        document = connection.execute(
            "SELECT id, current_version_id FROM documents WHERE id = ?", (record_id,)
        ).fetchone()
        if document is None:
            raise ValueError(f"Source document is missing for {record_id}: {source_path}")
        version = connection.execute(
            "SELECT id, document_id, source_checksum FROM document_versions WHERE id = ?",
            (definition.get("sourceDocumentVersionId"),),
        ).fetchone()
        if version is None or str(version[0]) != str(document[1]) or str(version[1]) != record_id:
            raise ValueError(f"Definition source version mismatch for {record_id}.")
        section = connection.execute(
            "SELECT title, anchor, page_start, page_end FROM sections WHERE id = ?",
            (definition.get("sourceSectionId"),),
        ).fetchone()
        chunk = connection.execute(
            """SELECT original_text, anchor, page_start, page_end, char_start, char_end,
                      metadata_json
               FROM chunks WHERE id = ? AND document_version_id = ? AND section_id = ?""",
            (
                definition.get("sourceChunkId"),
                definition.get("sourceDocumentVersionId"),
                definition.get("sourceSectionId"),
            ),
        ).fetchone()
        if section is None or chunk is None:
            raise ValueError(f"Definition source section/chunk is missing for {record_id}.")
        if str(definition.get("sourceAnchor")) != str(chunk[1]):
            raise ValueError(f"Definition source anchor mismatch for {record_id}.")
        if definition.get("sourceSectionTitle") != section[0]:
            raise ValueError(f"Definition source section title mismatch for {record_id}.")
        if definition.get("charStart") != chunk[4] or definition.get("charEnd") != chunk[5]:
            raise ValueError(f"Definition source character range mismatch for {record_id}.")
        source_metadata = json.loads(str(chunk[6]))
        if not isinstance(source_metadata, dict):
            raise ValueError(f"Definition source chunk metadata is invalid for {record_id}.")
        source_spans = definition.get("sourceSpans")
        if not isinstance(source_spans, list) or source_spans != source_metadata.get("sourceSpans"):
            raise ValueError(f"Definition source spans mismatch for {record_id}.")
        source_quote = definition.get("sourceQuote")
        definition_text = definition.get("text")
        source_original = _normalized(chunk[0])
        if (
            not isinstance(source_quote, str)
            or not _normalized(source_quote)
            or _normalized(source_quote) not in source_original
        ):
            raise ValueError(f"Definition source quote mismatch for {record_id}.")
        if (
            not isinstance(definition_text, str)
            or not _normalized(definition_text)
            or _normalized(definition_text) not in source_original
        ):
            raise ValueError(f"Definition text mismatch for {record_id}.")
        if definition.get("pageStart") != chunk[2] or definition.get("pageEnd") != chunk[3]:
            raise ValueError(f"Definition source page mismatch for {record_id}.")
        return source_path, str(version[2]), definition
    finally:
        connection.close()


def migrate_clinical_definition_database(
    source: Path,
    pointer_root: Path,
    ledger_path: Path,
    official_documents_root: Path,
    output: Path,
    *,
    expected_version: str = DEFAULT_VERSION,
) -> dict[str, object]:
    """Stage a core copy and append only definitions absent from its pointers."""
    source = source.resolve()
    output = output.resolve()
    if source == output:
        raise ValueError("Migration output must differ from source core database.")
    if output in source.parents:
        raise ValueError("Migration output cannot contain the source core database.")
    ledger = _load_ledger(ledger_path.resolve())
    records = {str(record["recordId"]): record for record in ledger.records}
    staged, built_at = _stage_documents(pointer_root, expected_version)
    if set(records) != set(staged):
        raise ValueError(f"Clinical pointer set differs: ledger={len(records)} stage={len(staged)}")

    core_read = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    try:
        existing_definition_targets = {
            str(row[0])
            for row in core_read.execute(
                """SELECT json_extract(metadata_json, '$.targetDocumentId')
                   FROM documents
                   WHERE source_type = 'core_catalog_pointer'
                     AND json_extract(metadata_json, '$.catalogFamily') = 'clinical'
                     AND json_type(metadata_json, '$.canonicalDefinition') = 'object'"""
            )
        }
    finally:
        core_read.close()

    source_checksums: dict[str, str] = {}
    document_checksums: dict[str, str] = {}
    definitions: dict[str, dict[str, object]] = {}
    for record_id in sorted(records):
        record = records[record_id]
        if record.get("canonicalDefinition") is None:
            continue
        definition_document = staged[record_id].metadata.get("canonicalDefinition")
        if not isinstance(definition_document, dict):
            raise ValueError(f"Generated pointer lost canonical definition for {record_id}.")
        if definition_document != record.get("canonicalDefinition"):
            raise ValueError(f"Generated pointer definition differs from ledger for {record_id}.")
        if record_id in existing_definition_targets:
            continue
        path, source_checksum, definition = _validate_source_definition(
            record, official_documents_root
        )
        source_checksums[record_id] = source_checksum
        document_checksums[record_id] = _sha256_file(path)
        definitions[record_id] = definition

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    shutil.copy2(source, temporary)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        current_rows = connection.execute(
            """SELECT d.id, d.current_version_id, d.metadata_json
               FROM documents d
               WHERE d.source_type = 'core_catalog_pointer'
                 AND json_extract(d.metadata_json, '$.catalogFamily') = 'clinical'
               ORDER BY d.id"""
        ).fetchall()
        current_by_target: dict[str, tuple[str, str, str]] = {}
        for document_id, version_id, metadata_json in current_rows:
            metadata = json.loads(str(metadata_json))
            target_id = metadata.get("targetDocumentId")
            if not isinstance(target_id, str) or target_id in current_by_target:
                raise ValueError(f"Clinical core pointer has invalid target: {document_id}")
            current_by_target[target_id] = (str(document_id), str(version_id), str(metadata_json))
        if set(current_by_target) != set(records):
            raise ValueError(
                f"Clinical pointer set differs: core={len(current_by_target)} ledger={len(records)}"
            )

        added = 0
        preserved = len(
            existing_definition_targets
            & {
                record_id
                for record_id, record in records.items()
                if record.get("canonicalDefinition")
            }
        )
        with connection:
            for record_id in sorted(records):
                document = staged[record_id]
                document_id, current_version_id, _ = current_by_target[record_id]
                if current_version_id != document.version.id:
                    raise ValueError(f"Clinical pointer version changed for {record_id}.")
                definition = definitions.get(record_id)
                if definition is None:
                    continue
                metadata_row = connection.execute(
                    "SELECT metadata_json FROM documents WHERE id = ?", (document_id,)
                ).fetchone()
                if metadata_row is None:
                    raise ValueError(f"Clinical pointer is absent from core: {document_id}")
                metadata = json.loads(str(metadata_row[0]))
                if not isinstance(metadata, dict):
                    raise ValueError(f"Clinical pointer metadata is not an object: {document_id}")
                if isinstance(metadata.get("canonicalDefinition"), dict):
                    continue
                section = _definition_section(document, record_id)
                chunk = section.chunks[0]
                section_order = (
                    int(
                        connection.execute(
                            "SELECT COALESCE(max(order_index), -1) FROM sections "
                            "WHERE document_version_id = ?",
                            (document.version.id,),
                        ).fetchone()[0]
                    )
                    + 1
                )
                chunk_order = (
                    int(
                        connection.execute(
                            "SELECT COALESCE(max(order_index), -1) FROM chunks "
                            "WHERE document_version_id = ?",
                            (document.version.id,),
                        ).fetchone()[0]
                    )
                    + 1
                )
                connection.execute(
                    """INSERT INTO sections(
                       id, document_version_id, parent_section_id, title, normalized_title,
                       section_type, depth, order_index, page_start, page_end, anchor, path_json
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        section.id,
                        document.version.id,
                        None,
                        section.title,
                        section.normalized_title,
                        section.section_type,
                        section.depth,
                        section_order,
                        section.page_start,
                        section.page_end,
                        section.anchor,
                        _json(section.section_path),
                    ),
                )
                connection.execute(
                    """INSERT INTO chunks(
                       id, document_version_id, section_id, order_index, original_text,
                       normalized_text, page_start, page_end, char_start, char_end,
                       previous_chunk_id, next_chunk_id, anchor, metadata_json
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        chunk.id,
                        document.version.id,
                        section.id,
                        chunk_order,
                        chunk.original_text,
                        chunk.normalized_text,
                        chunk.page_start,
                        chunk.page_end,
                        chunk.char_start,
                        chunk.char_end,
                        None,
                        None,
                        chunk.anchor,
                        _json(chunk.metadata),
                    ),
                )
                metadata["canonicalDefinition"] = definition
                metadata["definitionPreviewAnchor"] = chunk.anchor
                connection.execute(
                    "UPDATE documents SET metadata_json = ? WHERE id = ?",
                    (_json(metadata), document_id),
                )
                added += 1
            _rebuild_chunks_fts(connection)
            connection.execute(
                "INSERT INTO app_metadata(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                ("clinical_definition_migration", MIGRATION_ID),
            )
            _validate_fts(connection)

        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        if integrity != "ok" or foreign_keys:
            raise ValueError("Clinical definition migration failed SQLite integrity checks.")
        report: dict[str, object] = {
            "migration": MIGRATION_ID,
            "pointersUpdated": added,
            "definitionsAdded": added,
            "definitionsPreserved": preserved,
            "aliasesUpdated": 0,
            "builtAt": built_at,
            "documents": int(connection.execute("SELECT count(*) FROM documents").fetchone()[0]),
            "sections": int(connection.execute("SELECT count(*) FROM sections").fetchone()[0]),
            "chunks": int(connection.execute("SELECT count(*) FROM chunks").fetchone()[0]),
            "aliases": int(connection.execute("SELECT count(*) FROM aliases").fetchone()[0]),
            "embeddingProfiles": int(
                connection.execute("SELECT count(*) FROM embedding_profiles").fetchone()[0]
            ),
            "embeddings": int(
                connection.execute("SELECT count(*) FROM chunk_embeddings").fetchone()[0]
            ),
            "sourceChecksums": {
                "ledger": _sha256_file(ledger_path.resolve()),
                "documentVersions": source_checksums,
                "sourceDatabases": document_checksums,
            },
            "warnings": [],
            "errors": [],
            "sqliteIntegrity": integrity,
            "foreignKeyViolations": foreign_keys,
        }
        connection.close()
        temporary.replace(output)
        report["outputChecksum"] = _sha256_file(output)
        return report
    except Exception:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise


def write_clinical_definition_migration_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
