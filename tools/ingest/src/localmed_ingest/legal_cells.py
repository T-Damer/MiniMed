"""The cells of a ruled table on a scanned page, read one by one (the second reading of a table).

Vision reads a narrow-columned table line by line across the cells: the words of neighbouring columns are glued
together and the row numbers are lost. The ruling of the table is plain ink, so its cells are found from the
pixels (as in `legal_grid`): the vertical and horizontal rules cut the page into elementary rectangles, the
rectangles with no rule between them form one cell (a row or column span), and every cell is cropped and read
alone. `cells_pdf` writes the crops as the pages of one PDF; Vision reads it in a single run.

The reading of a page is then «the lines outside the table, the cells in row-major order, the lines below»;
`merge_lines` builds it from the page's ordinary Vision lines and the cell readings.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from .legal_grid import DARK, ZOOM, Grid, skew_degrees

MIN_RULE: Final = 150
"""Ink run (pixels at ZOOM) that makes a vertical rule; text never makes a run that long."""
MIN_ROW: Final = 0.08
"""A horizontal rule is a run of at least this share of the table's width (and 120 pixels)."""
EDGE: Final = 0.03
"""Rules this close to the page edge are the scanner's border, not the table's."""
BORDER: Final = 0.7
"""Share of an edge of two neighbouring rectangles that must be ink for a rule to separate them."""
INSET: Final = 3
"""Pixels trimmed from every side of a cell so that its ruling is not read."""
MIN_CELLS: Final = 4
PAGE_MIN_WIDTH: Final = 300.0
"""Width in points of a cell's page in the cells PDF: Vision scales every page to 1800 pixels."""
PAGE_MIN_WIDTH_TEXT: Final = 600.0
"""The same for a cell of text: on a narrower page its letters are blown up and misread."""
PAGE_MIN_HEIGHT: Final = 300.0
PAD: Final = 12.0
SMALL_WIDTH: Final = 100
SMALL_HEIGHT: Final = 60
"""A cell whose ink is smaller than this (pixels) holds a lone number: Vision reads a lone digit only when it
has paper all round it, so the crop gets `PAD_SMALL` points of margin on a page of at least 300 × 300."""
PAD_SMALL: Final = 100.0


@dataclass(frozen=True)
class Cell:
    """A cell of the table: rows and columns are 0-based indexes of the elementary grid."""

    row: int
    col: int
    row_span: int
    col_span: int
    box: tuple[int, int, int, int]
    """(left, top, right, bottom) in pixels of the page rendered at ZOOM."""


def _bridged(run: bytes) -> bytes:
    """Close the gaps of up to three pixels that a scan makes in a rule."""
    return re.sub(rb"(?<=\x01)\x00{1,3}(?=\x01)", lambda m: b"\x01" * len(m.group()), run)


def _longest(run: bytes) -> int:
    return max((len(part) for part in _bridged(run).split(b"\x00")), default=0)


def _clusters(values: list[int], gap: int = 3) -> list[int]:
    groups: list[list[int]] = []
    for value in values:
        if groups and value - groups[-1][-1] <= gap:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [round((group[0] + group[-1]) / 2) for group in groups]


def vertical_rules(grid: Grid) -> list[int]:
    candidates = [
        x
        for x in range(int(grid.width * EDGE), int(grid.width * (1 - EDGE)))
        if _longest(grid.column(x)) >= MIN_RULE
    ]
    return _clusters(candidates)


def horizontal_rules(grid: Grid, left: int, right: int) -> list[int]:
    need = max(120, int((right - left) * MIN_ROW))
    candidates = [
        y
        for y in range(int(grid.height * EDGE), int(grid.height * (1 - EDGE)))
        if _longest(grid.row(y)[left:right]) >= need
    ]
    return _clusters(candidates)


