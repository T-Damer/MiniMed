"""Term/definition boundary for one KR glossary paragraph, and rules that reject bad terms.

A КР «Термины и определения» paragraph reads «Термин – определение». Splitting at the first
dash is wrong whenever the dash sits inside the term itself:

- inside a bracket or a quotation: «Толерантность (лат. – tolerantia, «выносливость») — …»;
- after a list marker or a footnote symbol: «а) простой стеатоз – …», «…# – …»;
- in a score line: «2 балла – 10-19 в 10 полях».

The first extraction cut the term there, which produced titles such as «Толерантность (лат.»,
«балла» or a whole sentence. This module splits only at a dash outside brackets and quotation
marks, peels list markers off the term, and names the defect (never silently repairs) when no
usable term remains. Every function is pure and deterministic; nothing is paraphrased, the
definition text is the source paragraph unchanged.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DASHES = "‐‑‒–—―−"
_OPEN = {"(": ")", "[": "]", "«": "»"}
_CLOSERS = frozenset(_OPEN.values())
# «- » / «• » / «1) » / «а) » / «iv. » before the term itself.
_ENUMERATOR = re.compile(
    r"^\s*(?:[-*•·▪●]+|\(?[0-9]{1,2}[.)]|\(?[а-яa-z][.)]|[ivx]{1,4}[.)])\s+", re.IGNORECASE
)
_PUNCT_ONLY = re.compile(r"^[\W_]+$", re.UNICODE)
MAX_TERM_WORDS = 12
# A lowercase start with one of these is the tail of a list item, never a term.
_FRAGMENT_STARTS = frozenset(
    [
        "со",
        "с",
        "к",
        "ко",
        "в",
        "во",
        "на",
        "по",
        "при",
        "для",
        "без",
        "от",
        "до",
        "из",
        "у",
        "о",
        "об",
        "над",
        "под",
        "за",
        "через",
        "между",
        "или",
        "и",
        "а",
        "но",
        "что",
        "чтобы",
        "который",
        "которая",
        "которое",
        "которые",
        "как",
        "так",
        "тоже",
        "также",
        "если",
        "когда",
        "где",
    ]
)
# Verbs that make a "term" a sentence («Агорафобия происходит от греческого корня…»).
_SENTENCE_MARKERS = re.compile(
    r"\b(?:является|являются|происходит|называют|называется|состоит|используется|"
    r"используют|может|могут|должен|должна|должны|означает|определяется|относится)\b",
    re.IGNORECASE,
)
_SCORE_LINE = re.compile(r"^[+\-–]?\d[\d\s.,\-–/]*\s*(?:балл\w*|%|мм|мг|мл|см)?$", re.IGNORECASE)
_ALIAS_LEAD = re.compile(
    r"^(?:далее\s+по\s+тексту|далее|англ(?:ийск\w+)?|лат(?:инск\w+)?|нем(?:ецк\w+)?|"
    r"фр(?:анцузск\w+)?|греч(?:еск\w+)?|от\s+\w+|син(?:оним\w*)?)\.?\s*[:\-–—]?\s*",
    re.IGNORECASE,
)
# A bracket such as «Регургитация (симптом)» names the kind of term, not another name for it.
_GENERIC_ALIASES = frozenset(
    [
        "симптом",
        "синдром",
        "болезнь",
        "заболевание",
        "термин",
        "состояние",
        "понятие",
        "признак",
        "процесс",
        "метод",
        "операция",
        "препарат",
    ]
)
_ABBREVIATION_TERM = re.compile(r"^[A-ZА-ЯЁ0-9][A-ZА-ЯЁa-zа-яё0-9/\-]{0,8}$")


@dataclass(frozen=True)
class TermSplit:
    """A term/definition pair cut from one paragraph; offsets index the stripped paragraph."""

    term: str
    definition: str
    separator_start: int
    separator_end: int
    flags: tuple[str, ...] = ()


def _depth_zero_separator(paragraph: str) -> tuple[int, int] | None:
    """First dash outside brackets and quotations that stands between two blocks of text.

    A typographic dash needs whitespace on at least one side («В–клеточная» is one word); the
    plain hyphen counts only with whitespace on both sides (compound words such as
    «герминативно-клеточная» keep it).
    """
    stack: list[str] = []
    for index, char in enumerate(paragraph):
        if char in _OPEN:
            stack.append(_OPEN[char])
            continue
        if char in _CLOSERS:
            if stack and stack[-1] == char:
                stack.pop()
            continue
        if stack:
            continue
        if char not in DASHES and char != "-":
            continue
        left_space = index > 0 and paragraph[index - 1].isspace()
        right_space = index + 1 < len(paragraph) and paragraph[index + 1].isspace()
        # «В–клеточная» is one word; «Термин –определение» has a space on one side.
        if not (left_space and right_space if char == "-" else left_space or right_space):
            continue
        before = paragraph[:index].rstrip()
        after = paragraph[index + 1 :].lstrip()
        if before and after:
            return len(before), len(paragraph) - len(after)
    return None


def _naive_separator(paragraph: str) -> tuple[int, int] | None:
    """First dash ignoring brackets; used only to explain an unbalanced source paragraph."""
    match = re.search(rf"\s*[{DASHES}]\s*|\s-\s", paragraph)
    return (match.start(), match.end()) if match else None


def split_term_definition(paragraph: str) -> TermSplit | None:
    """Split «Термин – определение» at the first dash outside brackets and quotations.

    Returns `None` when the paragraph has no usable separator. List markers before the term
    are removed and reported in `flags` (`list-item`); a term that has no bracket-aware dash
    (the source lost a closing bracket) falls back to the first dash and carries
    `unbalanced-source-bracket` so the caller can reject it.
    """
    text = paragraph.strip()
    if not text:
        return None
    flags: list[str] = []
    separator = _depth_zero_separator(text)
    if separator is None:
        separator = _naive_separator(text)
        if separator is None:
            return None
        flags.append("unbalanced-source-bracket")
    start, end = separator
    term = text[:start].strip()
    definition = text[end:].strip()
    while match := _ENUMERATOR.match(term + " "):
        term = term[match.end() :].strip()
        if "list-item" not in flags:
            flags.append("list-item")
    term = term.strip(" \t*#\xad,;:")
    if not term or not definition:
        return None
    return TermSplit(term, definition, start, end, tuple(flags))


@dataclass(frozen=True)
class BracketParts:
    outside: tuple[str, ...]
    inside: tuple[str, ...]


_NAME_BRACKETS = {"(": ")", "[": "]"}


def bracket_parts(value: str) -> BracketParts:
    """Text outside round/square brackets (in order) and the bodies of top-level ones."""
    stack: list[str] = []
    outside: list[str] = []
    inside: list[str] = []
    current: list[str] = []
    closers = frozenset(_NAME_BRACKETS.values())
    for char in value:
        if char in _NAME_BRACKETS:
            if not stack:
                outside.append("".join(current))
                current = []
            else:
                current.append(char)
            stack.append(_NAME_BRACKETS[char])
            continue
        if char in closers and stack and stack[-1] == char:
            stack.pop()
            if not stack:
                inside.append("".join(current))
                current = []
            else:
                current.append(char)
            continue
        current.append(char)
    outside.append("".join(current))
    return BracketParts(tuple(outside), tuple(inside))


def term_defect(term: str) -> str | None:
    """Name the reason a term cannot be a dictionary headword, or `None` when it can."""
    value = term.strip()
    if len(value) < 2:
        return "too-short"
    if value[0] in "…#*†‡§" and _PUNCT_ONLY.match(value):
        return "footnote-marker"
    if _PUNCT_ONLY.match(value):
        return "empty-or-symbol"
    balance = sum(value.count(open_) - value.count(close) for open_, close in _OPEN.items())
    if balance != 0:
        return "unbalanced-bracket"
    bare = " ".join(part.strip() for part in bracket_parts(value).outside).strip()
    if not bare or not any(char.isalpha() for char in bare) or _SCORE_LINE.match(bare):
        return "score-line" if bare else "bracket-only"
    if re.match(r"^\d", bare) and re.search(r"балл", bare, re.IGNORECASE):
        return "score-line"
    words = bare.split()
    if len(words) > MAX_TERM_WORDS or ":" in bare or _SENTENCE_MARKERS.search(bare):
        return "sentence-as-term"
    if bare.endswith((".", "!", "?")) and len(words) > 3:
        return "sentence-as-term"
    if bare[0].islower() and words[0].lower() in _FRAGMENT_STARTS:
        return "fragment-of-list-item"
    return None


@dataclass(frozen=True)
class TermNames:
    """The headword and the names found in its brackets («(ПОЯ)», «англ. ANCA», «син.: …»)."""

    title: str
    aliases: tuple[str, ...]


def _split_outside_quotes(body: str) -> list[str]:
    """Split a bracket body at «;» «,» and «или», never inside «…» quotations."""
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    index = 0
    while index < len(body):
        char = body[index]
        if char == "«":
            depth += 1
        elif char == "»":
            depth = max(0, depth - 1)
        if depth == 0 and char in ";,":
            parts.append("".join(current))
            current = []
        elif depth == 0 and re.match(r"\sили\s", body[index:]):
            parts.append("".join(current))
            current = []
            index += len(" или")
        else:
            current.append(char)
        index += 1
    parts.append("".join(current))
    return parts


def _alias_candidates(body: str) -> list[str]:
    out: list[str] = []
    for part in _split_outside_quotes(body):
        cleaned = _ALIAS_LEAD.sub("", part.strip(" \t.:–—-")).strip(" \t.:–—-")
        if cleaned:
            out.append(cleaned)
    return out


def term_names(term: str) -> TermNames:
    """Headword = the text outside brackets; bracketed abbreviations and synonyms are aliases.

    «Малый для гестационного возраста плод (МГВ, англ. - small for gestational age, SGA)» →
    title «Малый для гестационного возраста плод», aliases «МГВ», «small for gestational age»,
    «SGA». «Катетерная абляция (КА) аритмии» → «Катетерная абляция аритмии», alias «КА».
    A tail «, или атипически … опухоли» becomes one more alias. Nothing is invented: every
    alias is a substring of the term.
    """
    parts = bracket_parts(term.strip())
    head_parts = [part.strip(" ,;:") for part in parts.outside if part.strip(" ,;:")]
    if not head_parts:
        return TermNames(term.strip(), ())
    aliases: list[str] = []
    or_aliases: list[str] = []
    title_parts: list[str] = []
    for part in head_parts:
        if re.match(r"^или\s+", part, re.IGNORECASE):
            or_aliases.append(re.sub(r"^или\s+", "", part, flags=re.IGNORECASE))
        else:
            title_parts.append(part)
    title = " ".join(title_parts).strip()
    for body in parts.inside:
        aliases.extend(_alias_candidates(body))
    aliases.extend(or_aliases)
    unique = [
        alias
        for alias in dict.fromkeys(aliases)
        if alias.lower() != title.lower()
        and 1 < len(alias) <= 140
        and alias.lower() not in _GENERIC_ALIASES
    ]
    return TermNames(title or term.strip(), tuple(unique))


def looks_like_abbreviation_entry(term: str, definition: str) -> bool:
    """«ПМ – продольная меланонихия»: a short acronym with a short expansion, not a concept."""
    bare = " ".join(bracket_parts(term).outside).strip()
    return (
        bool(_ABBREVIATION_TERM.match(bare))
        and sum(1 for char in bare if char.isupper()) >= 2
        and len(definition.split()) <= 8
    )
