from __future__ import annotations

import json
from pathlib import Path

import pytest

from localmed_ingest.clinical_query_annotations import (
    annotate_clinical_query_benchmark,
    load_imported_clinical_queries,
)
from localmed_ingest.clinical_query_taxonomy import annotate_clinical_query


def _scenario(identifier: str, query: str, patient_specific: bool) -> dict[str, object]:
    return {
        "schema_version": 1,
        "id": identifier,
        "provenance": "real_clinician_query",
        "review_status": "candidate",
        "language": "en",
        "jurisdiction": "US",
        "specialty": "Primary Care",
        "query": query,
        "patient_specific": patient_specific,
        "source": {
            "dataset_id": "jjfenglab/Real-POCQi",
            "split": "questions",
            "record_id": identifier,
            "source_url": "https://example.test",
            "license": "CC-BY-4.0",
            "citation": "Example",
        },
    }


def test_taxonomy_distinguishes_common_clinical_decisions() -> None:
    dose = annotate_clinical_query("What dose of amoxicillin should a 4-year-old child receive?")
    result = annotate_clinical_query("How should this ECG result be interpreted?")
    next_test = annotate_clinical_query("Patient with cough: what is the next test?")
    adjustment = annotate_clinical_query(
        "The patient has not responded to first-line therapy. Should treatment be switched?"
    )

    assert dose.primary_decision == "dosing-calculation"
    assert dose.patient_context_signals
    assert result.primary_decision == "result-interpretation"
    assert next_test.primary_decision == "test-selection"
    assert next_test.complexity == "focused-clinical"
    assert adjustment.primary_decision == "treatment-adjustment"
    assert "treatment-selection" in adjustment.secondary_decisions


def test_unknown_query_is_flagged_for_review() -> None:
    annotation = annotate_clinical_query("Thoughts about this?")

    assert annotation.primary_decision == "unknown"
    assert annotation.needs_review is True
    assert annotation.confidence < 0.5


def test_annotation_projection_is_deterministic_and_reported(tmp_path: Path) -> None:
    source = tmp_path / "queries.jsonl"
    rows = [
        _scenario("q1", "Patient with cough: what is the next test?", True),
        _scenario("q2", "Management of hypertension", False),
        _scenario("q3", "What dose should be used for a 4-year-old child?", True),
        _scenario("q4", "How should this ECG be interpreted?", False),
    ]
    source.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    first = tmp_path / "first.jsonl"
    second = tmp_path / "second.jsonl"
    report_path = tmp_path / "report.json"

    report = annotate_clinical_query_benchmark(source, first, report_path=report_path)
    annotate_clinical_query_benchmark(source, second)

    assert first.read_bytes() == second.read_bytes()
    annotations = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
    assert len(annotations) == 4
    assert all(row["annotation"]["method"] == "rule-based-en-v1" for row in annotations)
    assert sum(report.primary_decision_counts.values()) == 4
    assert sum(report.complexity_counts.values()) == 4
    assert report.output_sha256
    assert json.loads(report_path.read_text(encoding="utf-8"))["annotated_count"] == 4


def test_annotation_input_rejects_non_candidate_or_duplicate_rows(tmp_path: Path) -> None:
    source = tmp_path / "queries.jsonl"
    first = _scenario("q1", "What is the treatment?", False)
    second = _scenario("q1", "What test is next?", False)
    source.write_text(
        f"{json.dumps(first)}\n{json.dumps(second)}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Duplicate clinical query scenario id"):
        load_imported_clinical_queries(source)

    first["id"] = "q2"
    first["review_status"] = "source_validated"
    source.write_text(f"{json.dumps(first)}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="must remain candidate"):
        load_imported_clinical_queries(source)
