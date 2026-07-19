from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from statistics import median
from typing import Any

import pymupdf

from .models import (
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionDiagnostics,
    ExtractionOptions,
)
from .normalization import normalize_surface_text

NUMBERED_HEADING_PATTERN = re.compile(r"^(?P<number>\d+(?:\.\d+){0,5})[.)]?\s+\S")
LIST_PATTERN = re.compile(r"^(?:[•▪◦●○*+–—-]|\d+[.)])\s+")
PAGE_NUMBER_PATTERN = re.compile(r"^(?:стр(?:аница)?\.?\s*)?\d+(?:\s*(?:из|/)\s*\d+)?$", re.I)
COMMON_HEADING_MARKERS = {
    "общая информация",
    "краткая информация",
    "определение заболевания",
    "этиология и патогенез",
    "эпидемиология",
    "классификация",
    "клиническая картина",
    "диагностика",
    "лечение",
    "реабилитация",
    "профилактика",
    "организация оказания медицинской помощи",
    "критерии оценки качества медицинской помощи",
}


@dataclass(frozen=True)
class RawBlock:
    page: int
    page_width: float
    page_height: float
    order_index: int
    bbox: tuple[float, float, float, float]
    text: str
    font_size: float | None
    font_name: str | None
    bold: bool
    line_count: int
    columnar_lines: int


