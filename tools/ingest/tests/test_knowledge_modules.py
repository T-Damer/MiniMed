from pathlib import Path

import pytest
import yaml

from localmed_ingest.knowledge_modules import load_knowledge_modules


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

    with pytest.raises(ValueError, match="Duplicate knowledge id medication.same"):
        load_knowledge_modules(tmp_path, [])


def test_rejects_schema_version_mismatch(tmp_path: Path) -> None:
    write_module(tmp_path / "knowledge.yaml", "medication.a", schema_version=1)
    write_module(tmp_path / "knowledge.drugs.yaml", "medication.b", schema_version=2)

    with pytest.raises(ValueError, match="schema mismatch"):
        load_knowledge_modules(tmp_path, [])
