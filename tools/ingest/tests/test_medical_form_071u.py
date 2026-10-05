"""Form 071/у «Медицинское заключение трактористов, машинистов, водителей самоходных машин»
(order 395н of 09.06.2022): an order with no filling rules."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_071u import BLUEPRINT
from localmed_ingest.medical_forms import FormSourceError, load_blueprint, prepare_form

REPO = Path(__file__).resolve().parents[3]
SCHEMA = REPO / "apps/app/src/features/forms/schemas/ru-minzdrav-395n-071u.json"
RAW = REPO / "data/raw/medical-forms"
EO = "0001202206210025"
SHA = "1c39c9e8e6280d1733f073524105b3e474336477fa98d197da3cb5c3d1c8022c"


def schema() -> dict[str, Any]:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def test_the_blueprint_is_discovered_by_its_key() -> None:
    assert load_blueprint("071u") is BLUEPRINT


def test_the_schema_is_tied_to_the_official_order() -> None:
    form = schema()
    source = form["source"]
    assert form["id"] == "ru.minzdrav.395n.071u" and form["formNumber"] == "071/у"
    assert source["orderNumber"] == "395н" and source["orderDate"] == "2022-06-09"
    assert source["registration"]["number"] == "68933"
    assert source["registration"]["date"] == "2022-06-21"
    assert source["sha256"] == SHA and source["publicationUrl"].endswith(EO)
    # item 2 of the order: in force from 3 July 2022 until 1 March 2028
    assert source["effectiveFrom"] == "2022-07-03" and source["effectiveUntil"] == "2028-03-01"
    assert source["blankAppendix"] == {"number": 1, "pdfPages": [2, 3]}
    assert "на скане без номера" in form["edition"]


def test_the_order_has_no_filling_rules_so_every_field_is_undefined() -> None:
    form = schema()
    assert "rulesAppendix" not in form["source"]
    for field in form["fields"]:
        rule = field["rule"]
        assert rule["status"] == "undefined" and rule["paragraphIds"] == [], field["id"]
        assert rule["note"], field["id"]
        assert field["type"] not in ("signature", "stamp") or "prefill" not in field
    # nothing is required on the order's say-so: only the editorial minimum
    for field in form["fields"]:
        if field["required"]:
            assert field["requiredBasis"] == "editorial", field["id"]


def test_the_two_clauses_of_the_order_are_the_schema_paragraphs() -> None:
    rules = {rule["id"]: rule for rule in schema()["rules"]}
    assert set(rules) == {"1", "2"}
    assert rules["1"]["text"].startswith("1. Утвердить форму медицинского заключения о наличии")
    assert rules["1"]["text"].endswith("самоходными машинами согласно приложению.")
    assert rules["2"]["text"] == (
        "2. Настоящий приказ вступает в силу с 3 июля 2022 г. и действует до 1 марта 2028 г."
    )
    for rule in rules.values():
        assert rule["spans"][0]["pdfPage"] == 1
        assert rule["textSha256"] == hashlib.sha256(rule["text"].encode("utf-8")).hexdigest()
    corrections = {c["to"] for c in schema()["source"]["extraction"]["corrections"]}
    assert {"Утвердить", "заключения о наличии"} <= corrections


def test_the_marks_of_the_tables_are_free_text_because_the_order_names_none() -> None:
    by_id = {field["id"]: field for field in schema()["fields"]}
    categories = [key for key in by_id if key.startswith("category")]
    assert len(categories) == 9
    for key in [*categories, "restrictionAIV", "indicationHearing"]:
        assert by_id[key]["type"] == "text" and "options" not in by_id[key]
        assert "не говорит, каким знаком" in by_id[key]["rule"]["note"]


def test_prefill_binds_the_lines_the_blank_prints() -> None:
    bound = {
        key: field["prefill"]["sources"]
        for key, field in ((f["id"], f) for f in schema()["fields"])
        if "prefill" in field
    }
    assert bound["snils"] == ["patient.snils"]
    assert bound["residenceLocality"] == ["patient.address.locality"]
    assert bound["residenceApartment"] == ["patient.address.apartment"]
    assert bound["doctorName"] == ["clinician.fullName"] and bound["formDate"] == ["today"]
    assert "residenceCity" not in bound  # the blank has no «город» line


def test_the_blank_is_two_sheets_and_keeps_the_footnote_of_the_scan() -> None:
    layout = schema()["layout"]
    assert [b["id"] for b in layout["blocks"] if b.get("pageBreakBefore")] == ["categories"]
    footnote = next(b for b in layout["blocks"] if b["id"] == "footnote")
    printed = footnote["columns"][0]["rows"][1]["segments"][0]["text"]
    assert printed.startswith("¹ Постановление Правительства Российской Федерации")
    assert "Собрании законодательства" in printed  # as printed in the order
    assert any("Черновик" in note for note in schema()["notes"])


def test_a_missing_order_clause_fails_the_build(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    ocr.write_text(
        json.dumps(
            {
                "pages": [
                    {"page": 1, "lines": []},
                    {"page": 2, "lines": []},
                    {"page": 3, "lines": []},
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(FormSourceError):
        prepare_form(
            BLUEPRINT,
            {"publicationUrl": "x", "pdfUrl": "y", "retrievedAt": "2026-10-05", "sha256": SHA},
            ocr,
        )


@pytest.mark.skipif(
    not (RAW / f"{EO}.ocr.json").exists(),
    reason="official PDF and its OCR text are private raw data",
)
def test_the_committed_schema_matches_a_fresh_build() -> None:
    source = json.loads((RAW / f"{EO}.source.json").read_text(encoding="utf-8"))
    assert prepare_form(BLUEPRINT, source, RAW / f"{EO}.ocr.json") == schema()
