from pathlib import Path

import pytest
import yaml

from localmed_ingest.knowledge import KnowledgeEvidence, KnowledgeRelation, RelationWeightComponents
from localmed_ingest.knowledge_modules import load_knowledge_modules
from localmed_ingest.models import PackChunk, PackDocument, PackSection, PackVersion


def write_module(path: Path, entity_id: str, *, schema_version: int = 1) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "schemaVersion": schema_version,
                "entities": [
                    {
                        "id": entity_id,
                        "entityType": "medication",
                        "canonicalName": entity_id,
                    }
                ],
                "facts": [],
                "relations": [],
                "documentLinks": [],
                "reviewTasks": [],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def test_loads_multiple_knowledge_modules_as_one_workspace(tmp_path: Path) -> None:
    write_module(tmp_path / "knowledge.yaml", "medication.a")
    write_module(tmp_path / "knowledge.drugs.yaml", "medication.b")

    workspace = load_knowledge_modules(tmp_path, [])

    assert [entity.id for entity in workspace.entities] == ["medication.b", "medication.a"]


def test_rejects_duplicate_ids_across_modules(tmp_path: Path) -> None:
    write_module(tmp_path / "knowledge.yaml", "medication.same")
    write_module(tmp_path / "knowledge.drugs.yaml", "medication.same")

    with pytest.raises(ValueError, match=r"Duplicate knowledge id medication\.same"):
        load_knowledge_modules(tmp_path, [])


def test_rejects_schema_version_mismatch(tmp_path: Path) -> None:
    write_module(tmp_path / "knowledge.yaml", "medication.a", schema_version=1)
    write_module(tmp_path / "knowledge.drugs.yaml", "medication.b", schema_version=2)

    with pytest.raises(ValueError, match="schema mismatch"):
        load_knowledge_modules(tmp_path, [])


def test_promotes_exact_rls_relations_to_professional_reference(tmp_path: Path) -> None:
    document = PackDocument(
        id="rls.mkb.node.i67-9",
        title="I67.9",
        source_type="rls_mkb_reference",
        status="active",
        specialties=[],
        metadata={},
        version=PackVersion(
            id="rls.mkb.node.i67-9@1",
            label="1",
            source_checksum="sha256:test",
            extracted_at="2026-01-01T00:00:00Z",
        ),
        sections=[
            PackSection(
                id="section.i67-9",
                title="Лечение",
                normalized_title="лечение",
                depth=1,
                order_index=0,
                anchor="section.i67-9",
                section_path=["Лечение"],
                chunks=[
                    PackChunk(
                        id="chunk.i67-9",
                        order_index=0,
                        original_text="Агапурин",
                        normalized_text="агапурин",
                        anchor="chunk.i67-9",
                    )
                ],
            )
        ],
    )
    relation = KnowledgeRelation(
        id="relation.i67-9",
        subject_entity_id="rls.mkb.entity.i67-9",
        predicate="listed-on-rls-mkb-page",
        object_entity_id="medication.brand.agapurin",
        authority_tier="third-party",
        review_status="proposed",
        weights=RelationWeightComponents(
            authority=0.45,
            evidence_quality=1.0,
            applicability=1.0,
            recency=1.0,
        ),
        evidence=[
            KnowledgeEvidence(
                document_id=document.id,
                document_version_id=document.version.id,
                section_id="section.i67-9",
                chunk_id="chunk.i67-9",
                quote="Агапурин",
            )
        ],
    )
    (tmp_path / "knowledge.yaml").write_text(
        yaml.safe_dump(
            {
                "schemaVersion": 1,
                "entities": [
                    {
                        "id": "rls.mkb.entity.i67-9",
                        "entityType": "condition",
                        "canonicalName": "I67.9",
                    },
                    {
                        "id": "medication.brand.agapurin",
                        "entityType": "medication",
                        "canonicalName": "Агапурин",
                    },
                ],
                "facts": [],
                "relations": [relation.model_dump(by_alias=True, mode="json")],
                "documentLinks": [],
                "reviewTasks": [],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    workspace = load_knowledge_modules(tmp_path, [document])

    assert workspace.relations[0].authority_tier == "professional-reference"
