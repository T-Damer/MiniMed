"""Shared reading of order 1094н of 24.11.2021: the three prescription blanks.

Order of Минздрав России № 1094н (Минюст 30.11.2021 № 66124, eoNumber 0001202111300115, 43 PDF
pages). Appendix 2 prints the blanks one after another on PDF pages 23–26 (a blank starts under the
reverse side of the previous one, so a page is shared by two forms); the requirements for their
lines are not in that appendix but in appendix 3 «Порядок оформления рецептурных бланков …»
(PDF pages 27–34, paragraphs 1–18 for the paper blank) and appendix 1 «Порядок назначения
лекарственных препаратов» (PDF pages 6–17). The two appendices number their paragraphs
independently, so the schema ids are `<appendix>.<paragraph>` (`medical_forms.RulesSection`).

Form modules: `medical_form_107_1u`, `medical_form_148_1u_88`, `medical_form_148_1u_04l`. This
module holds what they share: the order, the reviewed OCR fixes of the cited paragraphs, the
paragraph numbers, the common fields and the `mask-scan` tool that cuts the scan page of one form
out of a page that holds two (the layout check compares a form with its own share of the scan).
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any, Final

import pymupdf

from localmed_ingest.medical_forms import (
    DEFAULT_RAW,
    Correction,
    RulesSection,
    load_blueprint,
)

EO_NUMBER: Final = "0001202111300115"
ORDER_NUMBER: Final = "1094н"
ORDER_DATE: Final = "2021-11-24"
ORDER_TITLE: Final = (
    "Об утверждении Порядка назначения лекарственных препаратов, форм рецептурных бланков на "
    "лекарственные препараты, Порядка оформления указанных бланков, их учета и хранения, форм "
    "бланков рецептов, содержащих назначение наркотических средств или психотропных веществ, "
    "Порядка их изготовления, распределения, регистрации, учета и хранения, а также Правил "
    "оформления бланков рецептов, в том числе в форме электронных документов"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "66124",
    "date": "2021-11-30",
}
# Clause 4 of the order (PDF page 5): in force from 1 March 2022, valid until 1 March 2028.
EFFECTIVE_FROM: Final = "2022-03-01"
EFFECTIVE_UNTIL: Final = "2028-03-01"

BLANK_APPENDIX: Final = 2
# «Порядок оформления рецептурных бланков …» — the primary rules appendix of the three blanks.
RULES_APPENDIX: Final = 3
RULES_PAGES: Final = (27, 28, 29, 30, 31, 32, 33, 34)
RULES_TITLE: Final = "Порядок оформления рецептурных бланков на лекарственные препараты"
ORDER_OF_PRESCRIBING: Final = RulesSection(
    1,
    "Порядок назначения лекарственных препаратов",
    (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17),
)

# Footnotes sit under this share of the page height (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {
    6: 0.15,
    7: 0.2,
    8: 0.22,
    9: 0.135,
    10: 0.09,
    13: 0.09,
    14: 0.085,
    15: 0.09,
    16: 0.12,
    28: 0.19,
    29: 0.115,
    30: 0.14,
    31: 0.1,
    32: 0.09,
    34: 0.2,
}

_FOOTNOTE_MARK = "footnote reference mark recognised as punctuation"
_LOOKALIKE = "Latin letters recognised for the Cyrillic ones of the same shape"
_DASH = "typographic en dash printed between words, recognised as a hyphen"
_LOST = "word or sign dropped or misread by the recogniser"
_CASE = "capital letters recognised for a lower-case word"

# Reviewed against the scan (PDF pages 11–13 and 27–30), word by word. The OCR text corrections
# apply to the cited paragraphs that touch the page; the ones that change nothing in a paragraph
# are not logged for it.
CORRECTIONS: Final[tuple[Correction, ...]] = tuple(
    [Correction(page, " - ", " – ", _DASH) for page in (11, 12, 13, 27, 28, 29, 30)]
    + [Correction(page, "/y", "/у", _LOOKALIKE) for page in (12, 13, 27, 28, 29, 30)]
    + [
        Correction(
            12, "подпунктами 1-3", "подпунктами 1–3", "en dash of a range, recognised as a hyphen"
        ),
        Correction(
            13,
            "гражданам, препаратов страдающим",
            "гражданам, страдающим",
            "fragment of the previous line merged into this one",
        ),
        Correction(
            13,
            "работи работника",
            "работника",
            "fragment of the next printed line merged into this word",
        ),
        Correction(13, 'деятельность" (', "деятельность (", _FOOTNOTE_MARK),
        Correction(27, "субьекта", "субъекта", "OCR confuses ъ and ь"),
        Correction(28, "помощи»! *, И код", "помощи», и код", _FOOTNOTE_MARK),
        Correction(28, "иной % 3])", "иной % [3])", "opening bracket dropped"),
        Correction(28, "пОМОЩЬ", "помощь", _CASE),
        Correction(
            29, "препарата международное", "препарата (международное", "opening parenthesis dropped"
        ),
        Correction(29, "НПI);", "НП);", _FOOTNOTE_MARK),
        Correction(
            29,
            "Федерации*",
            "Федерации.",
            "footnote mark recognised as an asterisk; the sentence ends with a full stop",
        ),
        Correction(29, "«для рецептов»", "«Для рецептов»", _CASE),
        Correction(29, "NOSA", "N05A", "digit 5 recognised as letter S, zero as letter O"),
        Correction(29, "NOSB", "N05B", "digit 5 recognised as letter S, zero as letter O"),
        Correction(29, "NOSC", "N05C", "digit 5 recognised as letter S, zero as letter O"),
        Correction(29, "NO6A", "N06A", "zero recognised as letter O"),
        Correction(29, "ATX", "АТХ", _LOOKALIKE),
        Correction(
            30,
            " II. Оформление рецепта в форме электронного документа",
            "",
            "heading of the next part of the appendix, not part of the paragraph",
        ),
    ]
)

# Whole printed lines that the recogniser cut short: the full stop and the footnote mark of the
# last line of a paragraph.
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(
        29,
        "медицинскую помощь в амбулаторных условиях",
        "медицинскую помощь в амбулаторных условиях.",
        "full stop dropped after the footnote mark",
    ),
    Correction(
        29,
        "вышеуказанным ATX",
        "вышеуказанным ATX.",
        "full stop dropped after the last word of the paragraph",
    ),
)


# ------------------------------------------------------------------------------ the fields
# The requirements of the order for one printed line cite paragraphs of two appendices.


def p3(clause: int) -> str:
    """Schema id of paragraph `clause` of appendix 3 (the primary rules appendix)."""
    return f"3.{clause}"


def p1(clause: int) -> str:
    """Schema id of paragraph `clause` of appendix 1 (the order of prescribing)."""
    return f"1.{clause}"


SURNAME_INITIALS_NOTE: Final = (
    "Графа требует фамилию и инициалы имени и отчества; подставляется из полного имени."
)


def blueprint_kwargs() -> dict[str, Any]:
    """Arguments of `FormBlueprint` that are the same for the three blanks."""
    return {
        "order_number": ORDER_NUMBER,
        "order_date": ORDER_DATE,
        "order_title": ORDER_TITLE,
        "registration": dict(REGISTRATION),
        "effective_from": EFFECTIVE_FROM,
        "effective_until": EFFECTIVE_UNTIL,
        "blank_appendix": BLANK_APPENDIX,
        "rules_appendix": RULES_APPENDIX,
        "rules_pages": RULES_PAGES,
        "rules_title": RULES_TITLE,
        "extra_rules": (ORDER_OF_PRESCRIBING,),
        "footnote_below": dict(FOOTNOTE_BELOW),
        "corrections": CORRECTIONS,
        "row_corrections": ROW_CORRECTIONS,
        "code_lists": {},
        "sequential_lists": {},
    }


FORM_TEXT_NOTES: Final[list[str]] = [
    "Печатная форма — черновик-образец для врача, а не бланк: рецептурные бланки изготавливает и "
    "учитывает медицинская организация (приложение № 3: бланки 107-1/у и 148-1/у-04(л) "
    "разрешено изготавливать с помощью компьютерных технологий, бланк 148-1/у-88 — только "
    "типографским способом, п. 1; организации получают оформленные типографским способом "
    "бланки через территориальные органы управления здравоохранением или уполномоченные "
    "организации, п. 27). Распечатка приложения не заменяет бланк и юридической силы не имеет.",
    "Приказ не указывает размер этих бланков. Страница воспроизведена так, как напечатана в "
    "приказе (лист А4, бланк расположен на странице приложения № 2 так же, как на скане): "
    "бланки в приложении идут один за другим, поэтому оборотная сторона предыдущего бланка и "
    "начало следующего делят с ним страницу.",
    "Бланки заполняются медицинским работником чернилами или шариковой ручкой (п. 3 "
    "приложения № 3); допускается оформление всех реквизитов, кроме подписи, с использованием "
    "печатающих устройств (п. 4). Исправления в рецепте не допускаются (п. 16).",
    "Приказ действует с 01.03.2022 по 01.03.2028 (п. 4 приказа; п. 2 признаёт утратившими силу, "
    "в частности, приказы Минздрава России от 14.01.2019 № 4н и от 01.08.2012 № 54н).",
    "Латинские обозначения (Rp., D.t.d., Signa) напечатаны на бланке и сохранены как в приказе.",
]


def pharmacy_table(
    field_ids: tuple[str, str, str], head_mm: float = 8.9, body_mm: float = 8.3
) -> dict[str, Any]:
    """The «Приготовил / Проверил / Отпустил» table of the reverse side (pharmacy cells)."""
    return {
        "kind": "table",
        "header": [[{"text": "Приготовил"}, {"text": "Проверил"}, {"text": "Отпустил"}]],
        "rows": [list(field_ids)],
        "columnWeights": [284, 308, 256],
        "headHeightMm": head_mm,
        "rowHeightMm": body_mm,
    }


def reverse_blocks(
    field_ids: tuple[str, str, str],
    content_mm: float,
    top_space: float = 0.0,
    *,
    box_mm: float = 26.6,
    head_mm: float = 8.9,
    body_mm: float = 8.3,
    table_gap: float = 0.0,
    page_break: bool = True,
    box_width_mm: float = 82.8,
    right_inset_mm: float = 0.0,
    table_width_mm: float | None = None,
) -> list[dict[str, Any]]:
    """The reverse side: «Оборотная сторона», the mark of the врачебная комиссия, the table."""
    top = {
        "id": "reverse-top",
        **({"pageBreakBefore": True} if page_break else {}),
        "columns": [
            {
                "widthPercent": 40
                if not right_inset_mm
                else pct(content_mm - right_inset_mm - box_width_mm, content_mm),
                "rows": [{"segments": [{"kind": "text", "text": "Оборотная сторона"}]}],
            },
            {
                "widthPercent": pct(box_width_mm, content_mm),
                "align": "center",
                "rows": [
                    {
                        "segments": [
                            {
                                "kind": "stamp",
                                "fieldId": "commissionMark",
                                "text": (
                                    "Отметка о назначении лекарственного\n"
                                    "препарата по решению врачебной комиссии"
                                ),
                            }
                        ],
                        "align": "center",
                        "box": "outline",
                        "minHeightMm": box_mm,
                        "paddingTopMm": 2.2,
                    }
                ],
            },
        ],
    }
    if right_inset_mm:
        top["columns"].append(
            {
                "widthPercent": pct(right_inset_mm, content_mm),
                "rows": [{"segments": [{"kind": "text", "text": ""}]}],
            }
        )
        top["columnGapMm"] = 0
    if page_break:
        first_row_space(top, top_space)
    return [
        top,
        {
            "id": "reverse-table",
            "columns": [
                {
                    "widthPercent": pct(table_width_mm, content_mm) if table_width_mm else 100,
                    "rows": [
                        {
                            "segments": [pharmacy_table(field_ids, head_mm, body_mm)],
                            **({"spaceBeforeMm": table_gap} if table_gap else {}),
                        }
                    ],
                }
            ],
        },
    ]


# ---------------------------------------------------------------- layout segments of the blanks


def t(
    value: str,
    *,
    indent: float | None = None,
    small: bool = False,
    joined: bool = False,
    underline: bool = False,
    large: bool = False,
) -> dict[str, Any]:
    """A printed text segment; `indent` is the space before it on the line (mm)."""
    segment: dict[str, Any] = {"kind": "text", "text": value}
    if small:
        segment["small"] = True
    if underline:
        segment["underline"] = True
    if large:
        segment["large"] = True
    if joined:
        segment["joined"] = True
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def plain_field(field_id: str, length: float = 12, *, grow: bool = False) -> dict[str, Any]:
    """A value placed in an unruled area (the stamp, a code after its caption)."""
    segment: dict[str, Any] = {"kind": "field", "fieldId": field_id, "length": length}
    segment["plain"] = True
    if grow:
        segment["grow"] = True
    return segment


def rule(
    length: float = 40, *, style: str | None = None, indent: float | None = None
) -> dict[str, Any]:
    """A printed line that grows to the width of its column."""
    segment: dict[str, Any] = {"kind": "rule", "length": length, "grow": True}
    if style:
        segment["lineStyle"] = style
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def ruled_field(
    field_id: str, lines: int, *, style: str = "dotted", pitch: float | str = "text"
) -> dict[str, Any]:
    """A field written on `lines` dotted lines `pitch` apart (mm, or one text line)."""
    return {
        "kind": "field",
        "fieldId": field_id,
        "length": 40,
        "lines": lines,
        "lineStyle": style,
        "pitch": pitch,
    }


def aligned(layout_row: dict[str, Any], valign: str) -> dict[str, Any]:
    """Where the items of the row sit across its height: top, center or bottom."""
    layout_row["valign"] = valign
    return layout_row


def scaled(layout_row: dict[str, Any], factor: float) -> dict[str, Any]:
    """The row set in a smaller (or larger) type: a multiple of the page font."""
    layout_row["fontScale"] = factor
    return layout_row


def tight(layout_row: dict[str, Any], height_mm: float) -> dict[str, Any]:
    """The row with an exact height (the blank sets these lines closer than a text line)."""
    layout_row["heightMm"] = height_mm
    return layout_row


def cells(
    field_id: str,
    count: int,
    width: float,
    *,
    height: float | None = None,
    part: str | None = None,
    indent: float | None = None,
    drop: float | None = None,
    digits: bool = False,
) -> dict[str, Any]:
    """A value written one character per ruled cell."""
    spec: dict[str, Any] = {"count": count, "widthMm": width}
    if height is not None:
        spec["heightMm"] = height
    if drop is not None:
        spec["dropMm"] = drop
    if digits:
        spec["digitsOnly"] = True
    segment: dict[str, Any] = {
        "kind": "field",
        "fieldId": field_id,
        "length": count,
        "charCells": spec,
    }
    if part:
        segment["part"] = part
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def boxes(
    count: int, width: float, *, height: float | None = None, indent: float | None = None
) -> dict[str, Any]:
    """Empty ruled cells the blank prints with no field of their own."""
    segment: dict[str, Any] = {"kind": "boxes", "count": count, "widthMm": width}
    if height is not None:
        segment["heightMm"] = height
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def opts(
    field_id: str,
    *,
    only: tuple[int, int] | None = None,
    joined: bool = False,
    codes: bool = False,
    separator: str = ", ",
) -> dict[str, Any]:
    """The choices of a field with the picked one underlined («нужное подчеркнуть»)."""
    segment: dict[str, Any] = {
        "kind": "options",
        "fieldId": field_id,
        "separator": separator,
        "mark": "underline",
    }
    if not codes:
        segment["codes"] = False
    if only:
        segment["range"] = list(only)
    if joined:
        segment["joined"] = True
    return segment


def pct(width_mm: float, content_mm: float) -> float:
    """Width as a percentage of the content width (page width less the side margins)."""
    return round(width_mm / content_mm * 100, 1)


def column(width: float, *rows: dict[str, Any], align: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"widthPercent": width, "rows": list(rows)}
    if align:
        result["align"] = align
    return result


def block(
    block_id: str,
    *columns: dict[str, Any],
    page_break: bool = False,
    gap: float | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"id": block_id, "columns": list(columns)}
    if page_break:
        result["pageBreakBefore"] = True
    if gap is not None:
        result["columnGapMm"] = gap
    return result


def first_row_space(layout_block: dict[str, Any], *space_mm: float) -> None:
    """Space above the first row of the columns of a block: the page's own top position.

    The layout calibration never spaces the first row of a page, so a blank that starts lower
    on the scan page (under the reverse side of the previous one) carries its position here: one
    value for every column, or one per column.
    """
    for index, one_column in enumerate(layout_block["columns"]):
        one_column["rows"][0]["spaceBeforeMm"] = space_mm[index if len(space_mm) > 1 else 0]


# ------------------------------------------------------------ the scan page of one form only

# Lines the recogniser merged across two printed lines (one box spanning both), split for the
# layout check only: (PDF page, text of the merged line) -> the printed lines with their boxes
# [x, y, width, height] (share of the page, origin at the bottom) measured on the scan. The
# committed schemas never use these boxes.
OCR_LINE_SPLITS: Final[dict[tuple[int, str], list[tuple[str, list[float]]]]] = {
    (
        23,
        "Рецент действителен в точение 60 дней, до 1 года (указать количсство дней)",
    ): [
        ("Рецент действителен в точение 60 дней, до 1 года (", [0.2225, 0.1418, 0.4192, 0.0162]),
        ("(указать количсство дней)", [0.6417, 0.1246, 0.2085, 0.0162]),
    ],
}


def _split_merged_lines(page_number: int, lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for line in lines:
        parts = OCR_LINE_SPLITS.get((page_number, str(line["text"])))
        if parts is None:
            result.append(line)
            continue
        result.extend({**line, "text": text, "bbox": bbox} for text, bbox in parts)
    return result


def mask_scan(key: str, out_dir: Path, raw: Path = DEFAULT_RAW) -> Path:
    """Copy of the raw order in which the pages of one form show only the form's own share.

    The layout check (`medical_form_overlay`) compares a form with the whole scan page; the
    blanks of order 1094н share pages, so the rest of the page (another blank, the appendix
    heading) is painted white and its OCR lines are dropped. Positions on the page do not change.
    Use the result as `--raw` of `check` and `calibrate`; the committed schema is always built from
    the real raw files.
    """
    blueprint = load_blueprint(key)
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(raw / f"{EO_NUMBER}.source.json", out_dir / f"{EO_NUMBER}.source.json")
    pdf = pymupdf.open(raw / f"{EO_NUMBER}.pdf")
    ocr = json.loads((raw / f"{EO_NUMBER}.ocr.json").read_text(encoding="utf-8"))
    for number, (low, high) in blueprint.blank_regions.items():
        page = pdf[number - 1]
        width, height = page.rect.width, page.rect.height
        white = (1, 1, 1)
        page.draw_rect(pymupdf.Rect(0, 0, width, (1 - high) * height), color=None, fill=white)
        page.draw_rect(pymupdf.Rect(0, (1 - low) * height, width, height), color=None, fill=white)
        for entry in ocr["pages"]:
            if int(entry["page"]) == number:
                entry["lines"] = _split_merged_lines(
                    number,
                    [
                        line
                        for line in entry["lines"]
                        if low <= line["bbox"][1] + line["bbox"][3] / 2 <= high
                    ],
                )
    pdf.save(out_dir / f"{EO_NUMBER}.pdf", garbage=3, deflate=True)
    (out_dir / f"{EO_NUMBER}.ocr.json").write_text(
        json.dumps(ocr, ensure_ascii=False), encoding="utf-8"
    )
    return out_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="medical_form_prescription", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    mask = sub.add_parser("mask-scan", help="raw copy showing only one form's share of its pages")
    mask.add_argument("--form", required=True, help="form key, e.g. 148-1u-88")
    mask.add_argument("--out", type=Path, required=True)
    mask.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    args = parser.parse_args(argv)
    print(mask_scan(args.form, args.out, args.raw))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
