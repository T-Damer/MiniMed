from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from localmed_ingest.builder import build_content_pack
from localmed_ingest.catalog_module_builder import build_core_catalog_pointers
from localmed_ingest.clinical_aliases import (  # pyright: ignore[reportPrivateUsage]
    _keyword_section,  # pyright: ignore[reportPrivateUsage]
    enrich_clinical_aliases,
)
from localmed_ingest.regulated_catalog_cli import app


def _write_database(
    path: Path,
    *,
    official_id: str,
    sections: list[tuple[str, str, str]],
) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                metadata_json TEXT NOT NULL
            );
            CREATE TABLE sections (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                section_type TEXT,
                order_index INTEGER NOT NULL
            );
            CREATE TABLE chunks (
                id TEXT PRIMARY KEY,
                document_version_id TEXT NOT NULL,
                section_id TEXT NOT NULL,
                order_index INTEGER NOT NULL,
                original_text TEXT NOT NULL,
                page_start INTEGER,
                page_end INTEGER,
                char_start INTEGER,
                char_end INTEGER,
                anchor TEXT NOT NULL,
                metadata_json TEXT NOT NULL
            );
            """
        )
        connection.execute(
            "INSERT INTO documents(id, title, metadata_json) VALUES (?, ?, ?)",
            (
                f"kr.rf.{official_id}",
                f"Fixture {official_id}",
                json.dumps({"officialId": official_id}, ensure_ascii=False),
            ),
        )
        for order_index, (section_id, title, source_text) in enumerate(sections):
            chunk_id = f"chunk.{section_id}"
            connection.execute(
                "INSERT INTO sections(id, title, section_type, order_index) VALUES (?, ?, ?, ?)",
                (section_id, title, "other", order_index),
            )
            connection.execute(
                """INSERT INTO chunks(
                       id, document_version_id, section_id, order_index, original_text,
                       page_start, page_end, char_start, char_end, anchor, metadata_json
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    chunk_id,
                    f"kr.rf.{official_id}@fixture",
                    section_id,
                    order_index,
                    source_text,
                    3,
                    3,
                    10,
                    80,
                    f"kr.rf.{official_id}@fixture/{section_id}#{chunk_id}",
                    json.dumps(
                        {"sourceSpans": [{"page": 3, "block": f"block-{section_id}"}]},
                        ensure_ascii=False,
                    ),
                ),
            )


def _record(official_id: str, title: str) -> dict[str, object]:
    broad_module = "minimed.clinical.other.ru"
    return {
        "recordId": f"kr.rf.{official_id}",
        "officialId": official_id,
        "title": title,
        "versionLabel": "2026",
        "status": "active",
        "officialUrl": f"https://example.test/{official_id}",
        "moduleIds": [broad_module],
        "primaryModuleId": broad_module,
    }


