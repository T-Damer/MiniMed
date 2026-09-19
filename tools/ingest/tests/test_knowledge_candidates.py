from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.knowledge_candidates import scan_candidates, write_candidate_workspace
from localmed_ingest.sqlite_builder import schema_sql


def _source(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(schema_sql())
        with connection:
            connection.execute(
                "INSERT INTO content_packs VALUES ('kr', '1', 5, 'КР', 'sha256:x', 'now', 1)"
            )
            connection.execute(
                """INSERT INTO documents VALUES
                ('kr.pneumonia', 'kr', 'Пневмония', NULL, 'clinical_recommendation',
                 'active', '[\"pediatrics\"]', '{}', 'kr.pneumonia@1')"""
            )
            connection.execute(
                """INSERT INTO document_versions VALUES
                ('kr.pneumonia@1', 'kr.pneumonia', '2026', NULL, NULL, 'sha256:kr', 'now')"""
            )
            sections = [
                ("s1", "Шкала CURB-65", "assessment", 0),
                ("s2", "Диагностика", "diagnostics", 1),
                ("s3", "Критерии качества медицинской помощи", "quality", 2),
                ("s4", "Классификация по степени тяжести", "classification", 3),
                (
                    "s5",
                    "Приложение А2. Методология разработки клинических рекомендаций",
                    "methodology",
                    4,
                ),
                ("s6", "Шкалы оценки ........................................ 70", "toc", 5),
                ("s7", "Неврологический статус", "diagnostics", 6),
            ]
            for section_id, title, section_type, order_index in sections:
                connection.execute(
                    """INSERT INTO sections VALUES
                    (?, 'kr.pneumonia@1', NULL, ?, lower(?), ?, 1, ?, NULL, NULL, ?, ?)""",
                    (
                        section_id,
                        title,
                        title,
                        section_type,
                        order_index,
                        f"kr.pneumonia@1/{section_id}",
                        json.dumps([title], ensure_ascii=False),
                    ),
                )
            chunks = [
                ("c1", "s1", 0, "Суммарный балл по шкале CURB-65 используется для оценки риска."),
                ("c2", "s2", 1, "Для оценки состояния может применяться индекс PSI."),
                ("c3", "s3", 2, "Критерии качества медицинской помощи приведены в таблице."),
                ("c4", "s4", 3, "Выделяют несколько степеней тяжести заболевания."),
                (
                    "c5",
                    "s5",
                    4,
                    "Шкала оценки уровней достоверности доказательств приведена ниже.",
                ),
                ("c6", "s6", 5, "Приложение Г1. Шкала комы Глазго."),
                ("c7", "s7", 6, "Сознание оценено как 15 баллов GCS."),
            ]
            for chunk_id, section_id, order_index, text in chunks:
                connection.execute(
                    """INSERT INTO chunks VALUES
                    (?, 'kr.pneumonia@1', ?, ?, ?, lower(?), NULL, NULL, NULL, NULL,
                     NULL, NULL, ?, '{}')""",
                    (
                        chunk_id,
                        section_id,
                        order_index,
                        text,
                        text,
                        f"kr.pneumonia@1/{section_id}/{chunk_id}",
                    ),
                )
    finally:
        connection.close()


def _inventory(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(schema_sql())
        with connection:
            connection.execute(
                "INSERT INTO content_packs VALUES ('tools', '1', 5, 'Tools', 'sha256:t', 'now', 1)"
            )
            connection.execute(
                """INSERT INTO tool_definitions(
                    id, kind, version, slug, title, short_title, aliases_json,
                    bank_id, bank_label, category, description, estimated_minutes,
                    audience, definition_json
                ) VALUES (
                    'minimed.assessment.gcs', 'assessment', '1', 'glasgow-coma-scale',
                    'Шкала комы Глазго', 'GCS', '["GCS", "Glasgow Coma Scale"]',
                    'emergency', 'Неотложная медицина', 'emergency',
                    'Оценка уровня сознания', 2, 'all', '{}'
                )"""
            )
    finally:
        connection.close()


def test_scans_headings_and_body_mentions_without_quality_false_positive(tmp_path: Path) -> None:
    database = tmp_path / "kr.db"
    _source(database)
    candidates = scan_candidates(database)
    assert [(item.candidate_type, item.label) for item in candidates] == [
        ("scale", "Шкала CURB-65"),
        ("scale", "индекс PSI"),
        ("classification", "Классификация по степени тяжести"),
    ]
    assert candidates[0].confidence == 0.88
    assert candidates[1].confidence == 0.68
    assert all(item.document_id == "kr.pneumonia" for item in candidates)
    assert all(item.anchor.startswith("kr.pneumonia@1/") for item in candidates)
    assert not any("качества" in item.label.lower() for item in candidates)
    assert not any("достоверности доказательств" in item.label.lower() for item in candidates)
    assert not any(item.section_id == "s6" for item in candidates)


def test_workspace_is_immutable_and_keeps_source_fingerprint(tmp_path: Path) -> None:
    database = tmp_path / "kr.db"
    output = tmp_path / "candidates"
    _source(database)
    assert write_candidate_workspace(database, output) == 3
    lines = [json.loads(line) for line in (output / "candidates.jsonl").read_text().splitlines()]
    assert len(lines) == 3
    assert all(line["reviewStatus"] == "proposed" for line in lines)
    assert lines[0]["source"]["chunkId"] == "c1"
    manifest = json.loads((output / "manifest.json").read_text())
    assert manifest["sourceSha256"].startswith("sha256:")
    assert manifest["candidateCount"] == 3
    with pytest.raises(ValueError, match="immutable"):
        write_candidate_workspace(database, output)


def test_known_inventory_finds_exact_alias_without_scale_word(tmp_path: Path) -> None:
    database = tmp_path / "kr.db"
    inventory = tmp_path / "inventory.db"
    _source(database)
    _inventory(inventory)

    candidates = scan_candidates(database, inventory_sources=(inventory,))
    gcs = [item for item in candidates if item.known_source_id == "minimed.assessment.gcs"]

    assert len(gcs) == 1
    assert gcs[0].label == "Шкала комы Глазго"
    assert gcs[0].candidate_type == "scale"
    assert gcs[0].extraction_kind == "known-tool"
    assert gcs[0].confidence == 0.97
    assert gcs[0].section_id == "s7"
    assert gcs[0].signals == ("known-tool",)
