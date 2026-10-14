"""Reading the «+» matrices of a scanned page from its ruling and ink (a synthetic page stands in for the scan)."""

from pathlib import Path

import pymupdf

from localmed_ingest.legal_grid import (
    horizontal_lines,
    load_grid,
    load_upright_grid,
    marks,
    skew_degrees,
    vertical_lines,
)

COLUMNS = 6
ROWS = 4
CELL_W = 40.0
CELL_H = 34.0
LEFT = 40.0
TOP = 40.0
PATTERN = ["+.+.+.", "++++++", "..+...", "......"]


def _page(path: Path, tilt: float = 0.0) -> Path:
    """A ruled table of COLUMNS x ROWS cells with PATTERN's marks, optionally turned by `tilt` degrees."""
    document = pymupdf.open()
    page = document.new_page(width=400, height=260)
    centre = pymupdf.Point(200, 130)
    turn = pymupdf.Matrix(tilt) if tilt else None

    def at(x: float, y: float) -> pymupdf.Point:
        point = pymupdf.Point(x, y)
        return point * turn if turn else point

    if turn:
        turn = (
            pymupdf.Matrix(1, 0, 0, 1, -centre.x, -centre.y)
            * pymupdf.Matrix(tilt)
            * pymupdf.Matrix(1, 0, 0, 1, centre.x, centre.y)
        )
    for i in range(COLUMNS + 1):
        x = LEFT + i * CELL_W
        page.draw_line(at(x, TOP), at(x, TOP + ROWS * CELL_H), width=1.2)
    for j in range(ROWS + 1):
        y = TOP + j * CELL_H
        page.draw_line(at(LEFT, y), at(LEFT + COLUMNS * CELL_W, y), width=1.2)
    for j, row in enumerate(PATTERN):
        for i, cell in enumerate(row):
            if cell == "+":
                page.insert_text(
                    at(LEFT + i * CELL_W + CELL_W / 2 - 4, TOP + j * CELL_H + CELL_H / 2 + 4),
                    "+",
                    fontsize=14,
                )
    document.save(path)
    return path


def _read(grid) -> list[str]:
    xs = vertical_lines(grid)
    ys = horizontal_lines(grid, x0=xs[0], x1=xs[-1])
    return ["".join("+" if m else "." for m in row) for row in marks(grid, xs, ys)]


def test_marks_are_read_from_the_ruled_cells(tmp_path: Path) -> None:
    pdf = _page(tmp_path / "grid.pdf")
    assert _read(load_grid(pdf, 1)) == PATTERN


def test_a_tilted_page_is_turned_back_before_its_cells_are_read(tmp_path: Path) -> None:
    pdf = _page(tmp_path / "tilted.pdf", tilt=1.6)
    angle = skew_degrees(load_grid(pdf, 1))
    assert abs(angle) > 0.5
    assert _read(load_upright_grid(pdf, 1)) == PATTERN
