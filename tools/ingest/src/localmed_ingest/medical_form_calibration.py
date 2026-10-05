"""Vertical layout calibration of the printed forms, measured against the official scan.

`medical_form_overlay calibrate` compares the empty print of a form with the scan page and writes
`tools/ingest/medical-form-calibration/<form id>.json`: the line height of the page and the space
above each layout row (mm), so that the printed rows land where the original blank has them. The
preparer (`medical_forms.prepare_form`) merges that file into the schema's layout; a row key that
no longer exists in the blueprint is an error (the calibration is stale and must be re-measured).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final

REPO: Final = Path(__file__).resolve().parents[4]
CALIBRATION_DIR: Final = REPO / "tools/ingest/medical-form-calibration"
GAP_MM: Final = {"none": 0.0, "small": 1.2, "medium": 3.0, "large": 7.0}


class CalibrationError(RuntimeError):
    """The calibration file does not fit the blueprint's layout."""


def calibration_path(form_id: str, directory: Path = CALIBRATION_DIR) -> Path:
    return directory / f"{form_id}.json"


def load_calibration(form_id: str, directory: Path = CALIBRATION_DIR) -> dict[str, Any]:
    path = calibration_path(form_id, directory)
    if not path.exists():
        return {}
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def row_key(block: dict[str, Any], column: int, index: int) -> str:
    return f"{block['id']}/{column}/{index}"


def apply_calibration(layout: dict[str, Any], calibration: dict[str, Any]) -> dict[str, Any]:
    """The layout with the measured line height and row spaces merged in (in place)."""
    if not calibration:
        return layout
    if "lineHeight" in calibration:
        layout["page"]["lineHeight"] = calibration["lineHeight"]
    for name, value in calibration.get("page", {}).items():
        layout["page"][name] = value
    spaces: dict[str, float] = dict(calibration.get("rows", {}))
    for block in layout["blocks"]:
        for column_index, column in enumerate(block["columns"]):
            for index, row in enumerate(column["rows"]):
                key = row_key(block, column_index, index)
                if key in spaces:
                    row["spaceBeforeMm"] = spaces.pop(key)
                    row.pop("gap", None)
    if spaces:
        raise CalibrationError(
            "calibrated rows missing from the layout (re-run the calibration): "
            + ", ".join(sorted(spaces))
        )
    return layout
