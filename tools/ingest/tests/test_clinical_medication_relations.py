from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

from typer.testing import CliRunner

from localmed_ingest.clinical_medication_relations import (
    extract_clinical_medication_relations,
    write_clinical_medication_relation_batch,
    write_clinical_medication_relation_candidates,
)
from localmed_ingest.regulated_catalog_cli import app
from localmed_ingest.sqlite_builder import schema_sql


def _database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.executescript(schema_sql())
    connection.execute(
        "INSERT INTO content_packs VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("fixture", "1", 2, "Fixture", "sha256:fixture", "2026-09-01T00:00:00Z", 1),
    )
    return connection


def _clinical_database(path: Path) -> None:
    with _database(path) as connection:
        connection.execute(
            "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "kr.rf.654_2",
                "fixture",
                "Внебольничная пневмония у детей",
                None,
                "clinical_recommendation",
                "active",
                "[]",
                json.dumps({"officialId": "654_2", "ageGroups": ["Дети"]}),
                "kr.rf.654_2@1",
            ),
        )
        connection.execute(
            "INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "kr.rf.654_2@1",
                "kr.rf.654_2",
                "1",
                None,
                None,
                "sha256:clinical",
                "2026-09-01T00:00:00Z",
            ),
        )
        sections = [
            ("treatment", None, "3. Лечение", "treatment", 1, 0),
            ("child", "treatment", "3.1 Антибактериальная терапия", "other", 2, 1),
            ("flat", None, "8 ч с момента верификации диагноза", "other", 1, 2),
            ("other", None, "1. Общие сведения", "other", 1, 3),
            ("references", None, "Список литературы", "references", 1, 4),
        ]
        for section_id, parent_id, title, section_type, depth, order_index in sections:
            connection.execute(
                "INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    section_id,
                    "kr.rf.654_2@1",
                    parent_id,
                    title,
                    title.casefold(),
                    section_type,
                    depth,
                    order_index,
                    None,
                    None,
                    f"kr.rf.654_2@1/{section_id}",
                    json.dumps([title], ensure_ascii=False),
                ),
            )
        chunks = [
            ("positive", "child", "Пациентам рекомендуется цефтриаксон.", 0),
            (
                "combination",
                "flat",
                "В качестве препарата выбора рекомендуется цефтриаксон + сульбактам.",
                1,
            ),
            (
                "negative",
                "other",
                "Азитромицин не рекомендуется. Роцефин рекомендуется пациентам.",
                2,
            ),
            (
                "conditional",
                "child",
                "Макролиды (азитромицин) могут применяться при невозможности назначить "
                "цефтриаксон.",
                3,
            ),
            ("reference", "references", "Авторы рекомендуют цефтриаксон.", 4),
            (
                "contained",
                "child",
                "Рентгеноконтрастные средства, содержащие йод, могут применяться.",
                5,
            ),
            (
                "hyphenated",
                "child",
                "При йод-накапливающих очагах рекомендуются повторные курсы препарата.",
                6,
            ),
        ]
        for chunk_id, section_id, text, order_index in chunks:
            connection.execute(
                "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    chunk_id,
                    "kr.rf.654_2@1",
                    section_id,
                    order_index,
                    text,
                    text.casefold(),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    f"kr.rf.654_2@1/{section_id}#{chunk_id}",
                    "{}",
                ),
            )


def _medication_database(path: Path) -> None:
    with _database(path) as connection:
        for index, (inn, target) in enumerate(
            [
                ("ЦЕФТРИАКСОН", "esklp.mnn.цефтриаксон"),
                ("ЦЕФТРИАКСОН+СУЛЬБАКТАМ", "esklp.mnn.цефтриаксон-сульбактам"),
                ("АЗИТРОМИЦИН", "esklp.mnn.азитромицин"),
                ("ЙОД", "esklp.mnn.йод"),
            ]
        ):
            document_id = f"pointer.{index}"
            connection.execute(
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    document_id,
                    "fixture",
                    inn,
                    None,
                    "core_catalog_pointer",
                    "active",
                    "[]",
                    json.dumps(
                        {
                            "catalogFamily": "medication",
                            "entityType": "medication",
                            "standardizedInn": inn,
                            "targetDocumentId": target,
                        },
                        ensure_ascii=False,
                    ),
                    f"{document_id}@1",
                ),
            )


