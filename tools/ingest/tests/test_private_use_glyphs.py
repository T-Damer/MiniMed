"""Symbol/Wingdings private-use glyphs of PDF text layers (the «tofu» bullets of ГРЛС instructions).

The excerpts are shortened from real ГРЛС instructions (propranolol, hydroxyurea, valproate,
the Gilead interaction tables, the Pfizer injector leaflet); `U+F0B7` and friends are written as
escapes so the file keeps the exact code points of the PDF text layer.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from localmed_ingest.manufacturer_instructions import docx_text
from localmed_ingest.markdown_parser import parse_markdown_document
from localmed_ingest.pdf_import import (
    ExtractionOptions,
    _extract_raw_blocks_from_payload,
    _join_lines,
    _merge_spans,
)
from localmed_ingest.private_use_glyphs import (
    has_private_use,
    repair_markdown_body,
    repair_text,
    translate_span,
    unmapped_private_use,
)


def test_symbol_bullet_at_line_start_is_a_list_item() -> None:
    assert (
        repair_text(" Сохраните листок-вкладыш. Возможно, Вам потребуется прочитать его.")
        == "- Сохраните листок-вкладыш. Возможно, Вам потребуется прочитать его."
    )


def test_symbol_minus_used_as_dash_bullet_is_a_list_item() -> None:
    # Анаприлин Реневал, «Показания к применению»: every item starts with U+F02D.
    assert repair_text(" при артериальной гипертензии;") == "- при артериальной гипертензии;"


@pytest.mark.parametrize(
    "glyph",
    [
        "",  # Wingdings small square
        "",  # Wingdings arrow head
        "",  # Wingdings check mark
        "",  # Wingdings diamond
        "",  # Wingdings black circle
        "",  # Wingdings bullet
        "",  # dash bullet of a Word list
        "",  # Adobe «arrowhorizex», the dash of a Word list
        "",  # glyph of a custom bullet font, unknown to the tables
    ],
)
def test_every_bullet_glyph_opens_a_list_item(glyph: str) -> None:
    assert repair_text(f"{glyph} острые и хронические интоксикации") == (
        "- острые и хронические интоксикации"
    )


def test_custom_font_bullet_inside_a_line_splits_items_too() -> None:
    assert repair_text("Нарушения питания: \ue12c низкое потребление \ue12c потеря массы") == (
        "Нарушения питания:\n- низкое потребление\n- потеря массы"
    )


def test_check_boxes_and_the_alpha_of_a_font_with_its_own_encoding() -> None:
    assert repair_text("пуговиц? \uf07f \uf07f \uf07f") == "пуговиц? \u2610 \u2610 \u2610"
    assert repair_text("ФНО-\uf0e1 (фактор)") == "ФНО-\u03b1 (фактор)"


def test_items_joined_into_one_line_are_split() -> None:
    # The PDF block joined the items with spaces: «...; <bullet> next; <bullet> one more».
    joined = "венозная недостаточность.  Посттромботический синдром.  Трофические язвы."
    assert repair_text(joined) == (
        "венозная недостаточность.\n- Посттромботический синдром.\n- Трофические язвы."
    )


def test_a_lead_in_stays_before_its_items() -> None:
    assert repair_text("В составе:  лактоза  гипромеллоза  крахмал") == (
        "В составе:\n- лактоза\n- гипромеллоза\n- крахмал"
    )


def test_a_private_use_space_after_the_bullet_is_a_space() -> None:
    assert repair_text("в виде 4-х инфузий") == "- в виде 4-х инфузий"
    assert repair_text("терапии);") == "терапии);"


def test_dash_glyph_is_a_dash_inside_a_sentence_and_a_range() -> None:
    assert repair_text("Листок-вкладыш  информация для пациента") == (
        "Листок-вкладыш – информация для пациента"
    )
    assert repair_text("(более 68 раз в сутки)") == "(более 6–8 раз в сутки)"
    assert repair_text("нечасто  метеоризм; часто  сыпь") == ("нечасто – метеоризм; часто – сыпь")


def test_dash_glyph_after_a_sentence_end_opens_an_item() -> None:
    assert repair_text("Фолликулит.  Боль в глазах.  Отек.") == (
        "Фолликулит.\n- Боль в глазах.\n- Отек."
    )


def test_a_paragraph_that_starts_with_a_dash_bullet_keeps_all_of_them() -> None:
    assert repair_text(" утомляемость  учащенное сердцебиение") == (
        "- утомляемость\n- учащенное сердцебиение"
    )


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("не выше 25 С", "не выше 25 °С"),
        ("72.6  31.1", "72.6 ± 31.1"),
        ("( 1/100, 1/10)", "(≥ 1/100, <1/10)"),
        ("КК  50 мл/мин", "КК ≤ 50 мл/мин"),
        ("масса тела [кг]  0,24", "масса тела [кг] × 0,24"),
        ("доза (мг)  3,33 мг/мл", "доза (мг) ÷ 3,33 мг/мл"),
        ("AUC:  71 % Cmax:  49 % ", "AUC: ↓ 71 % Cmax: ↑ 49 % ↔"),
        ("Арифам, таблетки", "Арифам®, таблетки"),
        ("Солиан Тонзилгон Амоксиклав", "Солиан® Тонзилгон® Амоксиклав®"),
        (
            "-токоферол, -адреноблокаторы, -интерферон",
            "α-токоферол, β-адреноблокаторы, γ-интерферон",
        ),
        ("3-гидрокси-", "3′-гидрокси-"),
        ("Анафилактоидные или", "Анафилактоидные* или"),
        ("5 ", "5 %"),
        ("Тел.: ", "Тел.: 8−800".replace("−", "–")),
    ],
)
def test_symbol_glyphs_become_the_character_they_stand_for(source: str, expected: str) -> None:
    assert repair_text(source) == expected


def test_a_marker_without_text_is_kept_as_a_bullet() -> None:
    # The item starts in the next block: nothing may be dropped, and no empty list item remains.
    assert repair_text("в разделе 4 листка-вкладыша. ") == "в разделе 4 листка-вкладыша. •"


def test_wingdings_circled_digits_are_numbered_steps() -> None:
    assert repair_text(" Проверьте этикетку  Проверьте окно") == (
        "1. Проверьте этикетку\n2. Проверьте окно"
    )


def test_line_start_letter_codes_are_bullets_only_at_the_line_start() -> None:
    assert repair_text(" Сохраните листок-вкладыш") == "- Сохраните листок-вкладыш"
    # inside a sentence Symbol «l» is lambda
    assert repair_text("длина волны  = 5") == "длина волны λ = 5"


def test_a_heading_keeps_one_line() -> None:
    body = "# Листок  информация  для пациента\n\ntext  a  b\n"
    assert repair_markdown_body(body) == (
        "# Листок – информация · для пациента\n\ntext\n- a\n- b\n"
    )


def test_markdown_comments_are_left_alone() -> None:
    comment = '<!-- localmed:source {"block":"p1-b1","kind":"paragraph","page":1} -->'
    body = f"{comment}\n item\n"
    assert repair_markdown_body(body) == f"{comment}\n- item\n"


def test_text_without_private_use_glyphs_is_returned_unchanged() -> None:
    text = "- уже список\n• литеральный маркер\nобычный текст"
    assert not has_private_use(text)
    assert repair_text(text) is text
    assert repair_markdown_body(text) is text


def test_an_unknown_glyph_inside_a_sentence_is_kept_and_reported() -> None:
    text = "раствор  для инфузий"
    assert repair_text(text) == text
    assert unmapped_private_use(text) == [""]


def test_symbol_font_span_maps_greek_letters_before_the_bullet_rule_can_see_them() -> None:
    assert translate_span("", "Symbol") == "λ"
    assert translate_span("", "Wingdings-Regular") == ""
    assert translate_span("", "SymbolMT") == ""
    assert translate_span("обычный", "TimesNewRomanPSMT") == "обычный"


def _span(text: str, font: str, x0: float, x1: float) -> dict[str, object]:
    return {"text": text, "font": font, "size": 12.0, "flags": 4, "bbox": [x0, 0.0, x1, 12.0]}


def test_pdf_line_with_symbol_bullet_span_starts_with_a_list_marker() -> None:
    spans = [
        _span("", "SymbolMT", 85.1, 91.0),
        _span(" ", "TimesNewRomanPSMT", 91.0, 94.0),
        _span("при артериальной гипертензии;", "TimesNewRomanPSMT", 94.0, 264.0),
    ]
    text, _size, _font, _bold = _merge_spans(spans)  # type: ignore[arg-type]
    assert repair_text(text) == "- при артериальной гипертензии;"


def test_pdf_block_with_bullets_in_several_lines_keeps_one_item_per_line() -> None:
    def line(text: str, y: float) -> dict[str, object]:
        return {
            "bbox": [85.0, y, 500.0, y + 12.0],
            "spans": [
                _span("", "Symbol", 85.0, 91.0),
                _span(" " + text, "TimesNewRomanPSMT", 91.0, 500.0),
            ],
        }

    payload: dict[str, object] = {
        "width": 595.0,
        "height": 842.0,
        "blocks": [
            {
                "type": 0,
                "bbox": [85.0, 100.0, 500.0, 160.0],
                "lines": [
                    {
                        "bbox": [85.0, 100.0, 500.0, 112.0],
                        "spans": [_span("Показания:", "TimesNewRomanPSMT", 85.0, 150.0)],
                    },
                    line("артериальная гипертензия;", 114.0),
                    line("стенокардия напряжения;", 128.0),
                    line("синусовая тахикардия, которая", 142.0),
                    {
                        "bbox": [91.0, 156.0, 400.0, 168.0],
                        "spans": [_span("не поддается лечению.", "TimesNewRomanPSMT", 91.0, 400.0)],
                    },
                ],
            }
        ],
    }
    (block,) = _extract_raw_blocks_from_payload(payload, 0, ExtractionOptions())
    assert block.text == (
        "Показания:\n- артериальная гипертензия;\n- стенокардия напряжения;\n"
        "- синусовая тахикардия, которая не поддается лечению."
    )


def test_join_lines_keeps_a_wrapped_item_together_and_a_lead_in_apart() -> None:
    lines = ["Состав:", "- лактоза", "- гипромеллоза", "и крахмал"]
    assert _join_lines(lines, dehyphenate=True) == "Состав:\n- лактоза\n- гипромеллоза и крахмал"


def test_prepared_markdown_with_private_use_bullets_builds_list_chunks(tmp_path: Path) -> None:
    path = tmp_path / "drug.md"
    path.write_text(
        "---\n"
        "id: drug.test.instruction\n"
        "title: Тест\n"
        "version_label: v1\n"
        "source_type: official_drug_instruction\n"
        "status: active\n"
        "---\n\n"
        "# Показания к применению\n\n"
        '<!-- localmed:source {"block":"p1-b1","kind":"paragraph","page":1} -->\n'
        "Препарат показан:  при гипертензии;  при стенокардии.  при тахикардии.\n"
        "\n"
        '<!-- localmed:source {"block":"p1-b2","kind":"paragraph","page":1} -->\n'
        " при феохромоцитоме;\n",
        encoding="utf-8",
    )

    document = parse_markdown_document(path, "2026-10-20T00:00:00Z")

    text = "\n".join(
        chunk.original_text for section in document.sections for chunk in section.chunks
    )
    assert not has_private_use(text)
    assert "Препарат показан:\n- при гипертензии;\n- при стенокардии.\n- при тахикардии." in text
    assert "- при феохромоцитоме;" in text


def _docx(paragraphs: str) -> bytes:
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{paragraphs}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


def test_docx_symbol_runs_and_numbered_paragraphs_become_list_items() -> None:
    payload = _docx(
        "<w:p><w:r><w:t>Показания:</w:t></w:r></w:p>"
        # a bullet typed from the Symbol font: a w:sym run, not text
        '<w:p><w:r><w:sym w:font="Symbol" w:char="F0B7"/></w:r><w:r><w:tab/></w:r>'
        "<w:r><w:t>артериальная гипертензия;</w:t></w:r></w:p>"
        # a list made with Word's numbering: no character at all
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>'
        "<w:r><w:t>стенокардия напряжения;</w:t></w:r></w:p>"
        # numId 0 switches numbering off
        '<w:p><w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>'
        "<w:r><w:t>Обычный абзац.</w:t></w:r></w:p>"
    )

    assert docx_text(payload) == (
        "Показания:\n- артериальная гипертензия;\n- стенокардия напряжения;\nОбычный абзац."
    )
