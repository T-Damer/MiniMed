from __future__ import annotations

import json
from pathlib import Path

from localmed_ingest.clinical_definition_sections import (
    build_clinical_glossary_drafts,
    parse_glossary_block,
    parse_prose_definition,
)
from localmed_ingest.definition_reference_pack import Projection, digest, obj

SOURCE_DESCRIPTOR = {
    "authority": "third-party",
    "accessed": "2026-09-21",
    "rightsStatus": "not-qualified-for-new-release",
    "releaseEligible": False,
    "title": (
        "Клинические рекомендации: полные подготовленные пакеты MiniMed, закреплённая редакция"
    ),
    "baseUrl": (
        "https://github.com/T-Damer/MiniMed/blob/"
        "77fe143a31608a925c608fff3a5de28163cc77a4/apps/app/public/content/clinical/"
    ),
    "sourceType": "existing-clinical-detail-dataset",
    "datasetCommit": "77fe143a31608a925c608fff3a5de28163cc77a4",
    "datasetTree": "5234e93faeeef01c364df182b84399536a4213ab",
}


def _shard(entries: list[dict[str, object]]) -> dict[str, object]:
    blocks = []
    terms = []
    for index, entry in enumerate(entries, start=1):
        blocks.append(
            {
                "id": index,
                "source": 3002,
                "text": entry["text"],
                "textSha256": digest(entry["text"]),
                "path": "clinical-fixture.db",
                "locator": (
                    f"document=kr.fixture.{index}; section=section.{index}; chunk=chunk.{index}"
                ),
            }
        )
        terms.append(
            {
                "id": f"prepared.definition.fixture{index}",
                "title": entry["title"],
                "kind": entry.get("kind", "term"),
                "aliases": [],
                "blockIds": [index],
                "coverage": entry.get("coverage", "definition-section"),
                "note": "fixture",
                "sectionTitle": entry["sectionTitle"],
            }
        )
    return {
        "version": 3,
        "id": "fixture.clinical-detail",
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [{"id": 3002, **SOURCE_DESCRIPTOR}],
        "blocks": blocks,
        "terms": terms,
    }


def _write_fixture_corpus(root: Path, shards: list[dict[str, object]]) -> None:
    drafts = root / "content/definition-drafts"
    drafts.mkdir(parents=True, exist_ok=True)
    parts = []
    for index, shard in enumerate(shards, start=1):
        name = f"clinical-source-excerpts-2026.09.21.part-{index:02d}.json"
        payload = json.dumps(shard, ensure_ascii=False).encode("utf-8")
        (drafts / name).write_bytes(payload)
        parts.append(
            {"path": name, "records": len(shard["terms"]), "sha256": digest(payload.decode())}
        )
    (drafts / "clinical-source-excerpts-2026.09.21.json").write_text(
        json.dumps({"version": 1, "parts": parts}, ensure_ascii=False), encoding="utf-8"
    )


# --------------------------------------------------------------------------------------
# parse_glossary_block / parse_prose_definition
# --------------------------------------------------------------------------------------


def test_parses_clean_glossary_pairs_with_various_dashes() -> None:
    body = (
        "Пациент – физическое лицо, которому оказывается медицинская помощь.\n\n"
        "Заболевание - нарушение деятельности организма.\n\n"
        "Синдром — устойчивая совокупность симптомов."
    )
    result = parse_glossary_block(body)
    assert result.status == "glossary"
    assert result.skipped == 0
    assert [pair.term for pair in result.pairs] == ["Пациент", "Заболевание", "Синдром"]
    assert result.pairs[0].definition == "физическое лицо, которому оказывается медицинская помощь."
    # Offsets index into the original body verbatim.
    start, end = result.pairs[0].start, result.pairs[0].end
    assert body[start:end] == "Пациент – физическое лицо, которому оказывается медицинская помощь."


def test_flags_soft_hyphen_ocr_artifact_without_altering_text() -> None:
    body = "ИМП \xad– инфекция мочевыводящих путей."
    result = parse_glossary_block(body)
    assert result.status == "glossary"
    pair = result.pairs[0]
    assert pair.term == "ИМП"
    assert "ocr-artifact" in pair.flags
    assert pair.definition == "инфекция мочевыводящих путей."


def test_partial_glossary_keeps_matched_pairs_and_counts_skipped() -> None:
    body = (
        "АЛТ – аланинаминотрансфераза.\n\n"
        "Это отдельный абзац без разделителя, который нельзя честно разобрать на пару.\n\n"
        "АСТ – аспартатаминотрансфераза."
    )
    result = parse_glossary_block(body)
    assert result.status == "glossary-partial"
    assert result.skipped == 1
    assert [pair.term for pair in result.pairs] == ["АЛТ", "АСТ"]


