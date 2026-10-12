"""HTML fragments to clean Markdown for the personal-use reference modules.

The sources of the lab and TNM modules keep rich text as HTML fragments (paragraphs, hand-wrapped
lines, bold run-in headings, lists and tables with rowspan/colspan). The converter here is
deliberately small and lossless in content: it never drops, reorders or rewrites words. What it
does change is layout only:

* hard line wraps (a ``<br>`` or ``</p><p>`` inside a sentence: the previous line has no closing
  punctuation and the next one starts in lower case) are joined with a space;
* other breaks become separate paragraphs; lines that were indented with several ``&nbsp;`` become
  list items;
* tables become GFM tables; a rowspan/colspan cell is repeated in every column and row it covers;
  a row of one cell spanning the whole table before the first row becomes a caption; when the first
  row is not a header (every cell bold or ``<th>``) the GFM header row is left empty rather than
  invented. A table that cannot be converted faithfully (ragged rows, nested tables) is marked in
  the text and with a ``localmed:review`` marker instead of being repaired.

Plain-text fields (no tags) go through the same line/paragraph rules.
"""

from __future__ import annotations

import html
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from html.parser import HTMLParser

TABLE_PIECE_LIMIT = 2800
"""Largest paragraph (characters) emitted for a table or list; the chunker splits at 3200."""

_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_SPACES = re.compile(r"[ \t\r\n\f\v ]+")
_TERMINAL = ".!?:;"
_BLOCK_TAGS = frozenset({"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"})
_UNDERSCORE = re.compile(r"(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])")
_BLOCK_START = re.compile(r"^(?:#{1,6}\s|>|[-+]\s)")
_BULLET_ENDING = re.compile(r"[,;]\s*$")


def looks_like_html(value: str) -> bool:
    return _TAG.search(value) is not None


def escape_markdown(value: str) -> str:
    """Escape what would turn source text into Markdown or HTML markup."""
    escaped = value.replace("\\", "\\\\")
    for character in ("*", "`", "$", "~"):
        escaped = escaped.replace(character, "\\" + character)
    escaped = _UNDERSCORE.sub(r"\\_", escaped)
    return re.sub(r"<(?=[A-Za-z/!])", r"\\<", escaped)


def collapse_spaces(value: str) -> str:
    return _SPACES.sub(" ", value).strip()


def html_text(value: str) -> str:
    """Tags removed, entities decoded, whitespace collapsed; no Markdown (names, titles)."""
    parser = _TextOnly()
    parser.feed(value)
    parser.close()
    return collapse_spaces("".join(parser.parts))


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag == "br" or tag in _BLOCK_TAGS:
            self.parts.append(" ")


@dataclass
class _Line:
    markdown: str
    visible: str
    indented: bool = False
    bold: bool = False


Run = tuple[str, bool, bool]


class _Collector:
    """Lines of one text container (page body, list item, table cell)."""

    def __init__(self) -> None:
        self.lines: list[_Line] = []
        self._runs: list[Run] = []
        self._indented = False

    def add(self, data: str, bold: bool, italic: bool) -> None:
        if not self._runs and not self._indented:
            leading = len(data) - len(data.lstrip(" \t\r\n "))
            if data[:leading].count(" ") >= 2:
                self._indented = True
        text = _SPACES.sub(" ", data)
        if text:
            self._runs.append((text, bold, italic))

    def end_line(self) -> None:
        line = _render_line(self._runs, self._indented)
        self._runs = []
        self._indented = False
        if line is not None:
            self.lines.append(line)

    def take(self) -> list[_Line]:
        self.end_line()
        lines, self.lines = self.lines, []
        return lines


