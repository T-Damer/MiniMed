from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .clinical_query_taxonomy import ClinicalQueryAnnotation, annotate_clinical_query


class ImportedClinicalQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    provenance: str
    review_status: str
    language: str = Field(min_length=1)
    jurisdiction: str = Field(min_length=1)
    query: str = Field(min_length=1)
    patient_specific: bool


class ScenarioAnnotationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    scenario_id: str
    source_language: str
    source_jurisdiction: str
    imported_patient_specific: bool
    annotation: ClinicalQueryAnnotation


class ClinicalQueryAnnotationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: str
    source_count: int = Field(ge=1)
    annotated_count: int = Field(ge=1)
    source_sha256: str
    output_sha256: str
    method: str
    source_language_counts: dict[str, int]
    detected_language_counts: dict[str, int]
    jurisdiction_counts: dict[str, int]
    primary_decision_counts: dict[str, int]
    complexity_counts: dict[str, int]
    patient_specific_derived: int = Field(ge=0)
    patient_specific_disagreements: int = Field(ge=0)
    review_required: int = Field(ge=0)


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(payload)
    temporary.replace(path)


def load_imported_clinical_queries(path: Path) -> list[ImportedClinicalQuery]:
    records: list[ImportedClinicalQuery] = []
    identifiers: set[str] = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload: Any = json.loads(line)
            record = ImportedClinicalQuery.model_validate(payload)
        except (json.JSONDecodeError, ValueError) as error:
            raise ValueError(
                f"Invalid clinical query JSONL at line {line_number}: {error}"
            ) from error
        if record.id in identifiers:
            raise ValueError(f"Duplicate clinical query scenario id: {record.id}")
        if record.provenance != "real_clinician_query":
            raise ValueError(
                f"Unsupported provenance for automatic baseline annotation: {record.id}"
            )
        if record.review_status != "candidate":
            raise ValueError(f"Imported query must remain candidate during annotation: {record.id}")
        identifiers.add(record.id)
        records.append(record)
    if not records:
        raise ValueError("Clinical query JSONL must contain at least one record.")
    return records


def annotate_clinical_query_benchmark(
    source: Path,
    output: Path,
    *,
    report_path: Path | None = None,
) -> ClinicalQueryAnnotationReport:
    source_payload = source.read_bytes()
    queries = load_imported_clinical_queries(source)
    annotations = [
        ScenarioAnnotationRecord(
            scenario_id=query.id,
            source_language=query.language,
            source_jurisdiction=query.jurisdiction,
            imported_patient_specific=query.patient_specific,
            annotation=annotate_clinical_query(query.query, language=query.language),
        )
        for query in queries
    ]
    output_payload = b"".join(
        (
            json.dumps(record.model_dump(mode="json"), ensure_ascii=False, sort_keys=True) + "\n"
        ).encode("utf-8")
        for record in annotations
    )
    _write_atomic(output, output_payload)

    source_language_counts = Counter(query.language for query in queries)
    detected_language_counts = Counter(
        record.annotation.detected_language for record in annotations
    )
    jurisdiction_counts = Counter(query.jurisdiction for query in queries)
    primary_counts = Counter(record.annotation.primary_decision for record in annotations)
    complexity_counts = Counter(record.annotation.complexity for record in annotations)
    derived_patient_specific = sum(
        bool(record.annotation.patient_context_signals) for record in annotations
    )
    patient_disagreements = sum(
        record.imported_patient_specific != bool(record.annotation.patient_context_signals)
        for record in annotations
    )
    report = ClinicalQueryAnnotationReport(
        generated_at=_utc_now(),
        source_count=len(queries),
        annotated_count=len(annotations),
        source_sha256=_sha256(source_payload),
        output_sha256=_sha256(output_payload),
        method="rule-based-ru-first-v1",
        source_language_counts=dict(sorted(source_language_counts.items())),
        detected_language_counts=dict(sorted(detected_language_counts.items())),
        jurisdiction_counts=dict(sorted(jurisdiction_counts.items())),
        primary_decision_counts=dict(sorted(primary_counts.items())),
        complexity_counts=dict(sorted(complexity_counts.items())),
        patient_specific_derived=derived_patient_specific,
        patient_specific_disagreements=patient_disagreements,
        review_required=sum(record.annotation.needs_review for record in annotations),
    )
    if report_path is not None:
        _write_atomic(
            report_path,
            (
                json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
            ).encode("utf-8"),
        )
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Annotate imported clinical query benchmark rows.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    return parser


def main() -> None:
    arguments = _parser().parse_args()
    report = annotate_clinical_query_benchmark(
        arguments.input,
        arguments.output,
        report_path=arguments.report,
    )
    print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
