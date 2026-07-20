from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
import yaml

from localmed_ingest.knowledge import (
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeFact,
    KnowledgeRelation,
    KnowledgeWorkspace,
    RelationWeightComponents,
    ReviewStatus,
    apply_search_projection,
    approve_knowledge,
    export_chatgpt_tasks,
    import_chatgpt_responses,
    validate_knowledge_workspace,
    write_knowledge_sqlite,
)
from localmed_ingest.models import PackChunk, PackDocument, PackSection, PackVersion


def documents() -> list[PackDocument]:
    chunk = PackChunk(
        id="chunk.demo",
        order_index=0,
        original_text=(
            "Источник прямо упоминает препарат А для состояния Б. Дозировка не приведена."
        ),
        normalized_text="источник препарат состояние дозировка",
        anchor="doc@1/treatment#chunk-demo",
    )
    section = PackSection(
        id="section.demo",
        title="Лечение",
        normalized_title="лечение",
        section_type="treatment",
        depth=1,
        order_index=0,
        anchor="doc@1/treatment",
        section_path=["Лечение"],
        chunks=[chunk],
    )
    return [
        PackDocument(
            id="doc.demo",
            title="Демонстрационный источник",
            source_type="synthetic_fixture",
            status="active",
            specialties=[],
            metadata={},
            version=PackVersion(
                id="doc.demo@1",
                label="1",
                source_checksum="sha256:test",
                extracted_at="2026-07-20T00:00:00Z",
            ),
            sections=[section],
        )
    ]


def evidence(
    quote: str = "Источник прямо упоминает препарат А для состояния Б.",
) -> KnowledgeEvidence:
    return KnowledgeEvidence(
        document_id="doc.demo",
        document_version_id="doc.demo@1",
        section_id="section.demo",
        chunk_id="chunk.demo",
        quote=quote,
    )


def workspace(review_status: ReviewStatus = "reviewed") -> KnowledgeWorkspace:
    return KnowledgeWorkspace(
        entities=[
            KnowledgeEntity(id="drug.a", entity_type="medication", canonical_name="препарат А"),
            KnowledgeEntity(
                id="condition.b", entity_type="condition", canonical_name="состояние Б"
            ),
        ],
        facts=[
            KnowledgeFact(
                id="fact.a",
                entity_id="drug.a",
                fact_type="treatment-mention",
                text="Источник прямо упоминает препарат А для состояния Б.",
                authority_tier="synthetic-fixture",
                review_status=review_status,
                evidence=[evidence()],
            )
        ],
        relations=[
            KnowledgeRelation(
                id="relation.a-b",
                subject_entity_id="drug.a",
                predicate="mentioned-for",
                object_entity_id="condition.b",
                authority_tier="synthetic-fixture",
                review_status=review_status,
                weights=RelationWeightComponents(
                    authority=0.1,
                    evidence_quality=0.4,
                    applicability=0.4,
                    recency=0.5,
                    editorial_review=1.0 if review_status == "reviewed" else 0.0,
                ),
                evidence=[evidence()],
            )
        ],
    )


def test_exact_source_quote_is_required() -> None:
    current = workspace()
    current.facts[0].evidence[0].quote = "Такой цитаты нет"
    with pytest.raises(ValueError, match="exact substring"):
        validate_knowledge_workspace(current, documents())


def test_only_reviewed_knowledge_enters_chunk_projection() -> None:
    reviewed_documents = documents()
    apply_search_projection(reviewed_documents, workspace("reviewed"))
    reviewed_chunk = reviewed_documents[0].sections[0].chunks[0]
    assert "препарат" in reviewed_chunk.normalized_text
    assert reviewed_chunk.metadata["knowledgeProjectionVersion"] == 1

    proposed_documents = documents()
    apply_search_projection(proposed_documents, workspace("proposed"))
    proposed_chunk = proposed_documents[0].sections[0].chunks[0]
    assert "knowledgeProjectionVersion" not in proposed_chunk.metadata


def test_structured_knowledge_is_written_beside_vector_content(tmp_path: Path) -> None:
    database = tmp_path / "knowledge.db"
    connection = sqlite3.connect(database)
    try:
        for path in sorted((Path(__file__).resolve().parents[3] / "schema/sql").glob("*.sql")):
            connection.executescript(path.read_text(encoding="utf-8"))
        connection.execute(
            "INSERT INTO content_packs VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("pack", "1", 2, "Pack", "sha256:test", "2026-01-01T00:00:00Z", 1),
        )
        connection.execute(
            "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "doc.demo",
                "pack",
                "Doc",
                None,
                "fixture",
                "active",
                "[]",
                "{}",
                "doc.demo@1",
            ),
        )
        connection.execute(
            "INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "doc.demo@1",
                "doc.demo",
                "1",
                None,
                None,
                "sha256:test",
                "2026-01-01T00:00:00Z",
            ),
        )
        connection.execute(
            "INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "section.demo",
                "doc.demo@1",
                None,
                "Лечение",
                "лечение",
                "treatment",
                1,
                0,
                None,
                None,
                "doc.demo@1/treatment",
                '["Лечение"]',
            ),
        )
        connection.execute(
            "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "chunk.demo",
                "doc.demo@1",
                "section.demo",
                0,
                "Источник прямо упоминает препарат А для состояния Б. Дозировка не приведена.",
                "источник препарат состояние",
                None,
                None,
                None,
                None,
                None,
                None,
                "doc.demo@1/treatment#chunk-demo",
                "{}",
            ),
        )
        connection.commit()
    finally:
        connection.close()

    write_knowledge_sqlite(database, workspace())
    connection = sqlite3.connect(database)
    try:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT count(*) FROM knowledge_entities").fetchone() == (2,)
        assert connection.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM knowledge_fts").fetchone() == (2,)
    finally:
        connection.close()


