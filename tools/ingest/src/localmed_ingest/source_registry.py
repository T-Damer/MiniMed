from __future__ import annotations

import json
import re
import shutil
import uuid
from collections import deque
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Literal, cast

import yaml

from .clinical_json_import import EXTRACTOR_REVISION as CLINICAL_JSON_EXTRACTOR_REVISION
from .clinical_json_import import extract_clinical_json
from .html_import import extract_html
from .leaflet_contents import ContentsRun, find_contents_runs
from .models import (
    ExtractedBlock,
    ExtractedSource,
    PreparedSourceReport,
    PrepareReport,
    RegistrySource,
    SourceRegistry,
)
from .normalization import normalize_surface_text
from .pdf_import import extract_pdf, sha256_file
from .text_import import extract_text


class NoSearchableTextError(ValueError):
    pass


def load_source_registry(path: Path) -> SourceRegistry:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Source registry must be a YAML mapping.")
    return SourceRegistry.model_validate(payload)


def _resolve_source_path(source_root: Path, relative_path: str) -> Path:
    root = source_root.resolve()
    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Source path escapes source root: {relative_path}") from error
    if not candidate.is_file():
        raise FileNotFoundError(f"Source file does not exist: {candidate}")
    return candidate


def _source_format(
    source: RegistrySource, path: Path
) -> Literal["pdf", "text", "markdown", "html", "clinical_json"]:
    if source.format != "auto":
        return source.format
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix in {".html", ".htm"}:
        return "html"
    if suffix in {".txt", ".text"}:
        return "text"
    raise ValueError(f"Cannot infer source format from extension: {path.name}")


def extract_source(source: RegistrySource, path: Path) -> ExtractedSource:
    source_format = _source_format(source, path)
    if source_format == "pdf":
        return extract_pdf(path, source.extraction)
    if source_format == "clinical_json":
        return extract_clinical_json(path)
    if source_format == "html":
        return extract_html(path)
    return extract_text(path, source_format)


def _safe_file_stem(source_id: str) -> str:
    return re.sub(r"[^0-9A-Za-zА-Яа-я._-]+", "-", source_id).strip("-.") or "source"


def _source_marker(block: ExtractedBlock, *, offset: int | None = None) -> str:
    payload = _source_payload(block)
    if offset:
        # The text that follows a table of contents in the same extracted block.
        payload["offset"] = offset
    return _encode_marker(payload)


