"""Batch driver of OCR1: re-prepare every OCR-derived GRLS instruction with the cleanup stage.

Reads the text manifest, the cached Vision payloads and the previously prepared Markdown; writes a new
prepared workspace (Markdown + `.localmed` extraction/diagnostics, the raw OCR lines kept in the
extraction JSON) and the overlay `data/build/grls-ocr-quality.jsonl`, one row per PDF checksum, which
the module builder joins onto the manifest (workspace, kind, quality, confidence). Nothing in the
manifest, the old workspaces or the raw PDFs is modified.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import yaml

from .grls_document_kind import classify_scan_document
from .grls_text_manifest import _text_digest as text_digest  # pyright: ignore[reportPrivateUsage]
from .ocr_requality import extract_with_vision
from .ocr_text_cleanup import COMPOUND_TOKEN, Lexicon
from .source_registry import extraction_front_matter, render_body

_FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
_MARKER = re.compile(r"<!-- localmed:[^\n]*-->\n?")
OVERLAY_VERSION = 1


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        cast(dict[str, Any], json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def split_markdown(text: str) -> tuple[dict[str, Any], str]:
    match = _FRONT_MATTER.match(text)
    if match is None:
        raise ValueError("Prepared Markdown has no front matter.")
    front = yaml.safe_load(match.group(1))
    if not isinstance(front, dict):
        raise ValueError("Front matter is not a mapping.")
    return cast(dict[str, Any], front), text[match.end() :]


def plain_text(markdown_body: str) -> str:
    return re.sub(r"^#+\s*", "", _MARKER.sub("", markdown_body), flags=re.MULTILINE)


def build_lexicon(rows: Iterable[Mapping[str, Any]], repo_root: Path) -> Lexicon:
    """Words of native-text-layer instructions: the reference an OCR text is checked against."""
    documents: list[list[str]] = []
    for row in rows:
        if row.get("extraction") != "prepared" or row.get("ocr"):
            continue
        workspace = (repo_root / "tools" / "ingest" / str(row["workspace"])).resolve()
        path = workspace / f"{row['sourceId']}.md"
        if not path.is_file():
            continue
        _, body = split_markdown(path.read_text(encoding="utf-8"))
        documents.append(COMPOUND_TOKEN.findall(plain_text(body)))
    return Lexicon.from_documents(documents)


@dataclass(frozen=True)
class DocumentResult:
    overlay: dict[str, Any]
    markdown: str
    extraction_json: dict[str, Any]


def reprepare_document(
    *,
    row: Mapping[str, Any],
    pdf_path: Path,
    old_markdown: Path,
    payload: Mapping[str, Any],
    lexicon: Lexicon,
    workspace_label: str,
) -> DocumentResult:
    old_text = old_markdown.read_text(encoding="utf-8")
    front, old_body = split_markdown(old_text)
    metadata = cast(dict[str, Any], front.get("metadata") or {})
    protected = [
        word.casefold()
        for key in ("tradeName", "inn", "holder")
        for word in COMPOUND_TOKEN.findall(str(metadata.get(key) or ""))
    ]
    extracted = extract_with_vision(pdf_path, payload, lexicon, protected=protected)
    body = render_body(extracted, source_id=str(row["sourceId"]))
    metadata["extraction"] = extraction_front_matter(extracted)
    front["metadata"] = metadata
    dumped = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).rstrip()
    markdown = f"---\n{dumped}\n---\n\n{body}"
    diagnostics = extracted.diagnostics
    new_plain = plain_text(body)
    kind = classify_scan_document(new_plain, page_count=diagnostics.page_count)
    old_plain = plain_text(old_body)
    cleanup = diagnostics.ocr_cleanup
    overlay: dict[str, Any] = {
        "overlayVersion": OVERLAY_VERSION,
        "pdfSha256": row["pdfSha256"],
        "sourceId": row["sourceId"],
        "workspace": workspace_label,
        "documentKind": kind.kind,
        "documentKindReason": kind.reason,
        "ocr": diagnostics.text_extraction_mode == "ocr",
        "ocrEngine": diagnostics.ocr_engine,
        "ocrTool": "macos-vision" if diagnostics.ocr_pages else None,
        "ocrMeanConfidence": diagnostics.ocr_mean_confidence,
        "ocrLowConfidenceRatio": diagnostics.ocr_low_confidence_ratio,
        "textSha256": text_digest(body),
        "ocrQuality": diagnostics.ocr_quality,
        "ocrQualityReasons": diagnostics.ocr_quality_reasons,
        "ocrPages": diagnostics.ocr_pages,
        "pageCount": diagnostics.page_count,
        "wordCount": cleanup.get("wordCount"),
        "unknownWordRatio": cleanup.get("unknownWordRatio"),
        "uncertainNumbers": cleanup.get("uncertainNumbers"),
        "wordEdits": sum(cast(dict[str, int], cleanup.get("wordEdits") or {}).values()),
        "pageMarks": cleanup.get("pageMarks"),
        "before": {
            "wordCount": len(re.findall(r"\w+", old_plain)),
            "documentKind": row.get("documentKind"),
            "unknownWordRatio": row.get("unknownWordRatio"),
        },
    }
    return DocumentResult(
        overlay=overlay,
        markdown=markdown,
        extraction_json=extracted.model_dump(by_alias=True, mode="json"),
    )


def write_document(workspace: Path, source_id: str, result: DocumentResult) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / f"{source_id}.md").write_text(result.markdown, encoding="utf-8")
    extractions = workspace / ".localmed" / "extractions"
    diagnostics = workspace / ".localmed" / "diagnostics"
    extractions.mkdir(parents=True, exist_ok=True)
    diagnostics.mkdir(parents=True, exist_ok=True)
    (extractions / f"{source_id}.json").write_text(
        json.dumps(result.extraction_json, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    (diagnostics / f"{source_id}.json").write_text(
        json.dumps(result.extraction_json["diagnostics"], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def select_rows(
    rows: Sequence[Mapping[str, Any]], extra_checksums: frozenset[str] = frozenset()
) -> list[Mapping[str, Any]]:
    """One manifest row per prepared document id whose text came from OCR (or is named extra)."""
    selected: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        if row.get("extraction") != "prepared" or not isinstance(row.get("sourceId"), str):
            continue
        if row.get("ocr") or str(row.get("pdfSha256")) in extra_checksums:
            selected[str(row["sourceId"])] = row
    return [selected[key] for key in sorted(selected)]
