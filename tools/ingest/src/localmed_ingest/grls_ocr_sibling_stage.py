"""Stage of OCR1 that prefers a native text layer of the same product over OCR (see
`grls_ocr_siblings`)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import yaml

from .grls_ocr_requality import plain_text, split_markdown
from .grls_ocr_siblings import (
    MIN_SIBLING_WORDS,
    Comparison,
    compare_with_native,
    product_key,
)

SIBLING_KINDS = frozenset({"national-instruction", "leaflet", "ohlp"})


@dataclass(frozen=True)
class NativeCandidate:
    source_id: str
    pdf_sha256: str
    path: Path
    kind: str | None
    word_count: int


def native_index(
    rows: Iterable[Mapping[str, Any]], data_root: Path
) -> dict[tuple[str, str, str, str], list[NativeCandidate]]:
    """Native-text instructions by product key (trade name, INN, holder, dosage form)."""
    index: dict[tuple[str, str, str, str], list[NativeCandidate]] = {}
    for row in rows:
        if row.get("extraction") != "prepared" or row.get("ocr") or not row.get("searchable"):
            continue
        if (
            row.get("documentKind") not in SIBLING_KINDS
            or int(row.get("wordCount") or 0) < MIN_SIBLING_WORDS
        ):
            continue
        workspace = (data_root / "tools" / "ingest" / str(row["workspace"])).resolve()
        path = workspace / f"{row['sourceId']}.md"
        front, _ = split_markdown(path.read_text(encoding="utf-8"))
        key = product_key(cast(Mapping[str, Any], front.get("metadata") or {}))
        if key is not None:
            index.setdefault(key, []).append(
                NativeCandidate(
                    str(row["sourceId"]),
                    str(row["pdfSha256"]),
                    path,
                    cast("str | None", row.get("documentKind")),
                    int(row.get("wordCount") or 0),
                )
            )
    return index


def sibling_replacement(
    cleaned_markdown: str, candidates: Sequence[NativeCandidate]
) -> tuple[NativeCandidate, Comparison] | None:
    """The best candidate that is demonstrably the same document, else None."""
    _, body = split_markdown(cleaned_markdown)
    ocr_text = plain_text(body)
    best: tuple[NativeCandidate, Comparison] | None = None
    for candidate in candidates:
        _, native_body = split_markdown(candidate.path.read_text(encoding="utf-8"))
        comparison = compare_with_native(ocr_text, plain_text(native_body))
        if comparison.same_document and (
            best is None or comparison.containment > best[1].containment
        ):
            best = (candidate, comparison)
    return best


def sibling_markdown(
    cleaned_markdown: str, candidate: NativeCandidate, comparison: Comparison
) -> str:
    """The OCR document's identity with the native text layer of the same product as its body."""
    front, _ = split_markdown(cleaned_markdown)
    _, native_body = split_markdown(candidate.path.read_text(encoding="utf-8"))
    metadata = cast(dict[str, Any], front.get("metadata") or {})
    previous = cast(dict[str, Any], metadata.get("extraction") or {})
    metadata["extraction"] = {
        "format": "pdf",
        "pageCount": previous.get("pageCount"),
        "textExtractionMode": "pdf_text_layer",
        "textSource": "sibling-text-layer",
        "textSourceDocumentId": candidate.source_id,
        "textSourcePdfSha256": candidate.pdf_sha256,
        "textSourceTrigramContainment": round(comparison.containment, 3),
        "replacesOcr": {
            "ocrQuality": previous.get("ocrQuality"),
            "ocrMeanConfidence": previous.get("ocrMeanConfidence"),
        },
    }
    front["metadata"] = metadata
    dumped = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).rstrip()
    return f"---\n{dumped}\n---\n{native_body}"
