"""Headings of prepared documents: levels, wrapped titles, merged titles, body text read as titles.

The cases are shortened from real documents: the ГРЛС instructions of Лонсурф and Ипидакрин,
the clinical recommendations 696_2 (aplastic anemia, PDF) and 946_1 / 983_1 (official JSON).
"""

from __future__ import annotations

import pytest

from localmed_ingest.models import (
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionDiagnostics,
    ExtractionOptions,
)
from localmed_ingest.numbered_headings import heading_number, reconcile_heading_levels
from localmed_ingest.pdf_import import (
    RawBlock,
    _classify_blocks,
    _extract_raw_blocks_from_payload,
    _looks_like_heading,
)
from localmed_ingest.source_registry import render_body

OPTIONS = ExtractionOptions()


def _raw(text: str, *, bold: bool = False, size: float = 12.0, lines: int = 1) -> RawBlock:
    return RawBlock(
        page=1,
        page_width=595,
        page_height=842,
        order_index=0,
        bbox=(85, 300, 540, 300 + 14 * lines),
        text=text,
        font_size=size,
        font_name="TimesNewRomanPSMT",
        bold=bold,
        line_count=lines,
        columnar_lines=0,
    )


# --- body text that is not a heading -------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        # A sentence that merely ends in a standard section phrase.
        "Не давайте препарат детям в возрасте от 0 до 6 лет в связи с невозможностью "
        "обеспечить режим дозирования.",
        "Подобно другим препаратам, снижающим кислотность желудочного сока, лечение",
        "Тяжесть диареи может варьировать от легких форм до тяжелых. Лечение",
        # The end of a sentence on its own wrapped line.
        "«Противопоказания»).",
        "приведены в разделе «Особые указания».",
        # Bibliography entries and numbered table rows of a clinical recommendation.
        "25. Croese J, Fairley SK, Masson JW, et al. Clinical and endoscopic features of EoE",
        "75. Tikkanen A. U. et al. Paediatric cardiac rehabilitation in congenital heart disease",
        "6. Савельева Г.М., Сухих Г.Т. Серов В.Н. Акушерство. Национальное руководство. 2019",
        # A date that opens a wrapped line.
        "25.05.2019) «Об основах охраны здоровья граждан в Российской Федерации» организуется",
        # A numbered sentence (two sentences in one line).
        "3. Выполнено исследование мокроты. Результат получен в течение суток",
    ],
)
def test_body_text_is_not_promoted_to_a_heading(text: str) -> None:
    assert _looks_like_heading(_raw(text, bold=True), 12.0, OPTIONS) is None


@pytest.mark.parametrize(
    ("text", "level"),
    [
        ("4. Возможные нежелательные реакции.", 1),
        ("3. Прием препарата Лонсурф®", 1),
        ("2. О чем следует знать перед приемом препарата Лонсурф®", 1),
        ("Держатель регистрационного удостоверения и производитель", 2),
        ("Особые указания и меры предосторожности", 2),
        ("Сообщение о нежелательных реакциях", 2),
        ("Раздел 4. Побочное действие", 2),
        ("3.1 Консервативное лечение", 2),
        ("1.2.2. Токсикодинамика. Механизм кардиотоксического действия", 3),
    ],
)
def test_real_headings_stay_headings(text: str, level: int) -> None:
    assert _looks_like_heading(_raw(text, bold=True), 12.0, OPTIONS) == level


def test_a_contents_block_is_not_one_heading() -> None:
    # Two numbered lines in one block (a table of contents) used to be read as one heading
    # because the whole block ended in a standard phrase.
    block = _raw(
        "3. Прием препарата Вермокс\n4. Возможные нежелательные реакции.", lines=2, bold=True
    )
    assert _looks_like_heading(block, 12.0, OPTIONS) is None


def test_numbered_lines_of_one_block_are_not_one_merged_heading() -> None:
    block = _raw(
        "2.4 Инструментальные диагностические исследования\n"
        "2.4.1. Определение нарушения газового состава крови",
        lines=2,
        bold=True,
    )
    assert _looks_like_heading(block, 12.0, OPTIONS) is None


# --- one block holds a heading and the text under it ---------------------------------------

BOLD = "TimesNewRomanPS-BoldMT"
REGULAR = "TimesNewRomanPSMT"


def _line(text: str, font: str, y: float, x0: float = 85.1, x1: float = 540.0) -> dict[str, object]:
    return {
        "bbox": [x0, y, x1, y + 14.0],
        "spans": [
            {
                "text": text,
                "font": font,
                "size": 12.0,
                "flags": 20 if font == BOLD else 4,
                "bbox": [x0, y, x1, y + 14.0],
            }
        ],
    }


def _page_blocks(blocks: list[list[dict[str, object]]]) -> list[RawBlock]:
    payload: dict[str, object] = {
        "width": 595.0,
        "height": 842.0,
        "blocks": [
            {
                "type": 0,
                "bbox": [85.0, 300.0 + 80 * index, 540.0, 360.0 + 80 * index],
                "lines": lines,
            }
            for index, lines in enumerate(blocks)
        ],
    }
    return _extract_raw_blocks_from_payload(payload, 0, OPTIONS)


