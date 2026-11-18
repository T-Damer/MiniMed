"""Inventory review candidates in saved PDF extraction JSON without printing source text.

Run ``python -m localmed_ingest.ocr_quality_audit extraction.json [...]``. Each filename stem
is its source id. The JSON report goes to stdout; redirect it to a private location if needed.
Candidates are signals for page review, not confirmed errors or a measure of OCR accuracy.
Only alternatives retained in the extraction can be compared.
Low confidence means Vision's recorded line confidence is below 0.5, even if another reading won.
``--preview-grls-repair`` applies the current GRLS block rules in memory. It does not check
whether the original Markdown matched the extraction or whether a repair was published; the
trade name used by the original renderer is not available from the extraction alone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from typing import Literal, TypedDict, cast

from pydantic import ValidationError

from localmed_ingest.grls_render_repair import RepairCounters, repair_extraction
from localmed_ingest.models import ExtractedBlock, ExtractedSource
from localmed_ingest.ocr_second_opinion import digit_tokens

LOW_CONFIDENCE = 0.5
CHECKSUM = re.compile(r"sha256:[0-9a-f]{64}\Z")
IssueKind = Literal[
    "no-pages",
    "low-text-page",
    "low-ocr-confidence",
    "uncertain-ocr-number",
    "ocr-number-disagreement",
    "table-candidate",
    "flattened-table",
    "possible-unmarked-table",
]


class Issue(TypedDict):
    kind: IssueKind
    page: int | None
    block: str | None
    line: str | None
    bbox: list[float] | None


class SourceAudit(TypedDict):
    sourceId: str
    sourceChecksum: str
    extractionChecksum: str
    view: Literal["saved-extraction", "grls-repair-preview"]
    issues: list[Issue]


def _records(value: object) -> list[Mapping[str, object]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Invalid extraction metadata records.")
    records = cast(list[object], value)
    if not all(isinstance(item, dict) for item in records):
        raise ValueError("Invalid extraction metadata record.")
    return [cast(Mapping[str, object], item) for item in records]


def _low_confidence(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 <= value < LOW_CONFIDENCE
    )


def _issue(
    kind: IssueKind, page: int | None, block: ExtractedBlock | None, line: str | None = None
) -> Issue:
    return {
        "kind": kind,
        "page": page,
        "block": block.id if block else None,
        "line": line,
        "bbox": block.bbox if block else None,
    }


def _block_issues(page: int, block: ExtractedBlock) -> list[Issue]:
    issues: list[Issue] = []
    lines = _records(block.metadata.get("lines"))
    lines_with_confidence = [
        line
        for line in lines
        if isinstance(line.get("confidence"), (int, float))
        and not isinstance(line.get("confidence"), bool)
    ]
    for line in lines_with_confidence:
        if _low_confidence(line.get("confidence")):
            line_id = line.get("id")
            issues.append(
                _issue(
                    "low-ocr-confidence", page, block, line_id if isinstance(line_id, str) else None
                )
            )
    if not lines_with_confidence and _low_confidence(block.metadata.get("confidence")):
        issues.append(_issue("low-ocr-confidence", page, block))

    if block.metadata.get("review") == "ocr-uncertain-number":
        issues.append(_issue("uncertain-ocr-number", page, block))

    lines_by_id = {line.get("id"): line for line in lines if isinstance(line.get("id"), str)}
    if len(lines_by_id) != len(lines):
        raise ValueError("Invalid OCR line provenance.")
    disagreements = 0
    for alternative in _records(block.metadata.get("ocrAlternatives")):
        line_id = alternative.get("id")
        line = lines_by_id.get(line_id) if isinstance(line_id, str) else None
        selected = line.get("text") if line else None
        other = alternative.get("other")
        if (
            not isinstance(line_id, str)
            or not isinstance(selected, str)
            or not isinstance(other, str)
        ):
            raise ValueError("Invalid OCR alternative provenance.")
        differs = Counter(digit_tokens(selected)) != Counter(digit_tokens(other))
        if differs or alternative.get("digitsDiffer") is True:
            issues.append(
                _issue(
                    "ocr-number-disagreement",
                    page,
                    block,
                    line_id,
                )
            )
            disagreements += 1
    if not disagreements and block.metadata.get("enginesDisagreeOnNumbers") is True:
        issues.append(_issue("ocr-number-disagreement", page, block))

    if block.metadata.get("flattenedTable") is True:
        issues.append(_issue("flattened-table", page, block))
    elif block.kind == "table_candidate":
        issues.append(_issue("table-candidate", page, block))
    elif " | " in block.text:
        issues.append(_issue("possible-unmarked-table", page, block))
    return issues


def audit_extraction(
    source_id: str, extraction_json: bytes, *, preview_grls_repair: bool = False
) -> SourceAudit:
    """Audit one extraction; the checksum identifies the exact bytes used for this report."""
    if not source_id.strip():
        raise ValueError("Source id is required.")
    extracted = ExtractedSource.model_validate_json(extraction_json)
    if not CHECKSUM.fullmatch(extracted.source_checksum):
        raise ValueError("Invalid source checksum.")
    if extracted.source_checksum != extracted.diagnostics.source_checksum:
        raise ValueError("Extraction and diagnostics source checksums differ.")
    if extracted.source_format != extracted.diagnostics.source_format:
        raise ValueError("Extraction and diagnostics source formats differ.")
    if extracted.source_format != "pdf":
        raise ValueError("Only PDF extractions have source page coordinates.")
    page_numbers: set[int] = set()
    block_ids: set[str] = set()
    for page in extracted.pages:
        if page.page in page_numbers:
            raise ValueError("Duplicate page.")
        page_numbers.add(page.page)
        for block in page.blocks:
            if not block.id.strip() or block.id in block_ids or block.page not in (None, page.page):
                raise ValueError("Invalid block provenance.")
            block_ids.add(block.id)
            if block.bbox is not None and (
                len(block.bbox) != 4
                or not all(math.isfinite(value) for value in block.bbox)
                or block.bbox[0] > block.bbox[2]
                or block.bbox[1] > block.bbox[3]
            ):
                raise ValueError("Invalid block coordinates.")
    if len(page_numbers) != extracted.diagnostics.page_count or any(
        page > extracted.diagnostics.page_count for page in page_numbers
    ):
        raise ValueError("Incomplete PDF page provenance.")
    if not set(extracted.diagnostics.low_text_pages).issubset(page_numbers) or not set(
        extracted.diagnostics.ocr_pages
    ).issubset(page_numbers):
        raise ValueError("Diagnostic page is missing from the extraction.")
    if preview_grls_repair:
        extracted = repair_extraction(extracted, RepairCounters())

    issues: list[Issue] = []
    if not page_numbers:
        issues.append(_issue("no-pages", None, None))
    low_text_pages = set(extracted.diagnostics.low_text_pages)
    for page in sorted(extracted.pages, key=lambda item: item.page):
        if page.low_text or page.page in low_text_pages:
            issues.append(_issue("low-text-page", page.page, None))
        for block in sorted(page.blocks, key=lambda item: (item.order_index, item.id)):
            if not block.removed and block.kind not in {
                "page_mark",
                "noise",
                "repeated_marginalia",
            }:
                issues.extend(_block_issues(page.page, block))
    return {
        "sourceId": source_id,
        "sourceChecksum": extracted.source_checksum,
        "extractionChecksum": f"sha256:{hashlib.sha256(extraction_json).hexdigest()}",
        "view": "grls-repair-preview" if preview_grls_repair else "saved-extraction",
        "issues": issues,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extractions", nargs="+", type=Path, help="Saved extraction JSON files")
    parser.add_argument(
        "--preview-grls-repair", action="store_true", help="Preview GRLS block repairs in memory"
    )
    args = parser.parse_args()
    paths = sorted(cast(list[Path], args.extractions), key=lambda path: str(path))
    if len({path.stem for path in paths}) != len(paths):
        print("Extraction filenames must have unique source ids.", file=sys.stderr)
        return 1
    try:
        sources = [
            audit_extraction(
                path.stem, path.read_bytes(), preview_grls_repair=args.preview_grls_repair
            )
            for path in paths
        ]
    except (OSError, ValueError, ValidationError):
        print("Could not read or validate an extraction; no report was written.", file=sys.stderr)
        return 1
    print(json.dumps({"version": 1, "sources": sources}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
