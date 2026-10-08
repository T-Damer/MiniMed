from __future__ import annotations

import json
from pathlib import Path

import pytest

from localmed_ingest.numbered_headings import appendix_heading_depth, numbered_heading_depth

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


@pytest.mark.parametrize(
    "line",
    [
        "Приложение Б1. Алгоритм диагностики эозинофильного эзофагита [1]",
        "Приложение А2.1 – Шкала оценки уровней достоверности доказательств (УДД) для методов",
        "Приложение А3-1. Параметры нефрометрических шкал RENAL и PADUA [11, 12]",
        "Приложение Б 2. Алгоритм биологической терапии маниакальных состояний",
        "Приложение 3. Стадии полового развития по шкале Tanner.",
        "Приложение Г1 Унифицированная шкала оценки болезни Паркинсона",
        "ПриложениеА2.1–Шкала оценки уровней достоверности доказательств",
        "Приложение Г3. ШКАЛА NRS 2002",
    ],
)
def test_reads_appendix_sub_titles(line: str) -> None:
    assert appendix_heading_depth(line) == 2


@pytest.mark.parametrize(
    "line",
    [
        "Приложение Г1",
        "Приложение Г2.",
        "ПРИЛОЖЕНИЕ",
        "Приложение № 2 к классификациям и критериям, используемым при осуществлении экспертизы",
        "Приложение к приказу об организации оказания паллиативной медицинской помощи",
        "Приложение А3 содержит алгоритм обследования пациента.",
        "Приложение Б1. Алгоритм диагностики; ",
        "Приложение А2. Содержание ........ 41",
        "Согласно приложению Б1. Алгоритм",
    ],
)
def test_leaves_appendix_references_and_labels_alone(line: str) -> None:
    assert appendix_heading_depth(line) is None
