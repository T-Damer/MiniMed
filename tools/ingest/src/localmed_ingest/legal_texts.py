"""Prepared full texts of the regulatory acts (LEGAL1): reconciled pages -> structured Markdown + provenance.

Inputs per act (all outside the repository, read by absolute path): the official PDF with its SHA-256, one
Marker Markdown file per page (`marker/<eo>/pNNNN.md`), Vision's lines (`vision/<eo>.json`) and the portal record.
`legal_reconcile` decides what each page may carry; this module turns the pages into

* the body of the card: sections by annex and chapter, paragraphs and list items as separate paragraphs with a
  `localmed:source` span carrying the PDF page, tables as `renderBlock` tables (cells, header row) followed by their
  Markdown rows, footnotes kept in place, paragraphs and tables that run across a page break joined;
* a provenance record per page: reading, confidence, flags, review marks, furniture removed, portal rewrites.

A review log (`corrections`) is applied to a page's text after reconciliation; every flagged page needs a verdict in it,
otherwise it keeps a review mark (`localmed:review`) in the text. Nothing here reads the network.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import Any, Final, Literal

from .legal_reconcile import (
    LINE_BREAK_IN_CELL,
    ActIdentity,
    PageResult,
    act_identity,
    clean_marker_markdown,
    reconcile_page,
)

BlockKind = Literal["heading", "paragraph", "table", "footnote"]

_TABLE_LINE: Final = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR: Final = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_ITEM_START: Final = re.compile(r"^(?:\d{1,3}(?:\.\d+)*[.)]\s|[а-яa-z]\)\s|[-•*+]\s)")
_HEADING: Final = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FOOTNOTE: Final = re.compile(r"^[⁰¹²³⁴⁵⁶⁷⁸⁹]+\s+\S")
_BOLD_ONLY: Final = re.compile(r"^\*\*(.+?)\*\*$|^__(.+?)__$")
_EMPHASIS: Final = re.compile(
    r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])"
)
_ANNEX: Final = re.compile(r"^(?:Приложение(?:\s*[№N]\s*(\d+))?\b)", re.IGNORECASE)
_APPROVED: Final = re.compile(r"^(?:УТВЕРЖДЕН[ОЫАЫ]?|Утвержден[оыаы]?)\b")
_LAW_PART: Final = re.compile(r"^(?:Глава|Раздел|Часть)\s+[IVXLC\d]+", re.IGNORECASE)
_LAW_ARTICLE: Final = re.compile(r"^Статья\s+\d", re.IGNORECASE)
_ANNEX_RUNON: Final = re.compile(
    r"^(?:к\s|от\s+(?:«|\d)|утвержден\w*\s|приказ\w*\s|Министерства\s|и социального|Российской Федерации\b)",
    re.IGNORECASE,
)
_STRUCTURAL: Final = re.compile(
    r"^(?:Глава|Раздел|Часть|Статья|Приложение|\d{1,3}[.)]\s|[IVXLC]{1,6}\.\s)", re.IGNORECASE
)
_ADOPTED: Final = re.compile(r"^(?:Принят|Одобрен|Подписан|Москва, Кремль)", re.IGNORECASE)
_ROMAN: Final = re.compile(r"^[IVXLC]{1,6}\.\s+\S")
_TERMINAL: Final = re.compile(r"[.;:!?»)\]]$")


@dataclass
class Block:
    kind: BlockKind
    text: str
    page: int
    level: int = 0
    rows: list[list[str]] = field(default_factory=list)
    confidence: str = "high"
    reviewed: bool = False
    pending: list[str] = field(default_factory=list)
    end_page: int | None = None


# ------------------------------------------------------------------------------------ parsing


def _unemphasize(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return match.group(2) if match.group(2) is not None else match.group(3)

    return _EMPHASIS.sub(replace, text)


def _cell(raw: str) -> str:
    """A cell's text: spaces collapsed, line breaks (⏎) kept as newlines between the parts."""
    parts = [
        re.sub(r"\s+", " ", _unemphasize(part.replace("\\|", "|"))).strip()
        for part in raw.split(LINE_BREAK_IN_CELL)
    ]
    return "\n".join(part for part in parts if part)


