"""Symbol/Wingdings glyphs that a PDF text layer or a DOCX run keeps in the private-use area.

Word writes a bullet as a character of the *Symbol* or *Wingdings* font, so a PDF made from it has
the text layer ``U+F0B7`` (Symbol bullet), ``U+F02D`` (Symbol minus used as a dash bullet),
``U+F0A7`` / ``U+F0D8`` / ``U+F0FC`` (Wingdings square, arrow, check mark), ``U+F0B3`` (≥),
``U+F0B0`` (°) and so on. No Android/WebView font has those code points, so every one of them was
shown as a «tofu» box. This module turns each glyph into what it meant:

* a list marker (a bullet, a dash bullet, a numbered Wingdings circle) becomes a real Markdown list
  item (``- text`` / ``1. text``); markers that a PDF block joined into one line
  («...; <bullet> next item; <bullet> one more») start a new item;
* a mathematical or typographic Symbol glyph (greater-or-equal, plus-minus, multiplication sign,
  degree, registered/trademark signs, Greek letters, ...) becomes the Unicode character;
* a PUA space is a space.

Nothing is dropped: a marker with no text behind it stays a ``•``, and a glyph this module does not
know stays as it is (``unmapped_private_use`` lists them for a report).

The rules read only the text. PDF spans know their font (``translate_span`` uses it for the Greek
letters of the Symbol font); a prepared Markdown file or an old extraction JSON does not, so the
same context rules (line start, whitespace around the glyph, the character before it) serve both.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

PUA_RANGE = "-"
_PUA = re.compile(f"[{PUA_RANGE}]")
PUA_SPACE = ""
_PUA_SPACE_RUN = re.compile(f"[ \\t]*{PUA_SPACE}[ \\t{PUA_SPACE}]*")

# Adobe Symbol font encoding (code point = U+F000 + Symbol code) for the glyphs a medical text
# uses, plus the Wingdings glyphs whose Symbol meaning is a math fragment no text ever uses.
_GLYPHS: dict[int, str] = {
    0xF021: "!",
    0xF023: "#",
    0xF025: "%",
    0xF026: "&",
    0xF028: "(",
    0xF029: ")",
    0xF02A: "*",
    0xF02B: "+",
    0xF02C: ",",
    0xF02D: "\u2013",
    0xF02E: ".",
    0xF02F: "/",
    0xF03A: ":",
    0xF03B: ";",
    0xF03C: "<",
    0xF03D: "=",
    0xF03E: ">",
    0xF03F: "?",
    0xF05B: "[",
    0xF05D: "]",
    0xF05F: "_",
    0xF07B: "{",
    0xF07C: "|",
    0xF07D: "}",
    0xF07E: "~",
    0xF0A0: "\u20ac",
    0xF0A1: "\u03d2",
    0xF0A2: "\u2032",
    0xF0A3: "\u2264",
    0xF0A4: "\u2044",
    0xF0A5: "\u221e",
    0xF0A6: "\u0192",
    0xF0A7: "\u25aa",
    0xF0A8: "\u2666",
    0xF0A9: "\u2665",
    0xF0AA: "\u2660",
    0xF0AB: "\u2194",
    0xF0AC: "\u2190",
    0xF0AD: "\u2191",
    0xF0AE: "\u2192",
    0xF0AF: "\u2193",
    0xF0B0: "\u00b0",
    0xF0B1: "\u00b1",
    0xF0B2: "\u2033",
    0xF0B3: "\u2265",
    0xF0B4: "\u00d7",
    0xF0B5: "\u221d",
    0xF0B6: "\u2202",
    0xF0B7: "\u00b7",
    0xF0B8: "\u00f7",
    0xF0B9: "\u2260",
    0xF0BA: "\u2261",
    0xF0BB: "\u2248",
    0xF0BC: "\u2026",
    0xF0BD: "|",
    0xF0BE: "\u2013",
    0xF0BF: "\u21b5",
    0xF0C0: "\u2135",
    0xF0C2: "\u25bc",
    0xF0C4: "\u2297",
    0xF0C5: "\u2295",
    0xF0C6: "\u2205",
    0xF0C7: "\u2229",
    0xF0C8: "\u222a",
    0xF0C9: "\u2283",
    0xF0CA: "\u2287",
    0xF0CB: "\u2284",
    0xF0CC: "\u2282",
    # Symbol 0xCD is a subset sign, but both texts use it as the multiplication sign of the AUC dose
    # formula (the Calvert formula).
    0xF0CD: "\u00d7",
    0xF0CE: "\u2208",
    0xF0CF: "\u2209",
    0xF0D0: "\u2220",
    0xF0D1: "\u2207",
    0xF0D2: "\u00ae",
    0xF0D3: "\u00a9",
    0xF0D4: "\u2122",
    0xF0D5: "\u220f",
    0xF0D6: "\u221a",
    0xF0D7: "\u00b7",
    0xF0D8: "\u27a2",
    0xF0D9: "\u2227",
    0xF0DA: "\u2228",
    0xF0DB: "\u21d4",
    0xF0DC: "\u21d0",
    0xF0DD: "\u21d1",
    0xF0DE: "\u21d2",
    0xF0DF: "\u21d3",
    0xF0E0: "\u2192",
    0xF0E2: "\u00ae",
    0xF0E3: "\u00a9",
    0xF0E4: "\u2122",
    0xF0E5: "\u2211",
    0xF0E8: "\u2192",
    0xF0E9: "\u21d9",
    0xF0F0: "\u21e8",
    0xF0F2: "\u222b",
    0xF0F9: "\u21d7",
    0xF0FB: "\u2717",
    0xF0FC: "\u2713",
    0xF09F: "\u2022",
    # A questionnaire check box (Wingdings) and the alpha of a font that puts it at 0xE1.
    0xF07F: "\u2610",
    0xF0E1: "\u03b1",
    # Adobe Corporate Use area: the serif/sans trademark signs and the dash-like arrow extender.
    0xF6D9: "\u00a9",
    0xF6DA: "\u00ae",
    0xF6DB: "\u2122",
    0xF8E7: "\u2013",
    0xF8E8: "\u00ae",
    0xF8E9: "\u00a9",
    0xF8EA: "\u2122",
}
_SYMBOL_UPPER = (
    0x0391,
    0x0392,
    0x03A7,
    0x0394,
    0x0395,
    0x03A6,
    0x0393,
    0x0397,
    0x0399,
    0x03D1,
    0x039A,
    0x039B,
    0x039C,
    0x039D,
    0x039F,
    0x03A0,
    0x0398,
    0x03A1,
    0x03A3,
    0x03A4,
    0x03A5,
    0x03C2,
    0x03A9,
    0x039E,
    0x03A8,
    0x0396,
)
_SYMBOL_LOWER = (
    0x03B1,
    0x03B2,
    0x03C7,
    0x03B4,
    0x03B5,
    0x03C6,
    0x03B3,
    0x03B7,
    0x03B9,
    0x03D5,
    0x03BA,
    0x03BB,
    0x03BC,
    0x03BD,
    0x03BF,
    0x03C0,
    0x03B8,
    0x03C1,
    0x03C3,
    0x03C4,
    0x03C5,
    0x03D6,
    0x03C9,
    0x03BE,
    0x03C8,
    0x03B6,
)
for _offset, _letter in enumerate(_SYMBOL_UPPER):
    _GLYPHS[0xF041 + _offset] = chr(_letter)
for _offset, _letter in enumerate(_SYMBOL_LOWER):
    _GLYPHS[0xF061 + _offset] = chr(_letter)
for _digit in range(10):
    _GLYPHS[0xF030 + _digit] = str(_digit)
# Wingdings circled digits one to ten (0x81-0x8A).
_CIRCLED = {0xF081 + index: chr(0x2460 + index) for index in range(10)}
_GLYPHS.update(_CIRCLED)

_GREEK_LETTER_CODES = frozenset(range(0xF041, 0xF05B)) | frozenset(range(0xF061, 0xF07B))
#: Wingdings glyphs that Word offers as bullets, and the Symbol bullet: a list marker anywhere a
#: whitespace-delimited one stands.
_STRONG_MARKERS = frozenset(
    {0xF0B7, 0xF0A7, 0xF0D8, 0xF0FC, 0xF09F, 0xF0E0, 0xF0E8, 0xF0C2, 0xE12C}
)
#: Letters of the Symbol font (`l`, `v`, `q`, `n`) that Wingdings draws as ● ❖ ❑ ■: a marker only at
#: the start of a line, never inside a sentence, where they are Greek letters.
_LINE_START_MARKERS = frozenset({0xF06C, 0xF076, 0xF071, 0xF06E, 0xF0D7, 0xF0A8})
#: Dash-like glyphs: a bullet at the line start or after the end of an item, a dash in a sentence.
_DASH_MARKERS = frozenset({0xF02D, 0xF0BE, 0xF8E7})
_NUMBER_MARKERS = frozenset(_CIRCLED)
_ITEM_END = ".;:,)!?»…"
_WHITESPACE = " \t "


def has_private_use(text: str) -> bool:
    return _PUA.search(text) is not None


def unmapped_private_use(text: str) -> list[str]:
    """Private-use characters of ``text`` the module has no reading for (one entry per kind)."""
    known = set(_GLYPHS) | _STRONG_MARKERS | _LINE_START_MARKERS | _DASH_MARKERS | {0xF020}
    return sorted({character for character in _PUA.findall(text) if ord(character) not in known})


def translate_span(text: str, font: str | None) -> str:
    """Spans of the Symbol font: its letters are Greek letters, never list markers.

    ``Symbol`` and ``SymbolMT`` encode ``l``, ``v``, ``q``, ``n`` as lambda, nu, theta and nu; a
    span of that font is mapped at once so that the line-start rule of ``repair_text`` (which
    reads the same code points as Wingdings bullets) cannot turn a real letter into a list item.
    """
    if not font or not _PUA.search(text):
        return text
    name = font.lower()
    if "symbol" not in name or "wingdings" in name:
        return text
    return "".join(
        _GLYPHS.get(ord(character), character)
        if ord(character) in _GREEK_LETTER_CODES
        else character
        for character in text
    )


def _inline(code: int, previous: str, following: str) -> str | None:
    """The character a glyph stands for inside a sentence, ``None`` when it is not known."""
    if code == 0xF02D:
        # A minus sign before a number at the start of a group, otherwise a dash or a range.
        if (not previous or previous in " (") and following.isdigit():
            return "\u2212"
        return "\u2013"
    return _GLYPHS.get(code)


def _marker_bullet(
    code: int,
    *,
    at_start: bool,
    delimited: bool,
    previous: str,
    list_glyph: int | None,
) -> bool:
    if code in _NUMBER_MARKERS or code in _STRONG_MARKERS:
        return at_start or delimited
    if code in _LINE_START_MARKERS:
        return at_start and delimited
    if code in _DASH_MARKERS:
        if not delimited:
            return False
        return at_start or previous in _ITEM_END or list_glyph == code
    # A glyph of a custom bullet font that opens a line before words is a bullet as well.
    return at_start and delimited and code not in _GLYPHS


def _marker_text(code: int, number: int) -> str:
    return f"{number}. " if code in _NUMBER_MARKERS else "- "


def _repair_line(line: str, *, split_items: bool) -> list[str]:
    line = _PUA_SPACE_RUN.sub(" ", line)
    if not _PUA.search(line):
        return [line.rstrip()] if line.strip() else [""]
    stripped = line.lstrip(_WHITESPACE)
    first_glyph = ord(stripped[0]) if stripped and _PUA.match(stripped[0]) else None
    lines: list[str] = []
    current: list[str] = []
    for index, character in enumerate(line):
        if not _PUA.match(character):
            current.append(character)
            continue
        code = ord(character)
        written = "".join(current)
        previous_text = written.rstrip(_WHITESPACE)
        previous = previous_text[-1] if previous_text else ""
        following_text = line[index + 1 :]
        following = following_text[:1]
        delimited = (not written or written[-1] in _WHITESPACE) and (
            not following_text or following in _WHITESPACE
        )
        at_start = not previous_text
        bullet = _marker_bullet(
            code,
            at_start=at_start,
            delimited=delimited,
            previous=previous,
            list_glyph=first_glyph,
        )
        if bullet and following_text.strip():
            if not split_items:
                # A heading keeps its line: the glyph is only a character there.
                current.append(_GLYPHS.get(code, "\u2022"))
                continue
            if previous_text:
                lines.append(written.rstrip())
            number = code - 0xF080 if code in _NUMBER_MARKERS else 0
            current = [_marker_text(code, number)]
            continue
        if bullet:
            # A marker that no text follows (the item starts in the next block): kept as a bullet.
            current.append(_GLYPHS.get(code, "\u2022") if code in _NUMBER_MARKERS else "\u2022")
            continue
        replacement = _inline(code, previous, following)
        current.append(character if replacement is None else replacement)
    lines.append("".join(current).rstrip())
    return [re.sub(r"[ \t]{2,}", " ", item) for item in lines]


def repair_text(text: str, *, split_items: bool = True) -> str:
    """``text`` with every private-use glyph read as what it stood for (module docstring)."""
    if not _PUA.search(text):
        return text
    result: list[str] = []
    for line in text.split("\n"):
        result.extend(_repair_line(line, split_items=split_items))
    return "\n".join(result)


def repair_markdown_body(body: str) -> str:
    """The same repair for a Markdown body: comments stay, a heading keeps its line."""
    if not _PUA.search(body):
        return body
    lines: list[str] = []
    for line in body.split("\n"):
        if not _PUA.search(line) or line.lstrip().startswith("<!--"):
            lines.append(line)
        elif line.startswith("#"):
            lines.extend(_repair_line(line, split_items=False))
        else:
            lines.extend(_repair_line(line, split_items=True))
    return "\n".join(lines)


def repair_lines(lines: Iterable[str]) -> list[str]:
    """``repair_text`` for the lines of one extracted block; one input line may become several."""
    result: list[str] = []
    for line in lines:
        result.extend(repair_text(line).split("\n"))
    return result
