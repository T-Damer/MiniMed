"""Page-level reconciliation of two readings of a scanned legal act (LEGAL1, docs/research/marker-eval-2026-10-14.md).

Marker (Surya) returns running text with headings and tables but fails silently: a stamped header turns
into a number loop, a table loses rows, a paragraph is cut, a handwritten «н» becomes «4». macOS Vision OCR
(the reader of OCR1) is flat text, but it fails differently. This module compares the two readings of one
page and decides what the page may carry into the prepared text:

* every number (page furniture excluded) must agree; a disputed token is replaced by Vision's reading and
  flagged (the page goes to review), a number only one reading has is flagged with the number;
* silent failures of Marker are detected: runs of consecutive integers or repeated n-grams (loops), a text
  far longer than Vision's, token coverage of Vision's text (dropped lines and paragraphs, cut tails),
  gaps in numbered rows and lists (dropped table rows), and a table row count against Vision's numbered lines;
* the identity of the act (number, date, title) never comes from either reading: it is taken from the portal
  record (`act_identity`, `strip_header_region`).

Everything here is pure (no files, no network). The page-by-page driver is `legal_texts`.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from itertools import pairwise
from typing import Final, Literal

Status = Literal["pass", "review", "reviewed"]
Reading = Literal["marker", "marker+vision-tokens", "vision-fallback", "image-transcription"]
Confidence = Literal["high", "medium", "low"]

ROMAN_PREFIX: Final = "rom:"
_ROMAN_WORD: Final = re.compile(r"I{1,3}|IV|VI{1,3}|V|IX|XI{1,2}|XII")
PAREN_PREFIX: Final = "pl:"
_CYRILLIC_I: Final = str.maketrans("І", "I")  # Cyrillic І (U+0406) for the Roman numeral
_SUPERSCRIPTS: Final = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉", "01234567890123456789")
_TO_SUPERSCRIPT: Final = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
_LOOKALIKE: Final = str.maketrans(
    {
        "A": "А",
        "B": "В",
        "C": "С",
        "E": "Е",
        "H": "Н",
        "K": "К",
        "M": "М",
        "O": "О",
        "P": "Р",
        "T": "Т",
        "X": "Х",
        "Y": "У",
        "a": "а",
        "c": "с",
        "e": "е",
        "o": "о",
        "p": "р",
        "x": "х",
        "y": "у",
    }
)
_TOKEN: Final = re.compile(r"\d+(?:[.,:/]\d+)*|[A-Za-zА-Яа-яЁё]+")
_HTML_TAG: Final = re.compile(r"<[^>]*>")
_HTML_ENTITY: Final = re.compile(r"&[a-zA-Z]+;|&#\d+;")
_IMAGE: Final = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_SUP: Final = re.compile(r"<sup>\s*([^<]*?)\s*</sup>", re.IGNORECASE)
_SUB: Final = re.compile(r"</?sub>", re.IGNORECASE)
_BLOCK_END: Final = re.compile(r"</(?:p|li)>|<li[^>]*>", re.IGNORECASE)
_INLINE_TAG: Final = re.compile(
    r"</?(?:p|b|i|u|em|strong|span|div|ul|ol|li|table|thead|tbody|tr|td|th|a)(?:\s[^>]*)?>",
    re.IGNORECASE,
)
_BR_PEEK: Final = re.compile(r"<br\s*/?>\s*(?=([^<|]{0,8}))", re.IGNORECASE)
_WRAP_TAIL: Final = re.compile(r"[А-ЯЁ]{2,5}(?![а-яёА-ЯЁ])|\d{4}\s*г")
_BR: Final = re.compile(r"<br\s*/?>", re.IGNORECASE)
_DOUBLE_NUMBERED: Final = re.compile(r"^(\s*)\d+\.\s+(\d+[.)]\s)", re.MULTILINE)
_FURNITURE: Final = re.compile(r"^[\s#*_|\\\-–—.()]*\d{1,4}[\s#*_|\\\-–—.()]*$")
_TABLE_ROW: Final = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR: Final = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")

LOOP_INTEGER_RUN: Final = 12
LOOP_REPEAT: Final = 6
DROPPED_SPAN_TOKENS: Final = 6
COVERAGE_VISION_MIN: Final = 0.94
COVERAGE_MARKER_MIN: Final = 0.90
INFLATION_MAX: Final = 1.6
REPEAT_DEFICIT_MIN: Final = 4


@dataclass(frozen=True)
class Token:
    norm: str
    start: int
    end: int
    line: int = 0
    ignore: bool = False
    """A footnote reference mark or a list ordinal: structure, not data (checked by `numbered_gaps`)."""

    @property
    def is_number(self) -> bool:
        return self.norm[:1].isdigit() or self.norm.startswith((ROMAN_PREFIX, PAREN_PREFIX))


@dataclass(frozen=True)
class Flag:
    kind: str
    detail: str


@dataclass
class PageResult:
    page: int
    text: str
    reading: Reading
    status: Status
    confidence: Confidence
    flags: list[Flag] = field(default_factory=list)
    furniture: list[str] = field(default_factory=list)
    stats: dict[str, float | int] = field(default_factory=dict)
    header_removed: str | None = None
    portal_rewrites: list[str] = field(default_factory=list)


# ------------------------------------------------------------------------------------ cleaning


LINE_BREAK_IN_CELL: Final = "\u23ce"
"""Stands for a line break inside a table cell until the cell is rendered (a newline in the rich table)."""


def _flatten_breaks(line: str) -> str:
    """`<br>`, `</p>` and `<li>` are a space in running text and a line break (⏎) inside a table cell."""
    if not line.lstrip().startswith("|"):
        return _BLOCK_END.sub(" ", _BR.sub(" ", line))
    # In a cell a `<br>` is either a visual wrap («пневмококковой<br>инфекции») or the end of an item
    # («…ребенка<br>Сбор анамнеза»): an item ends where the next part starts like a new sentence.
    line = _BR_PEEK.sub(
        lambda m: (
            LINE_BREAK_IN_CELL
            if re.match(r"[A-ZА-ЯЁ0-9•\-–—]", m.group(1)) and not _WRAP_TAIL.match(m.group(1))
            else " "
        ),
        line,
    )
    return _BLOCK_END.sub(LINE_BREAK_IN_CELL, _BR.sub(" ", line))


def _tidy_cell_breaks(line: str) -> str:
    if LINE_BREAK_IN_CELL not in line:
        return line
    line = re.sub(rf"\s*{LINE_BREAK_IN_CELL}[\s{LINE_BREAK_IN_CELL}]*", LINE_BREAK_IN_CELL, line)
    line = re.sub(rf"\|{LINE_BREAK_IN_CELL}", "| ", line)
    return re.sub(rf"{LINE_BREAK_IN_CELL}\|", " |", line)


def clean_marker_markdown(text: str) -> str:
    """Deterministic repairs of Marker's Markdown that do not touch words or numbers."""
    value = text.replace("\xa0", " ").replace("\r\n", "\n")
    value = _IMAGE.sub("", value)
    value = value.replace("\\_", "_")  # form blanks
    value = re.sub(
        r"<(https?://[^>\s]+)>", r"\1", value
    )  # Markdown autolink brackets around a printed address
    value = re.sub(r'<input type="checkbox"\s+checked[^>]*/?>', "☒ ", value)
    value = re.sub(r'<input type="checkbox"[^>]*/?>', "☐ ", value)
    value = re.sub(r"\s*\.{5,}\s*", " ", value)
    value = re.sub(
        r"(?<=[а-яё]о)-[ \t]+(?=[а-яё])", "-", value
    )  # «молекулярно- генетических» (cell wrap)
    value = _SUP.sub(lambda m: m.group(1).translate(_TO_SUPERSCRIPT), value)
    value = _SUB.sub("", value)
    value = "\n".join(_flatten_breaks(line) for line in value.split("\n"))
    value = _INLINE_TAG.sub("", value)
    value = "\n".join(_tidy_cell_breaks(line) for line in value.split("\n"))
    value = "\n".join(
        re.sub(r"(?<=[а-яё])-[ \t]+(?=[а-яё])", "-", line)
        if line.lstrip().startswith("|")
        else line
        for line in value.split("\n")
    )  # «врача- специалиста»: a hyphenated word wrapped inside a table cell
    value = re.sub(r"(?<=\|)[ \t]{2,}|[ \t]{2,}(?=\|)", " ", value)
    value = _DOUBLE_NUMBERED.sub(r"\1\2", value)
    value = re.sub(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$", "", value, flags=re.MULTILINE)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return drop_phantom_columns(value).strip()


def _table_cells(line: str) -> list[str]:
    inner = line.strip()
    inner = inner[1:] if inner.startswith("|") else inner
    inner = inner[:-1] if inner.endswith("|") and not inner.endswith("\\|") else inner
    return re.split(r"(?<!\\)\|", inner)


def _without_phantom(table: list[str]) -> list[str]:
    """One table with its phantom column (empty header cell, empty in every row) removed, or as it was."""
    rows = [_table_cells(line) for line in table]
    body = [row for line, row in zip(table, rows, strict=True) if not _TABLE_SEPARATOR.match(line)]
    if len(body) < 2 or len({len(row) for row in body}) != 1:
        return table
    empty = [index for index, cell in enumerate(body[0]) if not cell.strip()]
    if len(empty) != 1 or len(body[0]) < 3:
        return table
    column = empty[0]
    if column in (0, len(body[0]) - 1):
        return table  # an edge column that is blank in a fragment is a continuation, not a phantom
    if any(row[column].strip() for row in body[1:]):
        return table
    return [
        "|" + "|".join(cell for index, cell in enumerate(row) if index != column) + "|"
        for row in rows
    ]


def drop_phantom_columns(text: str) -> str:
    """Remove the empty column Marker adds to a table whose header has exactly one empty cell.

    A real continuation fragment (the page starts inside a table) has an empty header row with many
    empty cells and is left alone; so is a table where the column carries any text.
    """
    lines = text.split("\n")
    output: list[str] = []
    index = 0
    while index < len(lines):
        if not lines[index].lstrip().startswith("|"):
            output.append(lines[index])
            index += 1
            continue
        end = index
        while end < len(lines) and lines[end].lstrip().startswith("|"):
            end += 1
        output.extend(_without_phantom(lines[index:end]))
        index = end
    return "\n".join(output)


def strip_furniture(lines: list[str]) -> tuple[list[str], list[str]]:
    """Drop printed page numbers (a short number alone on the first or last lines of a page)."""
    kept = list(lines)
    removed: list[str] = []
    for _ in range(3):
        while kept and not kept[0].strip():
            kept.pop(0)
        if kept and _FURNITURE.match(kept[0]):
            removed.append(kept.pop(0).strip())
        else:
            break
    for _ in range(3):
        while kept and not kept[-1].strip():
            kept.pop()
        if kept and _FURNITURE.match(kept[-1]):
            removed.append(kept.pop().strip())
        else:
            break
    return kept, removed


# ------------------------------------------------------------------------------------ tokens


_DIGIT_AS_LETTER: Final = re.compile(r"(?<=[А-ЯЁ])([360])(?!\d{2}|[.,]\d)")
_LETTER_FOR_DIGIT: Final = {"3": "З", "6": "б", "0": "О"}


def _prepare(text: str) -> str:
    """Length-preserving normalisation: markup is blanked, superscripts become digits.

    A digit glued to a Cyrillic capital (3, 6, 0 where OCR means З, б, О: «Ф3» for «ФЗ») is folded back
    to the letter, so that the two readings are not disputed over it; after a lower-case letter the
    digit is a footnote marker and stays.
    """
    value = _HTML_TAG.sub(lambda m: " " * len(m.group()), text)
    value = _HTML_ENTITY.sub(lambda m: " " * len(m.group()), value)
    value = _IMAGE.sub(lambda m: " " * len(m.group()), value)
    value = _DIGIT_AS_LETTER.sub(lambda m: _LETTER_FOR_DIGIT[m.group(1)], value)
    return value.translate(_SUPERSCRIPTS).translate(_CYRILLIC_I)


def _fold(token: str) -> str:
    lowered = token.lower().replace("ё", "е")
    if re.search(r"[а-я]", lowered):
        lowered = lowered.translate(_LOOKALIKE)
    return lowered


_SUP_GLYPHS: Final = "⁰¹²³⁴⁵⁶⁷⁸⁹"
_LINE_LEAD: Final = re.compile(r"^[\s*_#>|•·\-]*$")


def tokenize(
    text: str, line: int = 0, *, vision: bool = False, skip: tuple[str, ...] = ()
) -> list[Token]:
    """Tokens with offsets into `text`. Footnote marks and list ordinals are tokens with `ignore` set.

    Marker writes a footnote mark as a superscript glyph; Vision reads it as a digit glued to the word
    (or as «!», «?»). A list ordinal is a short integer at the start of a line followed by «.» or «)».
    """
    prepared = _prepare(text)
    tokens: list[Token] = []
    skipped: list[tuple[int, int]] = []
    for literal in skip:
        position = text.find(literal)
        while position >= 0:
            skipped.append((position, position + len(literal)))
            position = text.find(literal, position + len(literal))
    for match in _TOKEN.finditer(prepared):
        value = match.group()
        norm = (
            _fold(value.translate(_LOOKALIKE)) if re.search(r"[А-Яа-яЁё]", value) else _fold(value)
        )
        ignore = False
        if _ROMAN_WORD.fullmatch(value):
            # A Roman numeral (group I, II, III …) is data; a dropped «I» changes the meaning of a sentence.
            norm = ROMAN_PREFIX + value.lower()
            before_line = text[text.rfind("\n", 0, match.start()) + 1 : match.start()]
            ignore = bool(_LINE_LEAD.match(before_line)) and bool(
                re.match(r"[.)](?:$|\s)", text[match.end() : match.end() + 2])
            )
        elif (
            len(value) == 1
            and match.start() > 0
            and text[match.start() - 1] == "("
            and text[match.end() : match.end() + 1] == ")"
        ):
            # «II (А)»: the letter that names a group is data
            norm = PAREN_PREFIX + _fold(value.translate(_LOOKALIKE))
        elif norm.isdigit() and len(norm) <= 3:
            start, end = match.start(), match.end()
            line_start = text.rfind("\n", 0, start) + 1
            at_line_start = bool(_LINE_LEAD.match(text[line_start:start]))
            after = text[end : end + 2]
            if text[start] in _SUP_GLYPHS or (at_line_start and re.match(r"[.)](?:$|\s)", after)):
                ignore = True
        if any(a <= match.start() < b for a, b in skipped):
            ignore = True
        tokens.append(Token(norm, match.start(), match.end(), line, ignore))
    return _join_thousands(tokens, prepared)


def _join_thousands(tokens: list[Token], text: str) -> list[Token]:
    """«1 700», «20 000»: groups of three digits after a space are one number (Vision drops the space)."""
    joined: list[Token] = []
    for token in tokens:
        if (
            joined
            and token.norm.isdigit()
            and len(token.norm) == 3
            and joined[-1].norm.isdigit()
            and len(joined[-1].norm) <= 3
            and not joined[-1].ignore
            and text[joined[-1].end : token.start] in (" ", "\u00a0")
        ):
            previous = joined.pop()
            joined.append(
                Token(previous.norm + token.norm, previous.start, token.end, previous.line, False)
            )
        else:
            joined.append(token)
    return joined


def vision_tokens(lines: list[str], skip: tuple[str, ...] = ()) -> list[Token]:
    """Tokens of Vision's lines; `line` is the index of the line, offsets are inside that line."""
    tokens: list[Token] = []
    for index, line in enumerate(lines):
        value = re.sub(r"\bN[º°o]\.?(?=\s*\d)", "№", line)
        tokens.extend(tokenize(value, index, vision=True, skip=skip))
    return tokens


def dehyphenate(lines: list[str]) -> list[str]:
    """Join a word split by a line-end hyphen with its continuation (Vision keeps visual lines).

    A compound («медико-» + «социального») keeps its hyphen, like the text Marker is restored to.
    """
    out: list[str] = []
    for line in lines:
        if out and re.search(r"[А-Яа-яЁё]-$", out[-1]) and re.match(r"[а-яё]", line):
            compound = re.search(r"([А-Яа-яЁё]{4,}о)-$", out[-1]) is not None and re.match(
                r"[а-яё]{4,}", line
            )
            out[-1] = out[-1] + line if compound else out[-1][:-1] + line
        else:
            out.append(line)
    return out


def compound_hyphens(lines: list[str]) -> list[tuple[str, str]]:
    """Word pairs split at a line end whose first part is an adverbial combining form («медико-» + «социального»).

    The official scans hyphenate only compounds, so the hyphen is part of the word. Marker joins such
    a pair («медикосоциального»); `restore_compound_hyphens` puts the hyphen back.
    """
    pairs: list[tuple[str, str]] = []
    for line, following in pairwise(lines):
        first = re.search(r"([А-Яа-яЁё]+)-$", line)
        second = re.match(r"([а-яё]{4,})", following)
        if first and second and first.group(1).lower().endswith("о") and len(first.group(1)) >= 5:
            pairs.append((first.group(1), second.group(1)))
    return pairs


def restore_compound_hyphens(text: str, pairs: list[tuple[str, str]]) -> tuple[str, list[str]]:
    """Put the hyphen back into the words Marker joined (letters are compared after the look-alike fold)."""
    repairs: list[str] = []
    for first, second in pairs:
        joined = _fold(first + second)
        for match in re.finditer(r"[A-Za-zА-Яа-яЁё]+", text):
            if _fold(match.group()) == joined:
                cut = match.start() + len(first)
                text = text[:cut] + "-" + text[cut:]
                repairs.append(f"{first}{second} → {first}-{second}")
                break
    return text, repairs


_ANNEX_LINE: Final = re.compile(
    r"^Приложение\s*[№N]?\s*\d*\s*$|^к\s+(?:Порядку|Положению|приказу|Правилам|Стандарту)\b",
    re.IGNORECASE,
)


def _annex_header_lines(vision_lines: list[str], marker: str) -> str:
    """The right-aligned «Приложение № N / к Порядку …» header of an annex page when Marker lacks it."""
    head = vision_lines[:8]
    if not head or not re.match(r"^Приложение", head[0], re.IGNORECASE):
        return ""
    if re.search(r"Приложение", marker[:400], re.IGNORECASE):
        return ""
    taken = [head[0].strip()]
    for line in head[1:4]:
        if re.match(r"^(?:к|утвержден\w*)\s", line.strip(), re.IGNORECASE) or (
            len(taken) > 1 and line.strip()[:1].islower()
        ):
            taken.append(line.strip())
        else:
            break
    return "  \n".join(taken)


def _countable(token: Token) -> bool:
    return not token.ignore and (token.is_number or len(token.norm) > 1)


def numbers(tokens: list[Token]) -> Counter[str]:
    return Counter(token.norm for token in tokens if token.is_number and not token.ignore)


# ------------------------------------------------------------------------------------ detectors


def _is_numbering_row(text: str, tokens: list[Token]) -> bool:
    """A counting run whose every number is a cell of its own (column numbers, an age header: «| 18 | 19 | 20 |»).

    Marker's counting loop runs inside one cell or paragraph, never as a separate cell per number.
    """
    for token in tokens:
        before = text[: token.start].rstrip(" \t")
        after = text[token.end :].lstrip(" \t")
        if not before.endswith("|") or not after.startswith("|"):
            return False
    return True


def detect_loops(tokens: list[Token], text: str | None = None) -> list[str]:
    """Runs of counting integers (n, n+1, n+2, …) and repeated n-grams: the number-counting loop of Marker.

    A table row of column numbers is not a loop (checked on `text` when it is given); a run of integers
    that does not count up (a table of quantities) never is.
    """
    found: list[str] = []
    run: list[Token] = []
    for token in tokens:
        if token.norm.isdigit() and len(token.norm) <= 3:
            if run and int(token.norm) == int(run[-1].norm) + 1:
                run.append(token)
            else:
                run = [token]
            if len(run) == LOOP_INTEGER_RUN and not (text and _is_numbering_row(text, run)):
                found.append(f"{LOOP_INTEGER_RUN}+ integers counting up near «{run[0].norm}»")
        else:
            run = []
    values = [token.norm for token in tokens]
    for size in (1, 2, 3, 4):
        index = 0
        while index + size * LOOP_REPEAT <= len(values):
            unit = values[index : index + size]
            repeats = 1
            while values[index + repeats * size : index + (repeats + 1) * size] == unit:
                repeats += 1
            if repeats >= LOOP_REPEAT and any(len(item) > 0 for item in unit):
                found.append(f"«{' '.join(unit)}» repeated {repeats} times")
                index += repeats * size
            else:
                index += 1
    return found


def table_rows(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        if _TABLE_ROW.match(line) and not _TABLE_SEPARATOR.match(line):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            rows.append(cells)
    return rows


def _leading_integer(value: str) -> int | None:
    value = value.translate(_SUPERSCRIPTS)
    match = re.match(r"^[\s*_#>\-]*(\d{1,3})\s*[.)]?(?:\s|$)", value)
    return int(match.group(1)) if match else None


def numbered_gaps(marker_text: str, vision_lines: list[str]) -> list[str]:
    """Numbered rows or paragraphs Vision shows and Marker lacks, and gaps inside Marker's own numbering."""
    problems: list[str] = []
    marker_lines = marker_text.splitlines()
    marker_leading: set[int] = set()
    first_column: list[int] = []
    for line in marker_lines:
        if _TABLE_ROW.match(line) and not _TABLE_SEPARATOR.match(line):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            number = _leading_integer(cells[0]) if cells else None
            if number is not None:
                first_column.append(number)
                marker_leading.add(number)
        else:
            number = _leading_integer(line)
            if number is not None:
                marker_leading.add(number)
    if len(first_column) >= 3:
        low, high = min(first_column), max(first_column)
        missing = sorted(set(range(low, high + 1)) - set(first_column))
        if missing and high - low < 200:
            problems.append(f"table numbering skips {', '.join(map(str, missing[:10]))}")
    vision_leading = {
        number for line in vision_lines if (number := _leading_integer(line)) is not None
    }
    if marker_leading and vision_leading:
        low = min(marker_leading)
        high = max(marker_leading)
        absent = sorted(n for n in vision_leading if low <= n <= high and n not in marker_leading)
        if absent:
            problems.append(
                f"Vision has numbered lines {', '.join(map(str, absent[:10]))} that Marker lacks"
            )
    return problems


def _distinct(tokens: list[Token]) -> list[str]:
    return [t.norm for t in tokens if t.is_number or len(t.norm) >= 4]


# ------------------------------------------------------------------------------------ identity

MONTHS_GENITIVE: Final = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


@dataclass(frozen=True)
class ActIdentity:
    """The identifiers of an act as the official portal states them (never read from the scan)."""

    number: str
    date: str
    name: str
    kind_line: str
    registration_number: str | None
    registration_date: str | None

    @property
    def spoken_date(self) -> str:
        year, month, day = self.date.split("-")
        return f"{int(day)} {MONTHS_GENITIVE[int(month) - 1]} {year} г."

    @property
    def reference(self) -> str:
        """How an annex header cites the act: «от 11 апреля 2025 г. № 195н»."""
        return f"от {self.spoken_date} № {self.number}"

    def known_numbers(self) -> frozenset[str]:
        """Numbers of the header block and the registration stamp, which only Vision may have read."""
        values: set[str] = set()
        for source in (self.number, self.registration_number or ""):
            values.update(t.norm for t in tokenize(source) if t.is_number)
        for iso in (self.date, self.registration_date):
            if iso:
                year, month, day = iso.split("-")
                values.update({year, str(int(day)), day, f"{day}.{month}.{year}"})
        return frozenset(values)


def _dotted(iso: str) -> str:
    year, month, day = iso.split("-")
    return f"{day}.{month}.{year}"


def act_identity(record: Mapping[str, object]) -> ActIdentity:
    """Build the identity from a publication.pravo.gov.ru record (`/api/Documents` item)."""
    number = str(record["number"]).strip()
    date = str(record["documentDate"])[:10]
    complex_name = str(record.get("complexName") or "")
    first_line = re.sub(r"\s+", " ", re.split(r"<br\s*/?>|\n", complex_name)[0]).strip()
    name = re.sub(r"\s+", " ", str(record.get("name") or "")).strip().strip('«»"')
    reg_number = record.get("jdRegNumber")
    reg_date = record.get("jdRegDate")
    return ActIdentity(
        number=number,
        date=date,
        name=name,
        kind_line=first_line or f"№ {number} от {_dotted(date)}",
        registration_number=str(reg_number) if reg_number else None,
        registration_date=str(reg_date)[:10] if reg_date else None,
    )


_SELF_REFERENCE: Final = re.compile(
    r"(?P<head>\b(?:Приложение|Утвержден[ыо]?)\b[^.;]{0,260}?\bприказ\w*\b[^.;№]{0,200}?)"
    r"\b(?:от|ot)\s+[^№]{3,60}?[№N][º°o]?\.?[\s*]*(?P<num>\d+(?: ?[A-Za-zА-Яа-я](?![A-Za-zА-Яа-я]))?)(?!\d)(?P<tail>\*?)",
    re.IGNORECASE | re.DOTALL,
)


def canonical_self_references(text: str, identity: ActIdentity) -> tuple[str, list[str]]:
    """Rewrite «Приложение к приказу … от <date> № <number>» to the portal's date and number.

    Typed annex headers cite the act itself; both readings garble them (2015 for 2025, 1954 for 195н).
    Only a citation whose number begins with the act's digits (one misread digit allowed) is rewritten.
    """
    act_digits = re.sub(r"\D", "", identity.number)
    rewrites: list[str] = []

    def replace(match: re.Match[str]) -> str:
        cited = re.sub(r"\D", "", match.group("num"))
        close = len(cited) >= len(act_digits) and sum(
            1 for a, b in zip(act_digits, cited, strict=False) if a != b
        ) <= (1 if len(act_digits) >= 3 else 0)
        if not act_digits or not close:
            return match.group(0)
        tail = match.group("tail")
        span = match.group(0)[len(match.group("head")) : len(match.group(0)) - len(tail)]
        rewrites.append(re.sub(r"\s+", " ", span).strip())
        # an emphasis mark opened inside the citation («*апреля … № 222н*») closes with it
        closes = tail if span.count("*") % 2 == 0 else ""
        return match.group("head") + identity.reference + closes

    return _SELF_REFERENCE.sub(replace, text), rewrites


_PREAMBLE_START: Final = re.compile(
    r"^(?:В соответствии|Во исполнение|На основании|Руководствуясь|В целях|Приказываю)\b",
    re.IGNORECASE,
)


def _title_words(identity: ActIdentity) -> list[str]:
    return [t.norm for t in tokenize(identity.name) if len(t.norm) > 1]


def _header_end(units: list[str], identity: ActIdentity) -> int | None:
    """Index of the first unit (paragraph or line) after the header block, or None.

    The preamble («В соответствии с …») ends the header when it is there; the title's last words
    are searched only above it (they recur in the text of the order). Without a preamble the block
    ends where the portal's name for the act is complete.
    """
    window = units[:30]
    preamble = next(
        (i for i, unit in enumerate(window) if _PREAMBLE_START.match(unit.strip())), None
    )
    words = _title_words(identity)
    if len(words) >= 3:
        tail = " ".join(words[-3:])
        seen: list[str] = []
        for index, unit in enumerate(window[: preamble if preamble is not None else len(window)]):
            seen.extend(t.norm for t in tokenize(unit) if len(t.norm) > 1)
            if tail in " ".join(seen):
                return index + 1
    return preamble


def strip_header_marker(first_page: str, identity: ActIdentity) -> tuple[str, str | None]:
    """Remove the scan's header block (agency, date, number, title) from Marker's first page.

    Returns (remaining text, removed text); removed is None when the end of the header was not found
    (nothing is cut then and the caller flags the page).
    """
    paragraphs = re.split(r"\n\s*\n", first_page)
    end = _header_end(paragraphs, identity)
    if end is None:
        return first_page, None
    return "\n\n".join(paragraphs[end:]).strip(), "\n\n".join(paragraphs[:end])


def strip_header_vision(
    lines: list[str], identity: ActIdentity
) -> tuple[list[str], list[str] | None]:
    """The same cut for Vision's lines."""
    end = _header_end(lines, identity)
    if end is None:
        return lines, None
    return lines[end:], lines[:end]


# ------------------------------------------------------------------------------------ alignment


@dataclass(frozen=True)
class Substitution:
    marker_start: int
    marker_end: int
    old: str
    new: str


@dataclass(frozen=True)
class Dropped:
    text: str
    marker_offset: int
    paragraph_boundary: bool


def _vision_text(lines: list[str], tokens: list[Token], first: int, last: int) -> str:
    """The original Vision text from token `first` to token `last` (inclusive)."""
    begin, end = tokens[first], tokens[last]
    if begin.line == end.line:
        return lines[begin.line][begin.start : end.end]
    parts = [lines[begin.line][begin.start :]]
    parts.extend(lines[begin.line + 1 : end.line])
    parts.append(lines[end.line][: end.end])
    return " ".join(part.strip() for part in parts if part.strip())


def _paragraph_start(text: str, offset: int) -> bool:
    before = text[:offset].rstrip(" \t*_#>|-")
    return before == "" or before.endswith("\n")


@dataclass
class Alignment:
    substitutions: list[Substitution] = field(default_factory=list)
    dropped: list[Dropped] = field(default_factory=list)
    garbled: list[str] = field(default_factory=list)
    respaced: int = 0
    merges: list[Substitution] = field(default_factory=list)


def _one_digit_apart(left: str, right: str) -> bool:
    """Two numbers of the same length that differ in exactly one character (a misread digit)."""
    return len(left) == len(right) and sum(a != b for a, b in zip(left, right, strict=True)) == 1


def align(marker: str, vision_lines: list[str], skip: tuple[str, ...] = ()) -> Alignment:
    """Ordered comparison of Marker's text with Vision's lines.

    * a short replaced span with a number on either side is a disputed token → Vision's reading;
    * a span of Vision text that Marker lacks (≥ 6 tokens, mostly absent from Marker altogether) is a
      dropped passage → Vision's text at that place;
    * a long span the two readings render differently is garbled (flag only);
    * a span that differs only by spaces («пр и казываю») is merged silently.
    """
    prepared_lines = [re.sub(r"\bN[º°o]\.?(?=\s*\d)", "№", line) for line in vision_lines]
    m_tokens = [t for t in tokenize(marker, skip=skip) if not t.ignore]
    all_v = vision_tokens(vision_lines, skip)
    v_tokens = [t for t in all_v if not t.ignore]
    result = Alignment()
    matcher = SequenceMatcher(
        None, [t.norm for t in m_tokens], [t.norm for t in v_tokens], autojunk=False
    )
    marker_bag = {t.norm for t in m_tokens}

    def mostly_absent(span: list[Token]) -> bool:
        distinct = _distinct(span)
        return bool(distinct) and sum(1 for d in distinct if d in marker_bag) / len(distinct) < 0.5

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        m_span = m_tokens[i1:i2]
        v_span = v_tokens[j1:j2]
        if tag == "replace":
            if "".join(t.norm for t in m_span) == "".join(t.norm for t in v_span):
                result.respaced += 1
                if (
                    2 <= len(m_span) <= 3
                    and len(v_span) == 1
                    and len(v_span[0].norm) >= 7
                    and not any(t.is_number for t in m_span)
                    and marker[m_span[0].start : m_span[-1].end].replace(" ", "")
                    == "".join(marker[t.start : t.end] for t in m_span)
                ):
                    start, end = m_span[0].start, m_span[-1].end
                    new = _vision_text(prepared_lines, v_tokens, j1, j1)
                    result.merges.append(Substitution(start, end, marker[start:end], new))
                continue
            numeric = any(t.is_number for t in m_span) or any(t.is_number for t in v_span)
            if numeric and len(m_span) == len(v_span) and len(m_span) <= 4:
                for offset, (m_tok, v_tok) in enumerate(zip(m_span, v_span, strict=True)):
                    if m_tok.norm != v_tok.norm and m_tok.is_number and v_tok.is_number:
                        if m_tok.norm.startswith(ROMAN_PREFIX) != v_tok.norm.startswith(
                            ROMAN_PREFIX
                        ):
                            continue  # a Roman numeral against an Arabic one («I группа» / «1 группа»): flagged, never swapped
                        longer_code = max(len(m_tok.norm), len(v_tok.norm)) >= 5
                        if (
                            len(v_tok.norm) < len(m_tok.norm)
                            or abs(len(m_tok.norm) - len(v_tok.norm)) >= 2
                            or (longer_code and not _one_digit_apart(m_tok.norm, v_tok.norm))
                        ):
                            # Vision's reading replaces Marker's only when it is the same length or one digit
                            # longer (a lost digit): «0,5» / «0,05», «2» / «17». A shorter reading («78» / «8»,
                            # «81000» / «2») or a different long code («184200» / «157600») is a lost digit on
                            # Vision's side or a mis-aligned cell: the image says which reading is right.
                            continue
                        new = _vision_text(prepared_lines, v_tokens, j1 + offset, j1 + offset)
                        old = marker[m_tok.start : m_tok.end]
                        result.substitutions.append(Substitution(m_tok.start, m_tok.end, old, new))
                continue
            if (
                numeric
                and all(t.is_number for t in v_span)
                and all(t.is_number for t in m_span)
                and len(m_span) <= 2
                and len(v_span) <= 2
                and "\n" not in marker[m_span[0].start : m_span[-1].end]
            ):
                start, end = m_span[0].start, m_span[-1].end
                new = _vision_text(prepared_lines, v_tokens, j1, j2 - 1)
                result.substitutions.append(Substitution(start, end, marker[start:end], new))
                continue
        if (
            tag in ("insert", "replace")
            and len(v_span) >= DROPPED_SPAN_TOKENS
            and len(v_span) >= 2 * len(m_span)
        ):
            text = _vision_text(prepared_lines, v_tokens, j1, j2 - 1)
            if mostly_absent(v_span):
                if tag == "insert":
                    offset = m_tokens[i1].start if i1 < len(m_tokens) else len(marker)
                    boundary = i1 >= len(m_tokens) or _paragraph_start(marker, offset)
                    result.dropped.append(Dropped(text, offset, boundary))
                else:
                    result.garbled.append(text[:160])
    return result


# ------------------------------------------------------------------------------------ the page


def _listing(counter: Counter[str]) -> str:
    return ", ".join(
        f"{k.removeprefix(ROMAN_PREFIX).upper() if k.startswith(ROMAN_PREFIX) else k.removeprefix(PAREN_PREFIX)}"
        f"{f'×{n}' if n > 1 else ''}"
        for k, n in sorted(counter.items())
    )


def reconcile_page(
    page: int,
    marker_md: str | None,
    vision_lines: list[str],
    *,
    identity: ActIdentity | None = None,
    substitute: bool = True,
    exact_primary: bool = False,
    inflation_checked: bool = True,
    extra_flags: list[tuple[str, str]] | None = None,
) -> PageResult:
    """Compare Marker's Markdown of one page with Vision's lines and decide what the page carries.

    With `identity` (the portal record) the first page's header block is cut from both readings and
    replaced by the caller with the portal's title, and annex headers that cite the act are rewritten to
    the portal's date and number. Page furniture (printed page numbers) is removed from both readings.
    """
    raw_lines = [line.strip() for line in vision_lines if line.strip()]
    hyphen_pairs = compound_hyphens(raw_lines)
    vision_all = dehyphenate(raw_lines)
    vision_kept, v_furniture = strip_furniture(vision_all)
    flags: list[Flag] = [Flag(kind, detail) for kind, detail in extra_flags or []]
    notes: list[str] = []
    header_removed: str | None = None
    if marker_md is None or not marker_md.strip():
        flags.append(
            Flag("marker-missing", "Marker returned no text for the page; Vision text used")
        )
        return PageResult(
            page, "\n\n".join(vision_kept), "vision-fallback", "review", "low", flags, v_furniture,
            {"visionTokens": len(vision_tokens(vision_kept))},
        )  # fmt: skip
    marker_lines, m_furniture = strip_furniture(clean_marker_markdown(marker_md).splitlines())
    marker = "\n".join(marker_lines).strip()
    marker, hyphen_repairs = restore_compound_hyphens(marker, hyphen_pairs)
    notes.extend(f"hyphen restored: {item}" for item in hyphen_repairs)

    if identity is not None:
        if page == 1:
            marker, header_removed = strip_header_marker(marker, identity)
            vision_kept, vision_head = strip_header_vision(vision_kept, identity)
            if header_removed is None or vision_head is None:
                flags.append(
                    Flag(
                        "header-not-found",
                        "the title of the act was not found in the first page's header",
                    )
                )
        marker, rewrites = canonical_self_references(marker, identity)
        joined, _ = canonical_self_references("\n".join(vision_kept), identity)
        vision_kept = joined.split("\n")
        notes.extend(rewrites)
        known = identity.known_numbers() if page == 1 else frozenset()
    else:
        known = frozenset()

    skip = (identity.reference,) if identity is not None else ()
    m_tokens = tokenize(marker, skip=skip)
    v_tokens = vision_tokens(vision_kept, skip)
    m_countable = [t for t in m_tokens if _countable(t)]
    v_countable = [t for t in v_tokens if _countable(t)]

    loops = detect_loops(m_tokens, marker)
    inflation = len(m_countable) / max(len(v_countable), 1)
    if loops or (inflation_checked and len(v_countable) >= 20 and inflation > INFLATION_MAX):
        detail = (
            "; ".join(loops) if loops else f"Marker text is {inflation:.1f}x longer than Vision's"
        )
        flags.append(Flag("loop", detail))
        return PageResult(
            page, "\n\n".join(vision_kept), "vision-fallback", "review", "low", flags,
            [*m_furniture, *v_furniture],
            {"markerTokens": len(m_tokens), "visionTokens": len(v_tokens)}, header_removed, notes,
        )  # fmt: skip

    alignment = align(marker, vision_kept, skip)
    text = marker
    restored = _annex_header_lines(vision_kept, marker)
    if restored and page > 1:
        text = restored + "\n\n" + text
        marker = text
        flags.append(
            Flag(
                "annex-header-restored", f"Marker dropped the annex header; Vision's: «{restored}»"
            )
        )
    edits: list[tuple[int, int, str]] = []
    for sub in alignment.substitutions if substitute and not exact_primary else []:
        edits.append((sub.marker_start, sub.marker_end, sub.new))
        flags.append(Flag("token-substitution", f"«{sub.old}» (Marker) → «{sub.new}» (Vision)"))
    # A word Marker broke into pieces («пр и казываю») is taken from Vision; not a review item.
    edits.extend((m.marker_start, m.marker_end, m.new) for m in alignment.merges)
    for span in alignment.dropped:
        where = "at a paragraph start" if span.paragraph_boundary else "inside a paragraph"
        flags.append(
            Flag(
                "dropped-span",
                f"Vision reads text that Marker lacks ({where}): «{span.text[:240]}»",
            )
        )
    for fragment in alignment.garbled:
        flags.append(Flag("garbled-span", f"the readings disagree on a passage: «{fragment}»"))
    for start, end, new in sorted(edits, key=lambda e: (e[0], e[1]), reverse=True):
        text = text[:start] + new + text[end:]
    reading: Reading = "marker+vision-tokens" if edits else "marker"

    # Numbers: what remains different after the swaps (stamp numbers the portal explains are excepted).
    v_numbers = numbers(v_tokens)
    m_numbers = numbers(tokenize(text, skip=skip))
    # Footnote marks: Marker writes them as superscripts, Vision reads them as a digit glued to the word;
    # a digit only Vision has is excused up to the number of superscript marks Marker has with that value.
    sup_marks = Counter(
        t.norm for t in tokenize(text, skip=skip) if t.ignore and text[t.start] in _SUP_GLYPHS
    )
    only_vision = Counter(
        {
            k: n - sup_marks[k]
            for k, n in (v_numbers - m_numbers).items()
            if k not in known and n > sup_marks[k]
        }
    )
    only_marker = Counter({k: n for k, n in (m_numbers - v_numbers).items() if k not in known})
    if exact_primary:
        # The first reading is the file's own text: what Vision misses is Vision's failure, not a defect.
        only_marker = Counter()
    if only_vision or only_marker:
        parts: list[str] = []
        if only_vision:
            parts.append("only in Vision: " + _listing(only_vision))
        if only_marker:
            parts.append("only in Marker: " + _listing(only_marker))
        flags.append(Flag("number-mismatch", "; ".join(parts)))

    # Token coverage in both directions (bags: reading order does not matter inside tables).
    v_bag = Counter(t.norm for t in v_countable)
    m_bag = Counter(t.norm for t in m_countable)
    common = sum((v_bag & m_bag).values())
    cov_vision = common / max(sum(v_bag.values()), 1)
    cov_marker = common / max(sum(m_bag.values()), 1)
    # A word Marker has but fewer times than Vision: dropped table rows and lines repeat known words
    # («Первая вакцинация против полиомиелита» lost twice leaves the other rows' words in place).
    repeats = Counter(
        {
            k: n - m_bag[k]
            for k, n in v_bag.items()
            if n > m_bag[k] >= 1 and len(k) >= 5 and not k[0].isdigit()
        }
    )
    if sum(repeats.values()) >= REPEAT_DEFICIT_MIN and cov_vision >= COVERAGE_VISION_MIN:
        flags.append(
            Flag(
                "repeated-content-missing",
                "Vision has these words more often than Marker (dropped rows or lines?): "
                + _listing(repeats),
            )
        )
    if cov_vision < COVERAGE_VISION_MIN:
        sample = ", ".join(k for k, _ in (v_bag - m_bag).most_common(12))
        flags.append(
            Flag(
                "coverage-vision",
                f"Marker lacks {1 - cov_vision:.0%} of Vision's tokens (e.g. {sample})",
            )
        )
    if cov_marker < COVERAGE_MARKER_MIN and not exact_primary:
        sample = ", ".join(k for k, _ in (m_bag - v_bag).most_common(12))
        flags.append(
            Flag(
                "coverage-marker",
                f"{1 - cov_marker:.0%} of Marker's tokens are not in Vision (e.g. {sample})",
            )
        )

    for problem in [] if exact_primary else numbered_gaps(marker, vision_kept):
        flags.append(Flag("numbered-rows", problem))
    if not exact_primary and (lost := page_end_missing(marker, vision_kept)):
        flags.append(
            Flag(
                "page-end-missing",
                f"Vision's last line is not at the end of Marker's page (a dropped last line?): «{lost}»",
            )
        )

    status: Status = "review" if flags else "pass"
    confidence: Confidence = "high" if not flags else "medium"
    if any(f.kind in LOW_CONFIDENCE_KINDS for f in flags):
        confidence = "low"
    stats: dict[str, float | int] = {
        "markerTokens": len(m_tokens),
        "visionTokens": len(v_tokens),
        "coverageVision": round(cov_vision, 4),
        "coverageMarker": round(cov_marker, 4),
        "respaced": alignment.respaced,
        "tableRows": len(table_rows(marker)),
    }
    return PageResult(
        page, text, reading, status, confidence, flags, [*m_furniture, *v_furniture], stats,
        header_removed, notes,
    )  # fmt: skip


def page_end_missing(marker: str, vision_lines: list[str]) -> str:
    """Vision's last line when Marker's page does not end with its last two words, else ''.

    Marker silently drops the last lines of a page (a paragraph, a row of a requirements table); the words of
    the last line are not elsewhere on the page, so the token coverage may not notice it.
    """
    lines = [line for line in vision_lines if line.strip()]
    body = [
        line for line in marker.splitlines() if line.strip() and not _TABLE_SEPARATOR.match(line)
    ]
    if not lines or not body or body[-1].lstrip().startswith("|"):
        return ""  # a table ends the page: its lines come in cell order, not in reading order
    last = lines[-1].strip()

    def words(text: str) -> list[str]:
        return re.findall(r"[а-я]{3,}", text.lower().replace("ё", "е"))

    wanted = words(last)[-2:]
    if len(wanted) < 2:
        return ""
    tail = set(words(marker[-400:]))
    return last if any(word not in tail for word in wanted) else ""


LOW_CONFIDENCE_KINDS: Final = frozenset(
    {
        "cell-vision-only",
        "cell-unread",
        "cell-marker-only",
        "page-end-missing",
        "dropped-span",
        "annex-header-restored",
        "coverage-vision",
        "repeated-content-missing",
        "coverage-marker",
        "garbled-span",
        "numbered-rows",
        "header-not-found",
    }
)


__all__ = [
    "ActIdentity",
    "Alignment",
    "Dropped",
    "Flag",
    "PageResult",
    "Substitution",
    "Token",
    "act_identity",
    "align",
    "canonical_self_references",
    "clean_marker_markdown",
    "dehyphenate",
    "detect_loops",
    "numbered_gaps",
    "numbers",
    "reconcile_page",
    "strip_furniture",
    "strip_header_marker",
    "strip_header_vision",
    "table_rows",
    "tokenize",
    "vision_tokens",
]
