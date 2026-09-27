"""Deterministic section classification for official GRLS drug-instruction text.

GRLS instructions are usually PDFs where the section headings ("Состав",
"Показания к применению", "Способ применения и дозы", ...) share the same font
as body text, so the generic PDF heading heuristic in ``pdf_import.py`` cannot
separate them: the whole instruction lands in one or two long paragraphs, with
several distinct clinical sections concatenated inline.

This module re-segments that already-extracted, source-preserving paragraph
text by recognizing the fixed, well-known set of standard instruction heading
phrases used across GRLS instructions. It never rewrites, drops, paraphrases,
or reorders source text: a paragraph is only split at a detected heading
boundary, the exact original text is kept in the resulting pieces, and every
piece keeps the same source span as its parent paragraph (PDF text extraction
does not currently offer finer-than-block bbox precision, so a split cannot
gain sub-block spans that were never recorded).

``GRLS_SECTION_TYPES`` is the fixed vocabulary. ``GRLS_READING_ORDER`` is the
clinician-facing reading order the UI applies when rendering a built
instruction; it is data, not code, so a UI change in reading order never
requires touching this preparer.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

GRLS_SECTION_TYPES: tuple[str, ...] = (
    "composition",
    "indications",
    "contraindications",
    "caution",
    "pregnancy",
    "dosage",
    "adverse-effects",
    "overdose",
    "interactions",
    "special-instructions",
    "pharmacology",
    "release-form",
    "storage",
    "dispensing",
    "registration",
    "other",
)

# Clinician-facing reading order. Purely descriptive metadata: the UI renders
# sections in this order regardless of physical position in the source
# document. Registration/administrative fields sort last by explicit user
# decision (2026-09-27): a patient/doctor wants "how to take it, indications,
# contraindications, composition" first, not a registration number.
GRLS_READING_ORDER: tuple[str, ...] = (
    "dosage",
    "indications",
    "contraindications",
    "caution",
    "composition",
    "adverse-effects",
    "overdose",
    "interactions",
    "special-instructions",
    "pregnancy",
    "pharmacology",
    "release-form",
    "storage",
    "dispensing",
    "registration",
)


@dataclass(frozen=True)
class _HeadingRule:
    section_type: str
    canonical_title: str
    pattern: str  # a phrase pattern fragment, already regex-escaped-ish


# Ordered by descending specificity: a longer/more specific phrase must be
# tried before a shorter phrase it contains (e.g. "Показания к применению"
# before "Показания"), so the canonical title captured is the fullest one
# actually present, and shorter synonyms only catch documents that omit the
# fuller wording.
_RULES: tuple[_HeadingRule, ...] = (
    # --- registration / administrative (sorted last for reading, but the
    # phrases can appear anywhere, including as the very first paragraph of
    # an instruction and inline in every presentation of a registry card) ---
    _HeadingRule("registration", "Регистрационный номер", r"Регистрационн\w*\s+номер"),
    _HeadingRule("registration", "Торговое наименование", r"Торгов\w*\s+наименовани\w*"),
    _HeadingRule(
        "registration",
        "Международное непатентованное наименование",
        r"Международн\w*\s+непатентованн\w*(?:\s+или\s+группировочн\w*)?\s+наименовани\w*",
    ),
    _HeadingRule(
        "registration",
        "Владелец регистрационного удостоверения",
        r"Владелец\s+регистрационн\w*\s+удостоверени\w*(?:\s*/\s*Организаци\w*[^.\n]{0,120})?",
    ),
    _HeadingRule(
        "registration",
        "Организация, принимающая претензии потребителей",
        r"Организаци\w*,?\s+принимающ\w*\s+претензи\w*(?:\s+потребител\w*)?",
    ),
    _HeadingRule("registration", "Производитель", r"Производитель"),
    _HeadingRule(
        "registration",
        "Держатель регистрационного удостоверения",
        r"Держатель\s+регистрационн\w*\s+удостоверени\w*",
    ),
    # --- composition ---
    _HeadingRule("composition", "Состав", r"Состав"),
    _HeadingRule("composition", "Описание", r"Описание"),
    # --- pharmacology (kept as one section_type per the fixed vocabulary) ---
    _HeadingRule(
        "pharmacology", "Фармакотерапевтическая группа", r"Фармакотерапевтическ\w*\s+групп\w*"
    ),
    _HeadingRule("pharmacology", "Фармакологические свойства", r"Фармакологическ\w*\s+свойств\w*"),
    _HeadingRule("pharmacology", "Фармакодинамика", r"Фармакодинамик\w*"),
    _HeadingRule("pharmacology", "Фармакокинетика", r"Фармакокинетик\w*"),
    # --- indications ---
    _HeadingRule("indications", "Показания к применению", r"Показани\w*\s+к\s+применени\w*"),
    _HeadingRule("indications", "Показания", r"Показани\w*"),
    # --- contraindications ---
    _HeadingRule("contraindications", "Противопоказания", r"Противопоказани\w*"),
    # --- caution ---
    _HeadingRule("caution", "С осторожностью", r"С\s+осторожностью"),
    # --- pregnancy ---
    _HeadingRule(
        "pregnancy",
        "Применение при беременности и в период грудного вскармливания",
        r"Применени\w*\s+при\s+беременности(?:\s+и\s+в?\s*период[а-я]*\s+грудного\s+вскармливани\w*)?",
    ),
    _HeadingRule(
        "pregnancy", "Беременность и период лактации", r"Беременность\s+и\s+период\s+лактации"
    ),
    # --- dosage ---
    _HeadingRule(
        "dosage", "Способ применения и дозы", r"Способ\s+применени\w*(?:\s*,?\s*и?\s*доз\w*)?"
    ),
    _HeadingRule("dosage", "Режим дозирования", r"Режим\s+дозировани\w*"),
    # Patient-leaflet ("листок-вкладыш") format headings, a second standard
    # GRLS layout distinct from the professional SPC-style instruction: it
    # numbers sections ("1. Что из себя представляет...", "3. Прием
    # препарата <Name>", ...) and names the same clinical content
    # differently. These leaflet-specific phrases carry no drug name in the
    # matched span (the matcher only needs the fixed leaflet wording).
    _HeadingRule("dosage", "Прием препарата", r"Прием\s+препарата"),
    _HeadingRule("dosage", "Продолжительность терапии", r"Продолжительность\s+терапи\w*"),
    # --- adverse effects ---
    _HeadingRule("adverse-effects", "Побочное действие", r"Побочн\w*\s+действи\w*"),
    _HeadingRule("adverse-effects", "Побочные эффекты", r"Побочн\w*\s+эффект\w*"),
    _HeadingRule(
        "adverse-effects",
        "Сообщение о нежелательных реакциях",
        r"Сообщени\w*\s+о\s+нежелательн\w*\s+реакци\w*",
    ),
    _HeadingRule("adverse-effects", "Нежелательные реакции", r"Нежелательн\w*\s+реакци\w*"),
    # --- overdose ---
    _HeadingRule("overdose", "Передозировка", r"Передозировк\w*"),
    # --- interactions ---
    _HeadingRule(
        "interactions",
        "Взаимодействие с другими лекарственными средствами",
        r"Взаимодействи\w*\s+с\s+другими\s+лекарственн\w*\s+(?:средствами|препаратами)",
    ),
    _HeadingRule(
        "interactions", "Лекарственное взаимодействие", r"Лекарственн\w*\s+взаимодействи\w*"
    ),
    # --- special instructions (including driving/machinery per the fixed
    # vocabulary: it is one section_type, not a separate one) ---
    _HeadingRule("special-instructions", "Особые указания", r"Особ\w*\s+указани\w*"),
    _HeadingRule(
        "special-instructions",
        "Влияние на способность управлять транспортными средствами",
        r"Влияни\w*\s+на\s+способность\s+управлять\s+транспортн\w*\s+средствами(?:\s*,?\s*механизмами)?",
    ),
    # --- release form ---
    _HeadingRule("release-form", "Форма выпуска", r"Форма\s+выпуска"),
    _HeadingRule("release-form", "Содержимое упаковки", r"Содержимое\s+упаковки"),
    # --- storage ---
    _HeadingRule("storage", "Условия хранения", r"Услови\w*\s+хранени\w*"),
    _HeadingRule("storage", "Срок годности", r"Срок\s+годности"),
    _HeadingRule("storage", "Хранение препарата", r"Хранени\w*\s+препарата"),
    # --- dispensing ---
    _HeadingRule("dispensing", "Условия отпуска", r"Услови\w*\s+отпуска(?:\s+из\s+аптек)?"),
)

# An optional numbering prefix ("5.1 ", "12. ") immediately before a heading
# phrase; consumed but not part of the captured canonical title.
_NUMBERING_PREFIX = r"(?:\d{1,2}(?:\.\d{1,2})*\.?\s+)?"

_COMBINED_PATTERN = re.compile(
    r"(?P<boundary>\A|(?<=[.!?»•:])\s*)"
    r"(?P<prefix>" + _NUMBERING_PREFIX + r")"
    r"(?P<phrase>" + "|".join(f"(?:{rule.pattern})" for rule in _RULES) + r")"
    r"(?=[\s:]|\Z)",
    re.UNICODE,
)

# Map each alternative's match text (case/word-ending insensitive) back to its
# rule by re-testing against each individual rule pattern; built lazily.
_RULE_PATTERNS = [
    (re.compile(rule.pattern + r"\Z", re.IGNORECASE | re.UNICODE), rule) for rule in _RULES
]


def _classify_phrase(phrase: str) -> _HeadingRule | None:
    for pattern, rule in _RULE_PATTERNS:
        if pattern.match(phrase):
            return rule
    return None


# Prefix-match variants (no trailing anchor) for classifying an entire
# heading TITLE that a font/layout-based extraction already split out as its
# own real markdown heading (no inline body text to search within): the
# title itself may carry trailing words the phrase pattern does not cover
# (e.g. "Форма выпуска и упаковка"), so a prefix match is enough.
_TITLE_RULE_PATTERNS = [
    (re.compile(r"^" + rule.pattern, re.IGNORECASE | re.UNICODE), rule) for rule in _RULES
]


def classify_grls_heading_title(title: str) -> str | None:
    """Classify an already-separated instruction heading by its title text.

    Used when the PDF's own font/layout distinguished a subheading (so no
    inline body-text boundary needs to be found); returns None for a title
    that matches no known canonical GRLS instruction heading.
    """
    stripped = re.sub(r"^" + _NUMBERING_PREFIX, "", title.strip())
    stripped = stripped.strip(" :—-–")
    for pattern, rule in _TITLE_RULE_PATTERNS:
        if pattern.match(stripped):
            return rule.section_type
    return None


@dataclass(frozen=True)
class HeadingBoundary:
    start: int
    """Offset where the heading phrase begins (after any numbering prefix)."""
    end: int
    """Offset where the heading phrase ends."""
    section_type: str
    canonical_title: str
    matched_text: str


def find_grls_section_boundaries(text: str) -> list[HeadingBoundary]:
    """Find canonical GRLS instruction heading boundaries in ``text``.

    Matching is deterministic and content-based (no PDF layout/font signal):
    a canonical phrase only counts as a boundary at the start of the text or
    immediately after a sentence-ending punctuation mark, optionally preceded
    by a paragraph-numbering prefix, and only when followed by whitespace,
    a colon/dash, a new sentence (capital letter), or the end of the text.
    This avoids matching an incidental mid-sentence mention (e.g. the word
    "производитель" used in ordinary prose elsewhere in the instruction).
    """
    boundaries: list[HeadingBoundary] = []
    last_end = 0
    for match in _COMBINED_PATTERN.finditer(text):
        if match.start("phrase") < last_end:
            continue
        phrase = match.group("phrase")
        rule = _classify_phrase(phrase)
        if rule is None:
            continue
        boundaries.append(
            HeadingBoundary(
                start=match.start("phrase"),
                end=match.end("phrase"),
                section_type=rule.section_type,
                canonical_title=rule.canonical_title,
                matched_text=phrase,
            )
        )
        last_end = match.end("phrase")
    return boundaries


@dataclass(frozen=True)
class ResegmentedPiece:
    text: str
    section_type: str
    """The section_type in force for this piece (the most recent heading
    found at or before this piece, or 'other' if none was found yet)."""
    heading_title: str | None
    """The canonical heading title that starts this piece, or None if this
    piece is leading text before the first recognized heading."""


def resegment_paragraph_text(text: str) -> list[ResegmentedPiece]:
    """Split one paragraph's text at canonical GRLS heading boundaries.

    Returns pieces in original order covering the full original text with no
    characters dropped or reordered (concatenating ``piece.text`` for every
    piece reconstructs the input exactly, aside from the single leading
    space each split point starts a new piece at).
    """
    boundaries = find_grls_section_boundaries(text)
    if not boundaries:
        return [ResegmentedPiece(text=text, section_type="other", heading_title=None)]
    pieces: list[ResegmentedPiece] = []
    if boundaries[0].start > 0:
        leading = text[: boundaries[0].start]
        if leading.strip():
            pieces.append(ResegmentedPiece(text=leading, section_type="other", heading_title=None))
    for index, boundary in enumerate(boundaries):
        piece_end = boundaries[index + 1].start if index + 1 < len(boundaries) else len(text)
        piece_text = text[boundary.start : piece_end]
        pieces.append(
            ResegmentedPiece(
                text=piece_text,
                section_type=boundary.section_type,
                heading_title=boundary.canonical_title,
            )
        )
    return pieces


def instruction_quality_metrics(section_types: Sequence[str | None]) -> dict[str, bool]:
    """Whether the clinically load-bearing sections were recognized at all."""
    present = set(section_types)
    return {
        "hasDosage": "dosage" in present,
        "hasIndications": "indications" in present,
        "hasContraindications": "contraindications" in present,
    }
