"""Form 058/у (order 740н of 20.08.2026): the committed schema, its provenance and its rules."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_forms import load_blueprint, prepare_form

REPO = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO / "apps/app/src/features/forms/schemas/ru-minzdrav-740n-058u.json"
RAW = REPO / "data/raw/medical-forms"
EO_NUMBER = "0001202609170010"
SOURCE_SHA = "26b298da6bdaa9f1921c86cb046b98d602d8704696f737a6ad56197669be45f1"


def schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def fields() -> dict[str, dict[str, Any]]:
    return {field["id"]: field for field in schema()["fields"]}


def test_the_schema_is_tied_to_order_740n_and_says_it_is_not_in_force_yet() -> None:
    data = schema()
    source = data["source"]
    assert data["id"] == "ru.minzdrav.740n.058u"
    assert data["formNumber"] == "058/у"
    assert data["title"].startswith("Экстренное извещение о случае инфекционной")
    assert source["orderNumber"] == "740н"
    assert source["orderDate"] == "2026-08-20"
    assert source["registration"] == {
        "authority": "Министерство юстиции Российской Федерации",
        "number": "88291",
        "date": "2026-09-16",
    }
    assert source["publicationUrl"] == f"http://publication.pravo.gov.ru/document/{EO_NUMBER}"
    assert source["sha256"] == SOURCE_SHA
    assert source["pdfPages"] == 9
    assert source["blankAppendix"] == {"number": 1, "pdfPages": [2, 3]}
    assert source["rulesAppendix"] == {"number": 2, "pdfPages": [4, 5, 6, 7, 8, 9]}
    # clause 2 of the order: in force from 1 March 2027 until 1 March 2033
    assert source["effectiveFrom"] == "2027-03-01"
    assert source["effectiveUntil"] == "2033-03-01"
    assert "вступает в силу 01.03.2027" in data["edition"]
    assert "01.03.2033" in data["edition"]


def test_the_order_numbers_its_filling_rules_by_item() -> None:
    ids = [rule["id"] for rule in schema()["rules"]]
    assert ids == ["5", "9"] + [f"10.{n}" for n in range(1, 13)] + ["11"]
    for rule in schema()["rules"]:
        assert rule["textSha256"] == hashlib.sha256(rule["text"].encode("utf-8")).hexdigest()
        assert rule["spans"]
        # no footnote marks or OCR look-alikes left in a cut paragraph
        assert not re.search(r"[®°]|[A-Za-z]+[а-я]|[а-я][A-Za-z]", rule["text"]), rule["id"]
        assert " - " not in rule["text"], rule["id"]
        assert not re.search(r"\) , ,|\bв м\b|медицинскаю", rule["text"]), rule["id"]
        # each paragraph starts with its own number, as printed
        assert rule["text"].startswith(f"{rule['id']}. ")


def test_reviewed_ocr_slips_are_repaired_and_logged() -> None:
    texts = {rule["id"]: rule["text"] for rule in schema()["rules"]}
    assert "или в отношении индивидуального предпринимателя" in texts["9"]
    assert "осуществляющего медицинскую деятельность" in texts["9"]
    assert "(далее – МКБ)" in texts["10.1"]
    assert "возраста 16 лет), неработающих лиц" in texts["10.6"]
    assert "иное. В строке «Выполняемые виды работ" in texts["10.6"]
    assert "пунктами 23–27" in texts["10.6"]
    assert "мероприятия и дополнительные сведения»" in texts["10.11"]
    assert texts["10.10"].endswith("сырьем животного происхождения.")
    logged = {(c["pdfPage"], c["from"]) for c in schema()["source"]["extraction"]["corrections"]}
    assert (6, "в м отношении") in logged
    assert (9, "мероприятия дополнительные") in logged


def test_field_rules_are_honest() -> None:
    data = schema()
    paragraph_ids = {rule["id"] for rule in data["rules"]}
    by_status: dict[str, list[str]] = {"defined": [], "by-line": [], "undefined": []}
    for field in data["fields"]:
        rule = field["rule"]
        by_status[rule["status"]].append(field["id"])
        if rule["status"] == "undefined":
            assert rule["paragraphIds"] == [] and rule.get("note"), field["id"]
        else:
            assert rule["paragraphIds"] and set(rule["paragraphIds"]) <= paragraph_ids
        if field["required"]:
            assert field["requiredBasis"] in ("source", "editorial"), field["id"]
        assert field["type"] not in ("signature", "stamp")
    # only the line «отправка экстренного извещения» is not named by the order
    assert by_status["undefined"] == ["sentDate"]
    # the parts of the four address lines are governed by the line, not named one by one
    assert len(by_status["by-line"]) == 28
    assert all(
        data_field["rule"]["paragraphIds"] == ["10.4"]
        for data_field in data["fields"]
        if data_field["rule"]["status"] == "by-line"
    )
    assert len(data["fields"]) == 80


def test_choice_lists_are_the_printed_codes() -> None:
    by_id = fields()

    def codes(field_id: str) -> list[tuple[str, str]]:
        return [(option["value"], option["label"]) for option in by_id[field_id]["options"]]

    assert codes("diagnosisKind") == [("1", "Предварительный"), ("2", "заключительный")]
    assert codes("labConfirmed") == [("1", "да"), ("2", "нет")]
    assert codes("noticeKind") == [("1", "первичное"), ("2", "повторное")]
    assert [value for value, _ in codes("reason")] == ["1", "2", "3"]
    assert codes("patientSex") == [("1", "мужской"), ("2", "женский")]
    assert [value for value, _ in codes("occupation")] == ["1", "2", "3", "4", "5", "6"]
    assert [value for value, _ in codes("occupationChild")] == ["7", "8", "9"]
    assert codes("biter") == [("1", "животное"), ("2", "клещ")]
    assert [value for value, _ in codes("animalKind")] == ["1.1", "1.2"]
    assert [value for value, _ in codes("injuryKind")] == ["1", "2", "3", "4", "5"]
    # the order says answers are underlined (item 5): every option row marks by underline
    layout = schema()["layout"]
    option_segments = [
        segment
        for block in layout["blocks"]
        for column in block["columns"]
        for line in column["rows"]
        for segment in line["segments"]
        if segment["kind"] == "options"
    ]
    assert len(option_segments) == 11
    assert all(segment["mark"] == "underline" for segment in option_segments)
    assert all(
        "5" in by_id[segment["fieldId"]]["rule"]["paragraphIds"] for segment in option_segments
    )


def test_prefill_binds_only_what_the_blank_prints_and_the_app_stores() -> None:
    by_id = fields()
    bound = {
        field_id: field["prefill"]
        for field_id, field in by_id.items()
        if field.get("prefill") is not None
    }
    assert bound["patientFullName"] == {"sources": ["patient.fullName"]}
    assert bound["patientSex"] == {
        "sources": ["patient.sex"],
        "map": {"male": "1", "female": "2"},
    }
    assert bound["patientBirthDate"] == {"sources": ["patient.birthDate"]}
    assert bound["snils"] == {"sources": ["patient.snils"]}
    assert bound["patientPhone"] == {"sources": ["patient.address.phone"]}
    assert bound["workplace"] == {"sources": ["patient.workplace"]}
    assert bound["diagnosis"] == {"sources": ["episode.diagnosis.text"]}
    assert bound["diagnosisIcd"] == {"sources": ["episode.diagnosis.icd10"]}
    assert bound["filledByName"] == {"sources": ["clinician.fullName"]}
    assert bound["filledByPosition"] == {"sources": ["clinician.position"]}
    assert bound["formDate"] == {"sources": ["today"]}
    assert bound["residenceSubject"] == {"sources": ["patient.address.subject"]}
    assert bound["stayApartment"] == {"sources": ["patient.stayAddress.apartment"]}
    # the actual residence has no source in the app; citizenship is for foreigners only
    assert not [key for key in bound if key.startswith(("residenceActual", "stayActual"))]
    assert "citizenship" not in bound
    # 28 address blanks: 7 parts for each of the four lines
    assert len([key for key in by_id if re.match(r"(residence|stay)(Actual)?[A-Z]", key)]) == 28


def test_dates_and_times_are_validated() -> None:
    by_id = fields()
    for field_id in ("formDate", "patientBirthDate", "onsetDate", "deathDate", "sentDate"):
        assert by_id[field_id]["type"] == "date" and by_id[field_id]["notAfter"] == "today"
    assert re.fullmatch(by_id["informedHour"]["pattern"], "23")
    assert not re.fullmatch(by_id["informedHour"]["pattern"], "24")
    assert re.fullmatch(by_id["informedMinute"]["pattern"], "59")
    assert not re.fullmatch(by_id["informedMinute"]["pattern"], "60")


def test_the_sheet_is_two_a4_pages_in_the_order_of_the_blank() -> None:
    layout = schema()["layout"]
    assert layout["page"]["size"] == "A4" and layout["page"]["orientation"] == "portrait"
    blocks = layout["blocks"]
    assert [block["id"] for block in blocks][:3] == ["header", "title", "filled"]
    breaks = [block["id"] for block in blocks if block.get("pageBreakBefore")]
    assert breaks == ["workplace"]


@pytest.mark.skipif(
    not (RAW / f"{EO_NUMBER}.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
def test_the_committed_schema_matches_a_fresh_build() -> None:
    source = json.loads((RAW / f"{EO_NUMBER}.source.json").read_text(encoding="utf-8"))
    assert source["sha256"] == SOURCE_SHA
    assert prepare_form(load_blueprint("058u"), source, RAW / f"{EO_NUMBER}.ocr.json") == schema()