def _classified(blocks: list[RawBlock]) -> list[ExtractedBlock]:
    pages, _removed = _classify_blocks(blocks, 12.0, OPTIONS)
    return [block for page in pages for block in page.blocks]


def test_a_bold_numbered_heading_is_split_from_the_paragraph_that_follows_it() -> None:
    # Лонсурф, page 3: the PDF block holds «3.» «Прием препарата Лонсурф®» (bold) and the two
    # lines of the paragraph; the whole block became one heading with the paragraph in it.
    raw = _page_blocks(
        [
            [
                _line("3.", BOLD, 717.9, 85.1, 97.4),
                _line("Прием препарата Лонсурф®", BOLD, 717.9, 120.5, 276.6),
                _line(
                    "Всегда принимайте препарат Лонсурф® в полном соответствии с", REGULAR, 731.7
                ),
                _line("лечащего врача. При появлении сомнений посоветуйтесь", REGULAR, 745.9),
            ]
        ]
    )

    heading, body = _classified(raw)

    assert (heading.kind, heading.heading_level) == ("heading", 1)
    assert heading.text == "3. Прием препарата Лонсурф®"
    assert heading.id == "p1-b1"
    assert body.kind == "paragraph"
    assert body.text.startswith("Всегда принимайте препарат Лонсурф®")
    assert body.text.endswith("посоветуйтесь")
    assert body.id == "p1-b1s1"
    assert body.bbox is not None and body.bbox[1] == 731.7


def test_standard_labels_inside_a_bold_run_become_headings_of_their_own() -> None:
    # Ипидакрин: «Показания к применению» and its first sentence arrive as one block.
    raw = _page_blocks(
        [
            [
                _line("Показания к применению", BOLD, 100.0),
                _line(
                    "Препарат Ипидакрин применяется у взрослых в возрасте от 18 лет:",
                    REGULAR,
                    114.0,
                ),
            ]
        ]
    )

    heading, body = _classified(raw)

    assert (heading.kind, heading.text, heading.heading_level) == (
        "heading",
        "Показания к применению",
        2,
    )
    assert body.text == "Препарат Ипидакрин применяется у взрослых в возрасте от 18 лет:"


def test_two_numbered_headings_and_their_text_in_one_block_are_split() -> None:
    raw = _page_blocks(
        [
            [
                _line("2.4 Инструментальные диагностические исследования", BOLD, 100.0),
                _line("2.4.1. Определение нарушения газового состава крови", BOLD, 114.0),
                _line("Пульсоксиметрию рекомендовано проводить всем пациентам", REGULAR, 128.0),
            ]
        ]
    )

    first, second, body = _classified(raw)

    assert [(b.kind, b.heading_level, b.text) for b in (first, second)] == [
        ("heading", 2, "2.4 Инструментальные диагностические исследования"),
        ("heading", 3, "2.4.1. Определение нарушения газового состава крови"),
    ]
    assert body.kind == "paragraph"
    assert body.text == "Пульсоксиметрию рекомендовано проводить всем пациентам"


def test_a_bold_run_in_label_that_is_no_heading_keeps_its_block() -> None:
    raw = _page_blocks(
        [
            [
                _line("Примечание", BOLD, 100.0),
                _line("Прекратите приём препарата и немедленно обратитесь к врачу", REGULAR, 114.0),
            ]
        ]
    )

    (block,) = _classified(raw)

    assert block.kind == "paragraph"
    assert block.text.startswith("Примечание Прекратите")


# --- one long heading wrapped over several blocks ---------------------------------------------


def _heading_block(text: str, top: float, order: int, *, left: float = 100.0) -> RawBlock:
    return RawBlock(
        page=42,
        page_width=595,
        page_height=842,
        order_index=order,
        bbox=(left, top, left + 420.0, top + 15.9),
        text=text,
        font_size=14.041,
        font_name="TimesNewRomanPS-BoldMT",
        bold=True,
        line_count=1,
        columnar_lines=0,
    )


def test_a_heading_wrapped_over_three_blocks_is_one_heading() -> None:
    # 696_2, page 42: «5. Профилактика…» was a level-1 heading followed by two level-2 ones.
    blocks = [
        _heading_block("5. Профилактика и диспансерное наблюдение, медицинские", 62.718, 0),
        _heading_block("показания и противопоказания к применению методов", 86.598, 1),
        _heading_block("профилактики", 110.358, 2, left=268.0),
        RawBlock(
            page=42,
            page_width=595,
            page_height=842,
            order_index=3,
            bbox=(120.0, 134.5, 531.0, 148.1),
            text="Методов профилактики АА в настоящее время не существует.",
            font_size=12.0,
            font_name="TimesNewRomanPSMT",
            bold=False,
            line_count=1,
            columnar_lines=0,
        ),
    ]

    heading, body = _classified(blocks)

    assert heading.kind == "heading"
    assert heading.text == (
        "5. Профилактика и диспансерное наблюдение, медицинские показания и противопоказания "
        "к применению методов профилактики"
    )
    assert heading.heading_level == 1
    assert heading.metadata["blocks"] == ["p42-b1", "p42-b2", "p42-b3"]
    assert body.kind == "paragraph"


