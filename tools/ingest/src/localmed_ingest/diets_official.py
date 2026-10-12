"""Official Russian therapeutic-nutrition texts as a prepared Markdown workspace.

Inputs are the ``extracted.md`` files collected under ``data/raw/diets-official/<order>/`` (exact
table wording, merged cells marked ``^<`` / ``^``, paragraph breaks ``<br>``) and each folder's
``SOURCE.json``. Orders: 330 of 2003 (Instruction, Appendix 4), 395n of 2013 (norms), 1008n of
2020 (procedure and nomenclature) and 70n of 2024 (amendments, already merged into the consolidated
330/395n texts).

The preparer never rewrites a source word. It selects, orders and lays out: table rows become
bullet lists or GFM tables, ``<br>`` becomes a new line, ``N`` before a digit becomes the number
sign. One correction follows the official Russian Gazette scan and is listed in the report. The
output is deterministic: a re-fetch of the raw files regenerates the same Markdown.

Documents (ids ``reference.diets.*``):

* one per standard diet variant (OVD, SHD, VBD, NBD, NKD, VKD): 330 Table 1 row, Table 1a rows,
  numbered diets, 395n food set and 1008n adult nomenclature row;
* one for children over one year, pregnant and nursing women (1008n item 10 and Appendix 3);
* the full 395n norms table; Tables 2a-7 of the 330 Instruction; an overview of the system.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

import yaml

PACK_ID = "minimed.diets.official"
DOCUMENT_PREFIX = "reference.diets."
SOURCE_TYPE = "medical_reference"
RIGHTS_STATUS = "official-act-not-copyrighted"
RIGHTS_BASIS = (
    "Official documents are not objects of copyright (Civil Code of the RF, Art. 1259(6))"
)
TABLE_PIECE_LIMIT = 2800
"""Largest table paragraph (characters); the chunker only splits paragraphs above 3200."""
_YAML_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)

ORDER_330 = "order-330-2003"
ORDER_395 = "order-395n-2013"
ORDER_1008 = "order-1008n-2020"
ORDER_70 = "order-70n-2024"
EXTRACTED = "extracted.md"
# Reading text per order (a mirror) and the best official page, by SOURCE.json file name.
READING_FILES = {
    ORDER_330: "legalacts_prikaz-330_ed-2024-02-19.html",
    ORDER_395: "legalacts_prikaz-395n_ed-2024-02-19.html",
    ORDER_1008: "legalacts_prikaz-1008n.html",
    ORDER_70: "garant_prime_408653843.html",
}
OFFICIAL_FILES = {
    ORDER_330: "consultant_cons_doc_LAW_44323_toc.html",
    ORDER_395: "minzdrav_documents_5407_page.html",
    ORDER_1008: "publication_pravo_gov_0001202010010037.html",
    ORDER_70: "publication_pravo_gov_0001202403220011.html",
}
ORDERS: dict[str, dict[str, str]] = {
    ORDER_330: {
        "short": "Приказ Минздрава России №330 от 05.08.2003, ред. от 19.02.2024",
        "number": "330",
        "date": "2003-08-05",
        "edition": "2024-02-19",
        "registration": "Минюст России 12.09.2003 № 5073",
    },
    ORDER_395: {
        "short": "Приказ Минздрава России №395н от 21.06.2013, ред. от 19.02.2024",
        "number": "395н",
        "date": "2013-06-21",
        "edition": "2024-02-19",
        "registration": "Минюст России 05.07.2013 № 28995",
    },
    ORDER_1008: {
        "short": "Приказ Минздрава России №1008н от 23.09.2020",
        "number": "1008н",
        "date": "2020-09-23",
        "edition": "",
        "registration": "",
    },
    ORDER_70: {
        "short": "Приказ Минздрава России №70н от 19.02.2024",
        "number": "70н",
        "date": "2024-02-19",
        "edition": "",
        "registration": "Минюст России 21.03.2024 № 77586",
    },
}

# Table 1, column 2 of the Instruction: numbered diets of every standard variant (in force text).
OFFICIAL_NUMBERED_DIETS: dict[str, tuple[str, ...]] = {
    "ovd": ("1", "2", "3", "5", "6", "7", "9", "10", "13", "14", "15"),
    "shd": ("1б", "4б", "4в", "5п (I вариант)"),
    "vbd": ("4э", "4аг", "5п (II вариант)", "7в", "7г", "9б", "10б", "11", "R-I", "R-II"),
    "nbd": ("7б", "7а"),
    "nkd": ("8", "8а", "8о", "9а", "10с"),
    "vkd": ("11",),
}

CORRECTIONS: tuple[dict[str, str], ...] = (
    {
        "where": "order 1008n, Appendix 3, row 2 (variant label)",
        "mirror": "(ЩЦ)",
        "official": "(ЩД)",
        "basis": "Rossiyskaya Gazeta scan rg_60137.pdf, page 12 of 16, and the Garant text",
    },
)


@dataclass(frozen=True)
class Variant:
    key: str
    abbreviation: str
    plain: str
    match_330: str
    match_1008: str
    column_395: int


VARIANTS: tuple[Variant, ...] = (
    Variant(
        "ovd",
        "ОВД",
        "основной вариант стандартной диеты",
        "основной вариант",
        "основной вариант",
        0,
    ),
    Variant(
        "shd",
        "ЩД",
        "щадящая",
        "механическим и химическим щажением",
        "механическим и химическим",
        1,
    ),
    Variant(
        "vbd",
        "ВБД",
        "высокобелковая",
        "повышенным количеством белка",
        "повышенным количеством белка",
        2,
    ),
    Variant(
        "nbd",
        "НБД",
        "низкобелковая",
        "пониженным количеством белка",
        "пониженным количеством белка",
        3,
    ),
    Variant(
        "nkd",
        "НКД",
        "низкокалорийная",
        "пониженной калорийностью",
        "пониженной калорийностью",
        4,
    ),
    Variant(
        "vkd",
        "ВКД",
        "высококалорийная",
        "повышенной калорийностью",
        "повышенной калорийностью",
        5,
    ),
)
_HEADER_395 = (
    "стандартной диеты",
    "щажением",
    "повышенным количеством белка",
    "пониженным количеством белка",
    "пониженной калорийностью",
    "повышенной калорийностью",
)
# Appendix 3 of 1008n: (key, text that identifies the row label).
_CHILD_ROWS = (
    ("ovd", "основной вариант"),
    ("shd", "химическим и механическим щажением"),
    ("vbkd", "повышенным количеством белка и повышенной калорийностью"),
    ("nbd", "пониженным количеством белка"),
    ("nkd", "пониженной калорийностью"),
    ("pregnancy", "беременных и кормящих"),
)

_BR = re.compile(r"\s*<br\s*/?>\s*")
_COMMENT = re.compile(r"<!--\s*((?:Таблица\s+\d+[а-я]?)|(?:Приложение(?:\s+N\s+\d+)?))")
_LABEL = re.compile(r"^Таблица \d+[а-я]?$")
_BOILERPLATE = (
    "к Инструкции по организации",
    "лечебного питания",
    "в лечебно-профилактических",
    "учреждениях",
)
_DASHES = re.compile(r"^-{3,}$")
_NUMBER_SIGN = re.compile(r"\bN\s+N(?=\s*\d)|\bN(?=\s*\d)")
_ABBREVIATION = re.compile(r"^\([А-ЯA-Z]{2,5}\)$")


class DietsSourceError(ValueError):
    """The extracted text does not have the shape this preparer relies on."""


@dataclass(frozen=True)
class SourceTable:
    key: str
    title: str
    header: tuple[tuple[str, ...], ...]
    rows: tuple[tuple[str, ...], ...]
    notes: tuple[str, ...]


@dataclass(frozen=True)
class ExtractedFile:
    sha256: str
    lines: tuple[str, ...]
    tables: dict[str, SourceTable]


def cell_lines(cell: str) -> list[str]:
    return [part.strip() for part in _BR.split(cell) if part.strip()]


def one_line(cell: str) -> str:
    return " ".join(cell_lines(cell))


def number_sign(text: str) -> str:
    """The mirrors print the number sign as a Latin ``N``; restore it before a number."""
    return _NUMBER_SIGN.sub(lambda match: "№№" if "N N" in match.group(0) else "№", text)


def _split_row(line: str) -> tuple[str, ...]:
    return tuple(cell.strip() for cell in line.strip().strip("|").split("|"))


def read_extracted(path: Path) -> ExtractedFile:
    raw = path.read_bytes()
    lines = raw.decode("utf-8").splitlines()
    tables: dict[str, SourceTable] = {}
    index = 0
    while index < len(lines):
        match = _COMMENT.match(lines[index].strip())
        if match is None or index + 1 >= len(lines) or not lines[index + 1].startswith("|"):
            index += 1
            continue
        key = re.sub(r"\s+", " ", match.group(1))
        end = index + 1
        block: list[str] = []
        while end < len(lines) and lines[end].startswith("|"):
            block.append(lines[end])
            end += 1
        parsed = [_split_row(line) for line in block]
        separator = next(
            (
                at
                for at, row in enumerate(parsed)
                if all(re.fullmatch(r":?-{3,}:?", cell) for cell in row)
            ),
            None,
        )
        if separator is None:
            raise DietsSourceError(f"{path}: table {key} has no header separator")
        width = len(parsed[0])
        if any(len(row) != width for row in parsed):
            raise DietsSourceError(f"{path}: table {key} has rows of different width")
        if key in tables:
            raise DietsSourceError(f"{path}: table {key} appears twice")
        title = ""
        notes: tuple[str, ...] = ()
        if key.startswith("Таблица"):
            title = _table_title(lines, index)
            notes = _table_notes(lines, end)
        body_start = separator + 1
        while body_start < len(parsed) and _is_header_row(parsed[body_start]):
            body_start += 1
        tables[key] = SourceTable(
            key=key,
            title=title,
            header=(*parsed[:separator], *parsed[separator + 1 : body_start]),
            rows=tuple(parsed[body_start:]),
            notes=notes,
        )
        index = end
    return ExtractedFile(hashlib.sha256(raw).hexdigest(), tuple(lines), tables)


def _is_header_row(row: Sequence[str]) -> bool:
    """Sub-header rows after the separator: column numbers, or an empty first cell with labels."""
    if all(cell.isdigit() for cell in row):
        return True
    return not row[0] and any(cell not in {"", "^<"} for cell in row)


def _table_title(lines: Sequence[str], comment_index: int) -> str:
    collected: list[str] = []
    for line in reversed(lines[max(0, comment_index - 14) : comment_index]):
        text = line.strip()
        if _LABEL.match(text):
            break
        if text and text not in _BOILERPLATE:
            collected.append(text)
    title = " ".join(reversed(collected))
    return title[:1] + title[1:].lower() if title.isupper() else title


def _table_notes(lines: Sequence[str], start: int) -> tuple[str, ...]:
    notes: list[str] = []
    for line in lines[start:]:
        text = line.strip()
        if _LABEL.match(text) or text.startswith("<!--"):
            break
        if not text or text == "-->" or _DASHES.match(text):
            continue
        notes.append(text)
    return tuple(notes)


# ---------------------------------------------------------------------------------------------
# Markdown helpers
# ---------------------------------------------------------------------------------------------


def md_cell(text: str) -> str:
    return text.replace("\\", "\\\\").replace("|", "\\|").strip()


def gfm_tables(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    """GFM table paragraphs; a long table is split into pieces that repeat the header."""
    head = [
        "| " + " | ".join(md_cell(cell) for cell in header) + " |",
        "|" + " --- |" * len(header),
    ]
    head_size = sum(len(line) + 1 for line in head)
    pieces: list[list[str]] = [[]]
    size = head_size
    for row in rows:
        if len(row) != len(header):
            raise DietsSourceError(f"table row has {len(row)} cells, expected {len(header)}")
        line = "| " + " | ".join(md_cell(cell) for cell in row) + " |"
        if pieces[-1] and size + len(line) + 1 > TABLE_PIECE_LIMIT:
            pieces.append([])
            size = head_size
        pieces[-1].append(line)
        size += len(line) + 1
    return ["\n".join([*head, *piece]) for piece in pieces if piece]


def bullets(lines: Sequence[str]) -> str:
    return "\n".join("- " + number_sign(line) for line in lines)


def paragraph(text: str) -> str:
    return number_sign(text)


def table_name(code: str) -> str:
    """``Стол №5`` for numbered diets, ``Стол R-I`` for the X-ray ones."""
    return f"Стол {code}" if code.startswith("R-") else f"Стол №{code}"


def base_code(code: str) -> str:
    return re.sub(r"\s*\(.*\)$", "", code)


def _sort_key(code: str) -> tuple[int, str, str]:
    match = re.match(r"(\d+)(.*)", code)
    if match is None:
        return (999, code, code)
    return (int(match.group(1)), match.group(2), code)


@dataclass
class Section:
    level: int
    title: str
    blocks: list[str]
    order: str
    locator: str


@dataclass
class Document:
    key: str
    title: str
    short_title: str
    source_orders: tuple[str, ...]
    sections: list[Section] = field(default_factory=list[Section])
    metadata: dict[str, object] = field(default_factory=dict[str, object])
    reference_lines: list[str] = field(default_factory=list[str])
    age_groups: tuple[str, ...] = ("adults",)
    specialties: tuple[str, ...] = ("nutrition", "general-practice")
    audience: str = ""
    navigation_aliases: list[str] = field(default_factory=list[str])

    @property
    def document_id(self) -> str:
        return DOCUMENT_PREFIX + self.key

    def add(self, level: int, title: str, blocks: list[str], order: str, locator: str) -> Section:
        section = Section(level, title, blocks, order, locator)
        self.sections.append(section)
        return section


@dataclass
class PrepareReport:
    documents: int = 0
    aliases: int = 0
    tables: int = 0
    corrections: list[dict[str, str]] = field(default_factory=list[dict[str, str]])
    sources: dict[str, str] = field(default_factory=dict[str, str])
    food_set_rows_not_listed: dict[str, int] = field(default_factory=dict[str, int])
    output: str = ""


# ---------------------------------------------------------------------------------------------
# Source readers
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Sources:
    files: dict[str, ExtractedFile]
    entries: dict[str, dict[str, dict[str, object]]]
    fetched_at: str

    def table(self, order: str, key: str) -> SourceTable:
        try:
            return self.files[order].tables[key]
        except KeyError as error:
            raise DietsSourceError(f"{order}: table {key} not found in {EXTRACTED}") from error

    def urls(self, order: str) -> dict[str, str]:
        result: dict[str, str] = {}
        for label, names in (
            ("officialSourceUrl", OFFICIAL_FILES),
            ("textMirrorUrl", READING_FILES),
        ):
            entry = self.entries[order].get(names[order])
            if entry is None:
                raise DietsSourceError(f"{order}: SOURCE.json has no entry for {names[order]}")
            result[label] = str(entry["url"])
        return result


def load_sources(root: Path) -> Sources:
    files: dict[str, ExtractedFile] = {}
    entries: dict[str, dict[str, dict[str, object]]] = {}
    fetched: list[str] = []
    for order in ORDERS:
        folder = root / order
        extracted = folder / EXTRACTED
        descriptor = folder / "SOURCE.json"
        if not extracted.is_file() or not descriptor.is_file():
            raise DietsSourceError(f"{folder}: {EXTRACTED} and SOURCE.json are required")
        files[order] = read_extracted(extracted)
        loaded = json.loads(descriptor.read_text(encoding="utf-8"))
        entries[order] = {str(item["file"]): dict(item) for item in loaded["files"]}
        fetched.extend(str(item["fetched_at"]) for item in loaded["files"])
    return Sources(files, entries, max(fetched))


def _find_row(rows: Sequence[Sequence[str]], needle: str) -> Sequence[str]:
    found = [row for row in rows if needle in one_line(row[0]).lower()]
    if len(found) != 1:
        raise DietsSourceError(f"expected one row containing {needle!r}, found {len(found)}")
    return found[0]


def numbered_diets(sources: Sources) -> dict[str, tuple[str, ...]]:
    """Column 2 of Table 1 per variant, checked against ``OFFICIAL_NUMBERED_DIETS``."""
    table = sources.table(ORDER_330, "Таблица 1")
    result: dict[str, tuple[str, ...]] = {}
    for variant in VARIANTS:
        row = _find_row(table.rows, variant.match_330)
        result[variant.key] = tuple(part.strip() for part in one_line(row[1]).split(","))
    if result != OFFICIAL_NUMBERED_DIETS:
        raise DietsSourceError(
            "Table 1 numbered diets differ from OFFICIAL_NUMBERED_DIETS; review the new text"
        )
    return result


Products = list[tuple[str, list[tuple[str, str]]]]


def food_sets(sources: Sources) -> Products:
    """395n rows: (product, [(brutto, netto) for each of the six variants])."""
    table = sources.table(ORDER_395, "Приложение")
    names = table.header[0]
    for variant, needle in zip(VARIANTS, _HEADER_395, strict=True):
        if needle not in names[1 + 2 * variant.column_395].lower():
            raise DietsSourceError(f"395n column {variant.column_395} is not {variant.key}")
    products: Products = []
    for row in table.rows:
        if not row[0].strip():
            continue
        pairs = [(row[1 + 2 * i].strip(), row[2 + 2 * i].strip()) for i in range(len(VARIANTS))]
        products.append((one_line(row[0]), pairs))
    return products


def _is_dash(value: str) -> bool:
    return value.strip() in {"", "-", "—", "–"}


def _split_composition(cell: str) -> tuple[str, str, str]:
    """(total, sub-value, note) of a Table 1 chemical-composition cell."""
    parts = [part for part in cell_lines(cell) if not _DASHES.match(part)]
    if not parts:
        raise DietsSourceError("empty chemical-composition cell")
    total, sub, note = parts[0], "", ""
    for part in parts[1:]:
        inner = part[1:-1] if part.startswith("(") and part.endswith(")") else part
        if not sub and re.fullmatch(r"[\d\s,.\-–]+", inner):
            sub = inner
        else:
            note = (note + " " + inner).strip()
    return total, sub, note


def _with_note(label: str, parts: tuple[str, str, str]) -> str:
    _total, sub, note = parts
    text = f"{label}: {sub}" if sub else ""
    if note:
        text = f"{text}; {note}" if text else note
    return text


def composition_table(row: Sequence[str], header: Sequence[str]) -> list[str]:
    for column, needle in ((4, "Белки"), (5, "Жиры"), (6, "Углеводы"), (7, "Энергетическая")):
        if needle not in header[column]:
            raise DietsSourceError(f"Table 1 column {column} is not {needle}")
    protein, fat, carbohydrate = (_split_composition(row[i]) for i in (4, 5, 6))
    rows = [
        ["Белки, г", protein[0], _with_note("животные", protein)],
        ["Жиры, г", fat[0], _with_note("растительные", fat)],
        ["Углеводы, г", carbohydrate[0], _with_note("моно- и дисахариды", carbohydrate)],
        ["Энергетическая ценность, ккал", one_line(row[7]), ""],
    ]
    return gfm_tables(["Показатель", "В сутки", "В том числе"], rows)


def ratio_rows(sources: Sources) -> dict[str, list[list[str]]]:
    """Table 1a rows per variant: label and the four value cells."""
    table = sources.table(ORDER_330, "Таблица 1а")
    result: dict[str, list[list[str]]] = {}
    current: list[list[str]] | None = None
    for row in table.rows:
        if all(not cell.strip() for cell in row[1:]):
            name = one_line(row[0]).lower()
            variant = next((v for v in VARIANTS if v.match_330 in name), None)
            if variant is None:
                raise DietsSourceError(f"Table 1a: unknown variant row {row[0]!r}")
            current = result.setdefault(variant.key, [])
            continue
        if current is None:
            raise DietsSourceError("Table 1a row before the first variant row")
        current.append([one_line(row[0]), *(one_line(cell) for cell in row[1:])])
    if set(result) != {v.key for v in VARIANTS} or any(len(rows) != 3 for rows in result.values()):
        raise DietsSourceError("Table 1a does not hold three rows for each of six variants")
    return result


@dataclass(frozen=True)
class Nomenclature:
    heading: str
    indications: list[str]
    characteristic: list[str]
    note: str


def _label_key(row: Sequence[str], labels: Sequence[tuple[str, str]]) -> str | None:
    label = cell_lines(row[1])[0].lower()
    matches = [(key, needle) for key, needle in labels if needle in label]
    if not matches:
        return None
    # The most specific identifying text wins ("... белка" is also part of "... белка и ...").
    return max(matches, key=lambda item: len(item[1]))[0]


def nomenclature_rows(
    table: SourceTable,
    labels: Sequence[tuple[str, str]],
    *,
    where: str,
    applied: list[dict[str, str]],
) -> dict[str, Nomenclature]:
    """Rows of 1008n Appendix 2 or 3 by key; official-scan corrections are applied and listed."""
    result: dict[str, Nomenclature] = {}
    for row in table.rows:
        key = _label_key(row, labels)
        if key is None:
            continue
        if key in result:
            raise DietsSourceError(f"{where}: two rows for {key}")
        label = cell_lines(row[1])
        heading, note = label[0], ""
        for extra in label[1:]:
            for correction in CORRECTIONS:
                if correction["where"].startswith(where) and correction["mirror"] in extra:
                    extra = extra.replace(correction["mirror"], correction["official"])
                    applied.append(dict(correction))
            if _ABBREVIATION.match(extra):
                heading = f"{heading} {extra}"
            else:
                note = f"{note} {extra}".strip()
        result[key] = Nomenclature(heading, cell_lines(row[2]), cell_lines(row[3]), note)
    missing = [key for key, _needle in labels if key not in result]
    if missing:
        raise DietsSourceError(f"{where}: no row for {missing}")
    return result


def item_paragraphs(extracted: ExtractedFile) -> dict[int, list[str]]:
    """Items of the 1008n Procedure: number -> paragraphs (continuation lines included)."""
    lines = list(extracted.lines)
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith("1. Настоящий Порядок"))
        stop = next(i for i, line in enumerate(lines) if line.startswith("Приложение N 1"))
    except StopIteration as error:
        raise DietsSourceError("1008n: Procedure items not found") from error
    items: dict[int, list[str]] = {}
    current = 0
    for line in lines[start:stop]:
        text = line.strip()
        if not text:
            continue
        match = re.match(r"^(\d+)\.\s+(.*)$", text)
        if match and int(match.group(1)) == current + 1:
            current = int(match.group(1))
            items[current] = [match.group(2)]
        elif current:
            items[current].append(text)
    return items


def instruction_intro(extracted: ExtractedFile) -> tuple[list[str], list[str]]:
    """(paragraphs, other-diet bullets) of the introduction to the 330 Instruction."""
    lines = [line.strip() for line in extracted.lines]
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith("С целью оптимизации"))
        stop = next(
            i for i, line in enumerate(lines) if line.startswith("Индивидуализация химического")
        )
    except StopIteration as error:
        raise DietsSourceError("330: introduction not found") from error
    block = [line for line in lines[start:stop] if line]
    paragraphs = [line for line in block if not line.startswith("- ")]
    listed = [line[2:] for line in block if line.startswith("- ")]
    if len(paragraphs) != 3 or len(listed) != 4:
        raise DietsSourceError("330: unexpected shape of the introduction")
    return paragraphs, listed


# ---------------------------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------------------------


@dataclass
class _Context:
    sources: Sources
    numbered: dict[str, tuple[str, ...]]
    ratio: dict[str, list[list[str]]]
    products: Products
    adult: dict[str, Nomenclature]
    children: dict[str, Nomenclature]
    items: dict[int, list[str]]
    intro: tuple[list[str], list[str]]
    applied: list[dict[str, str]]
    not_listed: dict[str, int] = field(default_factory=dict[str, int])


def _reference_lines(orders: Sequence[str], detail: dict[str, str]) -> list[str]:
    lines: list[str] = []
    for order in orders:
        line = ORDERS[order]["short"]
        if order in detail:
            line = f"{line}: {detail[order]}"
        lines.append(line)
    return lines


def _variant_document(variant: Variant, context: _Context) -> Document:
    sources = context.sources
    table1 = sources.table(ORDER_330, "Таблица 1")
    row = _find_row(table1.rows, variant.match_330)
    name = one_line(row[0])
    title = (
        f"{name[:-1]}, {variant.abbreviation})"
        if name.endswith(")")
        else f"{name} ({variant.abbreviation})"
    )
    codes = context.numbered[variant.key]
    document = Document(
        key=variant.key,
        title=title,
        short_title=variant.abbreviation,
        source_orders=(ORDER_330, ORDER_395, ORDER_1008),
    )
    document.add(
        1,
        "Номерные диеты",
        [paragraph("Диеты номерной системы: " + ", ".join(table_name(c) for c in codes) + ".")],
        ORDER_330,
        "Приложение №4, таблица 1, графа 2",
    )
    document.add(
        1, "Показания", [bullets(cell_lines(row[2]))], ORDER_330, "Приложение №4, таблица 1"
    )
    document.add(
        1,
        "Общая характеристика, кулинарная обработка",
        [bullets(cell_lines(row[3]))],
        ORDER_330,
        "Приложение №4, таблица 1",
    )
    ratio_table = sources.table(ORDER_330, "Таблица 1а")
    ratio_header = ["Суточный рацион", *(one_line(cell) for cell in ratio_table.header[0][1:])]
    document.add(
        1,
        "Химический состав и энергетическая ценность",
        [
            *composition_table(row, table1.header[0]),
            paragraph(ratio_table.title),
            *gfm_tables(ratio_header, context.ratio[variant.key]),
        ],
        ORDER_330,
        "Приложение №4, таблицы 1 и 1а",
    )
    products, not_listed = _food_rows(context.products, variant.column_395)
    context.not_listed[variant.key] = not_listed
    document.add(
        1,
        "Набор продуктов на одного человека в сутки",
        gfm_tables(["Продукт", "Брутто, г", "Нетто, г"], products),
        ORDER_395,
        "нормы лечебного питания",
    )
    adult = context.adult[variant.key]
    document.add(
        1,
        "Номенклатура для взрослых пациентов",
        [paragraph(adult.heading)],
        ORDER_1008,
        "приложение №2",
    )
    document.add(2, "Показания", [bullets(adult.indications)], ORDER_1008, "приложение №2")
    document.add(
        2,
        "Общая характеристика, кулинарная обработка",
        [bullets(adult.characteristic)],
        ORDER_1008,
        "приложение №2",
    )
    document.reference_lines = _reference_lines(
        (ORDER_330, ORDER_395, ORDER_1008),
        {
            ORDER_330: "Приложение №4, таблицы 1 и 1а",
            ORDER_395: "нормы лечебного питания",
            ORDER_1008: "приложение №2",
        },
    )
    document.metadata = {"dietVariant": variant.abbreviation, "numberedDiets": list(codes)}
    if variant.key == "vkd":
        document.specialties = (*document.specialties, "phthisiology")
    return document


def _food_rows(products: Products, column: int) -> tuple[list[list[str]], int]:
    """Products of one variant; the ones with a dash in both columns are not in its set."""
    rows: list[list[str]] = []
    not_listed = 0
    for name, pairs in products:
        brutto, netto = pairs[column]
        if _is_dash(brutto) and _is_dash(netto):
            not_listed += 1
            continue
        rows.append([name, brutto, netto])
    return rows, not_listed


def _children_document(context: _Context) -> Document:
    document = Document(
        key="children-pregnancy",
        title="Диеты для детей старше 1 года, беременных и кормящих женщин",
        short_title="Диеты детей и беременных",
        source_orders=(ORDER_1008,),
        age_groups=("children", "adolescents", "adults"),
        specialties=("nutrition", "pediatrics", "obstetrics"),
        audience="Дети старше 1 года, беременные и кормящие женщины",
    )
    document.add(
        1,
        "Питание детей, беременных и кормящих женщин",
        [paragraph(text) for text in context.items[10]],
        ORDER_1008,
        "пункт 10",
    )
    for key, _needle in _CHILD_ROWS:
        row = context.children[key]
        document.add(
            1, row.heading, [paragraph(row.note)] if row.note else [], ORDER_1008, "приложение №3"
        )
        document.add(2, "Показания", [bullets(row.indications)], ORDER_1008, "приложение №3")
        document.add(
            2,
            "Общая характеристика, кулинарная обработка",
            [bullets(row.characteristic)],
            ORDER_1008,
            "приложение №3",
        )
    document.reference_lines = _reference_lines(
        (ORDER_1008,), {ORDER_1008: "пункт 10, приложение №3"}
    )
    document.metadata = {"dietVariant": "children-pregnancy"}
    return document


def _norms_document(context: _Context) -> Document:
    header = ["Продукт"]
    for variant in VARIANTS:
        header += [f"{variant.abbreviation} брутто", f"{variant.abbreviation} нетто"]
    rows = [
        [name, *(value for pair in pairs for value in pair)] for name, pairs in context.products
    ]
    document = Document(
        key="norms-395n",
        title="Нормы лечебного питания (приказ №395н)",
        short_title="Нормы лечебного питания",
        source_orders=(ORDER_395, ORDER_70),
    )
    legend = (
        "Граммов на одного человека в сутки, брутто и нетто. "
        + ", ".join(f"{v.abbreviation} — {v.plain}" for v in VARIANTS)
        + "."
    )
    document.add(
        1,
        "Среднесуточный набор продуктов",
        [legend, *gfm_tables(header, rows)],
        ORDER_395,
        "нормы лечебного питания",
    )
    document.reference_lines = _reference_lines(
        (ORDER_395, ORDER_70), {ORDER_395: "нормы лечебного питания"}
    )
    document.metadata = {"dietVariant": "norms"}
    return document


_TABLE_SECTIONS = ("Таблица 2а", "Таблица 3", "Таблица 4", "Таблица 5", "Таблица 6", "Таблица 7")
_CAPTION_GROUP_TABLES = {"Таблица 4", "Таблица 5"}


def _tables_document(sources: Sources) -> Document:
    document = Document(
        key="instruction-tables",
        title="Наборы продуктов и замены (таблицы к инструкции №330)",
        short_title="Таблицы к инструкции №330",
        source_orders=(ORDER_330, ORDER_70),
    )
    document.add(
        1,
        "Статус",
        [
            "Таблицы извлечены автоматически из текста приказа и не сверены построчно "
            "с официальной публикацией."
        ],
        ORDER_330,
        "Приложение №4",
    )
    for key in _TABLE_SECTIONS:
        table = sources.table(ORDER_330, key)
        locator = f"Приложение №4, {key.lower()}"
        section = document.add(1, f"{key}. {table.title}", [], ORDER_330, locator)
        if key == "Таблица 7":
            _substitution_sections(table, document, locator)
        else:
            caption, header, rows = _flat_table(table, captions=key in _CAPTION_GROUP_TABLES)
            if caption:
                section.blocks.append(caption)
            section.blocks.extend(gfm_tables(header, rows))
        document.sections[-1].blocks.extend(paragraph(note) for note in table.notes)
    document.reference_lines = _reference_lines(
        (ORDER_330, ORDER_70),
        {ORDER_330: "Приложение №4, таблицы 2а, 3, 4, 5, 6 и 7"},
    )
    document.metadata = {"dietVariant": "instruction-tables", "machineExtracted": True}
    return document


def _flat_header(table: SourceTable, *, captions: bool) -> tuple[str, list[str]]:
    """(caption, column headers): a ``^<`` header cell repeats the group cell on its left; a group
    over three or more columns becomes the caption when ``captions`` is set."""
    resolved: list[list[str]] = []
    for row in table.header:
        out: list[str] = []
        for cell in row:
            out.append(out[-1] if cell == "^<" and out else ("" if cell == "^<" else cell))
        resolved.append(out)
    width = len(table.header[0])
    caption = ""
    if captions:
        top = [one_line(cell) for cell in resolved[0]]
        for text in dict.fromkeys(top):
            if text and top.count(text) >= 3:
                caption = text
    header: list[str] = []
    for column in range(width):
        parts: list[str] = []
        for row in resolved:
            text = one_line(row[column])
            if text and text != caption and text not in parts and not re.fullmatch(r"\d+", text):
                parts.append(text)
        header.append(": ".join(parts))
    return caption, header


def _expand_row(row: Sequence[str]) -> list[list[str]]:
    """A row whose first cell holds several lines becomes one row per value (label lines end
    with a colon and carry no value)."""
    names = cell_lines(row[0])
    if len(names) <= 1:
        return [[one_line(cell) for cell in row]]
    values = [name for name in names if not name.endswith(":")]
    columns = [cell_lines(cell) for cell in row[1:]]
    if any(len(column) not in {0, len(values)} for column in columns):
        raise DietsSourceError(f"cannot align the multi-line cells of row {row[0]!r}")
    out: list[list[str]] = []
    position = 0
    for name in names:
        if name.endswith(":"):
            out.append([name, *([""] * len(columns))])
            continue
        out.append([name, *(column[position] if column else "" for column in columns)])
        position += 1
    return out


def _flat_table(table: SourceTable, *, captions: bool) -> tuple[str, list[str], list[list[str]]]:
    caption, header = _flat_header(table, captions=captions)
    rows: list[list[str]] = []
    for row in table.rows:
        if all(cell in {"", "^<"} for cell in row):
            continue
        rows.extend(_expand_row(row))
    return caption, header, rows


def _substitution_sections(table: SourceTable, document: Document, locator: str) -> None:
    _caption, header = _flat_header(table, captions=False)
    sections: list[tuple[str, list[list[str]]]] = []
    for row in table.rows:
        if all(cell in {"", "^<"} for cell in row):
            continue
        if all(cell == "^<" for cell in row[1:]) and row[0].strip():
            sections.append((one_line(row[0]), []))
            continue
        if not sections:
            raise DietsSourceError("Table 7 row before the first section heading")
        sections[-1][1].append([one_line(cell) if cell != "^<" else "" for cell in row])
    for name, rows in sections:
        document.add(2, name, gfm_tables(header, rows), ORDER_330, locator)


def _overview_document(context: _Context) -> Document:
    sources = context.sources
    paragraphs, listed = context.intro
    document = Document(
        key="system",
        title="Система стандартных диет: варианты и номерные столы",
        short_title="Стандартные диеты",
        source_orders=(ORDER_330, ORDER_1008),
    )
    table1 = sources.table(ORDER_330, "Таблица 1")
    document.add(
        1,
        "Система стандартных диет",
        [paragraph(paragraphs[0]), paragraph(paragraphs[1])],
        ORDER_330,
        "Приложение №4, введение",
    )
    forward = [
        [
            variant.abbreviation,
            one_line(_find_row(table1.rows, variant.match_330)[0]),
            ", ".join(context.numbered[variant.key]),
        ]
        for variant in VARIANTS
    ]
    document.add(
        1,
        "Варианты и номерные диеты",
        [
            *gfm_tables(["Вариант", "Название", "Диеты номерной системы"], forward),
            "Диета №11 указана в таблице 1 и у ВБД, и у ВКД, как в приказе. "
            "Диеты №12 в таблице нет.",
        ],
        ORDER_330,
        "Приложение №4, таблица 1",
    )
    reverse: dict[str, list[str]] = {}
    for variant in VARIANTS:
        for code in context.numbered[variant.key]:
            reverse.setdefault(code, []).append(variant.abbreviation)
    backward = [
        [table_name(code), ", ".join(reverse[code])] for code in sorted(reverse, key=_sort_key)
    ]
    document.add(
        1,
        "Номерные диеты по номерам",
        gfm_tables(["Диета", "Вариант"], backward),
        ORDER_330,
        "Приложение №4, таблица 1, графа 2",
    )
    document.add(
        1,
        "Другие диеты, применяемые в ЛПУ",
        [paragraph(paragraphs[2]), bullets(listed)],
        ORDER_330,
        "Приложение №4, введение",
    )
    document.add(
        1,
        "Назначение лечебного питания",
        [paragraph(text) for number in (5, 6, 7, 15) for text in context.items[number]],
        ORDER_1008,
        "пункты 5-7 и 15",
    )
    document.reference_lines = _reference_lines(
        (ORDER_330, ORDER_1008, ORDER_70),
        {ORDER_330: "Приложение №4, введение и таблица 1", ORDER_1008: "пункты 5-7 и 15"},
    )
    document.metadata = {"dietVariant": "system"}
    return document


def build_documents(sources: Sources) -> tuple[list[Document], _Context]:
    applied: list[dict[str, str]] = []
    context = _Context(
        sources=sources,
        numbered=numbered_diets(sources),
        ratio=ratio_rows(sources),
        products=food_sets(sources),
        adult=nomenclature_rows(
            sources.table(ORDER_1008, "Приложение N 2"),
            [(v.key, v.match_1008) for v in VARIANTS],
            where="order 1008n, Appendix 2",
            applied=applied,
        ),
        children=nomenclature_rows(
            sources.table(ORDER_1008, "Приложение N 3"),
            _CHILD_ROWS,
            where="order 1008n, Appendix 3",
            applied=applied,
        ),
        items=item_paragraphs(sources.files[ORDER_1008]),
        intro=instruction_intro(sources.files[ORDER_330]),
        applied=applied,
    )
    documents = [_overview_document(context)]
    documents += [_variant_document(variant, context) for variant in VARIANTS]
    documents.append(_children_document(context))
    documents.append(_norms_document(context))
    documents.append(_tables_document(sources))
    names = alias_names(context.numbered)
    for document in documents:
        document.navigation_aliases = [alias for alias, _weight in names.get(document.key, [])]
    return documents, context


# ---------------------------------------------------------------------------------------------
# Rendering and aliases
# ---------------------------------------------------------------------------------------------


def _source_checksum(sources: Sources, document: Document) -> str:
    basis = {order: sources.files[order].sha256 for order in sorted(document.source_orders)}
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(basis, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    )


def render_document(sources: Sources, document: Document) -> str:
    primary = document.source_orders[0]
    urls = sources.urls(primary)
    source_documents: list[dict[str, object]] = []
    for order in document.source_orders:
        details = ORDERS[order]
        source_documents.append(
            {
                "number": details["number"],
                "date": details["date"],
                **({"edition": details["edition"]} if details["edition"] else {}),
                **({"registration": details["registration"]} if details["registration"] else {}),
                **sources.urls(order),
                "extractedSha256": sources.files[order].sha256,
            }
        )
    metadata: dict[str, object] = {
        "id": document.document_id,
        "title": document.title,
        "short_title": document.short_title,
        "version_label": "ed-2024-02-19",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": list(document.specialties),
        "age_groups": list(document.age_groups),
        "source_file": urls["officialSourceUrl"],
        "source_checksum": _source_checksum(sources, document),
        "synthetic_fixture": False,
        "metadata": {
            "authorityTier": "official-regulatory-act",
            "jurisdiction": "RU",
            "publisher": "Минздрав России",
            "documentKind": "приказ",
            "officialSourceUrl": urls["officialSourceUrl"],
            "textMirrorUrl": urls["textMirrorUrl"],
            "sourceDocuments": source_documents,
            "fetchedAt": sources.fetched_at,
            "contentMode": "verbatim",
            "rightsStatus": RIGHTS_STATUS,
            "rightsBasis": RIGHTS_BASIS,
            "publicationState": "preview",
            "calculationRequired": False,
            "clinicalContextRequired": True,
            **({"audienceLabel": document.audience} if document.audience else {}),
            "navigationAliases": document.navigation_aliases,
            **document.metadata,
        },
    }
    blocks: list[str] = []
    for section in document.sections:
        blocks.append("#" * section.level + " " + section.title)
        if section.blocks:
            blocks.append(_source_marker(sources, section))
            blocks.extend(section.blocks)
    blocks.append("# Реквизиты")
    blocks.append("\n".join(f"- {line}" for line in document.reference_lines))
    front = yaml.dump(
        metadata,
        Dumper=_YAML_DUMPER,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=1_000_000,
    ).rstrip()
    return f"---\n{front}\n---\n\n" + "\n\n".join(blocks) + "\n"


def _source_marker(sources: Sources, section: Section) -> str:
    payload = {
        "officialUrl": sources.urls(section.order)["officialSourceUrl"],
        "documentNumber": ORDERS[section.order]["number"],
        "sourceSection": section.locator,
        "contentMode": "verbatim",
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


_NAME_ALIASES: dict[str, tuple[str, ...]] = {
    "ovd": ("ОВД", "ОВД диета", "основной вариант стандартной диеты"),
    "shd": ("ЩД", "щадящая диета", "диета щадящая"),
    "vbd": ("ВБД", "высокобелковая диета", "диета высокобелковая", "высокобелковая"),
    "nbd": ("НБД", "низкобелковая", "низкобелковая диета"),
    "nkd": ("НКД", "низкокалорийная", "низкокалорийная диета"),
    "vkd": ("ВКД", "высококалорийная", "высококалорийная диета"),
    "system": (
        "приказ 330",
        "приказ №330",
        "1008н",
        "приказ 1008н",
        "лечебное питание",
        "стандартные диеты",
        "система стандартных диет",
        "номерные диеты",
    ),
    "norms-395n": ("395н", "приказ 395н", "нормы лечебного питания", "нормы питания"),
    "children-pregnancy": (
        "диета беременных",
        "диета при беременности",
        "питание беременных",
        "питание кормящих",
        "диета кормящих",
        "диеты для детей",
    ),
    "instruction-tables": (
        "замена продуктов",
        "взаимозаменяемость продуктов",
        "таблицы приказа 330",
    ),
}


def alias_names(numbered: dict[str, tuple[str, ...]]) -> dict[str, list[tuple[str, float]]]:
    """Alias texts (and weights) per document key; table numbers point at their variant."""
    result: dict[str, dict[str, tuple[str, float]]] = {}

    def add(key: str, alias: str, weight: float) -> None:
        result.setdefault(key, {}).setdefault(alias.casefold(), (alias, weight))

    for variant in VARIANTS:
        for code in numbered[variant.key]:
            base = base_code(code)
            add(variant.key, f"стол {base}", 1.5)
            if base[:1].isdigit():
                add(variant.key, f"диета номер {base}", 1.3)
    # Numbers that Table 1 does not list on their own.
    add("system", "стол 4", 1.2)
    add("system", "стол 12", 1.2)
    for key, names in _NAME_ALIASES.items():
        for name in names:
            add(key, name, 1.3 if key == "system" else 1.4)
    return {key: list(values.values()) for key, values in result.items()}


def alias_rows(
    documents: Sequence[Document], names: dict[str, list[tuple[str, float]]]
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for document in documents:
        for alias, weight in names.get(document.key, []):
            rows.append(
                {
                    "id": f"diets-{document.key}-"
                    f"{hashlib.sha256(alias.casefold().encode()).hexdigest()[:10]}",
                    "canonicalTerm": document.title,
                    "alias": alias,
                    "category": "reference",
                    "weight": weight,
                }
            )
    return rows


# ---------------------------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------------------------


def prepare_diets_official(raw_root: Path, output: Path) -> PrepareReport:
    sources = load_sources(raw_root)
    documents, context = build_documents(sources)
    rendered = {f"{doc.document_id}.md": render_document(sources, doc) for doc in documents}
    aliases = alias_rows(documents, alias_names(context.numbered))
    digest = hashlib.sha256(
        json.dumps(
            {order: sources.files[order].sha256 for order in sorted(sources.files)}, sort_keys=True
        ).encode()
    ).hexdigest()
    unique_corrections = list({item["where"]: item for item in context.applied}.values())
    report = PrepareReport(
        documents=len(documents),
        aliases=len(aliases),
        tables=sum(
            line.startswith("| --- |") for text in rendered.values() for line in text.splitlines()
        ),
        corrections=unique_corrections,
        sources={order: sources.files[order].sha256 for order in sorted(sources.files)},
        food_set_rows_not_listed=context.not_listed,
        output=str(output),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        manifest_path = output / "manifest.yaml"
        if not manifest_path.is_file() or PACK_ID not in manifest_path.read_text(encoding="utf-8"):
            raise DietsSourceError(f"{output} exists and is not a {PACK_ID} workspace")
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary)
        for name, markdown in rendered.items():
            (workspace / name).write_text(markdown, encoding="utf-8")
        manifest = {
            "id": PACK_ID,
            "version": f"0.1.0-{digest[:8]}",
            "schemaVersion": 2,
            "title": "Лечебное питание: приказы Минздрава России №330, №395н, №1008н",
            "builtAt": sources.fetched_at,
            "publicationState": "local-dev",
        }
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (workspace / "aliases.yaml").write_text(
            yaml.dump(
                {"aliases": aliases},
                Dumper=_YAML_DUMPER,
                allow_unicode=True,
                sort_keys=False,
                width=1_000_000,
            ),
            encoding="utf-8",
        )
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)
    return report


def report_json(report: PrepareReport) -> str:
    return json.dumps(asdict(report), ensure_ascii=False, indent=2)
