"""Form 057/у «Направление для оказания медицинской помощи» (order 519н of 02.09.2025)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_057u import BLUEPRINT
from localmed_ingest.medical_forms import load_blueprint, prepare_form

REPO = Path(__file__).resolve().parents[3]
SCHEMA = REPO / "apps/app/src/features/forms/schemas/ru-minzdrav-519n-057u.json"
RAW = REPO / "data/raw/medical-forms"
EO = "0001202510160032"
SHA = "b9f956c78c023e26275ec1583c8dde85e475d817ecafb23bc818168725077f20"


def schema() -> dict[str, Any]:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def test_the_blueprint_is_discovered_by_its_key() -> None:
    assert load_blueprint("057u") is BLUEPRINT


def test_the_schema_is_tied_to_the_official_order() -> None:
    form = schema()
    source = form["source"]
    assert form["id"] == "ru.minzdrav.519n.057u" and form["formNumber"] == "057/у"
    assert source["orderNumber"] == "519н" and source["orderDate"] == "2025-09-02"
    assert source["registration"] == {
        "authority": "Министерство юстиции Российской Федерации",
        "number": "83857",
        "date": "2025-10-16",
    }
    assert source["sha256"] == SHA
    assert source["publicationUrl"].endswith(EO)
    assert source["blankAppendix"] == {"number": 1, "pdfPages": [2]}
    assert source["rulesAppendix"] == {"number": 2, "pdfPages": [3, 4, 5]}


def test_the_order_names_no_start_date_so_the_basis_is_stated_not_invented() -> None:
    form = schema()
    assert "effectiveUntil" not in form["source"]
    assert form["source"]["effectiveFrom"] == "2025-10-27"
    assert "срок вступления в силу приказом не установлен" in form["edition"]
    assert any("27.10.2025" in note and "10 дней" in note for note in form["notes"])


def test_rule_statuses_follow_the_order_and_nothing_is_invented() -> None:
    fields = {field["id"]: field for field in schema()["fields"]}
    assert fields["localityType"]["rule"]["status"] == "undefined"
    assert fields["localityType"]["rule"]["paragraphIds"] == []
    # the destination line is governed by the paragraph that misattributes it to the header
    assert fields["destinationOrganization"]["rule"]["status"] == "by-line"
    assert fields["referrerName"]["rule"]["paragraphIds"] == ["9.9"]
    assert fields["stamp"]["rule"]["paragraphIds"] == ["10"]
    # the answers are underlined on paper (п. 6)
    for field_id in ("patientSex", "employment", "careForm", "careKind", "careConditions"):
        assert "6" in fields[field_id]["rule"]["paragraphIds"]
    undefined = [f["id"] for f in fields.values() if f["rule"]["status"] == "undefined"]
    assert undefined == ["localityType"]


def test_the_cited_paragraphs_carry_the_reviewed_text_of_the_scan() -> None:
    rules = {rule["id"]: rule["text"] for rule in schema()["rules"]}
    # the scan reads «(Основной государственный …»: the OCR dropped the bracket, a reviewed fix
    assert "номер (Основной государственный регистрационный номер индивидуального" in rules["9.2"]
    assert "которые не имеют работы" in rules["9.5"] and "/" not in rules["9.5"]
    assert rules["9.9"].startswith("9.9. В строке «Должность, специальность медицинского")
    assert rules["10"].endswith("наименование медицинской организации.")
    corrections = {(c["pdfPage"], c["to"]) for c in schema()["source"]["extraction"]["corrections"]}
    assert (4, "номер (Основной государственный") in corrections
    assert schema()["source"]["extraction"]["captionsReviewedOnScan"] == [
        "Основной государственный регистрационный номер"
    ]


def test_options_print_with_the_printed_codes_and_mixed_separators() -> None:
    form = schema()
    options = {
        segment["fieldId"]: segment
        for block in form["layout"]["blocks"]
        for column in block["columns"]
        for row in column["rows"]
        for segment in row["segments"]
        if segment["kind"] == "options"
    }
    assert options["careKind"]["separators"] == [", ", ", ", "; "]
    assert all(
        segment.get("mark") == "underline"
        for key, segment in options.items()
        if key != "patientSex"
    )
    kinds = {f["id"]: f for f in form["fields"]}["careKind"]["options"]
    assert [option["value"] for option in kinds] == ["1", "2", "3", "4"]


@pytest.mark.skipif(
    not (RAW / f"{EO}.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
def test_the_committed_schema_matches_a_fresh_build() -> None:
    source = json.loads((RAW / f"{EO}.source.json").read_text(encoding="utf-8"))
    assert prepare_form(BLUEPRINT, source, RAW / f"{EO}.ocr.json") == schema()