def _ink_share(grid: Grid, x0: int, x1: int, y0: int, y1: int, *, vertical: bool) -> float:
    """Share of the edge (x0..x1 × y0..y1, one side thin) that has ink within two pixels across it."""
    if vertical:
        length = y1 - y0
        if length <= 0:
            return 0.0
        hits = 0
        for y in range(y0, y1):
            if grid.data[y * grid.width + x0 - 2 : y * grid.width + x0 + 3].count(1):
                hits += 1
        return hits / length
    length = x1 - x0
    if length <= 0:
        return 0.0
    hits = 0
    for x in range(x0, x1):
        if any(grid.data[(y0 + dy) * grid.width + x] for dy in range(-2, 3)):
            hits += 1
    return hits / length


def find_cells(grid: Grid) -> tuple[list[Cell], tuple[int, int, int, int]] | None:
    """The cells of the page's ruled table and the table's box, or None when the page has no table."""
    xs = vertical_rules(grid)
    if len(xs) < 2:
        return None
    left, right = xs[0], xs[-1]
    ys = horizontal_rules(grid, left, right)
    if len(ys) < 2:
        return None
    # the table's top and bottom: the first and the last rule across it
    top, bottom = ys[0], ys[-1]
    if right - left < grid.width * 0.3 or bottom - top < grid.height * 0.05:
        return None
    rows = len(ys) - 1
    cols = len(xs) - 1
    parent = list(range(rows * cols))

    def find(item: int) -> int:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def join(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    for r in range(rows):
        for c in range(cols):
            if c + 1 < cols:
                share = _ink_share(
                    grid, xs[c + 1], xs[c + 1] + 1, ys[r] + 3, ys[r + 1] - 3, vertical=True
                )
                if share < BORDER:
                    join(r * cols + c, r * cols + c + 1)
            if r + 1 < rows:
                share = _ink_share(
                    grid, xs[c] + 3, xs[c + 1] - 3, ys[r + 1], ys[r + 1] + 1, vertical=False
                )
                if share < BORDER:
                    join(r * cols + c, (r + 1) * cols + c)
    members: dict[int, list[tuple[int, int]]] = {}
    for r in range(rows):
        for c in range(cols):
            members.setdefault(find(r * cols + c), []).append((r, c))
    cells: list[Cell] = []
    for group in members.values():
        r0 = min(r for r, _ in group)
        r1 = max(r for r, _ in group)
        c0 = min(c for _, c in group)
        c1 = max(c for _, c in group)
        box = (xs[c0] + INSET, ys[r0] + INSET, xs[c1 + 1] - INSET, ys[r1 + 1] - INSET)
        if box[2] - box[0] < 8 or box[3] - box[1] < 8:
            continue
        cells.append(Cell(r0, c0, r1 - r0 + 1, c1 - c0 + 1, box))
    if len(cells) < MIN_CELLS:
        return None
    cells.sort(key=lambda cell: (cell.row, cell.col))
    return cells, (left, top, right, bottom)


def render_upright(
    document: Any, page: int, *, zoom: float = ZOOM, dark: int = DARK
) -> tuple[Any, Grid]:
    """The page (of an open PyMuPDF document) as a grey pixmap turned back by its own tilt, and its ink grid."""
    import pymupdf

    sheet = document[page - 1]

    def render(angle: float) -> Any:
        matrix = pymupdf.Matrix(zoom, zoom)
        if angle:
            matrix = matrix.prerotate(angle)
        return sheet.get_pixmap(matrix=matrix, colorspace=pymupdf.csGRAY)

    def grid_of(pixmap: Any) -> Grid:
        table = bytes(1 if value < dark else 0 for value in range(256))
        return Grid(pixmap.width, pixmap.height, pixmap.samples.translate(table))

    first = render(0.0)
    grid = grid_of(first)
    angle = skew_degrees(grid)
    if abs(angle) < 0.05:
        return first, grid
    turned = render(angle)
    return turned, grid_of(turned)


TRIM_MARGIN: Final = 30
"""Pixels of paper kept around the ink of a cell: a lone digit in a tall cell is read only when cropped to it."""


def _trimmed(
    grid: Grid, box: tuple[int, int, int, int], margin: int = TRIM_MARGIN
) -> tuple[int, int, int, int]:
    """The cell's box cut to its ink (rules that are left at the edge do not count as ink)."""
    left, top, right, bottom = box
    width = right - left
    inked: list[int] = []
    lefts: list[int] = []
    rights: list[int] = []
    for y in range(top, bottom):
        row = grid.data[y * grid.width + left : y * grid.width + right]
        count = row.count(1)
        if 1 <= count < width * 0.9:
            inked.append(y)
            lefts.append(row.find(1))
            rights.append(row.rfind(1))
    if not inked:
        return left, top, min(right, left + 16), min(bottom, top + 16)
    return (
        max(left, left + min(lefts) - margin),
        max(top, inked[0] - margin),
        min(right, left + max(rights) + 1 + margin),
        min(bottom, inked[-1] + 1 + margin),
    )


def _add_crop(
    out: Any,
    pixmap: Any,
    box: tuple[int, int, int, int],
    *,
    pad: float = PAD,
    scale: float = 1.0,
    min_width: float = PAGE_MIN_WIDTH,
) -> None:
    """One page of the cells PDF: the crop of `box` on paper of at least `min_width` points."""
    import pymupdf

    left, top, right, bottom = box
    rows = [
        pixmap.samples[y * pixmap.width + left : y * pixmap.width + right]
        for y in range(top, bottom)
    ]
    crop = pymupdf.Pixmap(pymupdf.csGRAY, right - left, bottom - top, b"".join(rows), False)
    width_pt = (right - left) / ZOOM * scale
    height_pt = (bottom - top) / ZOOM * scale
    page = out.new_page(
        width=max(min_width, width_pt + 2 * pad),
        height=max(PAGE_MIN_HEIGHT, height_pt + 2 * pad),
    )
    page.insert_image(
        pymupdf.Rect(pad, pad, pad + width_pt, pad + height_pt),
        stream=crop.tobytes("png"),
    )


def cells_pdf(
    source: Callable[[int], Any], pages: list[int], target: Path
) -> tuple[dict[int, dict[str, Any]], list[tuple[int, int]]]:
    """Write the crops of every cell of the tables of `pages` as the pages of `target`.

    `source(page)` is the open PyMuPDF document that holds the page upright.
    Returns the layout per page (the table's box and its cells, pixels at ZOOM, with the image size and the
    ink of each cell) and the list (page, cell index) in the order of the pages of `target`.
    """
    import pymupdf

    out = pymupdf.open()
    layout: dict[int, dict[str, Any]] = {}
    order: list[tuple[int, int]] = []
    for number in pages:
        pixmap, grid = render_upright(source(number), number)
        found = find_cells(grid)
        if found is None:
            continue
        cells, table = found
        layout[number] = {
            "width": grid.width,
            "height": grid.height,
            "table": list(table),
            "cells": [
                {
                    "row": c.row,
                    "col": c.col,
                    "rowSpan": c.row_span,
                    "colSpan": c.col_span,
                    "box": list(c.box),
                    "ink": grid.ink(c.box[0], c.box[2], c.box[1], c.box[3]),
                }
                for c in cells
            ],
        }
        for index, cell in enumerate(cells):
            ink = _trimmed(grid, cell.box, 0)
            if ink[2] - ink[0] < SMALL_WIDTH and ink[3] - ink[1] < SMALL_HEIGHT:
                _add_crop(out, pixmap, _trimmed(grid, cell.box), pad=PAD_SMALL)
            else:
                _add_crop(out, pixmap, _trimmed(grid, cell.box, 12), min_width=PAGE_MIN_WIDTH_TEXT)
            order.append((number, index))
    out.save(target, garbage=3, deflate=True)
    return layout, order


RETRIES: Final = ((30, 100.0, 2.0), (90, 12.0, 1.0), (60, 60.0, 3.0), (0, 100.0, 1.0))
"""(margin of the trim in pixels, margin of the page in points, scale) of the second attempts at a cell."""
MIN_INK: Final = 40
"""A cell with less ink than this (pixels) is empty."""


def retry_pdf(
    source: Callable[[int], Any],
    layout: dict[int, dict[str, Any]],
    wanted: list[tuple[int, int]],
    target: Path,
) -> list[tuple[int, int]]:
    """Several different crops of each (page, cell) that Vision read as empty although it holds ink.

    Vision skips a lone digit in some layouts and reads it in others; the pages of `target` are the attempts
    of each cell in the order of `RETRIES`. Returns the (page, cell index) of every page.
    """
    import pymupdf

    out = pymupdf.open()
    order: list[tuple[int, int]] = []
    rendered: dict[int, tuple[Any, Grid]] = {}
    for number, index in wanted:
        if number not in rendered:
            rendered[number] = render_upright(source(number), number)
        pixmap, grid = rendered[number]
        box = tuple(layout[number]["cells"][index]["box"])
        for margin, pad, scale in RETRIES:
            crop = _trimmed(grid, box, margin) if margin else box  # pyright: ignore[reportArgumentType]
            _add_crop(out, pixmap, crop, pad=pad, scale=scale)
            order.append((number, index))
    out.save(target, garbage=3, deflate=True)
    return order


def merge_lines(
    lines: list[dict[str, Any]], layout: dict[str, Any], cells: list[list[str]]
) -> list[str]:
    """The page's Vision lines with the table's lines replaced by its cells, row-major.

    `lines` are the page's ordinary Vision lines (text, bbox as fractions of the page, origin bottom-left),
    `layout` the page's entry from `cells_pdf`, `cells` the lines read in each cell.
    """
    left, top, right, bottom = layout["table"]
    width, height = layout["width"], layout["height"]
    above: list[str] = []
    below: list[str] = []
    for line in lines:
        x, y, w, h = line["bbox"]
        centre_x = (x + w / 2) * width
        centre_y = (1 - (y + h / 2)) * height
        inside = left - 4 <= centre_x <= right + 4 and top - 4 <= centre_y <= bottom + 4
        if inside:
            continue
        (above if centre_y < top else below).append(str(line["text"]))
    body = [text for cell in cells for text in cell]
    return [*above, *body, *below]


def _joined(lines: list[str]) -> str:
    """The lines of a cell as one text; a line that ends with a hyphen is joined to the next without a space."""
    text = ""
    for line in lines:
        piece = line.strip()
        if not piece:
            continue
        text = piece if not text else (text + piece if text.endswith("-") else f"{text} {piece}")
    return text


def _same_text(text: str) -> str:
    """A cell's text for comparison: letters and digits only, look-alike letters and case folded."""
    from .legal_reconcile import _fold

    return re.sub(r"[^0-9a-zа-я]", "", _fold(text))


def marker_cells(markdown: str) -> list[str]:
    """The non-empty cells of every table of Marker's Markdown, in reading order."""
    from .legal_reconcile import LINE_BREAK_IN_CELL, clean_marker_markdown

    cells: list[str] = []
    for line in clean_marker_markdown(markdown).splitlines():
        stripped = line.strip()
        if not stripped.startswith("|") or re.fullmatch(r"\|[\s:|-]+\|?", stripped):
            continue
        inner = stripped[1:]
        inner = inner[:-1] if inner.endswith("|") and not inner.endswith("\\|") else inner
        for cell in re.split(r"(?<!\\)\|", inner):
            text = cell.replace(LINE_BREAK_IN_CELL, " ").strip()
            if text:
                cells.append(text)
    return cells


UNREAD: Final = "?"
"""The text of a cell with ink that Vision read as empty (a lone digit it cannot read)."""
_LONE_NUMBER: Final = re.compile(r"\d{1,3}|[-–—]")


def harmonize(
    markdown: str, cells: list[list[str]], inked: list[bool] | None = None
) -> list[list[str]]:
    """The cell readings of a page where the cells that agree with Marker's table carry Marker's text.

    The two readings of a table are compared cell by cell (letters and digits only): a cell that both readings
    give alike is one reading, so Vision's line breaks, hyphen wraps and small slips in it are no difference.
    What does not agree stays Vision's text, and the page's ordinary comparison flags it. A cell that holds ink
    but that Vision cannot read stands for Marker's lone number at its place (`inked` says which cells have ink).
    """
    from difflib import SequenceMatcher

    marker = marker_cells(markdown)
    vision = [
        (index, _joined(lines) or (UNREAD if inked and inked[index] else ""))
        for index, lines in enumerate(cells)
    ]
    vision = [(index, text) for index, text in vision if text]
    matcher = SequenceMatcher(
        None,
        [_same_text(text) for _, text in vision],
        [_same_text(text) for text in marker],
        autojunk=False,
    )
    result = [list(lines) for lines in cells]
    for tag, a1, a2, b1, b2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(a2 - a1):
                result[vision[a1 + offset][0]] = [marker[b1 + offset]]
        elif tag == "replace":
            group_vision = " ".join(vision[i][1] for i in range(a1, a2))
            group_marker = " ".join(marker[j] for j in range(b1, b2))
            if _agrees(group_vision, group_marker):  # the readings cut the cells differently
                result[vision[a1][0]] = [group_marker]
                for i in range(a1 + 1, a2):
                    result[vision[i][0]] = []
                continue
            at = b1
            for i in range(a1, a2):  # cells that differ only in letters (a slip of either reading)
                for j in range(at, b2):
                    if _agrees(vision[i][1], marker[j]):
                        result[vision[i][0]] = [marker[j]]
                        at = j + 1
                        break
    return result


AGREE: Final = 0.8
"""Similarity of two cells' letters at which the cells are taken as the same text (their numbers must be equal)."""


def _agrees(vision: str, marker: str) -> bool:
    """Whether Vision's cell and Marker's cell are one text: the same, or the same numbers and nearly the same letters."""
    from difflib import SequenceMatcher

    if vision == UNREAD:
        return bool(_LONE_NUMBER.fullmatch(marker.strip()))
    a, b = _same_text(vision), _same_text(marker)
    if a == b:
        return True
    if not a or not b or re.findall(r"\d+", a) != re.findall(r"\d+", b):
        return False
    return SequenceMatcher(None, a, b, autojunk=False).ratio() >= AGREE


def read_cells(
    layout_path: Path, vision_path: Path, retry_path: Path | None = None
) -> dict[int, tuple[dict[str, Any], list[list[str]]]]:
    """Per page: its layout and the lines Vision read in each cell (in the order of the layout's cells).

    A cell Vision read as empty takes the first attempt of the second run (`retry_pdf`) that read something.
    """
    import json

    saved = json.loads(layout_path.read_text(encoding="utf-8"))
    pages = json.loads(vision_path.read_text(encoding="utf-8"))["pages"]
    texts: dict[int, dict[int, list[str]]] = {}
    for entry, (number, index) in zip(pages, saved["order"], strict=True):
        texts.setdefault(number, {})[index] = [str(line["text"]) for line in entry.get("lines", [])]
    if retry_path is not None and retry_path.exists():
        again = json.loads(retry_path.read_text(encoding="utf-8"))["pages"]
        for entry, (number, index) in zip(again, saved.get("retryOrder", []), strict=True):
            found = [str(line["text"]) for line in entry.get("lines", [])]
            if found and not texts[number][index]:
                texts[number][index] = found
    return {
        int(number): (layout, [texts[int(number)].get(i, []) for i in range(len(layout["cells"]))])
        for number, layout in saved["layout"].items()
    }


def cell_pairs(layout: dict[str, Any]) -> list[tuple[int, int, int, int]]:
    """(row, col, row span, col span) of each cell of a page's layout."""
    return [(c["row"], c["col"], c["rowSpan"], c["colSpan"]) for c in layout["cells"]]


__all__ = [
    "Cell",
    "cell_pairs",
    "cells_pdf",
    "find_cells",
    "harmonize",
    "marker_cells",
    "merge_lines",
    "read_cells",
    "render_upright",
    "retry_pdf",
]