def _render_line(runs: Sequence[Run], indented: bool) -> _Line | None:
    merged: list[Run] = []
    for text, bold, italic in runs:
        if merged and merged[-1][1:] == (bold, italic):
            merged[-1] = (merged[-1][0] + text, bold, italic)
        else:
            merged.append((text, bold, italic))
    pieces: list[str] = []
    for text, bold, italic in merged:
        escaped = escape_markdown(text)
        core = escaped.strip()
        if not core or not (bold or italic):
            pieces.append(escaped)
            continue
        lead = escaped[: len(escaped) - len(escaped.lstrip())]
        trail = escaped[len(escaped.rstrip()) :]
        mark = "***" if bold and italic else "**" if bold else "*"
        pieces.append(f"{lead}{mark}{core}{mark}{trail}")
    markdown = collapse_spaces("".join(pieces))
    visible = collapse_spaces("".join(text for text, _bold, _italic in merged))
    if not visible:
        return None
    all_bold = all(bold for text, bold, _italic in merged if text.strip())
    return _Line(markdown, visible, indented, all_bold)


_FIRST_WORD = re.compile(r"\w+")


def _starts_lower(line: _Line) -> bool:
    word = _FIRST_WORD.match(line.visible)
    return word is not None and word.group(0).islower()


def _wraps(previous: _Line, following: _Line) -> bool:
    """A soft wrap: the previous line has no closing punctuation, the next one starts lower case."""
    return previous.visible[-1] not in _TERMINAL + '»"' and _starts_lower(following)


def merge_wrapped(lines: Sequence[_Line]) -> list[_Line]:
    merged: list[_Line] = []
    for line in lines:
        if merged and _wraps(merged[-1], line):
            last = merged[-1]
            merged[-1] = _Line(
                f"{last.markdown} {line.markdown}",
                f"{last.visible} {line.visible}",
                last.indented,
                last.bold and line.bold,
            )
        else:
            merged.append(line)
    return merged


def join_lines(lines: Sequence[_Line]) -> str:
    """One line of text for a list item or a table cell; real breaks become ``; ``."""
    parts: list[str] = []
    previous: _Line | None = None
    for line in merge_wrapped(lines):
        if previous is not None:
            parts.append(" " if previous.visible[-1] in _TERMINAL else "; ")
        parts.append(line.markdown)
        previous = line
    return "".join(parts)


@dataclass
class _Cell:
    lines: list[_Line] = field(default_factory=list[_Line])
    rowspan: int = 1
    colspan: int = 1
    header: bool = False

    @property
    def markdown(self) -> str:
        return join_lines(self.lines)

    @property
    def bold_only(self) -> bool:
        return self.header or (bool(self.lines) and all(line.bold for line in self.lines))


@dataclass
class _TextBlock:
    lines: list[_Line]


@dataclass
class _ListBlock:
    items: list[tuple[int, str, bool]]


@dataclass
class _TableBlock:
    rows: list[list[_Cell]]
    problems: list[str] = field(default_factory=list[str])


_Block = _TextBlock | _ListBlock | _TableBlock


def _span(attrs: list[tuple[str, str | None]], name: str) -> int:
    for key, value in attrs:
        if key == name and value and value.strip().isdigit():
            return min(max(int(value), 1), 100)
    return 1


