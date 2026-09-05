from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from localmed_ingest.builder import build_content_pack
from localmed_ingest.catalog_module_builder import build_core_reference_pointers
from localmed_ingest.cli import app


def _write_reference_database(path: Path, *, malformed_metadata: bool = False) -> None:
    documents: list[tuple[str, str, str, str, dict[str, object]]] = [
        (
            "rls.mkb.node.r04-0",
            "R04.0 Носовое кровотечение, МКБ-10",
            "R04.0 Носовое кровотечение",
            "rls_mkb_reference",
            {"mkbCode": "R04.0", "icd10Codes": ["R04.0"], "sourceKind": "icd-10"},
        ),
        (
            "rls.mkb.node.s52-0",
            "S52.0 Перелом предплечья, МКБ-10",
            "S52.0 Перелом предплечья",
            "rls_mkb_reference",
            {"mkbCode": "S52.0", "icd10Codes": ["S52.0"], "sourceKind": "icd-10"},
        ),
        (
            "rls.mkb.node.t17-0",
            "T17.0 Инородное тело в дыхательных путях, МКБ-10",
            "T17.0 Инородное тело в дыхательных путях",
            "rls_mkb_reference",
            {"mkbCode": "T17.0", "icd10Codes": ["T17.0"], "sourceKind": "icd-10"},
        ),
        (
            "rls.mkb.node.e80-4",
            "E80.4 Синдром Жильбера, МКБ-10",
            "E80.4 Синдром Жильбера",
            "rls_mkb_reference",
            {"mkbCode": "E80.4", "icd10Codes": ["E80.4"], "sourceKind": "icd-10"},
        ),
        (
            "krasotaimedicina.disease.test",
            "Атопический дерматит",
            "Атопический дерматит",
            "krasotaimedicina_reference",
            {
                "sourceKind": "disease-reference",
                "entityType": "disease",
                "icd10Codes": ["R04.0"],
                "publisher": "Красота и медицина",
                "images": [{"path": "assets/private.jpg"}],
                "fullText": "PRIVATE FULL ARTICLE TEXT MUST NOT BE COPIED",
            },
        ),
        (
            "krasotaimedicina.disease.syndrome",
            "Синдром Барта",
            "Синдром Барта",
            "krasotaimedicina_reference",
            {
                "sourceKind": "disease-reference",
                "entityType": "syndrome",
                "icd10Codes": [],
            },
        ),
        (
            "rls.mkb.classification",
            "Международная классификация болезней (МКБ-10) — РЛС",
            "Классификация МКБ-10",
            "medical_reference",
            {"sourceKind": "icd-10", "coverage": "full-index", "icd10Codes": []},
        ),
    ]
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            PRAGMA foreign_keys = ON;
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                short_title TEXT,
                source_type TEXT NOT NULL,
                status TEXT NOT NULL,
                specialty_json TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                current_version_id TEXT NOT NULL
            );
            CREATE TABLE document_versions (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id),
                version_label TEXT NOT NULL,
                source_checksum TEXT NOT NULL,
                extracted_at TEXT NOT NULL
            );
            CREATE TABLE aliases (
                id TEXT PRIMARY KEY,
                canonical_term TEXT NOT NULL,
                alias TEXT NOT NULL,
                category TEXT,
                weight REAL NOT NULL
            );
            CREATE TABLE sections (
                id TEXT PRIMARY KEY,
                document_version_id TEXT NOT NULL REFERENCES document_versions(id),
                title TEXT NOT NULL,
                order_index INTEGER NOT NULL
            );
            CREATE TABLE chunks (
                id TEXT PRIMARY KEY,
                document_version_id TEXT NOT NULL REFERENCES document_versions(id),
                section_id TEXT NOT NULL REFERENCES sections(id),
                order_index INTEGER NOT NULL,
                original_text TEXT NOT NULL,
                anchor TEXT NOT NULL
            );
            """
        )
        for index, (document_id, title, short_title, source_type, metadata) in enumerate(
            documents, start=1
        ):
            metadata = {
                "sourceFile": f"https://example.test/source/{index}",
                "officialSourceUrl": f"https://example.test/official/{index}",
                "publisher": "Регистр лекарственных средств России",
                "rightsStatus": "unknown",
                **metadata,
            }
            metadata_json = (
                "not-json" if malformed_metadata and index == 1 else json.dumps(metadata)
            )
            version_id = f"{document_id}@v1"
            connection.execute(
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    document_id,
                    title,
                    short_title,
                    source_type,
                    "active",
                    json.dumps(["medical-reference"]),
                    metadata_json,
                    version_id,
                ),
            )
            connection.execute(
                "INSERT INTO document_versions VALUES (?, ?, ?, ?, ?)",
                (
                    version_id,
                    document_id,
                    "source-v1",
                    f"sha256:{index:064d}",
                    "2026-09-04T00:00:00Z",
                ),
            )
            if source_type == "krasotaimedicina_reference":
                section_id = f"{document_id}.summary"
                chunk_id = f"{section_id}.chunk"
                connection.execute(
                    "INSERT INTO sections VALUES (?, ?, ?, ?)",
                    (section_id, version_id, "Краткое описание", 0),
                )
                connection.execute(
                    "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        chunk_id,
                        version_id,
                        section_id,
                        0,
                        f"**{title}** — [краткое](https://example.test) определение.",
                        f"{document_id}/summary#chunk",
                    ),
                )
        connection.executemany(
            "INSERT INTO aliases VALUES (?, ?, ?, ?, ?)",
            [
                ("alias.r04", "R04.0", "Эпистаксис", "diagnosis", 1.0),
                ("alias.s52", "S52.0", "Перелом предплечья", "diagnosis", 1.0),
                ("alias.barth", "Синдром Барта", "Болезнь Барта", "diagnosis", 1.0),
                ("alias.unmatched", "неизвестный canonical", "Не должен попасть", "diagnosis", 1.0),
                ("alias.medication", "Амоксициллин", "Амоксил", "medication", 1.0),
            ],
        )
        classification_version = "rls.mkb.classification@v1"
        classification_nodes = [
            ("R00-R99", "R00-R99 Болезни органов дыхания", "https://example.test/official/r"),
            ("R04", "R04 Кровотечение из дыхательных путей", "https://example.test/official/r04"),
            (
                "R04.0",
                "R04.0 Носовое кровотечение",
                "https://example.test/official/r04-0",
            ),
        ]
        for order_index, (code, title, source_url) in enumerate(classification_nodes):
            section_id = f"rls.mkb.classification.{code}.section"
            chunk_id = f"{section_id}.chunk"
            connection.execute(
                "INSERT INTO sections VALUES (?, ?, ?, ?)",
                (section_id, classification_version, title, order_index),
            )
            connection.execute(
                "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)",
                (
                    chunk_id,
                    classification_version,
                    section_id,
                    0,
                    f"Код МКБ-10: {code}. Источник: {source_url}",
                    f"classification/{code}#chunk",
                ),
            )


def test_builds_compact_reference_pointers_with_classification_and_routing(tmp_path: Path) -> None:
    source = tmp_path / "reference.db"
    output = tmp_path / "pointers"
    _write_reference_database(source)

    report = build_core_reference_pointers(
        source,
        output,
        module_id="minimed.mkb.ru",
        module_title="МКБ и справочные материалы",
        version="2026.09.1",
        built_at="2026-09-04T00:00:00Z",
    )

    assert report.family == "reference"
    assert report.total_documents == 7
    module_dir = output / "minimed.mkb.ru"
    manifest = yaml.safe_load((module_dir / "manifest.yaml").read_text(encoding="utf-8"))
    assert manifest["id"] == "minimed.mkb.ru"
    assert manifest["title"] == "МКБ и справочные материалы"

    database = tmp_path / "built.db"
    build_content_pack(module_dir, database, include_embeddings=False)
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT id, title, short_title, source_type, metadata_json FROM documents ORDER BY id"
        ).fetchall()
    assert len(rows) == 7
    by_target = {json.loads(row[4])["targetDocumentId"]: row for row in rows}

    rls_symptom = json.loads(by_target["rls.mkb.node.r04-0"][4])
    assert rls_symptom["entityType"] == "symptom"
    assert rls_symptom["icd10Codes"] == ["R04.0"]
    assert rls_symptom["sourceType"] == "rls_mkb_reference"
    assert rls_symptom["primaryModuleId"] == "minimed.mkb.ru"
    assert [item["code"] for item in rls_symptom["classificationPath"]] == ["R04", "R00-R99"]
    assert rls_symptom["referenceCoverage"] == "classification-only"

    for target_id in ("rls.mkb.node.s52-0", "rls.mkb.node.t17-0"):
        assert json.loads(by_target[target_id][4])["entityType"] == "condition"
    assert json.loads(by_target["rls.mkb.node.e80-4"][4])["entityType"] == "syndrome"
    assert json.loads(by_target["krasotaimedicina.disease.test"][4])["entityType"] == "disease"
    assert json.loads(by_target["krasotaimedicina.disease.test"][4])["canonicalDefinition"] == {
        "definitionId": "reference.definition.9f678c791ccf67a40844",
        "text": "Атопический дерматит — краткое определение.",
        "sourceDocumentId": "krasotaimedicina.disease.test",
        "sourceDocumentVersionId": "krasotaimedicina.disease.test@v1",
        "sourceSectionId": "krasotaimedicina.disease.test.summary",
        "sourceChunkId": "krasotaimedicina.disease.test.summary.chunk",
        "sourceAnchor": "krasotaimedicina.disease.test/summary#chunk",
        "sourceSectionTitle": "Краткое описание",
    }
    assert by_target["krasotaimedicina.disease.test"][3] == "core_catalog_pointer"
    assert all(row[0] != json.loads(row[4])["targetDocumentId"] for row in rows)

    aliases = yaml.safe_load((module_dir / "aliases.yaml").read_text(encoding="utf-8"))["aliases"]
    alias_values = {item["alias"] for item in aliases}
    assert {"Эпистаксис", "Перелом предплечья", "Болезнь Барта"} <= alias_values
    assert [item["alias"] for item in aliases].count("Эпистаксис") == 1
    assert {"Не должен попасть", "Амоксил"}.isdisjoint(alias_values)

    output_text = "\n".join(
        path.read_text(encoding="utf-8") for path in output.rglob("*") if path.is_file()
    )
    assert "PRIVATE FULL ARTICLE TEXT MUST NOT BE COPIED" not in output_text
    assert "assets/private.jpg" not in output_text
    assert "images:" not in output_text
    assert "Полный материал доступен в скачиваемом модуле" not in output_text
    assert all(row[3] == "core_catalog_pointer" for row in rows)

    first_output = {
        path.relative_to(output): path.read_bytes() for path in output.rglob("*") if path.is_file()
    }
    build_core_reference_pointers(
        source,
        output,
        module_id="minimed.mkb.ru",
        module_title="МКБ и справочные материалы",
        version="2026.09.1",
        built_at="2026-09-04T00:00:00Z",
        force=True,
    )
    second_output = {
        path.relative_to(output): path.read_bytes() for path in output.rglob("*") if path.is_file()
    }
    assert first_output == second_output


def test_build_core_reference_pointers_command_and_boundary_validation(tmp_path: Path) -> None:
    source = tmp_path / "reference.db"
    _write_reference_database(source)
    output = tmp_path / "cli-pointers"
    result = CliRunner().invoke(
        app,
        [
            "build-core-reference-pointers",
            "--source",
            str(source),
            "--output",
            str(output),
            "--version",
            "2026.09.1",
            "--module-id",
            "minimed.mkb.ru",
            "--module-title",
            "МКБ",
            "--built-at",
            "2026-09-04T00:00:00Z",
        ],
    )
    assert result.exit_code == 0, result.stdout
    assert json.loads(result.stdout)["totalDocuments"] == 7

    with pytest.raises(ValueError, match="outside"):
        build_core_reference_pointers(
            source,
            source,
            module_id="minimed.mkb.ru",
            module_title="МКБ",
            version="2026.09.1",
            built_at="2026-09-04T00:00:00Z",
        )

    malformed = tmp_path / "malformed.db"
    _write_reference_database(malformed, malformed_metadata=True)
    with pytest.raises(ValueError, match="metadata_json"):
        build_core_reference_pointers(
            malformed,
            tmp_path / "malformed-output",
            module_id="minimed.mkb.ru",
            module_title="МКБ",
            version="2026.09.1",
            built_at="2026-09-04T00:00:00Z",
        )
