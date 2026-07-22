from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Literal

import yaml

from .html_import import extract_html
from .html_import import extract_html
from .models import (
    ExtractedBlock,
    ExtractedSource,
    PreparedSourceReport,
    PrepareReport,
    RegistrySource,
    SourceRegistry,
)
from .pdf_import import extract_pdf
from .text_import import extract_text


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


def _source_format(source: RegistrySource, path: Path) -> Literal["pdf", "text", "markdown", "html"]:
    if source.format != "auto":
        return source.format
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix in {".html", ".htm"}:
        return "html"
    if suffix in {".html", ".htm"}:
        return "html"
    if suffix in {".txt", ".text"}:
        return "text"
    raise ValueError(f"Cannot infer source format from extension: {path.name}")


def extract_source(source: RegistrySource, path: Path) -> ExtractedSource:
    source_format = _source_format(source, path)
    if source_format == "pdf":
        return extract_pdf(path, source.extraction)
    if source_format == "html":
        return extract_html(path)
    return extract_text(path, source_format)


def _safe_file_stem(source_id: str) -> str:
    return re.sub(r"[^0-9A-Za-zА-Яа-я._-]+", "-", source_id).strip("-.") or "source"


def _source_marker(block: ExtractedBlock) -> str:
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
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"<!-- localmed:source {encoded} -->"


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


def render_prepared_markdown(source: RegistrySource, extracted: ExtractedSource) -> str:
    included = [
        block
        for page in extracted.pages
        for block in sorted(page.blocks, key=lambda item: item.order_index)
        if not block.removed
    ]
    if not included:
        raise ValueError(f"Source {source.id} produced no searchable text blocks.")

    metadata = dict(source.metadata)
    metadata["sourcePath"] = source.path
    metadata["extraction"] = {
        "format": extracted.source_format,
        "pageCount": extracted.diagnostics.page_count,
        "qualityScore": extracted.diagnostics.quality_score,
        "requiresReview": extracted.diagnostics.requires_review,
        "headingCandidates": extracted.diagnostics.heading_candidates,
        "tableCandidates": extracted.diagnostics.table_candidates,
    }
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

    heading_levels = _normalize_heading_levels(included)
    body: list[str] = []
    if included[0].kind != "heading":
        body.extend(["# Общая информация", ""])
    for block in included:
        text = block.text.strip()
        if not text:
            continue
        if block.kind == "heading":
            level = heading_levels.get(block.id, 1)
            body.extend([f"{'#' * level} {text}", ""])
            continue
        body.append(_source_marker(block))
        if block.kind == "table_candidate":
            body.append("<!-- localmed:review table-candidate -->")
        body.extend([text, ""])
    return f"---\n{dumped}\n---\n\n" + "\n".join(body).rstrip() + "\n"


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
) -> PrepareReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    internal = output_dir / ".localmed"
    extractions = internal / "extractions"
    diagnostics = internal / "diagnostics"
    prepared_reports: list[PreparedSourceReport] = []
    aggregate_warnings: list[str] = []

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

    for source in registry.sources:
        source_path = _resolve_source_path(source_root, source.path)
        extracted = extract_source(source, source_path)
        stem = _safe_file_stem(source.id)
        markdown_path = output_dir / f"{stem}.md"
        extraction_path = extractions / f"{stem}.json"
        diagnostic_path = diagnostics / f"{stem}.json"
        markdown_path.write_text(render_prepared_markdown(source, extracted), encoding="utf-8")
        _write_json(extraction_path, extracted.model_dump(by_alias=True, mode="json"))
        _write_json(
            diagnostic_path,
            extracted.diagnostics.model_dump(by_alias=True, mode="json"),
        )
        source_warnings = [
            *extracted.diagnostics.warnings,
            *extracted.diagnostics.review_reasons,
        ]
        aggregate_warnings.extend(f"{source.id}: {warning}" for warning in source_warnings)
        prepared_reports.append(
            PreparedSourceReport(
                source_id=source.id,
                source_file=source.path,
                markdown_file=markdown_path.name,
                extraction_file=str(extraction_path.relative_to(output_dir)),
                diagnostic_file=str(diagnostic_path.relative_to(output_dir)),
                source_checksum=extracted.source_checksum,
                included_blocks=extracted.diagnostics.included_block_count,
                pages=extracted.diagnostics.page_count,
                requires_review=extracted.diagnostics.requires_review,
                warnings=source_warnings,
            )
        )

    report = PrepareReport(
        pack_id=registry.pack.id,
        pack_version=registry.pack.version,
        sources=len(prepared_reports),
        review_required=sum(item.requires_review for item in prepared_reports),
        warnings=aggregate_warnings,
        prepared=prepared_reports,
    )
    _write_json(output_dir / "prepare-report.json", report.model_dump(by_alias=True, mode="json"))
    return report


def prepare_registry(
    registry_path: Path,
    source_root: Path,
    output_dir: Path,
    *,
    force: bool = False,
) -> PrepareReport:
    registry = load_source_registry(registry_path)
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
        report = _prepare_into(registry, source_root_resolved, temporary)
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
