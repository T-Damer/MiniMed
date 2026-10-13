"""Deterministic cleanup rules for OCR text of drug-instruction PDFs (STATE OCR1).

Pure functions, no file or OCR access. Every rule is either a normalisation that cannot change
meaning or a correction proven unambiguous against a lexicon of words seen in native-text-layer
instructions; anything that would be a guess is reported, never applied:

- numbers and units are never edited; `uncertain_numbers` only *finds* tokens an OCR engine
  typically garbles (a letter inside a digit run, a unit that is no unit) so the caller can mark the
  paragraph for review;
- a word is changed only when the unknown OCR spelling has exactly one lexicon spelling reachable by
  the confusions measured on aligned OCR/native pairs (``ь``↔``ъ``, a dropped letter, a Latin
  look-alike inside a Cyrillic word, ...), and the lexicon spelling is common;
- names (capitalised words inside a sentence, the document's own trade name and INN) are skipped.

The caller keeps the raw text next to the cleaned text (`ExtractedBlock.metadata["ocrRaw"]`).
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from .grls_instruction_sections import (
    _RULES as SECTION_RULES,  # pyright: ignore[reportPrivateUsage]
)

CYRILLIC_LETTERS = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
_CYRILLIC_WORD = re.compile(r"[а-яёА-ЯЁ]+(?:-[а-яёА-ЯЁ]+)*")
_WORD_TOKEN = re.compile(r"[A-Za-zА-Яа-яЁё]+")
COMPOUND_TOKEN = re.compile(r"[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*")
_ZERO_WIDTH = re.compile(r"[​‌‍⁠﻿­]")
_ODD_SPACES = re.compile(r"[   -   　\t]")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_NUMERO = re.compile(r"\bN\s?[º°⁰o0]\s*(?=\d)")

# Latin letters that look like a Cyrillic letter, and back.
LATIN_TO_CYRILLIC = {
    "A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О",
    "P": "Р", "T": "Т", "X": "Х", "Y": "У", "a": "а", "c": "с", "e": "е", "o": "о",
    "p": "р", "x": "х", "y": "у", "k": "к", "m": "м", "h": "н", "t": "т", "b": "в",
}  # fmt: skip
CYRILLIC_TO_LATIN = {
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M", "О": "O",
    "Р": "P", "Т": "T", "Х": "X", "У": "Y", "а": "a", "с": "c", "е": "e", "о": "o",
    "р": "p", "х": "x", "у": "y",
}  # fmt: skip

# Substitutions an OCR engine makes between letters, measured on 241 OCR/native pairs of the same
# product (see docs/CURRENT_STATE.md «OCR1»): (wrong, right). Only these are tried.
SUBSTITUTIONS: tuple[tuple[str, str], ...] = (
    ("ь", "ъ"),
    ("н", "п"),
    ("п", "н"),
    ("ш", "п"),
    ("ш", "щ"),
    ("щ", "ш"),
    ("ы", "ь"),
    ("ь", "ы"),
    ("й", "и"),
    ("и", "й"),
    ("г", "т"),
    ("т", "г"),
    ("о", "б"),
    ("л", "д"),
    ("о", "а"),
    ("а", "о"),
    ("с", "е"),
    ("е", "с"),
    ("ьш", "ып"),
    ("ьн", "ыш"),
    ("ьш", "ыш"),
)
MIN_CORRECTION_DOCUMENT_FREQUENCY = 30
MIN_CORRECTABLE_LENGTH = 5
# Grammatical endings differ between real words («-ую»/«-ых»): no edit in the last characters.
ENDING_GUARD = 2


@dataclass(frozen=True)
class Lexicon:
    """Words seen in native-text-layer instructions: word -> number of documents containing it."""

    cyrillic: Mapping[str, int]
    latin: Mapping[str, int] = field(default_factory=dict[str, int])

    @staticmethod
    def from_documents(documents: Iterable[Iterable[str]]) -> Lexicon:
        cyrillic: Counter[str] = Counter()
        latin: Counter[str] = Counter()
        for words in documents:
            seen = {word.casefold() for word in words}
            cyrillic.update(word for word in seen if _is_cyrillic(word))
            latin.update(word for word in seen if _is_latin(word))
        return Lexicon(cyrillic=dict(cyrillic), latin=dict(latin))

    def to_json(self, minimum_documents: int = 2) -> dict[str, dict[str, int]]:
        return {
            "cyrillic": {w: n for w, n in self.cyrillic.items() if n >= minimum_documents},
            "latin": {w: n for w, n in self.latin.items() if n >= minimum_documents},
        }

    @staticmethod
    def from_json(payload: Mapping[str, Mapping[str, int]]) -> Lexicon:
        return Lexicon(cyrillic=dict(payload["cyrillic"]), latin=dict(payload["latin"]))

    def knows(self, word: str, *, minimum: int = 3) -> bool:
        folded = word.casefold()
        return self.cyrillic.get(folded, 0) >= minimum or self.latin.get(folded, 0) >= minimum

    def frequency(self, word: str) -> int:
        folded = word.casefold()
        return self.cyrillic.get(folded, 0) or self.latin.get(folded, 0)


def _is_cyrillic(word: str) -> bool:
    return bool(word) and all(
        character in CYRILLIC_LETTERS or character == "-" for character in word
    )


def _is_latin(word: str) -> bool:
    return bool(word) and word.isascii() and word.isalpha()


def words_of(text: str) -> list[str]:
    return _WORD_TOKEN.findall(text)


# ---------------------------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------------------------


def normalize_ocr_line(text: str) -> str:
    """Unicode and spacing normalisation that cannot change the reading of a line."""
    value = unicodedata.normalize("NFC", text)
    value = _ZERO_WIDTH.sub("", value)
    value = _CONTROL.sub(" ", value)
    value = _ODD_SPACES.sub(" ", value)
    value = _NUMERO.sub("№ ", value)
    return re.sub(r" {2,}", " ", value).strip()


# ---------------------------------------------------------------------------------------------
# Page marks: approval / expert-report stamps stamped over the scan
# ---------------------------------------------------------------------------------------------

_LOOKALIKE_FOLD = str.maketrans(
    {
        "a": "а", "b": "в", "c": "с", "e": "е", "h": "н", "k": "к", "m": "м", "o": "о",
        "p": "р", "t": "т", "x": "х", "y": "у", "u": "и", "r": "г", "n": "п", "l": "1", "i": "1",
        "ё": "е",
    }
)  # fmt: skip

_STAMP_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "expert-report",
        re.compile(
            r"^(?:соответствует|ответствует|сответствует|соответству\w*|соотв\w*)\s+экспертн\w*"
            r"(?:\s+отчет\w*)?\b"
        ),
    ),
    ("expert-report", re.compile(r"^экспертный\s+отчет\b")),
    ("expert-report", re.compile(r"^(?:действителен\s+)?для\s+данной\s*$")),
    ("expert-report", re.compile(r"^версии\s+документа\s*$")),
    ("expert-report", re.compile(r"^действителен\s+для\s+данной\b")),
    ("expert-report", re.compile(r"^\(?входящий\b")),
    ("approval", re.compile(r"^минздрав\s*росси\w*\s*$")),
    ("approval", re.compile(r"^согласовано?\W*$")),
    ("approval", re.compile(r"^согласов[аa]\W{0,2}\s*[оo]\W*$")),
    ("approval", re.compile(r"^мз\s*рф\s*$")),
    ("approval", re.compile(r"^нцэсмп\s*$")),
    ("sequence", re.compile(r"^\(?\s*последовательность\s*\d{3,4}\s*\)?\W*$")),
    (
        "registration",
        re.compile(
            r"^\S{0,4}[-–—\s]*№?\s*\(\d{5,6}\)\s*-\s*\([рp][гr]-?\s*(?:ru|ги)\)(?:\s+от\s+[\d.]+)?\s*$"
        ),
    ),
    ("registration", re.compile(r"^\S{1,4}\s*[-–—]\s*\d{5,6}\s*-\s*\d{6}\s*$")),
    ("expert-report", re.compile(r"^от\s*[\d.]{8,10}\s*(?:№|n\S?)?\s*\d{3,6}\s*$")),
)
_INLINE_SEQUENCE = re.compile(r"\(?\s*ПОСЛЕДОВАТЕЛЬНОСТЬ\s*\d{3,4}\s*\)?", re.IGNORECASE)


def _fold_for_stamp(text: str) -> str:
    return re.sub(r"\s+", " ", text.casefold().translate(_LOOKALIKE_FOLD)).strip()


def stamp_kind(text: str) -> str | None:
    """Which kind of page mark a whole line is (approval stamp, expert-report stamp, ...)."""
    folded = _fold_for_stamp(text)
    if not folded or len(folded) > 90:
        return None
    if re.sub(r"[\s\W]+", "", folded) in {"согласовано", "минздравроссии", "минздравроссий"}:
        return "approval"  # «СОГЛАСО ВА Н О»: the engine split the stamp into word pieces
    for kind, pattern in _STAMP_PATTERNS:
        if pattern.search(folded):
            return kind
    return None


def split_inline_stamp(text: str) -> tuple[str, str | None]:
    """Remove a stamp fragment fused into a heading line («ИНСТРУКЦИЯПОСЛЕДОВАТЕЛЬНОСТЬ 0001)»).

    Returns the remaining text and the removed fragment (None when nothing was fused in).
    """
    match = _INLINE_SEQUENCE.search(text)
    if match is None:
        return text, None
    remainder = (text[: match.start()] + " " + text[match.end() :]).strip()
    return re.sub(r"\s{2,}", " ", remainder), match.group(0).strip()


# ---------------------------------------------------------------------------------------------
# Headings from the standard instruction section list
# ---------------------------------------------------------------------------------------------

_HEADING_NUMBER = re.compile(r"^\s*(?:\d{1,2}(?:\.\d{1,2})*[.)]?\s+)?")
_HEADING_RULES = tuple(
    (rule.canonical_title, re.compile(r"^" + rule.pattern + r"\s*[:.]?\s*$", re.IGNORECASE))
    for rule in SECTION_RULES
)
_LEAFLET_HEADINGS = (
    "что из себя представляет препарат",
    "о чем следует знать перед применением препарата",
    "применение препарата",
    "возможные нежелательные реакции",
    "хранение препарата",
    "содержимое упаковки и прочие сведения",
    "содержимое упаковки и дополнительные сведения",
)


def standard_heading(text: str) -> str | None:
    """Canonical title when the whole line is a standard instruction/leaflet heading, else None."""
    line = text.strip()
    if not line or len(line) > 110 or line.endswith((",", ";")):
        return None
    stripped = _HEADING_NUMBER.sub("", line).strip()
    folded = " ".join(stripped.casefold().rstrip(".: ").split())
    for title, pattern in _HEADING_RULES:
        if pattern.match(stripped):
            return title
    if any(folded.startswith(heading) for heading in _LEAFLET_HEADINGS) and len(folded) < 90:
        return stripped.rstrip(".: ")
    return None


# ---------------------------------------------------------------------------------------------
# Joining lines: hyphenation
# ---------------------------------------------------------------------------------------------

_LAST_WORD = re.compile(r"([A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*)-$")
_FIRST_WORD = re.compile(r"^([A-Za-zА-Яа-яЁё]+)(.*)$", re.DOTALL)


def join_hyphenated(previous: str, following: str, lexicon: Lexicon | None) -> str | None:
    """Join `слово-` + `продолжение` when the join is safe, else None (caller joins with a space).

    Safe means: the next line starts lower-case, and either the glued word is a lexicon word (the
    hyphen was a line-break hyphen) or the hyphenated compound is (the hyphen is part of the word).
    Without a lexicon only the glued form of two fragments that are not words themselves is trusted.
    """
    tail = _LAST_WORD.search(previous.rstrip())
    head = _FIRST_WORD.match(following.lstrip())
    if tail is None or head is None or not head.group(1)[:1].islower():
        return None
    left, right = tail.group(1), head.group(1)
    glued, compound = left + right, f"{left}-{right}"
    if lexicon is not None:
        glued_known = lexicon.knows(glued, minimum=2)
        compound_known = lexicon.knows(compound, minimum=2)
        if glued_known and not compound_known:
            return previous.rstrip()[:-1] + following.lstrip()
        if compound_known and not glued_known:
            return previous.rstrip() + following.lstrip()
        return None
    if len(left) >= 3 and len(right) >= 2:
        return previous.rstrip()[:-1] + following.lstrip()
    return None


# ---------------------------------------------------------------------------------------------
# Word corrections
# ---------------------------------------------------------------------------------------------

# Pharmacokinetic symbols whose Latin letters an OCR engine reads as Cyrillic look-alikes. The
# cyrillic spellings are not Russian words, so the replacement is unambiguous.
PHARMACOKINETIC_SYMBOLS: Mapping[str, str] = {
    "стах": "Cmax", "сmах": "Cmax", "cmах": "Cmax", "смах": "Cmax", "сmax": "Cmax",
    "тmах": "Tmax", "tmах": "Tmax", "ттах": "Tmax", "тmax": "Tmax", "тах": "Tmax",
    "аис": "AUC", "аuc": "AUC", "auc": "AUC",
    "сmin": "Cmin", "сmіn": "Cmin", "cmin": "Cmin", "смin": "Cmin",
    "сss": "Css", "ссs": "Css",
}  # fmt: skip
# `тах` alone is too short to be safe; `аис` is a real abbreviation spelling (СПИД variants) in
# Russian text. Both are dropped from the active table below.
_ACTIVE_SYMBOLS = {
    key: value for key, value in PHARMACOKINETIC_SYMBOLS.items() if key not in {"тах", "аис", "auc"}
}
_ATC = re.compile(r"\bATX\b")


@dataclass(frozen=True)
class WordEdit:
    before: str
    after: str
    rule: str


@dataclass
class CleanedText:
    text: str
    edits: list[WordEdit] = field(default_factory=list[WordEdit])


def _restore_case(original: str, replacement: str) -> str:
    if original.isupper() and len(original) > 1:
        return replacement.upper()
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def _candidates(word: str) -> set[str]:
    """Spellings one measured OCR confusion away from `word` (lower-case)."""
    found: set[str] = set()
    for wrong, right in SUBSTITUTIONS:
        start = 0
        while True:
            index = word.find(wrong, start)
            if index < 0:
                break
            if index + len(wrong) <= len(word) - ENDING_GUARD:
                found.add(word[:index] + right + word[index + len(wrong) :])
            start = index + 1
    # a dropped letter
    if len(word) >= MIN_CORRECTABLE_LENGTH:
        for index in range(1, len(word) - ENDING_GUARD + 1):
            for letter in CYRILLIC_LETTERS:
                found.add(word[:index] + letter + word[index:])
    return found


def correct_word(
    word: str, lexicon: Lexicon, *, protected: frozenset[str] = frozenset()
) -> str | None:
    """The unique lexicon spelling of an unknown Cyrillic word, or None.

    None when the word is known, short, protected (the document's own names), or has no / more than
    one candidate among common lexicon words.
    """
    folded = word.casefold()
    if (
        len(folded) < MIN_CORRECTABLE_LENGTH
        or not _is_cyrillic(folded)
        or lexicon.knows(folded)
        or folded in protected
        or (any(character.isupper() for character in word[1:]) and not word.isupper())
    ):
        return None
    hits = {
        candidate
        for candidate in _candidates(folded)
        if lexicon.cyrillic.get(candidate, 0) >= MIN_CORRECTION_DOCUMENT_FREQUENCY
    }
    if len(hits) != 1:
        return None
    return _restore_case(word, next(iter(hits)))


def _lookalike(character: str, index: int, word: str) -> str:
    mapped = LATIN_TO_CYRILLIC.get(character, character)
    # a capital Latin letter inside a lower-case word is a lower-case letter read as its look-alike
    if index > 0 and not word.isupper() and character in LATIN_TO_CYRILLIC:
        return mapped.lower()
    return mapped


def unify_script(word: str, lexicon: Lexicon) -> str | None:
    """Make a mixed Latin/Cyrillic word one script when exactly one reading is a lexicon word."""
    has_latin = any(character.isascii() and character.isalpha() for character in word)
    has_cyrillic = any(character.casefold() in CYRILLIC_LETTERS for character in word)
    if not (has_latin and has_cyrillic):
        return None
    if has_latin and not has_cyrillic:
        return None  # an all-Latin token is Latin unless it is the ATC abbreviation (clean_words)
    if all(
        character in LATIN_TO_CYRILLIC or character.casefold() in CYRILLIC_LETTERS
        for character in word
    ):
        as_cyrillic = "".join(
            _lookalike(character, index, word) for index, character in enumerate(word)
        )
        cyrillic_ok = lexicon.cyrillic.get(as_cyrillic.casefold(), 0) >= 3
        if not cyrillic_ok:
            return None
        as_latin = "".join(CYRILLIC_TO_LATIN.get(character, character) for character in word)
        latin_ok = lexicon.latin.get(as_latin.casefold(), 0) >= 3 if as_latin.isascii() else False
        return as_cyrillic if not latin_ok else None
    return None


def clean_words(
    text: str, lexicon: Lexicon | None, *, protected: Iterable[str] = ()
) -> CleanedText:
    """Apply the word-level rules to one paragraph; every change is listed in `edits`."""
    edits: list[WordEdit] = []
    guard = frozenset(word.casefold() for word in protected)
    sentence_start = True

    def replace(match: re.Match[str]) -> str:
        nonlocal sentence_start
        word = match.group(0)
        at_start = sentence_start
        sentence_start = False
        folded = word.casefold()
        symbol = _ACTIVE_SYMBOLS.get(folded)
        if symbol is not None and symbol != word:
            edits.append(WordEdit(word, symbol, "pharmacokinetic-symbol"))
            return symbol
        if word == "ATX":
            edits.append(WordEdit(word, "АТХ", "latin-lookalike"))
            return "АТХ"
        if lexicon is None:
            return word
        if word[:1].isupper() and not at_start and not word.isupper():
            return word  # a name inside a sentence
        unified = unify_script(word, lexicon)
        if unified is not None and unified != word:
            edits.append(WordEdit(word, unified, "latin-lookalike"))
            return unified
        corrected = correct_word(word, lexicon, protected=guard)
        if corrected is not None:
            edits.append(WordEdit(word, corrected, "lexicon-confusion"))
            return corrected
        return word

    pieces: list[str] = []
    last = 0
    for match in _CYRILLIC_OR_LATIN.finditer(text):
        pieces.append(text[last : match.start()])
        gap = text[last : match.start()]
        if re.search(r"[.!?]\s*$", gap) or last == 0:
            sentence_start = True
        pieces.append(replace(match))
        last = match.end()
    pieces.append(text[last:])
    return CleanedText("".join(pieces), edits)


_CYRILLIC_OR_LATIN = re.compile(r"[A-Za-zА-Яа-яЁё]+")

# ---------------------------------------------------------------------------------------------
# Numbers: find, never fix
# ---------------------------------------------------------------------------------------------

# A token made only of digits, separators and look-alikes of 0 / 1 («1О», «5l0»): a number the engine
# misread. Alphanumeric names («50S», «CYP2B6», «2B6») and postal codes are not flagged.
_DIGIT_LOOKALIKES = re.compile(r"^(?=.*\d)(?=.*[OoОоlIІ])[\dOoОоlIІ.,/%-]{2,}$")
_NUMBER_UNIT = re.compile(
    r"(?<![\w.,])(\d+(?:[.,]\d+)?)\s*([A-Za-zА-Яа-яµμ]{1,3})(?![A-Za-zА-Яа-яµμ])"
)
KNOWN_UNITS = frozenset(
    {
        "мг", "мкг", "г", "кг", "мл", "л", "мкл", "дл", "ме", "ед", "ммоль", "мкмоль", "моль",
        "ч", "час", "часа", "часов", "мин", "сут", "сек", "с", "мм", "см", "м", "дн", "дней",
        "дня", "день", "нед", "мес", "год", "лет", "года", "раз", "раза", "таб", "капс", "доз",
        "доза", "дозы", "шт", "мкм", "нм", "нг", "пг", "ккал", "дж", "вт", "па", "град", "kg", "mg",
        "ml", "g", "mcg", "iu", "mm", "cm", "u", "ie", "мэкв", "моли", "мосм",
        "мпа", "кпа", "ммрт", "мккат", "и", "в", "до", "от", "на", "по", "к", "у", "а",
        "см2", "м2", "кг/м2", "мг/кг", "мг/мл", "мкг/мл", "мг/л", "г/л", "мл/мин", "ед/мл",
    }
)  # fmt: skip
_UNIT_HEAD = re.compile(r"^[A-Za-zА-Яа-яµμ]+")


def uncertain_numbers(text: str, lexicon: Lexicon | None = None) -> list[str]:
    """Number-like tokens whose reading the OCR engine may have garbled (never corrected).

    A digit run with a look-alike letter in it («1О», «5l0») or a number followed by a one-to-three
    letter unit that is neither a unit nor a word («500 мr», «25 Mr»).
    """
    found: list[str] = []
    for raw in text.split():
        token = raw.strip("()[];:«»\"'")
        if _DIGIT_LOOKALIKES.match(token) and not token.isalpha():
            found.append(token)
    for match in _NUMBER_UNIT.finditer(text):
        unit = match.group(2).casefold()
        if match.group(2).isupper() or unit in KNOWN_UNITS:
            continue  # «50S», «2B», «105Б» are names and house numbers, not misread units
        if lexicon is not None and lexicon.knows(unit, minimum=3):
            continue
        found.append(match.group(0))
    return list(dict.fromkeys(found))
