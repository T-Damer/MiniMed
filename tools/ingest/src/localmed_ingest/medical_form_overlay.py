"""Layout-fidelity overlay of the printed forms against the official scan (docs/FORMS_PLAN.md).

The owner requirement of F3: the printed blank keeps the layout of the original form file. This
module compares the empty print of a committed form schema (a PDF made by
`tools/forms-overlay/render-print.ts` from the same HTML the app hands to the print manager) with
the page(s) of the official scan the schema was built from:

* **text** — the words of the print and the words of the scan (macOS Vision boxes) are aligned as
  two sequences; each matched word gives a horizontal and a vertical offset (mm). Reported per
  form: coverage of the printed words, vertical drift (median / 90th percentile / maximum), the
  left-edge offset of the printed lines, the font scale (width of the same words in the print over
  the scan) and the agreement of the line breaks;
* **rules** — long horizontal and vertical strokes (underlines of blanks, table and box borders)
  found in the raster of both pages with the same detector: how many scan rules have a print rule
  within the tolerance, how many print rules have no scan counterpart;
* **sheet** — number of sheets, paper size and orientation.

The appendix page of an order carries a header («Приложение № N к приказу …») that is not part of
the form; when the scan has it, the page offset is taken from the first form line so the
comparison measures the form, not the header (reported as `appendixHeaderMm`).

Images per page: the scan beside the print, and an overlay (scan strokes cyan, print strokes
red, both black) at 100 dpi. Everything is pure Python on top of PyMuPDF (already a dependency).
"""

from __future__ import annotations

import argparse
import bisect
import difflib
import json
import re
import statistics
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, cast

import pymupdf

from localmed_ingest.medical_form_calibration import (
    CALIBRATION_DIR,
    GAP_MM,
    load_calibration,
    row_key,
)

REPO: Final = Path(__file__).resolve().parents[4]
PT_MM: Final = 25.4 / 72
DEFAULT_REGISTRY: Final = REPO / "tools/ingest/medical-form-sources.json"
DEFAULT_SCHEMAS: Final = REPO / "apps/app/src/features/forms/schemas"
DEFAULT_RAW: Final = REPO / "data/raw/medical-forms"
DEFAULT_PRINTS: Final = REPO / "output/f3-screens/print"
DEFAULT_OUT: Final = REPO / "output/f3-screens"
DEFAULT_RESULTS: Final = REPO / "tools/ingest/medical-form-overlay-results.json"
OCR_SWIFT: Final = REPO / "tools/ingest/macos_vision_ocr.swift"

# The standard every form is held to (docs/FORMS_PLAN.md «Layout fidelity»). Units: mm and
# fractions. A form passes when every figure is inside its limit; the committed results file records
# the figures of the last run and a test keeps them inside the limits.
TOLERANCES: Final[dict[str, float]] = {
    "minWordCoverage": 0.85,  # printed words that have a scan counterpart
    "maxMedianDyMm": 2.0,
    "maxP90DyMm": 4.0,
    "maxDyMm": 8.0,
    "maxMedianLeftMm": 2.0,
    "fontScaleMin": 0.95,
    "fontScaleMax": 1.05,
    "minLineAgreement": 0.8,
    "minRuleRecall": 0.8,  # scan rules that have a print rule
    "maxRuleMedianDyMm": 1.5,
    "maxRuleMedianDxMm": 3.0,
    "maxPaperDeviationMm": 4.0,
    "maxPrintScaleError": 0.04,
}

# Justified lines of the scan are wider than the same words set ragged, so the font scale is read
# from the narrow end of the line-width ratios, not the median.
FONT_QUANTILE: Final = 0.3
ROW_MM: Final = 1.2  # words whose centres differ by less are on one printed line
MIN_RULE_MM: Final = 8.0
RULE_MATCH_DY_MM: Final = 3.0
RULE_DPI: Final = 150
IMAGE_DPI: Final = 100

LATIN_TO_CYRILLIC: Final = str.maketrans("abcehkmoptxy", "авсенкмоптху")


# ------------------------------------------------------------------------------------ words


@dataclass(frozen=True)
class Word:
    norm: str
    x0: float
    y0: float
    x1: float
    y1: float  # all in mm from the top-left of the page
    frag: int  # id of the OCR fragment / print line the word belongs to
    edge: str = ""  # `first`/`last`/`only` when the word starts/ends its fragment
    seq: int = 0  # position in the order the PDF paints the words

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


def normalise_word(raw: str) -> str:
    text = raw.lower().replace("ё", "е").replace("nº", "").replace("№", "")
    text = re.sub(r"[^0-9a-zа-я]", "", text)
    return text.translate(LATIN_TO_CYRILLIC)


def scan_words(ocr_page: dict[str, Any], width_mm: float, height_mm: float) -> list[Word]:
    """Words of the OCR boxes; a word's box is its share of the fragment's width by characters."""
    words: list[Word] = []
    for index, line in enumerate(ocr_page["lines"]):
        x, y, w, h = (float(value) for value in line["bbox"])
        tokens = str(line["text"]).split()
        if not tokens:
            continue
        total = sum(len(token) for token in tokens) + (len(tokens) - 1)
        cursor = 0
        top = (1 - (y + h)) * height_mm
        bottom = (1 - y) * height_mm
        for position, token in enumerate(tokens):
            start = cursor / total
            end = (cursor + len(token)) / total
            cursor += len(token) + 1
            norm = normalise_word(token)
            if not norm:
                continue
            edge = ""
            if len(tokens) == 1:
                edge = "only"
            elif position == 0:
                edge = "first"
            elif position == len(tokens) - 1:
                edge = "last"
            words.append(
                Word(
                    norm,
                    (x + w * start) * width_mm,
                    top,
                    (x + w * end) * width_mm,
                    bottom,
                    index,
                    edge,
                )
            )
    # the OCR sorts in coarse bands; read the rows top to bottom, left to right
    return [
        w
        for row in _rows(words, key=lambda word: word.cy, tolerance=ROW_MM)
        for w in sorted(row, key=lambda word: word.x0)
    ]


