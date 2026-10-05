"""Pure parts of the manufacturer-site instruction module builder: match acceptance, ids,
registry entries and front-matter staging."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from localmed_ingest.manufacturer_instruction_modules import (
    MODULE_ID,
    PlannedDocument,
    document_id,
    instruction_label,
    plan_documents,
    registration_levels,
    registry_source,
    split_front_matter,
    write_registries,
)
from localmed_ingest.manufacturer_instruction_modules import (
    augmented_markdown as stage_markdown,
)

SHA_A = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64
SHA_C = "sha256:" + "c" * 64


def match(number: str, level: str, name: str = "Препарат") -> dict[str, Any]:
    return {
        "registrationNumber": number,
        "tradeName": name,
        "matchLevel": level,
        "evidence": {"holderInText": True},
    }


def row(
    sha: str,
    matches: list[dict[str, Any]],
    *,
    site: str = "vertex",
    fetched: str = "2026-10-02T17:00:00Z",
    source_url: str = "https://example.ru/a.pdf",
    page_url: str = "https://example.ru/p/",
    suffix: str = "pdf",
    revision: list[str] | None = None,
) -> dict[str, Any]:
    digest = sha.removeprefix("sha256:")
    return {
        "sha256": sha,
        "site": site,
        "fetchedAt": fetched,
        "sourceUrl": source_url,
        "pageUrl": page_url,
        "publisher": "АО «ВЕРТЕКС»",
        "rawPath": f"data/raw/manufacturer-instructions/{site}/files/{digest}.{suffix}",
        "matches": matches,
        "textExtractionMode": "docx" if suffix == "docx" else "pdf_text_layer",
        "documentRevision": revision or [],
        "httpLastModified": "Tue, 14 Apr 2026 08:27:36 GMT",
    }


def test_ambiguous_matches_are_never_accepted() -> None:
    plan = plan_documents(
        [
            # Accepted + ambiguous in one file: only the accepted registration is attached.
            row(SHA_A, [match("ЛП-001", "label-unique"), match("ЛП-002", "label-ambiguous")]),
            # Only ambiguous: left out, its registrations are reported.
            row(SHA_B, [match("ЛП-003", "label-ambiguous"), match("ЛП-004", "label-ambiguous")]),
            # ЛП-005 is ambiguous in one file and unique in another: accepted through the latter.
            row(SHA_C, [match("ЛП-005", "label-unique")]),
            row("sha256:" + "d" * 64, [match("ЛП-005", "label-ambiguous")]),
        ]
    )
    assert [d.registration_numbers for d in plan.documents] == [("ЛП-001",), ("ЛП-005",)]
    assert [item["sha256"] for item in plan.unattached_files] == [SHA_B, "sha256:" + "d" * 64]
    # ЛП-002 only ever matched ambiguously (next to ЛП-001 in the first file).
    assert plan.ambiguous_only == ("ЛП-002", "ЛП-003", "ЛП-004")
    assert set(registration_levels(plan)) == {"ЛП-001", "ЛП-005"}


def test_rows_of_one_file_merge_with_the_strongest_level_per_registration() -> None:
    plan = plan_documents(
        [
            row(
                SHA_A,
                [match("ЛП-002", "label-unique")],
                fetched="2026-10-02T17:00:00Z",
                source_url="https://example.ru/old.pdf",
            ),
            row(
                SHA_A,
                [match("ЛП-002", "text-number"), match("ЛП-001", "page-number")],
                fetched="2026-10-02T18:00:00Z",
                source_url="https://example.ru/new.pdf",
                page_url="https://example.ru/other/",
            ),
        ]
    )
    assert len(plan.documents) == 1
    document = plan.documents[0]
    assert [(m.registration_number, m.match_level) for m in document.matches] == [
        ("ЛП-002", "text-number"),
        ("ЛП-001", "page-number"),
    ]
    assert document.primary.registration_number == "ЛП-002"
    assert document.strongest_level == "text-number"
    assert document.weakest_level == "page-number"
    assert document.newest["sourceUrl"] == "https://example.ru/new.pdf"
    metadata = registry_source(document)["metadata"]
    assert metadata["matchLevel"] == "page-number"
    assert metadata["matchMethod"] == "number-on-page"
    assert metadata["registrationNumbers"] == ["ЛП-001", "ЛП-002"]
    assert metadata["sourceUrls"] == ["https://example.ru/old.pdf", "https://example.ru/new.pdf"]
    assert metadata["pageUrls"] == ["https://example.ru/p/", "https://example.ru/other/"]
    assert [m["matchLevel"] for m in metadata["registrationMatches"]] == [
        "text-number",
        "page-number",
    ]


def test_document_id_is_the_first_20_hex_of_the_file_hash() -> None:
    assert document_id(SHA_A) == "drug.rf.m1." + "a" * 20 + ".instruction"
    with pytest.raises(ValueError, match="share the first 20"):
        plan_documents(
            [
                row("sha256:" + "a" * 20 + "1" * 44, [match("ЛП-001", "label-unique")]),
                row("sha256:" + "a" * 20 + "2" * 44, [match("ЛП-002", "label-unique")]),
            ]
        )


def test_registry_entry_is_taken_from_the_manifest() -> None:
    plan = plan_documents(
        [
            row(
                SHA_A,
                [match("ЛП-001", "text-number", "Редуксин®")],
                revision=["file name date 2025-10-20"],
            )
        ]
    )
    source = registry_source(plan.documents[0])
    assert source["id"] == document_id(SHA_A)
    assert source["path"] == f"vertex/files/{'a' * 64}.pdf"
    assert source["format"] == "pdf"
    assert source["sourceType"] == "official_drug_instruction"
    assert source["title"] == "Редуксин®: инструкция по медицинскому применению"
    metadata = source["metadata"]
    assert metadata["sourceClass"] == "manufacturer-site"
    assert metadata["matchMethod"] == "number-in-text"
    assert metadata["officialSourceUrl"] == "https://example.ru/a.pdf"
    assert metadata["pdfSha256"] == SHA_A
    assert metadata["documentRevision"] == ["file name date 2025-10-20"]
    # A date taken from the file name was not printed in the document: no label.
    assert "instructionLabel" not in metadata
    assert metadata["ocr"] is False
    assert "sourceUrls" not in metadata


def test_non_https_source_url_is_not_a_source_link() -> None:
    plan = plan_documents(
        [row(SHA_A, [match("ЛП-001", "label-unique")], source_url="http://example.ru/a.pdf")]
    )
    assert "officialSourceUrl" not in registry_source(plan.documents[0])["metadata"]


def test_instruction_label_needs_a_printed_revision_statement() -> None:
    assert instruction_label([]) is None
    assert instruction_label(["file name date 2025-10-20"]) is None
    # a law the text refers to is not the document's revision
    assert (
        instruction_label(["утвержденному Постановлением Правительства РФ от 29.12.2007"]) is None
    )
    assert instruction_label(["РГ-RU) от 03.07.2024"]) == "Дата в документе: 03.07.2024"


def test_docx_goes_through_the_text_preparer(tmp_path: Path) -> None:
    raw_root = tmp_path / "raw"
    (raw_root / "vertex" / "text").mkdir(parents=True)
    (raw_root / "vertex" / "files").mkdir(parents=True)
    (raw_root / "vertex" / "files" / f"{'b' * 64}.docx").write_bytes(b"docx")
    (raw_root / "vertex" / "files" / f"{'a' * 64}.pdf").write_bytes(b"%PDF")
    (raw_root / "vertex" / "text" / f"{'b' * 64}.json").write_text(
        json.dumps({"text": "Листок-вкладыш\nТекст", "mode": "docx"}, ensure_ascii=False),
        encoding="utf-8",
    )
    plan = plan_documents(
        [
            row(SHA_A, [match("ЛП-001", "label-unique")]),
            row(SHA_B, [match("ЛП-002", "page-number")], suffix="docx"),
        ]
    )
    workspace = tmp_path / "workspace"
    counts = write_registries(plan, workspace, raw_root)
    assert (counts["pdf"], counts["text"]) == (1, 1)
    text_registry = yaml.safe_load((workspace / "registry-text.yaml").read_text(encoding="utf-8"))
    assert text_registry["pack"]["id"] == MODULE_ID
    (entry,) = text_registry["sources"]
    assert entry["format"] == "text"
    assert entry["path"] == f"docx-text/{'b' * 64}.txt"
    assert (workspace / entry["path"]).read_text(encoding="utf-8") == "Листок-вкладыш\nТекст"
    assert entry["metadata"]["fileFormat"] == "docx"
    assert entry["metadata"]["pdfSha256"] == SHA_B
    pdf_registry = yaml.safe_load((workspace / "registry-pdf.yaml").read_text(encoding="utf-8"))
    assert [s["format"] for s in pdf_registry["sources"]] == ["pdf"]


BODY = (
    "\n# Листок-вкладыш – информация для пациента\n\n"
    '<!-- localmed:source {"bbox":[1.0,2.0,3.0],"block":"p1-b2","kind":"paragraph"} -->\n'
    "Текст с хвостовыми пробелами.  \n\n\n"
)


def prepared_markdown() -> str:
    front = {
        "id": document_id(SHA_A),
        "title": "Препарат: инструкция по медицинскому применению",
        "source_type": "official_drug_instruction",
        "metadata": {
            "matchLevel": "label-unique",
            "extraction": {"format": "pdf", "qualityScore": 0.98, "pageCount": 4},
        },
    }
    return "---\n" + yaml.safe_dump(front, allow_unicode=True, sort_keys=False) + "---\n" + BODY


def test_staging_changes_only_the_front_matter() -> None:
    plan = plan_documents([row(SHA_A, [match("ЛП-001", "label-unique")])])
    staged = stage_markdown(prepared_markdown(), plan.documents[0])
    front, body = split_front_matter(staged)
    assert body == BODY
    assert front["title"] == "Препарат: листок-вкладыш"
    metadata = front["metadata"]
    assert metadata["documentKind"] == "leaflet"
    assert metadata["qualityScore"] == 0.98
    assert metadata["pdfPageCount"] == 4
    assert metadata["matchLevel"] == "label-unique"


def test_front_matter_is_required() -> None:
    document: PlannedDocument = plan_documents(
        [row(SHA_A, [match("ЛП-001", "label-unique")])]
    ).documents[0]
    with pytest.raises(ValueError, match="no front matter"):
        stage_markdown("# no front matter\n", document)
