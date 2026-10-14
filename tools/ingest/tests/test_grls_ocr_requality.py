"""Manifest/overlay integrity of the OCR1 re-preparation driver."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pymupdf
import yaml

from localmed_ingest.grls_ocr_requality import (
    plain_text,
    reprepare_document,
    second_opinion_pages,
    select_rows,
    split_markdown,
    text_digest,
    write_document,
)
from localmed_ingest.ocr_text_cleanup import Lexicon

LEXICON = Lexicon(
    cyrillic={
        "показания": 900,
        "применению": 900,
        "препарат": 900,
        "принимают": 900,
        "внутрь": 900,
        "после": 900,
        "инъекций": 900,
        "инструкция": 900,
        "медицинскому": 900,
    }
)
WIDTH, HEIGHT = 595.0, 842.0
SOURCE_ID = "drug.rf.0123456789abcdef0123.instruction"
PDF_SHA = "sha256:" + "ab" * 32

OLD_MARKDOWN = f"""---
id: {SOURCE_ID}
title: 'Тест: инструкция по медицинскому применению'
version_label: grls-24.07.2026
source_type: official_drug_instruction
source_file: pdf/x.pdf
source_checksum: {PDF_SHA}
metadata:
  registrationNumber: ЛП-000001
  tradeName: Тест
  inn: Тестовое
  pdfSha256: {PDF_SHA}
  extraction:
    format: pdf
    pageCount: 1
---

# Общая информация

<!-- localmed:source {{"block":"p1-b1","kind":"paragraph","page":1}} -->
СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ

