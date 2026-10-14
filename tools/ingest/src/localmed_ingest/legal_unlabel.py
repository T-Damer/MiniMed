"""Two-column requirement tables: read the value column without its label column.

The qualification requirements of the Ministry of Health (orders 206n, 436n, 707n) are tables of rows
«Уровень профессионального образования | …», «Дополнительное профессиональное образование | …»,
«Должности | …». The label wraps over three short lines next to a long value, and both readers (Marker and
Vision) interleave the two columns, so label words end up inside the values («по одной профессионального
из специальностей»).

The labels are printed words known in advance, so they are painted white on a copy of the page before it is
read; the readers then see the value column only, and the rows are put back from the order of the paragraphs
(`row_labels`). Nothing but the three known labels is ever painted: a line of the left column that is not one
of them stops the run.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Final

LABEL_WORDS: Final = frozenset(
    {
        "уровень",
        "уровень.",
        "профессионального",
        "профессиональное",
        "профессиональноер",
        "образования",
        "образование",
        "дополнительное",
        "должности",
        "•",
    }
)
LABEL_LEFT: Final = 0.15
"""A label line starts left of this fraction of the page width."""
LABEL_RIGHT: Final = 0.305
"""The value column starts at 0.317; the label column is painted up to here."""
PADDING: Final = 0.004


def label_boxes(
    lines: list[dict[str, Any]], left: float = LABEL_LEFT
) -> tuple[list[tuple[float, float]], list[str]]:
    """(y bottom, y top) of every label line of a page (bottom-up fractions) and the left-edge lines that are not labels."""
    boxes: list[tuple[float, float]] = []
    foreign: list[str] = []
    for line in lines:
        x, y, _w, h = line["bbox"]
        if x >= left:
            continue
        words = re.findall(r"[^\s]+", re.sub(r"^[^\w•]+", "", str(line["text"]).lower()))
        if words and words[0] in LABEL_WORDS:
            boxes.append((y - PADDING, y + h + PADDING))
        else:
            foreign.append(str(line["text"])[:60])
    return boxes, foreign


def paint_labels(
    pdf_in: Path,
    vision_json: Path,
    pdf_out: Path,
    *,
    left: float = LABEL_LEFT,
    right: float = LABEL_RIGHT,
) -> dict[int, list[str]]:
    """Write `pdf_out`: the pages of `pdf_in` with the label column painted white. Returns the foreign left-edge lines per page."""
    import pymupdf

    vision = {
        int(page["page"]): page["lines"]
        for page in json.loads(vision_json.read_text(encoding="utf-8"))["pages"]
    }
    document = pymupdf.open(pdf_in)
    foreign: dict[int, list[str]] = {}
    for number in range(1, len(document) + 1):
        page = document[number - 1]
        boxes, odd = label_boxes(vision.get(number, []), left)
        if odd:
            foreign[number] = odd
        width, height = page.rect.width, page.rect.height
        for bottom, top in boxes:
            # Vision's boxes are in the page as it is shown (an upright copy of a sideways scan carries
            # a rotation); the drawing is done in the unrotated page.
            shown = pymupdf.Rect(
                0.07 * width, (1 - top) * height, right * width, (1 - bottom) * height
            )
            page.draw_rect(shown * page.derotation_matrix, color=None, fill=(1, 1, 1))
    document.save(pdf_out)
    return foreign


ROW_LEVEL: Final = "Уровень профессионального образования"
ROW_EXTRA: Final = "Дополнительное профессиональное образование"
ROW_POSITIONS: Final = "Должности"
EXTRA_START: Final = re.compile(
    r"^(?:Профессиональная переподготовка|Повышение квалификации|Программы повышения квалификации|"
    r"Программы профессиональной|Дополнительн)",
    re.IGNORECASE,
)


def row_labels(paragraphs: list[str]) -> list[str] | None:
    """The row label of each paragraph of one requirements block, or None when the block does not fit the pattern.

    The block is a level row (one or two paragraphs), an additional-education row (one or two) and a positions
    row (the last paragraph). The additional-education row starts at the first paragraph that opens with its
    usual words; a block without one, or with fewer than three paragraphs, is not labelled.
    """
    if len(paragraphs) < 3:
        return None
    start = next(
        (i for i, text in enumerate(paragraphs) if i > 0 and EXTRA_START.match(text)), None
    )
    if start is None or start >= len(paragraphs) - 1:
        return None
    labels = [ROW_LEVEL] * start
    labels += [ROW_EXTRA] * (len(paragraphs) - 1 - start)
    labels.append(ROW_POSITIONS)
    return labels


def job_row_labels(paragraphs: list[str]) -> list[str | None] | None:
    """Row labels of a «Должность «X»» block (a position of a specialist without a medical degree).

    The block has a level row, an additional-education row and, often, a printed row «Иные должности» that
    carries its own label (it is not painted: its first word is not one of the three labels). The paragraph
    that opens with «Иные должности» gets no label here (None); the others are labelled as in `row_labels`.
    """
    own = paragraphs and paragraphs[-1].startswith("Иные должности")
    body = paragraphs[:-1] if own else paragraphs
    if len(body) < 2:
        return None
    start = next((i for i, text in enumerate(body) if i > 0 and EXTRA_START.match(text)), None)
    if start is None:
        return None
    labels: list[str | None] = [ROW_LEVEL] * start
    labels += [ROW_EXTRA] * (len(body) - start)
    if own:
        labels.append(None)
    return labels
