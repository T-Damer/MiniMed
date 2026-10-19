from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pymupdf
import pytest
import yaml

from localmed_ingest.herbal_ema import EmaExtraction, normalize, validate_ema_extraction
from localmed_ingest.herbal_plants import load_plants
from localmed_ingest.herbal_prepare import (
    action_chips,
    gf15_paragraphs,
    instruction_sections,
    parse_brew,
)
from localmed_ingest.herbal_sources import select_ema_documents


def _pdf(path: Path, pages: list[str]) -> Path:
    document: Any = pymupdf.open()
    for text in pages:
        page = document.new_page()
        page.insert_text((72, 72), text, fontsize=10)
    document.save(path)
    document.close()
    return path


def _extraction(facts: list[dict[str, object]]) -> EmaExtraction:
    return EmaExtraction.model_validate({"plant": "demo", "useType": "traditional", "facts": facts})


def test_normalize_joins_hyphen_breaks_and_dashes() -> None:
    assert normalize("anti-\ninflammatory  1.5–4 g") == "antiinflammatory 1.54 g"
    assert normalize("Quincke’s") == normalize("Quincke's")


def test_quote_must_be_on_its_page_and_carry_every_number(tmp_path: Path) -> None:
    pdf = _pdf(
        tmp_path / "monograph.pdf",
        [
            "Single dose: 1.5-4 g in 150 ml of boiling water",
            "No case of overdose has been reported.",
        ],
    )
    good = _extraction(
        [
            {
                "kind": "posology",
                "ru": "Настой: 1,5–4 г на 150 мл",
                "doc": "monograph",
                "page": 1,
                "quote": "Single dose: 1.5-4 g in 150 ml of boiling water",
                "dose": {
                    "preparationRu": "настой",
                    "amount": "1.5-4",
                    "unit": "г",
                    "waterMl": "150",
                    "populationRu": "взрослые",
                },
            }
        ]
    )
    assert validate_ema_extraction(good, {"monograph": pdf}) == []

    wrong_page = _extraction(
        [
            {
                "kind": "overdose",
                "ru": "Передозировки не описано",
                "doc": "monograph",
                "page": 1,
                "quote": "No case of overdose has been reported.",
            }
        ]
    )
    assert any(
        "not found" in problem
        for problem in validate_ema_extraction(wrong_page, {"monograph": pdf})
    )

    invented_number = _extraction(
        [
            {
                "kind": "posology",
                "ru": "Настой 3 раза в день",
                "doc": "monograph",
                "page": 1,
                "quote": "Single dose: 1.5-4 g in 150 ml of boiling water",
            }
        ]
    )
    problems = validate_ema_extraction(invented_number, {"monograph": pdf})
    assert problems == ["fact 0 (posology): numbers ['3'] are not in the quote"]
    assert validate_ema_extraction(good, {}) == ["fact 0 (posology): no downloaded EMA monograph"]


def _instruction(tmp_path: Path, lines: list[str]) -> Path:
    body: list[str] = []
    for index, line in enumerate(lines):
        marker = {"bbox": [0, 0, 1, 1], "block": f"p1-b{index}", "kind": "paragraph", "page": 1}
        body.append(f"<!-- localmed:source {json.dumps(marker)} -->")
        body.append(line)
        body.append("")
    path = tmp_path / "instruction.md"
    path.write_text("---\nid: x\n---\n\n" + "\n".join(body), encoding="utf-8")
    return path


def test_instruction_sections_join_lines_and_split_inline_headings(tmp_path: Path) -> None:
    path = _instruction(
        tmp_path,
        [
            "# ИНСТРУКЦИЯ",
            "Регистрационный номер",
            "Торговое наименование. Ромашки цветки.",
            "Фармакологическое действие.",
            "Настой оказывает противовоспалительное и спаз-",
            "молитическое действие.",
            "# Способ применения и дозы",
            "Около 8-10 г (2-3 столовые ложки) цветков помещают в посуду, заливают 200 мл",
            "(1 стакан) горячей кипяченой воды и нагревают на кипящей водяной бане 15 минут,",
            "охлаждают 45 минут. Настой принимают по 1/2 стакана 2-3 раза в день. Курс лечения",
            "3-4 недели.",
            "Противопоказания. Повышенная чувствительность.",
        ],
    )
    sections = instruction_sections(path)
    assert [paragraph.text for paragraph in sections["trade-name"]] == ["Ромашки цветки."]
    assert [paragraph.text for paragraph in sections["action"]] == [
        "Настой оказывает противовоспалительное и спазмолитическое действие."
    ]
    assert sections["contraindications"][0].text == "Повышенная чувствительность."
    assert len(sections["dosage"]) == 1
    assert sections["dosage"][0].pages == [1]
    assert len(sections["dosage"][0].blocks) == 4
    assert action_chips(sections) == ["противовоспалительное", "спазмолитическое"]

    brew = parse_brew(sections["dosage"])
    assert brew["kind"] == "настой"
    values = {
        key: cast("dict[str, str]", value)["value"]
        for key, value in brew.items()
        if isinstance(value, dict)
    }
    assert values == {
        "herb": "8–10 г",
        "water": "200 мл",
        "heat": "15 мин",
        "steep": "45 мин",
        "times": "2–3 раза в день",
        "dose": "по 1/2 стакана 2-3 раза в день",
        "course": "3–4 недели",
    }
    herb = brew["herb"]
    assert isinstance(herb, dict) and "заливают 200 мл" in herb["quote"]


def test_gf15_paragraphs_read_the_article_html(tmp_path: Path) -> None:
    page = tmp_path / "page.html"
    page.write_text(
        '<p class="MsoNormal projlink" style="x"><b>Настои</b> и&nbsp;отвары</p>'
        '<p class="MsoNormal">Срок годности – не более 2 сут.</p><p>menu</p>',
        encoding="utf-8",
    )
    assert gf15_paragraphs(page) == ["Настои и отвары", "Срок годности – не более 2 сут."]


def test_ema_selection_prefers_final_monograph_over_draft() -> None:
    page = (
        '<a href="/en/documents/herbal-monograph/draft-european-union-herbal-monograph-x-'
        'revision-1_en.pdf">'
        '<a href="/en/documents/herbal-monograph/final-european-union-herbal-monograph-x_en.pdf">'
        '<a href="/en/documents/herbal-report/assessment-report-x_en.pdf">'
        '<a href="/en/documents/herbal-summary/x-summary-public_en.pdf">'
    )
    selected = select_ema_documents(page)
    assert selected["monograph"].endswith("final-european-union-herbal-monograph-x_en.pdf")
    assert selected["assessment-report"].endswith("assessment-report-x_en.pdf")
    assert selected["summary"].endswith("x-summary-public_en.pdf")


def test_plant_list_rejects_a_shared_grls_name(tmp_path: Path) -> None:
    plant = {
        "ru": "Ромашка",
        "latin": "Matricaria chamomilla L.",
        "family": "Asteraceae",
        "part": {"ru": "цветки", "la": "flos"},
        "grls": {"inn": ["ромашки цветки"]},
        "plate": {"book": "kohler", "file": "File:x.jpg"},
    }
    path = tmp_path / "plants.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "schemaVersion": 1,
                "plants": [
                    {
                        **plant,
                        "id": "a",
                        "ema": {"page": "https://www.ema.europa.eu/en/medicines/herbal/a"},
                    },
                    {
                        **plant,
                        "id": "b",
                        "ema": {"page": "https://www.ema.europa.eu/en/medicines/herbal/b"},
                    },
                ],
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="already belongs to a"):
        load_plants(path)
