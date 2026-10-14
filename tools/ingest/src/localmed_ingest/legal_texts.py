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
_BOLD_ONLY: Final = re.compile(r"^\*\*(.+?)\*\*$|^__(?!_)(.+?)(?<!_)__$")
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
_SUPERSCRIPT_DIGITS: Final = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")


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
                # a row without any text under a table that has text rows is a layout artefact of a merged cell;
                # a blank form grid (every body row empty) is kept as it is
                if any(any(cell for cell in row) for row in rows[1:]):
                    rows = [rows[0], *[row for row in rows[1:] if any(cell for cell in row)]]
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


def _open_table(merged: list[Block]) -> Block | None:
    """The table a new page may continue: the last block, ignoring the footnotes printed under it."""
    index = len(merged) - 1
    while index >= 0 and merged[index].kind == "footnote":
        index -= 1
    if index >= 0 and merged[index].kind == "table":
        return merged[index]
    return None


def _table_head(head: Block, table: Block) -> bool:
    """Whether `head` (the first block of a page) continues `table`; a continuation that lost up to two empty
    trailing columns (every row's last cell is empty) is padded back to the table's width."""
    if head.kind != "table" or not head.rows or not table.rows:
        return False
    missing = len(table.rows[0]) - len(head.rows[0])
    if (
        0 < missing <= 2
        and all(len(row) == len(head.rows[0]) for row in head.rows)
        and all(not row[-1] for row in head.rows)
    ):
        head.rows = [[*row, *([""] * missing)] for row in head.rows]
    return _same_width(table, head)


def _cell_key(cell: str) -> str:
    return re.sub(r"[\s\-–]+", "", cell.lower().translate(_SUPERSCRIPT_DIGITS))


def _repeated_header_rows(previous: list[list[str]], rows: list[list[str]]) -> int:
    """How many leading rows of a continued table repeat the table's printed header (same cells, spacing aside)."""
    count = 0
    for old, new in zip(previous, rows, strict=False):
        if [_cell_key(cell) for cell in old] != [_cell_key(cell) for cell in new]:
            break
        count += 1
    return count


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
            elif (table_tail := _open_table(merged)) is not None and _table_head(head, table_tail):
                rows = head.rows[_repeated_header_rows(table_tail.rows, head.rows) :]
                moved = _continues_row(table_tail.rows[-1], rows[0]) if rows else None
                if rows and moved is not None:
                    last = table_tail.rows[-1]
                    last[moved[1]] = f"{last[moved[1]]} {rows[0][moved[0]]}".strip()
                    rows = rows[1:]
                elif rows and _continues_cells(table_tail.rows[-1], rows[0]):
                    last = table_tail.rows[-1]
                    for index, cell in enumerate(rows[0]):
                        if cell:
                            last[index] = f"{last[index]}\n{cell}"
                    rows = rows[1:]
                table_tail.rows.extend(rows)
                table_tail.end_page = head.page
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


def _continues_cells(previous: list[str], row: list[str]) -> bool:
    """A row at the head of a page that carries the rest of the previous row's cells (a row cut by the break).

    The first cell is empty; every filled cell lines up with an open cell (text that does not end a sentence)
    of the previous row; and the previous row is a numbered one (a label such as «Необходимые знания» spans
    several item rows and does not count), or the new text starts in lower case.
    """
    if len(previous) != len(row) or row[0] or not any(row):
        return False
    filled = [index for index, cell in enumerate(row) if cell]
    for index in filled:
        before = previous[index]
        if not before or len(before) < 4 or _TERMINAL.search(before.rstrip()):
            return False
    lower = all(row[index][:1].islower() for index in filled)
    return bool(re.fullmatch(r"\d{1,3}[.)]?", previous[0].strip())) or lower


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
            top_of_page = index == 0 or blocks[index - 1].page != block.page
            if top_of_page and follow is not None and follow.kind == "paragraph":
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
        starts_page = index == 0 or blocks[index - 1].page != block.page
        if block.kind == "paragraph" and (
            _ANNEX.match(text) or (_APPROVED.match(text) and starts_page)
        ):
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
            elif _ROMAN.match(text):
                level = 2  # «II. Формирование …»: the chapters of an order share one level whatever Marker set
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
        if (
            block.kind == "heading"
            and previous is not None
            and previous.kind == "heading"
            and block.level
            <= previous.level  # a deeper heading is a subsection of the title before it
        ):
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
    unfit: list[str] = field(default_factory=list)
    """Requirement blocks whose rows could not be labelled (a review item)."""


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


_WRAPPED: Final = re.compile(r"(?<![\w-])([а-яё]{3,})-([а-яё]{2,})(?![\w-])", re.IGNORECASE)


def rejoin_wrapped_words(blocks: list[Block]) -> int:
    """Join the words a printed line wrap split with a hyphen («медицинс-ким», «классифи-кации»).

    A hyphenated pair is joined only when the act itself prints the joined word somewhere else:
    «врача-специалиста» stays (nobody prints «врачаспециалиста»), «медицинс-ким» becomes «медицинским».
    """
    texts: list[str] = []
    for block in blocks:
        texts.append(block.text)
        for row in block.rows:
            texts.extend(row)
    corpus = "\n".join(texts)
    words = {word.lower() for word in re.findall(r"[а-яё]+", corpus, re.IGNORECASE)}
    joined_count = 0

    def join(match: re.Match[str]) -> str:
        nonlocal joined_count
        if (match.group(1) + match.group(2)).lower() in words:
            joined_count += 1
            return match.group(1) + match.group(2)
        return match.group(0)

    for block in blocks:
        block.text = _WRAPPED.sub(join, block.text)
        block.rows = [[_WRAPPED.sub(join, cell) for cell in row] for row in block.rows]
    return joined_count