def _split_row(line: str) -> list[str]:
    inner = line.strip()
    inner = inner[1:] if inner.startswith("|") else inner
    inner = inner[:-1] if inner.endswith("|") and not inner.endswith("\\|") else inner
    cells = re.split(r"(?<!\\)\|", inner)
    return [_cell(cell) for cell in cells]


def parse_blocks(
    text: str, page: int, confidence: str = "high", reviewed: bool = False
) -> list[Block]:
    """Blocks of one page of Marker's Markdown (already cleaned)."""
    blocks: list[Block] = []
    lines = text.split("\n")
    index = 0
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            joined = re.sub(r"\s+", " ", " ".join(part.strip() for part in buffer)).strip()
            buffer.clear()
            if not joined:
                return
            plain = _unemphasize(joined)
            bold = _BOLD_ONLY.match(joined)
            if bold and len(plain) < 260 and not plain.endswith((".", ";", ",")):
                blocks.append(
                    Block("heading", plain, page, 2, confidence=confidence, reviewed=reviewed)
                )
            elif _FOOTNOTE.match(plain):
                blocks.append(
                    Block("footnote", plain, page, confidence=confidence, reviewed=reviewed)
                )
            else:
                blocks.append(
                    Block("paragraph", plain, page, confidence=confidence, reviewed=reviewed)
                )

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            flush()
            index += 1
            continue
        heading = _HEADING.match(line.strip())
        if heading:
            flush()
            title = re.sub(r"\s+", " ", _unemphasize(heading.group(2))).strip()
            if title:
                blocks.append(
                    Block(
                        "heading",
                        title,
                        page,
                        len(heading.group(1)),
                        confidence=confidence,
                        reviewed=reviewed,
                    )
                )
            index += 1
            continue
        if _TABLE_LINE.match(line):
            flush()
            rows: list[list[str]] = []
            while index < len(lines) and _TABLE_LINE.match(lines[index]):
                if not _TABLE_SEPARATOR.match(lines[index]):
                    rows.append(_split_row(lines[index]))
                index += 1
            if len(rows) == 1 and len(rows[0]) == 1:  # a boxed field of a form, not a table
                text = rows[0][0].replace("\n", " ")
                blocks.append(
                    Block("paragraph", text, page, confidence=confidence, reviewed=reviewed)
                )
            elif rows:
                blocks.append(
                    Block("table", "", page, rows=rows, confidence=confidence, reviewed=reviewed)
                )
            continue
        if _ITEM_START.match(line.strip()):
            flush()
        buffer.append(line)
        index += 1
    flush()
    return blocks


def _ends_open(text: str) -> bool:
    return not _TERMINAL.search(text.rstrip())


def merge_pages(pages: list[list[Block]]) -> list[Block]:
    """Join paragraphs and tables that run across a page break; footnotes stay at their page's end."""
    merged: list[Block] = []
    carried_footnotes: list[Block] = []
    for page_blocks in pages:
        if not page_blocks:
            continue
        head = page_blocks[0]
        body_tail = merged[-1] if merged else None
        footnotes_before = carried_footnotes
        if body_tail is not None:
            if (
                head.kind == "paragraph"
                and body_tail.kind == "paragraph"
                and _ends_open(body_tail.text)
                and head.text[:1].islower()
            ):
                body_tail.text = f"{body_tail.text} {head.text}"
                body_tail.end_page = head.page
                merged.extend(footnotes_before)
                carried_footnotes = []
                page_blocks = page_blocks[1:]
            elif (
                head.kind == "table" and body_tail.kind == "table" and _same_width(body_tail, head)
            ):
                rows = head.rows
                if rows and body_tail.rows and rows[0] == body_tail.rows[0]:
                    rows = rows[1:]
                moved = _continues_row(body_tail.rows[-1], rows[0]) if rows else None
                if rows and moved is not None:
                    last = body_tail.rows[-1]
                    last[moved[1]] = f"{last[moved[1]]} {rows[0][moved[0]]}".strip()
                    rows = rows[1:]
                body_tail.rows.extend(rows)
                body_tail.end_page = head.page
                merged.extend(footnotes_before)
                carried_footnotes = []
                page_blocks = page_blocks[1:]
        merged.extend(carried_footnotes)
        carried_footnotes = []
        # The page's trailing footnotes are held back so that a paragraph continued on the next page
        # is joined before them.
        tail: list[Block] = []
        while page_blocks and page_blocks[-1].kind == "footnote":
            tail.insert(0, page_blocks.pop())
        merged.extend(page_blocks)
        if merged and merged[-1].kind == "paragraph" and _ends_open(merged[-1].text) and tail:
            carried_footnotes = tail
        else:
            merged.extend(tail)
    merged.extend(carried_footnotes)
    return merged


