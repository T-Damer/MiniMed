"""A table the PDF text layer holds cell by cell is marked, never rewritten.

Shaped after the adverse-reaction table of the ГРЛС instructions of Флуоксетин and Дулоксетин
Канон, where every cell is a block of its own («Учащенные» / «позывы к» / «мочеиспуска-» / «нию13»).
"""

from __future__ import annotations

from localmed_ingest.models import ExtractedBlock, ExtractionOptions
from localmed_ingest.pdf_import import RawBlock, RawLine, _classify_blocks

OPTIONS = ExtractionOptions()


def _cell(index: int, text: str, left: float, top: float, width: float = 70.0) -> RawBlock:
    bbox = (left, top, left + width, top + 12.0)
    return RawBlock(
        page=1,
        page_width=595,
        page_height=842,
        order_index=index,
        bbox=bbox,
        text=text,
        font_size=10.0,
        font_name="TimesNewRomanPSMT",
        bold=False,
        line_count=1,
        columnar_lines=0,
        lines=(RawLine(text=text, bold=False, font_size=10.0, bbox=bbox),),
    )


def _classified(blocks: list[RawBlock]) -> list[ExtractedBlock]:
    pages, _removed = _classify_blocks(blocks, 10.0, OPTIONS)
    return [block for page in pages for block in page.blocks]


def test_cells_on_shared_columns_and_baselines_are_marked_as_a_table() -> None:
    cells = [
        ("Учащенные", 91, 497),
        ("Дизурия", 282, 497),
        ("Нарушение", 378, 497),
        ("позывы к", 186, 516),
        ("мочеиспускания", 378, 516),
        ("мочеиспуска-", 186, 535),
        ("Задержка мочи", 378, 535),
        ("нию13", 186, 554),
        ("Гинекологичес-", 91, 593),
        ("Сексуальная", 282, 593),
        ("Галакторея", 378, 593),
        ("кие", 186, 612),
        ("дисфункция16", 282, 612),
        ("Гиперпролакти-", 378, 612),
    ]
    blocks = _classified([_cell(i, text, x, y) for i, (text, x, y) in enumerate(cells)])

    assert [block.text for block in blocks] == [text for text, _x, _y in cells]
    assert {block.kind for block in blocks} == {"table_candidate"}
    assert all(block.metadata["flattenedTable"] is True for block in blocks)


def test_wrapped_prose_lines_on_one_left_edge_stay_paragraphs() -> None:
    lines = [f"Строка обычного текста номер {i}." for i in range(12)]
    blocks = _classified([_cell(i, text, 85, 100 + 15 * i, 400.0) for i, text in enumerate(lines)])

    assert {block.kind for block in blocks} == {"paragraph"}


def test_prose_around_a_table_is_not_swept_into_it() -> None:
    cells = [
        _cell(0, "Вводная фраза перед таблицей.", 91, 100, 300.0),
        *[_cell(1 + i, f"ячейка {i}", 91 + 96 * (i % 3), 130 + 19 * (i // 3)) for i in range(12)],
        _cell(13, "Заключительная фраза после таблицы.", 91, 400, 300.0),
    ]
    blocks = _classified(cells)

    assert blocks[0].kind == "paragraph"
    assert blocks[-1].kind == "paragraph"
    assert {block.kind for block in blocks[1:-1]} == {"table_candidate"}
