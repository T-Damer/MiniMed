from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.knowledge_discovery_pack import build_knowledge_discovery_pack
from localmed_ingest.sqlite_builder import schema_sql


def _source_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(schema_sql())
        with connection:
            connection.execute(
                "INSERT INTO content_packs VALUES (?, ?, ?, ?, ?, ?, 1)",
                ("source.pack", "1", 5, "Source", "sha256:source", "2026-09-18T00:00:00Z"),
            )
            connection.execute(
                "INSERT INTO app_metadata(key, value) VALUES ('schema_version', '5')"
            )
            connection.execute(
                """INSERT INTO documents(
                    id, content_pack_id, title, short_title, source_type, status,
                    specialty_json, metadata_json, current_version_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "source.jaspers",
                    "source.pack",
                    "Учебный источник по психопатологии",
                    None,
                    "medical_reference",
                    "active",
                    '["psychiatry"]',
                    "{}",
                    "source.jaspers@1",
                ),
            )
            connection.execute(
                "INSERT INTO document_versions VALUES (?, ?, ?, NULL, NULL, ?, ?)",
                (
                    "source.jaspers@1",
                    "source.jaspers",
                    "1",
                    "sha256:jaspers",
                    "2026-09-18T00:00:00Z",
                ),
            )
            connection.execute(
                """INSERT INTO sections(
                    id, document_version_id, parent_section_id, title, normalized_title,
                    section_type, depth, order_index, page_start, page_end, anchor, path_json
                ) VALUES (?, ?, NULL, ?, ?, ?, 1, 0, NULL, NULL, ?, ?)""",
                (
                    "source.jaspers.section",
                    "source.jaspers@1",
                    "Нарушения сознания",
                    "нарушения сознания",
                    "definition",
                    "source.jaspers@1/consciousness",
                    '["Нарушения сознания"]',
                ),
            )
            reviewed_text = (
                "Критерии помрачения сознания рассматриваются только в совокупности признаков."
            )
            connection.execute(
                """INSERT INTO chunks(
                    id, document_version_id, section_id, order_index, original_text,
                    normalized_text, page_start, page_end, char_start, char_end,
                    previous_chunk_id, next_chunk_id, anchor, metadata_json
                ) VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, '{}')""",
                (
                    "source.jaspers.chunk",
                    "source.jaspers@1",
                    "source.jaspers.section",
                    reviewed_text,
                    reviewed_text.lower(),
                    "source.jaspers@1/consciousness/chunk",
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_entities(
                    id, entity_type, canonical_name, normalized_name,
                    external_ids_json, metadata_json
                ) VALUES (?, ?, ?, ?, '{}', ?)""",
                (
                    "criterion.jaspers.clouding-consciousness",
                    "criterion_set",
                    "Критерии помрачения сознания Ясперса",
                    "критерии помрачения сознания ясперса",
                    json.dumps(
                        {
                            "specialties": ["psychiatry"],
                            "tags": ["consciousness", "psychopathology"],
                        },
                        ensure_ascii=False,
                    ),
                ),
            )
            connection.execute(
                "INSERT INTO knowledge_names VALUES (?, ?, ?, ?, 'ru', 'eponym', 1.7)",
                (
                    "name.jaspers",
                    "criterion.jaspers.clouding-consciousness",
                    "критерии Ясперса",
                    "критерии ясперса",
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_facts(
                    id, entity_id, fact_type, original_text, structured_json, population_json,
                    approval_status, authority_tier, review_status, jurisdiction, confidence,
                    valid_from, valid_to, metadata_json
                ) VALUES (?, ?, 'definition', ?, '{}', '{}', 'reference',
                          'professional-reference', 'reviewed', 'RU', 0.95, NULL, NULL, '{}')""",
                (
                    "fact.jaspers.definition",
                    "criterion.jaspers.clouding-consciousness",
                    reviewed_text,
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_facts(
                    id, entity_id, fact_type, original_text, structured_json, population_json,
                    approval_status, authority_tier, review_status, jurisdiction, confidence,
                    valid_from, valid_to, metadata_json
                ) VALUES (?, ?, 'description', ?, '{}', '{}', 'reference',
                          'professional-reference', 'proposed', 'RU', 1.0, NULL, NULL, '{}')""",
                (
                    "fact.jaspers.unreviewed",
                    "criterion.jaspers.clouding-consciousness",
                    "Непроверенное описание не должно попасть в discovery pack.",
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_evidence(
                    id, fact_id, relation_id, document_id, document_version_id,
                    section_id, chunk_id, evidence_quote, source_locator_json
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, '{}')""",
                (
                    "evidence.jaspers.definition",
                    "fact.jaspers.definition",
                    "source.jaspers",
                    "source.jaspers@1",
                    "source.jaspers.section",
                    "source.jaspers.chunk",
                    reviewed_text,
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_document_links(
                    id, entity_id, document_id, document_version_id, section_id, chunk_id,
                    link_type, weight, review_status, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, 'professional-reference', 1.0, 'reviewed', '{}')""",
                (
                    "link.jaspers",
                    "criterion.jaspers.clouding-consciousness",
                    "source.jaspers",
                    "source.jaspers@1",
                    "source.jaspers.section",
                    "source.jaspers.chunk",
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_entities(
                    id, entity_type, canonical_name, normalized_name,
                    external_ids_json, metadata_json
                ) VALUES ('scale.hidden', 'scale', 'Скрытая шкала', 'скрытая шкала', '{}', '{}')"""
            )
    finally:
        connection.close()


def test_builds_source_backed_partial_discovery_pack(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    output = tmp_path / "knowledge-discovery.db"
    _source_database(source)

    count = build_knowledge_discovery_pack(
        (source,),
        output,
        edition_id="minimed.knowledge.discovery.test",
        version="2026.09.18",
        built_at="2026-09-18T00:00:00Z",
        entity_types=frozenset({"criterion_set"}),
    )
    assert count == 1

    connection = sqlite3.connect(output)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        row = connection.execute(
            "SELECT title, specialty_json, metadata_json FROM documents"
        ).fetchone()
        assert row is not None
        title, specialties_json, metadata_json = row
        assert title == "Критерии помрачения сознания Ясперса"
        assert json.loads(specialties_json) == ["psychiatry"]
        metadata = json.loads(metadata_json)
        assert metadata["conceptId"] == "criterion.jaspers.clouding-consciousness"
        assert metadata["entityType"] == "criterion_set"
        assert metadata["declaredAliases"] == ["критерии Ясперса"]
        assert metadata["tags"] == ["consciousness", "psychopathology"]
        assert metadata["sourceDocumentIds"] == ["source.jaspers"]
        assert metadata["canonicalDefinition"]["sourceChunkId"] == "source.jaspers.chunk"

        texts = "\n".join(
            row[0] for row in connection.execute("SELECT original_text FROM chunks ORDER BY id")
        )
        assert "Критерии помрачения сознания" in texts
        assert "Непроверенное описание" not in texts
        assert connection.execute(
            "SELECT canonical_term FROM aliases WHERE alias = 'критерии Ясперса'"
        ).fetchone() == ("Критерии помрачения сознания Ясперса",)
        assert connection.execute(
            """SELECT count(DISTINCT document_id)
            FROM chunks_fts WHERE chunks_fts MATCH 'помрачения'"""
        ).fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM documents").fetchone() == (1,)
    finally:
        connection.close()


def test_requires_concrete_source_and_never_overwrites_output(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    output = tmp_path / "knowledge-discovery.db"
    _source_database(source)
    count = build_knowledge_discovery_pack(
        (source,),
        output,
        edition_id="minimed.knowledge.discovery.test",
        version="2026.09.18",
        built_at="2026-09-18T00:00:00Z",
        entity_types=frozenset({"scale"}),
    )
    # scale.hidden has no evidence/document link and must not become a source-less card.
    assert count == 0
    with pytest.raises(ValueError, match="immutable"):
        build_knowledge_discovery_pack(
            (source,),
            output,
            edition_id="minimed.knowledge.discovery.test",
            version="2026.09.18",
            built_at="2026-09-18T00:00:00Z",
        )


def test_optional_portable_vectors_embed_only_the_concept_card(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    output = tmp_path / "knowledge-discovery-vectors.db"
    _source_database(source)

    count = build_knowledge_discovery_pack(
        (source,),
        output,
        edition_id="minimed.knowledge.discovery.vectors.test",
        version="2026.09.18",
        built_at="2026-09-18T00:00:00Z",
        entity_types=frozenset({"criterion_set"}),
        include_portable_vectors=True,
    )
    assert count == 1

    connection = sqlite3.connect(output)
    try:
        assert connection.execute("SELECT count(*) FROM embedding_profiles").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM chunk_embeddings").fetchone() == (1,)
        row = connection.execute(
            """SELECT length(e.vector), e.vector_norm, s.section_type
            FROM chunk_embeddings e
            JOIN chunks c ON c.id = e.chunk_id
            JOIN sections s ON s.id = c.section_id"""
        ).fetchone()
        assert row is not None
        vector_bytes, vector_norm, section_type = row
        assert vector_bytes == 384
        assert vector_norm > 0
        assert section_type == "definition"
        # The routing/source-list chunk is intentionally not embedded as a separate concept vector.
        assert connection.execute("SELECT count(*) FROM chunks").fetchone() == (2,)
    finally:
        connection.close()
