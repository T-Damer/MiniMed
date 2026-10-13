"""The reviewed OCR text of the oseltamivir instruction (``content/grls-reviewed-ocr``).

The scan has no text layer; the committed Markdown was re-read against it page by page (DQ1,
2026-10-13). These checks keep the structure a doctor relies on: the sections of an official
instruction, the dose tables, a source span per page, and no residue of the red ГРЛС stamp.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
DIRECTORY = ROOT / "content" / "grls-reviewed-ocr"
DOCUMENT_ID = "drug.rf.b9f41580e1cecf8dc2e7.instruction"
TEXT = (DIRECTORY / f"{DOCUMENT_ID}.md").read_text(encoding="utf-8")
FRONT_TEXT, BODY = TEXT.removeprefix("---\n").split("\n---\n", 1)
FRONT = yaml.safe_load(FRONT_TEXT)
HEADINGS = [line.lstrip("#").strip() for line in BODY.splitlines() if line.startswith("#")]

REQUIRED_SECTIONS = (
    "Состав",
    "Описание",
    "Фармакологические свойства",
    "Показания к применению",
    "Противопоказания",
    "С осторожностью",
    "Применение при беременности и в период грудного вскармливания",
    "Способ применения и дозы",
    "Побочное действие",
    "Передозировка",
    "Взаимодействие с другими лекарственными средствами",
    "Особые указания",
    "Влияние на способность управлять транспортными средствами, механизмами",
    "Форма выпуска",
    "Срок годности",
    "Условия хранения",
    "Условия отпуска",
)


def test_front_matter_names_the_source_pdf_and_the_review() -> None:
    assert FRONT["id"] == DOCUMENT_ID
    assert FRONT["source_type"] == "official_drug_instruction"
    sources = yaml.safe_load((ROOT / "content" / "grls-ocr-instructions.yaml").read_text("utf-8"))
    entry = next(
        item for item in sources["sources"] if item["id"] == "drug.rf.oseltamivir.instruction"
    )
    assert FRONT["source_checksum"] == entry["metadata"]["sourceChecksum"]
    metadata = FRONT["metadata"]
    assert metadata["ocrReviewed"] is True
    assert metadata["ocrReview"]["remainingDoubts"]
    assert metadata["registrationNumber"] == "ЛП-№(002417)-(РГ-RU)"


def test_the_instruction_has_every_required_section_once_in_order() -> None:
    positions: list[int] = []
    for name in REQUIRED_SECTIONS:
        assert HEADINGS.count(name) == 1, name
        positions.append(HEADINGS.index(name))
    assert positions == sorted(positions)


def test_dose_tables_carry_the_documented_numbers() -> None:
    treatment = "| ≤ 15 кг | 30 мг два раза в сутки |"
    assert treatment in BODY
    assert "| > 15-23 кг | 45 мг два раза в сутки |" in BODY
    assert "| > 23-40 кг | 60 мг два раза в сутки |" in BODY
    assert "| > 23-40 кг | 60 мг 1 раз в сутки |" in BODY
    assert "| ≤ 15 кг | 30 мг | 2 мл |" in BODY
    assert "| > 23-40 кг | 2 капсулы 30 мг 2 раза/сут | 2 капсулы 30 мг 1 раз/сут |" in BODY
    assert "Препарат назначают в дозе 75 мг" in BODY
    assert "по 30 мг каждые 5 дней" in BODY
    assert "по 30 мг каждые 7 дней" in BODY


def test_every_table_row_has_the_columns_of_its_header() -> None:
    tables = 0
    block: list[str] = []
    for line in [*BODY.splitlines(), ""]:
        if line.startswith("|"):
            block.append(line)
            continue
        if block:
            tables += 1
            widths = {len(row.strip().strip("|").split("|")) for row in block}
            assert len(widths) == 1, block[0]
            assert re.fullmatch(r"\|(?: --- \|)+", block[1]), block[0]
            block = []
    assert tables == 9


def test_adverse_reaction_tables_have_every_organ_class_row() -> None:
    first = [line for line in BODY.splitlines() if line.startswith("| Нарушения со стороны")]
    assert len(first) == 13
    assert "| Инфекции и инвазии |  | Средний отит |  |  |" in BODY
    assert "Фульминантный гепатит, печеночная недостаточность, гепатит" in BODY


def test_every_page_has_a_source_span_and_none_is_beyond_the_scan() -> None:
    pages = [
        json.loads(match)["page"]
        for match in re.findall(r"<!-- localmed:source (\{.*?\}) -->", BODY)
    ]
    assert sorted(set(pages)) == list(range(1, 30))
    assert pages == sorted(pages)


def test_no_stamp_residue_or_ocr_noise_in_the_body() -> None:
    stamp = "СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ"
    assert BODY.count(stamp) == 1
    assert "[?]" not in BODY
    for noise in ("ЗДОВАТЕЛЬ", "ПОСЛЕДОВАТЕЛЬНОСТЬ СО", "N3.96", "Nº", "ІІ", "акк рано"):
        assert noise not in BODY, noise
    mixed = [
        word
        for word in re.findall(r"[A-Za-zА-Яа-яЁё]{3,}", BODY)
        if re.search(r"[A-Za-z]", word) and re.search(r"[А-Яа-яЁё]", word)
    ]
    assert mixed == []


def test_contact_details_of_the_holder_are_verbatim() -> None:
    assert "Тел.: +79874599991, +79874599992" in BODY
    assert "Тел.: +79874599993, +79874599994" in BODY
    assert "E-mail: ozon@ozon-pharm.ru" in BODY
    assert "E-mail: ozonpharm@ozon-pharm.ru" in BODY


def test_the_review_log_is_valid_and_names_the_pdf() -> None:
    log = json.loads((DIRECTORY / f"{DOCUMENT_ID}.review.json").read_text("utf-8"))
    assert log["documentId"] == DOCUMENT_ID
    assert log["source"]["pdfSha256"] == FRONT["metadata"]["pdfSha256"]
    assert log["source"]["textLayer"] is False
    assert len(log["corrections"]) > 20
    assert log["notDone"]
