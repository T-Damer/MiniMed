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


def schema_sql() -> str:
    schema_directory = repository_root() / "schema/sql"
    sources = [
        f"-- {path.name}\n{path.read_text(encoding='utf-8').strip()}\n"
        for path in sorted(schema_directory.glob("[0-9][0-9][0-9]_*.sql"))
    ]
    if not sources:
        raise ValueError("No SQLite schema files found.")
    return "\n".join(sources)


def int8_blob(values: list[int]) -> bytes:
    return bytes(value if value >= 0 else value + 256 for value in values)


def write_sqlite_pack(pack: ContentPack, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA page_size = 4096")
        connection.execute("PRAGMA journal_mode = OFF")
        connection.execute("PRAGMA synchronous = OFF")
        connection.executescript(schema_sql())
        connection.execute(
            "INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
            (pack.manifest.schema_version, pack.manifest.built_at),
        )
        connection.execute(
            "INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('schema_version', ?)",
            (str(pack.manifest.schema_version),),
        )
        with connection:
            for profile in sorted(pack.embedding_profiles, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO embedding_profiles(
                        id, dimensions, vector_format, normalization, generator,
                        generator_version, fingerprint, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        profile.id,
                        profile.dimensions,
                        profile.vector_format,
                        profile.normalization,
                        profile.generator,
                        profile.generator_version,
                        profile.fingerprint,
                        json.dumps(profile.metadata, ensure_ascii=False, separators=(",", ":")),
                    ),
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
            for document in sorted(pack.documents, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO documents(
                        id, content_pack_id, title, short_title, source_type, status,
                        specialty_json, metadata_json, current_version_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    ),
                )
                connection.execute(
                    """INSERT INTO document_versions(
                        id, document_id, version_label, effective_from, effective_to,
                        source_checksum, extracted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        document.version.id,
                        document.id,
                        document.version.label,
                        document.version.effective_from,
                        document.version.effective_to,
                        document.version.source_checksum,
                        document.version.extracted_at,
                    ),
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
                    connection.execute(
                        """INSERT INTO sections(
                            id, document_version_id, parent_section_id, title, normalized_title,
                            section_type, depth, order_index, page_start, page_end, anchor,
                            path_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                            json.dumps(
                                section.section_path, ensure_ascii=False, separators=(",", ":")
                            ),
                        ),
                    )
                    for chunk in sorted(section.chunks, key=lambda item: item.order_index):
                        previous_id, next_id = neighbors[chunk.id]
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
                                json.dumps(
                                    chunk.metadata, ensure_ascii=False, separators=(",", ":")
                                ),
                            ),
                        )
                        connection.execute(
                            """INSERT INTO chunks_fts(
                                chunk_id, document_id, document_version_id, section_id, anchor,
                                title, section_path, normalized_text
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (
                                chunk.id,
                                document.id,
                                document.version.id,
                                section.id,
                                chunk.anchor,
                                document.title,
                                " ".join(section.section_path),
                                chunk.normalized_text,
                            ),
                        )
            for alias in sorted(pack.aliases, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO aliases(id, canonical_term, alias, category, weight)
                    VALUES (?, ?, ?, ?, ?)""",
                    (alias.id, alias.canonical_term, alias.alias, alias.category, alias.weight),
                )
            for embedding in sorted(
                pack.embeddings, key=lambda item: (item.profile_id, item.chunk_id)
            ):
                connection.execute(
                    """INSERT INTO chunk_embeddings(
                        profile_id, chunk_id, vector, vector_norm
                    ) VALUES (?, ?, ?, ?)""",
                    (
                        embedding.profile_id,
                        embedding.chunk_id,
                        int8_blob(embedding.values),
                        embedding.norm,
                    ),
                )
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