class _Converter(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[_Block] = []
        self._top = _Collector()
        self._cur = self._top
        self._bold = 0
        self._italic = 0
        self._lists: list[str] = []
        self._list_items: list[tuple[int, str, bool]] = []
        self._item: _Collector | None = None
        self._table: _TableBlock | None = None
        self._row: list[_Cell] | None = None
        self._cell: _Cell | None = None
        self._cell_collector: _Collector | None = None
        self._nested = 0

    def _flush_text(self) -> None:
        lines = self._top.take()
        if lines:
            self.blocks.append(_TextBlock(lines))

    def _finish_item(self) -> None:
        if self._item is None:
            return
        ordered = bool(self._lists) and self._lists[-1] == "ol"
        lines = self._item.take()
        self._item = None
        if self._table is None and lines:
            self._list_items.append((len(self._lists), join_lines(lines), ordered))
        elif lines and self._cell_collector is not None:
            self._cell_collector.lines.extend(lines)
        self._cur = self._cell_collector or self._top

    def _finish_cell(self) -> None:
        if self._cell is not None and self._cell_collector is not None and self._row is not None:
            self._cell.lines = self._cell_collector.take()
            self._row.append(self._cell)
        self._cell = None
        self._cell_collector = None
        self._cur = self._top

    def _finish_row(self) -> None:
        self._finish_cell()
        if self._row is not None and self._table is not None:
            self._table.rows.append(self._row)
        self._row = None

    def _finish_table(self) -> None:
        self._finish_row()
        if self._table is not None:
            self.blocks.append(self._table)
        self._table = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            if self._table is not None:
                self._nested += 1
                if "nested-table" not in self._table.problems:
                    self._table.problems.append("nested-table")
                self._cur.end_line()
                return
            self._flush_text()
            self._table = _TableBlock([])
        elif tag == "tr":
            if self._table is not None and self._nested == 0:
                self._finish_row()
                self._row = []
            elif self._table is not None:
                self._cur.end_line()
        elif tag in ("td", "th"):
            if self._table is not None and self._nested == 0:
                if self._row is None:
                    self._row = []
                self._finish_cell()
                self._cell = _Cell(
                    rowspan=_span(attrs, "rowspan"),
                    colspan=_span(attrs, "colspan"),
                    header=tag == "th",
                )
                self._cell_collector = _Collector()
                self._cur = self._cell_collector
            elif self._table is not None:
                self._cur.end_line()
        elif tag in _BLOCK_TAGS:
            if self._table is not None or self._item is not None:
                self._cur.end_line()
            else:
                self._flush_text()
        elif tag == "br":
            self._cur.end_line()
        elif tag in ("strong", "b"):
            self._bold += 1
        elif tag in ("em", "i"):
            self._italic += 1
        elif tag == "sup":
            self._cur.add("^", False, False)
        elif tag in ("ul", "ol"):
            self._finish_item()
            if self._table is not None:
                self._cur.end_line()
            else:
                if not self._lists:
                    self._flush_text()
                self._lists.append(tag)
        elif tag == "li":
            self._finish_item()
            if self._table is not None:
                self._cur.end_line()
            else:
                self._item = _Collector()
                self._cur = self._item

    def handle_endtag(self, tag: str) -> None:
        if tag == "table":
            if self._nested:
                self._nested -= 1
                self._cur.end_line()
            else:
                self._finish_table()
        elif tag == "tr":
            if self._nested:
                self._cur.end_line()
            else:
                self._finish_row()
        elif tag in ("td", "th"):
            if self._nested:
                self._cur.end_line()
            else:
                self._finish_cell()
        elif tag in _BLOCK_TAGS:
            if self._table is not None or self._item is not None:
                self._cur.end_line()
            else:
                self._flush_text()
        elif tag in ("strong", "b"):
            self._bold = max(self._bold - 1, 0)
        elif tag in ("em", "i"):
            self._italic = max(self._italic - 1, 0)
        elif tag in ("ul", "ol"):
            self._finish_item()
            if self._lists and self._table is None:
                self._lists.pop()
                if not self._lists and self._list_items:
                    self.blocks.append(_ListBlock(self._list_items))
                    self._list_items = []
        elif tag == "li":
            self._finish_item()

    def handle_data(self, data: str) -> None:
        self._cur.add(data, self._bold > 0, self._italic > 0)

    def finish(self) -> list[_Block]:
        self.close()
        self._finish_item()
        if self._table is not None:
            self._table.problems.append("unclosed-table")
            self._finish_table()
        if self._list_items:
            self.blocks.append(_ListBlock(self._list_items))
            self._list_items = []
        self._flush_text()
        return self.blocks


@dataclass
class Conversion:
    """Markdown paragraphs (blank-line separated blocks) and what had to be flagged."""

    blocks: list[str] = field(default_factory=list[str])
    tables: int = 0
    merged_cells: int = 0
    problems: list[str] = field(default_factory=list[str])

    def extend(self, other: Conversion) -> None:
        self.blocks.extend(other.blocks)
        self.tables += other.tables
        self.merged_cells += other.merged_cells
        self.problems.extend(other.problems)


def _protect(markdown: str) -> str:
    return "\\" + markdown if _BLOCK_START.match(markdown) else markdown


def _text_paragraphs(lines: Sequence[_Line]) -> list[str]:
    out: list[str] = []
    bullets: list[str] = []
    merged = merge_wrapped(lines)
    for index, line in enumerate(merged):
        if line.indented and index > 0:
            bullets.append("- " + line.markdown)
            continue
        if bullets:
            out.extend(split_lines(bullets))
            bullets = []
        out.append(_protect(line.markdown))
    if bullets:
        out.extend(split_lines(bullets))
    return out


def split_lines(lines: Sequence[str], limit: int = TABLE_PIECE_LIMIT) -> list[str]:
    """Group whole lines into paragraphs of at most ``limit`` characters."""
    pieces: list[str] = []
    current: list[str] = []
    size = 0
    for line in lines:
        if current and size + len(line) + 1 > limit:
            pieces.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        pieces.append("\n".join(current))
    return pieces


def _list_paragraphs(items: Sequence[tuple[int, str, bool]]) -> list[str]:
    lines: list[str] = []
    counters: dict[int, int] = {}
    for depth, text, ordered in items:
        indent = "  " * (depth - 1)
        if ordered:
            counters[depth] = counters.get(depth, 0) + 1
            lines.append(f"{indent}{counters[depth]}. {text}")
        else:
            counters[depth] = 0
            lines.append(f"{indent}- {text}")
    return split_lines(lines)


def _grid(table: _TableBlock) -> tuple[list[list[_Cell | None]], int, bool]:
    """Expand rowspan/colspan: the covered positions hold the same cell (it is repeated)."""
    rows: list[list[_Cell | None]] = []
    carried: dict[tuple[int, int], _Cell] = {}
    width = 0
    merged = 0
    for r, source in enumerate(table.rows):
        row: list[_Cell | None] = []
        column = 0

        def fill_carried(r: int = r, row: list[_Cell | None] = row) -> None:
            while (r, len(row)) in carried:
                row.append(carried.pop((r, len(row))))

        fill_carried()
        for cell in source:
            fill_carried()
            if cell.rowspan > 1 or cell.colspan > 1:
                merged += 1
            for offset in range(cell.colspan):
                column = len(row)
                row.append(cell)
                for down in range(1, cell.rowspan):
                    carried[(r + down, column)] = cell
                del offset
        fill_carried()
        if not source:
            # A source row without cells only repeats spanned cells; HTML shows it as one row.
            continue
        rows.append(row)
        width = max(width, len(row))
    ragged = any(len(row) != width for row in rows)
    return rows, merged, ragged


def _cell_markdown(cell: _Cell | None) -> str:
    return "" if cell is None else cell.markdown.replace("|", "\\|")


def _table_paragraphs(table: _TableBlock, conversion: Conversion) -> list[str]:
    grid, merged, ragged = _grid(table)
    conversion.tables += 1
    conversion.merged_cells += merged
    problems = list(table.problems)
    if ragged:
        problems.append("ragged-rows")
    rows = [row for row in grid if any(cell is not None and cell.markdown for cell in row)]
    if not rows:
        return []
    width = max(len(row) for row in rows)
    caption: list[str] = []
    first = rows[0]
    if (
        len(rows) > 1
        and width > 1
        and len(first) == width
        and all(cell is first[0] for cell in first)
        and first[0] is not None
    ):
        caption = [_protect(first[0].markdown)]
        rows = rows[1:]
    header_row = rows[0]
    has_header = len(rows) > 1 and all(
        cell is None or not cell.markdown or cell.bold_only for cell in header_row
    )
    cells = [[_cell_markdown(cell) for cell in row] + [""] * (width - len(row)) for row in rows]
    header = cells[0] if has_header else [""] * width
    body = cells[1:] if has_header else cells
    head = ["| " + " | ".join(header) + " |", "|" + " --- |" * width]
    lines = ["| " + " | ".join(row) + " |" for row in body]
    pieces = split_lines(lines, TABLE_PIECE_LIMIT - len("\n".join(head)))
    out = list(caption)
    if problems:
        reason = ", ".join(problems)
        conversion.problems.extend(f"table: {item}" for item in problems)
        out.append(f"<!-- localmed:review table converted with problems: {reason} -->")
        out.append(f"*Таблица источника преобразована неточно ({reason}).*")
    out.extend("\n".join([*head, piece]) for piece in pieces)
    if not pieces:
        out.append("\n".join(head))
    return out


def _convert_blocks(blocks: Sequence[_Block]) -> Conversion:
    conversion = Conversion()
    previous_text: _TextBlock | None = None
    merged_blocks: list[_Block] = []
    for block in blocks:
        if (
            isinstance(block, _TextBlock)
            and isinstance(previous_text, _TextBlock)
            and merged_blocks
            and merged_blocks[-1] is previous_text
            and _wraps(previous_text.lines[-1], block.lines[0])
        ):
            previous_text.lines.extend(block.lines)
            continue
        merged_blocks.append(block)
        previous_text = block if isinstance(block, _TextBlock) else None
    for block in merged_blocks:
        if isinstance(block, _TextBlock):
            conversion.blocks.extend(_text_paragraphs(block.lines))
        elif isinstance(block, _ListBlock):
            conversion.blocks.extend(_list_paragraphs(block.items))
        else:
            conversion.blocks.extend(_table_paragraphs(block, conversion))
    return conversion


def html_to_markdown(value: str) -> Conversion:
    parser = _Converter()
    parser.feed(value)
    return _convert_blocks(parser.finish())


def plain_to_markdown(value: str) -> Conversion:
    """Plain text with line breaks: each line is a paragraph unless it is a wrapped line; lines
    that end in a comma or semicolon form a list."""
    text = html.unescape(value).replace(" ", " ")
    lines: list[_Line] = []
    for raw in text.splitlines():
        stripped = collapse_spaces(raw)
        if stripped:
            lines.append(_Line(escape_markdown(stripped), stripped))
    conversion = Conversion()
    if (
        len(lines) >= 2
        and sum(bool(_BULLET_ENDING.search(line.visible)) for line in lines[:-1]) * 2
        >= len(lines) - 1
    ):
        items = [
            "- " + _BULLET_ENDING.sub("", line.markdown).rstrip()
            for line in lines
            if _BULLET_ENDING.sub("", line.visible).strip()
        ]
        conversion.blocks.extend(split_lines(items))
        return conversion
    conversion.blocks.extend(_text_paragraphs(lines))
    return conversion


def plain_inline(value: str | None) -> str:
    """Plain (or HTML) text on one escaped line; real line breaks become ``; `` (table cells)."""
    if value is None or not value.strip():
        return ""
    if looks_like_html(value):
        parser = _Converter()
        parser.feed(value)
        lines = [
            line
            for block in parser.finish()
            if isinstance(block, _TextBlock)
            for line in block.lines
        ]
        return join_lines(lines)
    text = html.unescape(value).replace("\u00a0", " ")
    lines = [
        _Line(escape_markdown(stripped), stripped)
        for stripped in (collapse_spaces(raw) for raw in text.splitlines())
        if stripped
    ]
    return join_lines(lines)


def field_to_markdown(value: str | None) -> Conversion:
    """Markdown blocks of a source text field, HTML or plain."""
    if value is None or not value.strip():
        return Conversion()
    return html_to_markdown(value) if looks_like_html(value) else plain_to_markdown(value)


def table_lines(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    """GFM table paragraphs for synthetic tables (cells are escaped here); long tables are split
    into pieces that repeat the header, so the chunker never cuts a row."""
    width = len(header)
    head = ["| " + " | ".join(header) + " |", "|" + " --- |" * width]
    lines = ["| " + " | ".join(cell.replace("|", "\\|") for cell in row) + " |" for row in rows]
    pieces = split_lines(lines, TABLE_PIECE_LIMIT - len("\n".join(head)))
    return ["\n".join([*head, piece]) for piece in pieces]
