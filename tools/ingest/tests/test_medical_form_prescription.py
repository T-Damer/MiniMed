"""Order 1094н: the preparer's multi-appendix rules and shared scan pages, and the three blanks."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest.medical_forms import (
    FormBlueprint,
    FormSourceError,
    Row,
    RulesSection,
    body_rows,
    prepare_form,
)

SOURCE = {
    "publicationUrl": "http://publication.pravo.gov.ru/document/1",
    "pdfUrl": "http://publication.pravo.gov.ru/file/pdf?eoNumber=1",
    "retrievedAt": "2026-10-05",
    "sha256": "0" * 64,
}


def line(text: str, x: float, y: float, height: float = 0.02) -> dict[str, Any]:
    return {"text": text, "confidence": 1.0, "bbox": [x, y - height / 2, 0.1, height]}


def blueprint(**changes: Any) -> FormBlueprint:
    field: dict[str, Any] = {
        "id": "patient",
        "label": "Фамилия пациента",
        "type": "text",
        "required": False,
        "rule": {"status": "defined", "paragraphIds": ["3.6", "1.6"]},
        "_anchor": "Фамилия пациента",
    }
    base = FormBlueprint(
        form_id="test.rx",
        form_number="000-1/у",
        title="Тест",
        order_number="1н",
        order_date="2025-01-02",
        order_title="Тестовый приказ",
        registration={"authority": "Минюст", "number": "1", "date": "2025-01-03"},
        effective_from="2025-09-01",
        effective_until=None,
        blank_appendix=2,
        blank_pages=(1,),
        rules_appendix=3,
        rules_pages=(2,),
        footnote_below={},
        corrections=(),
        fields=[field],
        code_lists={},
        sequential_lists={},
        sections=[{"id": "s", "title": "S", "fieldIds": ["patient"]}],
        layout={"page": {}, "blocks": []},
        notes=[],
        extra_rules=(RulesSection(1, "Порядок назначения", (3,)),),
        rules_title="Порядок оформления",
    )
    return replace(base, **changes)


def write_ocr(path: Path, pages: list[list[dict[str, Any]]]) -> None:
    path.write_text(
        json.dumps({"pages": [{"page": n + 1, "lines": p} for n, p in enumerate(pages)]}),
        encoding="utf-8",
    )


def test_paragraph_numbers_of_two_appendices_stay_apart(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [
            [line("Фамилия пациента", 0.1, 0.5)],
            [
                line("6. В графе «Фамилия» указываются фамилия и инициалы.", 0.1, 0.9),
                line("7. Другое.", 0.1, 0.88),
            ],
            [
                line("6. Назначение оформляется на имя пациента.", 0.1, 0.9),
                line("7. Запрещается.", 0.1, 0.88),
            ],
        ],
    )
    schema = prepare_form(blueprint(), SOURCE, ocr)
    by_id = {rule["id"]: rule for rule in schema["rules"]}
    assert list(by_id) == ["1.6", "3.6"]
    assert by_id["3.6"]["text"].startswith("6. В графе «Фамилия» указываются")
    assert by_id["3.6"]["clause"] == "6"
    assert by_id["3.6"]["appendix"] == {"number": 3, "title": "Порядок оформления"}
    assert by_id["3.6"]["spans"] == [{"pdfPage": 2, "firstLine": 0, "lastLine": 0}]
    assert by_id["1.6"]["text"] == "6. Назначение оформляется на имя пациента."
    assert by_id["1.6"]["appendix"] == {"number": 1, "title": "Порядок назначения"}
    assert by_id["1.6"]["spans"] == [{"pdfPage": 3, "firstLine": 0, "lastLine": 0}]


def test_single_appendix_blueprints_keep_bare_ids_and_no_appendix(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [[line("Фамилия пациента", 0.1, 0.5)], [line("6. Указывается фамилия.", 0.1, 0.9)], []],
    )
    field = {**blueprint().fields[0], "rule": {"status": "defined", "paragraphIds": ["6"]}}
    schema = prepare_form(blueprint(extra_rules=(), fields=[field]), SOURCE, ocr)
    assert [rule["id"] for rule in schema["rules"]] == ["6"]
    assert "appendix" not in schema["rules"][0]
    assert "clause" not in schema["rules"][0]


def test_a_page_number_printed_low_does_not_join_the_paragraph(tmp_path: Path) -> None:
    rows = [
        Row(7, 0, "2", 0.5, 0.952, 1.0),
        Row(7, 1, "лекарственных препаратов.", 0.1, 0.92, 1.0),
        Row(7, 2, "1. Новый пункт", 0.1, 0.90, 1.0),
    ]
    assert [row.text for row in body_rows(rows)] == ["лекарственных препаратов.", "1. Новый пункт"]
    # a number-like line deep in the page is text, not a page number
    assert [row.text for row in body_rows([Row(7, 0, "10", 0.5, 0.5, 1.0)])] == ["10"]


def test_captions_are_searched_only_in_the_region_of_the_form(tmp_path: Path) -> None:
    ocr = tmp_path / "ocr.json"
    write_ocr(
        ocr,
        [
            [
                line("Оборотная сторона предыдущего бланка", 0.1, 0.9),
                line("Фамилия пациента", 0.1, 0.3),
            ],
            [line("6. Указывается.", 0.1, 0.9)],
            [line("6. Указывается.", 0.1, 0.9)],
        ],
    )
    # caption sits at y=0.3: found in the lower half, absent from the upper one
    prepare_form(blueprint(blank_regions={1: (0.0, 0.5)}), SOURCE, ocr)
    with pytest.raises(FormSourceError, match="printed caption"):
        prepare_form(blueprint(blank_regions={1: (0.5, 1.0)}), SOURCE, ocr)
