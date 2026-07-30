from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from .edition_manifest import (
    EditionManifest,
    sha256_file,
    validate_local_edition_manifest,
    write_edition_manifest,
)
from .models import CamelModel, SourceProvenance
from .sqlite_builder import inspect_integrity, schema_sql


@dataclass(frozen=True)
class TableSpec:
    name: str
    columns: tuple[str, ...]
    key_columns: tuple[str, ...]
    order_by: str


TABLES = (
    TableSpec(
        "documents",
        (
            "id",
            "title",
            "short_title",
            "source_type",
            "status",
            "specialty_json",
            "metadata_json",
            "current_version_id",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "document_versions",
        (
            "id",
            "document_id",
            "version_label",
            "effective_from",
            "effective_to",
            "source_checksum",
            "extracted_at",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "sections",
        (
            "id",
            "document_version_id",
            "parent_section_id",
            "title",
            "normalized_title",
            "section_type",
            "depth",
            "order_index",
            "page_start",
            "page_end",
            "anchor",
            "path_json",
        ),
        ("id",),
        "depth, order_index, id",
    ),
    TableSpec(
        "chunks",
        (
            "id",
            "document_version_id",
            "section_id",
            "order_index",
            "original_text",
            "normalized_text",
            "page_start",
            "page_end",
            "char_start",
            "char_end",
            "previous_chunk_id",
            "next_chunk_id",
            "anchor",
            "metadata_json",
        ),
        ("id",),
        "order_index, id",
    ),
    TableSpec(
        "aliases",
        ("id", "canonical_term", "alias", "category", "weight"),
        ("id",),
        "id",
    ),
    TableSpec(
        "knowledge_entities",
        (
            "id",
            "entity_type",
            "canonical_name",
            "normalized_name",
            "external_ids_json",
            "metadata_json",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "knowledge_names",
        ("id", "entity_id", "name", "normalized_name", "language", "name_type", "weight"),
        ("id",),
        "id",
    ),
    TableSpec(
        "medication_profiles",
        (
            "entity_id",
            "concept_level",
            "inn",
            "atc_code",
            "dosage_form",
            "route",
            "strength",
            "registration_number",
            "registration_status",
            "pediatric_status",
            "metadata_json",
        ),
        ("entity_id",),
        "entity_id",
    ),
    TableSpec(
        "knowledge_facts",
        (
            "id",
            "entity_id",
            "fact_type",
            "original_text",
            "structured_json",
            "population_json",
            "approval_status",
            "authority_tier",
            "review_status",
            "jurisdiction",
            "confidence",
            "valid_from",
            "valid_to",
            "metadata_json",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "knowledge_relations",
        (
            "id",
            "subject_entity_id",
            "predicate",
            "object_entity_id",
            "relation_status",
            "authority_tier",
            "review_status",
            "jurisdiction",
            "final_weight",
            "weight_components_json",
            "valid_from",
            "valid_to",
            "metadata_json",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "knowledge_evidence",
        (
            "id",
            "fact_id",
            "relation_id",
            "document_id",
            "document_version_id",
            "section_id",
            "chunk_id",
            "evidence_quote",
            "source_locator_json",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "knowledge_document_links",
        (
            "id",
            "entity_id",
            "document_id",
            "document_version_id",
            "section_id",
            "chunk_id",
            "link_type",
            "weight",
            "review_status",
            "metadata_json",
        ),
        ("id",),
        "id",
    ),
    TableSpec(
        "knowledge_review_tasks",
        (
            "id",
            "task_type",
            "target_id",
            "question",
            "missing_fields_json",
            "priority",
            "status",
            "metadata_json",
        ),
        ("id",),
        "id",
    ),
)


class ComposeReport(CamelModel):
    inputs: list[str]
    documents: int
    sections: int
    chunks: int
    aliases: int
    source_set_digest: str
    discarded_embedding_profiles: int
    discarded_embeddings: int
    output_checksum: str
    sqlite_integrity: str
    foreign_key_violations: int
    edition_manifest: str
    elapsed_ms: int
    output_size_bytes: int
    staging_size_bytes: int


def resolve_input_databases(inputs: list[Path]) -> list[Path]:
    resolved: set[Path] = set()
    for source in inputs:
        if source.is_file() and source.suffix == ".db":
            resolved.add(source.resolve())
        elif source.is_dir():
            resolved.update(path.resolve() for path in source.rglob("*.db") if path.is_file())
        else:
            raise ValueError(f"Composer input is not a SQLite database or directory: {source}")
    if not resolved:
        raise ValueError("Composer needs at least one input SQLite database.")
    return sorted(resolved)


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _validate_input(connection: sqlite3.Connection, path: Path, schema_version: int) -> None:
    integrity = connection.execute("PRAGMA integrity_check").fetchone()
    if integrity is None or integrity[0] != "ok":
        raise ValueError(f"Input database failed integrity check: {path}")
    if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError(f"Input database has foreign-key violations: {path}")
    for spec in TABLES:
        missing = set(spec.columns) - _table_columns(connection, spec.name)
        if missing:
            raise ValueError(f"Input database {path} lacks {spec.name} columns: {sorted(missing)}")
    packs = connection.execute(
        "SELECT id, schema_version FROM content_packs ORDER BY id"
    ).fetchall()
    if len(packs) != 1:
        raise ValueError(f"Input database must contain exactly one content pack: {path}")
    if int(packs[0][1]) != schema_version:
        raise ValueError(
            f"Input database {path} schema version {packs[0][1]} != requested {schema_version}."
        )


def _check_current_documents(connection: sqlite3.Connection, path: Path) -> set[str]:
    """Reject source rows that cannot be selected as one current document version."""
    documents = connection.execute(
        "SELECT id, current_version_id FROM documents ORDER BY id"
    ).fetchall()
    current_versions: dict[str, str] = {}
    for document_id, version_id in documents:
        matching = connection.execute(
            "SELECT 1 FROM document_versions WHERE id = ? AND document_id = ?",
            (version_id, document_id),
        ).fetchone()
        if matching is None:
            raise ValueError(
                f"Input database {path} current version {version_id} does not belong to "
                f"document {document_id}."
            )
        current_versions[str(document_id)] = str(version_id)

    for table in ("sections", "chunks"):
        row = connection.execute(
            f"""SELECT {table}.id FROM {table}
            JOIN document_versions dv ON dv.id = {table}.document_version_id
            JOIN documents d ON d.id = dv.document_id
            WHERE {table}.document_version_id != d.current_version_id LIMIT 1"""
        ).fetchone()
        if row is not None:
            raise ValueError(f"Input database {path} has non-current {table} row {row[0]}.")

    chunk_mismatch = connection.execute(
        """SELECT c.id FROM chunks c
        JOIN document_versions chunk_version ON chunk_version.id = c.document_version_id
        LEFT JOIN sections s ON s.id = c.section_id
        LEFT JOIN document_versions section_version ON section_version.id = s.document_version_id
        WHERE s.id IS NULL
           OR s.document_version_id != c.document_version_id
           OR section_version.document_id != chunk_version.document_id
        LIMIT 1"""
    ).fetchone()
    if chunk_mismatch is not None:
        raise ValueError(
            f"Input database {path} chunk {chunk_mismatch[0]} does not match its section "
            "document/version."
        )

    for table in ("knowledge_evidence", "knowledge_document_links"):
        row = connection.execute(
            f"""SELECT e.id FROM {table} e
            JOIN documents d ON d.id = e.document_id
            LEFT JOIN document_versions dv ON dv.id = e.document_version_id
            LEFT JOIN sections s ON s.id = e.section_id
            LEFT JOIN chunks c ON c.id = e.chunk_id
            WHERE e.document_version_id != d.current_version_id
               OR dv.document_id != e.document_id
               OR (s.id IS NOT NULL AND s.document_version_id != e.document_version_id)
               OR (c.id IS NOT NULL AND c.document_version_id != e.document_version_id)
            LIMIT 1"""
        ).fetchone()
        if row is not None:
            raise ValueError(
                f"Input database {path} has invalid current-version {table} row {row[0]}."
            )

    return set(current_versions)


def _preflight_sources(sources: list[Path], schema_version: int) -> dict[Path, set[str]]:
    selected: dict[Path, set[str]] = {}
    document_owners: dict[str, Path] = {}
    for path in sources:
        connection = sqlite3.connect(path)
        try:
            _validate_input(connection, path, schema_version)
            document_ids = _check_current_documents(connection, path)
        finally:
            connection.close()
        selected[path] = set()
        for document_id in document_ids:
            previous = document_owners.get(document_id)
            if previous is None:
                document_owners[document_id] = path
                selected[path].add(document_id)
            else:
                raise ValueError(
                    f"Duplicate document {document_id} in distinct input databases: "
                    f"{previous} and {path}."
                )
    return selected


def _filtered_query(spec: TableSpec, document_ids: set[str]) -> tuple[str, tuple[object, ...]]:
    columns = ", ".join(spec.columns)
    if not document_ids:
        return f"SELECT {columns} FROM {spec.name} WHERE 0", ()
    placeholders = ", ".join("?" for _ in document_ids)
    selected_versions = f"SELECT current_version_id FROM documents WHERE id IN ({placeholders})"
    document_bound = {
        "documents": f"id IN ({placeholders})",
        "document_versions": f"document_id IN ({placeholders}) AND id IN ({selected_versions})",
        "sections": f"document_version_id IN ({selected_versions})",
        "chunks": f"document_version_id IN ({selected_versions})",
        "knowledge_evidence": (
            f"document_id IN ({placeholders}) AND document_version_id IN ({selected_versions})"
        ),
        "knowledge_document_links": (
            f"document_id IN ({placeholders}) AND document_version_id IN ({selected_versions})"
        ),
    }
    clause = document_bound.get(spec.name)
    if clause is None:
        return f"SELECT {columns} FROM {spec.name} ORDER BY {spec.order_by}", ()
    repeats = (
        2
        if spec.name
        in {
            "document_versions",
            "knowledge_evidence",
            "knowledge_document_links",
        }
        else 1
    )
    values = tuple(sorted(document_ids)) * repeats
    return f"SELECT {columns} FROM {spec.name} WHERE {clause} ORDER BY {spec.order_by}", values


def _copy_rows(
    target: sqlite3.Connection,
    source: sqlite3.Connection,
    spec: TableSpec,
    edition_id: str,
    document_ids: set[str],
) -> None:
    query, query_values = _filtered_query(spec, document_ids)
    target_columns = (
        ("id", "content_pack_id", *spec.columns[1:]) if spec.name == "documents" else spec.columns
    )
    columns = ", ".join(target_columns)
    values = ", ".join("?" for _ in target_columns)
    key_indexes = tuple(spec.columns.index(column) for column in spec.key_columns)
    key_clause = " AND ".join(f"{column} = ?" for column in spec.key_columns)
    for row in source.execute(query, query_values):
        record = tuple(row)
        target_record = (record[0], edition_id, *record[1:]) if spec.name == "documents" else record
        try:
            target.execute(f"INSERT INTO {spec.name} ({columns}) VALUES ({values})", target_record)
        except sqlite3.IntegrityError as error:
            key = tuple(record[index] for index in key_indexes)
            existing = target.execute(
                f"SELECT {', '.join(spec.columns)} FROM {spec.name} WHERE {key_clause}", key
            ).fetchone()
            if existing is not None and tuple(existing) == record:
                continue
            raise ValueError(f"Conflicting {spec.name} row for key {key}.") from error


def _rebuild_chunks_fts(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM chunks_fts")
    rows = connection.execute(
        """SELECT c.id, d.id, c.document_version_id, c.section_id, c.anchor,
                  d.title, s.path_json, c.normalized_text
           FROM chunks c
           JOIN document_versions dv ON dv.id = c.document_version_id
           JOIN documents d ON d.id = dv.document_id
           JOIN sections s ON s.id = c.section_id
           ORDER BY c.id"""
    )
    for row in rows:
        path = json.loads(str(row[6]))
        if not isinstance(path, list) or not all(isinstance(item, str) for item in path):
            raise ValueError(f"Section {row[3]} has invalid path_json.")
        connection.execute(
            """INSERT INTO chunks_fts(
                chunk_id, document_id, document_version_id, section_id, anchor,
                title, section_path, normalized_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (*row[:6], " ".join(path), row[7]),
        )


def _rebuild_knowledge_fts(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM knowledge_fts")
    names: dict[str, list[str]] = defaultdict(list)
    for entity_id, name in connection.execute(
        "SELECT entity_id, name FROM knowledge_names ORDER BY id"
    ):
        names[str(entity_id)].append(str(name))
    facts: dict[str, list[str]] = defaultdict(list)
    for entity_id, fact_type, text in connection.execute(
        "SELECT entity_id, fact_type, original_text FROM knowledge_facts "
        "WHERE review_status = 'reviewed' ORDER BY id"
    ):
        facts[str(entity_id)].extend([str(fact_type), str(text)])
    canonical_names = {
        str(entity_id): str(name)
        for entity_id, name in connection.execute(
            "SELECT id, canonical_name FROM knowledge_entities"
        )
    }
    relations: dict[str, list[str]] = defaultdict(list)
    for subject, predicate, object_id, status in connection.execute(
        "SELECT subject_entity_id, predicate, object_entity_id, relation_status "
        "FROM knowledge_relations WHERE review_status = 'reviewed' ORDER BY id"
    ):
        text = " ".join(
            [
                canonical_names[str(subject)],
                str(predicate),
                canonical_names[str(object_id)],
                str(status),
            ]
        )
        relations[str(subject)].append(text)
        relations[str(object_id)].append(text)
    for entity_id in sorted(canonical_names):
        entity_facts = facts[entity_id]
        entity_relations = relations[entity_id]
        if not entity_facts and not entity_relations:
            continue
        connection.execute(
            "INSERT INTO knowledge_fts(entity_id, canonical_name, aliases, facts, relations) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                entity_id,
                canonical_names[entity_id],
                " ".join([canonical_names[entity_id], *names[entity_id]]),
                " ".join(entity_facts),
                " ".join(entity_relations),
            ),
        )


def _source_set_digest(connection: sqlite3.Connection) -> str:
    rows = [
        {"documentId": row[0], "documentVersionId": row[1], "sourceChecksum": row[2]}
        for row in connection.execute(
            """SELECT d.id, dv.id, dv.source_checksum
            FROM documents d JOIN document_versions dv ON dv.document_id = d.id
            ORDER BY d.id, dv.id"""
        )
    ]
    encoded = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _local_edition_manifest(database: Path) -> EditionManifest:
    connection = sqlite3.connect(database)
    try:
        pack = connection.execute("SELECT id, version FROM content_packs").fetchone()
        if pack is None:
            raise ValueError("Composed database has no content pack.")
        sources = []
        for document_id, version_id, checksum, metadata_json in connection.execute(
            """SELECT d.id, dv.id, dv.source_checksum, d.metadata_json
            FROM documents d JOIN document_versions dv ON dv.document_id = d.id
            ORDER BY d.id, dv.id"""
        ):
            metadata = json.loads(str(metadata_json))
            raw_provenance = metadata.get("provenance") if isinstance(metadata, dict) else None
            provenance = (
                SourceProvenance.model_validate(raw_provenance)
                if isinstance(raw_provenance, dict)
                else None
            )
            sources.append(
                {
                    "documentId": str(document_id),
                    "documentVersionId": str(version_id),
                    "sourceChecksum": str(checksum),
                    **(
                        {"provenance": provenance.model_dump(by_alias=True, mode="json")}
                        if provenance is not None
                        else {}
                    ),
                }
            )
        return EditionManifest(
            edition_id=str(pack[0]),
            edition_version=str(pack[1]),
            database_sha256=sha256_file(database),
            publishability="local-dev",
            sources=sources,
        )
    finally:
        connection.close()


def _table_count(database: Path, table: str) -> int:
    connection = sqlite3.connect(database)
    try:
        return int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])
    finally:
        connection.close()


def _validate_output_paths(inputs: list[Path], output: Path, manifest: Path) -> None:
    output = output.resolve()
    manifest = manifest.resolve()
    if output == manifest:
        raise ValueError("Composer database and edition manifest must be different files.")
    if output.parent != manifest.parent:
        raise ValueError("Composer database and edition manifest must share one output directory.")
    for source in inputs:
        if source.is_dir():
            root = source.resolve()
            if output.is_relative_to(root) or manifest.is_relative_to(root):
                raise ValueError("Composer output must not be inside a recursive input directory.")
        elif source.resolve() in {output, manifest}:
            raise ValueError("Composer output cannot also be an input database.")


def _replace_staged_pair(
    staged_database: Path,
    staged_manifest: Path,
    output: Path,
    manifest_output: Path,
) -> None:
    backup_database = output.with_name(f".{output.name}.backup-{uuid4().hex}")
    backup_manifest = manifest_output.with_name(f".{manifest_output.name}.backup-{uuid4().hex}")
    had_database = output.exists()
    had_manifest = manifest_output.exists()
    database_installed = False
    manifest_installed = False
    try:
        if had_database:
            output.replace(backup_database)
        if had_manifest:
            manifest_output.replace(backup_manifest)
        staged_database.replace(output)
        database_installed = True
        staged_manifest.replace(manifest_output)
        manifest_installed = True
    except Exception:
        if database_installed:
            output.unlink(missing_ok=True)
        if manifest_installed:
            manifest_output.unlink(missing_ok=True)
        if had_database and backup_database.exists():
            backup_database.replace(output)
        if had_manifest and backup_manifest.exists():
            backup_manifest.replace(manifest_output)
        raise
    else:
        backup_database.unlink(missing_ok=True)
        backup_manifest.unlink(missing_ok=True)


def compose_sqlite_packs(
    inputs: list[Path],
    output: Path,
    edition_manifest_output: Path,
    *,
    edition_id: str,
    edition_version: str,
    title: str,
    built_at: str,
    schema_version: int = 2,
    compact: bool = False,
    manifest_writer: Callable[[Path, EditionManifest], None] = write_edition_manifest,
) -> ComposeReport:
    started_at = perf_counter()
    sources = resolve_input_databases(inputs)
    _validate_output_paths(inputs, output, edition_manifest_output)
    output.parent.mkdir(parents=True, exist_ok=True)
    selected_documents = _preflight_sources(sources, schema_version)
    temporary = output.with_name(f".{output.name}.stage-{uuid4().hex}")
    temporary_manifest = edition_manifest_output.with_name(
        f".{edition_manifest_output.name}.stage-{uuid4().hex}"
    )
    target = sqlite3.connect(temporary)
    discarded_profiles = 0
    discarded_embeddings = 0
    staged_database_ready = False
    try:
        target.execute("PRAGMA page_size = 4096")
        target.execute("PRAGMA journal_mode = OFF")
        target.execute("PRAGMA synchronous = OFF")
        target.executescript(schema_sql())
        target.execute("BEGIN")
        target.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
            (schema_version, built_at),
        )
        target.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('schema_version', ?)",
            (str(schema_version),),
        )
        target.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('publication_state', 'local-dev')"
        )
        target.execute(
            """INSERT INTO content_packs(
                id, version, schema_version, title, checksum, installed_at, enabled
            )
            VALUES (?, ?, ?, ?, '', ?, 1)""",
            (edition_id, edition_version, schema_version, title, built_at),
        )
        for path in sources:
            source = sqlite3.connect(path)
            try:
                discarded_profiles += int(
                    source.execute("SELECT count(*) FROM embedding_profiles").fetchone()[0]
                )
                discarded_embeddings += int(
                    source.execute("SELECT count(*) FROM chunk_embeddings").fetchone()[0]
                )
                for spec in TABLES:
                    _copy_rows(target, source, spec, edition_id, selected_documents[path])
            finally:
                source.close()
        _rebuild_chunks_fts(target)
        _rebuild_knowledge_fts(target)
        source_digest = _source_set_digest(target)
        target.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('source_set_digest', ?)",
            (source_digest,),
        )
        target.execute("UPDATE content_packs SET checksum = ?", (source_digest,))
        target.commit()
        if compact:
            target.execute("VACUUM")
        staged_database_ready = True
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()
        if not staged_database_ready:
            temporary.unlink(missing_ok=True)
    try:
        integrity, foreign_keys, chunks, fts_rows, profiles, embeddings = inspect_integrity(
            temporary
        )
        if integrity != "ok" or foreign_keys or chunks != fts_rows or profiles or embeddings:
            raise ValueError("Composed database failed deterministic integrity checks.")
        manifest = _local_edition_manifest(temporary)
        validate_local_edition_manifest(manifest, temporary)
        manifest_writer(temporary_manifest, manifest)
        written_manifest = EditionManifest.model_validate_json(
            temporary_manifest.read_text(encoding="utf-8")
        )
        validate_local_edition_manifest(written_manifest, temporary)
        staging_size = temporary.stat().st_size + temporary_manifest.stat().st_size
        _replace_staged_pair(temporary, temporary_manifest, output, edition_manifest_output)
    except Exception:
        temporary.unlink(missing_ok=True)
        temporary_manifest.unlink(missing_ok=True)
        raise
    return ComposeReport(
        inputs=[str(path) for path in sources],
        documents=_table_count(output, "documents"),
        sections=_table_count(output, "sections"),
        chunks=chunks,
        aliases=_table_count(output, "aliases"),
        source_set_digest=source_digest,
        discarded_embedding_profiles=discarded_profiles,
        discarded_embeddings=discarded_embeddings,
        output_checksum=sha256_file(output),
        sqlite_integrity=integrity,
        foreign_key_violations=foreign_keys,
        edition_manifest=str(edition_manifest_output),
        elapsed_ms=round((perf_counter() - started_at) * 1000),
        output_size_bytes=output.stat().st_size,
        staging_size_bytes=staging_size,
    )