_SPECIALTY_LINE: Final = re.compile(r"^(?:#{1,6}\s*)?\*{0,2}(Специальность\s+«.+?»)\*{0,2}\s*$")


def label_rows_markdown(text: str, labels: tuple[str, ...]) -> str:
    """One layout for the labelled rows of a requirements act («Уровень профессионального образования», …).

    Marker reads the same two-column rows as a table, as «**Label** text», as «Label      text» or as a
    heading followed by the text; the page's text stays what it is, only the shape becomes one: a heading
    «Специальность «X»» and a paragraph «**Label.** text» per row. A row cut by a page break has its label cut
    too: the beginning on one page («Уровень») is completed to the label, which the act prints as one cell; the
    end on the next («профессионального образования») is dropped and its text continues the paragraph above.
    """
    lowered = [label.lower() for label in labels]

    def label_of(candidate: str, *, partial: bool) -> tuple[str, str] | None:
        """(label, 'whole' | 'head' | 'tail') for a cell that is a label or, with `partial`, a part of one."""
        plain = re.sub(r"[*#]", "", candidate).strip().rstrip(".:").lower()
        for label, low in zip(labels, lowered, strict=True):
            if plain == low:
                return label, "whole"
            if partial and len(plain) >= 6 and low.startswith(plain):
                return label, "head"
            if partial and len(plain) >= 8 and low.endswith(plain):
                return label, "tail"
        return None

    output: list[str] = []
    pending: tuple[str, str] | None = None

    def emit(found: tuple[str, str], value: str) -> None:
        label, part = found
        if part == "tail":
            output.extend(["", value, ""])
        else:
            output.extend(["", f"**{label}.** {value}".rstrip(), ""])

    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            output.append("")
            continue
        if _TABLE_SEPARATOR.match(stripped):
            continue
        specialty = _SPECIALTY_LINE.match(stripped)
        if specialty:
            pending = None
            output.extend(["", "### " + specialty.group(1), ""])
            continue
        if _TABLE_LINE.match(stripped):
            cells = _split_row(stripped)
            found = label_of(cells[0], partial=True) if cells else None
            if found and len(cells) >= 2:
                emit(found, "\n\n".join(part for part in cells[1].split("\n") if part))
                continue
        multispace = re.match(r"^(\*{0,2}[^|*]+?\*{0,2})\s{3,}(\S.*)$", stripped)
        if multispace and (found := label_of(multispace.group(1), partial=True)):
            emit(found, multispace.group(2))
            continue
        bold = re.match(r"^\*\*(.+?)\*\*\s*(\S.*)$", stripped)
        if bold and (found := label_of(bold.group(1), partial=True)):
            emit(found, bold.group(2))
            continue
        if re.match(r"^#{1,6}\s", stripped) or stripped.startswith("**"):
            found = label_of(stripped, partial=True)
            if found:
                pending = found
                continue
        if pending is not None:
            emit(pending, stripped)
            pending = None
            continue
        output.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(output))


def label_specialty_rows(blocks: list[Block]) -> list[str]:
    """Put the row labels back on a requirements act read without its label column (`legal_unlabel`).

    Under each «Специальность «X»» heading the paragraphs are the three rows of the table in order; the label of
    each paragraph comes from `row_labels`. A block that does not fit the pattern is left as it is and named in
    the result, so that the review sees it.
    """
    from .legal_unlabel import row_labels

    unfit: list[str] = []
    index = 0
    while index < len(blocks):
        block = blocks[index]
        if block.kind != "heading" or not block.text.startswith("Специальность «"):
            index += 1
            continue
        end = index + 1
        while end < len(blocks) and blocks[end].kind != "heading":
            end += 1
        members = [
            blocks[i]
            for i in range(index + 1, end)
            if blocks[i].kind == "paragraph" and not blocks[i].text.startswith("(")
        ]
        if any(m.text.startswith(("Уровень профессионального", "Должности.")) for m in members):
            index = end
            continue  # a block that kept its printed labels
        labels = row_labels([m.text for m in members])
        if labels is None:
            unfit.append(block.text)
        else:
            previous = ""
            for member, label in zip(members, labels, strict=True):
                if label != previous:
                    member.text = f"{label}. {member.text}"
                previous = label
        index = end
    return unfit


def build_act_text(
    results: list[PageResult], identity: ActIdentity, *, label_rows: tuple[str, ...] = ()
) -> ActText:
    pages: list[list[Block]] = []
    pending_pages: list[int] = []
    for result in results:
        reviewed = result.status == "reviewed"
        pending = result.status == "review"
        confidence = "low" if pending and result.confidence == "low" else result.confidence
        cleaned = clean_marker_markdown(result.text)
        if label_rows:
            cleaned = label_rows_markdown(cleaned, label_rows)
        blocks = parse_blocks(cleaned, result.page, confidence, reviewed)
        if pending and blocks:
            blocks[0].pending = [
                f"page {result.page}: " + ", ".join(sorted({f.kind for f in result.flags}))
            ]
            pending_pages.append(result.page)
        pages.append(blocks)
    blocks = structure(merge_pages(pages), identity)
    unfit_blocks = label_specialty_rows(blocks) if label_rows else []
    rejoin_wrapped_words(blocks)
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
    return ActText(body, provenance, pending_pages, blocks, unfit_blocks)


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
    "label_rows_markdown",
    "merge_pages",
    "parse_blocks",
    "read_marker_pages",
    "read_vision_pages",
    "reconcile_act",
    "render_blocks",
    "structure",
    "title_for",
]