def _encode_marker(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"<!-- localmed:source {encoded} -->"


def _source_payload(block: ExtractedBlock) -> dict[str, object]:
    payload: dict[str, object] = {
        "block": block.id,
        "kind": block.kind,
    }
    if block.page is not None:
        payload["page"] = block.page
    if block.bbox is not None:
        payload["bbox"] = block.bbox
    for key in ("lineStart", "lineEnd"):
        if key in block.metadata:
            payload[key] = block.metadata[key]
    for key in ("sourceSectionId", "sourceSectionOrder", "renderBlock", "blocks"):
        if key in block.metadata:
            payload[key] = block.metadata[key]
    confidences = [
        float(cast(float, line["confidence"]))
        for line in cast(list[dict[str, object]], block.metadata.get("lines") or [])
        if isinstance(line.get("confidence"), (int, float))
    ]
    if not confidences and isinstance(block.metadata.get("confidence"), (int, float)):
        confidences = [float(cast(float, block.metadata["confidence"]))]
    if confidences:
        payload["ocrConfidence"] = round(sum(confidences) / len(confidences), 3)
    if block.metadata.get("ocrEdits"):
        payload["ocrEdits"] = len(cast(list[object], block.metadata["ocrEdits"]))
    return payload


def _contents_marker(blocks: list[ExtractedBlock]) -> str:
    """One source marker for a leaflet's table of contents: every block it covers is listed."""
    first = blocks[0]
    payload = _source_payload(first)
    payload["kind"] = "list"
    payload["role"] = "contents"
    if len(blocks) > 1:
        payload["blocks"] = [block.id for block in blocks]
    pages = sorted({block.page for block in blocks if block.page is not None})
    if len(pages) > 1:
        payload["pages"] = pages
    boxes = [block.bbox for block in blocks if block.bbox and block.page == first.page]
    if boxes:
        payload["bbox"] = [
            round(min(box[0] for box in boxes), 3),
            round(min(box[1] for box in boxes), 3),
            round(max(box[2] for box in boxes), 3),
            round(max(box[3] for box in boxes), 3),
        ]
    confidences = [
        float(cast(float, value))
        for block in blocks
        if isinstance(value := _source_payload(block).get("ocrConfidence"), (int, float))
    ]
    if confidences:
        payload["ocrConfidence"] = round(sum(confidences) / len(confidences), 3)
    return _encode_marker(payload)


def _normalize_heading_levels(blocks: list[ExtractedBlock]) -> dict[str, int]:
    raw_levels = [block.heading_level for block in blocks if block.kind == "heading"]
    valid_levels = [level for level in raw_levels if level is not None]
    if not valid_levels:
        return {}
    minimum = min(valid_levels)
    previous = 0
    result: dict[str, int] = {}
    for block in blocks:
        if block.kind != "heading" or block.heading_level is None:
            continue
        level = max(1, block.heading_level - minimum + 1)
        if previous and level > previous + 1:
            level = previous + 1
        result[block.id] = min(6, level)
        previous = result[block.id]
    return result


def _contents_entry_ids(blocks: list[ExtractedBlock]) -> set[str]:
    in_contents = False
    result: set[str] = set()
    for block in blocks:
        if block.kind != "heading":
            continue
        if block.metadata.get("promotedFrom") == "template-label":
            # «Содержание (шаблон):» of a scale passport names a field, not a table of contents.
            continue
        normalized = normalize_surface_text(block.text)
        if "содержание" in normalized or "оглавление" in normalized:
            in_contents = True
            continue
        if in_contents and block.bold:
            in_contents = False
        elif in_contents:
            result.add(block.id)
    return result


def _page_mark_comment(block: ExtractedBlock) -> str:
    payload: dict[str, object] = {
        "block": block.id,
        "kind": block.metadata.get("markKind", "stamp"),
        "page": block.page,
        "text": block.text,
    }
    if block.bbox is not None:
        payload["bbox"] = block.bbox
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"<!-- localmed:page-mark {encoded} -->"


def extraction_front_matter(extracted: ExtractedSource) -> dict[str, object]:
    """The `metadata.extraction` block of a prepared document: how the text was obtained."""
    diagnostics = extracted.diagnostics
    extraction: dict[str, object] = {
        "format": extracted.source_format,
        "pageCount": diagnostics.page_count,
        "qualityScore": diagnostics.quality_score,
        "requiresReview": diagnostics.requires_review,
        "headingCandidates": diagnostics.heading_candidates,
        "tableCandidates": diagnostics.table_candidates,
    }
    if diagnostics.promoted_headings:
        extraction["promotedHeadings"] = diagnostics.promoted_headings
    if diagnostics.ocr_quality is not None:
        extraction["ocrQuality"] = diagnostics.ocr_quality
        extraction["ocrQualityReasons"] = diagnostics.ocr_quality_reasons
        extraction["ocrCleanup"] = diagnostics.ocr_cleanup
    if extracted.source_format == "pdf":
        # Keep how the text was obtained, so downstream databases can show it.
        extraction.update(
            {
                "textExtractionMode": diagnostics.text_extraction_mode,
                "ocrEngine": diagnostics.ocr_engine,
                "ocrPages": diagnostics.ocr_pages,
                "ocrMeanConfidence": diagnostics.ocr_mean_confidence,
                "ocrLowConfidenceRatio": diagnostics.ocr_low_confidence_ratio,
            }
        )
    return extraction


def _review_reasons(block: ExtractedBlock) -> list[str]:
    reasons = [str(block.metadata["review"])] if block.metadata.get("review") else []
    if block.kind == "table_candidate":
        reasons.insert(0, "table-candidate")
    return reasons


class _ContentsLayout:
    """Where the contents lists of a leaflet are written (`leaflet_contents.py`).

    The blocks of a run become one list block of the prepared Markdown, written where its first
    block stands; a block the extraction joined with the text after the list keeps that text as an
    ordinary block of its own, so no character is lost.
    """

    def __init__(self, runs: list[ContentsRun], blocks: list[ExtractedBlock]) -> None:
        by_id = {block.id: block for block in blocks}
        self.runs_by_first = {run.block_ids[0]: run for run in runs}
        self.member_ids = {block_id for run in runs for block_id in run.block_ids}
        self.cuts = {run.split[0]: run.split[1] for run in runs if run.split is not None}
        self.blocks_by_run = {
            run.block_ids[0]: [by_id[block_id] for block_id in run.block_ids] for run in runs
        }

    def group(self, block: ExtractedBlock) -> list[str] | None:
        """The Markdown lines of the list this block opens, ``None`` when it opens none."""
        run = self.runs_by_first.get(block.id)
        if run is None:
            return None
        members = self.blocks_by_run[block.id]
        review: list[str] = []
        for member in members:
            review.extend(reason for reason in _review_reasons(member) if reason not in review)
        lines = [_contents_marker(members)]
        if review:
            lines.append(f"<!-- localmed:review {' '.join(review)} -->")
        if run.lead:
            lines.append(run.lead)
        lines.extend(entry.text for entry in run.entries)
        lines.append("")
        return lines

    def text_before(self, block: ExtractedBlock) -> str:
        """The text the extraction put before the list in the block that opens it."""
        run = self.runs_by_first.get(block.id)
        if run is None or run.head is None:
            return ""
        return block.text[: run.head[1]].strip()


def _plain_part(block: ExtractedBlock, text: str, *, offset: int | None = None) -> list[str]:
    """Markdown lines of part of a block: its source marker, review marker and the text."""
    lines = [_source_marker(block, offset=offset)]
    review = _review_reasons(block)
    if review:
        lines.append(f"<!-- localmed:review {' '.join(review)} -->")
    return [*lines, text, ""]


def render_body(
    extracted: ExtractedSource, *, source_id: str = "source", contents_lists: bool = False
) -> str:
    """The Markdown body: headings, source markers, page marks, review markers and text.

    ``contents_lists`` keeps the table of contents of a patient leaflet as one list block
    instead of the headings and one-line paragraphs the generic classification made of it.
    """
    every_included = [
        block
        for page in extracted.pages
        for block in sorted(page.blocks, key=lambda item: item.order_index)
        if not block.removed
    ]
    included = [block for block in every_included if block.kind != "page_mark"]
    if not included:
        raise NoSearchableTextError(f"Source {source_id} produced no searchable text blocks.")
    contents = _ContentsLayout(find_contents_runs(included), included) if contents_lists else None
    heading_levels = _normalize_heading_levels(
        [block for block in included if contents is None or block.id not in contents.member_ids]
    )
    contents_entry_ids = _contents_entry_ids(included)
    body: list[str] = []
    pending_marks: list[str] = []
    emitted = False
    if included[0].kind != "heading":
        body.extend(["# Общая информация", ""])
        emitted = True
    for block in every_included:
        text = block.text.strip()
        if not text:
            continue
        if block.kind == "page_mark":
            # Marks before the first body block wait for it: a comment must not open a section.
            (pending_marks if not emitted else body).extend([_page_mark_comment(block), ""])
            continue
        if contents is not None and block.id in contents.member_ids:
            # A table of contents is one list block; the text the extraction joined with it in the
            # same block (before the header, after the last entry) stays an ordinary block.
            before = contents.text_before(block)
            if before:
                body.extend(_plain_part(block, before))
            list_lines = contents.group(block)
            if list_lines is not None:
                body.extend(list_lines)
            cut = contents.cuts.get(block.id)
            after = block.text[cut:].strip() if cut is not None else ""
            if after:
                body.extend(_plain_part(block, after, offset=cut))
            if not emitted:
                emitted = True
                body.extend(pending_marks)
            continue
        if block.kind == "heading" and block.id not in contents_entry_ids:
            level = heading_levels.get(block.id, 1)
            body.extend([f"{'#' * level} {text}", ""])
            if not emitted:
                emitted = True
                body.extend(pending_marks)
            continue
        body.append(_source_marker(block))
        review = [str(block.metadata["review"])] if block.metadata.get("review") else []
        if block.kind == "table_candidate":
            review.insert(0, "table-candidate")
        if review:
            body.append(f"<!-- localmed:review {' '.join(review)} -->")
        body.extend([text, ""])
        if not emitted:
            emitted = True
            body.extend(pending_marks)
    return "\n".join(body).rstrip() + "\n"


def render_prepared_markdown(source: RegistrySource, extracted: ExtractedSource) -> str:
    body = render_body(
        extracted,
        source_id=source.id,
        contents_lists=source.source_type == "official_drug_instruction",
    )
    metadata = dict(source.metadata)
    if source.provenance is not None:
        provenance = source.provenance.model_dump(by_alias=True, mode="json")
        provenance["rawChecksum"] = extracted.source_checksum
        metadata["provenance"] = provenance
    metadata["sourcePath"] = source.path
    metadata["extraction"] = extraction_front_matter(extracted)
    front_matter: dict[str, object] = {
        "id": source.id,
        "title": source.title,
        "short_title": source.short_title,
        "version_label": source.version_label,
        "source_type": source.source_type,
        "status": source.status,
        "specialties": source.specialties,
        "age_groups": source.age_groups,
        "effective_from": source.effective_from,
        "effective_to": source.effective_to,
        "source_file": source.path,
        "source_checksum": extracted.source_checksum,
        "synthetic_fixture": False,
        "metadata": metadata,
    }
    front_matter = {key: value for key, value in front_matter.items() if value is not None}
    dumped = yaml.safe_dump(
        front_matter,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).rstrip()
    return f"---\n{dumped}\n---\n\n" + body


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _prepare_into(
    registry: SourceRegistry,
    source_root: Path,
    output_dir: Path,
    *,
    workers: int,
    reuse_from: Path | None,
) -> PrepareReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    internal = output_dir / ".localmed"
    extractions = internal / "extractions"
    diagnostics = internal / "diagnostics"
    prepared_reports: list[PreparedSourceReport] = []
    aggregate_warnings: list[str] = []
    reused_sources = 0

    manifest = registry.pack.model_dump(by_alias=True, mode="json")
    (output_dir / "manifest.yaml").write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    aliases_payload = {
        "aliases": [alias.model_dump(by_alias=True, mode="json") for alias in registry.aliases]
    }
    (output_dir / "aliases.yaml").write_text(
        yaml.safe_dump(aliases_payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    unrecognized_sources = 0
    for source, extracted, reused in _extract_sources(
        registry.sources,
        source_root,
        workers,
        reuse_from,
    ):
        reused_sources += int(reused)
        stem = _safe_file_stem(source.id)
        markdown_path = output_dir / f"{stem}.md"
        extraction_path = extractions / f"{stem}.json"
        diagnostic_path = diagnostics / f"{stem}.json"
        _write_json(extraction_path, extracted.model_dump(by_alias=True, mode="json"))
        _write_json(
            diagnostic_path,
            extracted.diagnostics.model_dump(by_alias=True, mode="json"),
        )
        source_warnings = [
            *extracted.diagnostics.warnings,
            *extracted.diagnostics.review_reasons,
        ]
        # A source-specific extraction failure (corrupted/empty/unreadable
        # input, including one the OCR fallback itself could not process)
        # must mark this one document for review and move on, not raise and
        # drop every other source already prepared in the same batch.
        is_unrecognized = False
        try:
            markdown_path.write_text(render_prepared_markdown(source, extracted), encoding="utf-8")
        except NoSearchableTextError as error:
            is_unrecognized = True
            unrecognized_sources += 1
            source_warnings = [*source_warnings, str(error)]
        aggregate_warnings.extend(f"{source.id}: {warning}" for warning in source_warnings)
        prepared_reports.append(
            PreparedSourceReport(
                source_id=source.id,
                source_file=source.path,
                markdown_file=None if is_unrecognized else markdown_path.name,
                extraction_file=str(extraction_path.relative_to(output_dir)),
                diagnostic_file=str(diagnostic_path.relative_to(output_dir)),
                source_checksum=extracted.source_checksum,
                included_blocks=extracted.diagnostics.included_block_count,
                pages=extracted.diagnostics.page_count,
                requires_review=extracted.diagnostics.requires_review or is_unrecognized,
                extraction_reused=reused,
                unrecognized=is_unrecognized,
                warnings=source_warnings,
            )
        )

    report = PrepareReport(
        pack_id=registry.pack.id,
        pack_version=registry.pack.version,
        sources=len(prepared_reports),
        review_required=sum(item.requires_review for item in prepared_reports),
        unrecognized_sources=unrecognized_sources,
        reused_sources=reused_sources,
        extracted_sources=len(prepared_reports) - reused_sources,
        warnings=aggregate_warnings,
        prepared=prepared_reports,
    )
    _write_json(output_dir / "prepare-report.json", report.model_dump(by_alias=True, mode="json"))
    return report


def _extract_sources(
    sources: list[RegistrySource],
    source_root: Path,
    workers: int,
    reuse_from: Path | None,
) -> Iterator[tuple[RegistrySource, ExtractedSource, bool]]:
    if workers == 1:
        for source in sources:
            extracted, reused = _extract_or_reuse(source, source_root, reuse_from)
            yield source, extracted, reused
        return

    source_iterator = iter(sources)
    pending: deque[tuple[RegistrySource, Future[tuple[ExtractedSource, bool]]]] = deque()
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="medbase-prepare") as executor:
        for _ in range(workers):
            source = next(source_iterator, None)
            if source is None:
                break
            pending.append(
                (source, executor.submit(_extract_or_reuse, source, source_root, reuse_from))
            )

        while pending:
            source, future = pending.popleft()
            extracted, reused = future.result()
            yield source, extracted, reused
            next_source = next(source_iterator, None)
            if next_source is not None:
                pending.append(
                    (
                        next_source,
                        executor.submit(_extract_or_reuse, next_source, source_root, reuse_from),
                    )
                )


def _extract_or_reuse(
    source: RegistrySource,
    source_root: Path,
    reuse_from: Path | None,
) -> tuple[ExtractedSource, bool]:
    source_path = _resolve_source_path(source_root, source.path)
    if reuse_from is not None:
        extraction_path = (
            reuse_from / ".localmed" / "extractions" / f"{_safe_file_stem(source.id)}.json"
        )
        if extraction_path.is_file():
            try:
                payload: object = json.loads(extraction_path.read_text(encoding="utf-8"))
                extracted = ExtractedSource.model_validate(payload)
            except (OSError, ValueError, json.JSONDecodeError):
                extracted = None
            expected_checksum = source.metadata.get("pdfSha256")
            if not isinstance(expected_checksum, str):
                expected_checksum = sha256_file(source_path)
            if (
                extracted is not None
                and extracted.source_file == source_path.name
                and extracted.source_format == _source_format(source, source_path)
                and extracted.source_checksum == expected_checksum
                and (
                    extracted.source_format != "clinical_json"
                    or extracted.extractor_revision >= CLINICAL_JSON_EXTRACTOR_REVISION
                )
            ):
                return extracted, True
    return extract_source(source, source_path), False


def prepare_registry(
    registry_path: Path,
    source_root: Path,
    output_dir: Path,
    *,
    force: bool = False,
    workers: int = 1,
    reuse_from: Path | None = None,
) -> PrepareReport:
    if not 1 <= workers <= 8:
        raise ValueError("Prepare workers must be between 1 and 8.")
    registry = load_source_registry(registry_path)
    if reuse_from is not None and not reuse_from.is_dir():
        raise ValueError(f"Reuse workspace is not a directory: {reuse_from}")
    source_root_resolved = source_root.resolve()
    target = output_dir.resolve()
    if target == source_root_resolved or source_root_resolved.is_relative_to(target):
        raise ValueError("Output directory cannot be the source root or one of its parents.")
    if target.exists() and not force:
        raise FileExistsError(
            f"Output directory already exists: {target}. Pass --force to replace it."
        )

    target.parent.mkdir(parents=True, exist_ok=True)
    nonce = uuid.uuid4().hex
    temporary = target.with_name(f".{target.name}.tmp-{nonce}")
    backup = target.with_name(f".{target.name}.backup-{nonce}")
    try:
        report = _prepare_into(
            registry,
            source_root_resolved,
            temporary,
            workers=workers,
            reuse_from=reuse_from.resolve() if reuse_from is not None else None,
        )
        if target.exists():
            target.replace(backup)
        temporary.replace(target)
        shutil.rmtree(backup, ignore_errors=True)
        return report
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        if backup.exists() and not target.exists():
            backup.replace(target)
        raise
