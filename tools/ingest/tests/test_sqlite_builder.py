from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import localmed_ingest.sqlite_builder as sqlite_builder
from localmed_ingest.models import (
    Alias,
    ChunkEmbedding,
    ContentPack,
    EmbeddingProfile,
    PackChunk,
    PackDocument,
    PackManifest,
    PackSection,
    PackVersion,
)


def _pack() -> ContentPack:
    documents = []
    for document_id, title, text in (
        ("doc.b", "Второй документ", "Бронхит и лечение"),
        ("doc.a", "Первый документ", "Пневмония и наблюдение"),
    ):
        version_id = f"{document_id}@1"
        section_id = f"section.{document_id}"
        documents.append(
            PackDocument(
                id=document_id,
                title=title,
                source_type="clinical_recommendation",
                status="active",
                specialties=["терапия"],
                metadata={"source": document_id},
                version=PackVersion(
                    id=version_id,
                    label="1",
                    source_checksum=f"sha256:{document_id}",
                    extracted_at="2026-09-01T00:00:00Z",
                ),
                sections=[
                    PackSection(
                        id=section_id,
                        title="Лечение",
                        normalized_title="лечение",
                        section_type="treatment",
                        depth=1,
                        order_index=0,
                        anchor=f"{version_id}/treatment",
                        section_path=["Лечение"],
                        chunks=[
                            PackChunk(
                                id=f"chunk.{document_id}.1",
                                order_index=0,
                                original_text=text,
                                normalized_text=text.casefold(),
                                anchor=f"{version_id}/treatment#chunk-1",
                                metadata={"sourceSpans": [{"page": 1}]},
                            ),
                            PackChunk(
                                id=f"chunk.{document_id}.2",
                                order_index=1,
                                original_text="Контроль состояния.",
                                normalized_text="контроль состояния.",
                                anchor=f"{version_id}/treatment#chunk-2",
                                metadata={},
                            ),
                        ],
                    )
                ],
            )
        )
    return ContentPack(
        manifest=PackManifest(
            id="pack.test",
            version="1",
            schema_version=2,
            title="Builder test",
            built_at="2026-09-01T00:00:00Z",
            checksum="sha256:test",
        ),
        documents=documents,
        aliases=[
            Alias(id="alias.b", canonical_term="бронхит", alias="бронхит", weight=1.0),
            Alias(id="alias.a", canonical_term="пневмония", alias="пневмония", weight=1.5),
        ],
        embedding_profiles=[
            EmbeddingProfile(
                id="profile.test",
                dimensions=3,
                generator="test",
                generator_version="1",
                fingerprint="sha256:profile",
            )
        ],
        embeddings=[
            ChunkEmbedding(
                profile_id="profile.test",
                chunk_id=f"chunk.doc.{document_suffix}.{chunk_number}",
                values=[chunk_number, 0, -chunk_number],
                norm=1.0,
            )
            for document_suffix in ("a", "b")
            for chunk_number in (1, 2)
        ],
    )


def _schema_signature(connection: sqlite3.Connection) -> list[tuple[object, ...]]:
    return connection.execute(
        """SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name"""
    ).fetchall()


def test_bulk_write_preserves_schema_data_fts_and_builds_indexes_last(tmp_path: Path) -> None:
    pack = _pack()
    output = tmp_path / "pack.db"
    trace: list[str] = []
    real_connect = sqlite_builder.sqlite3.connect

    def traced_connect(database: str | Path) -> sqlite3.Connection:
        connection = real_connect(database)
        connection.set_trace_callback(trace.append)
        return connection

    sqlite_builder.sqlite3.connect = traced_connect  # type: ignore[assignment]
    try:
        sqlite_builder.write_sqlite_pack(pack, output, vacuum=False)
    finally:
        sqlite_builder.sqlite3.connect = real_connect  # type: ignore[assignment]

    reference_path = tmp_path / "schema.db"
    reference = real_connect(reference_path)
    try:
        reference.executescript(sqlite_builder.schema_sql())
        expected_schema = _schema_signature(reference)
    finally:
        reference.close()

    connection = real_connect(output)
    try:
        assert _schema_signature(connection) == expected_schema
        assert connection.execute(
            "SELECT id, title, current_version_id FROM documents ORDER BY id"
        ).fetchall() == [
            ("doc.a", "Первый документ", "doc.a@1"),
            ("doc.b", "Второй документ", "doc.b@1"),
        ]
        assert connection.execute(
            """SELECT id, previous_chunk_id, next_chunk_id
            FROM chunks ORDER BY id"""
        ).fetchall() == [
            ("chunk.doc.a.1", None, "chunk.doc.a.2"),
            ("chunk.doc.a.2", "chunk.doc.a.1", None),
            ("chunk.doc.b.1", None, "chunk.doc.b.2"),
            ("chunk.doc.b.2", "chunk.doc.b.1", None),
        ]
        assert connection.execute(
            "SELECT id, alias, weight FROM aliases ORDER BY id"
        ).fetchall() == [
            ("alias.a", "пневмония", 1.5),
            ("alias.b", "бронхит", 1.0),
        ]
        assert connection.execute(
            """SELECT chunk_id, document_id, title, section_path, normalized_text
            FROM chunks_fts ORDER BY rowid"""
        ).fetchall() == [
            ("chunk.doc.a.1", "doc.a", "Первый документ", "Лечение", "пневмония и наблюдение"),
            ("chunk.doc.a.2", "doc.a", "Первый документ", "Лечение", "контроль состояния."),
            ("chunk.doc.b.1", "doc.b", "Второй документ", "Лечение", "бронхит и лечение"),
            ("chunk.doc.b.2", "doc.b", "Второй документ", "Лечение", "контроль состояния."),
        ]
        assert connection.execute(
            "SELECT document_id FROM chunks_fts WHERE chunks_fts MATCH 'пневмония'"
        ).fetchall() == [("doc.a",)]
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        connection.close()

    secondary_names = {
        match.group(1)
        for statement in sqlite_builder.secondary_indexes_sql()
        if (match := re.search(r"\b(idx_[a-z0-9_]+)\b", statement.casefold()))
    }
    index_positions = [
        index
        for index, statement in enumerate(trace)
        if any(name in statement.casefold() for name in secondary_names)
    ]
    load_positions = [
        index
        for index, statement in enumerate(trace)
        if statement.casefold().lstrip().startswith("insert into ")
    ]
    fts_loads = [
        statement.casefold()
        for statement in trace
        if statement.casefold().lstrip().startswith("insert into chunks_fts")
    ]
    assert secondary_names
    assert index_positions
    assert len(fts_loads) == 1
    assert "select" in fts_loads[0]
    assert max(load_positions) < min(index_positions)
