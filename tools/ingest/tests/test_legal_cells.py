"""The ruled-table reading of scanned legal acts (`legal_cells`): cells from rules, matching with Marker's cells."""

from __future__ import annotations

from localmed_ingest.legal_cells import (
    UNREAD,
    Grid,
    find_cells,
    grid_markdown,
    harmonize,
    marker_cells,
    match_cells,
)

WIDTH, HEIGHT = 1000, 900


def _grid(vertical: list[int], horizontal: list[tuple[int, int, int]]) -> Grid:
    """A page with ruled lines: vertical x positions (full height 100..800) and horizontal (y, x0, x1) segments."""
    data = bytearray(WIDTH * HEIGHT)
    for x in vertical:
        for y in range(100, 801):
            data[y * WIDTH + x] = 1
    for y, x0, x1 in horizontal:
        for x in range(x0, x1 + 1):
            data[y * WIDTH + x] = 1
    return Grid(WIDTH, HEIGHT, bytes(data))


def test_a_merged_cell_is_one_cell_and_a_full_rule_separates_rows() -> None:
    # three columns, rows split at y=300 (all columns) and y=500 (columns 2 and 3 only: column 1 spans them)
    grid = _grid(
        [100, 400, 700, 950],
        [(100, 100, 950), (300, 100, 950), (500, 400, 950), (800, 100, 950)],
    )
    found = find_cells(grid)
    assert found is not None
    cells, _ = found
    spans = {(c.row, c.col): (c.row_span, c.col_span) for c in cells}
    assert spans[(0, 0)] == (1, 1)
    assert spans[(1, 0)] == (2, 1)  # the first column's cell runs over both lower rows
    assert (1, 1) in spans and (2, 1) in spans


def test_a_page_without_ruling_has_no_cells() -> None:
    assert find_cells(Grid(WIDTH, HEIGHT, bytes(WIDTH * HEIGHT))) is None


def test_cells_that_agree_carry_markers_text_and_a_lone_number_is_matched() -> None:
    marker = ["№ п/п", "Наименование", "1.", "Врач-неонатолог", "1 должность"]
    vision = [
        (0, "Nº п/п"),
        (1, "Наименование"),
        (2, UNREAD),
        (3, "Врач неонатолог"),
        (4, "1 должность"),
    ]
    assigned, left = match_cells(marker, vision)
    assert assigned == {
        0: "№ п/п",
        1: "Наименование",
        2: "1.",
        3: "Врач-неонатолог",
        4: "1 должность",
    }
    assert left == []


def test_cells_cut_differently_by_the_two_readings_are_joined() -> None:
    marker = ["Холодильник для хранения препаратов крови", "1"]
    vision = [(0, "Холодильник для"), (1, "хранения препаратов крови"), (2, "1")]
    assigned, left = match_cells(marker, vision)
    assert assigned[0] == "Холодильник для хранения препаратов крови"
    assert assigned[1] == ""  # merged into its neighbour
    assert assigned[2] == "1" and left == []


def test_cells_with_different_numbers_do_not_agree() -> None:
    assigned, left = match_cells(["4,75 должности на 60 коек"], [(0, "4,75 должности на 25 коек")])
    assert assigned == {} and left == ["4,75 должности на 60 коек"]


def test_the_table_is_rebuilt_on_the_ruled_grid_and_unconfirmed_cells_are_flagged() -> None:
    markdown = "Заголовок\n\n| a | b |\n|---|---|\n| 1. | Врач |\n"
    layout = {
        "cells": [
            {"row": 0, "col": 0, "rowSpan": 1, "colSpan": 1, "box": [0, 0, 1, 1]},
            {"row": 0, "col": 1, "rowSpan": 1, "colSpan": 1, "box": [0, 0, 1, 1]},
            {"row": 1, "col": 0, "rowSpan": 1, "colSpan": 1, "box": [0, 0, 1, 1]},
            {"row": 1, "col": 1, "rowSpan": 1, "colSpan": 1, "box": [0, 0, 1, 1]},
        ]
    }
    texts = [["a"], ["b"], ["1."], ["Врач"]]
    rebuilt = grid_markdown(markdown, layout, texts, [True] * 4)
    assert rebuilt is not None
    text, flags = rebuilt
    assert "| 1. | Врач |" in text and text.startswith("Заголовок")
    assert flags == []
    # a cell Marker does not have is Vision's text and a flag
    _, flags = grid_markdown(
        markdown, layout, [["a"], ["b"], ["1."], ["Фельдшер"]], [True] * 4
    ) or ("", [])
    assert [kind for kind, _ in flags] == ["cell-vision-only", "cell-marker-only"]


def test_marker_cells_and_harmonize_keep_the_order() -> None:
    markdown = "| x | y |\n|---|---|\n| один | два |"
    assert marker_cells(markdown) == ["x", "y", "один", "два"]
    assert harmonize(markdown, [["x"], ["y"], ["ОДИН"], ["два"]]) == [
        ["x"],
        ["y"],
        ["один"],
        ["два"],
    ]
