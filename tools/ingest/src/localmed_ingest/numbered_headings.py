"""Numbered sub-headings that a clinical recommendation kept as plain paragraphs.

The Minzdrav JSON separates only the top-level sections; deeper headings such as
``1.2.2.1 Эпидемиология`` arrive as ``<p>`` text. This is the deterministic reading rule that
recognises them, shared in spirit with ``apps/app/src/features/library/numbered-headings.ts`` (the
app applies it at display time to modules built before this rule existed; the two are kept in step
by ``tests/test_numbered_headings.py`` and the app's ``numbered-headings.test.ts``).

The rule never rewrites text: a recognised paragraph keeps its exact wording, number included, and
only its block kind changes.
"""

from __future__ import annotations

import re

MAX_LENGTH = 220
MAX_WORDS = 40
QUESTION_MAX_LENGTH = 160
SENTENCE_WORD_LIMIT = 14
CLAUSE_WORD_LIMIT = 8

# 1-2 digit components without a leading zero ("022.1" is a mis-read ICD code, "0.5" a dose).
_NUMBER = r"(?:[1-9]\d?)(?:\.[1-9]\d?){1,5}"
_HEADING = re.compile(rf"^({_NUMBER})\.?[ \t]+(\S.*)$")
_UPPER = "A-ZА-ЯЁ"
_STARTS_AS_QUOTED_TITLE = re.compile(rf"^[«\"(\[]+[{_UPPER}]")
_UNIT_START = re.compile(r"^(?:Мг|Мл|Кг|Гр|МЕ|ЕД|Л|Г)(?![^\W\d_]|\d)")
# Two sentences in one line: a body paragraph that merely begins with its number.
_SENTENCE_BREAK = re.compile(rf"[.!?…][)\"»]?(?:\s+|(?=[{_UPPER}]))[{_UPPER}]")
# Finite phrasing of a recommendation or an instruction, never of a title.
_STATEMENT_VERB = re.compile(
    r"(?:^|\s)(?:рекомендуется|рекомендовано|рекомендуются|следует|необходимо|необходимы|должен|"
    r"должна|должны|допускается|может|могут|проводится|проводят|назначается|назначают|"
    r"применяется|выполняется)(?:\s|[,.;:]|$)"
)
_STATEMENT_START = re.compile(
    r"^(?:Рекомендуется|Рекомендовано|Рекомендуются|Следует|Необходимо|Должен|Должна|Должны|"
    r"Пациент|Пациентам|Пациентов|Больным|Больных)(?:\s|$)"
)
_PRESENT_VERB = re.compile(
    r"[^\W\d_]{3,}(?:ется|ются|ится|ятся|атся|ается|уется|уются|ивается|ываются)(?![^\W\d_])"
)
_INFINITIVE_AFTER_COMMA = re.compile(
    r",\s+[а-яёa-z]{3,}(?:ать|ять|еть|ить|ыть|уть|оть)(?![^\W\d_])"
)
_INFINITIVE_FIRST_WORD = re.compile(
    r"^[А-ЯЁA-Z][а-яёa-z]{3,}(?:ать|ять|еть|ить|ыть|уть|оть)(?![^\W\d_])"
)
_CLAUSE_START = re.compile(r"^(?:Для|При|После|Если|Когда|В случае|Во время|До)\s")
_DOT_LEADERS = re.compile(r"_{4,}|\.{4,}|…{2,}|(?:\.\s){4,}")
_TRAILING_PAGE = re.compile(r"\s\d{1,3}$")


def numbered_heading_depth(paragraph: str) -> int | None:
    """Number of components of a numbered sub-heading ("1.2.2.1 Заголовок" is 4), else ``None``."""
    line = paragraph.strip()
    if not line or len(line) > MAX_LENGTH + 24 or "\n" in line:
        return None
    match = _HEADING.match(line)
    if match is None:
        return None
    number, rest = match.group(1), match.group(2).strip()
    if not rest:
        return None
    first = rest[0]
    if not (first.isupper() or first in '«"(['):
        return None
    if first in "([" and not _STARTS_AS_QUOTED_TITLE.match(rest):
        return None
    if _UNIT_START.match(rest) or len(rest) > MAX_LENGTH:
        return None
    if rest.endswith((";", ",")):
        return None
    if _DOT_LEADERS.search(rest) or _TRAILING_PAGE.search(rest):
        return None
    words = len(rest.split())
    if words > MAX_WORDS:
        return None
    if rest.endswith("?"):
        # Patient-section questions are titles however they are phrased.
        if len(rest) > QUESTION_MAX_LENGTH:
            return None
    else:
        if _SENTENCE_BREAK.search(rest):
            return None
        if _STATEMENT_START.match(rest) or _STATEMENT_VERB.search(rest):
            return None
        if _PRESENT_VERB.search(rest) or _INFINITIVE_AFTER_COMMA.search(rest):
            return None
        if _INFINITIVE_FIRST_WORD.match(rest):
            return None
        if _CLAUSE_START.match(rest) and words > CLAUSE_WORD_LIMIT:
            return None
        if rest.endswith(".") and words > SENTENCE_WORD_LIMIT:
            return None
    return min(6, number.count(".") + 1)
