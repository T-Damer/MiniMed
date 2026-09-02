from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import cast
from uuid import uuid4

from .edition_manifest import (
    EditionManifest,
    EditionManifestSource,
    sha256_file,
    validate_local_edition_manifest,
    write_edition_manifest,
)
from .models import CamelModel, SourceProvenance
from .sqlite_builder import inspect_integrity, schema_sql, secondary_indexes_sql


@dataclass(frozen=True)
class TableSpec:
    name: str
    columns: tuple[str, ...]
    key_columns: tuple[str, ...]
    order_by: str


@dataclass(frozen=True)
class _ComposeConfig:
    edition_id: str
    edition_version: str
    title: str
    built_at: str
    schema_version: int
    compact: bool
    output: str
    edition_manifest: str

    def payload(self) -> dict[str, object]:
        return {
            "editionId": self.edition_id,
            "editionVersion": self.edition_version,
            "title": self.title,
            "builtAt": self.built_at,
            "schemaVersion": self.schema_version,
            "compact": self.compact,
            "output": self.output,
            "editionManifest": self.edition_manifest,
        }


@dataclass(frozen=True)
class _InputFingerprint:
    path: Path
    sha256: str

    def payload(self) -> dict[str, str]:
        return {"path": str(self.path), "sha256": self.sha256}


_CHECKPOINT_VERSION = 1
_CHECKPOINT_METADATA_KEY = "composer_checkpoint"


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


def _staging_paths(output: Path, edition_manifest_output: Path) -> tuple[Path, Path, Path]:
    stage_database = output.with_name(f".{output.name}.stage")
    checkpoint = output.with_name(f".{output.name}.checkpoint.json")
    staged_manifest = edition_manifest_output.with_name(f".{edition_manifest_output.name}.stage")
    return stage_database, checkpoint, staged_manifest


def _discard_staging(stage_database: Path, checkpoint: Path, staged_manifest: Path) -> None:
    for path in (
        stage_database,
        checkpoint,
        staged_manifest,
        Path(f"{stage_database}-journal"),
        Path(f"{stage_database}-wal"),
        Path(f"{stage_database}-shm"),
    ):
        path.unlink(missing_ok=True)
    for path in checkpoint.parent.glob(f".{checkpoint.name}.tmp-*"):
        path.unlink(missing_ok=True)


def _checkpoint_payload(
    config: _ComposeConfig,
    inputs: list[_InputFingerprint],
    next_module: int,
) -> dict[str, object]:
    return {
        "checkpointVersion": _CHECKPOINT_VERSION,
        "config": config.payload(),
        "inputs": [item.payload() for item in inputs],
        "nextModule": next_module,
    }


def _checkpoint_index(
    raw: object,
    config: _ComposeConfig,
    inputs: list[_InputFingerprint],
) -> int:
    if not isinstance(raw, dict):
        raise ValueError("Invalid composer checkpoint.")
    checkpoint = cast(dict[str, object], raw)
    expected_keys = {"checkpointVersion", "config", "inputs", "nextModule"}
    if set(checkpoint) != expected_keys:
        raise ValueError("Invalid composer checkpoint.")
    if checkpoint.get("checkpointVersion") != _CHECKPOINT_VERSION:
        raise ValueError("Unsupported composer checkpoint version.")
    if checkpoint.get("config") != config.payload():
        raise ValueError("Resume configuration does not match the checkpoint.")
    expected_inputs = [item.payload() for item in inputs]
    if checkpoint.get("inputs") != expected_inputs:
        raise ValueError("Resume inputs do not match the checkpoint.")
    next_module = checkpoint.get("nextModule")
    if type(next_module) is not int or not 0 <= next_module <= len(inputs):
        raise ValueError("Invalid composer checkpoint module position.")
    return next_module


