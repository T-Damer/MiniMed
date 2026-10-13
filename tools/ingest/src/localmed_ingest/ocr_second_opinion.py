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
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


@dataclass(frozen=True)
class AltLine:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float | None


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


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def matching_alternative(
    box: tuple[float, float, float, float], alternatives: Sequence[AltLine]
) -> AltLine | None:
    """The second engine's line at the same place: same baseline, covering the line's width."""
    x0, y0, x1, y1 = box
    height = max(y1 - y0, 1.0)
    width = max(x1 - x0, 1.0)
    best: tuple[float, AltLine] | None = None
    for alt in alternatives:
        vertical = _overlap(y0, y1, alt.y0, alt.y1) / min(height, max(alt.y1 - alt.y0, 1.0))
        if vertical < MIN_VERTICAL_OVERLAP:
            continue
        horizontal = _overlap(x0, x1, alt.x0, alt.x1) / width
        if horizontal < MIN_HORIZONTAL_COVER or (alt.x1 - alt.x0) > 1.4 * width:
            continue
        if best is None or vertical > best[0]:
            best = (vertical, alt)
    return best[1] if best else None


def choose_reading(vision: str, tesseract: str, lexicon: Lexicon) -> AltInfo | None:
    """Which reading has the better words, and whether the engines disagree about digits."""
    ratio = len(tesseract) / max(len(vision), 1)
    if not LENGTH_RATIO[0] <= ratio <= LENGTH_RATIO[1]:
        return None
    digits_differ = digit_tokens(vision) != digit_tokens(tesseract)
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
