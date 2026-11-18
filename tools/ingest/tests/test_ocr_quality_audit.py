from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from localmed_ingest.models import ExtractedBlock, ExtractedPage, ExtractedSource
from localmed_ingest.ocr_quality_audit import audit_extraction
from localmed_ingest.ocr_requality import CleanupCounters, refine_page
from localmed_ingest.ocr_second_opinion import AltInfo

SOURCE_CHECKSUM = "sha256:" + "a" * 64


def extraction() -> ExtractedSource:
    first = ExtractedBlock(
        id="p1-b1",
        page=1,
        order_index=0,
        kind="paragraph",
        text="Private example: dose 10 mg",
        bbox=[10, 20, 200, 32],
    )
    page = ExtractedPage(page=1, width=300, height=400, blocks=[first], character_count=0)
    page = refine_page(
        page,
        {0: 0.3},
        None,
        (),
        CleanupCounters(),
        {
            0: AltInfo(
                other_text="Private example: dose 10 mg and 20 mg",
                chosen="tesseract",
                digits_differ=False,
            )
        },
    )
    page.blocks[0].metadata["review"] = "ocr-uncertain-number"
    page.blocks.extend(
        [
            ExtractedBlock(id="p1-b2", page=1, order_index=1, kind="table_candidate", text="A | B"),
            ExtractedBlock(
                id="p1-b3",
                page=1,
                order_index=2,
                kind="table_candidate",
                text="C",
                metadata={"flattenedTable": True},
            ),
            ExtractedBlock(id="p1-b4", page=1, order_index=3, kind="paragraph", text="D | E"),
            ExtractedBlock(
                id="p1-b5", page=1, order_index=4, kind="table_candidate", text="F", removed=True
            ),
            ExtractedBlock(id="p1-b6", page=1, order_index=5, kind="page_mark", text="G | H"),
        ]
    )
    return ExtractedSource.model_validate(
        {
            "sourceFile": "private.pdf",
            "sourceChecksum": SOURCE_CHECKSUM,
            "sourceFormat": "pdf",
            "pages": [
                page.model_dump(by_alias=True),
                {
                    "page": 2,
                    "width": 300,
                    "height": 400,
                    "blocks": [],
                    "characterCount": 0,
                    "lowText": True,
                },
            ],
            "diagnostics": {
                "sourceChecksum": SOURCE_CHECKSUM,
                "sourceFormat": "pdf",
                "pageCount": 2,
                "blockCount": 6,
                "includedBlockCount": 4,
                "characterCount": 20,
                "removedRepeatedBlocks": 0,
                "headingCandidates": 0,
                "tableCandidates": 2,
                "qualityScore": 0.5,
                "requiresReview": True,
            },
        }
    )


def encoded(source: ExtractedSource) -> bytes:
    return source.model_dump_json(by_alias=True).encode("utf-8")


def test_inventory_preserves_provenance_and_marks_candidates_without_source_text() -> None:
    raw = encoded(extraction())
    report = audit_extraction("drug.rf.synthetic", raw)
    assert report["sourceId"] == "drug.rf.synthetic"
    assert report["sourceChecksum"] == SOURCE_CHECKSUM
    assert report["extractionChecksum"] == f"sha256:{hashlib.sha256(raw).hexdigest()}"
    assert report["view"] == "saved-extraction"
    assert [
        (issue["kind"], issue["page"], issue["block"], issue["line"]) for issue in report["issues"]
    ] == [
        ("low-ocr-confidence", 1, "p1-b1", "p1-b1"),
        ("uncertain-ocr-number", 1, "p1-b1", None),
        ("ocr-number-disagreement", 1, "p1-b1", "p1-b1"),
        ("table-candidate", 1, "p1-b2", None),
        ("flattened-table", 1, "p1-b3", None),
        ("possible-unmarked-table", 1, "p1-b4", None),
        ("low-text-page", 2, None, None),
    ]
    assert report["issues"][0]["bbox"] == [10, 20, 200, 32]
    assert "Private example" not in json.dumps(report)
    assert audit_extraction("drug.rf.synthetic", raw) == report


def test_decimal_format_agrees_but_a_repeated_number_can_be_missing() -> None:
    source = extraction()
    block = source.pages[0].blocks[0]
    lines = cast(list[dict[str, object]], block.metadata["lines"])
    alternatives = cast(list[dict[str, object]], block.metadata["ocrAlternatives"])
    lines[0]["text"] = "0,5 0,5"
    alternatives[0]["other"] = "0.5 0.5"
    assert "ocr-number-disagreement" not in [
        i["kind"] for i in audit_extraction("doc", encoded(source))["issues"]
    ]
    alternatives[0]["other"] = "0.5"
    assert "ocr-number-disagreement" in [
        i["kind"] for i in audit_extraction("doc", encoded(source))["issues"]
    ]