def _write_checkpoint(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{uuid4().hex}")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_checkpoint(path: Path, config: _ComposeConfig, inputs: list[_InputFingerprint]) -> int:
    try:
        raw: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot read composer checkpoint: {path}") from error
    return _checkpoint_index(raw, config, inputs)


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _has_expected_unique_key(connection: sqlite3.Connection, spec: TableSpec) -> bool:
    table_info = cast(
        list[tuple[object, ...]],
        connection.execute(f'PRAGMA table_info("{spec.name}")').fetchall(),
    )
    primary_key = tuple(
        str(row[1])
        for row in sorted(
            (row for row in table_info if cast(int, row[5]) > 0),
            key=lambda row: cast(int, row[5]),
        )
    )
    if primary_key == spec.key_columns:
        return True

    index_list = cast(
        list[tuple[object, ...]],
        connection.execute(f'PRAGMA index_list("{spec.name}")').fetchall(),
    )
    for index_row in index_list:
        if cast(int, index_row[2]) != 1:
            continue
        partial = cast(int, index_row[4])
        if partial != 0:
            continue
        index_name = str(index_row[1]).replace('"', '""')
        index_info = cast(
            list[tuple[object, ...]],
            connection.execute(f'PRAGMA index_info("{index_name}")').fetchall(),
        )
        indexed_columns = tuple(
            str(row[2]) for row in sorted(index_info, key=lambda row: cast(int, row[0]))
        )
        if indexed_columns == spec.key_columns:
            return True
    return False


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
        if not _has_expected_unique_key(connection, spec):
            raise ValueError(f"Input database {path} lacks a unique key for {spec.name}.")
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


def _preflight_sources(
    sources: list[Path], schema_version: int, *, validated_prefix: int = 0
) -> dict[Path, set[str]]:
    selected: dict[Path, set[str]] = {}
    document_owners: dict[str, Path] = {}
    for module_index, path in enumerate(sources):
        connection = sqlite3.connect(path)
        try:
            if module_index < validated_prefix:
                document_ids = {
                    str(row[0])
                    for row in connection.execute("SELECT id FROM documents ORDER BY id")
                }
            else:
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


def _qualified(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


def _source_query(spec: TableSpec, schema: str) -> str:
    table = _qualified(schema, spec.name)
    if spec.name == "documents":
        alias = "d"
        from_clause = f"{table} AS {alias}"
        where = ""
        order_by = "d.id"
    elif spec.name == "document_versions":
        alias = "dv"
        from_clause = (
            f"{table} AS {alias} JOIN {_qualified(schema, 'documents')} AS d "
            "ON d.id = dv.document_id"
        )
        where = "WHERE dv.id = d.current_version_id"
        order_by = "dv.id"
    elif spec.name == "sections":
        alias = "s"
        from_clause = (
            f"{table} AS {alias} JOIN {_qualified(schema, 'documents')} AS d "
            "ON d.current_version_id = s.document_version_id"
        )
        where = ""
        order_by = "s.depth, s.order_index, s.id"
    elif spec.name == "chunks":
        alias = "c"
        from_clause = (
            f"{table} AS {alias} NOT INDEXED JOIN {_qualified(schema, 'documents')} AS d "
            "ON d.current_version_id = c.document_version_id"
        )
        where = ""
        # Physical row order is enough here; logical order lives in the copied columns.
        order_by = "c.rowid"
    elif spec.name in {"knowledge_evidence", "knowledge_document_links"}:
        alias = "e"
        from_clause = (
            f"{table} AS {alias} JOIN {_qualified(schema, 'documents')} AS d "
            "ON d.id = e.document_id"
        )
        where = "WHERE e.document_version_id = d.current_version_id"
        order_by = f"e.{spec.order_by}"
    else:
        alias = "r"
        from_clause = f"{table} AS {alias}"
        where = ""
        order_by = f"r.{spec.order_by}"
    columns = ", ".join(f"{alias}.{column}" for column in spec.columns)
    return f"SELECT {columns} FROM {from_clause} {where}" + (
        f" ORDER BY {order_by}" if order_by else ""
    )


def _copy_rows(
    target: sqlite3.Connection,
    source_schema: str,
    spec: TableSpec,
    edition_id: str,
) -> None:
    query = _source_query(spec, source_schema)
    target_columns = (
        ("id", "content_pack_id", *spec.columns[1:]) if spec.name == "documents" else spec.columns
    )
    target_column_sql = ", ".join(target_columns)
    incoming_columns = ", ".join(f"incoming.{column}" for column in spec.columns)
    key_join = " AND ".join(
        f"existing.{column} IS incoming.{column}" for column in spec.key_columns
    )
    equal_row = " AND ".join(f"existing.{column} IS incoming.{column}" for column in spec.columns)
    conflict = target.execute(
        f"""SELECT {", ".join(f"incoming.{column}" for column in spec.key_columns)}
        FROM ({query}) AS incoming
        JOIN main."{spec.name}" AS existing ON {key_join}
        WHERE NOT ({equal_row})
        LIMIT 1"""
    ).fetchone()
    if conflict is not None:
        key = tuple(conflict)
        raise ValueError(f"Conflicting {spec.name} row for key {key}.")

    if spec.name == "documents":
        select_columns = ", ".join(
            ["incoming.id", "?", *[f"incoming.{column}" for column in spec.columns[1:]]]
        )
        values: tuple[object, ...] = (edition_id,)
    else:
        select_columns = incoming_columns
        values = ()
    key_columns = ", ".join(spec.key_columns)
    try:
        target.execute(
            f"""INSERT INTO main."{spec.name}" ({target_column_sql})
            SELECT {select_columns}
            FROM ({query}) AS incoming
            WHERE 1
            ON CONFLICT ({key_columns}) DO NOTHING""",
            values,
        )
    except sqlite3.IntegrityError as error:
        key_row = target.execute(
            f"""SELECT {", ".join(f"incoming.{column}" for column in spec.key_columns)}
            FROM ({query}) AS incoming LIMIT 1"""
        ).fetchone()
        key = tuple(key_row) if key_row is not None else ()
        raise ValueError(f"Conflicting {spec.name} row for key {key}.") from error


def _rebuild_chunks_fts(connection: sqlite3.Connection) -> None:
    invalid_path = connection.execute(
        """SELECT id FROM sections
        WHERE json_valid(path_json) = 0
           OR json_type(CASE WHEN json_valid(path_json) THEN path_json ELSE 'null' END) != 'array'
           OR EXISTS (
               SELECT 1
               FROM json_each(CASE WHEN json_valid(path_json) THEN path_json ELSE '[]' END)
               WHERE type != 'text'
           )
        LIMIT 1"""
    ).fetchone()
    if invalid_path is not None:
        raise ValueError(f"Section {invalid_path[0]} has invalid path_json.")
    connection.execute("DELETE FROM chunks_fts")
    connection.execute(
        """INSERT INTO chunks_fts(
            chunk_id, document_id, document_version_id, section_id, anchor,
            title, section_path, normalized_text
        )
        SELECT c.id, d.id, c.document_version_id, c.section_id, c.anchor,
               d.title,
               COALESCE(
                   (
                       SELECT group_concat(value, ' ')
                       FROM (
                           SELECT value
                           FROM json_each(s.path_json)
                           ORDER BY key
                       )
                   ),
                   ''
               ),
               c.normalized_text
        FROM chunks c
        JOIN document_versions dv ON dv.id = c.document_version_id
        JOIN documents d ON d.id = dv.document_id
        JOIN sections s ON s.id = c.section_id
        ORDER BY c.id"""
    )


def _rebuild_knowledge_fts(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM knowledge_fts")
    connection.execute(
        """WITH fact_parts AS (
            SELECT entity_id, id, 0 AS part_order, fact_type AS part
            FROM knowledge_facts
            WHERE review_status = 'reviewed'
            UNION ALL
            SELECT entity_id, id, 1 AS part_order, original_text AS part
            FROM knowledge_facts
            WHERE review_status = 'reviewed'
        ),
        fact_text AS (
            SELECT entity_id, group_concat(part, ' ') AS facts
            FROM (
                SELECT entity_id, part
                FROM fact_parts
                ORDER BY entity_id, id, part_order
            )
            GROUP BY entity_id
        ),
        relation_rows AS (
            SELECT r.id, 0 AS side, r.subject_entity_id AS entity_id,
                   subject.canonical_name || ' ' || r.predicate || ' ' ||
                   object.canonical_name || ' ' || r.relation_status AS relation_text
            FROM knowledge_relations r
            JOIN knowledge_entities subject ON subject.id = r.subject_entity_id
            JOIN knowledge_entities object ON object.id = r.object_entity_id
            WHERE r.review_status = 'reviewed'
               OR (
                   r.authority_tier = 'professional-reference'
                   AND r.relation_status = 'reference-only'
               )
            UNION ALL
            SELECT r.id, 1 AS side, r.object_entity_id AS entity_id,
                   subject.canonical_name || ' ' || r.predicate || ' ' ||
                   object.canonical_name || ' ' || r.relation_status AS relation_text
            FROM knowledge_relations r
            JOIN knowledge_entities subject ON subject.id = r.subject_entity_id
            JOIN knowledge_entities object ON object.id = r.object_entity_id
            WHERE r.review_status = 'reviewed'
               OR (
                   r.authority_tier = 'professional-reference'
                   AND r.relation_status = 'reference-only'
               )
        ),
        relation_text AS (
            SELECT entity_id, group_concat(relation_text, ' ') AS relations
            FROM (
                SELECT entity_id, relation_text
                FROM relation_rows
                ORDER BY entity_id, id, side
            )
            GROUP BY entity_id
        ),
        alias_text AS (
            SELECT entity_id, group_concat(name, ' ') AS aliases
            FROM (
                SELECT entity_id, name
                FROM knowledge_names
                ORDER BY entity_id, id
            )
            GROUP BY entity_id
        )
        INSERT INTO knowledge_fts(
            entity_id, canonical_name, aliases, facts, relations
        )
        SELECT entities.id,
               entities.canonical_name,
               entities.canonical_name ||
                   CASE WHEN alias_text.aliases IS NULL THEN ''
                        ELSE ' ' || alias_text.aliases END,
               COALESCE(fact_text.facts, ''),
               COALESCE(relation_text.relations, '')
        FROM knowledge_entities entities
        LEFT JOIN fact_text ON fact_text.entity_id = entities.id
        LEFT JOIN relation_text ON relation_text.entity_id = entities.id
        LEFT JOIN alias_text ON alias_text.entity_id = entities.id
        WHERE fact_text.entity_id IS NOT NULL OR relation_text.entity_id IS NOT NULL
        ORDER BY entities.id"""
    )


def _validate_fts(connection: sqlite3.Connection) -> None:
    for table in ("chunks_fts", "knowledge_fts"):
        connection.execute(f"INSERT INTO {table}({table}) VALUES ('integrity-check')")

    # FTS identity columns are UNINDEXED: equality joins rescan the entire virtual
    # table per expected row. Group both ID streams once, including duplicates/NULLs.
    chunk_issue = connection.execute(
        """WITH counts AS (
            SELECT id, 1 AS expected, 0 AS actual FROM chunks
            UNION ALL
            SELECT chunk_id, 0, 1 FROM chunks_fts
        )
        SELECT id FROM counts
        GROUP BY id
        HAVING sum(expected) != 1 OR sum(actual) != 1
        LIMIT 1"""
    ).fetchone()
    if chunk_issue is not None:
        raise ValueError("Composed chunks FTS rows do not match chunks.")

    knowledge_issue = connection.execute(
        """WITH expected AS (
            SELECT e.id AS entity_id
            FROM knowledge_entities e
            WHERE EXISTS (
                SELECT 1
                FROM knowledge_facts f
                WHERE f.entity_id = e.id AND f.review_status = 'reviewed'
            )
            OR EXISTS (
                SELECT 1
                FROM knowledge_relations r
                WHERE (
                    r.subject_entity_id = e.id OR r.object_entity_id = e.id
                )
                AND (
                    r.review_status = 'reviewed'
                    OR (
                        r.authority_tier = 'professional-reference'
                        AND r.relation_status = 'reference-only'
                    )
                )
            )
        ), counts AS (
            SELECT entity_id, 1 AS expected, 0 AS actual FROM expected
            UNION ALL
            SELECT entity_id, 0, 1 FROM knowledge_fts
        )
        SELECT entity_id FROM counts
        GROUP BY entity_id
        HAVING sum(expected) != 1 OR sum(actual) != 1
        LIMIT 1"""
    ).fetchone()
    if knowledge_issue is not None:
        raise ValueError("Composed knowledge FTS rows do not match knowledge records.")


def _set_stage_checkpoint(connection: sqlite3.Connection, payload: dict[str, object]) -> None:
    connection.execute(
        """INSERT INTO app_metadata(key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
        (
            _CHECKPOINT_METADATA_KEY,
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        ),
    )


def _stage_checkpoint_index(
    connection: sqlite3.Connection,
    config: _ComposeConfig,
    inputs: list[_InputFingerprint],
) -> int | None:
    row = connection.execute(
        "SELECT value FROM app_metadata WHERE key = ?", (_CHECKPOINT_METADATA_KEY,)
    ).fetchone()
    if row is None:
        return None
    try:
        raw: object = json.loads(str(row[0]))
    except json.JSONDecodeError as error:
        raise ValueError("Invalid composer checkpoint in staging database.") from error
    return _checkpoint_index(raw, config, inputs)


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


def _local_edition_manifest(
    database: Path, *, database_sha256: str | None = None
) -> EditionManifest:
    connection = sqlite3.connect(database)
    try:
        pack = connection.execute("SELECT id, version FROM content_packs").fetchone()
        if pack is None:
            raise ValueError("Composed database has no content pack.")
        sources: list[EditionManifestSource] = []
        for document_id, version_id, checksum, metadata_json in connection.execute(
            """SELECT d.id, dv.id, dv.source_checksum, d.metadata_json
            FROM documents d JOIN document_versions dv ON dv.document_id = d.id
            ORDER BY d.id, dv.id"""
        ):
            raw_metadata: object = json.loads(str(metadata_json))
            metadata = (
                cast(dict[str, object], raw_metadata) if isinstance(raw_metadata, dict) else {}
            )
            raw_provenance = metadata.get("provenance")
            provenance = (
                SourceProvenance.model_validate(raw_provenance)
                if isinstance(raw_provenance, dict)
                else None
            )
            sources.append(
                EditionManifestSource(
                    document_id=str(document_id),
                    document_version_id=str(version_id),
                    source_checksum=str(checksum),
                    provenance=provenance,
                )
            )
        return EditionManifest(
            edition_id=str(pack[0]),
            edition_version=str(pack[1]),
            database_sha256=database_sha256 or sha256_file(database),
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
    # ponytail: two-file replace is not cross-file atomic; rollback covers process exceptions.
    # SIGKILL and power loss require a future recovery journal or directory-level publication.
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
    except BaseException:
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


def _fingerprint_inputs(sources: list[Path]) -> list[_InputFingerprint]:
    # ponytail: controlled local staging is the threat boundary; one SHA pass is the trust snapshot.
    return [_InputFingerprint(path, sha256_file(path)) for path in sources]


def _open_staging_database(path: Path, *, initialize: bool) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    if initialize:
        connection.execute("PRAGMA page_size = 4096")
    connection.execute("PRAGMA journal_mode = DELETE")
    connection.execute("PRAGMA synchronous = FULL")
    # FTS is rebuilt once after bulk loading. SQLite's ~2 MiB default cache causes the
    # multi-million-row build to reread B-tree pages continuously on large medication packs.
    connection.execute("PRAGMA cache_size = -262144")
    connection.execute("PRAGMA temp_store = MEMORY")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _initialize_staging_database(
    connection: sqlite3.Connection,
    config: _ComposeConfig,
    inputs: list[_InputFingerprint],
) -> None:
    connection.executescript(schema_sql(include_indexes=False))
    payload = _checkpoint_payload(config, inputs, 0)
    connection.execute("BEGIN")
    connection.execute(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        (config.schema_version, config.built_at),
    )
    connection.execute(
        "INSERT INTO app_metadata(key, value) VALUES ('schema_version', ?)",
        (str(config.schema_version),),
    )
    connection.execute(
        "INSERT INTO app_metadata(key, value) VALUES ('publication_state', 'local-dev')"
    )
    connection.execute(
        """INSERT INTO content_packs(
            id, version, schema_version, title, checksum, installed_at, enabled
        )
        VALUES (?, ?, ?, ?, '', ?, 1)""",
        (
            config.edition_id,
            config.edition_version,
            config.schema_version,
            config.title,
            config.built_at,
        ),
    )
    _set_stage_checkpoint(connection, payload)
    connection.commit()


def _resume_staging_database(
    connection: sqlite3.Connection,
    checkpoint_path: Path,
    config: _ComposeConfig,
    inputs: list[_InputFingerprint],
    checkpoint_index: int,
) -> tuple[int, bool]:
    packs = connection.execute(
        "SELECT id, version, schema_version FROM content_packs ORDER BY id"
    ).fetchall()
    expected_pack = [
        (config.edition_id, config.edition_version, config.schema_version),
    ]
    if packs != expected_pack:
        raise ValueError("Staging database does not match the resume configuration.")
    publication_state = connection.execute(
        "SELECT value FROM app_metadata WHERE key = 'publication_state'"
    ).fetchone()
    if publication_state != ("local-dev",):
        raise ValueError("Staging database is not a local-development composer artifact.")
    database_index = _stage_checkpoint_index(connection, config, inputs)
    if database_index is None:
        if checkpoint_index != len(inputs):
            raise ValueError("Staging database is missing its module checkpoint.")
        # Finalization removes this marker in the same transaction as its indexes.
        return checkpoint_index, True
    if database_index < checkpoint_index:
        raise ValueError("Staging database checkpoint is older than the checkpoint file.")
    if database_index != checkpoint_index:
        _write_checkpoint(
            checkpoint_path,
            _checkpoint_payload(config, inputs, database_index),
        )
    return database_index, False


def _copy_module(
    target: sqlite3.Connection,
    path: Path,
    module_index: int,
    config: _ComposeConfig,
    inputs: list[_InputFingerprint],
    checkpoint_path: Path,
) -> tuple[int, int]:
    source_schema = f"composer_module_{module_index}"
    target.execute(
        f'ATTACH DATABASE ? AS "{source_schema}"',
        (str(path),),
    )
    try:
        discarded_profiles = int(
            target.execute(
                f'SELECT count(*) FROM "{source_schema}"."embedding_profiles"'
            ).fetchone()[0]
        )
        discarded_embeddings = int(
            target.execute(f'SELECT count(*) FROM "{source_schema}"."chunk_embeddings"').fetchone()[
                0
            ]
        )
        target.execute("BEGIN")
        for spec in TABLES:
            _copy_rows(target, source_schema, spec, config.edition_id)
        _set_stage_checkpoint(
            target,
            _checkpoint_payload(config, inputs, module_index + 1),
        )
        target.commit()
    except Exception:
        if target.in_transaction:
            target.rollback()
        raise
    finally:
        target.execute(f'DETACH DATABASE "{source_schema}"')
    _write_checkpoint(
        checkpoint_path,
        _checkpoint_payload(config, inputs, module_index + 1),
    )
    return discarded_profiles, discarded_embeddings


def _count_module_embeddings(
    target: sqlite3.Connection, path: Path, module_index: int
) -> tuple[int, int]:
    source_schema = f"composer_module_{module_index}"
    target.execute(
        f'ATTACH DATABASE ? AS "{source_schema}"',
        (str(path),),
    )
    try:
        profiles = int(
            target.execute(
                f'SELECT count(*) FROM "{source_schema}"."embedding_profiles"'
            ).fetchone()[0]
        )
        embeddings = int(
            target.execute(f'SELECT count(*) FROM "{source_schema}"."chunk_embeddings"').fetchone()[
                0
            ]
        )
        return profiles, embeddings
    finally:
        target.execute(f'DETACH DATABASE "{source_schema}"')


def _finalize_staging_database(
    target: sqlite3.Connection,
    config: _ComposeConfig,
) -> str:
    target.execute("BEGIN")
    _rebuild_chunks_fts(target)
    _rebuild_knowledge_fts(target)
    for statement in secondary_indexes_sql():
        target.execute(statement)
    source_digest = _source_set_digest(target)
    target.execute(
        """INSERT INTO app_metadata(key, value) VALUES ('source_set_digest', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
        (source_digest,),
    )
    target.execute("UPDATE content_packs SET checksum = ?", (source_digest,))
    target.execute("DELETE FROM app_metadata WHERE key = ?", (_CHECKPOINT_METADATA_KEY,))
    target.commit()
    if config.compact:
        target.execute("VACUUM")
    return source_digest


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
    resume: bool = False,
    manifest_writer: Callable[[Path, EditionManifest], None] = write_edition_manifest,
) -> ComposeReport:
    started_at = perf_counter()
    sources = resolve_input_databases(inputs)
    _validate_output_paths(inputs, output, edition_manifest_output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fingerprints = _fingerprint_inputs(sources)
    config = _ComposeConfig(
        edition_id=edition_id,
        edition_version=edition_version,
        title=title,
        built_at=built_at,
        schema_version=schema_version,
        compact=compact,
        output=str(output.resolve()),
        edition_manifest=str(edition_manifest_output.resolve()),
    )
    temporary, checkpoint, temporary_manifest = _staging_paths(output, edition_manifest_output)
    checkpoint_index = 0
    if resume:
        if not temporary.is_file():
            raise ValueError(f"Composer staging database does not exist: {temporary}")
        checkpoint_index = _read_checkpoint(checkpoint, config, fingerprints)
    else:
        _discard_staging(temporary, checkpoint, temporary_manifest)

    target: sqlite3.Connection | None = None
    cleanup_staging = False
    discarded_profiles = 0
    discarded_embeddings = 0
    stage_finalized = False
    try:
        if resume:
            target = _open_staging_database(temporary, initialize=False)
            completed_modules, stage_finalized = _resume_staging_database(
                target,
                checkpoint,
                config,
                fingerprints,
                checkpoint_index,
            )
            _preflight_sources(
                sources,
                schema_version,
                validated_prefix=completed_modules,
            )
            temporary_manifest.unlink(missing_ok=True)
        else:
            _preflight_sources(sources, schema_version)
            target = _open_staging_database(temporary, initialize=True)
            _initialize_staging_database(target, config, fingerprints)
            _write_checkpoint(
                checkpoint,
                _checkpoint_payload(config, fingerprints, 0),
            )
            completed_modules = 0

        assert target is not None
        # Source packs are fully validated before copying. Keep FK checks off while the
        # late-index bulk insert runs; final integrity validation re-enables them below.
        target.execute("PRAGMA foreign_keys = OFF")
        for module_index, path in enumerate(sources):
            if module_index < completed_modules:
                profiles, embeddings = _count_module_embeddings(target, path, module_index)
                discarded_profiles += profiles
                discarded_embeddings += embeddings
                continue
            profiles, embeddings = _copy_module(
                target,
                path,
                module_index,
                config,
                fingerprints,
                checkpoint,
            )
            discarded_profiles += profiles
            discarded_embeddings += embeddings

        target.execute("PRAGMA foreign_keys = ON")
        if stage_finalized:
            source_digest = _source_set_digest(target)
            stored_digest = target.execute(
                "SELECT value FROM app_metadata WHERE key = 'source_set_digest'"
            ).fetchone()
            pack_digest = target.execute("SELECT checksum FROM content_packs").fetchone()
            if stored_digest != (source_digest,) or pack_digest != (source_digest,):
                raise ValueError("Finalized staging database has an invalid source-set digest.")
        else:
            source_digest = _finalize_staging_database(target, config)
        target.close()
        target = None
    except Exception:
        cleanup_staging = not resume
        raise
    finally:
        if target is not None:
            if target.in_transaction:
                target.rollback()
            target.close()
        if cleanup_staging:
            _discard_staging(temporary, checkpoint, temporary_manifest)
    try:
        integrity, foreign_keys, chunks, fts_rows, profiles, embeddings = inspect_integrity(
            temporary
        )
        if integrity != "ok" or foreign_keys or chunks != fts_rows or profiles or embeddings:
            raise ValueError("Composed database failed deterministic integrity checks.")
        connection = sqlite3.connect(temporary)
        try:
            _validate_fts(connection)
        finally:
            connection.close()
        output_checksum = sha256_file(temporary)
        manifest = _local_edition_manifest(temporary, database_sha256=output_checksum)
        validate_local_edition_manifest(
            manifest,
            temporary,
            database_sha256=output_checksum,
        )
        manifest_writer(temporary_manifest, manifest)
        written_manifest = EditionManifest.model_validate_json(
            temporary_manifest.read_text(encoding="utf-8")
        )
        validate_local_edition_manifest(
            written_manifest,
            temporary,
            database_sha256=output_checksum,
        )
        staging_size = temporary.stat().st_size + temporary_manifest.stat().st_size
        _replace_staged_pair(temporary, temporary_manifest, output, edition_manifest_output)
        _discard_staging(temporary, checkpoint, temporary_manifest)
    except Exception:
        if not resume:
            _discard_staging(temporary, checkpoint, temporary_manifest)
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
        output_checksum=output_checksum,
        sqlite_integrity=integrity,
        foreign_key_violations=foreign_keys,
        edition_manifest=str(edition_manifest_output),
        elapsed_ms=round((perf_counter() - started_at) * 1000),
        output_size_bytes=output.stat().st_size,
        staging_size_bytes=staging_size,
    )
