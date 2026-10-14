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
from typing import Final, Literal

Status = Literal["pass", "review", "reviewed"]
Reading = Literal["marker", "marker+vision-tokens", "vision-fallback"]
Confidence = Literal["high", "medium", "low"]

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
        return self.norm[:1].isdigit()


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


def clean_marker_markdown(text: str) -> str:
    """Deterministic repairs of Marker's Markdown that do not touch words or numbers."""
    value = text.replace("\xa0", " ").replace("\r\n", "\n")
    value = _IMAGE.sub("", value)
    value = _SUP.sub(lambda m: m.group(1).translate(_TO_SUPERSCRIPT), value)
    value = _SUB.sub("", value)
    value = _BR.sub(" ", value)
    value = _DOUBLE_NUMBERED.sub(r"\1\2", value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


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
    return value.translate(_SUPERSCRIPTS)


def _fold(token: str) -> str:
    lowered = token.lower().replace("ё", "е")
    if re.search(r"[а-я]", lowered):
        lowered = lowered.translate(_LOOKALIKE)
    return lowered


_SUP_GLYPHS: Final = "⁰¹²³⁴⁵⁶⁷⁸⁹"
_LINE_LEAD: Final = re.compile(r"^[\s*_#>|•·\-]*$")


def tokenize(text: str, line: int = 0, *, vision: bool = False) -> list[Token]:
    """Tokens with offsets into `text`. Footnote marks and list ordinals are tokens with `ignore` set.

    Marker writes a footnote mark as a superscript glyph; Vision reads it as a digit glued to the word
    (or as «!», «?»). A list ordinal is a short integer at the start of a line followed by «.» or «)».
    """
    prepared = _prepare(text)
    tokens: list[Token] = []
    for match in _TOKEN.finditer(prepared):
        value = match.group()
        norm = (
            _fold(value.translate(_LOOKALIKE)) if re.search(r"[А-Яа-яЁё]", value) else _fold(value)
        )
        ignore = False
        if norm.isdigit() and len(norm) <= 3:
            start, end = match.start(), match.end()
            line_start = text.rfind("\n", 0, start) + 1
            at_line_start = bool(_LINE_LEAD.match(text[line_start:start]))
            after = text[end : end + 2]
            if text[start] in _SUP_GLYPHS or (at_line_start and re.match(r"[.)]($|\s)|$", after)):
                ignore = True
        tokens.append(Token(norm, match.start(), match.end(), line, ignore))
    return tokens


def vision_tokens(lines: list[str]) -> list[Token]:
    """Tokens of Vision's lines; `line` is the index of the line, offsets are inside that line."""
    tokens: list[Token] = []
    for index, line in enumerate(lines):
        value = re.sub(r"\bN[º°o]\.?(?=\s*\d)", "№", line)
        tokens.extend(tokenize(value, index, vision=True))
    return tokens


def dehyphenate(lines: list[str]) -> list[str]:
    """Join a word split by a line-end hyphen with its continuation (Vision keeps visual lines)."""
    out: list[str] = []
    for line in lines:
        if out and re.search(r"[А-Яа-яЁё]-$", out[-1]) and re.match(r"[а-яё]", line):
            out[-1] = out[-1][:-1] + line
        else:
            out.append(line)
    return out


def _countable(token: Token) -> bool:
    return not token.ignore and (token.is_number or len(token.norm) > 1)


def numbers(tokens: list[Token]) -> Counter[str]:
    return Counter(token.norm for token in tokens if token.is_number and not token.ignore)


# ------------------------------------------------------------------------------------ detectors


def detect_loops(tokens: list[Token]) -> list[str]:
    """Runs of consecutive integers and repeated n-grams: the number-counting loop of Marker."""
    found: list[str] = []
    run = 0
    for index, token in enumerate(tokens):
        if token.norm.isdigit():
            run += 1
            if run == LOOP_INTEGER_RUN:
                found.append(f"{LOOP_INTEGER_RUN}+ integers in a row near token {index - run + 1}")
        else:
            run = 0
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
    r"\bот\s+[^№\n]{3,48}?[№N][º°o]?\s*(?P<num>\d+(?: ?[A-Za-zА-Яа-я](?![A-Za-zА-Яа-я]))?)(?!\d)",
    re.IGNORECASE | re.DOTALL,
)


def canonical_self_references(text: str, identity: ActIdentity) -> tuple[str, list[str]]:
    """Rewrite «Приложение к приказу … от <date> № <number>» to the portal's date and number.

    Typed annex headers cite the act itself; both readings garble them (2015 for 2025, 1954 for 195н).
    Only a citation whose number begins with the act's digits is rewritten.
    """
    act_digits = re.sub(r"\D", "", identity.number)
    rewrites: list[str] = []

    def replace(match: re.Match[str]) -> str:
        cited = re.sub(r"\D", "", match.group("num"))
        if not act_digits or not cited.startswith(act_digits):
            return match.group(0)
        rewrites.append(re.sub(r"\s+", " ", match.group(0)[len(match.group("head")) :]).strip())
        return match.group("head") + identity.reference

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


