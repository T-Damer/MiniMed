from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .models import PackChunk, PackDocument, PackSection, PackVersion, SourceMetadata
from .normalization import normalize_for_index, normalize_surface_text

HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
SOURCE_MARKER_PATTERN = re.compile(r"^<!--\s*localmed:source\s+(.+?)\s*-->$")
REVIEW_MARKER_PATTERN = re.compile(r"^<!--\s*localmed:review\s+(.+?)\s*-->$")


@dataclass(frozen=True)
class DraftParagraph:
    text: str
    source_spans: list[dict[str, object]] = field(default_factory=list)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class DraftChunk:
    text: str
    source_spans: list[dict[str, object]] = field(default_factory=list)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass
class DraftSection:
    title: str
    level: int
    path: list[str]
    paragraphs: list[DraftParagraph] = field(default_factory=list)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def stable_id(prefix: str, value: str) -> str:
    return f"{prefix}.{sha256_text(value)[:16]}"


def slugify(value: str) -> str:
    normalized = normalize_surface_text(value)
    slug = re.sub(r"[^0-9a-zа-я]+", "-", normalized).strip("-")
    return slug[:80] or "section"


def parse_front_matter(text: str) -> tuple[SourceMetadata, str]:
    if not text.startswith("---\n"):
        raise ValueError("Markdown source must start with YAML front matter.")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Markdown source has an unterminated front matter block.")
    raw_metadata = yaml.safe_load(text[4:end])
    if not isinstance(raw_metadata, dict):
        raise ValueError("Front matter must be a mapping.")
    return SourceMetadata.model_validate(raw_metadata), text[end + 5 :]


def _parse_source_marker(line: str) -> dict[str, object] | None:
    match = SOURCE_MARKER_PATTERN.match(line.strip())
    if not match:
        return None
    try:
        payload: object = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid localmed source marker: {line}") from error
    if not isinstance(payload, dict):
        raise ValueError("LocalMed source marker must contain a JSON object.")
    return {str(key): value for key, value in payload.items()}


def split_paragraphs(lines: list[str]) -> list[DraftParagraph]:
    paragraphs: list[DraftParagraph] = []
    buffer: list[str] = []
    pending_spans: list[dict[str, object]] = []
    pending_metadata: dict[str, object] = {}

    def flush() -> None:
        nonlocal pending_spans, pending_metadata
        if not buffer:
            return
        is_list = all(line.lstrip().startswith(("- ", "* ", "+ ", "1. ")) for line in buffer)
        separator = "\n" if is_list or all("|" in line for line in buffer) else " "
        paragraph = separator.join(line.strip() for line in buffer).strip()
        if paragraph:
            paragraphs.append(
                DraftParagraph(
                    text=paragraph,
                    source_spans=[dict(span) for span in pending_spans],
                    metadata=dict(pending_metadata),
                )
            )
        buffer.clear()
        pending_spans = []
        pending_metadata = {}

    for line in lines:
        source_marker = _parse_source_marker(line)
        if source_marker is not None:
            flush()
            pending_spans = [source_marker]
            continue
        review_match = REVIEW_MARKER_PATTERN.match(line.strip())
        if review_match:
            flush()
            pending_metadata["review"] = review_match.group(1).strip()
            continue
        if line.strip():
            buffer.append(line)
        else:
            flush()
    flush()
    return paragraphs


def parse_sections(body: str) -> list[DraftSection]:
    sections: list[DraftSection] = []
    stack: list[tuple[int, str]] = []
    current: DraftSection | None = None
    content_lines: list[str] = []

    def flush_current() -> None:
        nonlocal content_lines
        if current is not None:
            current.paragraphs.extend(split_paragraphs(content_lines))
        content_lines = []

    for line in body.splitlines():
        match = HEADING_PATTERN.match(line)
        if not match:
            if current is None and line.strip():
                current = DraftSection(title="Общая информация", level=1, path=["Общая информация"])
                sections.append(current)
            content_lines.append(line)
            continue

        flush_current()
        level = len(match.group(1))
        title = match.group(2).strip()
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, title))
        current = DraftSection(title=title, level=level, path=[item[1] for item in stack])
        sections.append(current)

    flush_current()
    return sections


def infer_section_type(title: str) -> str:
    normalized = normalize_surface_text(title)
    rules = [
        ("дифференциаль", "differential-diagnosis"),
        ("диагност", "diagnostics"),
        ("лечен", "treatment"),
        ("маршрут", "routing"),
        ("классифика", "classification"),
        ("клиническ", "clinical-picture"),
        ("профилакти", "prevention"),
        ("реабилита", "rehabilitation"),
        ("наблюден", "rehabilitation"),
        ("общая информа", "definition"),
    ]
    return next((section_type for marker, section_type in rules if marker in normalized), "other")


