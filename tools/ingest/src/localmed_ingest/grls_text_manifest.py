"""Text-extraction manifest and coverage report for collected GRLS instruction PDFs.

The prepared workspaces keep OCR diagnostics only inside ``.localmed/diagnostics``; the final
databases lost the flag. This module joins the collection state, the plans and every prepared
workspace by raw-PDF checksum into one manifest (one row per downloaded PDF) that carries the OCR
flag and quality signals, and computes registration/text/OCR/failure coverage from it.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import yaml

from .grls_collect import classify_state_record, load_merged_state
from .grls_groups import classify_document_kind
from .official_grls_registry import read_instruction_plan, safe_instruction_target, utc_now

_WORD = re.compile(r"[а-яё]{4,}")
_FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)
_LEXICON_MIN_DOCS = 3
_LEXICON_SAMPLE_DOCS = 2500


@dataclass(frozen=True)
class PreparedDocument:
    workspace: Path
    stem: str
    diagnostics: dict[str, object]

    @property
    def markdown(self) -> Path:
        return self.workspace / f"{self.stem}.md"


def _json_object(path: Path) -> dict[str, object]:
    decoded: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(decoded, dict):
        raise ValueError(f"{path} must contain a JSON object.")
    return cast(dict[str, object], decoded)


def index_prepared(workspaces: list[Path]) -> dict[str, PreparedDocument]:
    """Map raw-PDF checksum to its prepared document; later workspaces win."""
    index: dict[str, PreparedDocument] = {}
    for workspace in workspaces:
        diagnostics_dir = workspace / ".localmed" / "diagnostics"
        if not diagnostics_dir.is_dir():
            continue
        for path in sorted(diagnostics_dir.glob("*.json")):
            diagnostics = _json_object(path)
            checksum = diagnostics.get("sourceChecksum")
            if not isinstance(checksum, str):
                continue
            document = PreparedDocument(workspace, path.stem, diagnostics)
            if document.markdown.is_file():
                index[checksum] = document
    return index


def record_documents(record: Mapping[str, object]) -> list[dict[str, object]]:
    """Documents of a success record: the primary PDF first, then the extra current-edition ones."""
    documents = record.get("documents")
    if isinstance(documents, list) and documents:
        return [
            cast(dict[str, object], item)
            for item in cast(list[object], documents)
            if isinstance(item, dict)
        ]
    return [
        {
            "primary": True,
            "url": record.get("instructionUrl"),
            "label": record.get("instructionLabel"),
            "kind": None,
            "target": record.get("target"),
            "pdfSha256": record.get("pdfSha256"),
            "pdfBytes": record.get("pdfBytes"),
        }
    ]


def build_additions_registry(
    plan_path: Path,
    state_path: Path,
    catalog_paths: list[Path],
    raw_root: Path,
    prepared_workspaces: list[Path],
    output: Path,
    *,
    limit: int | None = None,
) -> dict[str, object]:
    """Source registry for downloaded PDFs that no prepared workspace has extracted yet."""
    plan = read_instruction_plan(plan_path)
    state = load_merged_state(state_path)
    known = set(index_prepared(prepared_workspaces))
    records: dict[str, dict[str, object]] = {}
    for catalog_path in catalog_paths:
        catalog = _json_object(catalog_path)
        for raw in cast(list[object], catalog["records"]):
            if isinstance(raw, dict):
                record = cast(dict[str, object], raw)
                number = record.get("registrationNumber")
                if isinstance(number, str):
                    records[number] = record
    sources: list[dict[str, object]] = []
    for raw in cast(list[object], plan["items"]):
        item = cast(dict[str, object], raw)
        registration_number = cast(str, item["registrationNumber"])
        result = state.get(registration_number)
        if result is None or result.get("state") != "success":
            continue
        catalog_record = records.get(registration_number, {})
        trade_name = str(catalog_record.get("tradeName") or item.get("tradeName") or "")
        source_id = hashlib.sha256(registration_number.encode("utf-8")).hexdigest()[:20]
        for index, document in enumerate(record_documents(result)):
            checksum = document.get("pdfSha256")
            if not isinstance(checksum, str) or checksum in known:
                continue
            target = str(document.get("target") or item["target"])
            if not safe_instruction_target(raw_root, target).is_file():
                continue
            suffix = "" if index == 0 else f".d{index}"
            sources.append(
                {
                    "id": f"drug.rf.{source_id}.instruction{suffix}",
                    "path": target,
                    "title": f"{trade_name}: инструкция по медицинскому применению",
                    "shortTitle": trade_name,
                    "versionLabel": f"grls-{plan['catalogEdition']}",
                    "sourceType": "official_drug_instruction",
                    "status": "active",
                    "format": "pdf",
                    "metadata": {
                        "registrationNumber": registration_number,
                        "requestedRegistrationNumbers": item.get("requestedRegistrationNumbers"),
                        "tradeName": trade_name,
                        "inn": catalog_record.get("inn"),
                        "dosageForm": catalog_record.get("dosageForm"),
                        "holder": catalog_record.get("holder"),
                        "officialSourceUrl": document.get("url"),
                        "instructionLabel": document.get("label"),
                        "pdfSha256": checksum,
                        "documentIndex": index,
                        "documentKindAtDownload": document.get("kind"),
                        "fetchedAt": result.get("recordedAt"),
                        "catalogEdition": plan["catalogEdition"],
                        "catalogChecksum": plan["catalogChecksum"],
                    },
                }
            )
    if limit is not None:
        sources = sources[:limit]
    edition = cast(str, plan["catalogEdition"])
    registry = {
        "pack": {
            "id": f"minimed.medications.grls-instructions.additions-{edition.replace('.', '-')}",
            "version": f"grls-{edition}",
            "schemaVersion": 2,
            "title": "Дополнительные официальные инструкции ГРЛС",
            "builtAt": f"{edition[6:]}-{edition[3:5]}-{edition[:2]}T00:00:00Z",
        },
        "sources": sources,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(yaml.safe_dump(registry, allow_unicode=True, sort_keys=False), "utf-8")
    return {"output": str(output), "sources": len(sources), "alreadyPrepared": len(known)}


def _body(markdown: Path) -> str:
    text = markdown.read_text(encoding="utf-8")
    return _FRONT_MATTER.sub("", text, count=1)


def _words(text: str) -> list[str]:
    return _WORD.findall(text.casefold())


def _text_digest(text: str) -> str:
    normalized = " ".join(text.casefold().split())
    return f"sha256:{hashlib.sha256(normalized.encode()).hexdigest()}"


def _build_lexicon(documents: list[PreparedDocument]) -> set[str]:
    """Words seen in at least three native-text-layer instructions (OCR-free reference)."""
    native = [
        document
        for document in documents
        if document.diagnostics.get("textExtractionMode") != "ocr"
    ]
    native.sort(key=lambda document: document.stem)
    step = max(1, len(native) // _LEXICON_SAMPLE_DOCS)
    frequency: Counter[str] = Counter()
    for document in native[::step]:
        frequency.update(set(_words(_body(document.markdown))))
    return {word for word, count in frequency.items() if count >= _LEXICON_MIN_DOCS}


def _failure_reason(record: dict[str, object] | None) -> str:
    if record is None:
        return "not-attempted"
    if record.get("state") == "deferred":
        return "deferred-legacy-number"
    declared = record.get("failureClass")
    if isinstance(declared, str):
        return declared
    error = str(record.get("error") or "")
    status = classify_state_record(record)
    if status == "transient":
        return "transient"
    if "search did not return" in error:
        prefix = re.sub(r"^GRLS search did not return registration\s*", "", error)
        if prefix.startswith("ФС-"):
            return "substance-registry"
        return "search-miss"
    if "no instruction PDF" in error:
        return "no-pdf"
    if "Forbidden" in error:
        return "forbidden"
    if "trade-name fallback was ambiguous" in error:
        return "ambiguous-trade-name"
    if "Too Many Requests" in error:
        return "transient"
    return "other"


def _coverage(
    plan: dict[str, object],
    rows_by_registration: dict[str, dict[str, object]],
    state: dict[str, dict[str, object]],
) -> dict[str, object]:
    items = cast(list[dict[str, object]], plan["items"])
    requested_total: set[str] = set()
    requested_with_pdf: set[str] = set()
    requested_with_text: set[str] = set()
    items_by_status: Counter[str] = Counter()
    failures: Counter[str] = Counter()
    for item in items:
        number = cast(str, item["registrationNumber"])
        requested = cast(list[str], item.get("requestedRegistrationNumbers") or [number])
        requested_total.update(requested)
        row = rows_by_registration.get(number)
        if row is not None:
            requested_with_pdf.update(requested)
            if row["searchable"]:
                requested_with_text.update(requested)
                items_by_status["pdf-with-text"] += 1
            else:
                items_by_status["pdf-without-text"] += 1
            continue
        reason = _failure_reason(state.get(number))
        failures[reason] += 1
        items_by_status["no-pdf"] += 1
    deferred = cast(list[dict[str, object]], plan.get("deferredItems") or [])
    for item in deferred:
        failures["deferred:" + str(item.get("deferredReason"))] += 1
    return {
        "planEdition": plan["catalogEdition"],
        "planItems": len(items),
        "deferredItems": len(deferred),
        "activeRegistrations": len(requested_total) + len(deferred),
        "requestedRegistrations": len(requested_total),
        "registrationsWithPdf": len(requested_with_pdf),
        "registrationsWithInstructionText": len(requested_with_text),
        "shareOfActiveWithInstructionText": round(
            len(requested_with_text) / (len(requested_total) + len(deferred)), 4
        ),
        "itemsByStatus": dict(sorted(items_by_status.items())),
        "failuresByReason": dict(sorted(failures.items())),
    }


def build_text_manifest(
    plan_paths: list[Path],
    state_path: Path,
    raw_root: Path,
    prepared_workspaces: list[Path],
    manifest_output: Path,
    report_output: Path,
    *,
    before_cutoff: str | None = None,
) -> dict[str, object]:
    """Join state, plans and prepared workspaces into a per-PDF manifest and coverage report."""
    state = load_merged_state(state_path)
    index = index_prepared(prepared_workspaces)
    lexicon = _build_lexicon(list(index.values()))
    plans = [read_instruction_plan(path) for path in plan_paths]
    targets: dict[str, dict[str, object]] = {}
    for plan in plans:
        for raw in cast(list[object], plan["items"]):
            item = cast(dict[str, object], raw)
            targets[cast(str, item["registrationNumber"])] = item

    rows: list[dict[str, object]] = []
    for number, record in sorted(state.items()):
        if record.get("state") != "success":
            continue
        item = targets.get(number, {})
        for document_index, document in enumerate(record_documents(record)):
            checksum = cast(str | None, document.get("pdfSha256"))
            prepared = index.get(checksum) if checksum else None
            row: dict[str, object] = {
                "registrationNumber": number,
                "requestedRegistrationNumbers": item.get("requestedRegistrationNumbers"),
                "documentIndex": document_index,
                "target": document.get("target"),
                "pdfSha256": checksum,
                "pdfBytes": document.get("pdfBytes"),
                "sourceUrl": document.get("url"),
                "fetchedAt": record.get("recordedAt"),
                "instructionLabel": document.get("label"),
                "extraction": "prepared" if prepared else "not-prepared",
                "documentKind": document.get("kind"),
                "searchable": False,
            }
            if prepared is not None:
                diagnostics = prepared.diagnostics
                body = _body(prepared.markdown)
                words = _words(body)
                unknown = sum(word not in lexicon for word in words)
                row.update(
                    {
                        "sourceId": prepared.stem,
                        "workspace": str(prepared.workspace),
                        "searchable": bool(words),
                        "pageCount": diagnostics.get("pageCount"),
                        "characterCount": diagnostics.get("characterCount"),
                        "textExtractionMode": diagnostics.get(
                            "textExtractionMode", "pdf_text_layer"
                        ),
                        "ocr": diagnostics.get("textExtractionMode") == "ocr",
                        "ocrEngine": diagnostics.get("ocrEngine"),
                        "ocrMeanConfidence": diagnostics.get("ocrMeanConfidence"),
                        "ocrLowConfidenceRatio": diagnostics.get("ocrLowConfidenceRatio"),
                        "qualityScore": diagnostics.get("qualityScore"),
                        "requiresReview": diagnostics.get("requiresReview"),
                        "wordCount": len(words),
                        "unknownWordRatio": round(unknown / len(words), 4) if words else None,
                        "textSha256": _text_digest(body),
                        "documentKind": classify_document_kind(body[:4000]),
                    }
                )
            rows.append(row)
    manifest_output.parent.mkdir(parents=True, exist_ok=True)
    with manifest_output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    def summarize(selected: list[dict[str, object]]) -> dict[str, object]:
        prepared_rows = [row for row in selected if row["extraction"] == "prepared"]
        with_text = [row for row in prepared_rows if row["searchable"]]
        ocr_rows = [row for row in with_text if row.get("ocr")]
        ratios_ocr = sorted(
            cast(float, row["unknownWordRatio"])
            for row in ocr_rows
            if row.get("unknownWordRatio") is not None
        )
        ratios_native = sorted(
            cast(float, row["unknownWordRatio"])
            for row in with_text
            if not row.get("ocr") and row.get("unknownWordRatio") is not None
        )
        confidences = [
            cast(float, row["ocrMeanConfidence"])
            for row in ocr_rows
            if row.get("ocrMeanConfidence") is not None
        ]

        def median(values: list[float]) -> float | None:
            return values[len(values) // 2] if values else None

        return {
            "pdfs": len(selected),
            "preparedWithText": len(with_text),
            "notPrepared": len(selected) - len(prepared_rows),
            "withoutText": len(prepared_rows) - len(with_text),
            "distinctTexts": len({row["textSha256"] for row in with_text}),
            "distinctPdfs": len({row["pdfSha256"] for row in selected}),
            "ocrDocuments": len(ocr_rows),
            "ocrShare": round(len(ocr_rows) / len(with_text), 4) if with_text else None,
            "ocrMedianUnknownWordRatio": median(ratios_ocr),
            "nativeMedianUnknownWordRatio": median(ratios_native),
            "ocrWithConfidence": len(confidences),
            "ocrMedianConfidence": median(sorted(confidences)),
        }

    primary_rows = [row for row in rows if row["documentIndex"] == 0]
    kind_counts = Counter(str(row.get("documentKind") or "unknown") for row in rows)

    def rows_before(cutoff: str) -> list[dict[str, object]]:
        return [row for row in primary_rows if str(row["fetchedAt"]) < cutoff]

    def by_registration(selected: list[dict[str, object]]) -> dict[str, dict[str, object]]:
        return {cast(str, row["registrationNumber"]): row for row in selected}

    report: dict[str, object] = {
        "generatedAt": utc_now(),
        "manifest": str(manifest_output),
        "after": {
            "texts": summarize(primary_rows),
            "documentKinds": dict(sorted(kind_counts.items())),
            "extraDocuments": len(rows) - len(primary_rows),
            "coverage": _coverage(plans[-1], by_registration(primary_rows), state),
        },
    }
    if before_cutoff is not None:
        before_rows = rows_before(before_cutoff)
        report["before"] = {
            "cutoff": before_cutoff,
            "texts": summarize(before_rows),
            "coverage": _coverage(
                plans[0], by_registration(before_rows), _state_before(state_path, before_cutoff)
            ),
        }
    report_output.parent.mkdir(parents=True, exist_ok=True)
    report_output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return report


def _state_before(state_path: Path, cutoff: str) -> dict[str, dict[str, object]]:
    """Merged ledger as it stood at ``cutoff`` (records written before it)."""
    merged: dict[str, dict[str, object]] = {}
    with state_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = cast(dict[str, object], json.loads(line))
            if str(record.get("recordedAt")) >= cutoff:
                continue
            number = cast(str, record["registrationNumber"])
            previous = merged.get(number)
            if (
                previous is not None
                and previous.get("state") == "success"
                and record.get("state") != "success"
            ):
                continue
            merged[number] = record
    return merged
