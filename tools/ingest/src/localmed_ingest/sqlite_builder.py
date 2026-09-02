from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from .models import ContentPack


def repository_root() -> Path:
    configured = os.environ.get("LOCALMED_REPO_ROOT")
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parents[4]


def _schema_statements() -> list[tuple[str, str]]:
    schema_directory = repository_root() / "schema/sql"
    sources = [
        (path.name, path.read_text(encoding="utf-8").strip())
        for path in sorted(schema_directory.glob("[0-9][0-9][0-9]_*.sql"))
    ]
    if not sources:
        raise ValueError("No SQLite schema files found.")
    return sources


def _render_schema(statements: list[tuple[str, str]]) -> str:
    return "\n".join(f"-- {name}\n{sql}\n" for name, sql in statements)


def schema_sql(*, include_indexes: bool = True) -> str:
    statements = _schema_statements()
    if include_indexes:
        return _render_schema(statements)
    without_indexes = [
        (
            name,
            ";\n".join(
                statement.strip()
                for statement in sql.split(";")
                if statement.strip() and not statement.lstrip().upper().startswith("CREATE INDEX")
            )
            + ";",
        )
        for name, sql in statements
    ]
    return _render_schema(without_indexes)


def secondary_indexes_sql() -> list[str]:
    return [
        statement.strip() + ";"
        for _, sql in _schema_statements()
        for statement in sql.split(";")
        if statement.strip() and statement.lstrip().upper().startswith("CREATE INDEX")
    ]


def int8_blob(values: list[int]) -> bytes:
    return bytes(value if value >= 0 else value + 256 for value in values)


