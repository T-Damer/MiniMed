from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import cast

import pymupdf
import yaml

from localmed_ingest.builder import build_content_pack, load_content_pack
from localmed_ingest.models import RegistrySource
from localmed_ingest.pdf_import import extract_pdf
from localmed_ingest.source_registry import prepare_registry, render_prepared_markdown


def installed_font(*candidates: str) -> Path:
    for candidate in candidates:
        path = Path(candidate)
        if path.is_file():
            return path
    raise RuntimeError(f"Test font is unavailable: {', '.join(candidates)}")


FONT_REGULAR = installed_font(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
)
FONT_BOLD = installed_font(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
)


def create_text_pdf(path: Path) -> None:
    document = pymupdf.open()
    body = (
        "Рекомендовано оценить жалобы, анамнез, объективные признаки и результаты обследований. "
        "Исходная формулировка сохраняется без пересказа и используется для локального поиска. "
        "Текстовый слой должен оставаться доступным для детерминированного импорта."
    )
    for page_number in range(1, 4):
        page = document.new_page(width=595, height=842)
        page.insert_font(fontname="regular", fontfile=str(FONT_REGULAR))
        page.insert_font(fontname="bold", fontfile=str(FONT_BOLD))
        page.insert_text(
            (50, 34), "Клинические рекомендации — тестовый документ", fontsize=8, fontname="regular"
        )
        page.insert_text(
            (50, 92), f"{page_number}. Раздел диагностики", fontsize=16, fontname="bold"
        )
        page.insert_textbox(
            (50, 120, 545, 600), "\n\n".join([body] * 4), fontsize=11, fontname="regular"
        )
        page.insert_text((290, 815), str(page_number), fontsize=8, fontname="regular")
    document.save(path)
    document.close()


def registry_payload(source_name: str) -> dict[str, object]:
    return {
        "pack": {
            "id": "localmed.private-pilot",
            "version": "0.2.2",
            "schemaVersion": 2,
            "title": "Private pilot",
            "builtAt": "2026-07-17T00:00:00Z",
        },
        "sources": [
            {
                "id": "kr.private.example",
                "path": source_name,
                "title": "Тестовые клинические рекомендации",
                "shortTitle": "Тестовые КР",
                "versionLabel": "2026",
                "sourceType": "clinical_recommendation",
                "status": "draft",
                "specialties": ["pediatrics"],
                "ageGroups": ["children"],
            }
        ],
        "aliases": [],
    }


def test_pdf_extraction_removes_repeated_marginalia_and_detects_headings(tmp_path: Path) -> None:
    source = tmp_path / "recommendation.pdf"
    create_text_pdf(source)

    extracted = extract_pdf(source)

    assert extracted.diagnostics.page_count == 3
    assert extracted.diagnostics.removed_repeated_blocks >= 6
    assert extracted.diagnostics.heading_candidates >= 3
    assert extracted.diagnostics.character_count > 500
    assert extracted.source_checksum == f"sha256:{hashlib.sha256(source.read_bytes()).hexdigest()}"
    included_text = " ".join(
        block.text for page in extracted.pages for block in page.blocks if not block.removed
    )
    assert "Клинические рекомендации — тестовый документ" not in included_text
    assert any(
        block.kind == "heading" and block.heading_level == 1
        for page in extracted.pages
        for block in page.blocks
    )


def test_rendered_markdown_keeps_source_markers(tmp_path: Path) -> None:
    source_path = tmp_path / "recommendation.pdf"
    create_text_pdf(source_path)
    extracted = extract_pdf(source_path)
    source_items = cast(list[dict[str, object]], registry_payload(source_path.name)["sources"])
    source = RegistrySource.model_validate(source_items[0])

    markdown = render_prepared_markdown(source, extracted)

    assert "<!-- localmed:source" in markdown
    assert "source_checksum:" in markdown
    assert "synthetic_fixture: false" in markdown
    assert "# 1. Раздел диагностики" in markdown.replace("\u00a0", " ")