def _continues_row(previous: list[str], row: list[str]) -> tuple[int, int] | None:
    """(column of the row's text, column of the previous row to append it to) for a row cut by a page break.

    The cut leaves one filled cell on the new page (lower-case start; the grid may place it in the first column
    when the cell spans) and the text belongs to the previous row's longest open cell (no closing punctuation).
    """
    filled = [i for i, cell in enumerate(row) if cell]
    if len(filled) != 1 or len(previous) != len(row):
        return None
    text = row[filled[0]]
    open_cells = [i for i, cell in enumerate(previous) if len(cell) > 3 and not cell[:1].isdigit()]
    if not text[:1].islower() or not open_cells:
        return None
    target = max(open_cells, key=lambda i: len(previous[i]))
    if re.search(r"[.;:!?»)]$", previous[target].rstrip()):
        return None
    return filled[0], target


def _same_width(left: Block, right: Block) -> bool:
    return bool(left.rows and right.rows and len(left.rows[0]) == len(right.rows[0]))


# ------------------------------------------------------------------------------------ structure


def title_for(identity: ActIdentity) -> str:
    match = re.match(
        r"^(Приказ|Федеральный закон|Постановление|Распоряжение)\b", identity.kind_line
    )
    kind = match.group(1) if match else identity.kind_line.split(" от ")[0]
    return f"{kind} № {identity.number}"


def _law_heading_level(block: Block) -> int:
    """Chapter (2) and article (3) lines of a law, plain or bold; the adoption lines are not headings."""
    text = block.text
    if block.kind not in ("heading", "paragraph") or len(text) > 250:
        return 0
    if _ADOPTED.match(text):
        return 0
    if re.match(r"^(?:Глава|Раздел)\s+[IVXLC\d]+\.?\s", text, re.IGNORECASE):
        return 2
    if re.match(r"^Статья\s+\d+(?:\.\d+)*\.\s+[А-ЯЁ«\"]", text) and not text.endswith("."):
        return 3
    return 0


def structure(blocks: list[Block], identity: ActIdentity, first_page: int = 1) -> list[Block]:
    """Assign heading levels: the act and each annex are level 1, chapters and titles below."""
    out: list[Block] = [Block("heading", title_for(identity), first_page, 1)]
    out.append(Block("paragraph", f"«{identity.name}»", first_page))
    index = 0
    while index < len(blocks):
        block = blocks[index]
        text = block.text
        if block.kind == "heading" and _APPROVED.match(text):
            follow = blocks[index + 1] if index + 1 < len(blocks) else None
            if follow is not None and follow.kind == "paragraph":
                out.append(
                    Block("heading", "Приложение", block.page, 1, confidence=block.confidence)
                )
                joined = Block(
                    "paragraph", f"{text} {follow.text}", block.page, confidence=block.confidence
                )
                joined.reviewed = block.reviewed
                out.append(joined)
                index += 2
                continue
            block = Block("paragraph", text, block.page, confidence=block.confidence)
            text = block.text
        if block.kind == "paragraph" and (_ANNEX.match(text) or _APPROVED.match(text)):
            annex = _ANNEX.match(text)
            number = annex.group(1) if annex and annex.group(1) else ""
            previous = out[-1]
            if not (
                previous.kind == "heading"
                and previous.level == 1
                and previous.text.startswith("Приложение")
            ):
                out.append(
                    Block(
                        "heading",
                        f"Приложение № {number}" if number else "Приложение",
                        block.page,
                        1,
                    )
                )
            out.append(block)
            index += 1
            # The right-aligned header of an annex runs on in the next lines («к Порядку …», «от <date> № …»).
            while index < len(blocks):
                nxt = blocks[index]
                if (
                    nxt.kind in ("heading", "paragraph")
                    and len(nxt.text) < 220
                    and _ANNEX_RUNON.match(nxt.text)
                ):
                    block.text = f"{block.text} {nxt.text}"
                    index += 1
                    continue
                break
            continue
        if block.kind == "heading" and _ANNEX.match(text):
            block = Block(
                "paragraph", text, block.page, confidence=block.confidence, reviewed=block.reviewed
            )
            blocks[index] = block
            continue
        if block.kind == "heading" and _ADOPTED.match(text):
            block = Block("paragraph", text, block.page, confidence=block.confidence)
            blocks[index] = block
            continue
        if block.kind == "heading":
            level = min(max(block.level, 2), 3)
            if _LAW_PART.match(text):
                level = 2
            elif _LAW_ARTICLE.match(text):
                level = 3
            out.append(
                Block(
                    "heading",
                    text,
                    block.page,
                    level,
                    confidence=block.confidence,
                    reviewed=block.reviewed,
                )
            )
            index += 1
            continue
        law_level = _law_heading_level(block)
        if law_level:
            out.append(
                Block(
                    "heading",
                    text,
                    block.page,
                    law_level,
                    confidence=block.confidence,
                    reviewed=block.reviewed,
                )
            )
            index += 1
            continue
        if (
            block.kind == "paragraph"
            and _ROMAN.match(text)
            and len(text) < 140
            and not text.endswith((".", ";"))
        ):
            out.append(
                Block(
                    "heading",
                    text,
                    block.page,
                    2,
                    confidence=block.confidence,
                    reviewed=block.reviewed,
                )
            )
            index += 1
            continue
        out.append(block)
        index += 1
    return _merge_adjacent_headings(out)


