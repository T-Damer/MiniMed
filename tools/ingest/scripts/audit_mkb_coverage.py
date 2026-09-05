"""Audit source-backed ICD coverage without opening a SQLite database for writes."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from pathlib import Path
from typing import TypedDict

from localmed_ingest.catalog_module_builder import (
    _read_reference_database,
    _reference_key,
    _ReferenceSourceAlias,
)


class _CoreCoverageBucket(TypedDict):
    document_ids: set[str]
    definition_source_ids: set[str]


def _int_field(row: dict[str, object], field: str) -> int:
    value = row[field]
    if not isinstance(value, int):
        raise TypeError(f"Coverage row field {field} must be an integer.")
    return value


def _node_kind(code: str) -> str:
    if "-" in code:
        return "range"
    return "exact-code" if "." in code else "category"


def _code_key(value: str) -> str:
    """Normalize Latin/Cyrillic lookalikes in ICD code joins only."""
    return _reference_key(value).translate(
        str.maketrans(
            {
                "а": "a",
                "с": "c",
                "е": "e",
                "о": "o",
                "р": "p",
                "х": "x",
                "у": "y",
                "к": "k",
                "м": "m",
                "т": "t",
                "в": "b",
                "н": "h",
            }
        )
    )


def _read_chunk_counts(source: Path) -> dict[str, dict[str, int]]:
    connection = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        counts: dict[str, dict[str, int]] = {}
        for row in connection.execute(
            """SELECT d.id AS document_id, s.title, count(c.id) AS chunk_count,
                      group_concat(c.original_text, char(10)) AS source_text
               FROM documents AS d
               JOIN document_versions AS v ON v.id = d.current_version_id
               JOIN sections AS s ON s.document_version_id = v.id
               LEFT JOIN chunks AS c ON c.section_id = s.id
               GROUP BY d.id, s.id, s.title
               ORDER BY d.id, s.order_index"""
        ):
            document_id = str(row["document_id"])
            title = str(row["title"]).strip().casefold()
            bucket = counts.setdefault(document_id, {})
            bucket["source_chunk_count"] = bucket.get("source_chunk_count", 0) + int(
                row["chunk_count"]
            )
            if "код и название" in title or "классификац" in title:
                bucket["classification_evidence_count"] = bucket.get(
                    "classification_evidence_count", 0
                ) + int(row["chunk_count"])
            if "синоним" in title:
                bucket["synonym_evidence_count"] = bucket.get("synonym_evidence_count", 0) + int(
                    row["chunk_count"]
                )
            if "препарат" in title or "лекарств" in title:
                bucket["medicine_section_chunk_count"] = bucket.get(
                    "medicine_section_chunk_count", 0
                ) + int(row["chunk_count"])
                bucket["medicine_item_count"] = bucket.get("medicine_item_count", 0) + len(
                    re.findall(r"(?m)^-\s+\S", str(row["source_text"] or ""))
                )
            if "огранич" in title:
                bucket["limitation_evidence_count"] = bucket.get(
                    "limitation_evidence_count", 0
                ) + int(row["chunk_count"])
        return counts
    finally:
        connection.close()


def _aliases_by_code(aliases: list[_ReferenceSourceAlias]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for alias in aliases:
        key = _code_key(alias.canonical_term)
        counts[key] = counts.get(key, 0) + 1
    return counts


def _read_core_coverage(core: Path) -> dict[str, _CoreCoverageBucket]:
    connection = sqlite3.connect(f"{core.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        coverage: dict[str, _CoreCoverageBucket] = {}
        for row in connection.execute("SELECT id, metadata_json FROM documents ORDER BY id"):
            try:
                metadata = json.loads(str(row["metadata_json"]))
            except json.JSONDecodeError as error:
                raise ValueError(
                    f"Core document {row['id']} metadata_json is invalid JSON."
                ) from error
            if not isinstance(metadata, dict):
                raise ValueError(f"Core document {row['id']} metadata_json must be an object.")
            codes: list[str] = []
            mkb_code = metadata.get("mkbCode")
            if isinstance(mkb_code, str) and mkb_code.strip():
                codes.append(mkb_code.strip())
            icd_codes = metadata.get("icd10Codes")
            if isinstance(icd_codes, list):
                codes.extend(
                    code.strip() for code in icd_codes if isinstance(code, str) and code.strip()
                )
            definition = metadata.get("canonicalDefinition")
            definition_text = definition.get("text") if isinstance(definition, dict) else None
            definition_source_id = (
                definition.get("sourceDocumentId") if isinstance(definition, dict) else None
            )
            has_definition = (
                isinstance(definition, dict)
                and isinstance(definition_text, str)
                and bool(definition_text.strip())
                and isinstance(definition_source_id, str)
                and bool(definition_source_id.strip())
            )
            source_id = str(row["id"])
            if isinstance(definition_source_id, str) and definition_source_id.strip():
                source_id = definition_source_id
            for code in dict.fromkeys(codes):
                bucket = coverage.setdefault(
                    _code_key(code),
                    {"document_ids": set(), "definition_source_ids": set()},
                )
                bucket["document_ids"].add(str(row["id"]))
                if has_definition:
                    bucket["definition_source_ids"].add(source_id)
        return coverage
    finally:
        connection.close()


def audit_mkb_coverage(
    source: Path, core: Path | None = None
) -> tuple[list[dict[str, object]], dict[str, int]]:
    documents, aliases = _read_reference_database(source)
    chunk_counts = _read_chunk_counts(source)
    alias_counts = _aliases_by_code(aliases)
    core_coverage = _read_core_coverage(core) if core is not None else {}
    rows: list[dict[str, object]] = []
    for document in documents:
        if document.source_type != "rls_mkb_reference" or document.mkb_code is None:
            continue
        counts = chunk_counts.get(document.document_id, {})
        has_definition = document.definition is not None
        app_coverage = core_coverage.get(
            _code_key(document.mkb_code),
            {"document_ids": set(), "definition_source_ids": set()},
        )
        core_definition_sources = sorted(app_coverage["definition_source_ids"])
        app_core_coverage = (
            "clinical-definition"
            if core_definition_sources
            else "classification-only"
            if app_coverage["document_ids"]
            else "absent"
        )
        residual_gap = ""
        if app_core_coverage == "classification-only":
            residual_gap = "clinical definition absent from app core"
        elif app_core_coverage == "absent" and core is not None:
            residual_gap = "pointer absent from app core"
        elif not has_definition:
            residual_gap = "clinical definition absent from source pack"
        row: dict[str, object] = {
            "code": document.mkb_code,
            "node_kind": _node_kind(document.mkb_code),
            "title": document.title,
            "source_document_id": document.document_id,
            "source_document_version_id": document.version_id,
            "source_checksum": document.source_checksum,
            "source_url": document.source_url,
            "source_chunk_count": counts.get("source_chunk_count", 0),
            "classification_evidence_count": counts.get("classification_evidence_count", 0),
            "classification_context_count": len(document.classification_path),
            "synonym_evidence_count": counts.get("synonym_evidence_count", 0),
            "synonym_count": alias_counts.get(_code_key(document.mkb_code), 0),
            "medicine_section_chunk_count": counts.get("medicine_section_chunk_count", 0),
            "medicine_item_count": counts.get("medicine_item_count", 0),
            "limitation_evidence_count": counts.get("limitation_evidence_count", 0),
            "definition_evidence_count": int(has_definition),
            "coverage": "clinical-definition" if has_definition else "classification-only",
            "substantive_info": "yes" if has_definition else "no",
            "residual_gap": residual_gap,
            "app_core_document_count": len(app_coverage["document_ids"]),
            "app_core_definition_count": len(core_definition_sources),
            "app_core_definition_source_ids": ";".join(core_definition_sources),
            "app_core_coverage": app_core_coverage,
            "classification_path": json.dumps(
                [
                    {"code": node.code, "title": node.title, "sourceUrl": node.source_url}
                    for node in document.classification_path
                ],
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        }
        rows.append(row)
    rows.sort(key=lambda row: (str(row["code"]).casefold(), str(row["source_document_id"])))
    summary = {
        "totalCodes": len(rows),
        "exactCodeNodes": sum(row["node_kind"] == "exact-code" for row in rows),
        "categoryNodes": sum(row["node_kind"] == "category" for row in rows),
        "rangeNodes": sum(row["node_kind"] == "range" for row in rows),
        "clinicalDefinitionCodes": sum(row["substantive_info"] == "yes" for row in rows),
        "classificationOnlyCodes": sum(row["substantive_info"] == "no" for row in rows),
        "classificationContextCodes": sum(
            _int_field(row, "classification_context_count") > 0 for row in rows
        ),
        "synonymCoveredCodes": sum(_int_field(row, "synonym_count") > 0 for row in rows),
        "medicineListingCodes": sum(_int_field(row, "medicine_item_count") > 0 for row in rows),
        "appCoreDefinitionCodes": sum(
            _int_field(row, "app_core_definition_count") > 0 for row in rows
        ),
        "appCoreClassificationOnlyCodes": sum(
            _int_field(row, "app_core_document_count") > 0
            and _int_field(row, "app_core_definition_count") == 0
            for row in rows
        ),
        "appCoreAbsentCodes": sum(row["app_core_coverage"] == "absent" for row in rows),
    }
    return rows, summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--core", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rows, summary = audit_mkb_coverage(args.source, args.core)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0]) if rows else ["code", "title", "source_document_id"]
    with args.output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    report_path = args.output.with_suffix(".json")
    report_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
