"""Sub-items numbered «1)», «2)» … under a paragraph (order 1092н, item 6)."""

from __future__ import annotations

from localmed_ingest.medical_forms import Row, split_paragraphs


def row(text: str, index: int) -> Row:
    return Row(page=1, index=index, text=text, x=0.1, y=0.5, confidence=1.0)


def test_bracket_items_split_only_when_asked() -> None:
    rows = [
        row("6. В медицинском заключении:", 0),
        row("1) в строке 1 указываются", 1),
        row("фамилия, имя;", 2),
        row("2) в строке 2 указывается дата;", 3),
        row("7. Бланк", 4),
    ]
    items = split_paragraphs(rows, True)
    assert [(p.number, p.clause) for p in items] == [
        ("6", None),
        ("6.1", "6, подпункт 1"),
        ("6.2", "6, подпункт 2"),
        ("7", None),
    ]
    assert items[1].text == "1) в строке 1 указываются фамилия, имя;"
    assert [p.number for p in split_paragraphs(rows)] == ["6", "7"]


def test_a_bracket_line_before_any_top_level_paragraph_is_not_an_item() -> None:
    rows = [row("1) стоит без пункта", 0), row("6. Пункт", 1), row("1) подпункт", 2)]
    assert [p.number for p in split_paragraphs(rows, True)] == ["6", "6.1"]