def test_chatgpt_import_is_proposed_and_creates_missing_data_task(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "localmed_ingest.knowledge.load_workspace_documents", lambda _path: documents()
    )
    responses = tmp_path / "responses.jsonl"
    responses.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "taskId": "chunk.demo",
                "entities": [
                    {
                        "key": "drug",
                        "entityType": "medication",
                        "canonicalName": "препарат А",
                    },
                    {
                        "key": "condition",
                        "entityType": "condition",
                        "canonicalName": "состояние Б",
                    },
                ],
                "facts": [
                    {
                        "entityKey": "drug",
                        "factType": "treatment-mention",
                        "text": "Источник прямо упоминает препарат А для состояния Б.",
                        "evidenceQuote": "Источник прямо упоминает препарат А для состояния Б.",
                        "authorityTier": "official-label",
                        "missingFields": ["pediatric-dose"],
                    }
                ],
                "relations": [
                    {
                        "subjectKey": "drug",
                        "predicate": "mentioned-for",
                        "objectKey": "condition",
                        "evidenceQuote": "Источник прямо упоминает препарат А для состояния Б.",
                        "authorityTier": "official-label",
                    }
                ],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "knowledge.yaml"
    report = import_chatgpt_responses(tmp_path, responses, output)
    imported = KnowledgeWorkspace.model_validate(yaml.safe_load(output.read_text(encoding="utf-8")))
    assert report.facts == 1
    assert imported.facts[0].review_status == "proposed"
    assert imported.relations[0].review_status == "proposed"
    assert imported.facts[0].authority_tier == "synthetic-fixture"
    assert imported.relations[0].authority_tier == "synthetic-fixture"
    assert imported.facts[0].metadata["requestedAuthorityTier"] == "official-label"
    assert imported.review_tasks[0].missing_fields == ["pediatric-dose"]


def test_human_approval_records_reviewer_and_reweights_relation(tmp_path: Path) -> None:
    source = tmp_path / "proposed.yaml"
    proposed = workspace("proposed")
    source.write_text(
        yaml.safe_dump(proposed.model_dump(by_alias=True, mode="json"), allow_unicode=True),
        encoding="utf-8",
    )
    output = tmp_path / "reviewed.yaml"
    approve_knowledge(source, output, {"fact.a", "relation.a-b"}, "dr.test")
    reviewed = KnowledgeWorkspace.model_validate(yaml.safe_load(output.read_text(encoding="utf-8")))
    assert reviewed.facts[0].review_status == "reviewed"
    assert reviewed.facts[0].metadata["reviewedBy"] == "dr.test"
    assert reviewed.relations[0].review_status == "reviewed"
    assert reviewed.relations[0].weights.editorial_review == 1.0
    assert reviewed.relations[0].final_weight == reviewed.relations[0].weights.total()


def test_chatgpt_export_requires_derivative_processing_rights(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_documents = documents()
    source_documents[0].source_type = "official_label"
    source_documents[0].metadata = {}
    monkeypatch.setattr(
        "localmed_ingest.knowledge.load_workspace_documents", lambda _path: source_documents
    )
    output = tmp_path / "tasks.jsonl"
    with pytest.raises(ValueError, match="derivative-processing rights"):
        export_chatgpt_tasks(tmp_path, output)

    source_documents[0].metadata = {
        "rights": {
            "licenseId": "contract-1",
            "allowsDerivativeProcessing": True,
        }
    }
    assert export_chatgpt_tasks(tmp_path, output) == 1
    task = json.loads(output.read_text(encoding="utf-8"))
    assert task["source"]["rights"] == {
        "licenseId": "contract-1",
        "allowsDerivativeProcessing": True,
    }


def test_chatgpt_import_does_not_merge_medications_by_display_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "localmed_ingest.knowledge.load_workspace_documents", lambda _path: documents()
    )
    responses = tmp_path / "responses.jsonl"
    responses.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "taskId": "chunk.demo",
                "entities": [
                    {
                        "key": "drug-5",
                        "entityType": "medication",
                        "canonicalName": "Препарат А",
                        "medication": {
                            "conceptLevel": "clinical-drug",
                            "inn": "вещество А",
                            "dosageForm": "таблетка",
                            "route": "oral",
                            "strength": "5 мг",
                        },
                    },
                    {
                        "key": "drug-10",
                        "entityType": "medication",
                        "canonicalName": "Препарат А",
                        "medication": {
                            "conceptLevel": "clinical-drug",
                            "inn": "вещество А",
                            "dosageForm": "таблетка",
                            "route": "oral",
                            "strength": "10 мг",
                        },
                    },
                ],
                "facts": [],
                "relations": [],
                "reviewTasks": [],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "knowledge.yaml"
    report = import_chatgpt_responses(tmp_path, responses, output)
    imported = KnowledgeWorkspace.model_validate(yaml.safe_load(output.read_text(encoding="utf-8")))
    assert report.entities == 2
    assert len({entity.id for entity in imported.entities}) == 2
    assert sorted(
        entity.medication.strength
        for entity in imported.entities
        if entity.medication is not None and entity.medication.strength is not None
    ) == ["10 мг", "5 мг"]
