"""Cell marks of a ruled grid on a scanned page (the age-by-examination matrices of a legal act).

Marker and Vision both lose the «+» of a table with fifty narrow columns: Marker packs the marks of a row
into one cell or drops them, Vision joins them into a line. The ruled lines and the marks are plain ink, so
the matrix is read from the pixels: the vertical and horizontal ruling gives the cells, the ink inside a
cell says whether it is marked. The reading is pure Python over the rendered page (no image library).
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Final

DARK: Final = 200
ZOOM: Final = 2.5
MIN_INK: Final = 20
"""Dark pixels in a cell's inner rectangle that make a «+» (the glyph is ≈ 20 pixels at the default zoom)."""
MARGIN: Final = 5
"""Pixels trimmed from every side of a cell so that its ruling is not counted as ink."""


@dataclass(frozen=True)
class Grid:
    """A rendered page as one byte per pixel: 1 for ink, 0 for paper."""

    width: int
    height: int
    data: bytes

    def column(self, x: int) -> bytes:
        return self.data[x :: self.width]

    def row(self, y: int) -> bytes:
        return self.data[y * self.width : (y + 1) * self.width]

    def ink(self, x0: int, x1: int, y0: int, y1: int) -> int:
        return sum(
            self.data[y * self.width + x0 : y * self.width + x1].count(1) for y in range(y0, y1)
        )


def load_grid(
    pdf: Path, page: int, *, zoom: float = ZOOM, dark: int = DARK, angle: float = 0.0
) -> Grid:
    """Render page `page` (1-based) of `pdf` in grey, turned by `angle` degrees, and threshold it."""
    import pymupdf

    document = pymupdf.open(pdf)
    matrix = pymupdf.Matrix(zoom, zoom).prerotate(angle) if angle else pymupdf.Matrix(zoom, zoom)
    pixmap = document[page - 1].get_pixmap(matrix=matrix, colorspace=pymupdf.csGRAY)
    table = bytes(1 if value < dark else 0 for value in range(256))
    return Grid(pixmap.width, pixmap.height, pixmap.samples.translate(table))


def skew_degrees(grid: Grid) -> float:
    """The scan's tilt: the slope of the longest vertical rule, followed down the page, in degrees.

    A scanned sheet is rarely square; over a page the tilt moves a rule by more than a column's width, so
    the cells are read only after the page is turned back. Positive means the page must be turned clockwise.
    """
    import math

    rules = vertical_lines(grid)
    if not rules:
        return 0.0
    best = max(rules, key=lambda x: max(len(run) for run in grid.column(x).split(b"\x00")))
    window = 60
    points: list[tuple[int, int]] = []
    x = best
    for y in range(0, grid.height - window, window):
        counts = {
            candidate: sum(grid.column(candidate)[y : y + window])
            for candidate in range(x - 6, x + 7)
            if 0 <= candidate < grid.width
        }
        if not counts:
            break
        top = max(counts, key=lambda c: counts[c])
        if counts[top] >= window * 0.8:
            x = top
            points.append((y, top))
    if len(points) < 5:
        return 0.0
    mean_y = sum(y for y, _ in points) / len(points)
    mean_x = sum(v for _, v in points) / len(points)
    slope = sum((y - mean_y) * (v - mean_x) for y, v in points) / sum(
        (y - mean_y) ** 2 for y, _ in points
    )
    return math.degrees(math.atan(slope))


def load_upright_grid(pdf: Path, page: int, *, zoom: float = ZOOM, dark: int = DARK) -> Grid:
    """`load_grid` after turning the page back by its own tilt."""
    first = load_grid(pdf, page, zoom=zoom, dark=dark)
    angle = skew_degrees(first)
    if abs(angle) < 0.05:
        return first
    return load_grid(pdf, page, zoom=zoom, dark=dark, angle=angle)


def _clusters(values: list[int]) -> list[int]:
    groups: list[list[int]] = []
    for value in values:
        if groups and value - groups[-1][-1] <= 2:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [round((group[0] + group[-1]) / 2) for group in groups]


def vertical_lines(
    grid: Grid, *, min_run: int = 100, y0: int = 0, y1: int | None = None
) -> list[int]:
    """x of every vertical rule with an unbroken ink run of at least `min_run` pixels between y0 and y1."""
    end = grid.height if y1 is None else y1
    found = []
    for x in range(grid.width):
        runs = grid.column(x)[y0:end].split(b"\x00")
        if max(len(run) for run in runs) >= min_run:
            found.append(x)
    return _clusters(found)


def horizontal_lines(grid: Grid, *, x0: int, x1: int, min_run: int = 250) -> list[int]:
    """y of every horizontal rule with an unbroken ink run of at least `min_run` pixels between x0 and x1.

    The ruling of a scan is thin and broken, so the run is short; text never makes a run that long.
    """
    found = [
        y
        for y in range(grid.height)
        if max(len(run) for run in grid.row(y)[x0:x1].split(b"\x00")) >= min_run
    ]
    return _clusters(found)


def marks(grid: Grid, xs: list[int], ys: list[int]) -> list[list[bool]]:
    """For every cell between consecutive rules, whether it holds ink (a «+»)."""
    result: list[list[bool]] = []
    for top, bottom in pairwise(ys):
        result.append(
            [
                grid.ink(left + MARGIN, right - MARGIN, top + MARGIN, bottom - MARGIN) >= MIN_INK
                for left, right in pairwise(xs)
            ]
        )
    return result
