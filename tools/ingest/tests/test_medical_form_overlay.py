"""Layout-fidelity overlay (docs/FORMS_PLAN.md «Layout fidelity»): metrics, rules, calibration."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest import medical_form_overlay as overlay
from localmed_ingest.medical_form_calibration import (
    CalibrationError,
    apply_calibration,
    row_key,
)

REPO = Path(__file__).resolve().parents[3]
RESULTS = REPO / "tools/ingest/medical-form-overlay-results.json"
REGISTRY = REPO / "tools/ingest/medical-form-sources.json"


def word(
    text: str, x: float, y: float, *, frag: int = 0, seq: int = 0, edge: str = ""
) -> overlay.Word:
    return overlay.Word(overlay.normalise_word(text), x, y - 1.5, x + 10, y + 1.5, frag, edge, seq)


def test_normalise_word_folds_look_alikes_case_and_punctuation() -> None:
    assert overlay.normalise_word("«Пол:»") == "пол"
    assert overlay.normalise_word("Ёлка") == "елка"
    # Latin letters the OCR takes for Cyrillic ones of the same shape
    assert overlay.normalise_word("Cтраховой") == overlay.normalise_word("Страховой")
    assert overlay.normalise_word("№") == ""
    assert overlay.normalise_word("Nº") == ""


def test_scan_words_share_the_fragment_box_by_characters() -> None:
    page = {"lines": [{"text": "ab cdef", "bbox": [0.1, 0.8, 0.5, 0.02]}]}
    first, second = overlay.scan_words(page, 200.0, 300.0)
    assert first.edge == "first" and second.edge == "last"
    assert first.x0 == pytest.approx(20.0)
    assert second.x1 == pytest.approx(120.0)
    assert first.cy == pytest.approx((1 - 0.81) * 300)


def test_match_words_pairs_columns_that_interleave_differently() -> None:
    # scan: left row, right row, left row; print: both left rows, then the right column
    scan = [
        word("альфа", 20, 40, frag=0),
        word("медицинская", 150, 44, frag=1),
        word("бета", 20, 47, frag=2),
    ]
    printed = [
        word("альфа", 20, 12, frag=0, seq=0),
        word("бета", 20, 16, frag=1, seq=1),
        word("медицинская", 150, 12, frag=0, seq=2),
    ]
    pairs = overlay.match_words(scan, printed)
    assert {(s.norm, p.norm) for s, p in pairs} == {
        ("альфа", "альфа"),
        ("бета", "бета"),
        ("медицинская", "медицинская"),
    }


def test_align_page_removes_the_appendix_header_offset() -> None:
    scan = [
        word("Приложение", 120, 12),
        word("Наименование", 20, 40, frag=1, edge="first"),
        word("адрес", 50, 40, frag=1),
    ]
    printed = [
        word("Наименование", 15, 12, seq=0, edge="first"),
        word("адрес", 45, 12, seq=1),
    ]
    pairs, offset, form_top = overlay.align_page(scan, printed)
    assert len(pairs) == 2
    assert offset == pytest.approx(28.0)
    assert form_top == pytest.approx(40 - 1.5 - 2.0)
    metrics = overlay.text_metrics(scan, printed)
    assert metrics.appendix_header_mm == pytest.approx(28.0)
    assert max(abs(v) for v in metrics.dy) < 0.01


def test_line_agreement_flags_a_line_the_scan_breaks_elsewhere() -> None:
    scan = [
        word("один", 20, 40, frag=0),
        word("два", 40, 40, frag=0),
        word("три", 20, 46, frag=1),
    ]
    printed = [
        word("один", 20, 40, frag=0, seq=0),
        word("два", 40, 46, frag=1, seq=1),
        word("три", 20, 52, frag=2, seq=2),
    ]
    metrics = overlay.text_metrics(scan, printed)
    assert metrics.line_agreement < 1.0
    assert metrics.line_issues


def dark_line(width: int, height: int, y: int, x0: int, x1: int) -> bytes:
    pixels = bytearray(b"\xff" * (width * height))
    for x in range(x0, x1):
        pixels[y * width + x] = 0
    return bytes(pixels)


def test_find_rules_detects_a_long_stroke_and_ignores_short_marks() -> None:
    width, height, dpi = 300, 200, 150
    horizontal, vertical = overlay.find_rules(
        width, height, dark_line(width, height, 80, 20, 200), dpi
    )
    assert len(overlay.merge_rules(horizontal)) == 1
    rule = overlay.merge_rules(horizontal)[0]
    assert rule.a1 - rule.a0 == pytest.approx(180 * 25.4 / dpi, abs=0.5)
    assert rule.at == pytest.approx(80 * 25.4 / dpi, abs=0.3)
    assert vertical == []
    short, _ = overlay.find_rules(width, height, dark_line(width, height, 80, 20, 30), dpi)
    assert short == []


def test_match_rules_applies_the_page_offset_and_counts_misses() -> None:
    scan = [overlay.Rule(20, 120, 60.0), overlay.Rule(20, 60, 90.0)]
    printed = [overlay.Rule(22, 118, 33.0)]
    metrics = overlay.match_rules(scan, printed, 26.0)
    assert metrics.matched_scan == 1 and metrics.printed == 1
    assert metrics.dy[0] == pytest.approx(1.0)
    assert metrics.scan == 2


def test_inside_drops_scanner_border_and_strokes_above_the_form() -> None:
    rules = [
        overlay.Rule(10, 200, 0.7),
        overlay.Rule(10, 200, 20.0),
        overlay.Rule(10, 200, 100.0),
        overlay.Rule(10, 200, 296.5),
    ]
    kept = overlay._inside(rules, 210.0, 297.0, 40.0, True)
    assert [rule.at for rule in kept] == [100.0]


def summary(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "sheet": {"scanPages": 1, "printPages": 1, "paperDeviationMm": 1.0},
        "text": {
            "wordCoverage": 0.95,
            "medianDyMm": 0.5,
            "p90DyMm": 2.0,
            "maxDyMm": 4.0,
            "medianLeftMm": 1.0,
            "fontScale": 1.0,
            "lineAgreement": 0.9,
        },
        "rules": {"recall": 0.9, "medianDyMm": 0.5, "medianEndMm": 1.0},
    }
    for path, value in changes.items():
        group, name = path.split("__")
        base[group][name] = value
    return base


def test_violations_name_every_figure_outside_the_standard() -> None:
    assert overlay.violations(summary()) == []
    found = overlay.violations(
        summary(sheet__printPages=2, text__medianDyMm=3.0, text__fontScale=1.2, rules__recall=0.5)
    )
    assert any("sheets" in item for item in found)
    assert any("median vertical" in item for item in found)
    assert any("font scale" in item for item in found)
    assert any("rules found" in item for item in found)


def layout() -> dict[str, Any]:
    return {
        "page": {"size": "A4", "orientation": "portrait", "marginMm": {}, "fontSizePt": 10},
        "blocks": [
            {
                "id": "head",
                "columns": [{"widthPercent": 100, "rows": [{"segments": []}, {"gap": "small"}]}],
            }
        ],
    }


def test_calibration_merges_spaces_and_page_and_drops_the_gap() -> None:
    merged = apply_calibration(
        layout(),
        {
            "lineHeight": 1.15,
            "page": {"fontSizePt": 10.5},
            "rows": {row_key({"id": "head"}, 0, 1): 2.4},
        },
    )
    assert merged["page"]["lineHeight"] == 1.15
    assert merged["page"]["fontSizePt"] == 10.5
    row = merged["blocks"][0]["columns"][0]["rows"][1]
    assert row["spaceBeforeMm"] == 2.4
    assert "gap" not in row


def test_a_calibration_for_a_row_the_blueprint_no_longer_has_is_an_error() -> None:
    with pytest.raises(CalibrationError, match="head/0/7"):
        apply_calibration(layout(), {"rows": {"head/0/7": 1.0}})


def test_committed_results_cover_every_registered_form_and_pass_the_standard() -> None:
    """The committed figures of the last overlay run stay inside the tolerances.

    A form not measured yet is listed in `pending` with the reason; a form that cannot meet a
    figure carries `acceptedViolations` (figure prefix -> reason), never a looser tolerance.
    """
    results = json.loads(RESULTS.read_text(encoding="utf-8"))
    assert results["tolerances"] == overlay.TOLERANCES
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    keys = {form["key"] for source in registry["sources"] for form in source["forms"]}
    pending = results.get("pending", {})
    assert set(results["forms"]) | set(pending) == keys
    assert not set(results["forms"]) & set(pending)
    assert all(isinstance(reason, str) and reason for reason in pending.values())
    for key, item in results["forms"].items():
        assert overlay.violations(item) == item["violations"], key
        accepted = item.get("acceptedViolations", {})
        assert all(accepted.values()), f"{key}: an accepted violation needs a reason"
        unexplained = [
            v for v in item["violations"] if not any(v.startswith(prefix) for prefix in accepted)
        ]
        assert unexplained == [], f"{key}: {unexplained}"