def chunk_paragraphs(
    paragraphs: list[DraftParagraph], target_chars: int = 1800, max_chars: int = 3200
) -> list[DraftChunk]:
    chunks: list[DraftChunk] = []
    current: list[DraftParagraph] = []
    current_size = 0

    def flush() -> None:
        nonlocal current_size
        if not current:
            return
        text = "\n\n".join(paragraph.text for paragraph in current)
        source_spans = [span for paragraph in current for span in paragraph.source_spans]
        metadata: dict[str, object] = {}
        review_values = [
            paragraph.metadata["review"] for paragraph in current if "review" in paragraph.metadata
        ]
        if review_values:
            metadata["review"] = review_values
        chunks.append(DraftChunk(text=text, source_spans=source_spans, metadata=metadata))
        current.clear()
        current_size = 0

    for paragraph in paragraphs:
        paragraph_size = len(paragraph.text)
        if current and current_size + paragraph_size + 2 > target_chars:
            flush()
        if paragraph_size > max_chars:
            for offset in range(0, paragraph_size, max_chars):
                part = paragraph.text[offset : offset + max_chars].strip()
                if part:
                    chunks.append(
                        DraftChunk(
                            text=part,
                            source_spans=[dict(span) for span in paragraph.source_spans],
                            metadata={**paragraph.metadata, "sourcePartOffset": offset},
                        )
                    )
            continue
        current.append(paragraph)
        current_size += paragraph_size + 2
    flush()
    return chunks


def _source_pages(spans: list[dict[str, object]]) -> list[int]:
    pages: list[int] = []
    for span in spans:
        value = span.get("page")
        if isinstance(value, int) and value >= 1:
            pages.append(value)
    return pages


def parse_markdown_document(path: Path, extracted_at: str) -> PackDocument:
    text = path.read_text(encoding="utf-8")
    metadata, body = parse_front_matter(text)
    markdown_checksum = f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
    source_checksum = metadata.source_checksum or markdown_checksum
    version_id = f"{metadata.id}@{metadata.version_label}"
    draft_sections = parse_sections(body)
    pack_sections: list[PackSection] = []
    section_id_by_path: dict[tuple[str, ...], str] = {}
    section_path_occurrences: dict[tuple[str, ...], int] = {}
    section_anchor_occurrences: dict[str, int] = {}
    chunk_order = 0

    for section_order, draft in enumerate(draft_sections):
        path_key = tuple(draft.path)
        occurrence = section_path_occurrences.get(path_key, 0) + 1
        section_path_occurrences[path_key] = occurrence
        path_identity = "/".join(draft.path)
        if occurrence > 1:
            path_identity = f"{path_identity}|{occurrence}"
        section_id = stable_id("section", f"{version_id}|{path_identity}")
        section_id_by_path[path_key] = section_id
        parent_id = section_id_by_path.get(tuple(draft.path[:-1]))
        section_anchor_base = f"{version_id}/{'/'.join(slugify(part) for part in draft.path)}"
        anchor_occurrence = section_anchor_occurrences.get(section_anchor_base, 0) + 1
        section_anchor_occurrences[section_anchor_base] = anchor_occurrence
        section_anchor = section_anchor_base
        if anchor_occurrence > 1:
            section_anchor = f"{section_anchor_base}--{anchor_occurrence}"
        chunks: list[PackChunk] = []
        for local_index, text_chunk in enumerate(chunk_paragraphs(draft.paragraphs)):
            chunk_id = stable_id(
                "chunk",
                f"{section_id}|{normalize_surface_text(text_chunk.text)}|{local_index}",
            )
            pages = _source_pages(text_chunk.source_spans)
            chunk_metadata: dict[str, object] = {"localOrder": local_index}
            if text_chunk.source_spans:
                chunk_metadata["sourceSpans"] = text_chunk.source_spans
            chunk_metadata.update(text_chunk.metadata)
            chunks.append(
                PackChunk(
                    id=chunk_id,
                    order_index=chunk_order,
                    original_text=text_chunk.text,
                    normalized_text=normalize_for_index(
                        f"{metadata.title} {' '.join(draft.path)} {text_chunk.text}"
                    ),
                    page_start=min(pages) if pages else None,
                    page_end=max(pages) if pages else None,
                    anchor=f"{section_anchor}#chunk-{chunk_id.rsplit('.', 1)[-1][:8]}",
                    metadata=chunk_metadata,
                )
            )
            chunk_order += 1
        section_pages = [
            page
            for chunk in chunks
            for page in (chunk.page_start, chunk.page_end)
            if page is not None
        ]
        pack_sections.append(
            PackSection(
                id=section_id,
                parent_section_id=parent_id,
                title=draft.title,
                normalized_title=normalize_for_index(draft.title),
                section_type=infer_section_type(draft.title),
                depth=draft.level,
                order_index=section_order,
                page_start=min(section_pages) if section_pages else None,
                page_end=max(section_pages) if section_pages else None,
                anchor=section_anchor,
                section_path=draft.path,
                chunks=chunks,
            )
        )

    if not any(section.chunks for section in pack_sections):
        raise ValueError(f"Document {metadata.id} has no searchable chunks.")

    document_metadata = {
        "ageGroups": metadata.age_groups,
        "syntheticFixture": metadata.synthetic_fixture,
        **metadata.metadata,
    }
    if metadata.source_file:
        document_metadata["sourceFile"] = metadata.source_file
    return PackDocument(
        id=metadata.id,
        title=metadata.title,
        short_title=metadata.short_title,
        source_type=metadata.source_type,
        status=metadata.status,
        specialties=metadata.specialties,
        metadata=document_metadata,
        version=PackVersion(
            id=version_id,
            label=metadata.version_label,
            effective_from=metadata.effective_from,
            effective_to=metadata.effective_to,
            source_checksum=source_checksum,
            extracted_at=extracted_at,
        ),
        sections=pack_sections,
    )
