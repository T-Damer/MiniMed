"""Print layout of the sanatorium cards 072/у and 076/у, fitted to the official scan.

The figures themselves (word offsets, rule recall) are measured by `medical_form_overlay`; these
tests keep the structure that made the print fit: two sheets, explicit printed lines, the two sides
inset to the edges of their scan, continuation lines under the label rules.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_form_calibration import calibration_path, load_calibration
from localmed_ingest.medical_forms import load_blueprint

REPO = Path(__file__).resolve().parents[3]
SCHEMAS = REPO / "apps/app/src/features/forms/schemas"
KEYS = ("072u", "076u")


def layout_of(key: str) -> dict[str, Any]:
    schema = json.loads((SCHEMAS / load_blueprint(key).schema_filename).read_text(encoding="utf-8"))
    return schema["layout"]


def segments(layout: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        segment
        for block in layout["blocks"]
        for column in block["columns"]
        for row in column["rows"]
        for segment in row["segments"]
    ]


@pytest.mark.parametrize("key", KEYS)
def test_the_card_is_one_two_sided_sheet(key: str) -> None:
    blocks = layout_of(key)["blocks"]
    breaks = [block["id"] for block in blocks if block.get("pageBreakBefore")]
    assert breaks == ["clinical"]  # the reverse side starts with the clinical lines


@pytest.mark.parametrize("key", KEYS)
def test_each_side_is_inset_to_the_edges_of_its_scan(key: str) -> None:
    blocks = layout_of(key)["blocks"]
    front, reverse = [], []
    side = front
    for block in blocks:
        if block.get("pageBreakBefore"):
            side = reverse
        side.append(block["insetMm"])
    assert {item["left"] for item in front} == {front[0]["left"]}
    assert {tuple(sorted(item.items())) for item in reverse} == {tuple(sorted(reverse[0].items()))}
    # the front text starts further right than the reverse text (scan margins differ ~4.8 mm)
    assert front[0]["left"] > reverse[0]["left"]


@pytest.mark.parametrize("key", KEYS)
def test_the_header_is_two_flush_columns_of_explicit_lines(key: str) -> None:
    header = layout_of(key)["blocks"][0]
    left, right = header["columns"]
    assert left["widthPercent"] + right["widthPercent"] <= 100
    assert right["align"] == "center"
    # the registration number caption is a justified line followed by «номер», as printed
    texts = [row["segments"][0].get("text") for row in left["rows"]]
    assert texts[4:6] == ["Основной государственный регистрационный", "номер"]
    assert left["rows"][4]["align"] == "stretch"


@pytest.mark.parametrize("key", KEYS)
def test_long_entries_have_a_label_rule_and_ruled_lines_under_it(key: str) -> None:
    layout = layout_of(key)
    ruled = [
        segment
        for segment in segments(layout)
        if segment["kind"] == "field" and segment.get("lines")
    ]
    assert {segment["fieldId"] for segment in ruled} >= {
        "complaints",
        "anamnesis",
        "examinations",
        "additionalInfo",
        "treatmentDone",
        "epicrisis",
        "recommendations",
    }
    assert all(segment.get("pitch") == "text" for segment in ruled)
    rows = [
        row for block in layout["blocks"] for column in block["columns"] for row in column["rows"]
    ]
    for index, row in enumerate(rows):
        first = row["segments"][0]
        if first["kind"] == "field" and first.get("lines"):
            # the line under the label: «label ______» (text + rule) one row above the lines
            above = rows[index - 1]["segments"]
            assert [segment["kind"] for segment in above] == ["text", "rule"]


@pytest.mark.parametrize("key", KEYS)
def test_the_cut_lines_are_dotted_rules(key: str) -> None:
    dotted = [
        segment
        for segment in segments(layout_of(key))
        if segment["kind"] == "rule" and segment.get("lineStyle") == "dotted"
    ]
    assert len(dotted) == 2  # above the return coupon on each side


def test_the_child_card_has_its_own_line_counts() -> None:
    def lines(key: str, field_id: str) -> int:
        for segment in segments(layout_of(key)):
            if segment.get("fieldId") == field_id and segment.get("lines"):
                return int(segment["lines"])
        raise AssertionError(field_id)

    assert (lines("072u", "anamnesis"), lines("076u", "anamnesis")) == (2, 3)
    assert (lines("072u", "epicrisis"), lines("076u", "epicrisis")) == (3, 2)
    assert (lines("072u", "recommendations"), lines("076u", "recommendations")) == (3, 1)
    assert (lines("072u", "examinations"), lines("076u", "examinations")) == (8, 2)


@pytest.mark.parametrize("key", KEYS)
def test_the_calibration_matches_the_layout(key: str) -> None:
    blueprint = load_blueprint(key)
    path = calibration_path(blueprint.form_id)
    assert path.exists()
    calibration = load_calibration(blueprint.form_id)
    assert calibration["page"]["fontSizePt"] == 10.0
    assert calibration["lineHeight"] >= 1.1
    # the preparer merges it into the committed schema: every calibrated row space is in the layout
    layout = layout_of(key)
    spaces = {
        f"{block['id']}/{column_index}/{index}": row.get("spaceBeforeMm")
        for block in layout["blocks"]
        for column_index, column in enumerate(block["columns"])
        for index, row in enumerate(column["rows"])
    }
    for row_key, value in calibration["rows"].items():
        assert spaces[row_key] == value