def _write_medication_relations(path: Path, *, official_id: str) -> None:
    target_document_id = f"kr.rf.{official_id}"
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "entities": [
                    {
                        "id": "condition.pneumonia",
                        "entityType": "condition",
                        "canonicalName": "Пневмония",
                        "externalIds": {"officialClinicalId": official_id},
                        "metadata": {"sourceDocumentId": target_document_id},
                    },
                    {
                        "id": "medication.amoxicillin",
                        "entityType": "medication",
                        "canonicalName": "АМОКСИЦИЛЛИН",
                        "externalIds": {"esklpMnnDocumentId": "esklp.mnn.amoxicillin"},
                        "medication": {"conceptLevel": "substance", "inn": "АМОКСИЦИЛЛИН"},
                    },
                ],
                "relations": [
                    {
                        "id": "relation.amoxicillin-pneumonia",
                        "subjectEntityId": "medication.amoxicillin",
                        "predicate": "recommended-for",
                        "objectEntityId": "condition.pneumonia",
                        "relationStatus": "guideline",
                        "authorityTier": "clinical-guideline",
                        "reviewStatus": "proposed",
                        "weights": {
                            "authority": 0.95,
                            "evidenceQuality": 0.9,
                            "applicability": 0.5,
                            "recency": 0.5,
                            "editorialReview": 0.0,
                        },
                        "evidence": [
                            {
                                "documentId": target_document_id,
                                "documentVersionId": f"{target_document_id}@fixture",
                                "sectionId": "section.treatment",
                                "chunkId": "chunk.treatment",
                                "quote": "Рекомендовано назначить амоксициллин.",
                                "sourceLocator": {"anchor": "treatment#chunk-treatment"},
                            }
                        ],
                        "metadata": {"population": {"ageGroups": ["Дети"]}},
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_rejects_merged_keyword_section_title() -> None:
    assert not _keyword_section("Ключевые слова Список сокращений")


def test_extracts_keyword_lists_without_toc_or_abbreviation_leakage(tmp_path: Path) -> None:
    ledger_path = tmp_path / "coverage.json"
    records = [
        _record("32_2", "Синдром отмены психоактивных веществ"),
        _record("238_2", "Саркома Капоши"),
        _record("484_2", "Системная красная волчанка"),
    ]
    ledger_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-09-01T00:00:00Z",
                "sourceChecksum": "sha256:" + "1" * 64,
                "taxonomyChecksum": "sha256:" + "2" * 64,
                "records": records,
                "modules": [
                    {
                        "moduleId": "minimed.clinical.other.ru",
                        "title": "Другие",
                        "priority": 1,
                        "recordIds": [record["recordId"] for record in records],
                        "coverageCounts": {"metadata-only": len(records)},
                        "specialties": [],
                    }
                ],
                "summary": {
                    "totalRecords": len(records),
                    "coverageCounts": {"metadata-only": len(records)},
                    "statusCounts": {"active": len(records)},
                    "moduleCounts": {"minimed.clinical.other.ru": len(records)},
                },
                "warnings": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    databases = tmp_path / "databases"
    databases.mkdir()
    _write_database(
        databases / "clinical-32_2-clinical-fixture.db",
        official_id="32_2",
        sections=[
            (
                "section.keywords",
                "Ключевые слова",
                "Оглавление\n\n"
                "Ключевые слова. 3\n\n"
                "Ключевые слова\n\n"
                "o Синдром отмены o Абстинентный синдром o ПАВ o Опиоиды",
            )
        ],
    )
    _write_database(
        databases / "clinical-238_2-clinical-fixture.db",
        official_id="238_2",
        sections=[
            (
                "section.keywords",
                "Ключевые слова",
                "Саркома Капоши, HHV-8 (human herpesvirus 8, "
                "герпесвирус человека 8 типа), "
                "ятрогенная Саркома Капоши (возникающая при проведении "
                "иммуносупрессивной терапии цитостатиками и иммунодепрессантами)",
            )
        ],
    )
    _write_database(
        databases / "clinical-484_2-clinical-fixture.db",
        official_id="484_2",
        sections=[
            (
                "section.keywords",
                "Ключевые слова",
                "АГ – артериальная гипертензия\n\nIgA – иммуноглобулин А",
            )
        ],
    )

    output = tmp_path / "enriched.json"
    report_path = tmp_path / "aliases-report.json"
    enrich_clinical_aliases(ledger_path, databases, output, report_path)

    enriched = json.loads(output.read_text(encoding="utf-8"))
    by_id = {record["officialId"]: record for record in enriched["records"]}
    assert by_id["32_2"]["keywords"] == [
        "Синдром отмены",
        "Абстинентный синдром",
        "ПАВ",
        "Опиоиды",
    ]
    assert by_id["238_2"]["keywords"] == [
        "Саркома Капоши",
        "HHV-8 (human herpesvirus 8, герпесвирус человека 8 типа)",
        "ятрогенная Саркома Капоши (возникающая при проведении иммуносупрессивной терапии "
        "цитостатиками и иммунодепрессантами)",
    ]
    assert by_id["484_2"]["keywords"] == []

    saved_report = json.loads(report_path.read_text(encoding="utf-8"))
    source_keyword = next(
        item
        for record in saved_report["records"]
        if record["officialId"] == "32_2"
        for item in record["keywords"]
        if item["keyword"] == "ПАВ"
    )
    assert source_keyword["sectionTitle"] == "Ключевые слова"
    assert source_keyword["chunkId"] == "chunk.section.keywords"
    assert source_keyword["sourceText"].startswith("o Синдром отмены")


def test_enriches_safe_aliases_and_exact_recommendation_modules(tmp_path: Path) -> None:
    ledger_path = tmp_path / "coverage.json"
    records = [
        _record("654_2", "Пневмония (внебольничная)"),
        _record("286_3", "Сахарный диабет (СД)"),
        _record("999_1", "Ветряная оспа"),
        _record(
            "123_1",
            "Суправентрикулярные (наджелудочковые) тахикардии",
        ),
        _record("404_1", "Несопоставленная болезнь"),
        _record("777_1", "Дублированная база"),
    ]
    records[2]["aliases"] = ["Оспа"]
    ledger_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-09-01T00:00:00Z",
                "sourceChecksum": "sha256:" + "1" * 64,
                "taxonomyChecksum": "sha256:" + "2" * 64,
                "records": records,
                "modules": [
                    {
                        "moduleId": "minimed.clinical.other.ru",
                        "title": "Другие",
                        "priority": 1,
                        "recordIds": [record["recordId"] for record in records],
                        "coverageCounts": {"metadata-only": len(records)},
                        "specialties": [],
                    }
                ],
                "summary": {
                    "totalRecords": len(records),
                    "coverageCounts": {"metadata-only": len(records)},
                    "statusCounts": {"active": len(records)},
                    "moduleCounts": {"minimed.clinical.other.ru": len(records)},
                },
                "warnings": [],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    databases = tmp_path / "databases"
    databases.mkdir()
    _write_database(
        databases / "clinical-654_2-clinical-fixture.db",
        official_id="654_2",
        sections=[
            (
                "section.abbreviations",
                "Список сокращений",
                "ВП – внебольничная пневмония\n\n"
                "АБТ – антибактериальная терапия\n\n"
                "ИВЛ – искусственная вентиляция легких\n\n"
                "сломанная строка",
            ),
            (
                "section.synonyms",
                "Синонимы",
                "Синоним: Бактериальная инфекция",
            ),
            (
                "section.keywords",
                "Ключевые слова",
                "● лихорадка; кашель, антибактериальная терапия",
            ),
            (
                "section.terms",
                "Термины и определения",
                "Внебольничная пневмония (вариант Минковского-Щоффара) – острое инфекционное\n\n"
                "заболевание лёгких.\n\n"
                "Медленно разрешающаяся внебольничная пневмония – заболевание "
                "с отсроченным разрешением симптомов.\n\n"
                "Антибактериальная терапия – лечение антибактериальными препаратами.",
            ),
            (
                "section.incidental",
                "Ключевое понятие",
                "одышка",
            ),
        ],
    )
    _write_database(
        databases / "clinical-286_3-clinical-fixture.db",
        official_id="286_3",
        sections=[
            (
                "section.diabetes",
                "Список сокращений",
                "СД — сахарный диабет\n\nСД2 — сахарный диабет 2 типа",
            ),
        ],
    )
    _write_database(
        databases / "clinical-999_1-clinical-fixture.db",
        official_id="999_1",
        sections=[
            (
                "section.varicella",
                "Синонимы",
                "Синоним: Оспа ветряная\n\nСиноним: Герпес зостер\n\nСиноним без разделителя",
            ),
            (
                "section.varicella-terms",
                "Термины и определения",
                "Оспа – общее название группы инфекционных заболеваний.",
            ),
        ],
    )
    _write_database(
        databases / "clinical-123_1-clinical-fixture.db",
        official_id="123_1",
        sections=[],
    )
    _write_database(
        databases / "clinical-777_1-clinical-first.db",
        official_id="777_1",
        sections=[],
    )
    _write_database(
        databases / "clinical-777_1-clinical-second.db",
        official_id="777_1",
        sections=[],
    )

    output = tmp_path / "enriched.json"
    report_path = tmp_path / "aliases-report.json"
    report = enrich_clinical_aliases(ledger_path, databases, output, report_path)

    enriched = json.loads(output.read_text(encoding="utf-8"))
    by_id = {record["officialId"]: record for record in enriched["records"]}
    assert by_id["654_2"]["aliases"] == [
        "Пневмония",
        "Внебольничная пневмония",
        "ВП",
    ]
    assert "АБТ" not in by_id["654_2"]["aliases"]
    assert "ИВЛ" not in by_id["654_2"]["aliases"]
    assert by_id["654_2"]["keywords"] == [
        "лихорадка",
        "кашель",
        "антибактериальная терапия",
    ]
    definition = by_id["654_2"]["canonicalDefinition"]
    assert definition["text"] == "острое инфекционное заболевание лёгких."
    assert definition["sourceDocumentId"] == "kr.rf.654_2"
    assert definition["sourceDocumentVersionId"] == "kr.rf.654_2@fixture"
    assert definition["sourceSectionId"] == "section.terms"
    assert definition["sourceChunkId"] == "chunk.section.terms"
    assert definition["sourceAnchor"].endswith("section.terms#chunk.section.terms")
    assert "одышка" not in by_id["654_2"]["keywords"]
    assert by_id["286_3"]["aliases"] == ["Сахарный диабет", "СД"]
    assert "СД2" not in by_id["286_3"]["aliases"]
    assert by_id["999_1"]["aliases"] == ["Оспа", "Оспа ветряная"]
    assert "Герпес зостер" not in by_id["999_1"]["aliases"]
    assert by_id["999_1"]["canonicalDefinition"] is None
    assert by_id["123_1"]["aliases"] == [
        "Суправентрикулярные тахикардии",
        "Наджелудочковые тахикардии",
    ]
    assert all(record["entityType"] == "disease" for record in enriched["records"])

    exact_module = "minimed.clinical.recommendation.654_2"
    assert by_id["654_2"]["primaryModuleId"] == "minimed.clinical.other.ru"
    assert by_id["654_2"]["moduleIds"] == [
        "minimed.clinical.other.ru",
        exact_module,
    ]
    assert by_id["404_1"]["moduleIds"] == ["minimed.clinical.other.ru"]
    assert by_id["777_1"]["moduleIds"] == ["minimed.clinical.other.ru"]

    saved_report = json.loads(report_path.read_text(encoding="utf-8"))
    assert saved_report == report.model_dump(by_alias=True, mode="json")
    pneumonia_report = next(
        item for item in saved_report["records"] if item["recordId"] == "kr.rf.654_2"
    )
    assert pneumonia_report["exactModuleId"] == exact_module
    vp = next(item for item in pneumonia_report["aliases"] if item["alias"] == "ВП")
    assert vp["origin"] == "section"
    assert vp["sectionId"] == "section.abbreviations"
    assert vp["sectionTitle"] == "Список сокращений"
    assert vp["chunkId"] == "chunk.section.abbreviations"
    assert vp["sourceText"] == "ВП – внебольничная пневмония"
    assert vp["sourceSpans"] == [{"page": 3, "block": "block-section.abbreviations"}]
    fever = next(item for item in pneumonia_report["keywords"] if item["keyword"] == "лихорадка")
    assert fever["origin"] == "section"
    assert fever["sectionId"] == "section.keywords"
    assert fever["chunkId"] == "chunk.section.keywords"
    assert fever["sourceText"] == "● лихорадка; кашель, антибактериальная терапия"
    assert saved_report["summary"] == {
        "recordsTotal": 6,
        "matchedDatabases": 4,
        "recordsWithAliases": 4,
        "aliasesTotal": 9,
        "recordsWithKeywords": 1,
        "keywordsTotal": 3,
        "recordsWithDefinitions": 1,
        "recordsWithMedicationLinks": 0,
        "medicationLinksTotal": 0,
        "unmatchedRecords": 2,
        "unmatchedDatabases": 0,
    }
    assert saved_report["unmatchedRecords"] == [
        {
            "recordId": "kr.rf.404_1",
            "officialId": "404_1",
            "diagnostic": "database-not-found",
        },
        {
            "recordId": "kr.rf.777_1",
            "officialId": "777_1",
            "diagnostic": "multiple-databases",
        },
    ]

    pointer_workspace = tmp_path / "pointer-workspace"
    pointer_report = build_core_catalog_pointers(
        output,
        pointer_workspace,
        family="clinical",
        version="fixture",
        built_at="2026-09-01T00:00:00Z",
    )
    pointer_db = tmp_path / "pointers.db"
    build_content_pack(
        pointer_workspace / pointer_report.modules[0].directory,
        pointer_db,
        include_embeddings=False,
    )
    with sqlite3.connect(pointer_db) as connection:
        pointer_metadata = json.loads(
            connection.execute(
                """SELECT metadata_json FROM documents
                   WHERE json_extract(metadata_json, '$.targetDocumentId') = 'kr.rf.654_2'"""
            ).fetchone()[0]
        )
    assert pointer_metadata["entityType"] == "disease"
    assert pointer_metadata["targetDocumentId"] == "kr.rf.654_2"
    assert exact_module in pointer_metadata["moduleIds"]
    assert pointer_metadata["keywords"] == [
        "лихорадка",
        "кашель",
        "антибактериальная терапия",
    ]

    original_input = ledger_path.read_bytes()
    cli_output = tmp_path / "cli-enriched.json"
    cli_report = tmp_path / "cli-report.json"
    result = CliRunner().invoke(
        app,
        [
            "clinical-aliases",
            "--ledger",
            str(ledger_path),
            "--databases",
            str(databases),
            "--output",
            str(cli_output),
            "--report",
            str(cli_report),
        ],
    )
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["aliases"] == 9
    assert json.loads(result.output)["keywords"] == 3
    assert cli_output.exists()
    assert cli_report.exists()
    assert ledger_path.read_bytes() == original_input


def test_projects_source_exact_medication_relations_into_clinical_core_pointer(
    tmp_path: Path,
) -> None:
    ledger_path = tmp_path / "coverage.json"
    record = _record("654_2", "Пневмония (внебольничная)")
    ledger_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-09-01T00:00:00Z",
                "sourceChecksum": "sha256:" + "1" * 64,
                "taxonomyChecksum": "sha256:" + "2" * 64,
                "records": [record],
                "modules": [
                    {
                        "moduleId": "minimed.clinical.other.ru",
                        "title": "Другие",
                        "priority": 1,
                        "recordIds": [record["recordId"]],
                        "coverageCounts": {"metadata-only": 1},
                        "specialties": [],
                    }
                ],
                "summary": {
                    "totalRecords": 1,
                    "coverageCounts": {"metadata-only": 1},
                    "statusCounts": {"active": 1},
                    "moduleCounts": {"minimed.clinical.other.ru": 1},
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    databases = tmp_path / "databases"
    databases.mkdir()
    _write_database(
        databases / "clinical-654_2-clinical-fixture.db",
        official_id="654_2",
        sections=[],
    )
    relations = tmp_path / "relations"
    relations.mkdir()
    _write_medication_relations(relations / "654_2.json", official_id="654_2")
    enriched = tmp_path / "enriched.json"
    report_path = tmp_path / "report.json"

    report = enrich_clinical_aliases(
        ledger_path,
        databases,
        enriched,
        report_path,
        relations,
    )

    assert report.summary.records_with_medication_links == 1
    assert report.summary.medication_links_total == 1
    saved = json.loads(enriched.read_text(encoding="utf-8"))
    link = saved["records"][0]["clinicalMedicationLinks"][0]
    assert link == {
        "relationId": "relation.amoxicillin-pneumonia",
        "mnnDocumentId": "esklp.mnn.amoxicillin",
        "inn": "АМОКСИЦИЛЛИН",
        "targetDocumentId": "kr.rf.654_2",
        "predicate": "recommended-for",
        "relationStatus": "guideline",
        "reviewStatus": "proposed",
        "ageGroups": ["Дети"],
        "evidenceQuote": "Рекомендовано назначить амоксициллин.",
        "sourceAnchor": "treatment#chunk-treatment",
        "sourceSectionId": "section.treatment",
        "sourceChunkId": "chunk.treatment",
    }

    pointer_workspace = tmp_path / "pointer-workspace"
    pointer_report = build_core_catalog_pointers(
        enriched,
        pointer_workspace,
        family="clinical",
        version="fixture",
        built_at="2026-09-01T00:00:00Z",
    )
    pointer_db = tmp_path / "pointers.db"
    build_content_pack(
        pointer_workspace / pointer_report.modules[0].directory,
        pointer_db,
        include_embeddings=False,
    )
    with sqlite3.connect(pointer_db) as connection:
        metadata = json.loads(
            connection.execute("SELECT metadata_json FROM documents").fetchone()[0]
        )
        aliases = {row[0] for row in connection.execute("SELECT alias FROM aliases").fetchall()}
    assert metadata["clinicalMedicationLinks"] == [link]
    assert "АМОКСИЦИЛЛИН" not in aliases


def test_rejects_unsafe_output_paths_and_missing_database_directory(tmp_path: Path) -> None:
    ledger = tmp_path / "ledger.json"
    ledger.write_text("{}", encoding="utf-8")
    databases = tmp_path / "databases"
    databases.mkdir()
    report = tmp_path / "report.json"
    output = tmp_path / "output.json"

    with pytest.raises(ValueError, match="input ledger"):
        enrich_clinical_aliases(ledger, databases, ledger, report)
    with pytest.raises(ValueError, match="different paths"):
        enrich_clinical_aliases(ledger, databases, output, output)
    with pytest.raises(ValueError, match="database directory"):
        enrich_clinical_aliases(ledger, tmp_path / "missing", output, report)
