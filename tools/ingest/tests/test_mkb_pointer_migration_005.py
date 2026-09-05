from __future__ import annotations

import json
import sqlite3

from localmed_ingest.mkb_pointer_migration_005 import _merged_pointer_metadata, _replace_pointer
from localmed_ingest.models import PackChunk, PackDocument, PackSection, PackVersion


def _staged_document() -> PackDocument:
    version_id = "rls.mkb.node.t51-2@rls-1"
    first_section = PackSection(
        id="section.stage.first",
        title="Указатель",
        normalized_title="указатель",
        section_type="routing",
        depth=1,
        order_index=0,
        anchor="stage/указатель",
        section_path=["Указатель"],
        chunks=[
            PackChunk(
                id="chunk.stage.first",
                order_index=0,
                original_text="Код и название источника: T51.2 — 2-пропанола.",
                normalized_text="t51.2 2-пропанола",
                anchor="stage/указатель#chunk-first",
            )
        ],
    )
    second_section = PackSection(
        id="section.stage.second",
        title="Ограничение покрытия",
        normalized_title="ограничение покрытия",
        section_type="other",
        depth=1,
        order_index=1,
        anchor="stage/ограничение-покрытия",
        section_path=["Ограничение покрытия"],
        chunks=[
            PackChunk(
                id="chunk.stage.second",
                order_index=1,
                original_text="Клиническое описание отсутствует.",
                normalized_text="клиническое описание отсутствует",
                anchor="stage/ограничение-покрытия#chunk-second",
            )
        ],
    )
    return PackDocument(
        id="core.catalog.pointer.reference.rls.mkb.node.t51-2-pointer",
        title="T51.2 2-пропанола, МКБ-10",
        short_title="T51.2 2-пропанола",
        source_type="core_catalog_pointer",
        status="active",
        specialties=["medical-reference"],
        metadata={
            "targetDocumentId": "rls.mkb.node.t51-2",
            "referenceCoverage": "classification-only",
            "canonicalDefinition": {
                "text": "Existing definition",
                "sourceDocumentId": "other.source",
                "sourceDocumentVersionId": "other.source@v1",
                "sourceChecksum": "sha256:other",
            },
        },
        version=PackVersion(
            id=version_id,
            label="rls-1",
            source_checksum="sha256:stage",
            extracted_at="2026-09-05T00:00:00Z",
        ),
        sections=[first_section, second_section],
    )


def test_migration_preserves_pointer_anchor_and_enriched_definition() -> None:
    document = _staged_document()
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE documents (
            id TEXT PRIMARY KEY, content_pack_id TEXT, title TEXT NOT NULL,
            short_title TEXT, source_type TEXT NOT NULL, status TEXT NOT NULL,
            specialty_json TEXT NOT NULL, metadata_json TEXT NOT NULL,
            current_version_id TEXT NOT NULL
        );
        CREATE TABLE document_versions (
            id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version_label TEXT NOT NULL,
            effective_from TEXT, effective_to TEXT, source_checksum TEXT NOT NULL,
            extracted_at TEXT NOT NULL
        );
        CREATE TABLE sections (
            id TEXT PRIMARY KEY, document_version_id TEXT NOT NULL,
            parent_section_id TEXT, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
            section_type TEXT, depth INTEGER NOT NULL, order_index INTEGER NOT NULL,
            page_start INTEGER, page_end INTEGER, anchor TEXT NOT NULL, path_json TEXT NOT NULL
        );
        CREATE TABLE chunks (
            id TEXT PRIMARY KEY, document_version_id TEXT NOT NULL, section_id TEXT NOT NULL,
            order_index INTEGER NOT NULL, original_text TEXT NOT NULL,
            normalized_text TEXT NOT NULL, page_start INTEGER, page_end INTEGER,
            char_start INTEGER, char_end INTEGER, previous_chunk_id TEXT,
            next_chunk_id TEXT, anchor TEXT NOT NULL, metadata_json TEXT NOT NULL
        );
        """
    )
    old_metadata = {
        "targetDocumentId": "rls.mkb.node.t51-2",
        "referenceCoverage": "clinical-definition",
        "canonicalDefinition": {
            "text": "Existing definition",
            "sourceDocumentId": "other.source",
            "sourceDocumentVersionId": "other.source@v1",
            "sourceChecksum": "sha256:other",
        },
    }
    connection.execute(
        "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            document.id,
            "minimed.mkb.ru",
            "Old title",
            "Old title",
            "core_catalog_pointer",
            "active",
            '["medical-reference"]',
            json.dumps(old_metadata),
            document.version.id,
        ),
    )
    connection.execute(
        "INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?)",
        (document.version.id, document.id, "rls-1", None, None, "sha256:old", "2026-09-04"),
    )
    connection.execute(
        "INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "section.stable",
            document.version.id,
            None,
            "Old section",
            "old section",
            "routing",
            1,
            0,
            None,
            None,
            "stable/source#section",
            '["Old section"]',
        ),
    )
    connection.execute(
        "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "chunk.stable",
            document.version.id,
            "section.stable",
            0,
            "Old pointer",
            "old pointer",
            None,
            None,
            None,
            None,
            None,
            None,
            "stable/source#chunk",
            "{}",
        ),
    )

    _replace_pointer(connection, document)

    section_rows = connection.execute(
        "SELECT id, anchor FROM sections WHERE document_version_id = ? ORDER BY order_index",
        (document.version.id,),
    ).fetchall()
    chunk_rows = connection.execute(
        "SELECT id, anchor FROM chunks WHERE document_version_id = ? ORDER BY order_index",
        (document.version.id,),
    ).fetchall()
    assert section_rows == [
        ("section.stable", "stable/source#section"),
        ("section.stage.second", "stage/ограничение-покрытия"),
    ]
    assert chunk_rows == [
        ("chunk.stable", "stable/source#chunk"),
        ("chunk.stage.second", "stage/ограничение-покрытия#chunk-second"),
    ]
    metadata = json.loads(connection.execute("SELECT metadata_json FROM documents").fetchone()[0])
    assert metadata["canonicalDefinition"] == old_metadata["canonicalDefinition"]
    assert metadata["referenceCoverage"] == "clinical-definition"


def test_metadata_merge_allows_same_provenance_definition() -> None:
    definition = {
        "text": "Definition",
        "sourceDocumentId": "source",
        "sourceDocumentVersionId": "source@v1",
        "sourceChecksum": "sha256:source",
    }
    merged = _merged_pointer_metadata(
        {"canonicalDefinition": definition, "referenceCoverage": "classification-only"},
        {"canonicalDefinition": {**definition, "text": "Updated definition"}},
    )
    merged_definition = merged["canonicalDefinition"]
    assert isinstance(merged_definition, dict)
    assert merged_definition["text"] == "Updated definition"
    assert merged["referenceCoverage"] == "clinical-definition"