def _merge_adjacent_headings(blocks: list[Block]) -> list[Block]:
    merged: list[Block] = []
    for block in blocks:
        previous = merged[-1] if merged else None
        if (
            block.kind == "heading"
            and previous is not None
            and previous.kind == "heading"
            and re.match(r"^(?:Глава|Раздел)\s", previous.text, re.IGNORECASE)
            and re.match(r"^Статья\s", block.text, re.IGNORECASE)
        ):
            # a chapter opens with its first article: the article's title stays a line of the chapter section
            merged.append(Block("paragraph", block.text, block.page, confidence=block.confidence))
            continue
        if block.kind == "heading" and previous is not None and previous.kind == "heading":
            title = previous.text.rstrip()
            if not title:
                previous.text = block.text
            elif re.search(r"[а-яё,\-]$", title) and not _STRUCTURAL.match(block.text):
                # one title wrapped over two bold lines
                previous.text = f"{title} {block.text}"
            else:
                previous.text = f"{title.rstrip('.')} — {block.text}"
            previous.level = min(previous.level, block.level)
            continue
        merged.append(block)
    if merged and merged[-1].kind == "heading":
        last = merged.pop()
        merged.append(Block("paragraph", last.text, last.page))
    return merged


# ------------------------------------------------------------------------------------ rendering


def _span(block: Block, extra: dict[str, Any] | None = None) -> str:
    """The source marker of a block; a block of a text source (no page) has none unless it carries data."""
    payload: dict[str, Any] = {"page": block.page} if block.page > 0 else {}
    if block.end_page is not None and block.end_page != block.page:
        payload["pageEnd"] = block.end_page
    if block.reviewed:
        payload["reviewed"] = True
    elif block.confidence != "high":
        payload["confidence"] = block.confidence
    if extra:
        payload.update(extra)
    if not payload:
        return ""
    return (
        "<!-- localmed:source "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + " -->"
    )


def _markdown_row(cells: list[str]) -> str:
    return "| " + " | ".join(cell.replace("|", "\\|").replace("\n", " ") for cell in cells) + " |"


def render_table(block: Block) -> str:
    width = max(len(row) for row in block.rows)
    rows = [row + [""] * (width - len(row)) for row in block.rows]
    render = {
        "kind": "table",
        "caption": "",
        "rows": [
            {
                "cells": [
                    {"text": cell, "header": index == 0, "rowSpan": 1, "colSpan": 1} for cell in row
                ]
            }
            for index, row in enumerate(rows)
        ],
    }
    lines = [_span(block, {"renderBlock": render})]
    lines.append(_markdown_row(rows[0]))
    lines.append("| " + " | ".join("---" for _ in range(width)) + " |")
    lines.extend(_markdown_row(row) for row in rows[1:])
    return "\n".join(lines)