def test_grls_repair_preview_inventories_native_table_cells_without_changing_input() -> None:
    source = extraction()
    source.pages[0].blocks = [
        ExtractedBlock(
            id=f"p1-b{index + 1}",
            page=1,
            order_index=index,
            kind="paragraph",
            text=f"Cell {index}",
            bbox=[float(x), float(y), float(x + 40), float(y + 10)],
        )
        for index, (y, x) in enumerate((y, x) for y in (20, 60, 100) for x in (20, 110, 200))
    ]
    raw = encoded(source)
    saved = audit_extraction("doc", raw)
    preview = audit_extraction("doc", raw, preview_grls_repair=True)
    assert saved["view"] == "saved-extraction"
    assert preview["view"] == "grls-repair-preview"
    assert preview["extractionChecksum"] == saved["extractionChecksum"]
    assert not any(issue["kind"] == "flattened-table" for issue in saved["issues"])
    assert [
        issue["block"] for issue in preview["issues"] if issue["kind"] == "flattened-table"
    ] == [f"p1-b{index}" for index in range(1, 10)]
    assert encoded(source) == raw


def test_pdf_with_no_pages_is_a_review_candidate() -> None:
    source = extraction()
    source.pages = []
    source.diagnostics.page_count = 0
    issues = audit_extraction("doc", encoded(source))["issues"]
    assert issues == [{"kind": "no-pages", "page": None, "block": None, "line": None, "bbox": None}]


@pytest.mark.parametrize(
    "invalid",
    [
        "checksum",
        "format",
        "non-pdf",
        "missing-page",
        "diagnostic-page",
        "block-page",
        "duplicate-block",
        "bbox",
        "lines",
        "alternative",
    ],
)
def test_invalid_provenance_is_rejected(invalid: str) -> None:
    source = extraction()
    if invalid == "checksum":
        source.diagnostics.source_checksum = "sha256:" + "b" * 64
    elif invalid == "format":
        source.diagnostics.source_format = "text"
    elif invalid == "non-pdf":
        source.source_format = "text"
        source.diagnostics.source_format = "text"
    elif invalid == "missing-page":
        source.pages.pop()
    elif invalid == "diagnostic-page":
        source.diagnostics.ocr_pages = [3]
    elif invalid == "block-page":
        source.pages[0].blocks[0].page = 2
    elif invalid == "duplicate-block":
        source.pages[0].blocks[1].id = source.pages[0].blocks[0].id
    elif invalid == "bbox":
        source.pages[0].blocks[0].bbox = [1, 2, 3]
    elif invalid == "lines":
        source.pages[0].blocks[0].metadata["lines"] = ["not a line record"]
    elif invalid == "alternative":
        source.pages[0].blocks[0].metadata["ocrAlternatives"] = [
            {"id": "missing-line", "other": "some text"}
        ]
    with pytest.raises(ValueError):
        audit_extraction("doc", encoded(source))


def test_cli_emits_only_a_complete_report_and_does_not_print_bad_input(tmp_path: Path) -> None:
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    first.write_bytes(encoded(extraction()))
    second.write_bytes(encoded(extraction()))
    command = [sys.executable, "-m", "localmed_ingest.ocr_quality_audit"]
    clean_env = {"PATH": os.defpath, "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run(
        [*command, str(second), str(first)],
        capture_output=True,
        text=True,
        env=clean_env,
        check=True,
    )
    report = json.loads(result.stdout)
    assert report["version"] == 1
    assert [source["sourceId"] for source in report["sources"]] == ["a", "b"]
    assert "Private example" not in result.stdout
    preview = subprocess.run(
        [*command, "--preview-grls-repair", str(first)],
        capture_output=True,
        text=True,
        env=clean_env,
        check=True,
    )
    assert json.loads(preview.stdout)["sources"][0]["view"] == "grls-repair-preview"
    second.write_text('{"private": "DO NOT PRINT"}', encoding="utf-8")
    invalid = subprocess.run(
        [*command, str(first), str(second)],
        capture_output=True,
        text=True,
        env=clean_env,
        check=False,
    )
    assert invalid.returncode != 0
    assert not invalid.stdout
    assert "DO NOT PRINT" not in invalid.stderr

    same_name_dir = tmp_path / "second-workspace"
    same_name_dir.mkdir()
    same_name = same_name_dir / first.name
    same_name.write_bytes(first.read_bytes())
    duplicate = subprocess.run(
        [*command, str(first), str(same_name)],
        capture_output=True,
        text=True,
        env=clean_env,
        check=False,
    )
    assert duplicate.returncode != 0
    assert not duplicate.stdout