<!-- localmed:source {{"block":"p1-b2","kind":"paragraph","page":1}} -->
Препарат принимают
"""


def observation(text: str, x: float, y_top: float, width: float) -> dict[str, Any]:
    return {
        "text": text,
        "confidence": 0.95,
        "bbox": [x / WIDTH, 1 - (y_top + 12) / HEIGHT, width / WIDTH, 12 / HEIGHT],
    }


def make_inputs(tmp_path: Path) -> tuple[Path, Path, dict[str, Any]]:
    pdf = tmp_path / "x.pdf"
    document: Any = pymupdf.open()
    document.new_page(width=WIDTH, height=HEIGHT)
    document.save(pdf)
    document.close()
    old = tmp_path / f"{SOURCE_ID}.md"
    old.write_text(OLD_MARKDOWN, encoding="utf-8")
    payload = {
        "pages": [
            {
                "page": 1,
                "width": WIDTH,
                "height": HEIGHT,
                "lines": [
                    observation("СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ", 300, 30, 220),
                    observation("ИНСТРУКЦИЯ ПО МЕДИЦИНСКОМУ ПРИМЕНЕНИЮ", 100, 70, 300),
                    observation("ПОКАЗАНИЯ К ПРИМЕНЕНИЮ", 80, 110, 200),
                    observation("Препарат принимают внутрь после еды", 80, 140, 280),
                    observation("и после иньекций.", 80, 153, 120),
                ],
            }
        ],
    }
    return pdf, old, payload


def row() -> dict[str, Any]:
    return {
        "sourceId": SOURCE_ID,
        "pdfSha256": PDF_SHA,
        "documentKind": "national-instruction",
        "unknownWordRatio": 0.2,
        "ocr": True,
        "extraction": "prepared",
        "target": "pdf/x.pdf",
    }


def test_reprepared_document_keeps_identity_and_records_provenance(tmp_path: Path) -> None:
    pdf, old, payload = make_inputs(tmp_path)
    result = reprepare_document(
        row=row(),
        pdf_path=pdf,
        old_markdown=old,
        payload=payload,
        lexicon=LEXICON,
        workspace_label="../../data/intermediate/grls-ocr-cleaned",
    )
    front, body = split_markdown(result.markdown)
    # identity and the raw-file checksum of the prepared document are carried over unchanged
    assert front["id"] == SOURCE_ID
    assert front["source_checksum"] == PDF_SHA
    assert front["metadata"]["pdfSha256"] == PDF_SHA
    assert front["metadata"]["tradeName"] == "Тест"
    extraction = front["metadata"]["extraction"]
    assert extraction["textExtractionMode"] == "ocr"
    assert extraction["ocrEngine"] == "macos-vision"
    assert extraction["ocrPages"] == [1]
    assert extraction["ocrMeanConfidence"] == 0.95
    assert extraction["ocrQuality"] in {"good", "fair", "low"}
    assert extraction["ocrCleanup"]["pageMarks"] == 1
    # the body: no stamp text, the lines of a paragraph are one paragraph, the word rule applied
    text = plain_text(body)
    assert "СООТВЕТСТВУЕТ" not in text
    assert "Препарат принимают внутрь после еды и после инъекций." in text
    assert "<!-- localmed:page-mark" in body
    assert overlay_checks(result.overlay)


def overlay_checks(overlay: dict[str, Any]) -> bool:
    assert overlay["pdfSha256"] == PDF_SHA and overlay["sourceId"] == SOURCE_ID
    assert overlay["workspace"] == "../../data/intermediate/grls-ocr-cleaned"
    assert overlay["documentKind"] == "national-instruction"
    assert overlay["ocr"] is True and overlay["ocrTool"] == "macos-vision"
    assert overlay["ocrMeanConfidence"] == 0.95
    assert overlay["pageCount"] == 1 and overlay["ocrPages"] == [1]
    assert overlay["wordEdits"] == 1  # иньекций -> инъекций
    assert overlay["pageMarks"] == 1
    assert overlay["before"]["unknownWordRatio"] == 0.2
    assert overlay["before"]["documentKind"] == "national-instruction"
    return True


def test_overlay_text_digest_is_the_manifest_digest_of_the_written_body(tmp_path: Path) -> None:
    pdf, old, payload = make_inputs(tmp_path)
    result = reprepare_document(
        row=row(),
        pdf_path=pdf,
        old_markdown=old,
        payload=payload,
        lexicon=LEXICON,
        workspace_label="w",
    )
    written = tmp_path / "workspace"
    write_document(written, SOURCE_ID, result)
    markdown = (written / f"{SOURCE_ID}.md").read_text(encoding="utf-8")
    _, body = split_markdown(markdown)
    assert result.overlay["textSha256"] == text_digest(body)
    # raw OCR lines stay in the extraction JSON, the diagnostics next to it
    extraction = json.loads(
        (written / ".localmed" / "extractions" / f"{SOURCE_ID}.json").read_text(encoding="utf-8")
    )
    assert extraction["sourceChecksum"].startswith("sha256:")
    paragraph = next(
        block
        for page in extraction["pages"]
        for block in page["blocks"]
        if block["metadata"].get("ocrRaw")
    )
    assert "иньекций" in paragraph["metadata"]["ocrRaw"]
    assert len(paragraph["metadata"]["lines"]) == 2
    diagnostics = json.loads(
        (written / ".localmed" / "diagnostics" / f"{SOURCE_ID}.json").read_text(encoding="utf-8")
    )
    assert diagnostics["ocrQuality"] == extraction["diagnostics"]["ocrQuality"]


def test_front_matter_is_valid_yaml_for_cyrillic_text(tmp_path: Path) -> None:
    pdf, old, payload = make_inputs(tmp_path)
    result = reprepare_document(
        row=row(),
        pdf_path=pdf,
        old_markdown=old,
        payload=payload,
        lexicon=LEXICON,
        workspace_label="w",
    )
    head = result.markdown.split("\n---\n", 1)[0].removeprefix("---\n")
    assert yaml.safe_load(head)["title"] == "Тест: инструкция по медицинскому применению"


def test_select_rows_takes_one_prepared_ocr_row_per_document_and_the_extras() -> None:
    rows: list[dict[str, Any]] = [
        {"sourceId": "a", "extraction": "prepared", "ocr": True, "pdfSha256": "sha256:1"},
        {"sourceId": "a", "extraction": "prepared", "ocr": True, "pdfSha256": "sha256:1"},
        {"sourceId": "b", "extraction": "prepared", "ocr": False, "pdfSha256": "sha256:2"},
        {"sourceId": "c", "extraction": "prepared", "ocr": False, "pdfSha256": "sha256:3"},
        {"sourceId": None, "extraction": "not-prepared", "ocr": None, "pdfSha256": "sha256:4"},
        {"sourceId": "d", "extraction": "not-prepared", "ocr": True, "pdfSha256": "sha256:5"},
    ]
    selected = select_rows(rows, frozenset({"sha256:3"}))
    assert [r["sourceId"] for r in selected] == ["a", "c"]


def test_second_opinion_pages_are_read_by_pdf_checksum(tmp_path: Path) -> None:
    folder = tmp_path / ("ab" * 32)
    folder.mkdir()
    (folder / "2.json").write_text(
        json.dumps(
            {
                "lines": [
                    {
                        "text": "в банке",
                        "confidence": 80,
                        "bbox": {"x0": 0, "y0": 0, "x1": 300, "y1": 60},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    pages = second_opinion_pages(tmp_path, PDF_SHA)
    assert list(pages) == [2] and pages[2][0].text == "в банке"
    assert second_opinion_pages(tmp_path, "sha256:" + "cd" * 32) == {}
    assert second_opinion_pages(None, PDF_SHA) == {}
