"""Apply regenerated MKB pointer Markdown to a staged copy of the core database."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

from .builder import read_yaml_mapping
from .markdown_parser import parse_markdown_document
from .models import Alias, PackDocument
from .sqlite_composer import _rebuild_chunks_fts, _validate_fts

MIGRATION_ID = "005-mkb-pointer-enrichment-v2"
POINTER_PREFIX = "core.catalog.pointer.reference."


def _stage_documents(pointer_root: Path) -> tuple[list[PackDocument], list[Alias], str]:
    module_dir = pointer_root / "minimed.mkb.ru"
    manifest = read_yaml_mapping(module_dir / "manifest.yaml")
    built_at = manifest.get("builtAt")
    if not isinstance(built_at, str) or not built_at.strip():
        raise ValueError("Pointer stage manifest requires builtAt.")
    all_documents = [
        parse_markdown_document(path, extracted_at=built_at)
        for path in sorted(module_dir.glob("*.md"))
    ]
    documents: list[PackDocument] = []
    for document in all_documents:
        target_document_id = document.metadata.get("targetDocumentId")
        if isinstance(target_document_id, str) and target_document_id.startswith("rls.mkb.node."):
            documents.append(document)
    if not documents:
        raise ValueError(f"Pointer stage contains no Markdown documents: {module_dir}")
    ids = [document.id for document in documents]
    if len(ids) != len(set(ids)) or any(not item.startswith(POINTER_PREFIX) for item in ids):
        raise ValueError("Pointer stage contains invalid or duplicate document IDs.")
    raw_aliases = read_yaml_mapping(module_dir / "aliases.yaml").get("aliases", [])
    if not isinstance(raw_aliases, list):
        raise ValueError("Pointer stage aliases.yaml must contain an aliases list.")
    aliases = [Alias.model_validate(item) for item in raw_aliases]
    pointer_prefixes = tuple(f"alias.{document.id}." for document in documents)
    aliases = [alias for alias in aliases if alias.id.startswith(pointer_prefixes)]
    return documents, aliases, built_at


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _definition_provenance(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, dict):
        return None
    fields = ("sourceDocumentId", "sourceDocumentVersionId", "sourceChecksum")
    provenance: list[str] = []
    for field in fields:
        field_value = value.get(field)
        if not isinstance(field_value, str):
            return None
        provenance.append(field_value)
    return tuple(provenance)


def _merged_pointer_metadata(
    existing: dict[str, object], staged: dict[str, object]
) -> dict[str, object]:
    merged = {**existing, **staged}
    existing_definition = existing.get("canonicalDefinition")
    staged_definition = staged.get("canonicalDefinition")
    if existing_definition is not None and (
        staged_definition is None
        or _definition_provenance(existing_definition) != _definition_provenance(staged_definition)
    ):
        merged["canonicalDefinition"] = existing_definition
    definition = merged.get("canonicalDefinition")
    if (
        isinstance(definition, dict)
        and isinstance(definition.get("text"), str)
        and bool(definition["text"].strip())
        and isinstance(definition.get("sourceDocumentId"), str)
        and bool(definition["sourceDocumentId"].strip())
    ):
        merged["referenceCoverage"] = "clinical-definition"
    return merged


def _replace_pointer(
    connection: sqlite3.Connection,
    document: PackDocument,
) -> None:
    existing = connection.execute(
        "SELECT content_pack_id, current_version_id FROM documents WHERE id = ?",
        (document.id,),
    ).fetchone()
    if existing is None:
        raise ValueError(f"Pointer is absent from core database: {document.id}")
    if str(existing[1]) != document.version.id:
        raise ValueError(
            f"Pointer version changed for {document.id}: {existing[1]} != {document.version.id}"
        )
    section_count = int(
        connection.execute(
            "SELECT count(*) FROM sections WHERE document_version_id = ?",
            (document.version.id,),
        ).fetchone()[0]
    )
    chunk_count = int(
        connection.execute(
            "SELECT count(*) FROM chunks WHERE document_version_id = ?",
            (document.version.id,),
        ).fetchone()[0]
    )
    if section_count != 1 or chunk_count != 1:
        raise ValueError(
            f"Pointer {document.id} must have exactly one existing section/chunk; "
            f"found {section_count}/{chunk_count}"
        )
    old_first_section = connection.execute(
        "SELECT id, anchor FROM sections "
        "WHERE document_version_id = ? ORDER BY order_index, id LIMIT 1",
        (document.version.id,),
    ).fetchone()
    old_first_chunk = connection.execute(
        "SELECT id, anchor FROM chunks "
        "WHERE document_version_id = ? ORDER BY order_index, id LIMIT 1",
        (document.version.id,),
    ).fetchone()
    if old_first_section is None or old_first_chunk is None:
        raise ValueError(f"Pointer has no stable source section/chunk: {document.id}")
    sections = sorted(document.sections, key=lambda item: item.order_index)
    stage_chunks = [
        chunk
        for section in sections
        for chunk in sorted(section.chunks, key=lambda item: item.order_index)
    ]
    if not stage_chunks:
        raise ValueError(f"Pointer stage document has no chunks: {document.id}")
    stable_section_id = str(old_first_section[0])
    stable_section_anchor = str(old_first_section[1])
    stable_chunk_id = str(old_first_chunk[0])
    stable_chunk_anchor = str(old_first_chunk[1])
    section_id_map = {
        section.id: stable_section_id if index == 0 else section.id
        for index, section in enumerate(sections)
    }
    chunk_id_map = {
        chunk.id: stable_chunk_id if index == 0 else chunk.id
        for index, chunk in enumerate(stage_chunks)
    }
    section_for_chunk = {chunk.id: section.id for section in sections for chunk in section.chunks}

    existing_metadata = json.loads(
        str(
            connection.execute(
                "SELECT metadata_json FROM documents WHERE id = ?", (document.id,)
            ).fetchone()[0]
        )
    )
    if not isinstance(existing_metadata, dict):
        raise ValueError(f"Pointer {document.id} metadata must be an object.")
    merged_metadata = _merged_pointer_metadata(existing_metadata, document.metadata)
    connection.execute(
        "DELETE FROM chunks WHERE document_version_id = ? AND id != ?",
        (document.version.id, stable_chunk_id),
    )
    connection.execute(
        "DELETE FROM sections WHERE document_version_id = ? AND id != ?",
        (document.version.id, stable_section_id),
    )
    connection.execute(
        """UPDATE documents
           SET title = ?, short_title = ?, source_type = ?, status = ?, specialty_json = ?,
               metadata_json = ?, current_version_id = ?
           WHERE id = ?""",
        (
            document.title,
            document.short_title,
            document.source_type,
            document.status,
            _json(document.specialties),
            _json(merged_metadata),
            document.version.id,
            document.id,
        ),
    )
    connection.execute(
        """UPDATE document_versions
           SET version_label = ?, effective_from = ?, effective_to = ?, source_checksum = ?,
               extracted_at = ?
           WHERE id = ?""",
        (
            document.version.label,
            document.version.effective_from,
            document.version.effective_to,
            document.version.source_checksum,
            document.version.extracted_at,
            document.version.id,
        ),
    )
    for section_index, section in enumerate(sections):
        section_id = section_id_map[section.id]
        values = (
            section_id_map.get(section.parent_section_id or ""),
            section.title,
            section.normalized_title,
            section.section_type,
            section.depth,
            section.order_index,
            section.page_start,
            section.page_end,
            stable_section_anchor if section_index == 0 else section.anchor,
            _json(section.section_path),
        )
        if section_index == 0:
            connection.execute(
                """UPDATE sections SET parent_section_id = ?, title = ?, normalized_title = ?,
                   section_type = ?, depth = ?, order_index = ?, page_start = ?, page_end = ?,
                   anchor = ?, path_json = ? WHERE id = ?""",
                (*values, section_id),
            )
        else:
            connection.execute(
                """INSERT INTO sections(
                   id, document_version_id, parent_section_id, title, normalized_title,
                   section_type, depth, order_index, page_start, page_end, anchor, path_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    section_id,
                    document.version.id,
                    section_id_map.get(section.parent_section_id or ""),
                    *values[1:],
                ),
            )
    flattened = stage_chunks
    for chunk_index, chunk in enumerate(flattened):
        chunk_id = chunk_id_map[chunk.id]
        previous_id = chunk_id_map.get(flattened[chunk_index - 1].id) if chunk_index else None
        next_id = (
            chunk_id_map.get(flattened[chunk_index + 1].id)
            if chunk_index + 1 < len(flattened)
            else None
        )
        values = (
            document.version.id,
            section_id_map[section_for_chunk[chunk.id]],
            chunk.order_index,
            chunk.original_text,
            chunk.normalized_text,
            chunk.page_start,
            chunk.page_end,
            chunk.char_start,
            chunk.char_end,
            previous_id,
            next_id,
            stable_chunk_anchor if chunk_index == 0 else chunk.anchor,
            _json(chunk.metadata),
        )
        if chunk_index == 0:
            connection.execute(
                """UPDATE chunks SET document_version_id = ?, section_id = ?, order_index = ?,
                   original_text = ?, normalized_text = ?, page_start = ?, page_end = ?,
                   char_start = ?, char_end = ?, previous_chunk_id = ?, next_chunk_id = ?,
                   anchor = ?, metadata_json = ? WHERE id = ?""",
                (*values, chunk_id),
            )
        else:
            connection.execute(
                """INSERT INTO chunks(
                   id, document_version_id, section_id, order_index, original_text,
                   normalized_text, page_start, page_end, char_start, char_end,
                   previous_chunk_id, next_chunk_id, anchor, metadata_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (chunk_id, *values),
            )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def migrate_mkb_pointer_database(
    source: Path,
    pointer_root: Path,
    output: Path,
) -> dict[str, object]:
    source = source.resolve()
    output = output.resolve()
    pointer_root = pointer_root.resolve()
    if source == output:
        raise ValueError("Migration output must differ from source core database.")
    documents, aliases, built_at = _stage_documents(pointer_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    shutil.copy2(source, temporary)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        before_ids = {
            str(row[0])
            for row in connection.execute(
                "SELECT id FROM documents WHERE id LIKE ? "
                "AND json_extract(metadata_json, '$.targetDocumentId') LIKE 'rls.mkb.node.%'",
                (f"{POINTER_PREFIX}%",),
            )
        }
        stage_ids = {document.id for document in documents}
        if before_ids != stage_ids:
            raise ValueError(f"Pointer set differs: core={len(before_ids)} stage={len(stage_ids)}")
        with connection:
            for document in documents:
                _replace_pointer(connection, document)
            connection.execute(
                "DELETE FROM aliases WHERE id LIKE 'alias.core.catalog.pointer.reference.rls.mkb.%'"
            )
            connection.executemany(
                "INSERT INTO aliases(id, canonical_term, alias, category, weight) "
                "VALUES (?, ?, ?, ?, ?)",
                [
                    (alias.id, alias.canonical_term, alias.alias, alias.category, alias.weight)
                    for alias in aliases
                ],
            )
            _rebuild_chunks_fts(connection)
            connection.execute(
                "INSERT INTO app_metadata(key, value) VALUES ('mkb_pointer_migration', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (MIGRATION_ID,),
            )
            _validate_fts(connection)
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        after_ids = {
            str(row[0])
            for row in connection.execute(
                "SELECT id FROM documents WHERE id LIKE ? "
                "AND json_extract(metadata_json, '$.targetDocumentId') LIKE 'rls.mkb.node.%'",
                (f"{POINTER_PREFIX}%",),
            )
        }
        if before_ids != after_ids or integrity != "ok" or foreign_keys:
            raise ValueError("MKB pointer migration failed identity or integrity checks.")
        report: dict[str, object] = {
            "migration": MIGRATION_ID,
            "pointersUpdated": len(documents),
            "aliasesUpdated": len(aliases),
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
            "warnings": [],
            "errors": [],
            "sqliteIntegrity": integrity,
            "foreignKeyViolations": foreign_keys,
        }
        temporary.replace(output)
        report["outputChecksum"] = _sha256_file(output)
        return report
    except Exception:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise
    finally:
        if connection is not None:
            connection.close()


def write_mkb_pointer_migration_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