def sha256_file(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def _coerce_bbox(value: object) -> tuple[float, float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return (0.0, 0.0, 0.0, 0.0)
    return tuple(float(item) for item in value)  # type: ignore[return-value]


def _is_bold(font_name: str | None, flags: int) -> bool:
    normalized = (font_name or "").lower()
    return bool(flags & 16) or any(
        marker in normalized for marker in ("bold", "black", "demi", "semibold", "heavy")
    )


def _merge_spans(spans: list[dict[str, Any]]) -> tuple[str, float | None, str | None, bool]:
    parts: list[str] = []
    sizes: list[float] = []
    fonts: list[str] = []
    bold_characters = 0
    total_characters = 0
    previous_x1: float | None = None
    previous_size = 0.0

    for span in spans:
        text = str(span.get("text", ""))
        if not text:
            continue
        bbox = _coerce_bbox(span.get("bbox"))
        size = float(span.get("size", 0.0) or 0.0)
        font = str(span.get("font", "")) or None
        flags = int(span.get("flags", 0) or 0)
        if parts and not parts[-1].endswith((" ", "\t", "\n")) and not text.startswith(" "):
            gap = bbox[0] - (previous_x1 or bbox[0])
            if gap > max(1.5, previous_size * 0.18):
                parts.append(" ")
        parts.append(text)
        if size > 0:
            sizes.extend([size] * max(1, min(len(text.strip()), 80)))
        if font:
            fonts.append(font)
        character_count = len(text.strip())
        total_characters += character_count
        if _is_bold(font, flags):
            bold_characters += character_count
        previous_x1 = bbox[2]
        previous_size = size

    joined = re.sub(r"[ \t]+", " ", "".join(parts)).strip()
    return (
        joined,
        median(sizes) if sizes else None,
        max(set(fonts), key=fonts.count) if fonts else None,
        total_characters > 0 and bold_characters / total_characters >= 0.55,
    )


def _join_lines(lines: list[str], *, dehyphenate: bool) -> str:
    if not lines:
        return ""
    if sum(1 for line in lines if LIST_PATTERN.match(line)) >= max(1, len(lines) // 2):
        return "\n".join(line.strip() for line in lines if line.strip())

    result = lines[0].strip()
    for next_line in lines[1:]:
        candidate = next_line.strip()
        if not candidate:
            continue
        if (
            dehyphenate
            and result.endswith("-")
            and candidate[:1].islower()
            and len(result.rsplit(" ", 1)[-1]) >= 3
        ):
            result = result[:-1] + candidate
        else:
            result = f"{result} {candidate}"
    return re.sub(r"[ \t]+", " ", result).strip()


def _extract_raw_blocks(page: Any, page_index: int, options: ExtractionOptions) -> list[RawBlock]:
    payload = page.get_text("dict", sort=True)
    width = float(payload.get("width", page.rect.width))
    height = float(payload.get("height", page.rect.height))
    raw_blocks = payload.get("blocks", [])
    blocks: list[RawBlock] = []
    if not isinstance(raw_blocks, list):
        return blocks

    for source_order, raw_block in enumerate(raw_blocks):
        if not isinstance(raw_block, dict) or int(raw_block.get("type", -1)) != 0:
            continue
        raw_lines = raw_block.get("lines", [])
        if not isinstance(raw_lines, list):
            continue
        line_texts: list[str] = []
        sizes: list[float] = []
        fonts: list[str] = []
        bold_lines = 0
        columnar_lines = 0
        for raw_line in raw_lines:
            if not isinstance(raw_line, dict):
                continue
            raw_spans = raw_line.get("spans", [])
            if not isinstance(raw_spans, list):
                continue
            spans = [span for span in raw_spans if isinstance(span, dict)]
            text, font_size, font_name, bold = _merge_spans(spans)
            if not text:
                continue
            line_texts.append(text)
            if font_size is not None:
                sizes.extend([font_size] * max(1, min(len(text), 80)))
            if font_name:
                fonts.append(font_name)
            if bold:
                bold_lines += 1
            if len(spans) >= 3:
                x_positions = [_coerce_bbox(span.get("bbox"))[0] for span in spans]
                gaps = [right - left for left, right in pairwise(x_positions)]
                if sum(1 for gap in gaps if gap >= max(24.0, (font_size or 10.0) * 2.4)) >= 2:
                    columnar_lines += 1

        text = _join_lines(line_texts, dehyphenate=options.join_hyphenated_lines)
        if not text:
            continue
        block_bbox = _coerce_bbox(raw_block.get("bbox"))
        blocks.append(
            RawBlock(
                page=page_index + 1,
                page_width=width,
                page_height=height,
                order_index=source_order,
                bbox=block_bbox,
                text=text,
                font_size=median(sizes) if sizes else None,
                font_name=max(set(fonts), key=fonts.count) if fonts else None,
                bold=bool(line_texts) and bold_lines / len(line_texts) >= 0.5,
                line_count=len(line_texts),
                columnar_lines=columnar_lines,
            )
        )
    return blocks


def _canonical_marginalia(text: str) -> str:
    normalized = normalize_surface_text(text)
    normalized = re.sub(r"\b\d+\b", "#", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _is_marginal(block: RawBlock, options: ExtractionOptions) -> bool:
    return block.bbox[1] <= block.page_height * options.top_margin_ratio or block.bbox[
        3
    ] >= block.page_height * (1 - options.bottom_margin_ratio)


def _weighted_body_font(blocks: list[RawBlock], options: ExtractionOptions) -> float | None:
    values: list[float] = []
    for block in blocks:
        if block.font_size is None or _is_marginal(block, options):
            continue
        values.extend([block.font_size] * max(1, min(len(block.text), 200)))
    return median(values) if values else None


def _is_noise(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    letters = sum(character.isalpha() for character in stripped)
    digits = sum(character.isdigit() for character in stripped)
    return letters == 0 and digits <= 1


def _looks_like_list(block: RawBlock) -> bool:
    lines = [line.strip() for line in block.text.splitlines() if line.strip()]
    return bool(lines) and sum(1 for line in lines if LIST_PATTERN.match(line)) >= max(
        1, len(lines) // 2
    )


def _numbered_heading_depth(text: str) -> int | None:
    match = NUMBERED_HEADING_PATTERN.match(text)
    if not match:
        return None
    return min(6, match.group("number").count(".") + 1)


def _looks_like_heading(
    block: RawBlock, body_font_size: float | None, options: ExtractionOptions
) -> int | None:
    text = re.sub(r"\s+", " ", block.text).strip()
    if not text or len(text) > options.max_heading_characters or "\n" in text:
        return None
    if LIST_PATTERN.match(text) and _numbered_heading_depth(text) is None:
        return None
    if text.endswith((";", ",")):
        return None
    numbered_depth = _numbered_heading_depth(text)
    normalized = normalize_surface_text(text).rstrip(".:")
    common_marker = any(
        normalized == marker or normalized.endswith(f" {marker}")
        for marker in COMMON_HEADING_MARKERS
    )
    ratio = (
        block.font_size / body_font_size
        if block.font_size is not None and body_font_size not in (None, 0)
        else 1.0
    )
    alphabetic = [character for character in text if character.isalpha()]
    uppercase_ratio = (
        sum(character.isupper() for character in alphabetic) / len(alphabetic)
        if alphabetic
        else 0.0
    )
    title_like = len(text) <= 100 and not text.endswith(".")

    if numbered_depth is not None and (block.bold or ratio >= 1.0 or len(text) <= 90):
        return numbered_depth
    if ratio >= 1.45:
        return 1
    if ratio >= max(options.min_heading_font_ratio, 1.25):
        return 2
    if common_marker:
        return 2
    if block.bold and title_like and ratio >= options.min_heading_font_ratio:
        return 2
    if uppercase_ratio >= 0.85 and 3 <= len(alphabetic) <= 100:
        return 2
    return None


def _classify_blocks(
    raw_blocks: list[RawBlock], body_font_size: float | None, options: ExtractionOptions
) -> tuple[list[ExtractedPage], int]:
    canonical_page_keys: dict[str, set[int]] = defaultdict(set)
    exact_page_keys: dict[str, set[int]] = defaultdict(set)
    for block in raw_blocks:
        if _is_marginal(block, options):
            canonical_key = _canonical_marginalia(block.text)
            exact_key = normalize_surface_text(block.text)
            if canonical_key:
                canonical_page_keys[canonical_key].add(block.page)
            if exact_key:
                exact_page_keys[exact_key].add(block.page)
    required_pages = max(
        options.min_repeated_pages,
        math.ceil(len({block.page for block in raw_blocks}) * options.repeated_block_page_ratio),
    )
    repeated_canonical_keys = {
        key for key, pages in canonical_page_keys.items() if len(pages) >= required_pages
    }
    repeated_exact_keys = {
        key for key, pages in exact_page_keys.items() if len(pages) >= required_pages
    }

    pages_by_number: dict[int, list[ExtractedBlock]] = defaultdict(list)
    removed_repeated = 0
    for block in raw_blocks:
        canonical_key = _canonical_marginalia(block.text)
        exact_key = normalize_surface_text(block.text)
        page_number = PAGE_NUMBER_PATTERN.fullmatch(exact_key) is not None
        potential_heading = _looks_like_heading(block, body_font_size, options)
        repeated = page_number or (
            _is_marginal(block, options)
            and (
                exact_key in repeated_exact_keys
                or (canonical_key in repeated_canonical_keys and potential_heading is None)
            )
        )
        if repeated:
            removed_repeated += 1
            kind = "repeated_marginalia"
            removed = options.remove_repeated_marginalia
            heading_level = None
        elif _is_noise(block.text):
            kind = "noise"
            removed = True
            heading_level = None
        else:
            heading_level = _looks_like_heading(block, body_font_size, options)
            if heading_level is not None:
                kind = "heading"
            elif _looks_like_list(block):
                kind = "list"
            elif block.columnar_lines >= 2:
                kind = "table_candidate"
            else:
                kind = "paragraph"
            removed = False
        pages_by_number[block.page].append(
            ExtractedBlock(
                id=f"p{block.page}-b{block.order_index + 1}",
                page=block.page,
                order_index=block.order_index,
                kind=kind,
                text=block.text,
                bbox=[round(value, 3) for value in block.bbox],
                font_size=round(block.font_size, 3) if block.font_size is not None else None,
                font_name=block.font_name,
                bold=block.bold,
                heading_level=heading_level,
                line_count=block.line_count,
                removed=removed,
                metadata={"columnarLines": block.columnar_lines} if block.columnar_lines else {},
            )
        )

    extracted_pages: list[ExtractedPage] = []
    for page_number in sorted(pages_by_number):
        page_raw = next(block for block in raw_blocks if block.page == page_number)
        blocks = sorted(pages_by_number[page_number], key=lambda item: item.order_index)
        character_count = sum(len(block.text) for block in blocks if not block.removed)
        extracted_pages.append(
            ExtractedPage(
                page=page_number,
                width=page_raw.page_width,
                height=page_raw.page_height,
                blocks=blocks,
                character_count=character_count,
                low_text=character_count < options.min_page_characters,
            )
        )
    return extracted_pages, removed_repeated


def _build_diagnostics(
    checksum: str,
    pages: list[ExtractedPage],
    body_font_size: float | None,
    removed_repeated: int,
) -> ExtractionDiagnostics:
    blocks = [block for page in pages for block in page.blocks]
    included = [block for block in blocks if not block.removed]
    low_text_pages = [page.page for page in pages if page.low_text]
    heading_count = sum(block.kind == "heading" for block in included)
    table_count = sum(block.kind == "table_candidate" for block in included)
    character_count = sum(page.character_count for page in pages)
    reasons: list[str] = []
    warnings: list[str] = []
    if not pages:
        reasons.append("PDF has no pages.")
    if low_text_pages:
        reasons.append(f"Low text coverage on pages: {', '.join(map(str, low_text_pages[:20]))}.")
    if character_count < 500:
        reasons.append("Extracted text is too short for a clinical recommendation.")
    if heading_count == 0:
        reasons.append("No heading candidates were detected.")
    if table_count:
        reasons.append(f"Detected {table_count} table-like blocks that require spot checking.")
    if removed_repeated:
        warnings.append(f"Removed or marked {removed_repeated} repeated header/footer blocks.")

    page_count = len(pages)
    low_ratio = len(low_text_pages) / page_count if page_count else 1.0
    table_ratio = table_count / max(1, len(included))
    score = 1.0
    score -= min(0.55, low_ratio * 0.65)
    score -= min(0.20, table_ratio * 1.5)
    if heading_count == 0:
        score -= 0.15
    if character_count < 500:
        score -= 0.25
    score = max(0.0, min(1.0, score))

    return ExtractionDiagnostics(
        source_checksum=checksum,
        source_format="pdf",
        page_count=page_count,
        block_count=len(blocks),
        included_block_count=len(included),
        character_count=character_count,
        low_text_pages=low_text_pages,
        removed_repeated_blocks=removed_repeated,
        heading_candidates=heading_count,
        table_candidates=table_count,
        body_font_size=round(body_font_size, 3) if body_font_size is not None else None,
        quality_score=round(score, 4),
        requires_review=bool(reasons),
        review_reasons=reasons,
        warnings=warnings,
    )


def extract_pdf(source: Path, options: ExtractionOptions | None = None) -> ExtractedSource:
    configured = options or ExtractionOptions()
    document = pymupdf.open(source)
    try:
        raw_blocks: list[RawBlock] = []
        page_dimensions: dict[int, tuple[float, float]] = {}
        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            page_dimensions[page_index + 1] = (float(page.rect.width), float(page.rect.height))
            raw_blocks.extend(_extract_raw_blocks(page, page_index, configured))
        body_font_size = _weighted_body_font(raw_blocks, configured)
        pages, removed_repeated = _classify_blocks(raw_blocks, body_font_size, configured)
        existing_pages = {page.page for page in pages}
        for page_number, (width, height) in page_dimensions.items():
            if page_number not in existing_pages:
                pages.append(
                    ExtractedPage(
                        page=page_number,
                        width=width,
                        height=height,
                        blocks=[],
                        character_count=0,
                        low_text=True,
                    )
                )
        pages.sort(key=lambda page: page.page)
    finally:
        document.close()

    checksum = sha256_file(source)
    diagnostics = _build_diagnostics(checksum, pages, body_font_size, removed_repeated)
    return ExtractedSource(
        source_file=source.name,
        source_checksum=checksum,
        source_format="pdf",
        pages=pages,
        diagnostics=diagnostics,
    )


def import_pdf(
    source: Path, output: Path, options: ExtractionOptions | None = None
) -> ExtractedSource:
    extracted = extract_pdf(source, options)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(extracted.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return extracted
