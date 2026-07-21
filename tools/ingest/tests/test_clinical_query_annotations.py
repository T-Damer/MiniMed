from __future__ import annotations

import json
from pathlib import Path

import pytest
from localmed_ingest.clinical_query_annotations import (
    annotate_clinical_query_benchmark,
    load_imported_clinical_queries,
)
from localmed_ingest.clinical_query_taxonomy import (
    DecisionKind,
    annotate_clinical_query,
)
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _RussianCoverageCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    query: str
    expected_primary: DecisionKind = Field(alias="expectedPrimary")
    expected_patient_context: bool = Field(alias="expectedPatientContext")
    expected_needs_review: bool = Field(default=False, alias="expectedNeedsReview")


def _scenario(
    identifier: str,
    query: str,
    patient_specific: bool,
    *,
    language: str = "ru",
    jurisdiction: str = "RU",
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "id": identifier,
        "provenance": "real_clinician_query",
        "review_status": "candidate",
        "language": language,
        "jurisdiction": jurisdiction,
        "specialty": "Педиатрия" if language == "ru" else "Primary Care",
        "query": query,
        "patient_specific": patient_specific,
        "source": {
            "dataset_id": "example/clinical-queries",
            "split": "questions",
            "record_id": identifier,
            "source_url": "https://example.test",
            "license": "CC-BY-4.0",
            "citation": "Example",
        },
    }


def test_taxonomy_distinguishes_common_russian_clinical_decisions() -> None:
    dose = annotate_clinical_query(
        "Ребёнок 4 лет, масса 18 кг. Какую дозу амоксициллина назначить?"
    )
    result = annotate_clinical_query("Как интерпретировать этот результат ЭКГ?")
    next_test = annotate_clinical_query("Пациент с кашлем: какое исследование назначить следующим?")
    adjustment = annotate_clinical_query(
        "Пациент не ответил на терапию первой линии. Следует ли сменить лечение?"
    )
    administrative = annotate_clinical_query(
        "Какие нормативные документы определяют категорию годности при бронхиальной астме?"
    )

    assert dose.primary_decision == "dosing-calculation"
    assert dose.detected_language == "ru"
    assert dose.patient_context_signals
    assert result.primary_decision == "result-interpretation"
    assert next_test.primary_decision == "test-selection"
    assert next_test.complexity == "focused-clinical"
    assert adjustment.primary_decision == "treatment-adjustment"
    assert "treatment-selection" in adjustment.secondary_decisions
    assert administrative.primary_decision == "administrative"


def test_russian_coverage_fixture_matches_baseline_contract() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[2] / "benchmarks" / "russian-query-coverage.json"
    )
    cases = TypeAdapter(list[_RussianCoverageCase]).validate_json(fixture_path.read_bytes())
    assert len(cases) >= 20

    failures: list[str] = []
    for case in cases:
        annotation = annotate_clinical_query(case.query, language="ru")

        if annotation.detected_language != "ru":
            failures.append(f"{case.id}: language={annotation.detected_language}")
        if annotation.primary_decision != case.expected_primary:
            failures.append(
                f"{case.id}: primary={annotation.primary_decision}, "
                f"expected={case.expected_primary}"
            )
        if bool(annotation.patient_context_signals) != case.expected_patient_context:
            failures.append(
                f"{case.id}: patient_context={bool(annotation.patient_context_signals)}, "
                f"expected={case.expected_patient_context}"
            )
        if case.expected_needs_review and not annotation.needs_review:
            failures.append(f"{case.id}: expected needs_review")

    assert not failures, "\n".join(failures)


def test_english_dataset_queries_use_explicit_fallback() -> None:
    annotation = annotate_clinical_query(
        "The patient has not responded to first-line therapy. Should treatment be switched?",
        language="en",
    )

    assert annotation.detected_language == "en"
    assert annotation.primary_decision == "treatment-adjustment"
    assert any("en:" in signal for signal in annotation.matched_signals)


def test_unknown_russian_query_is_flagged_for_review() -> None:
    annotation = annotate_clinical_query("Что думаете?")

    assert annotation.primary_decision == "unknown"
    assert annotation.detected_language == "ru"
    assert annotation.needs_review is True
    assert annotation.confidence < 0.5


def test_annotation_projection_is_deterministic_and_reported(tmp_path: Path) -> None:
    source = tmp_path / "queries.jsonl"
    rows = [
        _scenario("q1", "Пациент с кашлем: какое исследование назначить следующим?", True),
        _scenario("q2", "Лечение артериальной гипертензии", False),
        _scenario("q3", "Какую дозу назначить ребёнку 4 лет?", True),
        _scenario("q4", "Как интерпретировать этот результат ЭКГ?", False),
        _scenario(
            "q5",
            "What should be monitored in Turner syndrome?",
            False,
            language="en",
            jurisdiction="US",
        ),
    ]
    source.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    first = tmp_path / "first.jsonl"
    second = tmp_path / "second.jsonl"
    report_path = tmp_path / "report.json"

    report = annotate_clinical_query_benchmark(source, first, report_path=report_path)
    annotate_clinical_query_benchmark(source, second)

    assert first.read_bytes() == second.read_bytes()
    annotations = [json.loads(line) for line in first.read_text(encoding="utf-8").splitlines()]
    assert len(annotations) == 5
    assert all(row["annotation"]["method"] == "rule-based-ru-first-v1" for row in annotations)
    assert annotations[0]["source_jurisdiction"] == "RU"
    assert sum(report.primary_decision_counts.values()) == 5
    assert sum(report.complexity_counts.values()) == 5
    assert report.source_language_counts == {"en": 1, "ru": 4}
    assert report.detected_language_counts == {"en": 1, "ru": 4}
    assert report.jurisdiction_counts == {"RU": 4, "US": 1}
    assert report.output_sha256
    assert json.loads(report_path.read_text(encoding="utf-8"))["annotated_count"] == 5


def test_annotation_input_rejects_non_candidate_or_duplicate_rows(tmp_path: Path) -> None:
    source = tmp_path / "queries.jsonl"
    first = _scenario("q1", "Какое лечение назначить?", False)
    second = _scenario("q1", "Какое исследование провести следующим?", False)
    source.write_text(
        f"{json.dumps(first, ensure_ascii=False)}\n{json.dumps(second, ensure_ascii=False)}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Duplicate clinical query scenario id"):
        load_imported_clinical_queries(source)

    first["id"] = "q2"
    first["review_status"] = "source_validated"
    source.write_text(f"{json.dumps(first, ensure_ascii=False)}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="must remain candidate"):
        load_imported_clinical_queries(source)
