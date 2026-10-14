"""A second OCR engine's reading of the lines the first one got wrong (STATE OCR1).

macOS Vision sometimes loses a clearly legible line of a noisy scan (a dosing sentence read as
«мли по 10 г, 20 1,23 банковало ной …»). Tesseract (`tesseract.js`, `rus`+`eng`, page segmentation
3, 300 dpi) reads many of those lines correctly, and the two engines are independent. For every
Vision line that has a Tesseract line at the same place the lexicon decides which reading is the
better *words*; the other reading is kept next to it (`ocrAlternatives`). A disagreement between
the engines about the digits of a line is a reason to mark the
paragraph for review; a number is never chosen by this module, only the line whose words are better.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from .ocr_text_cleanup import Lexicon, normalize_ocr_line

TESSERACT_TOOL = "tesseract.js"
#: Tesseract pages are rendered at this resolution; boxes come back in pixels.
TESSERACT_DPI = 300
MIN_SCORE_GAIN = 2
LENGTH_RATIO = (0.6, 1.7)
MIN_HORIZONTAL_COVER = 0.7
MIN_VERTICAL_OVERLAP = 0.5
_WORD = re.compile(r"[а-яёА-ЯЁ]{4,}")
# A standalone number: not part of a code («L01EA01», «B12», «мг/м2»), where the engines only
# differ in
# look-alike letters.
_NUMBER = re.compile(r"(?<!\w)\d+(?:[.,]\d+)?(?!\w)")


@dataclass(frozen=True)
class AltLine:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float | None
    #: How many lines of the second engine were joined into this one.
    parts: int = 1


@dataclass(frozen=True)
class AltInfo:
    """What the second engine said about one line and what was done with it."""

    other_text: str
    chosen: str  # "vision" | "tesseract"
    digits_differ: bool


def load_alt_lines(path: Path) -> list[AltLine]:
    """Lines of a Tesseract page (`scripts/ocr-tesseract-worker.mjs`), boxes in points."""
    payload = cast(Mapping[str, Any], json.loads(path.read_text(encoding="utf-8")))
    scale = 72.0 / TESSERACT_DPI
    lines: list[AltLine] = []
    for raw in cast(list[Mapping[str, Any]], payload.get("lines", [])):
        text = normalize_ocr_line(str(raw.get("text", "")))
        box = cast(Mapping[str, float], raw.get("bbox") or {})
        if not text or not box:
            continue
        confidence = raw.get("confidence")
        lines.append(
            AltLine(
                text=text,
                x0=float(box["x0"]) * scale,
                y0=float(box["y0"]) * scale,
                x1=float(box["x1"]) * scale,
                y1=float(box["y1"]) * scale,
                confidence=float(confidence) / 100
                if isinstance(confidence, (int, float))
                else None,
            )
        )
    return lines


_LATIN_WORD = re.compile(r"[A-Za-z]{2,}")


def reading_profile(text: str, lexicon: Lexicon) -> tuple[int, int, int]:
    """(known words, unknown words, junk tokens) of a line.

    Words are Cyrillic words of four letters or more; junk is a Latin token the native-text
    lexicon does not know (the noise an engine writes where it cannot read a Cyrillic word).
    """
    words = [w.casefold() for w in _WORD.findall(text)]
    known = sum(1 for w in words if lexicon.cyrillic.get(w, 0) >= 3)
    junk = sum(1 for w in _LATIN_WORD.findall(text) if lexicon.latin.get(w.casefold(), 0) < 3)
    return known, len(words) - known, junk


def line_score(text: str, lexicon: Lexicon) -> int:
    known, unknown, junk = reading_profile(text, lexicon)
    return known - 2 * unknown - junk


def digit_tokens(text: str) -> list[str]:
    return sorted(n.replace(",", ".") for n in _NUMBER.findall(text))


def numbers_conflict(first: str, second: str) -> bool:
    """Each reading has a standalone number the other lacks: a real disagreement about a number.

    A number one engine merely lost (a dropped digit in a unit, a code read with look-alike
    letters) is not a
    conflict; the other reading keeps the number.
    """
    a, b = set(digit_tokens(first)), set(digit_tokens(second))
    return bool(a - b) and bool(b - a)


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def matching_alternative(
    box: tuple[float, float, float, float], alternatives: Sequence[AltLine]
) -> AltLine | None:
    """The second engine's text at the same place, as one line.

    Every line of the second engine that lies inside the box (a Vision observation can span two text
    lines) is joined top to bottom; the result must cover the box's width without running far
    past it.
    """
    x0, y0, x1, y1 = box
    width = max(x1 - x0, 1.0)
    inside: list[AltLine] = []
    for alt in alternatives:
        own_height = max(alt.y1 - alt.y0, 1.0)
        if _overlap(y0, y1, alt.y0, alt.y1) / own_height < MIN_VERTICAL_OVERLAP:
            continue
        if _overlap(x0, x1, alt.x0, alt.x1) / max(alt.x1 - alt.x0, 1.0) < MIN_VERTICAL_OVERLAP:
            continue
        inside.append(alt)
    if not inside:
        return None
    inside.sort(key=lambda alt: (round(alt.y0), alt.x0))
    left, right = min(alt.x0 for alt in inside), max(alt.x1 for alt in inside)
    if _overlap(x0, x1, left, right) / width < MIN_HORIZONTAL_COVER or right - left > 1.4 * width:
        return None
    confidences = [alt.confidence for alt in inside if alt.confidence is not None]
    return AltLine(
        text=" ".join(alt.text for alt in inside),
        x0=left,
        y0=min(alt.y0 for alt in inside),
        x1=right,
        y1=max(alt.y1 for alt in inside),
        confidence=sum(confidences) / len(confidences) if confidences else None,
        parts=len(inside),
    )


def choose_reading(vision: str, tesseract: str, lexicon: Lexicon, parts: int = 1) -> AltInfo | None:
    """Which reading has the better words, and whether the engines disagree about digits."""
    ratio = len(tesseract) / max(len(vision), 1)
    # a Vision observation that spans several text lines is read as several by the other engine
    if not LENGTH_RATIO[0] <= ratio <= LENGTH_RATIO[1] * max(parts, 1):
        return None
    digits_differ = numbers_conflict(vision, tesseract)
    known_v, unknown_v, junk_v = reading_profile(vision, lexicon)
    known_t, unknown_t, junk_t = reading_profile(tesseract, lexicon)
    # fewer unknown words and less junk, no known word given up, and at least one known word to
    # stand on (a line of names only cannot be judged by a lexicon)
    gain = (2 * unknown_v + junk_v) - (2 * unknown_t + junk_t)
    if gain >= MIN_SCORE_GAIN and known_t >= max(1, known_v):
        return AltInfo(other_text=vision, chosen="tesseract", digits_differ=digits_differ)
    if not digits_differ:
        return None  # Vision's reading stands and nothing about a number is in doubt
    return AltInfo(other_text=tesseract, chosen="vision", digits_differ=True)
