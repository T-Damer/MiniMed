"""Content-based kind of a scanned or OCR-read GRLS instruction document (STATE OCR1).

`grls_groups.classify_document_kind` reads the title page of a clean text layer. A scan breaks
that: stamps land between the title words («ИНСТРУКЦИЯ ПОСЛЕДОВАТЕЛЬНОСТЬ 0001) ПО МЕДИЦИНСКОМУ
ПРИМЕНЕНИЮ»), letters come out as Latin look-alikes, a one-page amendment sheet carries the title
of the instruction it amends.
This classifier folds those artefacts and also looks at what the document contains (how many of the
standard instruction sections, how long it is), so a short amendment sheet is not mistaken for the
instruction itself. Kinds: ``ohlp``, ``leaflet``, ``national-instruction``, ``amendment`` (a page of
changes with «Старая / Новая редакция»), ``other`` (has text, none of the above) and ``unknown``
(no text).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .grls_instruction_sections import find_grls_section_boundaries
from .ocr_text_cleanup import LATIN_TO_CYRILLIC

ContentKind = Literal["ohlp", "leaflet", "national-instruction", "amendment", "other", "unknown"]

#: Kinds of a document that is not an instruction: never a donor of a same-substance fallback.
NON_INSTRUCTION_KINDS: frozenset[str] = frozenset({"amendment", "other"})

_MARKUP = re.compile(r"<!--.*?-->|[#*_|]+", re.DOTALL)
_FOLD = str.maketrans({latin: cyr for latin, cyr in LATIN_TO_CYRILLIC.items()})

_OHLP = re.compile(r"общая\s+характеристика\s+лекарственного\s+препарата|\bохлп\b")
_LEAFLET = re.compile(
    r"листок\W{0,3}\s*вклад\w{1,4}|информаци\w*\s+для\s+(?:пациента|потребител\w*)"
)
_INSTRUCTION = re.compile(
    r"инструкци\w{0,3}.{0,120}?по\s+(?:медицинскому\s+)?применени\w+"
    r"|инструкци\w{0,3}\s*\(информаци\w*\s+для\s+(?:специалист\w*|потребител\w*)\)"
)
_AMENDMENT_TITLE = re.compile(r"изменени\w*\s*(?:№|n\S?)?\s*\d+")
_AMENDMENT_TABLE = re.compile(r"старая\s+редакция|новая\s+редакция|дата\s+внесени\w*\s+изменени\w*")
_NEW_EDITION = re.compile(r"новая\s+редакция")

MIN_FULL_DOCUMENT_WORDS = 300
MIN_FULL_DOCUMENT_SECTIONS = 4


def fold_scan_text(text: str) -> str:
    """Lower-case text with markup removed and Latin look-alike letters read as Cyrillic."""
    value = _MARKUP.sub(" ", text).translate(_FOLD).casefold().replace("ё", "е")
    return re.sub(r"\s+", " ", value).strip()


@dataclass(frozen=True)
class KindEvidence:
    kind: ContentKind
    reason: str
    word_count: int
    section_types: int


def classify_scan_document(text: str, *, page_count: int | None = None) -> KindEvidence:
    """Kind of an instruction document from its text, with the evidence that decided it."""
    body = fold_scan_text(text)
    words = len(re.findall(r"\w+", body))
    if words < 8:
        return KindEvidence("unknown", "no recognisable text", words, 0)
    sections = {
        boundary.section_type for boundary in find_grls_section_boundaries(_MARKUP.sub(" ", text))
    }
    head = body[:6000]
    amendment = bool(_AMENDMENT_TITLE.search(head) and _AMENDMENT_TABLE.search(body))
    full = words >= MIN_FULL_DOCUMENT_WORDS and len(sections) >= MIN_FULL_DOCUMENT_SECTIONS
    if amendment and not full:
        return KindEvidence(
            "amendment", "«Изменение №» with a table of old/new edition", words, len(sections)
        )
    candidates: list[tuple[int, ContentKind, str]] = []
    for pattern, kind, reason in (
        (_OHLP, "ohlp", "title names the summary of product characteristics"),
        (_LEAFLET, "leaflet", "title names the patient leaflet"),
        (_INSTRUCTION, "national-instruction", "title names the instruction for use"),
    ):
        match = pattern.search(head)
        if match:
            candidates.append((match.start(), kind, reason))  # type: ignore[arg-type]
    if candidates:
        _, kind, reason = min(candidates, key=lambda item: item[0])
        return KindEvidence(kind, reason, words, len(sections))
    if full:
        # No title survived the scan but the standard instruction sections are all there.
        leaflet = bool(re.search(r"что из себя представляет", body))
        return KindEvidence(
            "leaflet" if leaflet else "national-instruction",
            "standard instruction sections without a readable title",
            words,
            len(sections),
        )
    if amendment:
        return KindEvidence(
            "amendment", "amendment table inside a longer text", words, len(sections)
        )
    return KindEvidence(
        "other", "text without an instruction title or the standard sections", words, len(sections)
    )
