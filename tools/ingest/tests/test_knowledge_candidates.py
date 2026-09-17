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
    assert candidates[1].confidence == 0.62
    assert all(item.document_id == "kr.pneumonia" for item in candidates)
    assert all(item.anchor.startswith("kr.pneumonia@1/") for item in candidates)
    assert not any("качества" in item.label.lower() for item in candidates)


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