def render_blocks(blocks: list[Block]) -> str:
    parts: list[str] = []
    for block in blocks:
        if block.kind == "heading":
            parts.append(f"{'#' * block.level} {block.text}")
        elif block.kind == "table":
            parts.append(render_table(block))
        else:
            lines = [_span(block)] if _span(block) else []
            if block.pending:
                lines.append(
                    "<!-- localmed:review "
                    + "; ".join(block.pending)[:300].replace("-->", "")
                    + " -->"
                )
            lines.append(block.text)
            parts.append("\n".join(lines))
    return "\n\n".join(parts) + "\n"


# ------------------------------------------------------------------------------------ the act


@dataclass(frozen=True)
class Correction:
    page: int
    find: str
    replace: str
    kind: str
    why: str


@dataclass
class Review:
    """The review log of one act: corrections read against the page images and a verdict per page."""

    reviewer: str = ""
    reviewed_at: str = ""
    corrections: list[Correction] = field(default_factory=list)
    verdicts: dict[int, str] = field(default_factory=dict)
    keep_marker: set[int] = field(default_factory=set)
    """Pages whose Marker text is longer than Vision's because Vision reads a sideways table badly (not a loop)."""
    transcriptions: dict[int, str] = field(default_factory=dict)
    """Pages whose Markdown was re-typed from the image because Marker's text was beyond a few fixes."""

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> Review:
        return cls(
            reviewer=str(payload.get("reviewer", "")),
            reviewed_at=str(payload.get("reviewedAt", "")),
            corrections=[
                Correction(
                    page=int(item["page"]),
                    find=str(item["find"]),
                    replace=str(item["replace"]),
                    kind=str(item.get("kind", "text")),
                    why=str(item.get("why", "")),
                )
                for item in payload.get("corrections", [])
            ],
            verdicts={int(page): str(text) for page, text in payload.get("verdicts", {}).items()},
            keep_marker={int(page) for page in payload.get("keepMarker", [])},
            transcriptions={
                int(page): str(item["text"])
                for page, item in payload.get("transcriptions", {}).items()
            },
        )


class CorrectionError(ValueError):
    pass


def apply_corrections(result: PageResult, corrections: list[Correction]) -> int:
    """Apply the page's corrections to its text; each `find` must occur exactly once."""
    applied = 0
    for item in corrections:
        count = result.text.count(item.find)
        if count != 1:
            raise CorrectionError(
                f"page {result.page}: «{item.find[:60]}» occurs {count} times (a correction needs exactly one)"
            )
        result.text = result.text.replace(item.find, item.replace, 1)
        applied += 1
    return applied


@dataclass
class ActText:
    body: str
    pages: list[dict[str, Any]]
    pending_pages: list[int]
    blocks: list[Block]


def reconcile_act(
    marker_pages: dict[int, str | None],
    vision_pages: dict[int, list[str]],
    identity: ActIdentity,
    review: Review | None = None,
    *,
    exact_primary: bool = False,
) -> tuple[list[PageResult], list[int]]:
    """Reconcile every page; returns the results and the flagged pages without a review verdict."""
    review = review or Review()
    results: list[PageResult] = []
    pending: list[int] = []
    for page in sorted(vision_pages):
        fixes = [c for c in review.corrections if c.page == page]
        # A page read against its image keeps Marker's text: Vision's tokens are not swapped in again.
        reviewed = page in review.verdicts or bool(fixes) or page in review.transcriptions
        result = reconcile_page(
            page,
            marker_pages.get(page),
            vision_pages[page],
            identity=identity,
            substitute=not reviewed,
            exact_primary=exact_primary,
            inflation_checked=page not in review.keep_marker,
        )
        if page in review.transcriptions:
            result.text = review.transcriptions[page]
            result.reading = "image-transcription"
        if fixes:
            apply_corrections(result, fixes)
        if result.status == "review":
            if page in review.verdicts or fixes or page in review.transcriptions:
                result.status = "reviewed"
                result.confidence = "high"
            else:
                pending.append(page)
        results.append(result)
    return results, pending


