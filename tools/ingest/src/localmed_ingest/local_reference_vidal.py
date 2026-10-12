"""Personal-use Vidal drug reference, prepared from the MedElement «Справочник врача» database.

``vidal.db`` (Vidal drug reference, database version 28) is downloaded by the MedElement Android app
under MedElement's licence and shared with the project owner for personal use. It is therefore
**never** committed, packaged for a public catalog or uploaded: this module only reads the database
and writes a Markdown workspace into a gitignored directory
(``data/intermediate/local-reference/``); the CLI command refuses an output path that git does
not ignore.

One Markdown document per Vidal ``Document`` row (``drug.vidal.<DocumentID>``), source type
``allmed_reference`` like the Allmed snapshot: the same medication scope, the same standalone drug
card and the same ESKLP substance link (exact composition match; ``linkedMnnDocumentId``). The
document
text is the Vidal wording, converted from its HTML fragments to plain Markdown; nothing is
rewritten.
Conversion problems (flattened table spans, expanded source tokens, omitted images) are counted in
``conversionNotes`` of the document and in the preparation report.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from contextlib import closing
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import cast
from uuid import uuid4

import yaml
from pydantic import Field

from .allmed_reference import (
    EsklpMnnIdentity,
    build_esklp_mnn_crosswalk,
    composition_identity_keys,
    link_composition_to_esklp,
)
from .edition_manifest import sha256_file
from .models import CamelModel

MODULE_ID = "minimed.local.vidal.ru"
MODULE_TITLE = "Видаль (личное)"
SOURCE_KEY = "vidal"
SOURCE_SHORT_NAME = "Видаль"
RIGHTS_STATUS = "personal-use-only"
DOCUMENT_PREFIX = "drug.vidal."
CONTENT_MODE = "drug-reference-snapshot"
DEFAULT_DB_VERSION = 28
_BUILT_AT = "2026-10-12T00:00:00Z"
_MAPPING_METHOD = "normalized-ingredient-composition"

_REQUIRED_TABLES = (
    "Document",
    "Product",
    "Product_Document",
    "Molecule",
    "Molecule_Document",
    "ATC",
    "Product_ATC",
    "Company",
    "Product_Company",
    "Nozology",
    "Document_IndicNozology",
    "DocumentType",
    "Using",
    "PhThGroups",
    "Product_PhThGrp",
    "ClPhGroups",
    "Product_ClPhGroups",
)

# --------------------------------------------------------------------------------------------
# HTML fragment -> plain Markdown
# --------------------------------------------------------------------------------------------

_BR = "\x00"
_VOID_TAGS = frozenset({"br", "hr"})
_INLINE_TAGS = frozenset({"i", "b", "em", "strong", "u", "font", "span", "a", "small", "big"})
_BLOCK_TAGS = frozenset({"p", "div", "li", "ul", "ol", "table", "tr", "td", "th", "tbody", "thead"})
_SUPERSCRIPT = str.maketrans("0123456789+-−", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻")
_SUBSCRIPT = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
_SUPERSCRIPT_SET = frozenset("0123456789+-−")
# Vidal marks the start of the excipient list in a composition with this source token.
_SOURCE_TOKENS = (("[PRING]", "Вспомогательные вещества:"),)
_MAX_TABLE_CHARS = 2800
_MAX_PARAGRAPH_CHARS = 3000
_MARKDOWN_HEADING = re.compile(r"#{1,6}\s")
_READER_BULLET = re.compile(r"[*+]\s")
_ZERO_WIDTH_SPACE = "\u200b"
_MAX_HEADER_ROWS = 3


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=lambda: {})
    children: list[_Node | str] = field(default_factory=lambda: [])


class _TreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node("root")
        self._stack: list[_Node] = [self.root]

    def _node(self, tag: str, attrs: list[tuple[str, str | None]]) -> _Node:
        return _Node(tag.lower(), {key.lower(): value or "" for key, value in attrs})

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = self._node(tag, attrs)
        self._stack[-1].children.append(node)
        if node.tag not in _VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._stack[-1].children.append(self._node(tag, attrs))

    def handle_endtag(self, tag: str) -> None:
        name = tag.lower()
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == name:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self._stack[-1].children.append(data)


def _parse_html(fragment: str) -> _Node:
    builder = _TreeBuilder()
    builder.feed(fragment)
    builder.close()
    return builder.root


def _tidy(text: str) -> str:
    cleaned = text.replace("\xa0", " ").replace(" ", " ").replace("­", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _script(content: str, *, superscript: bool) -> str:
    """Sub-/superscript text; digits become Unicode scripts, the surrounding spaces are kept."""
    stripped = content.strip()
    if not stripped:
        return " " if content else ""
    lead = content[: len(content) - len(content.lstrip())]
    trail = content[len(content.rstrip()) :]
    if superscript and all(character in _SUPERSCRIPT_SET for character in stripped):
        stripped = stripped.translate(_SUPERSCRIPT)
    elif not superscript and stripped.isdigit():
        stripped = stripped.translate(_SUBSCRIPT)
    return f"{lead}{stripped}{trail}"


def _inline(nodes: Sequence[_Node | str], notes: Counter[str], *, br: str) -> str:
    parts: list[str] = []
    for node in nodes:
        if isinstance(node, str):
            parts.append(node)
            continue
        tag = node.tag
        if tag == "br":
            parts.append(br)
        elif tag == "sup":
            parts.append(_script(_inline(node.children, notes, br=br), superscript=True))
        elif tag == "sub":
            parts.append(_script(_inline(node.children, notes, br=br), superscript=False))
        elif tag == "img":
            notes["image-omitted"] += 1
        elif tag == "table":
            notes["nested-table-flattened"] += 1
            parts.append(" " + _inline(node.children, notes, br=br) + " ")
        elif tag in _BLOCK_TAGS:
            parts.append(" " + _inline(node.children, notes, br=br) + " ")
        else:
            if tag not in _INLINE_TAGS:
                notes[f"unknown-tag:{tag}"] += 1
            parts.append(_inline(node.children, notes, br=br))
    return "".join(parts)


def _is_bold_only(cell: _Node) -> bool:
    """True when everything the cell prints is inside <b>/<strong>."""

    def walk(nodes: Sequence[_Node | str], bold: bool) -> bool:
        for node in nodes:
            if isinstance(node, str):
                if node.strip() and not bold:
                    return False
            elif not walk(node.children, bold or node.tag in {"b", "strong"}):
                return False
        return True

    return walk(cell.children, False)


@dataclass
class _Cell:
    text: str
    bold: bool
    rowspan: int
    colspan: int


def _span(value: str | None) -> int:
    if value is None:
        return 1
    try:
        return max(1, int(value))
    except ValueError:
        return 1


def _table_rows(table: _Node) -> list[_Node]:
    rows: list[_Node] = []

    def walk(nodes: Sequence[_Node | str]) -> None:
        for node in nodes:
            if isinstance(node, str):
                continue
            if node.tag == "tr":
                rows.append(node)
            elif node.tag in {"tbody", "thead", "tfoot"}:
                walk(node.children)

    walk(table.children)
    return rows


def _escape_cell(text: str) -> str:
    return text.replace("\\", "\\\\").replace("|", "\\|")


def _table_block(table: _Node, notes: Counter[str]) -> list[str]:
    parsed_rows: list[list[_Cell]] = []
    for row in _table_rows(table):
        cells: list[_Cell] = []
        for cell in row.children:
            if isinstance(cell, str) or cell.tag not in {"td", "th"}:
                continue
            cells.append(
                _Cell(
                    text=_tidy(_inline(cell.children, notes, br="; ")).strip("; "),
                    bold=_is_bold_only(cell) or cell.tag == "th",
                    rowspan=_span(cell.attrs.get("rowspan")),
                    colspan=_span(cell.attrs.get("colspan")),
                )
            )
        if cells:
            parsed_rows.append(cells)
    if not parsed_rows:
        return []
    # Lay the cells out on a grid. A spanning cell prints in its first position; the covered
    # positions are blank in body rows and repeat the text in header rows (below).
    grid: list[dict[int, _Cell]] = [{} for _ in parsed_rows]
    covered: list[dict[int, _Cell]] = [{} for _ in parsed_rows]
    spans_used = False
    for row_index, cells in enumerate(parsed_rows):
        column = 0
        for cell in cells:
            while column in grid[row_index] or column in covered[row_index]:
                column += 1
            grid[row_index][column] = cell
            if cell.rowspan > 1 or cell.colspan > 1:
                spans_used = True
            for row_offset in range(cell.rowspan):
                target = row_index + row_offset
                if target >= len(parsed_rows):
                    break
                for column_offset in range(cell.colspan):
                    if row_offset == 0 and column_offset == 0:
                        continue
                    covered[target][column + column_offset] = cell
            column += cell.colspan
    width = max(
        (max([*row.keys(), *covered_row.keys()], default=-1) + 1)
        for row, covered_row in zip(grid, covered, strict=True)
    )
    if spans_used:
        notes["table-spans-flattened"] += 1

    def row_text(row_index: int, *, repeat: bool) -> list[str]:
        values: list[str] = []
        for column in range(width):
            cell = grid[row_index].get(column)
            if cell is not None:
                values.append(cell.text)
            elif repeat and column in covered[row_index]:
                values.append(covered[row_index][column].text)
            else:
                values.append("")
        return values

    if width == 1:
        items = [text for index in range(len(grid)) if (text := row_text(index, repeat=False)[0])]
        return ["\n".join(f"- {text}" for text in items)] if items else []

    header_rows = 0
    while header_rows < min(_MAX_HEADER_ROWS, len(grid) - 1):
        cells = list(grid[header_rows].values())
        if (
            cells
            and all(cell.bold or not cell.text for cell in cells)
            and any(cell.text for cell in cells)
        ):
            header_rows += 1
        else:
            break
    header_rows = max(1, header_rows)
    header: list[str] = []
    for column in range(width):
        parts: list[str] = []
        for row_index in range(header_rows):
            value = row_text(row_index, repeat=True)[column]
            if value and value not in parts:
                parts.append(value)
        header.append(" / ".join(parts))
    head = [
        "| " + " | ".join(_escape_cell(value) for value in header) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    body = [
        "| " + " | ".join(_escape_cell(value) for value in row_text(row_index, repeat=False)) + " |"
        for row_index in range(header_rows, len(grid))
    ]
    # A table longer than the chunker's paragraph limit would be cut mid-row: split it into pieces
    # that repeat the header instead.
    head_size = sum(len(line) + 1 for line in head)
    pieces: list[list[str]] = [[]]
    size = head_size
    for row in body:
        if pieces[-1] and size + len(row) + 1 > _MAX_TABLE_CHARS:
            pieces.append([])
            size = head_size
        pieces[-1].append(row)
        size += len(row) + 1
    if len(pieces) > 1:
        notes["table-split-for-chunks"] += len(pieces) - 1
    return ["\n".join([*head, *piece]) for piece in pieces]


def lines_in_blocks(lines: Sequence[str], limit: int = _MAX_TABLE_CHARS) -> list[str]:
    """Blocks of whole lines of at most ``limit`` characters; a longer line is a block alone."""
    blocks: list[str] = []
    current: list[str] = []
    size = 0
    for line in lines:
        if current and size + len(line) + 1 > limit:
            blocks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        blocks.append("\n".join(current))
    return blocks


def _list_items(node: _Node, notes: Counter[str]) -> list[str]:
    """Bullet lines of a list; nested lists (also a <ul> placed directly inside a <ul>) flatten."""
    items: list[str] = []
    for child in node.children:
        if isinstance(child, str):
            continue
        if child.tag in {"ul", "ol"}:
            notes["nested-list-flattened"] += 1
            items.extend(_list_items(child, notes))
        elif child.tag == "li":
            own = [
                part
                for part in child.children
                if isinstance(part, str) or part.tag not in {"ul", "ol"}
            ]
            text = _tidy(_inline(own, notes, br=" "))
            if text:
                items.append(f"- {text}")
            for part in child.children:
                if not isinstance(part, str) and part.tag in {"ul", "ol"}:
                    notes["nested-list-flattened"] += 1
                    items.extend(_list_items(part, notes))
    return items


def _blocks(nodes: Sequence[_Node | str], notes: Counter[str]) -> list[str]:
    out: list[str] = []
    inline: list[str] = []

    def flush() -> None:
        text = "".join(inline)
        inline.clear()
        for piece in text.split(_BR):
            tidy = _tidy(piece)
            if tidy:
                out.append(tidy)

    for node in nodes:
        if isinstance(node, str):
            inline.append(node)
            continue
        tag = node.tag
        if tag in {"p", "div"}:
            flush()
            out.extend(_blocks(node.children, notes))
        elif tag in {"ul", "ol"}:
            flush()
            out.extend(lines_in_blocks(_list_items(node, notes)))
        elif tag == "table":
            flush()
            out.extend(_table_block(node, notes))
        elif tag == "li":
            flush()
            out.extend(_list_items(_Node("ul", children=[node]), notes))
        else:
            inline.append(_inline([node], notes, br=_BR))
    flush()
    return out


@dataclass(frozen=True)
class ConvertedText:
    """A Vidal HTML field as Markdown blocks (paragraphs, bullet lists, pipe tables)."""

    blocks: tuple[str, ...]
    notes: tuple[tuple[str, int], ...]

    @property
    def text(self) -> str:
        return "\n\n".join(self.blocks)


def _split_long_paragraph(text: str) -> list[str]:
    """Pieces of at most ``_MAX_PARAGRAPH_CHARS``, cut after a sentence end, else at a space.

    The pack builder cuts a paragraph longer than 3200 characters at that offset, in the middle of
    a word; cutting it here, between words, keeps every word whole and searchable.
    """
    pieces: list[str] = []
    rest = text
    while len(rest) > _MAX_PARAGRAPH_CHARS:
        window = rest[:_MAX_PARAGRAPH_CHARS]
        cut = max(window.rfind(". "), window.rfind("; "), window.rfind("! "), window.rfind("? "))
        cut = cut + 1 if cut > _MAX_PARAGRAPH_CHARS // 2 else window.rfind(" ")
        if cut <= 0:
            cut = _MAX_PARAGRAPH_CHARS
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def _protect_block_start(block: str, notes: Counter[str]) -> str:
    """Keep a paragraph from being read as markup where the pack builder or the reader would.

    A paragraph that starts with «# » (a footnote mark) is a heading to the pack builder and its
    text would become a section title: a leading no-break space defeats the rule and is stripped
    again when the pack is built. A paragraph that starts with «* » or «+ » (a footnote mark) is a
    bullet to the reader, which would drop the mark: a leading zero-width space keeps it text.
    """
    if _MARKDOWN_HEADING.match(block):
        notes["leading-hash-protected"] += 1
        return "\xa0" + block
    if _READER_BULLET.match(block):
        notes["leading-bullet-mark-protected"] += 1
        return _ZERO_WIDTH_SPACE + block
    return block


def convert_vidal_html(fragment: str | None) -> ConvertedText:
    """Convert one Vidal HTML field to Markdown blocks; wording, order and numbers are kept."""
    if fragment is None or not fragment.strip():
        return ConvertedText((), ())
    notes: Counter[str] = Counter()
    root = _parse_html(fragment)
    blocks = _blocks(root.children, notes)
    converted: list[str] = []
    for block in blocks:
        for token, expansion in _SOURCE_TOKENS:
            if token in block:
                notes[f"token-expanded:{token}"] += block.count(token)
                block = block.replace(token, expansion)
        for piece in _split_long_paragraph(block) if not block.startswith(("|", "- ")) else [block]:
            if piece != block:
                notes["long-paragraph-split"] += 1
            converted.append(_protect_block_start(piece, notes))
    return ConvertedText(tuple(converted), tuple(sorted(notes.items())))


def plain_text(fragment: str | None) -> str:
    """A short Vidal field (name, group) as one line of plain text."""
    if fragment is None or not fragment.strip():
        return ""
    if "<" not in fragment and "&" not in fragment:
        return _tidy(fragment)
    root = _parse_html(fragment)
    return _tidy(_inline(root.children, Counter(), br=" "))


# --------------------------------------------------------------------------------------------
# Vidal identifiers and small normalizations
# --------------------------------------------------------------------------------------------

_REGISTRATION_WRAPPED = re.compile(r"^(?P<prefix>ЛП|ЛС|ЛСР)-№\((?P<number>[^)]+)\)-\(РГ-RU\)$")
_FORM_SPLIT = re.compile(r"\s\d")
_FORM_WORDS: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern), replacement)
    for pattern, replacement in (
        (r"\bтаб\.", "таблетки "),
        (r"\bкапс\.", "капсулы "),
        (r"\bр-р\b", "раствор "),
        (r"\bд/", "для "),
        (r"\bпригот\.", "приготовления "),
        (r"\bнаружн\.", "наружного "),
        (r"\bместн\.", "местного "),
        (r"\bприем\.", "приема "),
        (r"\bприм\.", "применения "),
        (r"\bинъекц\.", "инъекций "),
        (r"\bинф\.", "инфузий "),
        (r"\bсупп\.", "суппозитории "),
        (r"\bконц\.", "концентрат "),
        (r"\bлиоф\.", "лиофилизат "),
        (r"\bпокр\.", "покрытые "),
        (r"\bвн\.", "внутрь "),
        (r"(?<![\w/])в/в\b", "внутривенного"),
        (r"(?<![\w/])в/м\b", "внутримышечного"),
        (r"(?<![\w/])п/к\b", "подкожного"),
        (r"\bглазн\.", "глазные "),
    )
)


def normalize_registration_number(value: str) -> str:
    """``ЛП-№(002688)-(РГ-RU)`` is ``ЛП-002688`` in the registry; other formats stay as printed."""
    cleaned = " ".join(value.split())
    match = _REGISTRATION_WRAPPED.fullmatch(cleaned)
    return f"{match.group('prefix')}-{match.group('number')}" if match else cleaned


def dosage_form_text(zip_info: str | None) -> str | None:
    """The dosage-form words of a Vidal pack line (``таб. 250 мг: 20 шт.`` → ``таблетки``)."""
    text = plain_text(zip_info).lstrip("◊ ").strip()
    if not text:
        return None
    form = _FORM_SPLIT.split(text, maxsplit=1)[0].split(":")[0].strip(" ,;")
    for pattern, replacement in _FORM_WORDS:
        form = pattern.sub(replacement, form)
    form = re.sub(r"\s+([,;])", r"\1", " ".join(form.split())).lower()
    return form or None


def _cleaned_unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


# --------------------------------------------------------------------------------------------
# Loading Vidal
# --------------------------------------------------------------------------------------------


class VidalPreparationReport(CamelModel):
    input: str
    output: str
    input_sha256: str
    db_version: int
    version_label: str
    documents: int
    sections: int
    document_types: dict[str, int]
    products_listed: int
    products_without_document: int
    documents_without_products: int
    icd10_documents: int
    mapping_counts: dict[str, int] = Field(default_factory=dict)
    conversion_notes: dict[str, int] = Field(default_factory=dict)
    empty_documents: list[int] = Field(default_factory=lambda: [])


@dataclass(frozen=True)
class _ProductRow:
    product_id: int
    name: str
    zip_info: str
    registration_number: str
    non_prescription: bool
    gnvls: bool
    company: str


def _text(row: sqlite3.Row, column: str) -> str:
    value = row[column]
    return value if isinstance(value, str) else ""


def _company_label(local_name: str, prop: str | None, country: str | None) -> str:
    parts = [plain_text(local_name)]
    if prop:
        parts.append(plain_text(prop))
    label = " ".join(part for part in parts if part)
    return f"{label} ({country})" if country else label


def _validate_vidal(connection: sqlite3.Connection, input_path: Path) -> None:
    tables = {
        str(row[0])
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    missing = [table for table in _REQUIRED_TABLES if table not in tables]
    if missing:
        raise ValueError(f"Vidal input {input_path} lacks tables: {missing}")


def _source_marker(document_id: int, column: str, table: str, block: int) -> str:
    return (
        "<!-- localmed:source "
        + json.dumps(
            {"table": table, "documentId": document_id, "column": column, "block": block},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + " -->"
    )


@dataclass(frozen=True)
class _SectionSpec:
    title: str
    table: str
    column: str
    blocks: tuple[str, ...]


class _Sections:
    """The sections of one document, in reading order; an empty section is never added."""

    def __init__(self) -> None:
        self.items: list[_SectionSpec] = []

    def add(
        self,
        title: str,
        column: str,
        blocks: Sequence[str],
        table: str = "Document",
    ) -> None:
        if blocks:
            self.items.append(_SectionSpec(title, table, column, tuple(blocks)))


def load_esklp_identities_from_modules(directory: Path) -> list[EsklpMnnIdentity]:
    """ESKLP substance identities (with component INNs) from released ESKLP module databases."""
    identities: dict[str, EsklpMnnIdentity] = {}
    for database in sorted(directory.glob("*.db")):
        with closing(sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True)) as connection:
            tables = {
                str(row[0])
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if "documents" not in tables:
                continue
            for document_id, raw_metadata in connection.execute(
                "SELECT id, metadata_json FROM documents"
            ):
                try:
                    parsed: object = json.loads(str(raw_metadata))
                except json.JSONDecodeError:
                    continue
                if not isinstance(parsed, dict):
                    continue
                values = cast("dict[str, object]", parsed)
                if values.get("contentMode") != "esklp-mnn":
                    continue
                standardized = values.get("standardizedInn")
                if not isinstance(standardized, str) or not standardized.strip():
                    continue
                if str(document_id) in identities:
                    continue
                identities[str(document_id)] = EsklpMnnIdentity(
                    document_id=str(document_id),
                    standardized_inn=standardized,
                    inn=_string_list(values.get("inn")),
                    component_inns=_string_list(values.get("componentInns")),
                )
    return list(identities.values())


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in cast("list[object]", value) if isinstance(item, str)]
    return []


# --------------------------------------------------------------------------------------------
# The preparer
# --------------------------------------------------------------------------------------------

_USAGE_SECTIONS: tuple[tuple[str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    # section title, text column, code columns, a label per code column
    (
        "Применение при беременности и кормлении грудью",
        "Lactation",
        ("PregnancyUsing", "NursingUsing"),
        ("Беременность", "Кормление грудью"),
    ),
    (
        "Применение при нарушениях функции печени",
        "HepatoInsuf",
        ("HepatoInsufUsing",),
        ("Нарушение функции печени",),
    ),
    (
        "Применение при нарушениях функции почек",
        "RenalInsuf",
        ("RenalInsufUsing",),
        ("Нарушение функции почек",),
    ),
    ("Применение у детей", "ChildInsuf", ("ChildInsufUsing",), ("Детский возраст",)),
    (
        "Применение у пожилых пациентов",
        "ElderlyInsuf",
        ("ElderlyInsufUsing",),
        ("Пожилой возраст",),
    ),
)
_USAGE_KEYS = {
    "PregnancyUsing": "pregnancy",
    "NursingUsing": "lactation",
    "HepatoInsufUsing": "hepatic",
    "RenalInsufUsing": "renal",
    "ChildInsufUsing": "children",
    "ElderlyInsufUsing": "elderly",
}
_NO_DATA_CODE = "Qwes"
_SHORT_DESCRIPTION_CHARS = 700


def _short_description(blocks: Sequence[str], fallback: str) -> str | None:
    chosen: list[str] = []
    size = 0
    for block in blocks:
        if block.startswith(("|", "- ")):
            break
        if chosen and size + len(block) > _SHORT_DESCRIPTION_CHARS:
            break
        chosen.append(block)
        size += len(block)
    text = "\n\n".join(chosen).strip()
    return text or fallback or None


def prepare_vidal_medications(
    input_path: Path,
    output: Path,
    *,
    db_version: int = DEFAULT_DB_VERSION,
    esklp_identities: Iterable[EsklpMnnIdentity | Mapping[str, object]] | None = None,
) -> VidalPreparationReport:
    """Write one Markdown document per Vidal ``Document`` row into the workspace ``output``."""
    if not input_path.is_file():
        raise ValueError(f"Vidal input is not a file: {input_path}")
    try:
        connection = sqlite3.connect(f"file:{input_path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        _validate_vidal(connection, input_path)
    except sqlite3.DatabaseError as error:
        raise ValueError(f"Vidal input is not a valid SQLite database: {input_path}") from error

    input_sha256 = sha256_file(input_path)
    context = _Context(
        input_name=input_path.name,
        input_sha256=input_sha256,
        db_version=db_version,
        version_label=f"vidal-{db_version}-{input_sha256.removeprefix('sha256:')[:12]}",
        source_name=f"Видаль (через Справочник врача MedElement), версия БД {db_version}",
        crosswalk=(
            build_esklp_mnn_crosswalk(esklp_identities) if esklp_identities is not None else None
        ),
    )
    temporary = output.with_name(f".{output.name}.stage-{uuid4().hex}")
    backup = output.with_name(f".{output.name}.backup-{uuid4().hex}")
    try:
        with closing(connection):
            report = _write_workspace(connection, temporary, context)
        if output.exists():
            output.replace(backup)
        temporary.replace(output)
        shutil.rmtree(backup, ignore_errors=True)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        if backup.exists() and not output.exists():
            backup.replace(output)
        raise
    return report.model_copy(update={"output": str(output)})


@dataclass(frozen=True)
class _Context:
    input_name: str
    input_sha256: str
    db_version: int
    version_label: str
    source_name: str
    crosswalk: Mapping[str, tuple[str, ...]] | None


@dataclass
class _Lookups:
    """The Vidal tables a document needs, loaded once and grouped by document id."""

    usage_names: dict[str, str] = field(default_factory=lambda: {})
    document_types: dict[int, str] = field(default_factory=lambda: {})
    products: dict[int, list[_ProductRow]] = field(default_factory=lambda: defaultdict(list))
    atc: dict[int, dict[str, str]] = field(default_factory=lambda: defaultdict(dict))
    pharmacotherapeutic: dict[int, list[str]] = field(default_factory=lambda: defaultdict(list))
    clinical_groups: dict[int, list[str]] = field(default_factory=lambda: defaultdict(list))
    molecules: dict[int, list[tuple[str, str]]] = field(default_factory=lambda: defaultdict(list))
    nozology: dict[int, list[tuple[str, str]]] = field(default_factory=lambda: defaultdict(list))
    products_without_document: int = 0


def _load_lookups(connection: sqlite3.Connection) -> _Lookups:
    lookups = _Lookups()
    for row in connection.execute('SELECT Code, Name FROM "Using"'):
        lookups.usage_names[str(row["Code"])] = plain_text(_text(row, "Name"))
    for row in connection.execute("SELECT ArticleID, Name FROM DocumentType"):
        lookups.document_types[int(row["ArticleID"])] = plain_text(_text(row, "Name"))
    companies = _load_main_companies(connection)
    for row in connection.execute(
        "SELECT p.ProductID, p.RusName, p.ZipInfo, p.RegistrationNumber, p.NonPrescriptionDrug,"
        " p.GNVLS, pd.DocumentID FROM Product p"
        " JOIN Product_Document pd ON pd.ProductID = p.ProductID ORDER BY p.ProductID"
    ):
        lookups.products[int(row["DocumentID"])].append(
            _ProductRow(
                product_id=int(row["ProductID"]),
                name=plain_text(_text(row, "RusName")),
                zip_info=plain_text(_text(row, "ZipInfo")),
                registration_number=" ".join(_text(row, "RegistrationNumber").split()),
                non_prescription=bool(row["NonPrescriptionDrug"]),
                gnvls=bool(row["GNVLS"]),
                company=companies.get(int(row["ProductID"]), ""),
            )
        )
    lookups.products_without_document = int(
        connection.execute(
            "SELECT count(*) FROM Product p WHERE NOT EXISTS"
            " (SELECT 1 FROM Product_Document pd WHERE pd.ProductID = p.ProductID)"
        ).fetchone()[0]
    )
    for row in connection.execute(
        "SELECT DISTINCT pd.DocumentID, a.ATCCode, a.RusName FROM Product_Document pd"
        " JOIN Product_ATC pa ON pa.ProductID = pd.ProductID"
        " JOIN ATC a ON a.ATCCode = pa.ATCCode ORDER BY a.ATCCode"
    ):
        lookups.atc[int(row["DocumentID"])][str(row["ATCCode"])] = plain_text(_text(row, "RusName"))
    for row in connection.execute(
        "SELECT DISTINCT pd.DocumentID, g.Name FROM Product_Document pd"
        " JOIN Product_PhThGrp pg ON pg.ProductID = pd.ProductID"
        " JOIN PhThGroups g ON g.PhThGroupsID = pg.PhThGroupsID ORDER BY g.Name"
    ):
        lookups.pharmacotherapeutic[int(row["DocumentID"])].append(plain_text(_text(row, "Name")))
    for row in connection.execute(
        "SELECT DISTINCT pd.DocumentID, g.Name FROM Product_Document pd"
        " JOIN Product_ClPhGroups pg ON pg.ProductID = pd.ProductID"
        " JOIN ClPhGroups g ON g.ClPhGroupsID = pg.ClPhGroupsID ORDER BY g.Code"
    ):
        lookups.clinical_groups[int(row["DocumentID"])].append(plain_text(_text(row, "Name")))
    for row in connection.execute(
        "SELECT md.DocumentID, m.RusName, m.LatName FROM Molecule_Document md"
        " JOIN Molecule m ON m.MoleculeID = md.MoleculeID"
        " ORDER BY md.DocumentID, COALESCE(md.Ranking, 0), m.MoleculeID"
    ):
        lookups.molecules[int(row["DocumentID"])].append(
            (plain_text(_text(row, "RusName")), plain_text(_text(row, "LatName")))
        )
    for row in connection.execute(
        "SELECT DISTINCT i.DocumentID, n.Code, n.Name FROM Document_IndicNozology i"
        " JOIN Nozology n ON n.NozologyCode = i.NozologyCode ORDER BY i.DocumentID, n.Code"
    ):
        lookups.nozology[int(row["DocumentID"])].append(
            (plain_text(_text(row, "Code")), plain_text(_text(row, "Name")))
        )
    return lookups


_TEXT_COLUMNS = (
    "CompiledComposition",
    "ClPhGrDescription",
    "PhInfluence",
    "PhKinetics",
    "Indication",
    "Dosage",
    "SideEffects",
    "ContraIndication",
    "Lactation",
    "HepatoInsuf",
    "RenalInsuf",
    "ChildInsuf",
    "ElderlyInsuf",
    "SpecialInstruction",
    "OverDosage",
    "Interaction",
    "StorageCondition",
    "PharmDelivery",
    "CompaniesDescription",
)
_INFO_TITLE = "Сведения о статье"


def _type_name(document: sqlite3.Row, lookups: _Lookups) -> str:
    article = document["ArticleID"]
    return lookups.document_types.get(int(article), "") if article is not None else ""


@dataclass(frozen=True)
class _PreparedDocument:
    markdown: str
    sections: int
    notes: Counter[str]
    type_name: str
    products: int
    mapping_status: str | None
    has_icd_codes: bool
    empty: bool


def _document_sections(
    document: sqlite3.Row,
    document_id: int,
    converted: Mapping[str, ConvertedText],
    lookups: _Lookups,
    context: _Context,
) -> tuple[_Sections, dict[str, str]]:
    """The sections of one document in Vidal reading order, and its usage restrictions."""
    sections = _Sections()
    add = sections.add
    molecule_names = _cleaned_unique(name for name, _ in lookups.molecules.get(document_id, []))
    atc = lookups.atc.get(document_id, {})
    nozology = lookups.nozology.get(document_id, [])
    products = lookups.products.get(document_id, [])

    group_lines = list(converted["ClPhGrDescription"].blocks)
    group_lines.extend(
        f"Клинико-фармакологическая группа: {group}"
        for group in _cleaned_unique(lookups.clinical_groups.get(document_id, []))
    )
    group_lines.extend(
        f"Фармакотерапевтическая группа: {group}"
        for group in _cleaned_unique(lookups.pharmacotherapeutic.get(document_id, []))
    )
    if molecule_names:
        group_lines.append("Действующие вещества (МНН): " + ", ".join(molecule_names))
    if atc:
        group_lines.append(
            "Код АТХ: " + "; ".join(f"{code} — {name}" for code, name in atc.items())
        )

    add("Состав и форма выпуска", "CompiledComposition", converted["CompiledComposition"].blocks)
    add("Фармакологическая группа", "ClPhGrDescription", group_lines)
    add("Фармакологическое действие", "PhInfluence", converted["PhInfluence"].blocks)
    add("Фармакокинетика", "PhKinetics", converted["PhKinetics"].blocks)
    add("Показания", "Indication", converted["Indication"].blocks)
    if nozology:
        add(
            "Нозологическая классификация (МКБ-10)",
            "NozologyCode",
            lines_in_blocks([f"- {code} — {name}" for code, name in nozology]),
            table="Document_IndicNozology",
        )
    add("Режим дозирования", "Dosage", converted["Dosage"].blocks)
    add("Побочные действия", "SideEffects", converted["SideEffects"].blocks)
    add("Противопоказания", "ContraIndication", converted["ContraIndication"].blocks)
    usage: dict[str, str] = {}
    for usage_title, text_column, code_columns, labels in _USAGE_SECTIONS:
        lines: list[str] = []
        informative = False
        for code_column, label in zip(code_columns, labels, strict=True):
            code = _text(document, code_column).strip()
            if code not in lookups.usage_names:
                continue
            lines.append(f"- {label}: {lookups.usage_names[code]}")
            if code != _NO_DATA_CODE:
                usage[_USAGE_KEYS[code_column]] = lookups.usage_names[code]
                informative = True
        blocks = list(converted[text_column].blocks)
        if blocks or informative:
            add(usage_title, text_column, ["\n".join(lines), *blocks] if lines else blocks)
    add("Особые указания", "SpecialInstruction", converted["SpecialInstruction"].blocks)
    add("Передозировка", "OverDosage", converted["OverDosage"].blocks)
    add("Лекарственное взаимодействие", "Interaction", converted["Interaction"].blocks)
    add("Условия хранения", "StorageCondition", converted["StorageCondition"].blocks)
    add("Условия отпуска из аптек", "PharmDelivery", converted["PharmDelivery"].blocks)
    add(
        "Держатели регистрации и производители",
        "CompaniesDescription",
        converted["CompaniesDescription"].blocks,
    )
    product_lines = _product_lines(products)
    if product_lines:
        legend = (
            ["◊ — отпускается без рецепта."] if any("◊" in p.zip_info for p in products) else []
        )
        add(
            "Торговые названия и формы выпуска",
            "ProductID",
            [*legend, *lines_in_blocks(product_lines)],
            table="Product_Document",
        )
    type_name = _type_name(document, lookups)
    year_edition = _text(document, "YearEdition").strip()
    info_lines = [f"Тип статьи: {type_name}"] if type_name else []
    if year_edition not in {"", "0"}:
        info_lines.append(f"Год редакции: {year_edition}")
    info_lines.append(f"Источник: {context.source_name}")
    add(_INFO_TITLE, "ArticleID", ["\n".join(info_lines)])
    return sections, usage


def _document_metadata(
    document: sqlite3.Row,
    document_id: int,
    title_name: str,
    converted: Mapping[str, ConvertedText],
    usage: Mapping[str, str],
    lookups: _Lookups,
    context: _Context,
    notes: Counter[str],
) -> tuple[dict[str, object], str | None]:
    """Front-matter metadata of one document and its ESKLP mapping status."""
    products = lookups.products.get(document_id, [])
    molecule_names = _cleaned_unique(name for name, _ in lookups.molecules.get(document_id, []))
    nozology = lookups.nozology.get(document_id, [])
    type_name = _type_name(document, lookups)
    year_edition = _text(document, "YearEdition").strip()
    forms = _cleaned_unique(
        form for form in (dosage_form_text(product.zip_info) for product in products) if form
    )
    production_form = "; ".join(forms[:6]) if forms else plain_text(_text(document, "Elaboration"))
    registration_numbers = _cleaned_unique(
        normalize_registration_number(product.registration_number)
        for product in products
        if product.registration_number
    )
    metadata: dict[str, object] = {
        "contentMode": CONTENT_MODE,
        "referenceSourceKey": SOURCE_KEY,
        "referenceSourceName": SOURCE_SHORT_NAME,
        "referenceId": document_id,
        "vidalDocumentId": document_id,
        "snapshotSha256": context.input_sha256,
        "sourceDbVersion": context.db_version,
        "sourceName": context.source_name,
        "sourceLabel": SOURCE_SHORT_NAME,
        "sourceNotice": (
            f"Личный справочный материал: {context.source_name}. "
            "Не официальная инструкция ГРЛС; не публикуется и не распространяется."
        ),
        "rightsStatus": RIGHTS_STATUS,
        "localOnly": True,
        "documentType": type_name or None,
        "documentTypeId": int(document["ArticleID"]) if document["ArticleID"] else None,
        "tradeName": title_name or None,
        "nameLat": plain_text(_text(document, "EngName")) or None,
        "productionForm": production_form or None,
        "shortDescription": _short_description(
            converted["PhInfluence"].blocks, "\n".join(converted["ClPhGrDescription"].blocks)
        ),
        "ingredientNames": molecule_names or None,
        "tradeNames": _cleaned_unique(product.name for product in products) or None,
        "atcCodes": list(lookups.atc.get(document_id, {})) or None,
        "registrationNumbers": registration_numbers or None,
        "holders": _cleaned_unique(p.company for p in products if p.company)[:60] or None,
        "icd10Codes": _cleaned_unique(code for code, _ in nozology if "-" not in code) or None,
        "yearEdition": int(year_edition)
        if year_edition.isdigit() and year_edition != "0"
        else None,
        "nonPrescription": all(p.non_prescription for p in products) if products else None,
        "gnvls": any(p.gnvls for p in products) if products else None,
        "usage": dict(usage) or None,
        "productCount": len(products),
        "conversionNotes": dict(sorted(notes.items())) or None,
    }
    if molecule_names:
        metadata["normalizedIngredientComposition"] = composition_identity_keys(molecule_names)
    mapping_status: str | None = None
    if context.crosswalk is not None and molecule_names:
        mapping_status, candidates = link_composition_to_esklp(molecule_names, context.crosswalk)
        metadata["mappingStatus"] = mapping_status
        if mapping_status == "ambiguous":
            metadata["mappingCandidates"] = list(candidates)
        elif mapping_status == "linked":
            metadata["linkedMnnDocumentId"] = candidates[0]
            metadata["mappingMethod"] = _MAPPING_METHOD
    return metadata, mapping_status


def _render_document(
    document: sqlite3.Row, lookups: _Lookups, context: _Context
) -> _PreparedDocument:
    document_id = int(document["DocumentID"])
    products = lookups.products.get(document_id, [])
    notes: Counter[str] = Counter()
    converted: dict[str, ConvertedText] = {}
    for column in _TEXT_COLUMNS:
        result = convert_vidal_html(_text(document, column))
        converted[column] = result
        for note, count in result.notes:
            notes[note] += count

    title_name = plain_text(_text(document, "RusName"))
    elaboration = plain_text(_text(document, "Elaboration"))
    title = f"{title_name} ({elaboration})" if title_name and elaboration else title_name
    title = title or f"Видаль #{document_id}"
    name_lat = plain_text(_text(document, "EngName"))
    sections, usage = _document_sections(document, document_id, converted, lookups, context)
    metadata, mapping_status = _document_metadata(
        document, document_id, title_name, converted, usage, lookups, context, notes
    )
    molecules = lookups.molecules.get(document_id, [])
    nozology = lookups.nozology.get(document_id, [])
    front_matter = {
        "id": f"{DOCUMENT_PREFIX}{document_id}",
        "title": title,
        "short_title": name_lat or None,
        "version_label": context.version_label,
        "source_type": "allmed_reference",
        "status": "reference",
        "source_file": context.input_name,
        "source_checksum": _document_checksum(document, products, molecules, nozology),
        "metadata": {key: value for key, value in metadata.items() if value is not None},
    }
    lines = [
        "---",
        yaml.safe_dump(front_matter, allow_unicode=True, sort_keys=False, width=10_000).rstrip(),
        "---",
        "",
        "# Карточка препарата",
        "",
        _source_marker(document_id, "RusName", "Document", 0),
        title,
        "",
    ]
    if name_lat:
        lines.extend([_source_marker(document_id, "EngName", "Document", 0), name_lat, ""])
    for section in sections.items:
        lines.extend([f"# {section.title}", ""])
        for index, block in enumerate(section.blocks):
            lines.extend(
                [_source_marker(document_id, section.column, section.table, index), block, ""]
            )
    return _PreparedDocument(
        markdown="\n".join(lines).rstrip() + "\n",
        sections=len(sections.items) + 1,
        notes=notes,
        type_name=_type_name(document, lookups) or str(document["ArticleID"]),
        products=len(products),
        mapping_status=mapping_status,
        has_icd_codes=bool(metadata.get("icd10Codes")),
        empty=all(section.title == _INFO_TITLE for section in sections.items),
    )


def _write_workspace(
    connection: sqlite3.Connection, workspace: Path, context: _Context
) -> VidalPreparationReport:
    workspace.mkdir(parents=True, exist_ok=False)
    manifest = {
        "id": MODULE_ID,
        "version": context.version_label,
        "schemaVersion": 2,
        "title": MODULE_TITLE,
        "builtAt": _BUILT_AT,
    }
    (workspace / "manifest.yaml").write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    (workspace / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
    lookups = _load_lookups(connection)

    total_notes: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    mapping_counts = {"linked": 0, "ambiguous": 0, "unmatched": 0}
    section_total = 0
    documents_without_products = 0
    icd_documents = 0
    empty_documents: list[int] = []
    products_listed = 0
    document_count = 0
    for document in connection.execute("SELECT * FROM Document ORDER BY DocumentID"):
        document_id = int(document["DocumentID"])
        prepared = _render_document(document, lookups, context)
        (workspace / f"{DOCUMENT_PREFIX}{document_id}.md").write_text(
            prepared.markdown, encoding="utf-8"
        )
        document_count += 1
        section_total += prepared.sections
        products_listed += prepared.products
        documents_without_products += prepared.products == 0
        icd_documents += prepared.has_icd_codes
        type_counts[prepared.type_name] += 1
        total_notes.update(prepared.notes)
        if prepared.mapping_status is not None:
            mapping_counts[prepared.mapping_status] += 1
        if prepared.empty:
            empty_documents.append(document_id)

    return VidalPreparationReport(
        input=context.input_name,
        output=str(workspace),
        input_sha256=context.input_sha256,
        db_version=context.db_version,
        version_label=context.version_label,
        documents=document_count,
        sections=section_total,
        document_types=dict(sorted(type_counts.items())),
        products_listed=products_listed,
        products_without_document=lookups.products_without_document,
        documents_without_products=documents_without_products,
        icd10_documents=icd_documents,
        mapping_counts=mapping_counts if context.crosswalk is not None else {},
        conversion_notes=dict(sorted(total_notes.items())),
        empty_documents=empty_documents,
    )


def _load_main_companies(connection: sqlite3.Connection) -> dict[int, str]:
    countries = {
        str(row["CountryCode"]): plain_text(_text(row, "RusName"))
        for row in connection.execute("SELECT CountryCode, RusName FROM Country")
    }
    companies: dict[int, str] = {}
    for row in connection.execute(
        "SELECT pc.ProductID, c.LocalName, c.Property, c.CountryCode FROM Product_Company pc"
        " JOIN Company c ON c.CompanyID = pc.CompanyID"
        " ORDER BY pc.ProductID, pc.ItsMainCompany DESC, COALESCE(pc.Ranking, 0), c.CompanyID"
    ):
        product_id = int(row["ProductID"])
        if product_id in companies:
            continue
        companies[product_id] = _company_label(
            _text(row, "LocalName"),
            _text(row, "Property") or None,
            countries.get(_text(row, "CountryCode")) or None,
        )
    return companies


def _product_lines(products: Sequence[_ProductRow]) -> list[str]:
    grouped: dict[tuple[str, str, str], list[str]] = {}
    for product in products:
        key = (product.name, product.registration_number, product.company)
        forms = grouped.setdefault(key, [])
        if product.zip_info and product.zip_info not in forms:
            forms.append(product.zip_info)
    lines: list[str] = []
    for (name, registration, company), forms in grouped.items():
        details = [
            part
            for part in (
                "; ".join(forms),
                f"рег. № {registration}" if registration else "",
                company,
            )
            if part
        ]
        lines.append(f"- {name}" + (" — " + " · ".join(details) if details else ""))
    return lines


def _document_checksum(
    document: sqlite3.Row,
    products: Sequence[_ProductRow],
    molecules: Sequence[tuple[str, str]],
    nozology: Sequence[tuple[str, str]],
) -> str:
    payload = {
        "document": dict(zip(document.keys(), tuple(document), strict=True)),
        "products": [
            [p.product_id, p.name, p.zip_info, p.registration_number, p.company] for p in products
        ],
        "molecules": [list(item) for item in molecules],
        "nozology": [list(item) for item in nozology],
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()
