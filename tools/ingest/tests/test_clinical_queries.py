from __future__ import annotations

import json
from pathlib import Path

import pytest

from localmed_ingest.clinical_queries import (
    fetch_real_pocqi_questions,
    import_real_pocqi_benchmark,
    load_real_pocqi_snapshot,
    sample_real_pocqi_questions,
)


def _rows() -> list[dict[str, str]]:
    return [
        {
            "question_id": "a1",
            "question_text": "Patient with cough: what is the next test?",
            "specialty": "Primary Care",
        },
        {
            "question_id": "a2",
            "question_text": "Management of hypertension",
            "specialty": "Primary Care",
        },
        {
            "question_id": "b1",
            "question_text": "What dose should be used for a 4-year-old child?",
            "specialty": "Pediatrics",
        },
        {
            "question_id": "b2",
            "question_text": "What should be monitored in Turner syndrome?",
            "specialty": "Pediatrics",
        },
        {
            "question_id": "c1",
            "question_text": "How should this ECG be interpreted?",
            "specialty": "Cardiology",
        },
    ]


def test_import_is_deterministic_and_attributed(tmp_path: Path) -> None:
    snapshot = tmp_path / "questions.json"
    snapshot.write_text(json.dumps(_rows()), encoding="utf-8")
    first = tmp_path / "first.jsonl"
    second = tmp_path / "second.jsonl"

    report = import_real_pocqi_benchmark(first, snapshot=snapshot, count=3, seed="fixed")
    import_real_pocqi_benchmark(second, snapshot=snapshot, count=3, seed="fixed")

    assert first.read_bytes() == second.read_bytes()
    records = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
    assert len(records) == 3
    assert all(record["provenance"] == "real_clinician_query" for record in records)
    assert all(record["review_status"] == "candidate" for record in records)
    assert all(record["source"]["license"] == "CC-BY-4.0" for record in records)
    assert report.selected_count == 3
    assert sum(report.specialty_counts_selected.values()) == 3


def test_sample_preserves_specialty_proportions_with_largest_remainder(tmp_path: Path) -> None:
    snapshot = tmp_path / "questions.json"
    snapshot.write_text(json.dumps(_rows()), encoding="utf-8")
    questions = load_real_pocqi_snapshot(snapshot)

    selected = sample_real_pocqi_questions(questions, 3, "fixed")
    counts: dict[str, int] = {}
    for item in selected:
        counts[item.specialty] = counts.get(item.specialty, 0) + 1

    assert sum(counts.values()) == 3
    assert set(counts) == {"Primary Care", "Pediatrics", "Cardiology"}


def test_snapshot_rejects_duplicate_normalized_text(tmp_path: Path) -> None:
    rows = _rows()
    rows[1]["question_text"] = rows[0]["question_text"].upper()
    snapshot = tmp_path / "questions.json"
    snapshot.write_text(json.dumps(rows), encoding="utf-8")

    with pytest.raises(ValueError, match="Duplicate normalized question text"):
        load_real_pocqi_snapshot(snapshot)


def test_offline_fetch_requires_cache(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="Missing cached"):
        fetch_real_pocqi_questions(tmp_path / "cache", offline=True)