def build_act_text(results: list[PageResult], identity: ActIdentity) -> ActText:
    pages: list[list[Block]] = []
    pending_pages: list[int] = []
    for result in results:
        reviewed = result.status == "reviewed"
        pending = result.status == "review"
        confidence = "low" if pending and result.confidence == "low" else result.confidence
        blocks = parse_blocks(clean_marker_markdown(result.text), result.page, confidence, reviewed)
        if pending and blocks:
            blocks[0].pending = [
                f"page {result.page}: " + ", ".join(sorted({f.kind for f in result.flags}))
            ]
            pending_pages.append(result.page)
        pages.append(blocks)
    blocks = structure(merge_pages(pages), identity)
    body = render_blocks(blocks)
    provenance = [
        {
            "page": result.page,
            "reading": result.reading,
            "status": result.status,
            "confidence": result.confidence,
            "flags": [{"kind": f.kind, "detail": f.detail[:300]} for f in result.flags],
            "furniture": result.furniture,
            "portalRewrites": result.portal_rewrites,
            "headerRemoved": result.header_removed,
            "stats": result.stats,
        }
        for result in results
    ]
    return ActText(body, provenance, pending_pages, blocks)


def build_text_source_act(markdown: str, identity: ActIdentity, *, cut_header: bool) -> ActText:
    """The act from a text source (Word, HTML): no pages, no reconciliation, same structure and rendering.

    `cut_header` removes a title block (agency, «ФЕДЕРАЛЬНЫЙ ЗАКОН», title) that the portal identity replaces.
    """
    from .legal_reconcile import strip_header_marker

    cleaned = clean_marker_markdown(markdown)
    body, removed = strip_header_marker(cleaned, identity) if cut_header else (cleaned, None)
    blocks = structure(merge_pages([parse_blocks(body, 0)]), identity, first_page=0)
    provenance: list[dict[str, Any]] = [
        {
            "page": None,
            "reading": "text-source",
            "status": "pass",
            "confidence": "high",
            "flags": []
            if removed is not None or not cut_header
            else [{"kind": "header-not-found", "detail": "no header cut"}],
            "headerRemoved": removed,
        }
    ]
    return ActText(render_blocks(blocks), provenance, [], blocks)


def read_marker_pages(directory: Path, count: int) -> dict[int, str | None]:
    pages: dict[int, str | None] = {}
    for page in range(1, count + 1):
        path = directory / f"p{page:04d}.md"
        pages[page] = path.read_text(encoding="utf-8") if path.exists() else None
    return pages


def _row_index_lines(lines: list[dict[str, Any]]) -> list[str]:
    """Vision's lines as text; the integers in the left margin of a table are row numbers («12» → «12.»).

    A table's first column is a row index; Vision often drops its full stop, which would make it look like a
    quantity. Three or more lone integers in the left fifth of the page, in increasing order, are indexes.
    """
    texts = [str(line["text"]) for line in lines]
    margin = [
        i
        for i, line in enumerate(lines)
        if re.fullmatch(r"\d{1,3}\.?", str(line["text"]).strip()) and line["bbox"][0] < 0.2
    ]
    values = [int(re.sub(r"\D", "", texts[i])) for i in margin]
    if len(margin) >= 3 and sum(1 for a, b in pairwise(values) if b > a) >= len(values) - 2:
        for i in margin:
            texts[i] = texts[i].strip().rstrip(".") + "."
    return texts


def read_vision_pages(path: Path) -> dict[int, list[str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {int(page["page"]): _row_index_lines(page.get("lines", [])) for page in payload["pages"]}


def identity_from_file(path: Path) -> ActIdentity:
    return act_identity(json.loads(path.read_text(encoding="utf-8")))


__all__ = [
    "ActText",
    "Block",
    "Correction",
    "CorrectionError",
    "Review",
    "apply_corrections",
    "build_act_text",
    "build_text_source_act",
    "identity_from_file",
    "merge_pages",
    "parse_blocks",
    "read_marker_pages",
    "read_vision_pages",
    "reconcile_act",
    "render_blocks",
    "structure",
    "title_for",
]