def test_two_separate_headings_are_not_joined() -> None:
    blocks = [
        _heading_block("Диагностика", 62.718, 0),
        _heading_block("Лечение", 86.598, 1),
    ]

    assert [block.text for block in _classified(blocks)] == ["Диагностика", "Лечение"]


def test_a_numbered_heading_after_a_heading_is_not_a_continuation() -> None:
    blocks = [
        _heading_block("1. Краткая информация по заболеванию", 62.718, 0),
        _heading_block("1.1 Определение заболевания", 86.598, 1),
    ]

    assert [block.text for block in _classified(blocks)] == [
        "1. Краткая информация по заболеванию",
        "1.1 Определение заболевания",
    ]


# --- levels follow the numbers -----------------------------------------------------------------


def test_heading_number_reads_the_components_of_a_leading_number() -> None:
    assert heading_number("3.1.2 Лечение") == (3, 1, 2)
    assert heading_number("3. Лечение") == (3,)
    assert heading_number("2.4.1. Название") == (2, 4, 1)
    assert heading_number("Приложение А1. Состав") is None
    assert heading_number("2020;3(2):105–111") is None


def test_children_sit_one_level_below_their_numbered_parent() -> None:
    # 946_1 / 983_1: the source gave «3.1 …» the same <h1> as «3. Лечение», «1.2.1 …» the same
    # <h2> as «1.2 …».
    headings = [
        ("1. Краткая информация", 1),
        ("1.2 Этиология и патогенез", 2),
        ("1.2.1 Расслоение аорты", 2),
        ("1.2.2 Травматическое повреждение аорты", 2),
        ("3. Лечение", 1),
        ("3.1 Консервативное лечение", 1),
        ("3.1.1 Медикаментозная терапия", 2),
        ("3.2 Хирургическое лечение", 1),
        ("3.2.1 Острое расслоение аорты типа А", 2),
        ("3.2.1.1 Стратегии перфузии", 3),
        ("3.2.2 Острое расслоение типа В", 2),
    ]

    assert reconcile_heading_levels(headings) == [1, 2, 3, 3, 1, 2, 3, 2, 3, 4, 3]


def test_an_unnumbered_heading_closes_the_numbered_ones_below_its_level() -> None:
    headings = [
        ("6. Организация оказания медицинской помощи", 1),
        ("Приложение А1. Состав рабочей группы", 1),
        ("1. Шкала оценки уровней достоверности", 2),
        ("2. Шкала оценки уровней убедительности", 3),
        ("Приложение А2. Методология", 1),
        ("1.1 Не продолжение шестого раздела", 2),
    ]

    # Numbering restarts in an appendix: its own levels are kept, and «1.1» has no parent «1».
    assert reconcile_heading_levels(headings) == [1, 1, 2, 3, 1, 2]


def test_a_missing_parent_keeps_the_level_the_source_gave() -> None:
    assert reconcile_heading_levels([("3.1.1 Название", 2), ("3.1.2 Название", 2)]) == [2, 2]


def _document(blocks: list[ExtractedBlock]) -> ExtractedSource:
    return ExtractedSource(
        source_file="x.json",
        source_checksum="sha256:" + "0" * 64,
        source_format="clinical_json",
        pages=[ExtractedPage(page=1, width=1.0, height=1.0, blocks=blocks, character_count=100)],
        diagnostics=ExtractionDiagnostics(
            source_checksum="sha256:" + "0" * 64,
            source_format="clinical_json",
            page_count=0,
            block_count=len(blocks),
            included_block_count=len(blocks),
            character_count=100,
            removed_repeated_blocks=0,
            heading_candidates=0,
            table_candidates=0,
            quality_score=1.0,
            requires_review=False,
        ),
    )


def _block(index: int, kind: str, text: str, level: int | None = None) -> ExtractedBlock:
    return ExtractedBlock.model_validate(
        {
            "id": f"json-b{index}",
            "orderIndex": index,
            "kind": kind,
            "text": text,
            "headingLevel": level,
        }
    )


def test_rendered_markdown_nests_numbered_sections_below_their_parent() -> None:
    document = _document(
        [
            _block(0, "heading", "3. Лечение", 1),
            _block(1, "paragraph", "Общие положения лечения."),
            _block(2, "heading", "3.1 Консервативное лечение", 1),
            _block(3, "paragraph", "Медикаментозная терапия."),
            _block(4, "heading", "3.1.1 Терапия в острой стадии", 2),
            _block(5, "paragraph", "Острая стадия."),
        ]
    )

    lines = [line for line in render_body(document).splitlines() if line.startswith("#")]

    assert lines == [
        "# 3. Лечение",
        "## 3.1 Консервативное лечение",
        "### 3.1.1 Терапия в острой стадии",
    ]
