"""Form 079/у: the print layout is fitted to the two sheets of the official scan (F3)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from localmed_ingest.medical_form_079u import BLUEPRINT, FIELDS
from localmed_ingest.medical_form_calibration import load_calibration

REPO = Path(__file__).resolve().parents[3]
SCHEMA = REPO / "apps/app/src/features/forms/schemas/ru-minzdrav-274n-079u.json"


def schema() -> dict[str, Any]:
    return json.loads(SCHEMA.read_text(encoding="utf-8"))


def segments(form: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        segment
        for block in form["layout"]["blocks"]
        for column in block["columns"]
        for row in column["rows"]
        for segment in row["segments"]
    ]


def test_the_blank_stays_two_sheets_with_the_reverse_side_on_a_new_page() -> None:
    blocks = schema()["layout"]["blocks"]
    assert [block.get("pageBreakBefore", False) for block in blocks] == [False] * 3 + [True]
    assert schema()["source"]["blankAppendix"]["pdfPages"] == [54, 55]


def test_the_two_sheets_keep_the_side_margins_of_their_own_scan() -> None:
    blocks = {block["id"]: block for block in schema()["layout"]["blocks"]}
    # sheet 1 sits 4.6 mm further right on its scan than sheet 2; sheet 2 ends 4.4 mm earlier
    assert blocks["child"]["insetMm"]["left"] == 4.6
    assert "left" not in blocks["back"].get("insetMm", {})
    assert blocks["back"]["insetMm"]["right"] == 4.4


def test_the_calibration_is_merged_into_the_schema() -> None:
    form = schema()
    calibration = load_calibration(form["id"])
    assert calibration["page"]["fontSizePt"] == form["layout"]["page"]["fontSizePt"]
    assert form["layout"]["page"]["lineHeight"] == calibration["lineHeight"]
    spaced = sum(
        1
        for block in form["layout"]["blocks"]
        for column in block["columns"]
        for row in column["rows"]
        if "spaceBeforeMm" in row
    )
    assert spaced >= len(calibration["rows"])


def test_every_field_of_the_blueprint_is_still_printed_on_the_blank() -> None:
    printed = {segment["fieldId"] for segment in segments(schema()) if "fieldId" in segment}
    assert {field["id"] for field in FIELDS} <= printed
    assert {field["id"] for field in schema()["fields"]} == {field["id"] for field in FIELDS}


def test_the_header_is_set_in_the_small_print_of_the_scan() -> None:
    header = schema()["layout"]["blocks"][0]
    sizes = {row.get("size") for column in header["columns"] for row in column["rows"]}
    assert "caption" in sizes
    assert BLUEPRINT.layout["blocks"][0]["id"] == "header"


def test_the_birth_date_prints_the_whole_year_as_the_scan_has_no_century() -> None:
    parts = [
        segment.get("part")
        for segment in segments(schema())
        if segment.get("fieldId") == "patientBirthDate"
    ]
    assert parts == ["day", "month", "year"]