def align(marker: str, vision_lines: list[str]) -> Alignment:
    """Ordered comparison of Marker's text with Vision's lines.

    * a short replaced span with a number on either side is a disputed token → Vision's reading;
    * a span of Vision text that Marker lacks (≥ 6 tokens, mostly absent from Marker altogether) is a
      dropped passage → Vision's text at that place;
    * a long span the two readings render differently is garbled (flag only);
    * a span that differs only by spaces («пр и казываю») is merged silently.
    """
    prepared_lines = [re.sub(r"\bN[º°o]\.?(?=\s*\d)", "№", line) for line in vision_lines]
    m_tokens = [t for t in tokenize(marker) if not t.ignore]
    all_v = vision_tokens(vision_lines)
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
                continue
            numeric = any(t.is_number for t in m_span) or any(t.is_number for t in v_span)
            if numeric and len(m_span) == len(v_span) and len(m_span) <= 4:
                for offset, (m_tok, v_tok) in enumerate(zip(m_span, v_span, strict=True)):
                    if m_tok.norm != v_tok.norm and (m_tok.is_number or v_tok.is_number):
                        new = _vision_text(prepared_lines, v_tokens, j1 + offset, j1 + offset)
                        old = marker[m_tok.start : m_tok.end]
                        result.substitutions.append(Substitution(m_tok.start, m_tok.end, old, new))
                continue
            if (
                numeric
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
    return ", ".join(f"{k}×{n}" if n > 1 else k for k, n in sorted(counter.items()))


def reconcile_page(
    page: int,
    marker_md: str | None,
    vision_lines: list[str],
    *,
    identity: ActIdentity | None = None,
    substitute: bool = True,
) -> PageResult:
    """Compare Marker's Markdown of one page with Vision's lines and decide what the page carries.

    With `identity` (the portal record) the first page's header block is cut from both readings and
    replaced by the caller with the portal's title, and annex headers that cite the act are rewritten to
    the portal's date and number. Page furniture (printed page numbers) is removed from both readings.
    """
    vision_all = dehyphenate([line.strip() for line in vision_lines if line.strip()])
    vision_kept, v_furniture = strip_furniture(vision_all)
    flags: list[Flag] = []
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

    m_tokens = tokenize(marker)
    v_tokens = vision_tokens(vision_kept)
    m_countable = [t for t in m_tokens if _countable(t)]
    v_countable = [t for t in v_tokens if _countable(t)]

    loops = detect_loops(m_tokens)
    inflation = len(m_countable) / max(len(v_countable), 1)
    if loops or (len(v_countable) >= 20 and inflation > INFLATION_MAX):
        detail = (
            "; ".join(loops) if loops else f"Marker text is {inflation:.1f}x longer than Vision's"
        )
        flags.append(Flag("loop", detail))
        return PageResult(
            page, "\n\n".join(vision_kept), "vision-fallback", "review", "low", flags,
            [*m_furniture, *v_furniture],
            {"markerTokens": len(m_tokens), "visionTokens": len(v_tokens)}, header_removed, notes,
        )  # fmt: skip

    alignment = align(marker, vision_kept)
    text = marker
    edits: list[tuple[int, int, str]] = []
    for sub in alignment.substitutions if substitute else []:
        edits.append((sub.marker_start, sub.marker_end, sub.new))
        flags.append(Flag("token-substitution", f"«{sub.old}» (Marker) → «{sub.new}» (Vision)"))
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
    m_numbers = numbers(tokenize(text))
    # Footnote marks: Marker writes them as superscripts, Vision reads them as a digit glued to the word;
    # a digit only Vision has is excused up to the number of superscript marks Marker has with that value.
    sup_marks = Counter(t.norm for t in tokenize(text) if t.ignore and text[t.start] in _SUP_GLYPHS)
    only_vision = Counter(
        {
            k: n - sup_marks[k]
            for k, n in (v_numbers - m_numbers).items()
            if k not in known and n > sup_marks[k]
        }
    )
    only_marker = Counter({k: n for k, n in (m_numbers - v_numbers).items() if k not in known})
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
    if cov_vision < COVERAGE_VISION_MIN:
        sample = ", ".join(k for k, _ in (v_bag - m_bag).most_common(12))
        flags.append(
            Flag(
                "coverage-vision",
                f"Marker lacks {1 - cov_vision:.0%} of Vision's tokens (e.g. {sample})",
            )
        )
    if cov_marker < COVERAGE_MARKER_MIN:
        sample = ", ".join(k for k, _ in (m_bag - v_bag).most_common(12))
        flags.append(
            Flag(
                "coverage-marker",
                f"{1 - cov_marker:.0%} of Marker's tokens are not in Vision (e.g. {sample})",
            )
        )

    for problem in numbered_gaps(marker, vision_kept):
        flags.append(Flag("numbered-rows", problem))

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


LOW_CONFIDENCE_KINDS: Final = frozenset(
    {
        "dropped-span",
        "coverage-vision",
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
