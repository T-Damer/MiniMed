from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass, field, replace
from html.parser import HTMLParser
from pathlib import Path
from typing import cast

from pydantic import BaseModel, ConfigDict, Field

from .models import (
    BlockKind,
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionDiagnostics,
)

_SPACE_PATTERN = re.compile(r"\s+")
_SECTION_NUMBER_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?\s+\S")
_IMAGE_DATA_URL_PATTERN = re.compile(
    r"^data:image/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$",
    re.IGNORECASE,
)
_IGNORED_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "form", "button"}
_BLOCK_TAGS = {"p", "li", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6"}
_FILENAME_LABEL = re.compile(
    r"^(?:[a-z0-9][a-z0-9._-]*)\.(?:png|jpe?g|gif|webp|bmp|svg)$",
    re.IGNORECASE,
)
_FIGURE_CAPTION = re.compile(
    r"^(рис(?:унок)?|fig(?:ure)?|табл(?:ица)?)\.?\s*\d+",
    re.IGNORECASE,
)


def _clean_text(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value.replace("\xa0", " ")).strip()


def _usable_image_label(value: str) -> str:
    cleaned = _clean_text(value)
    if not cleaned or _FILENAME_LABEL.fullmatch(cleaned):
        return ""
    return cleaned


def _is_figure_caption_text(value: str) -> bool:
    return bool(_FIGURE_CAPTION.match(_clean_text(value)))


def _render_block(block: _ParsedBlock) -> dict[str, object] | None:
    render = block.metadata.get("renderBlock")
    return render if isinstance(render, dict) else None


def _block_needs_caption(block: _ParsedBlock) -> bool:
    render = _render_block(block)
    if render is None:
        return False
    if render.get("kind") == "image":
        return not _usable_image_label(str(render.get("title") or "")) and not _usable_image_label(
            str(render.get("alt") or "")
        )
    if render.get("kind") == "table":
        return not _clean_text(str(render.get("caption") or ""))
    return False


def _with_caption(block: _ParsedBlock, caption: str) -> _ParsedBlock:
    render = dict(_render_block(block) or {})
    if render.get("kind") == "image":
        render["title"] = caption
        if not _usable_image_label(str(render.get("alt") or "")):
            render["alt"] = caption
        return replace(block, text=caption, metadata={"renderBlock": render})
    if render.get("kind") == "table":
        render["caption"] = caption
        return replace(block, metadata={**block.metadata, "renderBlock": render})
    return block


def _attach_adjacent_figure_captions(blocks: list[_ParsedBlock]) -> list[_ParsedBlock]:
    consumed: set[int] = set()
    attached = list(blocks)
    for index, block in enumerate(blocks):
        if not _block_needs_caption(block):
            continue
        for neighbor in (index + 1, index - 1):
            if neighbor < 0 or neighbor >= len(blocks) or neighbor in consumed:
                continue
            candidate = blocks[neighbor]
            if candidate.kind != "paragraph" or not _is_figure_caption_text(candidate.text):
                continue
            attached[index] = _with_caption(block, candidate.text)
            consumed.add(neighbor)
            break
    return [block for index, block in enumerate(attached) if index not in consumed]


def _attribute(attrs: list[tuple[str, str | None]], name: str) -> str:
    return next((value or "" for key, value in attrs if key.lower() == name), "")


def _span(value: str) -> int:
    try:
        return min(100, max(1, int(value)))
    except ValueError:
        return 1


class _OfficialSection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    title: str = ""
    content: str | None = None


class _OfficialObject(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sections: list[_OfficialSection] = Field(min_length=1)


class _OfficialClinicalDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    obj: _OfficialObject


@dataclass(frozen=True)
class _ParsedBlock:
    kind: BlockKind
    text: str
    heading_level: int | None = None
    metadata: dict[str, object] = field(default_factory=dict)


class _StructuredHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[_ParsedBlock] = []
        self.warnings: list[str] = []
        self._ignored_depth = 0
        self._current_tag: str | None = None
        self._current_parts: list[str] = []
        self._table_depth = 0
        self._table_rows: list[dict[str, object]] = []
        self._table_row: list[dict[str, object]] | None = None
        self._table_cell: dict[str, object] | None = None
        self._table_cell_parts: list[str] | None = None
        self._table_caption_parts: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered in _IGNORED_TAGS:
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if lowered == "table":
            self._flush_block()
            self._table_depth += 1
            if self._table_depth == 1:
                self._table_rows = []
                self._table_caption_parts = None
            return
        if self._table_depth:
            if lowered == "caption":
                self._table_caption_parts = []
            elif lowered == "tr":
                self._table_row = []
            elif lowered in {"td", "th"}:
                self._table_cell = {
                    "header": lowered == "th",
                    "rowSpan": _span(_attribute(attrs, "rowspan")),
                    "colSpan": _span(_attribute(attrs, "colspan")),
                    "images": [],
                }
                self._table_cell_parts = []
            elif lowered == "br" and self._table_cell_parts is not None:
                self._table_cell_parts.append("\n")
            elif (
                lowered == "img"
                and self._table_cell is not None
                and self._table_cell_parts is not None
            ):
                image = self._read_image(attrs)
                if image is not None:
                    cast(list[dict[str, object]], self._table_cell["images"]).append(image)
                    self._table_cell_parts.append(
                        _usable_image_label(cast(str, image["alt"]))
                        or _usable_image_label(cast(str, image["title"]))
                        or "Иллюстрация"
                    )
            return
        if lowered == "img":
            self._flush_block()
            self._append_image(attrs)
            return
        if lowered in _BLOCK_TAGS:
            self._flush_block()
            self._current_tag = lowered
            self._current_parts = []
        elif lowered == "br" and self._current_tag is not None:
            self._current_parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() != "img":
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in _IGNORED_TAGS:
            if self._ignored_depth:
                self._ignored_depth -= 1
            return
        if self._ignored_depth:
            return
        if self._table_depth:
            if lowered in {"td", "th"} and self._table_cell is not None:
                cell = {
                    **self._table_cell,
                    "text": _clean_text("".join(self._table_cell_parts or [])),
                }
                if self._table_row is not None:
                    self._table_row.append(cell)
                self._table_cell = None
                self._table_cell_parts = None
            elif lowered == "tr" and self._table_row is not None:
                if self._table_row:
                    self._table_rows.append({"cells": self._table_row})
                self._table_row = None
            elif lowered == "table":
                self._table_depth -= 1
                if self._table_depth == 0:
                    self._flush_table()
            return
        if self._current_tag == lowered:
            self._flush_block()

    def handle_data(self, data: str) -> None:
        if self._ignored_depth:
            return
        if self._table_depth:
            if self._table_cell_parts is not None:
                self._table_cell_parts.append(data)
            elif self._table_caption_parts is not None:
                self._table_caption_parts.append(data)
            return
        if self._current_tag is not None:
            self._current_parts.append(data)

    def close(self) -> None:
        self._flush_block()
        if self._table_depth:
            self.warnings.append("Unclosed table markup was discarded.")
        super().close()

    def _append_image(self, attrs: list[tuple[str, str | None]]) -> None:
        image = self._read_image(attrs)
        if image is None:
            return
        self.blocks.append(
            _ParsedBlock(
                kind="image",
                text=_usable_image_label(cast(str, image["alt"]))
                or _usable_image_label(cast(str, image["title"]))
                or "Иллюстрация",
                metadata={"renderBlock": image},
            )
        )

    def _read_image(self, attrs: list[tuple[str, str | None]]) -> dict[str, object] | None:
        source = _attribute(attrs, "src").strip()
        match = _IMAGE_DATA_URL_PATTERN.fullmatch(source)
        if not match:
            self.warnings.append("An unsupported non-embedded or unsafe image was discarded.")
            return None
        encoded = re.sub(r"\s+", "", match.group(2))
        try:
            payload = base64.b64decode(encoded, validate=True)
        except ValueError:
            self.warnings.append("An invalid embedded image was discarded.")
            return None
        mime_type = f"image/{match.group(1).lower()}"
        alt = _usable_image_label(_attribute(attrs, "alt"))
        title = _usable_image_label(_attribute(attrs, "title"))
        return {
            "kind": "image",
            "dataUrl": f"data:{mime_type};base64,{encoded}",
            "mimeType": mime_type,
            "alt": alt,
            "title": title,
            "sha256": f"sha256:{hashlib.sha256(payload).hexdigest()}",
            "byteLength": len(payload),
        }

    def _flush_table(self) -> None:
        rows = self._table_rows
        self._table_rows = []
        caption = _clean_text("".join(self._table_caption_parts or []))
        self._table_caption_parts = None
        text_rows = [
            " | ".join(
                cast(str, cell.get("text", ""))
                for cell in cast(list[dict[str, object]], row["cells"])
            )
            for row in rows
        ]
        text = "\n".join(row for row in text_rows if row.strip(" |"))
        if not rows or not text:
            self.warnings.append("An empty table was discarded.")
            return
        self.blocks.append(
            _ParsedBlock(
                kind="table_candidate",
                text=text,
                metadata={
                    "renderBlock": {
                        "kind": "table",
                        "caption": caption,
                        "rows": rows,
                    }
                },
            )
        )

    def _flush_block(self) -> None:
        if self._current_tag is None:
            return
        text = _clean_text("".join(self._current_parts))
        tag = self._current_tag
        self._current_tag = None
        self._current_parts = []
        if not text:
            return
        if tag.startswith("h") and tag[1:].isdigit():
            self.blocks.append(
                _ParsedBlock(
                    kind="heading",
                    heading_level=min(6, max(1, int(tag[1:]))),
                    text=text,
                )
            )
        elif tag == "li":
            self.blocks.append(_ParsedBlock(kind="list", text=f"- {text}"))
        else:
            self.blocks.append(_ParsedBlock(kind="paragraph", text=text))


def _section_heading_level(title: str) -> int:
    match = _SECTION_NUMBER_PATTERN.match(title)
    return min(6, match.group(1).count(".") + 1) if match else 1


def extract_clinical_json(source: Path) -> ExtractedSource:
    raw = source.read_bytes()
    try:
        payload: object = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid official clinical JSON: {source.name}") from error
    document = _OfficialClinicalDocument.model_validate(payload)

    blocks: list[ExtractedBlock] = []
    warnings: list[str] = []
    order = 0
    source_sections = [section for section in document.obj.sections if section.id != "doc_whole"]
    for section_index, section in enumerate(source_sections):
        title = _clean_text(section.title)
        if title:
            blocks.append(
                ExtractedBlock(
                    id=f"json-b{order + 1}",
                    page=None,
                    order_index=order,
                    kind="heading",
                    text=title,
                    heading_level=_section_heading_level(title),
                    metadata={
                        "sourceSectionId": section.id,
                        "sourceSectionOrder": section_index,
                    },
                )
            )
            order += 1
        parser = _StructuredHtmlParser()
        parser.feed(section.content or "")
        parser.close()
        warnings.extend(f"{section.id}: {warning}" for warning in parser.warnings)
        for parsed in _attach_adjacent_figure_captions(parser.blocks):
            render = parsed.metadata.get("renderBlock")
            if (
                isinstance(render, dict)
                and render.get("kind") == "image"
                and _block_needs_caption(parsed)
            ):
                warnings.append(
                    f"{section.id}: A figure had no nearby caption; the source alt was a filename."
                )
            blocks.append(
                ExtractedBlock(
                    id=f"json-b{order + 1}",
                    page=None,
                    order_index=order,
                    kind=parsed.kind,
                    text=parsed.text,
                    heading_level=parsed.heading_level,
                    line_count=max(1, parsed.text.count("\n") + 1),
                    metadata={
                        "sourceSectionId": section.id,
                        "sourceSectionOrder": section_index,
                        **parsed.metadata,
                    },
                )
            )
            order += 1

    character_count = sum(len(block.text) for block in blocks)
    heading_count = sum(block.kind == "heading" for block in blocks)
    table_count = sum(block.kind == "table_candidate" for block in blocks)
    reasons: list[str] = []
    if len(source_sections) < 10:
        reasons.append("Official JSON contains unexpectedly few document sections.")
    if character_count < 5_000:
        reasons.append("Official JSON is unexpectedly short for a clinical recommendation.")
    if heading_count < 3:
        reasons.append("Official JSON contains too few section headings.")
    if not blocks:
        reasons.append("Official JSON produced no searchable content blocks.")

    checksum = f"sha256:{hashlib.sha256(raw).hexdigest()}"
    page = ExtractedPage(
        page=1,
        width=1.0,
        height=1.0,
        blocks=blocks,
        character_count=character_count,
        low_text=character_count < 40,
    )
    return ExtractedSource(
        source_file=source.name,
        source_checksum=checksum,
        source_format="clinical_json",
        pages=[page],
        diagnostics=ExtractionDiagnostics(
            source_checksum=checksum,
            source_format="clinical_json",
            page_count=0,
            block_count=len(blocks),
            included_block_count=len(blocks),
            character_count=character_count,
            low_text_pages=[],
            removed_repeated_blocks=0,
            heading_candidates=heading_count,
            table_candidates=table_count,
            body_font_size=None,
            quality_score=0.75 if reasons or warnings else 1.0,
            requires_review=bool(reasons or warnings),
            review_reasons=reasons,
            warnings=[
                "Official structured JSON does not provide PDF page coordinates.",
                *warnings,
            ],
        ),
    )
