from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest import vaccination_calendar as vaccination
from localmed_ingest import vaccination_calendar_1122n as transcription

REPO = Path(__file__).resolve().parents[3]
RAW = REPO / "data/raw/vaccination-calendar"
DATA = REPO / "apps/app/src/features/vaccination/data/ru-minzdrav-1122n.json"


def committed() -> dict[str, Any]:
    return json.loads(DATA.read_text(encoding="utf-8"))


def test_items_are_structured_from_the_printed_wording() -> None:
    item = vaccination.parse_item("Третья вакцинация против вирусного гепатита В (группы риска)")
    assert item["infectionKey"] == "hepatitis-b"
    assert item["steps"] == [{"kind": "vaccination", "ordinal": 3}]
    assert item["qualifier"] == "группы риска"
    assert item["text"] == "Третья вакцинация против вирусного гепатита В (группы риска)"


def test_item_with_a_condition_keeps_it_apart_from_the_infection() -> None:
    item = vaccination.parse_item(
        "Ревакцинация против дифтерии, столбняка – каждые 10 лет от момента последней ревакцинации"
    )
    assert item["infectionKey"] == "dt"
    assert item["condition"] == "каждые 10 лет от момента последней ревакцинации"
    assert item["steps"] == [{"kind": "revaccination", "ordinal": None}]


def test_paired_vaccination_and_revaccination_is_two_steps() -> None:
    item = vaccination.parse_item("Вакцинация против краснухи, ревакцинация против краснухи")
    assert item["infectionKey"] == "rubella"
    assert [step["kind"] for step in item["steps"]] == ["vaccination", "revaccination"]


def test_unknown_infection_stops_the_build() -> None:
    with pytest.raises(vaccination.VaccinationSourceError):
        vaccination.parse_item("Вакцинация против неизвестной инфекции")
    with pytest.raises(vaccination.VaccinationSourceError):
        vaccination.parse_item("Прививка от чего-то")


def test_ocr_check_counts_missing_words_and_forgives_lookalikes() -> None:
    page_words = {1: vaccination.words("Первая вакцинация против вирусного гепатита B")}
    found = vaccination.check_against_ocr(
        ["Первая вакцинация против вирусного гепатита В"], [1], page_words
    )
    assert found == {"ocrCoverage": 1.0, "ocrUnmatchedWords": []}
    missing = vaccination.check_against_ocr(
        ["Первая вакцинация против туберкулеза"], [1], page_words
    )
    assert missing["ocrUnmatchedWords"] == ["туберкулеза"]
    assert missing["ocrCoverage"] == 0.75


def test_ocr_check_uses_only_the_pages_of_the_row() -> None:
    page_words = {1: vaccination.words("гепатит"), 2: vaccination.words("туберкулез")}
    result = vaccination.check_against_ocr(["туберкулез"], [1], page_words)
    assert result["ocrCoverage"] == 0.0


def test_blueprint_numbers_are_complete_and_sequential() -> None:
    assert [row.number for row in transcription.NATIONAL_ROWS] == list(range(1, 20))
    assert [row.number for row in transcription.EPIDEMIC_ROWS] == list(range(1, 25))
    assert [item.number for item in transcription.PROCEDURE_ITEMS] == list(range(1, 16))
    assert set(transcription.PROCEDURE_FOOTNOTES) == {
        item.footnote for item in transcription.PROCEDURE_ITEMS if item.footnote
    }


def test_committed_calendar_has_a_source_page_on_every_row() -> None:
    calendar = committed()
    pages = {source["eoNumber"]: source["pagesCount"] for source in calendar["sources"]}
    units = [
        *calendar["national"]["rows"],
        *calendar["epidemic"]["rows"],
        *calendar["procedure"]["items"],
    ]
    assert len(units) == 19 + 24 + 15
    for unit in units:
        source = unit["source"]
        assert source["pdfPages"], unit["id"]
        assert all(1 <= page <= pages[source["eoNumber"]] for page in source["pdfPages"]), unit[
            "id"
        ]
        assert source["url"].endswith(f"#page={source['pdfPages'][0]}"), unit["id"]
        assert source["url"].startswith("http://publication.pravo.gov.ru/file/pdf?eoNumber="), unit[
            "id"
        ]


def test_committed_calendar_has_no_empty_cell() -> None:
    calendar = committed()
    for row in calendar["national"]["rows"]:
        assert row["category"].strip(), row["id"]
        assert row["items"], row["id"]
        assert all(item["text"].strip() for item in row["items"]), row["id"]
    for row in calendar["epidemic"]["rows"]:
        assert row["vaccine"].startswith("Против "), row["id"]
        assert row["categories"], row["id"]
        assert all(block["text"].strip() for block in row["categories"]), row["id"]
    for item in calendar["procedure"]["items"]:
        assert item["blocks"], item["id"]
        assert all(block.strip() for block in item["blocks"]), item["id"]


