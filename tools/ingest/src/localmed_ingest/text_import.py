from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from .models import (
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionDiagnostics,
)
from .normalization import normalize_surface_text
from .pdf_import import COMMON_HEADING_MARKERS, LIST_PATTERN, NUMBERED_HEADING_PATTERN, sha256_file

SourceTextFormat = Literal["text", "markdown"]

MARKDOWN_HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def _looks_like_text_heading(text: str) -> int | None:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned or len(cleaned) > 180 or cleaned.endswith((".", ",", ";")):
        return None
    markdown = MARKDOWN_HEADING_PATTERN.match(cleaned)
    if markdown:
        return len(markdown.group(1))
    numbered = NUMBERED_HEADING_PATTERN.match(cleaned)
    if numbered:
        return min(6, numbered.group("number").count(".") + 1)
    normalized = normalize_surface_text(cleaned).rstrip(".:")
    if any(
        normalized == marker or normalized.endswith(f" {marker}")
        for marker in COMMON_HEADING_MARKERS
    ):
        return 2
    letters = [character for character in cleaned if character.isalpha()]
    uppercase_ratio = (
        sum(character.isupper() for character in letters) / len(letters) if letters else 0.0
    )
    if uppercase_ratio >= 0.85 and 3 <= len(letters) <= 100:
        return 2
    return None


def _split_text_blocks(
    text: str, source_format: SourceTextFormat, *, line_offset: int = 0
) -> list[ExtractedBlock]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[ExtractedBlock] = []
    buffer: list[str] = []
    buffer_start = 1

    def flush(end_line: int) -> None:
        nonlocal buffer, buffer_start
        if not buffer:
            return
        raw = "\n".join(buffer).strip()
        buffer = []
        if not raw:
            return
        heading_level = _looks_like_text_heading(raw)
        if heading_level is not None:
            match = MARKDOWN_HEADING_PATTERN.match(raw)
            cleaned = match.group(2).strip() if match else raw
            kind = "heading"
        else:
            cleaned = raw
            nonempty = [line.strip() for line in raw.splitlines() if line.strip()]
            kind = (
                "list"
                if nonempty
                and sum(1 for line in nonempty if LIST_PATTERN.match(line))
                >= max(1, len(nonempty) // 2)
                else "paragraph"
            )
        blocks.append(
            ExtractedBlock(
                id=f"l{buffer_start}-l{end_line}",
                page=None,
                order_index=len(blocks),
                kind=kind,
                text=cleaned,
                heading_level=heading_level,
                line_count=max(1, end_line - buffer_start + 1),
                metadata={"lineStart": buffer_start, "lineEnd": end_line},
            )
        )

    for line_number, line in enumerate(lines, start=1 + line_offset):
        if not line.strip():
            flush(line_number - 1)
            buffer_start = line_number + 1
            continue
        if source_format == "markdown" and MARKDOWN_HEADING_PATTERN.match(line):
            flush(line_number - 1)
            buffer_start = line_number
            buffer = [line]
            flush(line_number)
            buffer_start = line_number + 1
            continue
        if not buffer:
            buffer_start = line_number
        buffer.append(line)
    flush(len(lines))
    return blocks


def _strip_markdown_front_matter(text: str) -> tuple[str, int, bool]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if not lines or lines[0].strip() != "---":
        return normalized, 0, False
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "\n".join(lines[index + 1 :]), index + 1, True
    return normalized, 0, False


def extract_text(source: Path, source_format: SourceTextFormat = "text") -> ExtractedSource:
    if source_format not in {"text", "markdown"}:
        raise ValueError(f"Unsupported text source format: {source_format}")
    raw_text = source.read_text(encoding="utf-8-sig")
    line_offset = 0
    stripped_front_matter = False
    if source_format == "markdown":
        raw_text, line_offset, stripped_front_matter = _strip_markdown_front_matter(raw_text)
    blocks = _split_text_blocks(raw_text, source_format, line_offset=line_offset)
    character_count = sum(len(block.text) for block in blocks)
    heading_count = sum(block.kind == "heading" for block in blocks)
    reasons: list[str] = []
    if character_count < 500:
        reasons.append("Extracted text is too short for a clinical recommendation.")
    if heading_count == 0:
        reasons.append("No heading candidates were detected.")
    quality_score = 1.0
    if character_count < 500:
        quality_score -= 0.35
    if heading_count == 0:
        quality_score -= 0.2
    checksum = sha256_file(source)
    page = ExtractedPage(
        page=1,
        width=1.0,
        height=1.0,
        blocks=blocks,
        character_count=character_count,
        low_text=character_count < 40,
    )
    diagnostics = ExtractionDiagnostics(
        source_checksum=checksum,
        source_format=source_format,
        page_count=0,
        block_count=len(blocks),
        included_block_count=len(blocks),
        character_count=character_count,
        low_text_pages=[],
        removed_repeated_blocks=0,
        heading_candidates=heading_count,
        table_candidates=0,
        body_font_size=None,
        quality_score=max(0.0, min(1.0, quality_score)),
        requires_review=bool(reasons),
        review_reasons=reasons,
        warnings=[
            "Text sources do not provide reliable page coordinates.",
            *(
                ["Existing Markdown front matter was excluded from searchable text."]
                if stripped_front_matter
                else []
            ),
        ],
    )
    return ExtractedSource(
        source_file=source.name,
        source_checksum=checksum,
        source_format=source_format,
        pages=[page],
        diagnostics=diagnostics,
    )


def import_text(
    source: Path, output: Path, source_format: SourceTextFormat = "text"
) -> ExtractedSource:
    extracted = extract_text(source, source_format)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(extracted.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return extracted
