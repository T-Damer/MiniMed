from __future__ import annotations

from localmed_ingest.local_reference_html import (
    TABLE_PIECE_LIMIT,
    escape_markdown,
    field_to_markdown,
    html_text,
    html_to_markdown,
    plain_inline,
    plain_to_markdown,
    table_lines,
)


def test_soft_wraps_are_joined_and_real_breaks_stay_separate() -> None:
    conversion = html_to_markdown(
        "<p>Первая строка без точки<br>продолжается здесь.<br>Новая строка.</p>"
        "<p>Хвост строки</p><p>продолжение абзаца</p>"
    )
    assert conversion.blocks == [
        "Первая строка без точки продолжается здесь.",
        "Новая строка.",
        "Хвост строки продолжение абзаца",
    ]


def test_bold_marker_keeps_edge_spaces_outside_and_lines_with_bold_heading_do_not_merge() -> None:
    conversion = html_to_markdown(
        "<p><strong>Заголовок </strong>текст</p><p><strong>Раздел</strong></p>"
        "<p>pM1 продолжение</p>"
    )
    assert conversion.blocks == ["**Заголовок** текст", "**Раздел**", "pM1 продолжение"]


def test_markdown_specials_are_escaped() -> None:
    assert escape_markdown("a*b `c` $d$ ~e") == "a\\*b \\`c\\` \\$d\\$ \\~e"
    assert escape_markdown("x <b>y") == "x \\<b>y"
    assert escape_markdown("a < 5 и b > 3") == "a < 5 и b > 3"
    assert html_to_markdown("<p>> 5 мг</p><p>- пункт</p>").blocks == ["\\> 5 мг", "\\- пункт"]


def test_lists_and_indented_lines_become_bullets() -> None:
    conversion = html_to_markdown(
        "<ul><li>один</li><li>Два<br>Три</li></ul>"
        "<p>Пункт.<br>&nbsp; &nbsp; Подпункт А<br>&nbsp; &nbsp; Подпункт Б</p>"
    )
    assert conversion.blocks == [
        "- один\n- Два; Три",
        "Пункт.",
        "- Подпункт А\n- Подпункт Б",
    ]


def test_rowspan_is_repeated_and_headerless_table_gets_an_empty_header() -> None:
    conversion = html_to_markdown(
        "<table><tr><td rowspan='2'>Стадия A</td><td>T1</td></tr>"
        "<tr><td>T2<br>T3</td></tr><tr><td>Стадия B</td><td>x | y</td></tr></table>"
    )
    assert conversion.tables == 1
    assert conversion.merged_cells == 1
    assert conversion.problems == []
    assert conversion.blocks == [
        "|  |  |\n| --- | --- |\n| Стадия A | T1 |\n| Стадия A | T2; T3 |\n| Стадия B | x \\| y |"
    ]


def test_bold_first_row_is_the_header_and_a_full_width_title_row_is_a_caption() -> None:
    conversion = html_to_markdown(
        "<table><tr><td colspan='2'>Подпись</td></tr>"
        "<tr><td><strong>T</strong></td><td><strong>Стадия</strong></td></tr>"
        "<tr><td>T1</td><td>I</td></tr></table>"
    )
    assert conversion.blocks == ["Подпись", "| **T** | **Стадия** |\n| --- | --- |\n| T1 | I |"]


def test_empty_source_row_under_a_rowspan_is_not_duplicated() -> None:
    conversion = html_to_markdown(
        "<table><tr><td rowspan='2'>I</td><td rowspan='2'>a</td></tr><tr><br></tr>"
        "<tr><td>II</td><td>b</td></tr></table>"
    )
    assert conversion.blocks == ["|  |  |\n| --- | --- |\n| I | a |\n| II | b |"]


def test_nested_table_is_marked_not_guessed() -> None:
    conversion = html_to_markdown(
        "<table><tr><td>a<table><tr><td>b</td></tr></table></td><td>c</td></tr></table>"
    )
    assert conversion.problems == ["table: nested-table"]
    assert any(
        block.startswith("<!-- localmed:review table converted") for block in conversion.blocks
    )


def test_ragged_table_is_marked() -> None:
    conversion = html_to_markdown("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>")
    assert conversion.problems == ["table: ragged-rows"]
    assert conversion.blocks[-1].count("\n") == 3


def test_plain_text_lines_and_comma_lists() -> None:
    assert plain_to_markdown("Первый абзац.\nВторой абзац.").blocks == [
        "Первый абзац.",
        "Второй абзац.",
    ]
    assert plain_to_markdown("Показание один,\nПоказание два,\nПоказание три.").blocks == [
        "- Показание один\n- Показание два\n- Показание три."
    ]
    assert plain_to_markdown("обрыв без точки\nпродолжение &gt; 5").blocks == [
        "обрыв без точки продолжение > 5"
    ]


def test_field_to_markdown_detects_tags_and_ignores_comparison_signs() -> None:
    assert field_to_markdown(None).blocks == []
    assert field_to_markdown("  ").blocks == []
    assert field_to_markdown("значение < 5 и > 3").blocks == ["значение < 5 и > 3"]
    assert field_to_markdown("<div>Раз.</div><div>Два.</div>").blocks == ["Раз.", "Два."]


def test_html_text_and_plain_inline() -> None:
    assert html_text("Анти <span style=x>IgE</span>&nbsp;к<br>яду") == "Анти IgE к яду"
    assert plain_inline("Строка 1\nСтрока 2") == "Строка 1; Строка 2"
    assert plain_inline("Итог:\nПродолжение") == "Итог: Продолжение"
    assert plain_inline(None) == ""


def test_long_tables_are_split_by_rows_with_the_header_repeated() -> None:
    rows = [[f"Группа {index}", "x" * 40] for index in range(200)]
    pieces = table_lines(["Пол", "Значение"], rows)
    assert len(pieces) > 2
    for piece in pieces:
        assert len(piece) <= TABLE_PIECE_LIMIT
        assert piece.startswith("| Пол | Значение |\n| --- | --- |\n")
    assert sum(piece.count("Группа") for piece in pieces) == 200