def test_prepare_registry_builds_searchable_pack_with_page_provenance(tmp_path: Path) -> None:
    source_root = tmp_path / "raw"
    source_root.mkdir()
    source_path = source_root / "recommendation.pdf"
    create_text_pdf(source_path)
    registry_path = tmp_path / "sources.yaml"
    registry_path.write_text(
        yaml.safe_dump(registry_payload(source_path.name), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    prepared_dir = tmp_path / "prepared"

    prepare_report = prepare_registry(registry_path, source_root, prepared_dir)
    first_hashes = {
        str(path.relative_to(prepared_dir)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(prepared_dir.rglob("*"))
        if path.is_file()
    }
    prepare_registry(registry_path, source_root, prepared_dir, force=True)
    second_hashes = {
        str(path.relative_to(prepared_dir)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(prepared_dir.rglob("*"))
        if path.is_file()
    }
    assert first_hashes == second_hashes
    pack = load_content_pack(prepared_dir)
    database = tmp_path / "pilot.db"
    _, build_report = build_content_pack(prepared_dir, database)

    assert prepare_report.sources == 1
    assert (prepared_dir / ".localmed/extractions/kr.private.example.json").is_file()
    assert (prepared_dir / ".localmed/diagnostics/kr.private.example.json").is_file()
    assert build_report.sqlite_integrity == "ok"
    document = pack.documents[0]
    assert (
        document.version.source_checksum
        == f"sha256:{hashlib.sha256(source_path.read_bytes()).hexdigest()}"
    )
    assert document.metadata["syntheticFixture"] is False
    chunks = [chunk for section in document.sections for chunk in section.chunks]
    assert any(chunk.page_start == 1 for chunk in chunks)
    assert any(chunk.metadata.get("sourceSpans") for chunk in chunks)
    assert all("localmed:source" not in chunk.original_text for chunk in chunks)
    assert all("localmed:source" not in chunk.normalized_text for chunk in chunks)

    saved_report = json.loads((prepared_dir / "prepare-report.json").read_text(encoding="utf-8"))
    assert saved_report["packId"] == "localmed.private-pilot"


def test_prepare_rejects_source_path_outside_root(tmp_path: Path) -> None:
    source_root = tmp_path / "raw"
    source_root.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("1. Заголовок\n\nТекст", encoding="utf-8")
    payload = registry_payload("../outside.txt")
    registry_path = tmp_path / "sources.yaml"
    registry_path.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    try:
        prepare_registry(registry_path, source_root, tmp_path / "prepared")
    except ValueError as error:
        assert "escapes source root" in str(error)
    else:
        raise AssertionError("Path traversal must be rejected")


def test_text_source_keeps_line_provenance(tmp_path: Path) -> None:
    source_root = tmp_path / "raw"
    source_root.mkdir()
    source_path = source_root / "recommendation.txt"
    source_path.write_text(
        "1. Общая информация\n\n" + ("Исходный текст без пересказа. " * 30) + "\n",
        encoding="utf-8",
    )
    registry_path = tmp_path / "sources.yaml"
    registry_path.write_text(
        yaml.safe_dump(registry_payload(source_path.name), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    prepare_registry(registry_path, source_root, tmp_path / "prepared")
    pack = load_content_pack(tmp_path / "prepared")
    chunk = pack.documents[0].sections[0].chunks[0]

    spans = cast(list[dict[str, object]], chunk.metadata["sourceSpans"])
    assert spans[0]["lineStart"] == 3
    assert spans[0]["lineEnd"] == 3
    assert chunk.page_start is None


def test_markdown_source_excludes_existing_front_matter(tmp_path: Path) -> None:
    source_root = tmp_path / "raw"
    source_root.mkdir()
    source_path = source_root / "recommendation.md"
    source_path.write_text(
        "---\nlegacy: value\n---\n\n# Диагностика\n\n" + ("Исходный абзац. " * 40) + "\n",
        encoding="utf-8",
    )
    payload = registry_payload(source_path.name)
    sources = cast(list[dict[str, object]], payload["sources"])
    sources[0]["format"] = "markdown"
    registry_path = tmp_path / "sources.yaml"
    registry_path.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    report = prepare_registry(registry_path, source_root, tmp_path / "prepared")
    pack = load_content_pack(tmp_path / "prepared")
    chunk = pack.documents[0].sections[0].chunks[0]
    spans = cast(list[dict[str, object]], chunk.metadata["sourceSpans"])

    assert "legacy" not in chunk.original_text
    assert spans[0]["lineStart"] == 7
    assert any("front matter" in warning for warning in report.warnings)


def test_prepare_rejects_output_that_would_replace_source_root(tmp_path: Path) -> None:
    source_root = tmp_path / "raw"
    source_root.mkdir()
    source_path = source_root / "recommendation.txt"
    source_path.write_text("1. Заголовок\n\n" + ("Текст. " * 100), encoding="utf-8")
    registry_path = source_root / "sources.yaml"
    registry_path.write_text(
        yaml.safe_dump(registry_payload(source_path.name), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    try:
        prepare_registry(registry_path, source_root, source_root, force=True)
    except ValueError as error:
        assert "cannot be the source root" in str(error)
    else:
        raise AssertionError("Preparing over the source root must be rejected")

    assert source_path.is_file()
