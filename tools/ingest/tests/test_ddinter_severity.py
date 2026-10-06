"""DDInter severity module: name matching, the card join, the severity rule and the pack."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest import ddinter_severity as dd


def atc() -> dd.AtcIndex:
    return dd.build_atc_index(
        [
            dd.AtcSubstance("N02BE01", "Парацетамол", "Paracetamol"),
            dd.AtcSubstance("B01AA03", "Варфарин", "Warfarin"),
            dd.AtcSubstance("H03AA01", "Левотироксин натрия", "Levothyroxine Sodium"),
            dd.AtcSubstance("A10BB01", "Глибенкламид", "Glibenclamide"),
            dd.AtcSubstance("M01AE01", "Ибупрофен", "Ibuprofen"),
            dd.AtcSubstance("C08CA01", "Амлодипин", "Amlodipine"),
            dd.AtcSubstance("A10AB01", "Инсулин (человеческий)", "Insulin (Human)"),
        ]
    )


def test_normalize_name_keeps_letters_and_digits_only() -> None:
    assert dd.normalize_name("St. John's  Wort") == "st john s wort"
    assert dd.salt_key("Levothyroxine sodium") == "levothyroxine"


def test_name_matching_steps() -> None:
    index = atc()
    aliases = dd.resolve_aliases(
        dd.build_atc_index(
            [
                *[
                    dd.AtcSubstance(f"X{n:06d}", "т", name)
                    for n, name in enumerate(sorted({*dd.USAN_TO_INN.values()}), start=1)
                ],
            ]
        )
    )
    assert dd.match_drug_to_atc("Warfarin", index, aliases) == dd.DrugMatch(
        frozenset({"B01AA03"}), "exact"
    )
    assert dd.match_drug_to_atc("Levothyroxine", index, aliases).method == "salt"
    assert dd.match_drug_to_atc("Levothyroxine", index, aliases).codes == {"H03AA01"}
    alias = dd.match_drug_to_atc("Acetaminophen", index, aliases)
    assert alias == dd.DrugMatch(frozenset({"N02BE01"}), "alias")
    assert dd.match_drug_to_atc("Dexamethasone (topical)", index, aliases).method == "qualifier"
    assert dd.match_drug_to_atc("Unobtainium", index, aliases).codes == frozenset()


def test_alias_resolves_to_the_inn_name() -> None:
    index = atc()
    aliases = {"acetaminophen": "paracetamol", "glyburide": "glibenclamide"}
    assert dd.match_drug_to_atc("Acetaminophen", index, aliases) == dd.DrugMatch(
        frozenset({"N02BE01"}), "alias"
    )
    assert dd.match_drug_to_atc("Glyburide", index, aliases).codes == {"A10BB01"}


def test_an_alias_whose_target_is_not_an_nsi_name_is_refused() -> None:
    with pytest.raises(ValueError, match="USAN_TO_INN"):
        dd.resolve_aliases(dd.build_atc_index([dd.AtcSubstance("N02BE01", "П", "Paracetamol")]))


def card(slug: str, name: str, *codes: str, components: tuple[str, ...] = ()) -> dd.Card:
    return dd.Card(slug, name, tuple(codes), components)


def test_card_codes_need_the_atc_name_to_agree_with_the_card() -> None:
    index = atc()
    assert dd.card_codes(card("a", "ПАРАЦЕТАМОЛ", "N02BE01"), index) == {"N02BE01"}
    # a neighbour's code in the card's list is not taken: the name decides
    assert dd.card_codes(card("b", "КОФЕИН", "B01AA03", "N02BE01"), index) == frozenset()
    # the name is not an НСИ name: the card's own code counts when the first words agree
    assert dd.card_codes(card("c", "ИНСУЛИН ДВУХФАЗНЫЙ [ЧЕЛОВЕЧЕСКИЙ]", "A10AB01"), index) == {
        "A10AB01"
    }
    # a different first word is a different substance (an enantiomer, a prodrug)
    assert dd.card_codes(card("d", "ЛЕВАМЛОДИПИН", "C08CA01"), index) == frozenset()


def test_a_combination_card_is_never_joined() -> None:
    assert not card("x", "ПАРАЦЕТАМОЛ+КОФЕИН", "N02BE51", components=("a", "b")).single
    assert not card("y", "А+Б", "N02BE51").single
    assert card("z", "ПАРАЦЕТАМОЛ", "N02BE01").single


def table(*rows: tuple[str, str, str, str, str]) -> dd.DdinterTable:
    result = dd.DdinterTable()
    for row in rows:
        dd.add_row(
            result,
            dict(zip(dd.CSV_COLUMNS, row, strict=True)),
        )
    return result


def test_table_keeps_one_row_per_unordered_pair_and_the_most_severe_level() -> None:
    result = table(
        ("D1", "Warfarin", "D2", "Ibuprofen", "Moderate"),
        ("D2", "Ibuprofen", "D1", "Warfarin", "Major"),
        ("D1", "Warfarin", "D3", "Paracetamol", "Minor"),
    )
    assert result.pairs == {("D1", "D2"): "Major", ("D1", "D3"): "Minor"}
    assert result.file_conflicts == 1
    assert result.rows == 3


def test_bad_rows_are_refused() -> None:
    with pytest.raises(ValueError, match="level"):
        table(("D1", "A", "D2", "B", "Severe"))
    with pytest.raises(ValueError, match="two names"):
        table(("D1", "A", "D2", "B", "Minor"), ("D1", "Other", "D3", "C", "Minor"))


def test_join_labels_card_pairs_and_keeps_the_most_severe_of_several_sources() -> None:
    index = atc()
    cards = [
        card("варфарин", "ВАРФАРИН", "B01AA03"),
        card("ибупрофен", "ИБУПРОФЕН", "M01AE01"),
        card("парацетамол", "ПАРАЦЕТАМОЛ", "N02BE01"),
        card("амлодипин", "АМЛОДИПИН", "C08CA01"),
        card("инсулин-а", "ИНСУЛИН ДВУХФАЗНЫЙ [ЧЕЛОВЕЧЕСКИЙ]", "A10AB01"),
        card("инсулин-б", "ИНСУЛИН РАСТВОРИМЫЙ (ЧЕЛОВЕЧЕСКИЙ)", "A10AB01"),
    ]
    result = table(
        ("D1", "Warfarin", "D2", "Ibuprofen", "Major"),
        ("D1", "Warfarin", "D3", "Acetaminophen", "Moderate"),
        ("D1", "Warfarin", "D4", "Not in Russia", "Major"),
        ("D5", "Insulin human", "D1", "Warfarin", "Minor"),
        ("D5", "Insulin human", "D2", "Ibuprofen", "Unknown"),
    )
    join = dd.join_table(result, cards, index, {"acetaminophen": "paracetamol"})
    assert join.labels[("варфарин", "ибупрофен")] == "Major"
    assert join.labels[("варфарин", "парацетамол")] == "Moderate"
    assert join.labels[("варфарин", "инсулин-а")] == "Minor"
    assert join.labels[("ибупрофен", "инсулин-б")] == "Unknown"
    assert all("not-in-russia" not in key for key in join.labels)
    assert join.pairs_total == 5
    assert join.pairs_joined_to_cards == 4


def test_two_sources_for_one_card_pair_keep_the_most_severe_level() -> None:
    index = atc()
    cards = [
        card("варфарин", "ВАРФАРИН", "B01AA03"),
        card("левотироксин", "ЛЕВОТИРОКСИН НАТРИЯ", "H03AA01"),
    ]
    result = table(
        ("D1", "Warfarin", "D2", "Levothyroxine", "Minor"),
        ("D1", "Warfarin", "D3", "Levothyroxine Sodium", "Major"),
    )
    join = dd.join_table(result, cards, index, {})
    assert join.labels == {("варфарин", "левотироксин"): "Major"}
    assert join.card_conflicts == 1


def test_severity_text_round_trips() -> None:
    text = dd.severity_document_text([("б", "Moderate"), ("а", "Major"), ("в", "Unknown")])
    assert text == "а\t3\nб\t2\nв\t0"
    assert dd.parse_severity_text(text) == {"а": "Major", "б": "Moderate", "в": "Unknown"}


def test_raw_manifest_detects_a_changed_file(tmp_path: Path) -> None:
    for name in dd.raw_file_names():
        (tmp_path / name).write_text(",".join(dd.CSV_COLUMNS) + "\n", encoding="utf-8")
    manifest = dd.write_raw_manifest(tmp_path, retrieved_on="2026-10-06")
    assert [item["name"] for item in manifest["files"]] == dd.raw_file_names()
    assert dd.verify_raw_manifest(tmp_path)["license"] == "CC-BY-NC-SA-4.0"
    (tmp_path / dd.raw_file_names()[0]).write_text("tampered\n", encoding="utf-8")
    with pytest.raises(ValueError, match="SHA-256"):
        dd.verify_raw_manifest(tmp_path)


def test_pack_holds_labels_and_the_licence_and_no_ddinter_text(tmp_path: Path) -> None:
    index = atc()
    cards = [
        card("варфарин", "ВАРФАРИН", "B01AA03"),
        card("ибупрофен", "ИБУПРОФЕН", "M01AE01"),
    ]
    result = table(("D1", "Warfarin", "D2", "Ibuprofen", "Major"))
    join = dd.join_table(result, cards, index, {})
    summary = dd.summarize(result, cards, join, index, "2026-10-06")
    manifest = {"retrievedOn": "2026-10-06", "files": []}
    pack = dd.build_pack(join, manifest, summary)
    out = tmp_path / "pack.db"
    dd.write_sqlite_pack(pack, out)
    with sqlite3.connect(out) as connection:
        rows = dict(
            connection.execute(
                "SELECT d.id, c.original_text FROM documents d "
                "JOIN document_versions v ON v.document_id = d.id "
                "JOIN chunks c ON c.document_version_id = v.id"
            ).fetchall()
        )
        metadata = json.loads(
            connection.execute(
                "SELECT metadata_json FROM documents WHERE id = ?", (dd.MANIFEST_DOCUMENT_ID,)
            ).fetchone()[0]
        )
        indexed = connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0]
    assert set(rows) == {dd.MANIFEST_DOCUMENT_ID, "ddinter.severity.варфарин"}
    assert rows["ddinter.severity.варфарин"] == "ибупрофен\t3"
    assert "CC-BY-NC-SA-4.0" in rows[dd.MANIFEST_DOCUMENT_ID]
    assert "Major / Moderate / Minor / Unknown" in rows[dd.MANIFEST_DOCUMENT_ID]
    assert metadata["definitionReference"] == 1
    assert metadata["levelCodes"] == dd.LEVEL_CODES
    # kept out of the ordinary search index
    assert indexed == 0
    assert summary["labelledPairs"] == 1
