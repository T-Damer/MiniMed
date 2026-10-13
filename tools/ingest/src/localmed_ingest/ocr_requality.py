"""Re-extract OCR-derived instruction PDFs: line assembly, page marks and cleanup (OCR1).

Input is the raw macOS Vision payload cached by `scripts/grls_ocr_vision_cache.py` (the same
engine and settings that produced the released OCR texts, plus the per-line confidence they
lacked) and the PDF.
Output is an `ExtractedSource` in the format the normal preparer writes, so
`source_registry.render_prepared_markdown` and the pack builder consume it unchanged.

Pipeline for the pages that have no usable text layer (a page with a native text layer keeps the
PyMuPDF blocks verbatim):

1. Vision observations → visual lines: observations on one baseline are joined left to right (Vision
   splits a justified line at wide word gaps); a wide gap marks a table row (`table_candidate`).
2. The normal block classifier (headings, repeated header/footer removal).
3. `refine_ocr_pages`: scan stamps become `page_mark` blocks; standard instruction headings are
   recognised from the fixed section list; lines are reflowed into paragraphs (line-break hyphens
joined against the lexicon); word rules from `ocr_text_cleanup` run; every changed paragraph keeps
   its raw lines in `metadata["lines"]`; paragraphs holding a number the engine may have garbled are
   marked for review. Numbers and units are never edited.
4. Document quality: recognition confidence, unknown-word ratio against the native-text lexicon and
   the rule counters give `good` / `fair` / `low` (`ocr_quality`) with the reasons.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from statistics import median
from typing import Any, cast

import pymupdf

from . import pdf_import
from .models import (
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionOptions,
)
from .ocr_text_cleanup import (
    CYRILLIC_LETTERS,
    Lexicon,
    clean_words,
    join_hyphenated,
    normalize_ocr_line,
    split_inline_stamp,
    stamp_kind,
    standard_heading,
    uncertain_numbers,
    words_of,
)
from .pdf_import import OcrSignal, RawBlock

COLUMN_GAP_RATIO = 0.045
LINE_JOIN_Y_RATIO = 0.6
MIN_NATIVE_PAGE_CHARACTERS = 40
NATIVE_PAGE_MIN_KNOWN_WORDS = 0.5
_TERMINAL = re.compile(r"[.!?»…]\s*$")
_FIELD_START = re.compile(r"^[A-ZА-ЯЁ][^.:;!?]{2,60}:(?:\s|$)")
_LIST_START = re.compile(r"^(?:[-–—•●○▪·*]\s*|\d{1,2}[.)]\s+|[a-zа-я]\)\s+)")
_UPPER_START = re.compile(r"^[A-ZА-ЯЁ0-9«\"(]")
OCR_TOOL = "macos-vision"


# ---------------------------------------------------------------------------------------------
# 1. Vision observations -> lines
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Cell:
    text: str
    x0: float
    x1: float
    y0: float
    y1: float
    confidence: float | None


@dataclass(frozen=True)
class Line:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float | None
    columnar: bool


def _cells(page: Mapping[str, Any]) -> list[Cell]:
    width = float(page["width"])
    height = float(page["height"])
    cells: list[Cell] = []
    for raw in cast(list[Mapping[str, Any]], page.get("lines", [])):
        text = raw.get("text")
        bbox = raw.get("bbox")
        if not isinstance(text, str) or not text.strip() or not isinstance(bbox, list):
            continue
        x, y, box_width, box_height = (float(value) for value in cast(list[float], bbox))
        confidence = raw.get("confidence")
        cells.append(
            Cell(
                text=normalize_ocr_line(text),
                x0=x * width,
                x1=(x + box_width) * width,
                y0=(1 - y - box_height) * height,
                y1=(1 - y) * height,
                confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
            )
        )
    return [cell for cell in cells if cell.text]


def _line_of(cells: Sequence[Cell]) -> Line:
    weights = [(cell.confidence, len(cell.text)) for cell in cells if cell.confidence is not None]
    total = sum(weight for _, weight in weights)
    return Line(
        text=" ".join(cell.text for cell in cells),
        x0=min(cell.x0 for cell in cells),
        y0=min(cell.y0 for cell in cells),
        x1=max(cell.x1 for cell in cells),
        y1=max(cell.y1 for cell in cells),
        confidence=sum(value * weight for value, weight in weights) / total if total else None,
        columnar=False,
    )


def assemble_lines(page: Mapping[str, Any]) -> list[Line]:
    """Join the observations on one baseline into visual lines, top to bottom."""
    width = float(page["width"])
    cells = sorted(_cells(page), key=lambda cell: ((cell.y0 + cell.y1) / 2, cell.x0))
    groups: list[list[Cell]] = []
    for cell in cells:
        centre = (cell.y0 + cell.y1) / 2
        placed = False
        for group in reversed(groups[-3:]):
            first = group[0]
            tolerance = LINE_JOIN_Y_RATIO * min(cell.y1 - cell.y0, first.y1 - first.y0)
            if abs(centre - (first.y0 + first.y1) / 2) <= tolerance:
                group.append(cell)
                placed = True
                break
        if not placed:
            groups.append([cell])
    lines: list[Line] = []
    for group in groups:
        group.sort(key=lambda cell: cell.x0)
        stamps = [cell for cell in group if stamp_kind(cell.text) is not None]
        if stamps and len(stamps) < len(group):
            # A stamp printed on the baseline of a title line: its own line, not a table cell.
            group = [cell for cell in group if cell not in stamps]
            lines.extend(_line_of([cell]) for cell in stamps)
        parts: list[str] = [group[0].text]
        columnar = False
        for previous, current in pairwise(group):
            gap = current.x0 - previous.x1
            if gap > COLUMN_GAP_RATIO * width:
                parts.append(" | ")
                columnar = True
            else:
                parts.append(" ")
            parts.append(current.text)
        text = "".join(parts).replace(" |  ", " | ")
        weights = [
            (cell.confidence, len(cell.text)) for cell in group if cell.confidence is not None
        ]
        total = sum(weight for _, weight in weights)
        confidence = sum(value * weight for value, weight in weights) / total if total else None
        lines.append(
            Line(
                text=text,
                x0=min(cell.x0 for cell in group),
                y0=min(cell.y0 for cell in group),
                x1=max(cell.x1 for cell in group),
                y1=max(cell.y1 for cell in group),
                confidence=confidence,
                columnar=columnar,
            )
        )
    lines.sort(key=lambda line: (round((line.y0 + line.y1) / 2, 1), line.x0))
    return lines


def raw_blocks_from_vision(payload: Mapping[str, Any], pages: set[int]) -> list[RawBlock]:
    blocks: list[RawBlock] = []
    for page in cast(list[Mapping[str, Any]], payload.get("pages", [])):
        number = int(page["page"])
        if number not in pages:
            continue
        for order, line in enumerate(assemble_lines(page)):
            blocks.append(
                RawBlock(
                    page=number,
                    page_width=float(page["width"]),
                    page_height=float(page["height"]),
                    order_index=order,
                    bbox=(line.x0, line.y0, line.x1, line.y1),
                    text=line.text,
                    font_size=None,
                    font_name=None,
                    bold=False,
                    line_count=1,
                    columnar_lines=2 if line.columnar else 0,
                    confidence=line.confidence,
                )
            )
    return blocks


# ---------------------------------------------------------------------------------------------
# 3. Post-classification refinement
# ---------------------------------------------------------------------------------------------


@dataclass
class CleanupCounters:
    page_marks: int = 0
    headings_recovered: int = 0
    headings_demoted: int = 0
    paragraphs_reflowed: int = 0
    lines_joined: int = 0
    hyphens_joined: int = 0
    uncertain_number_paragraphs: int = 0
    uncertain_numbers: int = 0
    word_edits: Counter[str] | None = None
    edit_samples: Counter[tuple[str, str]] | None = None

    def __post_init__(self) -> None:
        self.word_edits = Counter()
        self.edit_samples = Counter()


def _bbox(block: ExtractedBlock) -> tuple[float, float, float, float]:
    if block.bbox and len(block.bbox) == 4:
        return (block.bbox[0], block.bbox[1], block.bbox[2], block.bbox[3])
    return (0.0, 0.0, 0.0, 0.0)


def _page_mark(block: ExtractedBlock, kind: str, text: str) -> ExtractedBlock:
    return block.model_copy(
        update={
            "kind": "page_mark",
            "text": text,
            "heading_level": None,
            "metadata": {**block.metadata, "markKind": kind},
        }
    )


def _should_break(
    previous: ExtractedBlock, current: ExtractedBlock, pitch: float, left_margin: float
) -> bool:
    _, _, _, previous_bottom = _bbox(previous)
    x0, top, _, _ = _bbox(current)
    gap = top - previous_bottom
    if gap > 0.85 * pitch:
        return True
    text = current.text
    if _LIST_START.match(text) or _FIELD_START.match(text):
        return True
    previous_text = previous.text.rstrip()
    if _TERMINAL.search(previous_text) and (
        _UPPER_START.match(text) or x0 - left_margin > 1.5 * pitch
    ):
        return True
    return previous_text.endswith(":") and bool(_UPPER_START.match(text))


def _merge(
    blocks: Sequence[ExtractedBlock], lexicon: Lexicon | None, counters: CleanupCounters
) -> ExtractedBlock:
    first = blocks[0]
    text = first.text
    hyphens = 0
    for block in blocks[1:]:
        joined = join_hyphenated(text, block.text, lexicon) if text.rstrip().endswith("-") else None
        if joined is not None:
            text = joined
            hyphens += 1
        else:
            text = f"{text.rstrip()} {block.text.lstrip()}"
    boxes = [_bbox(block) for block in blocks]
    union = [
        round(min(box[0] for box in boxes), 3),
        round(min(box[1] for box in boxes), 3),
        round(max(box[2] for box in boxes), 3),
        round(max(box[3] for box in boxes), 3),
    ]
    counters.lines_joined += len(blocks) - 1
    counters.hyphens_joined += hyphens
    if len(blocks) > 1:
        counters.paragraphs_reflowed += 1
    return first.model_copy(
        update={
            "text": re.sub(r"\s{2,}", " ", text).strip(),
            "bbox": union,
            "line_count": sum(block.line_count for block in blocks),
            "metadata": {
                **first.metadata,
                "blocks": [block.id for block in blocks],
                "lines": [
                    {
                        "id": block.id,
                        "text": block.text,
                        "bbox": block.bbox,
                        "confidence": block.metadata.get("confidence"),
                    }
                    for block in blocks
                ],
            },
        }
    )


def refine_page(
    page: ExtractedPage,
    confidences: Mapping[int, float | None],
    lexicon: Lexicon | None,
    protected: Sequence[str],
    counters: CleanupCounters,
) -> ExtractedPage:
    """Stamps, headings, reflow and word rules for one OCR page."""
    prepared: list[ExtractedBlock] = []
    for block in page.blocks:
        if block.removed or block.kind in {"repeated_marginalia", "noise"}:
            prepared.append(block)
            continue
        metadata = dict(block.metadata)
        confidence = confidences.get(block.order_index)
        if confidence is not None:
            metadata["confidence"] = round(confidence, 4)
        current = block.model_copy(update={"metadata": metadata})
        text, fused = split_inline_stamp(current.text)
        if fused is not None:
            counters.page_marks += 1
            prepared.append(
                _page_mark(current.model_copy(update={"id": f"{current.id}-m"}), "sequence", fused)
            )
            current = current.model_copy(update={"text": text})
            if not text.strip():
                continue
        kind = stamp_kind(current.text)
        if kind is not None:
            counters.page_marks += 1
            prepared.append(_page_mark(current, kind, current.text))
            continue
        canonical = (
            standard_heading(current.text) if current.kind in {"paragraph", "heading"} else None
        )
        if canonical is not None and current.kind != "heading":
            counters.headings_recovered += 1
            current = current.model_copy(
                update={
                    "kind": "heading",
                    "heading_level": 2,
                    "metadata": {**current.metadata, "promotedFrom": "standard-section"},
                }
            )
        elif (
            current.kind == "heading"
            and canonical is None
            and re.search(r"\d", current.text)
            and len(current.text) <= 14
        ):
            counters.headings_demoted += 1
            current = current.model_copy(update={"kind": "paragraph", "heading_level": None})
        prepared.append(current)

    paragraph_lines = [b for b in prepared if b.kind == "paragraph" and not b.removed]
    heights = [_bbox(b)[3] - _bbox(b)[1] for b in paragraph_lines if _bbox(b)[3] > _bbox(b)[1]]
    pitch = median(heights) if heights else 12.0
    margins = [_bbox(b)[0] for b in paragraph_lines]
    left_margin = median(margins) if margins else 0.0

    output: list[ExtractedBlock] = []
    run: list[ExtractedBlock] = []

    def flush() -> None:
        if run:
            output.append(_merge(run, lexicon, counters))
            run.clear()

    for block in prepared:
        if block.kind == "paragraph" and not block.removed:
            if run and _should_break(run[-1], block, pitch, left_margin):
                flush()
            run.append(block)
            continue
        if block.kind == "table_candidate" and not block.removed:
            if run and run[-1].kind == "table_candidate":
                previous = run.pop()
                run.append(
                    previous.model_copy(
                        update={
                            "text": previous.text + "\n" + block.text,
                            "line_count": previous.line_count + block.line_count,
                        }
                    )
                )
                continue
            flush()
            run.append(block)
            continue
        flush()
        output.append(block)
    flush()

    final: list[ExtractedBlock] = []
    for block in output:
        if block.kind in {"page_mark", "repeated_marginalia", "noise"} or block.removed:
            final.append(block)
            continue
        cleaned = clean_words(block.text, lexicon, protected=protected)
        metadata = dict(block.metadata)
        text = cleaned.text
        if cleaned.edits:
            metadata["ocrRaw"] = block.text
            metadata["ocrEdits"] = [
                {"before": edit.before, "after": edit.after, "rule": edit.rule}
                for edit in cleaned.edits
            ]
            assert counters.word_edits is not None and counters.edit_samples is not None
            for edit in cleaned.edits:
                counters.word_edits[edit.rule] += 1
                counters.edit_samples[(edit.before, edit.after)] += 1
        uncertain = uncertain_numbers(text, lexicon) if block.kind != "heading" else []
        if uncertain:
            metadata["review"] = "ocr-uncertain-number"
            metadata["uncertainNumbers"] = sorted(set(uncertain))
            counters.uncertain_number_paragraphs += 1
            counters.uncertain_numbers += len(uncertain)
        final.append(block.model_copy(update={"text": text, "metadata": metadata}))
    character_count = sum(len(b.text) for b in final if not b.removed and b.kind != "page_mark")
    return page.model_copy(
        update={
            "blocks": [b.model_copy(update={"order_index": i}) for i, b in enumerate(final)],
            "character_count": character_count,
        }
    )


# ---------------------------------------------------------------------------------------------
# 4. Document quality
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class QualityThresholds:
    low_mean_confidence: float = 0.80
    fair_mean_confidence: float = 0.90
    low_unknown_word_ratio: float = 0.12
    fair_unknown_word_ratio: float = 0.06
    low_confidence_line_ratio: float = 0.15
    uncertain_numbers_per_1000_words: float = 6.0


def unknown_word_ratio(text: str, lexicon: Lexicon) -> float | None:
    words = [w.casefold() for w in re.findall(r"[а-яёА-ЯЁ]{4,}", text)]
    if not words:
        return None
    return sum(1 for w in words if lexicon.cyrillic.get(w, 0) < 3) / len(words)


def grade_quality(
    *,
    mean_confidence: float | None,
    low_confidence_ratio: float | None,
    unknown_ratio: float | None,
    uncertain_per_1000: float,
    word_count: int,
    thresholds: QualityThresholds | None = None,
) -> tuple[str, list[str]]:
    """`good` / `fair` / `low` with the measured reasons; the app shows its note only for `low`."""
    thresholds = thresholds or QualityThresholds()
    low: list[str] = []
    fair: list[str] = []
    if word_count < 15:
        low.append("almost no recognised text")
    if mean_confidence is not None:
        if mean_confidence < thresholds.low_mean_confidence:
            low.append(f"mean recognition confidence {mean_confidence:.2f}")
        elif mean_confidence < thresholds.fair_mean_confidence:
            fair.append(f"mean recognition confidence {mean_confidence:.2f}")
    if (
        low_confidence_ratio is not None
        and low_confidence_ratio > thresholds.low_confidence_line_ratio
    ):
        low.append(f"{low_confidence_ratio:.0%} of characters recognised with low confidence")
    if unknown_ratio is not None:
        if unknown_ratio > thresholds.low_unknown_word_ratio:
            low.append(f"{unknown_ratio:.0%} unknown words")
        elif unknown_ratio > thresholds.fair_unknown_word_ratio:
            fair.append(f"{unknown_ratio:.0%} unknown words")
    if uncertain_per_1000 > thresholds.uncertain_numbers_per_1000_words:
        low.append(f"{uncertain_per_1000:.1f} uncertain numbers per 1000 words")
    elif uncertain_per_1000 > 0:
        fair.append("some numbers are uncertain")
    if low:
        return "low", low
    if fair:
        return "fair", fair
    return "good", []


def ocr_signal_from_confidences(blocks: Sequence[RawBlock], pages: set[int]) -> OcrSignal:
    return pdf_import.ocr_signal_from_blocks(list(blocks), "macos-vision", pages)


# ---------------------------------------------------------------------------------------------
# Orchestration for one PDF
# ---------------------------------------------------------------------------------------------


def _native_page_usable(text: str, lexicon: Lexicon | None) -> bool:
    if len(text.strip()) < MIN_NATIVE_PAGE_CHARACTERS:
        return False
    letters = [character for character in text if character.isalpha()]
    cyrillic = sum(1 for character in letters if character.casefold() in CYRILLIC_LETTERS)
    if len(letters) >= 30 and cyrillic / len(letters) < 0.3:
        return False  # a text layer with a broken font encoding reads as Latin look-alike noise
    if lexicon is None:
        return True
    words = [w.casefold() for w in re.findall(r"[а-яёА-ЯЁ]{4,}", text)]
    if len(words) < 8:
        return True
    known = sum(1 for w in words if lexicon.cyrillic.get(w, 0) >= 3)
    return known / len(words) >= NATIVE_PAGE_MIN_KNOWN_WORDS


def extract_with_vision(
    source: Path,
    payload: Mapping[str, Any],
    lexicon: Lexicon | None,
    *,
    protected: Sequence[str] = (),
    options: ExtractionOptions | None = None,
    thresholds: QualityThresholds | None = None,
) -> ExtractedSource:
    """The prepared extraction of a scanned (or partly scanned) instruction PDF."""
    configured = options or ExtractionOptions()
    document: Any = pymupdf.open(source)
    counters = CleanupCounters()
    try:
        raw_blocks: list[RawBlock] = []
        dimensions: dict[int, tuple[float, float]] = {}
        ocr_pages: set[int] = set()
        for index in range(document.page_count):
            page = document.load_page(index)
            number = index + 1
            dimensions[number] = (float(page.rect.width), float(page.rect.height))
            native = pdf_import._extract_raw_blocks(page, index, configured)  # pyright: ignore[reportPrivateUsage]
            native_text = "\n".join(block.text for block in native)
            if native and _native_page_usable(native_text, lexicon):
                raw_blocks.extend(native)
            else:
                ocr_pages.add(number)
        vision_blocks = raw_blocks_from_vision(payload, ocr_pages)
        raw_blocks.extend(vision_blocks)
        raw_blocks.sort(key=lambda block: (block.page, block.order_index))
        body_font = pdf_import._weighted_body_font(raw_blocks, configured)  # pyright: ignore[reportPrivateUsage]
        pages, removed = pdf_import._classify_blocks(raw_blocks, body_font, configured)  # pyright: ignore[reportPrivateUsage]
        confidences: dict[int, dict[int, float | None]] = {}
        for block in vision_blocks:
            confidences.setdefault(block.page, {})[block.order_index] = block.confidence
        refined: list[ExtractedPage] = []
        for page in pages:
            if page.page in ocr_pages:
                refined.append(
                    refine_page(page, confidences.get(page.page, {}), lexicon, protected, counters)
                )
            else:
                refined.append(page)
        existing = {page.page for page in refined}
        for number, (width, height) in dimensions.items():
            if number not in existing:
                refined.append(
                    ExtractedPage(
                        page=number,
                        width=width,
                        height=height,
                        blocks=[],
                        character_count=0,
                        low_text=True,
                    )
                )
        refined.sort(key=lambda page: page.page)
    finally:
        document.close()

    included_text = " ".join(
        block.text
        for page in refined
        for block in page.blocks
        if not block.removed and block.kind != "page_mark" and block.text.strip()
    )
    signal = ocr_signal_from_confidences(vision_blocks, ocr_pages) if ocr_pages else None
    checksum = pdf_import.sha256_file(source)
    diagnostics = pdf_import._build_diagnostics(  # pyright: ignore[reportPrivateUsage]
        checksum,
        refined,
        body_font,
        removed,
        text_extraction_mode="ocr" if ocr_pages else "pdf_text_layer",
        included_text=included_text,
        ocr_signal=signal,
    )
    if ocr_pages:
        words = len(words_of(included_text))
        ratio = unknown_word_ratio(included_text, lexicon) if lexicon is not None else None
        per_1000 = counters.uncertain_numbers * 1000 / words if words else 0.0
        grade, reasons = grade_quality(
            mean_confidence=signal.mean_confidence if signal else None,
            low_confidence_ratio=signal.low_confidence_ratio if signal else None,
            unknown_ratio=ratio,
            uncertain_per_1000=per_1000,
            word_count=words,
            thresholds=thresholds,
        )
        assert counters.word_edits is not None
        diagnostics = diagnostics.model_copy(
            update={
                "ocr_quality": grade,
                "ocr_quality_reasons": reasons,
                "ocr_cleanup": {
                    "tool": OCR_TOOL,
                    "pagesRecognised": sorted(ocr_pages),
                    "pageMarks": counters.page_marks,
                    "headingsRecovered": counters.headings_recovered,
                    "headingsDemoted": counters.headings_demoted,
                    "paragraphsReflowed": counters.paragraphs_reflowed,
                    "linesJoined": counters.lines_joined,
                    "hyphensJoined": counters.hyphens_joined,
                    "wordEdits": dict(counters.word_edits),
                    "uncertainNumbers": counters.uncertain_numbers,
                    "uncertainNumberParagraphs": counters.uncertain_number_paragraphs,
                    "unknownWordRatio": round(ratio, 4) if ratio is not None else None,
                    "wordCount": words,
                },
            }
        )
    return ExtractedSource(
        source_file=source.name,
        source_checksum=checksum,
        source_format="pdf",
        pages=refined,
        diagnostics=diagnostics,
    )
