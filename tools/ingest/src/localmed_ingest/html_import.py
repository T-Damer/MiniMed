from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

from .models import (
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionDiagnostics,
)
from .normalization import normalize_surface_text
from .pdf_import import sha256_file

_SPACE_PATTERN = re.compile(r"\s+")
_SECTION_HEADING_PATTERN = re.compile(r"^\s*\d+(?:\.\d+)*\.?\s+\S")
_START_MARKERS = (
    "краткая информация",
    "определение заболевания",
    "определение состояния",
)
_STOP_MARKERS = (
    "читайте также",
    "материалы по теме",
    "комментарии",
    "поделиться",
    "обратная связь",
)
_IGNORED_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "form", "button"}
_BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6"}


def _clean_text(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value.replace("\xa0", " ")).strip()


class _ClinicalHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, int | None, str]] = []
        self._ignored_depth = 0
        self._current_tag: str | None = None
        self._current_parts: list[str] = []
        self._table_depth = 0
        self._table_rows: list[list[str]] = []
        self._table_row: list[str] | None = None
        self._table_cell_parts: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        lowered = tag.lower()
        if lowered in _IGNORED_TAGS:
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if lowered == "table":
            self._flush_block()
            self._table_depth += 1
            if self._table_depth == 1:
                self._table_rows = []
            return
        if self._table_depth:
            if lowered == "tr":
                self._table_row = []
            elif lowered in {"td", "th"}:
                self._table_cell_parts = []
            elif lowered == "br" and self._table_cell_parts is not None:
                self._table_cell_parts.append(" ")
            return
        if lowered in _BLOCK_TAGS:
            self._flush_block()
            self._current_tag = lowered
            self._current_parts = []
        elif lowered == "br" and self._current_tag is not None:
            self._current_parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in _IGNORED_TAGS:
            if self._ignored_depth:
                self._ignored_depth -= 1
            return
        if self._ignored_depth:
            return
        if self._table_depth:
            if lowered in {"td", "th"} and self._table_cell_parts is not None:
                cell = _clean_text("".join(self._table_cell_parts))
                if self._table_row is not None:
                    self._table_row.append(cell)
                self._table_cell_parts = None
            elif lowered == "tr" and self._table_row is not None:
                if any(self._table_row):
                    self._table_rows.append(self._table_row)
                self._table_row = None
            elif lowered == "table":
                self._table_depth -= 1
                if self._table_depth == 0:
                    rows = [" | ".join(cell for cell in row if cell) for row in self._table_rows]
                    table_text = "\n".join(row for row in rows if row)
                    if table_text:
                        self.blocks.append(("table_candidate", None, table_text))
                    self._table_rows = []
            return
        if self._current_tag == lowered:
            self._flush_block()

    def handle_data(self, data: str) -> None:
        if self._ignored_depth:
            return
        if self._table_depth and self._table_cell_parts is not None:
            self._table_cell_parts.append(data)
            return
        if self._current_tag is not None:
            self._current_parts.append(data)

    def close(self) -> None:
        self._flush_block()
        super().close()

    def _flush_block(self) -> None:
        if self._current_tag is None:
            return
        text = _clean_text("".join(self._current_parts))
        tag = self._current_tag
        self._current_tag = None
        self._current_parts = []
        if not text:
            return
        if tag.startswith("h") and tag[1:].isdigit():
            self.blocks.append(("heading", min(6, max(1, int(tag[1:]))), text))
        elif tag == "li":
            self.blocks.append(("list", None, f"- {text}"))
        else:
            self.blocks.append(("paragraph", None, text))


def _select_clinical_blocks(
    blocks: list[tuple[str, int | None, str]],
) -> tuple[list[tuple[str, int | None, str]], list[str]]:
    warnings: list[str] = []
    start_index: int | None = None
    for index, (kind, _level, text) in enumerate(blocks):
        normalized = normalize_surface_text(text).rstrip(".:")
        if kind == "heading" and (
            _SECTION_HEADING_PATTERN.match(text)
            or any(marker in normalized for marker in _START_MARKERS)
        ):
            start_index = index
            break
    if start_index is None:
        start_index = next(
            (index for index, (kind, _level, _text) in enumerate(blocks) if kind == "heading"),
            0,
        )
        warnings.append("The clinical content start was inferred from the first heading.")

    selected: list[tuple[str, int | None, str]] = []
    seen: set[tuple[str, str]] = set()
    for kind, level, text in blocks[start_index:]:
        normalized = normalize_surface_text(text).rstrip(".:")
        if kind == "heading" and any(marker == normalized for marker in _STOP_MARKERS):
            break
        if len(text) < 2:
            continue
        signature = (kind, normalized)
        if signature in seen:
            continue
        seen.add(signature)
        selected.append((kind, level, text))
    return selected, warnings


def extract_html(source: Path) -> ExtractedSource:
    raw = source.read_text(encoding="utf-8-sig")
    parser = _ClinicalHtmlParser()
    parser.feed(raw)
    parser.close()
    selected, warnings = _select_clinical_blocks(parser.blocks)

    blocks = [
        ExtractedBlock(
            id=f"html-b{index + 1}",
            page=None,
            order_index=index,
            kind=kind,  # type: ignore[arg-type]
            text=text,
            heading_level=level,
            line_count=max(1, text.count("\n") + 1),
            metadata={"domOrder": index + 1},
        )
        for index, (kind, level, text) in enumerate(selected)
    ]
    character_count = sum(len(block.text) for block in blocks)
    heading_count = sum(block.kind == "heading" for block in blocks)
    table_count = sum(block.kind == "table_candidate" for block in blocks)
    reasons: list[str] = []
    if character_count < 5_000:
        reasons.append("Extracted HTML is unexpectedly short for a full clinical recommendation.")
    if heading_count < 3:
        reasons.append("Too few clinical section headings were detected in HTML.")
    if not blocks:
        reasons.append("No clinical content blocks were extracted from HTML.")

    quality_score = 1.0
    if character_count < 5_000:
        quality_score -= 0.4
    if heading_count < 3:
        quality_score -= 0.25
    if warnings:
        quality_score -= 0.1
    checksum = sha256_file(source)
    page = ExtractedPage(
        page=1,
        width=1.0,
        height=1.0,
        blocks=blocks,
        character_count=character_count,
        low_text=character_count < 40,
    )
    diagnostics = ExtractionDiagnostics(
        source_checksum=checksum,
        source_format="html",
        page_count=0,
        block_count=len(parser.blocks),
        included_block_count=len(blocks),
        character_count=character_count,
        low_text_pages=[],
        removed_repeated_blocks=max(0, len(parser.blocks) - len(blocks)),
        heading_candidates=heading_count,
        table_candidates=table_count,
        body_font_size=None,
        quality_score=max(0.0, min(1.0, quality_score)),
        requires_review=bool(reasons or warnings),
        review_reasons=reasons,
        warnings=[
            "HTML sources do not provide reliable page coordinates.",
            *warnings,
        ],
    )
    return ExtractedSource(
        source_file=source.name,
        source_checksum=checksum,
        source_format="html",
        pages=[page],
        diagnostics=diagnostics,
    )
