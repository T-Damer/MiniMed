"""Markdown of a page of a PDF that has a text layer (LEGAL1): exact text and ruled tables, no recognition.

Two of the acts come as text-layer PDFs from minzdrav.gov.ru. Their text needs no OCR; what Marker adds there is
structure, and it gets tables wrong (extra columns, split cells). PyMuPDF reads the ruled tables from the file's
own drawing and text, so a page is rebuilt from them: paragraphs (lines joined, a new one at a list number or a
bold line), bold-only lines as headings, tables as Markdown. The result takes the place of Marker's page in the
same reconciliation against Vision's reading of the rendered page.
"""

from __future__ import annotations

import re
from typing import Any, Final, cast

import pymupdf

_ITEM: Final = re.compile(r"^(?:\d{1,3}(?:\.\d+)*[.)]\s|[а-яa-z]\)\s|[-•]\s)")


def _cell(value: object) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", " ".join(part.strip() for part in text.split("\n") if part.strip()))


def _table_markdown(rows: list[list[object]]) -> str:
    cleaned = [[_cell(c) for c in row] for row in rows]
    cleaned = [row for row in cleaned if any(row)]
    if not cleaned:
        return ""
    width = max(len(row) for row in cleaned)
    cleaned = [row + [""] * (width - len(row)) for row in cleaned]
    # a column that is empty in every row is a layout artefact of the grid
    keep = [i for i in range(width) if any(row[i] for row in cleaned)]
    cleaned = [[row[i] for i in keep] for row in cleaned]
    lines = ["| " + " | ".join(c.replace("\n", "⏎").replace("|", "\\|") for c in cleaned[0]) + " |"]
    lines.append("| " + " | ".join("---" for _ in cleaned[0]) + " |")
    lines.extend(
        "| " + " | ".join(c.replace("\n", "⏎").replace("|", "\\|") for c in row) + " |"
        for row in cleaned[1:]
    )
    return "\n".join(lines)


def _is_bold(span: dict[str, Any]) -> bool:
    return bool(int(span["flags"]) & 16) or "bold" in str(span["font"]).lower()


def page_markdown(page: pymupdf.Page) -> str:
    """The page as Markdown, top to bottom."""
    finder = page.find_tables()
    tables = list(finder.tables) if finder is not None else []
    boxes = [pymupdf.Rect(t.bbox) for t in tables]
    pieces: list[tuple[float, str]] = []
    for table, box in zip(tables, boxes, strict=True):
        pieces.append((box.y0, _table_markdown(table.extract())))
    paragraphs: list[tuple[float, list[str]]] = []
    layout = cast("dict[str, Any]", page.get_text("dict"))
    for block in layout["blocks"]:
        if block["type"] != 0:
            continue
        rect = pymupdf.Rect(block["bbox"])
        if any(
            rect.intersects(box) and (rect & box).get_area() > 0.5 * rect.get_area()
            for box in boxes
        ):
            continue
        lines: list[str] = []
        bold_all = True
        for line in block["lines"]:
            text = "".join(span["text"] for span in line["spans"]).strip()
            if not text:
                continue
            line_rect = pymupdf.Rect(line["bbox"])
            if any(
                line_rect.intersects(box)
                and (line_rect & box).get_area() > 0.3 * line_rect.get_area()
                for box in boxes
            ):
                continue  # the last line of a table cell that overflows the drawn cell
            lines.append(text)
            bold_all = bold_all and all(_is_bold(s) for s in line["spans"] if s["text"].strip())
        if not lines:
            continue
        current: list[str] = []
        groups: list[list[str]] = []
        for text in lines:
            if _ITEM.match(text) and current:
                groups.append(current)
                current = []
            current.append(text)
        groups.append(current)
        for group in groups:
            joined = re.sub(r"\s+", " ", " ".join(group)).strip()
            joined = re.sub(r"(?<=[а-яё])- (?=[а-яё])", "-", joined)
            paragraphs.append(
                (rect.y0, [f"**{joined}**" if bold_all and len(joined) < 260 else joined])
            )
    for y, parts in paragraphs:
        pieces.append((y, parts[0]))
    pieces.sort(key=lambda item: item[0])
    return "\n\n".join(text for _y, text in pieces if text)


def document_pages(path: str) -> dict[int, str]:
    document = pymupdf.open(path)
    return {
        index + 1: page_markdown(document.load_page(index)) for index in range(document.page_count)
    }


__all__ = ["document_pages", "page_markdown"]