def span_sizes(page: pymupdf.Page) -> list[float]:
    """Font sizes (pt) of the text spans of a print page."""
    sizes: list[float] = []
    text = cast("dict[str, Any]", page.get_text("dict"))
    for block in text["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                if str(span["text"]).strip():
                    sizes.append(float(span["size"]))
    return sizes


def print_words(page: pymupdf.Page) -> list[Word]:
    """Words of the print PDF's text layer, grouped into lines by baseline.

    Sorted top to bottom; `seq` keeps the order the PDF paints them in, which is the order of the
    schema (a two-column block paints one column, then the other).
    """
    raw = cast("list[tuple[Any, ...]]", page.get_text("words"))
    entries = sorted(raw, key=lambda item: ((item[1] + item[3]) / 2, item[0]))
    lines: list[list[Any]] = []
    for entry in entries:
        centre = (entry[1] + entry[3]) / 2
        if lines and abs(lines[-1][0] - centre) <= ROW_MM / PT_MM:
            lines[-1][1].append(entry)
        else:
            lines.append([centre, [entry]])
    seq = {id(item): order for order, item in enumerate(raw)}
    made: dict[int, Word] = {}
    for index, (_centre, items) in enumerate(lines):
        ordered = sorted(items, key=lambda item: item[0])
        usable = [item for item in ordered if normalise_word(str(item[4]))]
        for position, item in enumerate(usable):
            edge = ""
            if len(usable) == 1:
                edge = "only"
            elif position == 0:
                edge = "first"
            elif position == len(usable) - 1:
                edge = "last"
            made[id(item)] = Word(
                normalise_word(str(item[4])),
                item[0] * PT_MM,
                item[1] * PT_MM,
                item[2] * PT_MM,
                item[3] * PT_MM,
                index,
                edge,
                seq[id(item)],
            )
    return [
        made[id(item)]
        for line in lines
        for item in sorted(line[1], key=lambda i: i[0])
        if id(item) in made
    ]


@dataclass(frozen=True)
class TextMetrics:
    print_words: int
    scan_words: int
    matched: int
    appendix_header_mm: float
    form_top_mm: float
    dy: list[float]
    left: list[float]
    font_scales: list[float]
    line_agreement: float
    line_issues: list[str]
    worst: list[dict[str, Any]]


def match_words(scan: Sequence[Word], printed: Sequence[Word]) -> list[tuple[Word, Word]]:
    """Pairs of the same word on the scan and on the print.

    First the two word sequences are aligned (the long runs of identical text), then each print
    word that is still alone is paired with the nearest unpaired scan word of the same text, near
    where the pairs around it say it should be: the columns of a two-column block interleave
    differently on the scan than in the print, which an alignment of sequences cannot see.
    """
    matcher = difflib.SequenceMatcher(
        None, [w.norm for w in scan], [w.norm for w in printed], autojunk=False
    )
    pairs: list[tuple[Word, Word]] = []
    used_scan: set[int] = set()
    used_print: set[int] = set()
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            pairs.append((scan[block.a + offset], printed[block.b + offset]))
            used_scan.add(block.a + offset)
            used_print.add(block.b + offset)
    if not pairs:
        return pairs
    anchors = sorted((p.cy, s.cy - p.cy) for s, p in pairs)
    centres = [item[0] for item in anchors]
    by_text: dict[str, list[int]] = {}
    for index, word in enumerate(scan):
        if index not in used_scan:
            by_text.setdefault(word.norm, []).append(index)
    for index, word in enumerate(printed):
        if index in used_print or len(word.norm) < 3:
            continue
        candidates = by_text.get(word.norm)
        if not candidates:
            continue
        near = bisect.bisect_left(centres, word.cy)
        window = [item[1] for item in anchors[max(0, near - 4) : near + 4]]
        expected = statistics.median(window)
        best: tuple[float, int] | None = None
        for candidate in candidates:
            other = scan[candidate]
            vertical = abs(other.cy - (word.cy + expected))
            if vertical > 9.0:
                continue
            cost = vertical + 0.1 * abs(other.x0 - word.x0)
            if best is None or cost < best[0]:
                best = (cost, candidate)
        if best is not None:
            candidates.remove(best[1])
            pairs.append((scan[best[1]], word))
    return pairs


def align_page(
    scan: Sequence[Word], printed: Sequence[Word]
) -> tuple[list[tuple[Word, Word]], float, float]:
    """Matched word pairs, the vertical offset of the appendix header and where the form starts.

    The offset (mm) is 0 when the scan page has no appendix header; `form_top` is the top of the
    first form line on the scan, so strokes above it (the handwritten date of the order) are not
    counted.
    """
    pairs = match_words(scan, printed)
    if not pairs:
        return pairs, 0.0, 0.0
    # the form starts with the first thing the print paints (its first row, top left)
    first = sorted(pairs, key=lambda pair: pair[1].seq)[:4]
    anchor_scan, anchor_print = first[0]
    header = [
        w
        for w in scan
        if w.norm == "приложение" and w.y1 < anchor_scan.y0 and w.y0 < anchor_scan.y0 - 5
    ]
    if not header:
        return pairs, 0.0, 0.0
    form_top = anchor_scan.y0 - 2.0
    # pair again without the appendix header, whose words belong to no form line
    below = [w for w in scan if w.y0 >= form_top]
    return match_words(below, printed), anchor_scan.cy - anchor_print.cy, form_top


def text_metrics(scan: Sequence[Word], printed: Sequence[Word]) -> TextMetrics:
    """Offsets between the aligned words of the scan and the print of one page."""
    pairs, offset, form_top = align_page(scan, printed)
    if not pairs:
        return TextMetrics(len(printed), len(scan), 0, 0.0, 0.0, [], [], [], 0.0, [], [])
    dy = [(s.cy - p.cy) - offset for s, p in pairs]
    left = [(s.x0 - p.x0) for s, p in pairs if s.edge in ("first", "only")]

    # font scale: the width of a run of at least three matched words of one line
    scales: list[float] = []
    by_frag: dict[tuple[int, int], list[tuple[Word, Word]]] = {}
    for s, p in pairs:
        by_frag.setdefault((s.frag, p.frag), []).append((s, p))
    for group in by_frag.values():
        if len(group) < 3:
            continue
        group.sort(key=lambda pair: pair[0].x0)
        scan_width = group[-1][0].x1 - group[0][0].x0
        print_width = group[-1][1].x1 - group[0][1].x0
        if print_width > 0 and scan_width > 0:
            scales.append(scan_width / print_width)

    # line-break agreement: a print line agrees when its matched words sit on one scan row and
    # that scan row holds no matched words of another print line
    scan_rows = _rows([s for s, _ in pairs], key=lambda w: w.cy)
    row_of = {id(w): row for row, members in enumerate(scan_rows) for w in members}
    print_to_rows: dict[int, set[int]] = {}
    row_to_prints: dict[int, set[int]] = {}
    for s, p in pairs:
        row = row_of[id(s)]
        print_to_rows.setdefault(p.frag, set()).add(row)
        row_to_prints.setdefault(row, set()).add(p.frag)
    agree = sum(
        1
        for line, rows in print_to_rows.items()
        if len(rows) == 1 and len(row_to_prints[next(iter(rows))]) == 1
    )
    agreement = agree / len(print_to_rows) if print_to_rows else 0.0
    words_of: dict[int, list[Word]] = {}
    for word in printed:
        words_of.setdefault(word.frag, []).append(word)
    issues: list[str] = []
    for line, rows in sorted(
        print_to_rows.items(), key=lambda item: min(w.y0 for w in words_of[item[0]])
    ):
        if len(rows) == 1 and len(row_to_prints[next(iter(rows))]) == 1:
            continue
        members = sorted(words_of[line], key=lambda w: w.x0)
        issues.append(f"y={members[0].cy + offset:.0f}: " + " ".join(w.norm for w in members)[:70])

    worst = sorted(
        (
            {
                "text": s.norm,
                "dyMm": round((s.cy - p.cy) - offset, 1),
                "scanYMm": round(s.cy, 1),
            }
            for s, p in pairs
        ),
        key=lambda item: -abs(item["dyMm"]),
    )[:5]
    return TextMetrics(
        len(printed),
        len(scan),
        len(pairs),
        round(offset, 1),
        round(form_top, 1),
        dy,
        left,
        scales,
        agreement,
        issues,
        worst,
    )


def _rows(items: Sequence[Word], key: Any, tolerance: float = 1.6) -> list[list[Word]]:
    ordered = sorted(items, key=key)
    rows: list[list[Word]] = []
    for item in ordered:
        if rows and abs(key(rows[-1][-1]) - key(item)) <= tolerance:
            rows[-1].append(item)
        else:
            rows.append([item])
    return rows


# ------------------------------------------------------------------------------------ rules


@dataclass(frozen=True)
class Rule:
    """A stroke: `a0..a1` along its direction, `at` across it (mm)."""

    a0: float
    a1: float
    at: float


def gray_pixels(page: pymupdf.Page, dpi: int, rotate: int = 0) -> tuple[int, int, bytes]:
    matrix = pymupdf.Matrix(dpi / 72, dpi / 72)
    if rotate:
        matrix = matrix.prerotate(rotate)
    pixmap = page.get_pixmap(matrix=matrix, colorspace=pymupdf.csGRAY, alpha=False)
    return pixmap.width, pixmap.height, bytes(pixmap.samples)


def _runs(row: bytes, threshold_table: bytes, minimum: int) -> list[tuple[int, int]]:
    bits = row.translate(threshold_table)
    return [(match.start(), match.end()) for match in re.finditer(rb"\x01{%d,}" % minimum, bits)]


def find_rules(
    width: int, height: int, pixels: bytes, dpi: int, threshold: int = 190
) -> tuple[list[Rule], list[Rule]]:
    """Long straight strokes: (horizontal, vertical). Rows/columns are chained across one pixel."""
    table = bytes(1 if value < threshold else 0 for value in range(256))
    minimum = max(6, round(1.5 * dpi / 25.4))  # runs shorter than 1.5 mm are text strokes
    px_mm = 25.4 / dpi

    def chain(lines: list[list[tuple[int, int]]]) -> list[Rule]:
        active: list[list[float]] = []  # [a0, a1, sum_at, rows, last_index]
        done: list[list[float]] = []
        for index, runs in enumerate(lines):
            still: list[list[float]] = []
            used: set[int] = set()
            for a0, a1 in runs:
                for j, segment in enumerate(active):
                    if j in used or index - segment[4] > 2:
                        continue
                    if a0 <= segment[1] + 2 and a1 >= segment[0] - 2:
                        segment[0] = min(segment[0], a0)
                        segment[1] = max(segment[1], a1)
                        segment[2] += index
                        segment[3] += 1
                        segment[4] = index
                        used.add(j)
                        break
                else:
                    still.append([a0, a1, float(index), 1.0, float(index)])
            for segment in active:
                if index - segment[4] > 2:
                    done.append(segment)
                else:
                    still.append(segment)
            active = still
        done.extend(active)
        rules: list[Rule] = []
        for a0, a1, total, count, _last in done:
            if (a1 - a0) * px_mm >= MIN_RULE_MM and count <= 6 * dpi / 100 * 3:
                rules.append(Rule(a0 * px_mm, a1 * px_mm, total / count * px_mm))
        return rules

    rows = [_runs(pixels[y * width : (y + 1) * width], table, minimum) for y in range(height)]
    columns = [_runs(pixels[x::width], table, minimum) for x in range(width)]
    return chain(rows), chain(columns)


def _inside(
    rules: Sequence[Rule], width: float, height: float, top: float, horizontal: bool
) -> list[Rule]:
    """Drop strokes on the scanner's border and above the form (the appendix header)."""
    margin = 3.0
    across, along = (height, width) if horizontal else (width, height)
    kept: list[Rule] = []
    for rule in rules:
        if rule.at < margin or rule.at > across - margin:
            continue
        if horizontal and rule.at < top:
            continue
        if not horizontal and rule.a1 < top:
            continue
        if rule.a0 < 0 or rule.a1 > along + 1:
            continue
        kept.append(rule)
    return kept


def merge_rules(rules: Sequence[Rule]) -> list[Rule]:
    """Collapse the rows of one thick stroke or a stroke cut by skew into one rule."""
    ordered = sorted(rules, key=lambda rule: (rule.at, rule.a0))
    merged: list[Rule] = []
    for rule in ordered:
        for index, other in enumerate(merged):
            overlap = min(rule.a1, other.a1) - max(rule.a0, other.a0)
            if abs(rule.at - other.at) <= 0.9 and overlap > 0.4 * min(
                rule.a1 - rule.a0, other.a1 - other.a0
            ):
                merged[index] = Rule(
                    min(rule.a0, other.a0), max(rule.a1, other.a1), (rule.at + other.at) / 2
                )
                break
        else:
            merged.append(rule)
    return merged


@dataclass(frozen=True)
class RuleMetrics:
    scan: int
    printed: int
    matched_scan: int
    matched_print: int
    dy: list[float]
    dx: list[float]  # difference of the stroke ends (start, end), mm


def match_rules(scan: Sequence[Rule], printed: Sequence[Rule], offset: float) -> RuleMetrics:
    used: set[int] = set()
    across: list[float] = []
    ends: list[float] = []
    for rule in scan:
        best: tuple[float, int] | None = None
        for index, other in enumerate(printed):
            if index in used:
                continue
            overlap = min(rule.a1, other.a1) - max(rule.a0, other.a0)
            if overlap < 0.5 * min(rule.a1 - rule.a0, other.a1 - other.a0):
                continue
            distance = abs(rule.at - (other.at + offset))
            if distance <= RULE_MATCH_DY_MM and (best is None or distance < best[0]):
                best = (distance, index)
        if best is not None:
            used.add(best[1])
            other = printed[best[1]]
            across.append(rule.at - (other.at + offset))
            ends.extend((rule.a0 - other.a0, rule.a1 - other.a1))
    return RuleMetrics(len(scan), len(printed), len(across), len(used), across, ends)


# ------------------------------------------------------------------------------------ images


def _write_png(path: Path, width: int, height: int, rgb: bytes) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, width, height, rgb, False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pixmap.save(str(path))


def shifted(gray: bytes, width: int, height: int, dy: int) -> bytes:
    """The raster moved down by `dy` pixels (up when negative), white where it uncovers."""
    if dy == 0:
        return gray
    blank = b"\xff" * (width * abs(dy))
    if dy > 0:
        return blank + gray[: width * (height - dy)]
    return gray[width * -dy :] + blank


def side_by_side(
    scan: bytes, printed: bytes, width: int, height: int, scan_w: int, scan_h: int
) -> tuple[int, int, bytes]:
    """The scan and the print next to each other, each on a white sheet of the larger size."""
    sheet_w = max(width, scan_w)
    sheet_h = max(height, scan_h)

    def pad(data: bytes, w: int, h: int) -> list[bytes]:
        rows = [data[y * w : (y + 1) * w] + b"\xff" * (sheet_w - w) for y in range(h)]
        return rows + [b"\xff" * sheet_w] * (sheet_h - h)

    left = pad(scan, scan_w, scan_h)
    right = pad(printed, width, height)
    gutter = b"\x80" * 4
    gray = b"".join(a + gutter + b for a, b in zip(left, right, strict=True))
    out_w = sheet_w * 2 + 4
    rgb = bytearray(len(gray) * 3)
    rgb[0::3] = gray
    rgb[1::3] = gray
    rgb[2::3] = gray
    return out_w, sheet_h, bytes(rgb)


def overlay(scan: bytes, printed: bytes, width: int, height: int) -> bytes:
    """Scan-only strokes cyan, print-only strokes red, strokes of both black."""
    rgb = bytearray(width * height * 3)
    rgb[0::3] = scan
    rgb[1::3] = printed
    rgb[2::3] = printed
    return bytes(rgb)


def fit(gray: bytes, w: int, h: int, to_w: int, to_h: int) -> bytes:
    """Crop or pad a raster to a given size (top-left aligned)."""
    rows = []
    for y in range(to_h):
        if y < h:
            row = gray[y * w : (y + 1) * w][:to_w]
            rows.append(row + b"\xff" * (to_w - len(row)))
        else:
            rows.append(b"\xff" * to_w)
    return b"".join(rows)


# ------------------------------------------------------------------------------------ results


def percentile(values: Sequence[float], share: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    return ordered[min(len(ordered) - 1, int(share * len(ordered)))]


def round_all(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 3)
    if isinstance(value, dict):
        return {key: round_all(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_all(item) for item in value]
    return value


def violations(summary: dict[str, Any], tolerances: dict[str, float] = TOLERANCES) -> list[str]:
    """What a form's figures break; an empty list means the form is inside the standard."""
    found: list[str] = []
    sheet = summary["sheet"]
    if sheet["printPages"] != sheet["scanPages"]:
        found.append(f"sheets: print {sheet['printPages']} vs scan {sheet['scanPages']}")
    if abs(sheet["printScale"] - 1.0) > tolerances["maxPrintScaleError"]:
        found.append(
            f"print scaled to {sheet['printScale']} of the declared font (a line overflows)"
        )
    if sheet["paperDeviationMm"] > tolerances["maxPaperDeviationMm"]:
        found.append(f"paper size deviates by {sheet['paperDeviationMm']} mm")
    text = summary["text"]
    checks = (
        (
            text["wordCoverage"] < tolerances["minWordCoverage"],
            f"word coverage {text['wordCoverage']}",
        ),
        (
            text["medianDyMm"] > tolerances["maxMedianDyMm"],
            f"median vertical offset {text['medianDyMm']} mm",
        ),
        (text["p90DyMm"] > tolerances["maxP90DyMm"], f"p90 vertical offset {text['p90DyMm']} mm"),
        (text["maxDyMm"] > tolerances["maxDyMm"], f"max vertical offset {text['maxDyMm']} mm"),
        (
            text["medianLeftMm"] > tolerances["maxMedianLeftMm"],
            f"left edge offset {text['medianLeftMm']} mm",
        ),
        (
            not tolerances["fontScaleMin"] <= text["fontScale"] <= tolerances["fontScaleMax"],
            f"font scale {text['fontScale']}",
        ),
        (
            text["lineAgreement"] < tolerances["minLineAgreement"],
            f"line breaks agree {text['lineAgreement']}",
        ),
    )
    found.extend(message for failed, message in checks if failed)
    rules = summary["rules"]
    if rules["recall"] < tolerances["minRuleRecall"]:
        found.append(f"rules found in the print {rules['recall']}")
    if rules["medianDyMm"] > tolerances["maxRuleMedianDyMm"]:
        found.append(f"rule vertical offset {rules['medianDyMm']} mm")
    if rules["medianEndMm"] > tolerances["maxRuleMedianDxMm"]:
        found.append(f"rule length offset {rules['medianEndMm']} mm")
    return found


def compare_form(
    schema: dict[str, Any],
    scan_pdf: pymupdf.Document,
    ocr_pages: dict[int, dict[str, Any]],
    print_pdf: pymupdf.Document,
    out_dir: Path | None,
    key: str,
    rotated: bool,
) -> dict[str, Any]:
    blank_pages: list[int] = schema["source"]["blankAppendix"]["pdfPages"]
    landscape = schema["layout"]["page"]["orientation"] == "landscape"
    scan_dy: list[float] = []
    scan_left: list[float] = []
    scales: list[float] = []
    agreements: list[float] = []
    matched = printed_total = scan_total = 0
    rule_scan = rule_print = rule_ms = rule_mp = 0
    rule_dy: list[float] = []
    rule_ends: list[float] = []
    pages: list[dict[str, Any]] = []
    paper_deviation = 0.0
    font_sizes: list[float] = []
    for index, pdf_page in enumerate(blank_pages):
        if index >= len(print_pdf):
            break
        scan_page = scan_pdf[pdf_page - 1]
        print_page = print_pdf[index]
        rotate = 90 if rotated else 0
        sw, sh = scan_page.rect.width * PT_MM, scan_page.rect.height * PT_MM
        if rotate:
            sw, sh = sh, sw
        pw, ph = print_page.rect.width * PT_MM, print_page.rect.height * PT_MM
        paper_deviation = max(paper_deviation, abs(sw - pw), abs(sh - ph))
        words_scan = scan_words(ocr_pages[pdf_page], sw, sh)
        words_print = print_words(print_page)
        font_sizes.extend(span_sizes(print_page))
        metrics = text_metrics(words_scan, words_print)
        printed_total += metrics.print_words
        scan_total += metrics.scan_words
        matched += metrics.matched
        scan_dy.extend(metrics.dy)
        scan_left.extend(metrics.left)
        scales.extend(metrics.font_scales)
        agreements.append(metrics.line_agreement)

        w1, h1, g1 = gray_pixels(scan_page, RULE_DPI, rotate)
        w2, h2, g2 = gray_pixels(print_page, RULE_DPI)
        scan_h_rules, scan_v_rules = find_rules(w1, h1, g1, RULE_DPI)
        print_h_rules, print_v_rules = find_rules(w2, h2, g2, RULE_DPI)
        sh_rules = _inside(merge_rules(scan_h_rules), sw, sh, metrics.form_top_mm, True)
        sv_rules = _inside(merge_rules(scan_v_rules), sw, sh, metrics.form_top_mm, False)
        ph_rules = _inside(merge_rules(print_h_rules), pw, ph, 0.0, True)
        pv_rules = _inside(merge_rules(print_v_rules), pw, ph, 0.0, False)
        h_metrics = match_rules(sh_rules, ph_rules, metrics.appendix_header_mm)
        v_metrics = match_rules(sv_rules, pv_rules, 0.0)
        rule_scan += h_metrics.scan + v_metrics.scan
        rule_print += h_metrics.printed + v_metrics.printed
        rule_ms += h_metrics.matched_scan + v_metrics.matched_scan
        rule_mp += h_metrics.matched_print + v_metrics.matched_print
        rule_dy.extend(h_metrics.dy)
        rule_ends.extend(h_metrics.dx)
        rule_ends.extend(v_metrics.dx)
        rule_dy.extend(v_metrics.dy)

        page_info: dict[str, Any] = {
            "scanPdfPage": pdf_page,
            "printPage": index + 1,
            "appendixHeaderMm": metrics.appendix_header_mm,
            "worstWords": metrics.worst,
            "lineBreakIssues": metrics.line_issues[:12],
            "medianDyMm": statistics.median(abs(v) for v in metrics.dy) if metrics.dy else None,
        }
        pages.append(page_info)
        if out_dir is not None:
            ow, oh, og = gray_pixels(scan_page, IMAGE_DPI, rotate)
            pw_px, ph_px, pg = gray_pixels(print_page, IMAGE_DPI)
            shift = round(metrics.appendix_header_mm / 25.4 * IMAGE_DPI)
            aligned = shifted(pg, pw_px, ph_px, shift)
            width_px, height_px = max(ow, pw_px), max(oh, ph_px)
            scan_fit = fit(og, ow, oh, width_px, height_px)
            print_fit = fit(aligned, pw_px, ph_px, width_px, height_px)
            _write_png(
                out_dir / f"{key}-p{index + 1}-overlay.png",
                width_px,
                height_px,
                overlay(scan_fit, print_fit, width_px, height_px),
            )
            sbs_w, sbs_h, sbs = side_by_side(og, pg, pw_px, ph_px, ow, oh)
            _write_png(out_dir / f"{key}-p{index + 1}-side-by-side.png", sbs_w, sbs_h, sbs)

    abs_dy = [abs(value) for value in scan_dy]
    summary: dict[str, Any] = {
        "sheet": {
            "scanPages": len(blank_pages),
            "printPages": len(print_pdf),
            "paperDeviationMm": round(paper_deviation, 1),
            "orientation": "landscape" if landscape else "portrait",
            # the print's body font over the declared one; not 1 when Chromium shrank the page
            "printScale": (
                statistics.median(font_sizes) / schema["layout"]["page"]["fontSizePt"]
                if font_sizes
                else 0.0
            ),
        },
        "text": {
            "printWords": printed_total,
            "scanWords": scan_total,
            "matchedWords": matched,
            "wordCoverage": matched / printed_total if printed_total else 0.0,
            "medianDyMm": statistics.median(abs_dy) if abs_dy else 0.0,
            "p90DyMm": percentile(abs_dy, 0.9),
            "maxDyMm": percentile(abs_dy, 0.98),
            "medianLeftMm": statistics.median(abs(v) for v in scan_left) if scan_left else 0.0,
            "fontScale": percentile(scales, FONT_QUANTILE) if scales else 0.0,
            "lineAgreement": statistics.fmean(agreements) if agreements else 0.0,
        },
        "rules": {
            "scan": rule_scan,
            "print": rule_print,
            "recall": rule_ms / rule_scan if rule_scan else 1.0,
            "precision": rule_mp / rule_print if rule_print else 1.0,
            "medianDyMm": statistics.median(abs(v) for v in rule_dy) if rule_dy else 0.0,
            "medianEndMm": statistics.median(abs(v) for v in rule_ends) if rule_ends else 0.0,
        },
        "pages": pages,
    }
    summary = round_all(summary)
    summary["violations"] = violations(summary)
    summary["passes"] = not summary["violations"]
    return summary


# ------------------------------------------------------------------------------- calibration

MIN_CORRECTION_MM: Final = 0.25
MIN_LINE_HEIGHT: Final = 1.1  # a bit below single spacing of Times New Roman (1.15)


def segment_words(
    segment: dict[str, Any], field_options: dict[str, list[dict[str, str]]]
) -> list[str]:
    """The printed words a segment puts on the blank (blanks print nothing when empty)."""
    kind = segment["kind"]
    if kind == "text":
        return [w for w in str(segment["text"]).split() if normalise_word(w)]
    if kind == "field":
        return [w for w in str(segment.get("caption", "")).split() if normalise_word(w)]
    if kind == "signature":
        return [w for w in str(segment["caption"]).split() if normalise_word(w)]
    if kind == "stamp":
        return [w for w in str(segment["text"]).split() if normalise_word(w)]
    if kind == "options":
        words: list[str] = []
        for option in field_options.get(segment["fieldId"], []):
            words.extend(str(option["label"]).split())
            if segment.get("codes", True):
                words.append(str(option["value"]))
        return [w for w in words if normalise_word(w)]
    if kind == "table":
        words = []
        for header_row in segment["header"]:
            for cell in header_row:
                words.extend(str(cell["text"]).split())
        for body_row in segment["rows"]:
            for cell in body_row:
                if isinstance(cell, dict):
                    words.extend(str(cell["text"]).split())
        return [w for w in words if normalise_word(w)]
    return []


@dataclass(frozen=True)
class RowRef:
    key: str
    page: int
    block: int
    column: int
    words: tuple[str, ...]
    space: float  # the space above the row now, mm


def flatten_rows(schema: dict[str, Any], calibration: dict[str, Any]) -> list[RowRef]:
    options = {f["id"]: f.get("options", []) for f in schema["fields"]}
    spaces = calibration.get("rows", {})
    rows: list[RowRef] = []
    page = -1
    for block_index, block in enumerate(schema["layout"]["blocks"]):
        if page < 0 or block.get("pageBreakBefore"):
            page += 1
        for column_index, column in enumerate(block["columns"]):
            for index, row in enumerate(column["rows"]):
                key = row_key(block, column_index, index)
                if key in spaces:
                    space = float(spaces[key])
                elif "spaceBeforeMm" in row:
                    space = float(row["spaceBeforeMm"])
                else:
                    space = GAP_MM[row.get("gap", "none")]
                words: list[str] = []
                for segment in row["segments"]:
                    words.extend(segment_words(segment, options))
                rows.append(RowRef(key, page, block_index, column_index, tuple(words), space))
    return rows


def _reject_outlier_rows(
    row_dy: dict[int, list[float]], limit: float = 6.0
) -> dict[int, list[float]]:
    """Drop rows whose offset disagrees with both neighbours (a word paired on the wrong line)."""
    order = sorted(row_dy)
    medians = {index: statistics.median(row_dy[index]) for index in order}
    kept: dict[int, list[float]] = {}
    for position, index in enumerate(order):
        around = [
            medians[order[other]]
            for other in (position - 1, position + 1)
            if 0 <= other < len(order)
        ]
        if around and all(abs(medians[index] - value) > limit for value in around):
            continue
        kept[index] = row_dy[index]
    return kept


def calibrate_page(
    rows: Sequence[RowRef],
    scan: Sequence[Word],
    printed_sorted: Sequence[Word],
) -> tuple[dict[str, float], dict[str, float], list[float], float, float]:
    """New spaces above the rows of one page, the rows' offsets before the change, the pitch
    ratios of consecutive text rows, the deficit (mm the print is still too tall by after the
    spaces are shrunk to zero) and the span of the matched rows."""
    printed_content = sorted(printed_sorted, key=lambda word: word.seq)
    pairs, offset, _top = align_page(scan, printed_sorted)
    dy_of = {id(p): (s.cy - p.cy) - offset for s, p in pairs}
    stream: list[tuple[str, int]] = []
    for index, row in enumerate(rows):
        for word in row.words:
            norm = normalise_word(word)
            if norm:
                stream.append((norm, index))
    matcher = difflib.SequenceMatcher(
        None, [n for n, _ in stream], [w.norm for w in printed_content], autojunk=False
    )
    row_dy: dict[int, list[float]] = {}
    row_y: dict[int, list[float]] = {}
    scan_y: dict[int, list[float]] = {}
    scan_of = {id(p): s for s, p in pairs}
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            row_index = stream[block.a + k][1]
            word = printed_content[block.b + k]
            if id(word) in dy_of:
                row_dy.setdefault(row_index, []).append(dy_of[id(word)])
                row_y.setdefault(row_index, []).append(word.cy)
                scan_y.setdefault(row_index, []).append(scan_of[id(word)].cy)
    row_dy = _reject_outlier_rows(row_dy)
    spaces: dict[str, float] = {}
    residuals: dict[str, float] = {}
    pitches: list[float] = []
    shift_of: dict[tuple[int, int], float] = {}  # shift applied so far, per (block, column)
    carried = 0.0  # shift inherited from the previous block
    ends: dict[int, tuple[float, float]] = {}  # column -> (print y of its last row, shift)
    current_block = -1
    previous: tuple[int, int, float, float, float] | None = None
    deficit = 0.0
    tops: list[float] = []
    for index, row in enumerate(rows):
        if row.block != current_block:
            if ends:
                carried = max(ends.values())[1]
            ends = {}
            current_block = row.block
        state_key = (row.block, row.column)
        shift = shift_of.get(state_key, carried)
        if index in row_dy:
            dy = statistics.median(row_dy[index])
            residuals[row.key] = round(dy - shift, 2)
            wanted = row.space + dy - shift
            new_space = max(0.0, wanted)
            delta = new_space - row.space
            if index == 0:
                # the first row of the page is the reference of the page offset, never spaced
                new_space, delta = row.space, 0.0
            if abs(delta) >= MIN_CORRECTION_MM:
                spaces[row.key] = round(new_space, 2)
                shift += delta
            deficit = max(deficit, shift - dy)
            tops.append(min(row_y[index]))
            ends[row.column] = max(ends.get(row.column, (0.0, 0.0)), (max(row_y[index]), shift))
            print_top, scan_top = min(row_y[index]), min(scan_y[index])
            if (
                previous is not None
                and previous[:2] == (row.block, row.column)
                and row.space == previous[4]
            ):
                print_pitch, scan_pitch = print_top - previous[2], scan_top - previous[3]
                if print_pitch > 1.5 and scan_pitch > 1.5:
                    pitches.append(scan_pitch / print_pitch)
            previous = (row.block, row.column, print_top, scan_top, row.space)
        shift_of[state_key] = shift
    span = max(tops) - min(tops) if tops else 0.0
    return spaces, residuals, pitches, deficit, span


def calibration_round(
    schema: dict[str, Any],
    scan_pdf: pymupdf.Document,
    ocr_pages: dict[int, dict[str, Any]],
    print_pdf: pymupdf.Document,
    rotated: bool,
) -> dict[str, Any]:
    """One measurement of a form: new row spaces, the pitch ratio and the largest residual."""
    rows = flatten_rows(schema, {})
    blank_pages: list[int] = schema["source"]["blankAppendix"]["pdfPages"]
    spaces: dict[str, float] = {}
    residuals: dict[str, float] = {}
    pitches: list[float] = []
    deficits: list[tuple[float, float]] = []
    scales: list[float] = []
    lefts: list[float] = []
    rights: list[float] = []
    for index, pdf_page in enumerate(blank_pages):
        if index >= len(print_pdf):
            break
        scan_page = scan_pdf[pdf_page - 1]
        sw, sh = scan_page.rect.width * PT_MM, scan_page.rect.height * PT_MM
        if rotated:
            sw, sh = sh, sw
        page_rows = [row for row in rows if row.page == index]
        words_scan = scan_words(ocr_pages[pdf_page], sw, sh)
        lefts.extend(w.x0 for w in words_scan if w.edge in ("first", "only"))
        rights.extend(w.x1 for w in words_scan if w.edge in ("last", "only"))
        scales.extend(text_metrics(words_scan, print_words(print_pdf[index])).font_scales)
        found, residual, ratio, page_deficit, page_span = calibrate_page(
            page_rows,
            words_scan,
            print_words(print_pdf[index]),
        )
        spaces.update(found)
        residuals.update(residual)
        pitches.extend(ratio)
        deficits.append((page_deficit, page_span))
    return {
        "spaces": spaces,
        "residuals": residuals,
        "pitchRatio": statistics.median(pitches) if pitches else 1.0,
        "deficitMm": max((d for d, _ in deficits), default=0.0),
        "spanMm": max((t for _, t in deficits), default=0.0),
        "fontScale": percentile(scales, FONT_QUANTILE) if scales else 1.0,
        "scanLeftMm": percentile(lefts, 0.05),
        "scanRightMm": statistics.median(sorted(rights)[-10:]) if rights else 0.0,
        "maxResidualMm": max((abs(v) for v in residuals.values()), default=0.0),
    }


# --------------------------------------------------------------------------------------- CLI


def _load_ocr(path: Path) -> dict[int, dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {int(page["page"]): page for page in data["pages"]}


def run_check(
    *,
    registry_path: Path,
    schemas_dir: Path,
    raw_dir: Path,
    prints_dir: Path,
    out_dir: Path,
    only: set[str],
    images: bool,
) -> dict[str, Any]:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    results: dict[str, Any] = {}
    for source in registry["sources"]:
        eo = source["eoNumber"]
        pdf_path = raw_dir / f"{eo}.pdf"
        ocr_path = raw_dir / f"{eo}.ocr.json"
        if not pdf_path.exists() or not ocr_path.exists():
            print(
                f"skip order {source['orderNumber']}: no raw PDF/OCR in {raw_dir}", file=sys.stderr
            )
            continue
        scan_pdf = pymupdf.open(pdf_path)
        ocr_upright = _load_ocr(ocr_path)
        for form in source["forms"]:
            schema = json.loads((schemas_dir / form["schemaFile"]).read_text(encoding="utf-8"))
            if only and form["key"] not in only and schema["id"] not in only:
                continue
            print_path = prints_dir / f"{schema['id']}.pdf"
            if not print_path.exists():
                raise FileNotFoundError(f"render the print first: {print_path}")
            rotated = schema["layout"]["page"]["orientation"] == "landscape" and any(
                scan_pdf[page - 1].rect.height > scan_pdf[page - 1].rect.width
                for page in schema["source"]["blankAppendix"]["pdfPages"]
            )
            ocr_pages = ocr_upright
            if rotated:
                rotated_path = raw_dir / f"{eo}.{form['key']}.rot90.ocr.json"
                if not rotated_path.exists():
                    raise FileNotFoundError(
                        f"{rotated_path.name}: run `{prepare_rotated_hint(source, form, pdf_path)}`"
                    )
                ocr_pages = _load_ocr(rotated_path)
            with pymupdf.open(print_path) as print_pdf:
                results[form["key"]] = {
                    "formNumber": form["formNumber"],
                    "schemaId": schema["id"],
                    **compare_form(
                        schema,
                        scan_pdf,
                        ocr_pages,
                        print_pdf,
                        out_dir / form["key"] if images else None,
                        form["key"],
                        rotated,
                    ),
                }
    return results


def prepare_rotated_hint(source: dict[str, Any], form: dict[str, Any], pdf_path: Path) -> str:
    return (
        f"swift tools/ingest/macos_vision_ocr.swift {pdf_path} --rotate 90 "
        f"--pages <blank pages of {form['formNumber']}> > "
        f"data/raw/medical-forms/{source['eoNumber']}.{form['key']}.rot90.ocr.json"
    )


def format_results(results: dict[str, Any]) -> str:
    lines = [
        f"{'form':<10}{'words':>7}{'dy med/p90/max mm':>20}{'left':>6}{'font':>6}{'lines':>7}"
        f"{'rules':>7}{'rule dy':>8}  verdict"
    ]
    for key, item in results.items():
        text, rules = item["text"], item["rules"]
        verdict = "ok" if item["passes"] else "; ".join(item["violations"])
        lines.append(
            f"{item['formNumber']:<10}{text['wordCoverage']:>7.2f}"
            f"{text['medianDyMm']:>7.1f}/{text['p90DyMm']:.1f}/{text['maxDyMm']:.1f}"
            f"{text['medianLeftMm']:>9.1f}{text['fontScale']:>6.2f}{text['lineAgreement']:>7.2f}"
            f"{rules['recall']:>7.2f}{rules['medianDyMm']:>8.1f}  {verdict}"
        )
        del key
    return "\n".join(lines)


def next_calibration(
    schema: dict[str, Any], current: dict[str, Any], measured: dict[str, Any]
) -> tuple[dict[str, Any] | None, str]:
    """The next calibration step, or None when the form has settled.

    Three phases, each reset the ones after it: the page (side margins from the extent of the
    scan text, font size from the width of identical lines), the line height (shrunk while the
    print is taller than the scan even with no extra space), then the space above each row.
    """
    page = schema["layout"]["page"]
    saved_page: dict[str, Any] = dict(current.get("page", {}))
    margins = dict(saved_page.get("marginMm", page["marginMm"]))
    font = float(saved_page.get("fontSizePt", page["fontSizePt"]))
    line_height = float(current.get("lineHeight", page.get("lineHeight", 1.3)))
    page_width = 297.0 if page["orientation"] == "landscape" else 210.0
    left = round(measured["scanLeftMm"], 1)
    right = round(page_width - measured["scanRightMm"], 1)
    scale = measured["fontScale"]
    step = ""
    reset_rows = False
    if abs(margins["left"] - left) > 0.6 or abs(margins["right"] - right) > 0.6:
        margins["left"], margins["right"] = left, max(3.0, right)
        step = f"margins left {left} right {right}"
        reset_rows = True
    elif abs(scale - 1.0) > 0.015 and 7.0 < font < 16.0:
        font = min(16.0, max(7.0, round(font * scale * 4) / 4))
        step = f"font {font} pt (scale {scale:.3f})"
        reset_rows = True
    elif measured["deficitMm"] > 1.5 and measured["spanMm"] > 0 and line_height > MIN_LINE_HEIGHT:
        line_height = round(
            max(MIN_LINE_HEIGHT, line_height * (1 - measured["deficitMm"] / measured["spanMm"])), 3
        )
        step = f"line height {line_height} (deficit {measured['deficitMm']:.1f} mm)"
        reset_rows = True
    rows: dict[str, float] = {} if reset_rows else dict(current.get("rows", {}))
    if not step:
        if not measured["spaces"]:
            return None, "settled"
        rows.update(measured["spaces"])
        step = f"{len(measured['spaces'])} row spaces"
    payload = {
        "formId": schema["id"],
        "method": (
            "page margins and font size from the extent and the line widths of the scan text, "
            "line height, and the space above each layout row, fitted so the print lands on the "
            "official scan (OCR boxes); `medical_form_overlay calibrate`"
        ),
        "page": {"marginMm": margins, "fontSizePt": font},
        "lineHeight": line_height,
        "rows": dict(sorted(rows.items())),
    }
    return payload, step


def run_calibration(args: argparse.Namespace) -> int:
    """Measure, write the calibration file and rebuild the schema until the rows settle."""
    from localmed_ingest.medical_forms import load_blueprint, prepare_form, write_schema

    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    chosen = set(args.form)
    for source in registry["sources"]:
        eo = source["eoNumber"]
        scan_pdf = pymupdf.open(args.raw / f"{eo}.pdf")
        source_record = json.loads((args.raw / f"{eo}.source.json").read_text(encoding="utf-8"))
        for form in source["forms"]:
            if chosen and form["key"] not in chosen:
                continue
            blueprint = load_blueprint(form["key"])
            schema_path = args.schemas / form["schemaFile"]
            rotated = blueprint.layout["page"]["orientation"] == "landscape" and any(
                scan_pdf[page - 1].rect.height > scan_pdf[page - 1].rect.width
                for page in blueprint.blank_pages
            )
            if rotated:
                rotated_ocr = args.raw / f"{eo}.{form['key']}.rot90.ocr.json"
                ocr_pages = _load_ocr(rotated_ocr)
            else:
                ocr_pages = _load_ocr(args.raw / f"{eo}.ocr.json")
            for round_number in range(1, args.rounds + 1):
                schema = prepare_form(blueprint, source_record, args.raw / f"{eo}.ocr.json")
                write_schema(schema, schema_path)
                render_print(schema["id"], args.prints)
                with pymupdf.open(args.prints / f"{schema['id']}.pdf") as print_pdf:
                    measured = calibration_round(schema, scan_pdf, ocr_pages, print_pdf, rotated)
                current = load_calibration(schema["id"])
                payload, note = next_calibration(schema, current, measured)
                print(
                    f"{form['formNumber']} round {round_number}: {note}; max residual "
                    f"{measured['maxResidualMm']:.1f} mm, {len(measured['spaces'])} rows off"
                )
                if payload is None:
                    break
                CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
                (CALIBRATION_DIR / f"{schema['id']}.json").write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
            # the schema with the last calibration applied, rendered and checked
            schema = prepare_form(blueprint, source_record, args.raw / f"{eo}.ocr.json")
            write_schema(schema, schema_path)
            render_print(schema["id"], args.prints)
            with pymupdf.open(args.prints / f"{schema['id']}.pdf") as print_pdf:
                final = compare_form(
                    schema,
                    scan_pdf,
                    ocr_pages,
                    print_pdf,
                    args.out / form["key"],
                    form["key"],
                    rotated,
                )
            print(format_results({form["key"]: {"formNumber": form["formNumber"], **final}}))
    return 0


def render_print(form_id: str, prints_dir: Path) -> None:
    """Render the print layout of a schema to a PDF with tools/forms-overlay/render-print.ts."""
    import subprocess

    subprocess.run(
        [
            "bun",
            str(REPO / "tools/forms-overlay/render-print.ts"),
            "--form",
            form_id,
            "--out",
            str(prints_dir),
        ],
        check=True,
        cwd=REPO,
        capture_output=True,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="medical_form_overlay", description=__doc__)
    parser.add_argument("command", nargs="?", choices=["check", "calibrate"], default="check")
    parser.add_argument("--rounds", type=int, default=4)
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--schemas", type=Path, default=DEFAULT_SCHEMAS)
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--prints", type=Path, default=DEFAULT_PRINTS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--form", action="append", default=[], help="form key or schema id")
    parser.add_argument("--no-images", action="store_true")
    parser.add_argument(
        "--update-results", action="store_true", help="write the committed results file"
    )
    args = parser.parse_args(argv)
    if args.command == "calibrate":
        return run_calibration(args)
    results = run_check(
        registry_path=args.registry,
        schemas_dir=args.schemas,
        raw_dir=args.raw,
        prints_dir=args.prints,
        out_dir=args.out,
        only=set(args.form),
        images=not args.no_images,
    )
    print(format_results(results))
    if args.update_results:
        previous: dict[str, Any] = {}
        if args.results.exists():
            previous = json.loads(args.results.read_text(encoding="utf-8"))
        merged: dict[str, Any] = dict(previous.get("forms", {}))
        merged.update(results)
        pending = {k: v for k, v in previous.get("pending", {}).items() if k not in merged}
        payload: dict[str, Any] = {"tolerances": TOLERANCES, "forms": dict(sorted(merged.items()))}
        if pending:
            payload["pending"] = pending
        args.results.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {args.results}")
    return 0 if all(item["passes"] for item in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
