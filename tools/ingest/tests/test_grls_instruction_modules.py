"""Pure parts of the GRLS instruction module builder: grouping and front-matter staging."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from localmed_ingest.grls_instruction_modules import (
    PlannedInstruction,
    assign_group,
    augmented_markdown,
    module_id,
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
