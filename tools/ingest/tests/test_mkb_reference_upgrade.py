from __future__ import annotations

import sqlite3
from pathlib import Path

from localmed_ingest.mkb_reference_upgrade import upgrade_mkb_reference_database
from localmed_ingest.sqlite_builder import schema_sql


def test_mkb_reference_upgrade_promotes_exact_rls_evidence(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    output = tmp_path / "output.db"
    connection = sqlite3.connect(source)
    try:
        connection.executescript(schema_sql())
        with connection:
            connection.execute(
                "INSERT INTO content_packs VALUES (?, ?, ?, ?, ?, ?, 1)",
                ("pack", "1", 2, "MKB", "sha256:test", "2026-08-15"),
            )
            connection.execute(
                """INSERT INTO documents(
                    id, content_pack_id, title, short_title, source_type, status,
                    specialty_json, metadata_json, current_version_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("doc", "pack", "I67.9", None, "rls_mkb_reference", "active", "[]", "{}", "ver"),
            )
            connection.execute(
                """INSERT INTO document_versions(
                    id, document_id, version_label, effective_from, effective_to,
                    source_checksum, extracted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                ("ver", "doc", "1", None, None, "sha256:test", "2026-08-15"),
            )
            connection.execute(
                """INSERT INTO sections(
                    id, document_version_id, parent_section_id, title, normalized_title,
                    section_type, depth, order_index, page_start, page_end, anchor, path_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "section",
                    "ver",
                    None,
                    "МКБ",
                    "мкб",
                    None,
                    1,
                    0,
                    None,
                    None,
                    "section",
                    '["МКБ"]',
                ),
            )
            connection.execute(
                """INSERT INTO chunks(
                    id, document_version_id, section_id, order_index, original_text,
                    normalized_text, page_start, page_end, char_start, char_end,
                    previous_chunk_id, next_chunk_id, anchor, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "chunk",
                    "ver",
                    "section",
                    0,
                    "Абактал",
                    "абактал",
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    "chunk",
                    "{}",
                ),
            )
            connection.executemany(
                """INSERT INTO knowledge_entities(
                    id, entity_type, canonical_name, normalized_name,
                    external_ids_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                [
                    ("medication", "medication", "Абактал", "абактал", "{}", "{}"),
                    ("disease", "disease", "I67.9", "i679", "{}", "{}"),
                ],
            )
            connection.execute(
                """INSERT INTO knowledge_relations(
                    id, subject_entity_id, predicate, object_entity_id, relation_status,
                    authority_tier, review_status, jurisdiction, final_weight,
                    weight_components_json, valid_from, valid_to, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "relation",
                    "medication",
                    "listed-on-rls-mkb-page",
                    "disease",
                    "reference-only",
                    "third-party",
                    "proposed",
                    "RU",
                    0.9,
                    "{}",
                    None,
                    None,
                    "{}",
                ),
            )
            connection.execute(
                """INSERT INTO knowledge_evidence(
                    id, fact_id, relation_id, document_id, document_version_id,
                    section_id, chunk_id, evidence_quote, source_locator_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("evidence", None, "relation", "doc", "ver", "section", "chunk", "Абактал", "{}"),
            )
    finally:
        connection.close()

    report = upgrade_mkb_reference_database(source, output)

    assert report["relationsUpdated"] == 1
    connection = sqlite3.connect(output)
    try:
        assert connection.execute(
            "SELECT authority_tier FROM knowledge_relations WHERE id = 'relation'"
        ).fetchone() == ("professional-reference",)
        assert connection.execute("SELECT count(*) FROM knowledge_fts").fetchone() == (2,)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        connection.close()
