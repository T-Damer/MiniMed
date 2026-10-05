"""Form 003-В/у «Медицинское заключение водителя» (order 1092н of 24.11.2021)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_003_vu import BLUEPRINT
from localmed_ingest.medical_forms import load_blueprint, prepare_form

REPO = Path(__file__).resolve().parents[3]
SCHEMA = REPO / "apps/app/src/features/forms/schemas/ru-minzdrav-1092n-003-vu.json"
RAW = REPO / "data/raw/medical-forms"
EO = "0001202111300131"
SHA = "63fd77663077cbf993f49eb093c2a19fd73b86515ecfa893ce1a5a5332244abc"


def schema() -> dict[str, Any]:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def fields() -> dict[str, dict[str, Any]]:
    return {field["id"]: field for field in schema()["fields"]}


def test_the_blueprint_is_discovered_by_its_key() -> None:
    assert load_blueprint("003-vu") is BLUEPRINT


def test_the_schema_is_tied_to_the_official_order() -> None:
    form = schema()
    source = form["source"]
    assert form["id"] == "ru.minzdrav.1092n.003-vu" and form["formNumber"] == "003-В/у"
    assert source["orderNumber"] == "1092н" and source["orderDate"] == "2021-11-24"
    assert source["registration"]["number"] == "66130"
    assert source["registration"]["date"] == "2021-11-30"
    assert source["sha256"] == SHA and source["publicationUrl"].endswith(EO)
    # item 5 of the order: item 1 (the appendices) is in force from 1 March 2022 to 1 March 2028
    assert source["effectiveFrom"] == "2022-03-01" and source["effectiveUntil"] == "2028-03-01"
    # the blank is appendix 3 (two PDF pages for one printed sheet), the rules are appendix 2
    assert source["blankAppendix"] == {"number": 3, "pdfPages": [15, 16]}
    assert source["rulesAppendix"] == {"number": 2, "pdfPages": [11, 12, 13, 14]}


def test_the_sub_items_of_item_6_are_cited_with_their_printed_designation() -> None:
    rules = {rule["id"]: rule for rule in schema()["rules"]}
    for number in range(1, 12):
        rule = rules[f"6.{number}"]
        assert rule["clause"] == f"6, подпункт {number}"
        assert rule["text"].startswith(f"{number}) в ")
        assert rule["appendix"]["number"] == 2
    assert rules["6.8"]["text"].endswith("дорожного движения»;")
    # the reviewed fixes of the scan: footnote mark, capitals, the format mask, the dash
    assert "«xx xxxxxxxxx», где «x» – цифра от 0 до 9" in rules["3"]["text"]
    assert rules["3"]["text"].count("год.") == 1
    assert "фамилия, имя, отчество (при наличии) врача-специалиста" in rules["6.5"]["text"]
    assert rules["5"]["text"].endswith("порядке.")
    for rule in rules.values():
        assert rule["textSha256"] == hashlib.sha256(rule["text"].encode("utf-8")).hexdigest()


def test_every_rule_status_is_honest_and_nothing_is_invented() -> None:
    form = schema()
    ids = {rule["id"] for rule in form["rules"]}
    for field in form["fields"]:
        rule = field["rule"]
        assert rule["status"] in ("defined", "by-line"), field["id"]
        assert rule["paragraphIds"] and set(rule["paragraphIds"]) <= ids, field["id"]
        assert field["type"] not in ("signature", "stamp") or "prefill" not in field
    # the parts of line 3 are not named by the order: the printed line is governed
    parts = [key for key in fields() if key.startswith("residence")]
    assert len(parts) == 10
    assert {fields()[key]["rule"]["status"] for key in parts} == {"by-line"}
    assert fields()["certSeries"]["pattern"] == "^[0-9]{2}$"
    assert fields()["certNumber"]["pattern"] == "^[0-9]{9}$"


def test_the_tables_hold_the_marks_the_order_prescribes() -> None:
    by_id = fields()
    categories = [key for key in by_id if key.startswith("category")]
    assert len(categories) == 16
    for key in categories:
        assert [o["value"] for o in by_id[key]["options"]] == ["V", "Z"]
        assert by_id[key]["required"] is True
    for key in ("restrictionMotorcycle", "restrictionCar", "restrictionHeavy"):
        assert [o["value"] for o in by_id[key]["options"]] == ["V"] and not by_id[key]["required"]
        assert by_id[key]["rule"]["paragraphIds"] == ["6.9"]
    indications = [key for key in by_id if key.startswith("indication") and key != "indications"]
    assert len(indications) == 5 and all(
        by_id[k]["rule"]["paragraphIds"] == ["6.10"] for k in indications
    )
    assert by_id["contraindications"]["rule"]["paragraphIds"] == ["4", "6.6"]


def test_prefill_binds_only_data_the_blank_prints_and_the_app_stores() -> None:
    bound = {
        key: field["prefill"]["sources"] for key, field in fields().items() if "prefill" in field
    }
    assert bound["patientFullName"] == ["patient.fullName"]
    assert bound["residenceLocality"] == ["patient.address.locality"]
    assert bound["orgAddress"] == ["organization.address"]
    assert bound["doctorName"] == ["clinician.fullName"]
    assert bound["formDate"] == ["today"]
    # no identity document, no stay address, nothing for the paper signatures
    assert not any("stayAddress" in source for sources in bound.values() for source in sources)
    assert "stamp" not in bound and "residenceCity" not in bound


def test_the_notes_say_the_print_is_a_draft_and_why() -> None:
    notes = " ".join(schema()["notes"])
    assert "Черновик" in notes and "защищенная от подделок" in notes and "№ 217н" in notes
    assert "один печатный лист" in notes


def test_the_blank_prints_on_one_sheet_in_the_order_of_the_official_page() -> None:
    layout = schema()["layout"]
    assert layout["page"]["orientation"] == "portrait"
    assert not any(block.get("pageBreakBefore") for block in layout["blocks"])
    assert [block["id"] for block in layout["blocks"]] == [
        "header",
        "title",
        "identity",
        "findings",
        "categories",
        "signature",
    ]


@pytest.mark.skipif(
    not (RAW / f"{EO}.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
def test_the_committed_schema_matches_a_fresh_build() -> None:
    source = json.loads((RAW / f"{EO}.source.json").read_text(encoding="utf-8"))
    assert prepare_form(BLUEPRINT, source, RAW / f"{EO}.ocr.json") == schema()
