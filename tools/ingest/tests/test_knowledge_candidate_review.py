from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.knowledge_candidate_review import promote_candidate_reviews
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
            for section_id, title, section_type, order_index in (
                ("s1", "Шкала CURB-65", "assessment", 0),
                ("s2", "Диагностика", "diagnostics", 1),
            ):
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
            for chunk_id, section_id, order_index, text in (
                ("c1", "s1", 0, "Суммарный балл по шкале CURB-65 используется для оценки риска."),
                ("c2", "s2", 1, "Для оценки состояния может применяться индекс PSI."),
            ):
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


def _write_decisions(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def test_review_promotes_identity_and_source_link_without_inventing_fact(tmp_path: Path) -> None:
    source = tmp_path / "kr.db"
    candidates_dir = tmp_path / "candidates"
    decisions = tmp_path / "decisions.jsonl"
    output = tmp_path / "knowledge.reviewed-candidates.json"
    _source(source)
    write_candidate_workspace(source, candidates_dir)
    extracted = scan_candidates(source)
    curb = next(item for item in extracted if "CURB-65" in item.label)
    psi = next(item for item in extracted if "PSI" in item.label)
    _write_decisions(
        decisions,
        [
            {
                "candidateId": curb.candidate_id,
                "decision": "accept",
                "entityId": "scale.curb65",
                "canonicalName": "CURB-65",
                "aliases": ["CURB 65"],
                "interactiveCalculatorId": "calculator.curb65",
                "interactiveRoute": "#/calculators/curb65",
                "specialties": ["пульмонология", "неотложная медицина"],
                "tags": ["пневмония"],
            },
            {"candidateId": psi.candidate_id, "decision": "reject"},
        ],
    )

    accepted, rejected = promote_candidate_reviews(
        candidates_dir,
        source,
        decisions,
        output,
        reviewer="doctor@example.invalid",
        reviewed_at="2026-09-18T00:00:00+03:00",
    )
    assert (accepted, rejected) == (1, 1)
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["facts"] == []
    assert payload["relations"] == []
    assert len(payload["entities"]) == 1
    entity = payload["entities"][0]
    assert entity["id"] == "scale.curb65"
    assert entity["entityType"] == "scale"
    assert entity["canonicalName"] == "CURB-65"
    assert {item["name"] for item in entity["names"]} == {"Шкала CURB-65", "CURB 65"}
    assert entity["metadata"]["tags"] == ["пневмония"]
    assert entity["metadata"]["specialties"] == ["пульмонология", "неотложная медицина"]
    assert entity["metadata"]["interactiveCalculatorId"] == "calculator.curb65"
    assert entity["metadata"]["interactiveRoute"] == "#/calculators/curb65"

    assert len(payload["documentLinks"]) == 1
    link = payload["documentLinks"][0]
    assert link["reviewStatus"] == "reviewed"
    assert link["documentId"] == "kr.pneumonia"
    assert link["sectionId"] == "s1"
    assert link["chunkId"] == "c1"
    assert link["metadata"]["sourceAnchor"] == "kr.pneumonia@1/s1/c1"
    assert link["metadata"]["reviewer"] == "doctor@example.invalid"


def test_review_fails_closed_when_candidate_workspace_is_modified(tmp_path: Path) -> None:
    source = tmp_path / "kr.db"
    candidates_dir = tmp_path / "candidates"
    decisions = tmp_path / "decisions.jsonl"
    output = tmp_path / "knowledge.reviewed-candidates.json"
    _source(source)
    write_candidate_workspace(source, candidates_dir)
    candidate = scan_candidates(source)[0]
    _write_decisions(
        decisions,
        [
            {
                "candidateId": candidate.candidate_id,
                "decision": "accept",
                "entityId": "scale.curb65",
                "canonicalName": "CURB-65",
            }
        ],
    )
    with (candidates_dir / "candidates.jsonl").open("a", encoding="utf-8") as stream:
        stream.write("\n")

    with pytest.raises(ValueError, match="payload checksum"):
        promote_candidate_reviews(
            candidates_dir,
            source,
            decisions,
            output,
            reviewer="doctor@example.invalid",
            reviewed_at="2026-09-18T00:00:00Z",
        )


def test_review_fails_closed_when_source_changed_after_scan(tmp_path: Path) -> None:
    source = tmp_path / "kr.db"
    candidates_dir = tmp_path / "candidates"
    decisions = tmp_path / "decisions.jsonl"
    output = tmp_path / "knowledge.reviewed-candidates.json"
    _source(source)
    write_candidate_workspace(source, candidates_dir)
    candidate = scan_candidates(source)[0]
    _write_decisions(
        decisions,
        [
            {
                "candidateId": candidate.candidate_id,
                "decision": "accept",
                "entityId": "scale.curb65",
                "canonicalName": "CURB-65",
            }
        ],
    )
    connection = sqlite3.connect(source)
    try:
        with connection:
            connection.execute(
                "UPDATE chunks SET original_text = original_text || ' Изменено.' WHERE id = 'c1'"
            )
    finally:
        connection.close()

    with pytest.raises(ValueError, match="source checksum"):
        promote_candidate_reviews(
            candidates_dir,
            source,
            decisions,
            output,
            reviewer="doctor@example.invalid",
            reviewed_at="2026-09-18T00:00:00Z",
        )


def test_review_rejects_interactive_id_without_explicit_matching_route(tmp_path: Path) -> None:
    source = tmp_path / "kr.db"
    candidates_dir = tmp_path / "candidates"
    decisions = tmp_path / "decisions.jsonl"
    output = tmp_path / "knowledge.reviewed-candidates.json"
    _source(source)
    write_candidate_workspace(source, candidates_dir)
    candidate = scan_candidates(source)[0]
    _write_decisions(
        decisions,
        [
            {
                "candidateId": candidate.candidate_id,
                "decision": "accept",
                "entityId": "scale.curb65",
                "canonicalName": "CURB-65",
                "interactiveAssessmentId": "assessment.curb65",
                "interactiveRoute": "#/calculators/curb65",
            }
        ],
    )

    with pytest.raises(ValueError, match="Assessment interactiveRoute"):
        promote_candidate_reviews(
            candidates_dir,
            source,
            decisions,
            output,
            reviewer="doctor@example.invalid",
            reviewed_at="2026-09-18T00:00:00Z",
        )