def test_placeholder_section_is_empty_not_nonstandard() -> None:
    assert parse_glossary_block("Не применяются.").status == "empty"
    assert parse_glossary_block("Новые термины не используются в документе.").status == "empty"
    assert parse_glossary_block("").status == "empty"


def test_free_prose_without_pairs_is_nonstandard_and_not_force_fit() -> None:
    body = (
        "Информация для пациента, получающего терапию (См. Термины и определения). "
        "Своевременное взаимодействие с врачом является важной составляющей помощи."
    )
    result = parse_glossary_block(body)
    assert result.status == "nonstandard"
    assert result.pairs == ()


def test_prose_definition_returns_whole_paragraph_as_one_pair() -> None:
    body = "Талассемии представляют собой гетерогенную группу нарушений гемоглобина."
    result = parse_prose_definition(body)
    assert result.status == "prose"
    assert len(result.pairs) == 1
    assert result.pairs[0].term == ""
    assert result.pairs[0].definition == body


def test_prose_definition_placeholder_is_empty() -> None:
    assert parse_prose_definition("См. раздел 1.1.").status == "empty"


# --------------------------------------------------------------------------------------
# build_clinical_glossary_drafts (end to end against a tiny fixture corpus)
# --------------------------------------------------------------------------------------


def test_builder_splits_glossary_and_promotes_prose_disease_definition(tmp_path: Path) -> None:
    shard = _shard(
        [
            {
                "title": "Критическая ишемия нижних конечностей (КИНК)",
                "sectionTitle": "Термины и определения",
                "text": (
                    "Критическая ишемия нижней конечности - длительно существующее клиническое "
                    "состояние.\n\nПациент - физическое лицо, которому оказывается медицинская "
                    "помощь."
                ),
            },
            {
                "title": "Талассемия",
                "kind": "syndrome",
                "sectionTitle": "1.1 Определение заболевания или состояния",
                "text": "Талассемии представляют собой гетерогенную группу нарушений гемоглобина.",
            },
            {
                "title": "Эозинофильный эзофагит",
                "sectionTitle": "Термины и определения",
                "text": "Не применяются.",
            },
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    glossary = obj(result["glossary"])
    report = obj(result["report"])
    titles = {obj(term)["title"] for term in glossary["terms"]}
    assert "Критическая ишемия нижней конечности" in titles
    assert "Пациент" in titles
    assert "Талассемия" in titles  # promoted single-paragraph disease definition
    assert "Эозинофильный эзофагит" not in titles  # placeholder section, correctly dropped
    assert report["counts"]["empty"] == 1
    for term in glossary["terms"]:
        row = obj(term)
        assert row["coverage"] == "explicit-definition"
        if row["title"] == "Талассемия":
            assert row["kind"] == "syndrome"
            assert row["recordType"] == "disease-definition"
        else:
            assert row["recordType"] == "term-glossary"


def test_builder_extracts_abbreviations_as_a_separate_non_definition_type(tmp_path: Path) -> None:
    shard = _shard(
        [
            {
                "id": "abbrev",
                "title": "АБТ",
                "sectionTitle": "Список сокращений",
                "coverage": "explicit-definition",
                "text": "АБТ – антибактериальная терапия.\n\nАД – артериальное давление.",
            }
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    abbreviations = obj(result["abbreviations"])
    assert result["glossary"] is None  # no definition-section records in this fixture
    rows = {obj(term)["title"]: obj(term) for term in abbreviations["terms"]}
    assert set(rows) == {"АБТ", "АД"}
    for row in rows.values():
        assert row["kind"] == "abbreviation"
        assert row["coverage"] == "abbreviation"


def test_trailing_punctuation_differences_fold_into_one_abbreviation_entry(tmp_path: Path) -> None:
    # Regression: "артериальное давление", "артериальное давление." and "артериальное
    # давление;" used to hash to three different definition_sha values (byte-exact match
    # on the raw quote) and therefore mint three separate "АД" records instead of one
    # folded entry with multiple citation blocks. Only the fold/compare key is normalized;
    # each block still stores its own untouched verbatim quote.
    shard = _shard(
        [
            {
                "title": "Документ 1",
                "sectionTitle": "Список сокращений",
                "coverage": "abbreviation-section",
                "text": "АД – артериальное давление.",
            },
            {
                "title": "Документ 2",
                "sectionTitle": "Список сокращений",
                "coverage": "abbreviation-section",
                "text": "АД – артериальное давление",
            },
            {
                "title": "Документ 3",
                "sectionTitle": "Список сокращений",
                "coverage": "abbreviation-section",
                "text": "АД – артериальное давление;",
            },
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    abbreviations = obj(result["abbreviations"])
    rows = [obj(term) for term in abbreviations["terms"] if obj(term)["title"] == "АД"]
    assert len(rows) == 1
    assert "conflicting-expansion" not in rows[0]["flags"]
    assert len(rows[0]["blockIds"]) == 3
    quoted_texts = {
        obj(block)["text"]
        for block in abbreviations["blocks"]
        if block["id"] in rows[0]["blockIds"]
    }
    # Verbatim per-citation text is preserved even though the fold key was normalized.
    assert quoted_texts == {
        "артериальное давление.",
        "артериальное давление",
        "артериальное давление;",
    }


def test_abbreviation_section_parent_title_is_the_document_title_not_a_stray_acronym(
    tmp_path: Path,
) -> None:
    # Regression: with the old lead-paragraph bug, `entry.title` for a whole "Список
    # сокращений" block used to be the first acronym in the list (e.g. "АВП"), so every
    # pair parsed out of that block -- including unrelated ones like "АД" -- inherited
    # "АВП" as parentTitle. The corrected extractor captures abbreviation-section blocks
    # under the document's own title, so this metadata must point at that document title.
    shard = _shard(
        [
            {
                "title": "Тревожно-фобические расстройства",
                "sectionTitle": "Список сокращений",
                "coverage": "abbreviation-section",
                "text": (
                    "АВП – антипсихотические средства второго поколения\n\nАД – антидепрессанты"
                ),
            }
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    abbreviations = obj(result["abbreviations"])
    rows = {obj(term)["title"]: obj(term) for term in abbreviations["terms"]}
    ad_block_id = rows["АД"]["blockIds"][0]
    ad_block = next(b for b in abbreviations["blocks"] if b["id"] == ad_block_id)
    assert ad_block["parentTitle"] == "Тревожно-фобические расстройства"
    assert ad_block["parentTitle"] != "АВП"


def test_identical_wording_across_documents_is_one_entry_with_two_citations(tmp_path: Path) -> None:
    boilerplate = "Пациент - физическое лицо, которому оказывается медицинская помощь."
    shard = _shard(
        [
            {"title": "Болезнь А", "sectionTitle": "Термины и определения", "text": boilerplate},
            {"title": "Болезнь Б", "sectionTitle": "Термины и определения", "text": boilerplate},
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    glossary = obj(result["glossary"])
    patient_terms = [obj(term) for term in glossary["terms"] if obj(term)["title"] == "Пациент"]
    assert len(patient_terms) == 1
    assert len(patient_terms[0]["blockIds"]) == 2
    assert "conflicting-definition" not in patient_terms[0]["flags"]


def test_conflicting_wording_stays_separate_and_flagged(tmp_path: Path) -> None:
    shard = _shard(
        [
            {
                "title": "Болезнь А",
                "sectionTitle": "Термины и определения",
                "text": "Синдром - устойчивая совокупность симптомов с единым патогенезом.",
            },
            {
                "title": "Болезнь Б",
                "sectionTitle": "Термины и определения",
                "text": "Синдром - совокупность признаков, объединённых общим происхождением.",
            },
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    glossary = obj(result["glossary"])
    syndrome_terms = [obj(term) for term in glossary["terms"] if obj(term)["title"] == "Синдром"]
    assert len(syndrome_terms) == 2
    assert all("conflicting-definition" in term["flags"] for term in syndrome_terms)
    assert report_has_conflict_count(obj(result["report"]))


def report_has_conflict_count(report: dict[str, object]) -> bool:
    return report["distinctConflictingGlossaryTitles"] == 1


def test_output_feeds_the_ordinary_v3_projection_without_modification(tmp_path: Path) -> None:
    shard = _shard(
        [
            {
                "title": "Критическая ишемия нижних конечностей (КИНК)",
                "sectionTitle": "Термины и определения",
                "text": "Критическая ишемия нижней конечности - длительно существующее состояние.",
            }
        ]
    )
    _write_fixture_corpus(tmp_path, [shard])
    result = build_clinical_glossary_drafts(tmp_path)
    glossary = obj(result["glossary"])
    projection = Projection()
    receipt = digest(json.dumps(glossary, ensure_ascii=False))
    projection.add(glossary, receipt)
    assert len(projection.entries) == 1
    entry = next(iter(projection.entries.values()))
    assert entry.coverage == "explicit-definition"
    assert entry.text_kind == "source-excerpt"
