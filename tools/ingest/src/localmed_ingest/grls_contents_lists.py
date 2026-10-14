"""LEAF1: keep the table of contents of every patient leaflet as one list.

A prepared leaflet that opens with «Содержание листка-вкладыша» carried its six entries as headings
and one-line paragraphs (`leaflet_contents.py` has the cause). The extraction JSON of every prepared
document is kept next to its Markdown, so the fix is a deterministic re-render of the *body* from
that extraction with `render_body(..., contents_lists=True)`; the front matter is carried over byte
for byte and the old workspace, the manifest and the raw PDFs are left alone, like OCR1 did.

This module plans and writes the re-rendered documents into a new workspace and the overlay
`data/build/grls-contents-lists.jsonl` (one row per document id: new workspace, new `textSha256`,
the recognised lists with their block ids) that the module builders join onto the manifest.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from .grls_text_manifest import _text_digest  # pyright: ignore[reportPrivateUsage]
from .leaflet_contents import ContentsRun, find_contents_runs
from .models import ExtractedBlock, ExtractedSource
from .source_registry import render_body

OVERLAY_VERSION = 1
FRONT_MATTER_END = "\n---\n"


class BodyNotReproducedError(ValueError):
    """The stored extraction does not render to the stored Markdown: it is not a safe input."""


@dataclass(frozen=True)
class Rerendered:
    document_id: str
    markdown: str
    runs: tuple[ContentsRun, ...]
    text_sha256: str
    text_sha256_before: str


def split_prepared(markdown: str) -> tuple[str, str]:
    """The front matter (with its closing marker and the blank line) and the body."""
    end = markdown.find(FRONT_MATTER_END, 4)
    if not markdown.startswith("---\n") or end < 0:
        raise ValueError("Prepared Markdown has no front matter.")
    cut = end + len(FRONT_MATTER_END)
    return markdown[:cut], markdown[cut:]


def kept_blocks(extracted: ExtractedSource) -> list[ExtractedBlock]:
    return [
        block
        for page in extracted.pages
        for block in sorted(page.blocks, key=lambda item: item.order_index)
        if not block.removed and block.kind != "page_mark"
    ]


def rerender_contents(
    document_id: str, markdown: str, extracted: ExtractedSource
) -> Rerendered | None:
    """The prepared Markdown with the contents lists kept as lists, ``None`` when it has none.

    Raises ``BodyNotReproducedError`` when rendering the stored extraction the old way does not give
    the stored body: such a document was edited after the extraction and must not be re-rendered.
    """
    head, old_body = split_prepared(markdown)
    runs = find_contents_runs(kept_blocks(extracted))
    if not runs:
        return None
    plain = render_body(extracted, source_id=document_id)
    if f"\n{plain}" != old_body:
        raise BodyNotReproducedError(
            f"{document_id}: the stored extraction does not render to the stored Markdown."
        )
    body = render_body(extracted, source_id=document_id, contents_lists=True)
    if body == plain:
        return None
    return Rerendered(
        document_id=document_id,
        markdown=f"{head}\n{body}",
        runs=tuple(runs),
        text_sha256=_text_digest(body),
        text_sha256_before=_text_digest(plain),
    )


def overlay_row(result: Rerendered, workspace_label: str, source_workspace: str) -> dict[str, Any]:
    return {
        "overlayVersion": OVERLAY_VERSION,
        "sourceId": result.document_id,
        "workspace": workspace_label,
        "extractionWorkspace": source_workspace,
        "textSha256": result.text_sha256,
        "textSha256Before": result.text_sha256_before,
        "contentsLists": [
            {
                "header": run.header_id,
                "blocks": list(run.block_ids),
                "entries": len(run.entries),
                "repeated": run.repeated,
                "split": list(run.split) if run.split is not None else None,
            }
            for run in result.runs
        ],
    }


def read_overlay(path: Path) -> dict[str, dict[str, Any]]:
    """The overlay rows by document id; a missing file means no re-rendered document."""
    if not path.is_file():
        return {}
    return {
        str(row["sourceId"]): row
        for row in (
            cast(dict[str, Any], json.loads(line))
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        )
    }


def apply_overlay(
    rows: Sequence[Mapping[str, Any]], overlay: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Every manifest row of a re-rendered document takes its workspace and text digest.

    The OCR overlay (`grls_instruction_modules.apply_overlay`) is applied first: this one only
    replaces the text, so quality, kind and OCR columns of the same document stay as they were.
    """
    merged: list[dict[str, Any]] = []
    for row in rows:
        entry = dict(row)
        extra = overlay.get(str(row.get("sourceId")))
        if extra is not None and row.get("extraction") == "prepared":
            entry["workspace"] = extra["workspace"]
            entry["textSha256"] = extra["textSha256"]
            entry["contentsOverlay"] = dict(extra)
        merged.append(entry)
    return merged