def test_committed_calendar_records_the_edition_and_the_amendment() -> None:
    calendar = committed()
    assert calendar["edition"]["editionLine"] == "по приказу № 1122н в ред. приказа № 677н"
    assert calendar["edition"]["amendingOrders"] == ["677н"]
    assert [source["orderNumber"] for source in calendar["sources"]] == ["1122н", "677н"]
    covid = calendar["epidemic"]["rows"][23]
    assert covid["amendedBy"] == "677н"
    assert covid["source"]["eoNumber"] == calendar["sources"][1]["eoNumber"]
    assert "К приоритету 1-го уровня относятся:" in [
        block["text"] for block in covid["previousEdition"]["categories"]
    ]
    assert calendar["procedure"]["items"][14]["amendedBy"] == "677н"
    assert calendar["review"]["clinicalReview"] == "none"


def test_committed_calendar_ocr_agreement() -> None:
    calendar = committed()
    for row in calendar["national"]["rows"]:
        assert row["verification"]["ocrCoverage"] >= vaccination.COVERAGE_FLOOR, row["id"]
    # The few words the OCR missed are recorded, not hidden.
    missed = {
        unit["id"]: unit["verification"]["ocrUnmatchedWords"]
        for unit in [*calendar["epidemic"]["rows"], *calendar["procedure"]["items"]]
        if unit["verification"]["ocrUnmatchedWords"]
    }
    assert missed == {"e-20": ["к"], "p-12": ["18"]}


@pytest.mark.skipif(not (RAW / "0001202112200070.ocr.json").exists(), reason="raw files absent")
def test_committed_calendar_matches_a_rebuild_from_the_raw_files() -> None:
    assert vaccination.prepare(RAW) == committed()


def test_a_weak_row_stops_the_build(tmp_path: Path) -> None:
    for source in vaccination.SOURCES:
        eo_number = source["eoNumber"]
        record = {
            "eoNumber": eo_number,
            "orderNumber": source["number"],
            "orderDate": source["date"],
            "complexName": "x",
            "registration": {"number": "1", "date": "2021-01-01"},
            "publicationUrl": "u",
            "pdfUrl": "u",
            "pagesCount": 15 if source["role"] == "order" else 2,
            "bytes": 1,
            "sha256": "0" * 64,
            "retrievedAt": "2026-10-05",
        }
        (tmp_path / f"{eo_number}.source.json").write_text(json.dumps(record), encoding="utf-8")
        pages = [
            {"page": n, "lines": [{"text": "пусто"}]} for n in range(1, record["pagesCount"] + 1)
        ]
        (tmp_path / f"{eo_number}.ocr.json").write_text(
            json.dumps({"pages": pages}), encoding="utf-8"
        )
    with pytest.raises(vaccination.VaccinationSourceError, match="coverage floor"):
        vaccination.prepare(tmp_path)


def test_procedure_paragraphs_say_what_they_are_about() -> None:
    items = {item["number"]: item["appliesTo"] for item in committed()["procedure"]["items"]}
    assert all(items[str(number)] == ["general"] for number in range(1, 9))
    assert items["9"] == ["hepatitis-b", "influenza"]
    assert items["10"] == ["tuberculosis"]
    assert items["12"] == ["polio"]
    assert items["15"] == ["sars-cov-2"]


def test_a_paragraph_that_does_not_name_its_infection_stops_the_build() -> None:
    paragraph = transcription.ProcedureItem(
        1,
        ("Профилактические прививки проводятся в медицинских организациях.",),
        (13,),
        applies_to=("polio",),
    )
    with pytest.raises(vaccination.VaccinationSourceError, match="is not about"):
        vaccination._applies_to(paragraph)  # pyright: ignore[reportPrivateUsage]


def test_age_rows_carry_their_unit() -> None:
    rows = {row["number"]: row["age"] for row in committed()["national"]["rows"]}
    assert rows["1"] == {"unit": "day-of-life", "from": 1, "to": 1}
    assert rows["2"] == {"unit": "day-of-life", "from": 3, "to": 7}
    assert rows["6"] == {"unit": "months", "from": 4.5, "to": 4.5}
    assert rows["13"] == {"unit": "months", "from": 72, "to": 84}
    assert rows["15"] is None
    assert rows["19"] is None
