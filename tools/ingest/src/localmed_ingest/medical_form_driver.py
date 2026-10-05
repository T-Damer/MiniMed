"""Shared building blocks of the certificates for drivers (orders 1092н and 395н).

The certificate of a driver of a vehicle (003-В/у) and that of a tractor driver (071/у) are two
blanks of the same family: the same header with the licence lines, the same table of the results of
the specialists' examinations, the same «отсутствие (наличие)» lines, the same marks tables. The
layout helpers and the rows both blanks print identically live here; each form module holds what is
specific to its printed blank.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import blank, row, text

PAD: Final = "\u00a0"  # a non-breaking space pads a caption to the left edge of its blank

# The eight rows of the table «Результаты осмотров и обследований» (the same on both blanks):
# field id, the printed caption, the part of it that is searched for on the blank page.
RESULT_ROWS: Final[tuple[tuple[str, str, str], ...]] = (
    (
        "resultTherapist",
        "Осмотр врачом-терапевтом или осмотр врачом общей практики (семейным врачом)",
        "Осмотр врачом-терапевтом или осмотр врачом общей",
    ),
    ("resultOphthalmologist", "Осмотр врачом-офтальмологом", "Осмотр врачом-офтальмологом"),
    ("resultPsychiatrist", "Обследование врачом-психиатром", "Обследование врачом-психиатром"),
    (
        "resultNarcologist",
        "Обследование врачом-психиатром-наркологом",
        "Обследование врачом-психиатром-наркологом",
    ),
    ("resultNeurologist", "Осмотр врачом-неврологом", "Осмотр врачом-неврологом"),
    (
        "resultOtolaryngologist",
        "Осмотр врачом-оториноларингологом",
        "Осмотр врачом-оториноларингологом",
    ),
    ("resultInstrumental", "Инструментальное исследование", "Инструментальное исследование"),
    ("resultLaboratory", "Лабораторные исследования", "Лабораторные исследования"),
)
PRESENCE_OPTIONS: Final = [
    {"value": "absent", "label": "отсутствие"},
    {"value": "present", "label": "наличие"},
]
YES_NO_OPTIONS: Final = [{"value": "yes", "label": "да"}, {"value": "no", "label": "нет"}]
V_OPTION: Final = [{"value": "V", "label": "отмечено знаком «V»"}]


def joined(value: str) -> dict[str, Any]:
    """A text that continues the previous segment without a gap (`наличие` + `)`)."""
    return {**text(value), "joined": True}


def rule_seg(length: float, *, grow: bool = False) -> dict[str, Any]:
    """A ruled blank the form prints with nothing to fill in."""
    segment: dict[str, Any] = {"kind": "rule", "length": length}
    if grow:
        segment["grow"] = True
    return segment


def table(
    header: list[list[dict[str, Any]]],
    rows: list[list[Any]],
    weights: list[float] | None = None,
    row_height_mm: float | None = None,
    line_height: float | None = None,
) -> dict[str, Any]:
    segment: dict[str, Any] = {"kind": "table", "header": header, "rows": rows}
    if line_height is not None:
        segment["cellLineHeight"] = line_height
    if weights:
        segment["columnWeights"] = weights
    if row_height_mm is not None:
        segment["rowHeightMm"] = row_height_mm
    return segment


def column(rows: list[dict[str, Any]], width: float = 100, align: str = "left") -> dict[str, Any]:
    return {"widthPercent": width, "align": align, "rows": rows}


def date_row(label: str, field_id: str) -> dict[str, Any]:
    """`label число ____ месяц ____ год ____` — one date field printed as three blanks."""
    return row(
        text(label),
        text("число"),
        blank(field_id, 7, part="day"),
        text("месяц"),
        blank(field_id, 11, part="month"),
        text("год"),
        blank(field_id, 11, part="year"),
    )


def presence_rows(field_ids: tuple[str, str, str], object_text: str) -> list[dict[str, Any]]:
    """The three underlined «отсутствие (наличие) …» lines (противопоказаний, показаний,
    ограничений) of the blank, each closed by its own punctuation."""
    parts = (
        ("медицинских противопоказаний", ";"),
        ("медицинских показаний", ";"),
        ("медицинских ограничений", "."),
    )
    rows = []
    for field_id, (what, end) in zip(field_ids, parts, strict=True):
        rows.append(
            row(
                {
                    "kind": "options",
                    "fieldId": field_id,
                    "separator": " (",
                    "codes": False,
                    "mark": "underline",
                },
                joined(f") {what} к управлению {object_text}{end}"),
            )
        )
    return rows
