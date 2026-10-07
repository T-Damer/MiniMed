from __future__ import annotations

import json
from pathlib import Path

import pytest

from localmed_ingest.numbered_headings import numbered_heading_depth

_CASES = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "apps/app/src/features/library/numbered-headings.cases.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", _CASES["accept"], ids=lambda case: case["line"].strip()[:48])
def test_reads_numbered_sub_headings(case: dict[str, object]) -> None:
    assert numbered_heading_depth(str(case["line"])) == case["depth"]


@pytest.mark.parametrize("case", _CASES["reject"], ids=lambda case: case["label"])
def test_leaves_other_numbered_text_alone(case: dict[str, str]) -> None:
    assert numbered_heading_depth(case["line"]) is None


def test_rejects_very_long_lines() -> None:
    assert numbered_heading_depth("3.1 " + "Очень длинный заголовок " * 12) is None