def _fixtures(tmp_path: Path) -> tuple[Path, Path]:
    clinical = tmp_path / "clinical.db"
    medications = tmp_path / "medications.db"
    _clinical_database(clinical)
    _medication_database(medications)
    return clinical, medications


def test_extracts_only_source_exact_positive_mnn_relations(tmp_path: Path) -> None:
    clinical, medications = _fixtures(tmp_path)

    workspace = extract_clinical_medication_relations(clinical, medications)

    assert len(workspace.relations) == 3
    by_inn = {relation.metadata["standardizedInn"]: relation for relation in workspace.relations}
    assert set(by_inn) == {
        "АЗИТРОМИЦИН",
        "ЦЕФТРИАКСОН",
        "ЦЕФТРИАКСОН+СУЛЬБАКТАМ",
    }
    assert by_inn["ЦЕФТРИАКСОН"].review_status == "proposed"
    assert by_inn["ЦЕФТРИАКСОН"].predicate == "recommended-for"
    assert by_inn["ЦЕФТРИАКСОН"].metadata["population"] == {"ageGroups": ["Дети"]}
    assert by_inn["ЦЕФТРИАКСОН"].metadata["underTreatmentBranch"] is True
    assert by_inn["ЦЕФТРИАКСОН+СУЛЬБАКТАМ"].metadata["underTreatmentBranch"] is False
    assert by_inn["ЦЕФТРИАКСОН+СУЛЬБАКТАМ"].evidence[0].quote == (
        "В качестве препарата выбора рекомендуется цефтриаксон + сульбактам."
    )
    conditional = [
        relation
        for relation in workspace.relations
        if relation.evidence[0].chunk_id == "conditional"
    ]
    assert [relation.metadata["standardizedInn"] for relation in conditional] == ["АЗИТРОМИЦИН"]
    medication_entities = {
        entity.canonical_name: entity
        for entity in workspace.entities
        if entity.entity_type == "medication"
    }
    assert medication_entities["ЦЕФТРИАКСОН"].external_ids == {
        "esklpMnnDocumentId": "esklp.mnn.цефтриаксон"
    }
    condition = next(entity for entity in workspace.entities if entity.entity_type == "condition")
    assert condition.external_ids == {"officialClinicalId": "654_2"}


def test_writer_and_cli_preserve_input_databases(tmp_path: Path) -> None:
    clinical, medications = _fixtures(tmp_path)
    before = {
        path: hashlib.sha256(path.read_bytes()).hexdigest() for path in (clinical, medications)
    }
    output = tmp_path / "relations.json"

    report = write_clinical_medication_relation_candidates(clinical, medications, output)

    assert report.candidate_relations == 3
    assert report.medication_identities == 3
    assert json.loads(output.read_text(encoding="utf-8"))["relations"]
    assert {
        path: hashlib.sha256(path.read_bytes()).hexdigest() for path in (clinical, medications)
    } == before

    cli_output = tmp_path / "relations-cli.json"
    result = CliRunner().invoke(
        app,
        [
            "clinical-medication-relations",
            "--clinical-db",
            str(clinical),
            "--medication-index",
            str(medications),
            "--output",
            str(cli_output),
        ],
    )
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["candidateRelations"] == 3
    assert cli_output.exists()


def test_batch_is_parallel_and_resumable(tmp_path: Path) -> None:
    clinical, medications = _fixtures(tmp_path)
    databases = tmp_path / "databases"
    databases.mkdir()
    shutil.copyfile(clinical, databases / "first.db")
    shutil.copyfile(clinical, databases / "second.db")
    output = tmp_path / "batch"

    report = write_clinical_medication_relation_batch(databases, medications, output, workers=2)

    assert report.databases == 2
    assert report.candidate_relations == 6
    assert report.reused == 0
    assert sorted(path.name for path in output.glob("*.json")) == [
        "first.json",
        "second.json",
    ]
    resumed = write_clinical_medication_relation_batch(
        databases, medications, output, workers=2, resume=True
    )
    assert resumed.candidate_relations == 6
    assert resumed.reused == 2
    with sqlite3.connect(databases / "first.db") as connection:
        connection.execute("UPDATE document_versions SET source_checksum = 'sha256:changed'")
    refreshed = write_clinical_medication_relation_batch(
        databases, medications, output, workers=2, resume=True
    )
    assert refreshed.candidate_relations == 6
    assert refreshed.reused == 1
