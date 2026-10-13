"""Pure parts of the GRLS instruction module builder: grouping and front-matter staging."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from localmed_ingest.grls_instruction_modules import (
    PlannedInstruction,
    assign_group,
    apply_overlay,
    augmented_markdown,
    module_id,
    reviewed_override,
    split_front_matter,
)

BODY = (
    "\n# РАМИПРИЛ\n\n"
    '<!-- localmed:source {"bbox":[1.0,2.0,3.0],"block":"p1-b2","kind":"paragraph"} -->\n'
    "Регистрационный номер: ЛП-008472.  \n\n\n"
    "Текст с хвостовыми пробелами и неразрывным пробелом.\n"
)


def instruction_markdown(title: str = "РАМИПРИЛ: инструкция по медицинскому применению") -> str:
    return (
        "---\n"
        "id: drug.rf.0001093e970339aa31f2.instruction\n"
        f"title: '{title}'\n"
        "version_label: grls-24.07.2026\n"
        "source_type: official_drug_instruction\n"
        "metadata:\n"
        "  registrationNumber: ЛП-008472\n"
        "  instructionLabel: Изм. № 0, ЛП-008472, 2022\n"
        "---\n" + BODY
    )


def entry(kind: str = "leaflet") -> PlannedInstruction:
    return PlannedInstruction(
        document_id="drug.rf.0001093e970339aa31f2.instruction",
        path=Path("unused.md"),
        group="cardiovascular",
        group_basis="esklp-registration",
        registration_numbers=("ЛП-008472", "ЛП-№(008472)-(РГ-RU)"),
        newest={
            "documentKind": kind,
            "fetchedAt": "2026-07-30T07:56:33Z",
            "ocr": True,
            "textExtractionMode": "ocr_vision",
            "ocrEngine": "apple-vision",
            "ocrMeanConfidence": None,
            "unknownWordRatio": 0.03,
            "qualityScore": 1.0,
            "textSha256": "sha256:" + "a" * 64,
            "pageCount": 12,
        },
    )


def test_assign_group_uses_the_primary_registration_first() -> None:
    groups = {"A": {"cardiovascular"}, "B": {"nervous-system"}}
    assert assign_group("A", ["A", "B"], groups) == ("cardiovascular", "esklp-registration")


def test_assign_group_falls_back_to_the_most_common_group_of_the_pdf() -> None:
    groups = {"B": {"nervous-system"}, "C": {"nervous-system"}, "D": {"blood"}}
    assert assign_group("A", ["A", "B", "C", "D"], groups) == (
        "nervous-system",
        "esklp-registration",
    )


def test_assign_group_breaks_a_tie_alphabetically_and_says_so() -> None:
    groups = {"B": {"nervous-system"}, "D": {"blood"}}
    assert assign_group("A", ["A", "B", "D"], groups) == ("blood", "esklp-registration-tie")


def test_assign_group_without_esklp_registration_is_unclassified() -> None:
    assert assign_group("A", ["A"], {}) == ("unclassified", "no-esklp-registration")


def test_assign_group_of_a_registration_in_two_groups_is_decided_by_the_whole_pdf() -> None:
    groups = {"A": {"blood", "cardiovascular"}, "B": {"cardiovascular"}}
    assert assign_group("A", ["A", "B"], groups)[0] == "cardiovascular"


def test_module_id_follows_the_esklp_naming() -> None:
    assert module_id("nervous-system") == "minimed.medications.instructions.nervous-system.ru"


def test_augmented_markdown_keeps_the_body_byte_for_byte() -> None:
    staged = augmented_markdown(instruction_markdown(), entry())
    _front, body = split_front_matter(staged)
    assert body == BODY
    assert staged.endswith(BODY)


def test_augmented_markdown_adds_only_manifest_facts_to_the_metadata() -> None:
    staged = augmented_markdown(instruction_markdown(), entry())
    front, _body = split_front_matter(staged)
    metadata = front["metadata"]
    assert metadata["registrationNumber"] == "ЛП-008472"
    assert metadata["instructionLabel"] == "Изм. № 0, ЛП-008472, 2022"
    assert metadata["documentKind"] == "leaflet"
    assert metadata["fetchedAt"] == "2026-07-30T07:56:33Z"
    assert metadata["ocr"] is True
    assert metadata["registrationNumbers"] == ["ЛП-008472", "ЛП-№(008472)-(РГ-RU)"]
    assert metadata["atcGroup"] == "cardiovascular"
    # A value the manifest does not have is absent, not invented.
    assert "ocrMeanConfidence" not in metadata
    assert front["id"] == "drug.rf.0001093e970339aa31f2.instruction"
    assert front["version_label"] == "grls-24.07.2026"


def test_a_leaflet_title_names_its_kind_and_an_instruction_title_does_not_change() -> None:
    leaflet = split_front_matter(augmented_markdown(instruction_markdown(), entry()))[0]
    assert leaflet["title"] == "РАМИПРИЛ: листок-вкладыш"
    kept = split_front_matter(
        augmented_markdown(instruction_markdown(), entry("national-instruction"))
    )[0]
    assert kept["title"] == "РАМИПРИЛ: инструкция по медицинскому применению"
    custom = split_front_matter(
        augmented_markdown(instruction_markdown("Гам-КОВИД-Вак Вакцина"), entry())
    )[0]
    assert custom["title"] == "Гам-КОВИД-Вак Вакцина"


def test_the_staged_front_matter_is_valid_yaml_for_cyrillic_text() -> None:
    staged = augmented_markdown(instruction_markdown(), entry())
    assert yaml.safe_load(staged.split("\n---\n", 1)[0].removeprefix("---\n"))["metadata"]["ocr"]


def test_split_front_matter_rejects_a_document_without_front_matter() -> None:
    with pytest.raises(ValueError, match="front matter"):
        split_front_matter("# Заголовок\n")
    with pytest.raises(ValueError, match="unterminated"):
        split_front_matter("---\nid: x\n")


def _with_checksum(text: str, checksum: str) -> str:
    return text.replace("source_type:", f"source_checksum: {checksum}\nsource_type:", 1)


def test_a_reviewed_text_replaces_the_prepared_one_only_for_the_same_pdf(tmp_path: Path) -> None:
    prepared = _with_checksum(instruction_markdown(), "sha256:aaa")
    reviewed = _with_checksum(instruction_markdown(), "sha256:aaa").replace(
        "Текст с хвостовыми", "Проверенный текст с хвостовыми"
    )
    (tmp_path / "drug.rf.0001093e970339aa31f2.instruction.md").write_text(
        reviewed, encoding="utf-8"
    )
    document_id = "drug.rf.0001093e970339aa31f2.instruction"
    assert reviewed_override(document_id, prepared, tmp_path) == reviewed
    # A different PDF (new edition): the fresh OCR is used, the old review is ignored.
    newer = _with_checksum(instruction_markdown(), "sha256:bbb")
    assert reviewed_override(document_id, newer, tmp_path) is None
    # No reviewed file: nothing to replace.
    assert reviewed_override("drug.rf.other.instruction", prepared, tmp_path) is None


def test_a_reviewed_file_with_another_id_is_rejected(tmp_path: Path) -> None:
    prepared = _with_checksum(instruction_markdown(), "sha256:aaa")
    (tmp_path / "drug.rf.x.instruction.md").write_text(prepared, encoding="utf-8")
    with pytest.raises(ValueError, match="front matter id"):
        reviewed_override("drug.rf.x.instruction", prepared, tmp_path)


def manifest_row(checksum: str, **extra: object) -> dict[str, object]:
    return {
        "pdfSha256": checksum,
        "extraction": "prepared",
        "sourceId": "drug.rf.0001093e970339aa31f2.instruction",
        "workspace": "../../data/intermediate/grls-full-final",
        "documentKind": "national-instruction",
        "ocr": True,
        "ocrMeanConfidence": None,
        "unknownWordRatio": 0.2,
        "textSha256": "sha256:old",
        **extra,
    }


OVERLAY_ROW = {
    "pdfSha256": "sha256:aaa",
    "workspace": "../../data/intermediate/grls-ocr-cleaned",
    "documentKind": "amendment",
    "documentKindReason": "«Изменение №» with a table of old/new edition",
    "ocr": True,
    "ocrEngine": "macos-vision",
    "ocrTool": "macos-vision",
    "ocrMeanConfidence": 0.91,
    "ocrLowConfidenceRatio": 0.02,
    "ocrQuality": "fair",
    "ocrQualityReasons": ["some numbers are uncertain"],
    "unknownWordRatio": 0.05,
    "uncertainNumbers": 2,
    "wordEdits": 4,
    "textSha256": "sha256:new",
}


def test_overlay_replaces_workspace_kind_and_quality_for_the_same_pdf_only() -> None:
    rows = [manifest_row("sha256:aaa"), manifest_row("sha256:bbb"), manifest_row("sha256:aaa", extraction="not-prepared")]
    merged = apply_overlay(rows, {"sha256:aaa": OVERLAY_ROW})
    assert merged[0]["workspace"].endswith("grls-ocr-cleaned")  # type: ignore[union-attr]
    assert merged[0]["documentKind"] == "amendment"
    assert merged[0]["ocrMeanConfidence"] == 0.91
    assert merged[0]["textSha256"] == "sha256:new"
    assert merged[1] == rows[1]  # another PDF: untouched
    assert merged[2] == rows[2]  # not prepared: nothing to replace
    assert "ocrOverlay" not in merged[1]
    assert rows[0]["documentKind"] == "national-instruction"  # input rows are not mutated


def test_overlay_quality_reaches_the_document_metadata_and_an_amendment_title() -> None:
    newest = apply_overlay([manifest_row("sha256:aaa")], {"sha256:aaa": OVERLAY_ROW})[0]
    planned = PlannedInstruction(
        document_id="drug.rf.0001093e970339aa31f2.instruction",
        path=Path("unused.md"),
        group="cardiovascular",
        group_basis="esklp-registration",
        registration_numbers=("ЛП-008472",),
        newest=newest,
    )
    front, body = split_front_matter(augmented_markdown(instruction_markdown(), planned))
    assert body == BODY
    metadata = front["metadata"]
    assert metadata["documentKind"] == "amendment"
    assert metadata["ocrQuality"] == "fair"
    assert metadata["ocrMeanConfidence"] == 0.91
    assert metadata["ocrTool"] == "macos-vision"
    assert metadata["ocrUncertainNumbers"] == 2
    assert front["title"] == "РАМИПРИЛ: лист изменений к инструкции"