def write_sqlite_pack(pack: ContentPack, output: Path, *, vacuum: bool = True) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA page_size = 4096")
        connection.execute("PRAGMA journal_mode = OFF")
        connection.execute("PRAGMA synchronous = OFF")
        connection.execute("PRAGMA cache_size = -262144")
        connection.executescript(schema_sql(include_indexes=False))

        profile_rows = [
            (
                profile.id,
                profile.dimensions,
                profile.vector_format,
                profile.normalization,
                profile.generator,
                profile.generator_version,
                profile.fingerprint,
                json.dumps(profile.metadata, ensure_ascii=False, separators=(",", ":")),
            )
            for profile in sorted(pack.embedding_profiles, key=lambda item: item.id)
        ]
        document_rows = []
        version_rows = []
        section_rows = []
        chunk_rows = []
        for document in sorted(pack.documents, key=lambda item: item.id):
            document_rows.append(
                (
                    document.id,
                    pack.manifest.id,
                    document.title,
                    document.short_title,
                    document.source_type,
                    document.status,
                    json.dumps(document.specialties, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(document.metadata, ensure_ascii=False, separators=(",", ":")),
                    document.version.id,
                )
            )
            version_rows.append(
                (
                    document.version.id,
                    document.id,
                    document.version.label,
                    document.version.effective_from,
                    document.version.effective_to,
                    document.version.source_checksum,
                    document.version.extracted_at,
                )
            )
            ordered_chunks = sorted(
                (chunk for section in document.sections for chunk in section.chunks),
                key=lambda item: item.order_index,
            )
            neighbors = {
                chunk.id: (
                    ordered_chunks[index - 1].id if index > 0 else None,
                    ordered_chunks[index + 1].id if index + 1 < len(ordered_chunks) else None,
                )
                for index, chunk in enumerate(ordered_chunks)
            }
            for section in sorted(document.sections, key=lambda item: item.order_index):
                section_rows.append(
                    (
                        section.id,
                        document.version.id,
                        section.parent_section_id,
                        section.title,
                        section.normalized_title,
                        section.section_type,
                        section.depth,
                        section.order_index,
                        section.page_start,
                        section.page_end,
                        section.anchor,
                        json.dumps(section.section_path, ensure_ascii=False, separators=(",", ":")),
                    )
                )
                for chunk in sorted(section.chunks, key=lambda item: item.order_index):
                    previous_id, next_id = neighbors[chunk.id]
                    chunk_rows.append(
                        (
                            chunk.id,
                            document.version.id,
                            section.id,
                            chunk.order_index,
                            chunk.original_text,
                            chunk.normalized_text,
                            chunk.page_start,
                            chunk.page_end,
                            chunk.char_start,
                            chunk.char_end,
                            previous_id,
                            next_id,
                            chunk.anchor,
                            json.dumps(chunk.metadata, ensure_ascii=False, separators=(",", ":")),
                        )
                    )
        alias_rows = [
            (alias.id, alias.canonical_term, alias.alias, alias.category, alias.weight)
            for alias in sorted(pack.aliases, key=lambda item: item.id)
        ]
        embedding_rows = [
            (
                embedding.profile_id,
                embedding.chunk_id,
                int8_blob(embedding.values),
                embedding.norm,
            )
            for embedding in sorted(
                pack.embeddings, key=lambda item: (item.profile_id, item.chunk_id)
            )
        ]
        with connection:
            connection.execute(
                "INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                (pack.manifest.schema_version, pack.manifest.built_at),
            )
            connection.execute(
                "INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('schema_version', ?)",
                (str(pack.manifest.schema_version),),
            )
            connection.executemany(
                """INSERT INTO embedding_profiles(
                    id, dimensions, vector_format, normalization, generator,
                    generator_version, fingerprint, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                profile_rows,
            )
            connection.execute(
                """INSERT INTO content_packs(
                    id, version, schema_version, title, checksum, installed_at, enabled
                ) VALUES (?, ?, ?, ?, ?, ?, 1)""",
                (
                    pack.manifest.id,
                    pack.manifest.version,
                    pack.manifest.schema_version,
                    pack.manifest.title,
                    pack.manifest.checksum,
                    pack.manifest.built_at,
                ),
            )
            connection.executemany(
                """INSERT INTO documents(
                    id, content_pack_id, title, short_title, source_type, status,
                    specialty_json, metadata_json, current_version_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                document_rows,
            )
            connection.executemany(
                """INSERT INTO document_versions(
                    id, document_id, version_label, effective_from, effective_to,
                    source_checksum, extracted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                version_rows,
            )
            connection.executemany(
                """INSERT INTO sections(
                    id, document_version_id, parent_section_id, title, normalized_title,
                    section_type, depth, order_index, page_start, page_end, anchor,
                    path_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                section_rows,
            )
            connection.executemany(
                """INSERT INTO chunks(
                    id, document_version_id, section_id, order_index, original_text,
                    normalized_text, page_start, page_end, char_start, char_end,
                    previous_chunk_id, next_chunk_id, anchor, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                chunk_rows,
            )
            connection.executemany(
                """INSERT INTO aliases(id, canonical_term, alias, category, weight)
                VALUES (?, ?, ?, ?, ?)""",
                alias_rows,
            )
            connection.executemany(
                """INSERT INTO chunk_embeddings(
                    profile_id, chunk_id, vector, vector_norm
                ) VALUES (?, ?, ?, ?)""",
                embedding_rows,
            )
            connection.execute(
                """INSERT INTO chunks_fts(
                    chunk_id, document_id, document_version_id, section_id, anchor,
                    title, section_path, normalized_text
                )
                SELECT
                    chunks.id,
                    document_versions.document_id,
                    chunks.document_version_id,
                    chunks.section_id,
                    chunks.anchor,
                    documents.title,
                    COALESCE(
                        (SELECT group_concat(value, ' ') FROM json_each(sections.path_json)),
                        ''
                    ),
                    chunks.normalized_text
                FROM chunks
                JOIN sections ON sections.id = chunks.section_id
                JOIN document_versions ON document_versions.id = chunks.document_version_id
                JOIN documents ON documents.id = document_versions.document_id
                ORDER BY documents.id, sections.order_index, chunks.order_index, chunks.id"""
            )
        connection.execute("BEGIN")
        try:
            for statement in secondary_indexes_sql():
                connection.execute(statement)
        except Exception:
            connection.rollback()
            raise
        else:
            connection.commit()
        if vacuum:
            connection.execute("VACUUM")
    finally:
        connection.close()
    temporary.replace(output)


def inspect_integrity(path: Path) -> tuple[str, int, int, int, int, int]:
    connection = sqlite3.connect(path)
    try:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        chunks = int(connection.execute("SELECT count(*) FROM chunks").fetchone()[0])
        fts_rows = int(connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0])
        embedding_profiles = int(
            connection.execute("SELECT count(*) FROM embedding_profiles").fetchone()[0]
        )
        embeddings = int(connection.execute("SELECT count(*) FROM chunk_embeddings").fetchone()[0])
        return integrity, foreign_keys, chunks, fts_rows, embedding_profiles, embeddings
    finally:
        connection.close()
