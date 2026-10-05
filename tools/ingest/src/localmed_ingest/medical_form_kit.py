"""Shared building blocks of the reviewed form blueprints (order 274н of 13.05.2025).

Each form blueprint (`medical_form_070u`, `medical_form_072u`, …) is a human-reviewed reading of
one blank and of the paragraphs of its «Порядок заполнения». The layout segments, the field
constructor, the registration-address fields and the constants of the order are the same for all
of them and live here; the form modules hold only what is specific to the printed blank.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_forms import Correction

ORDER_NUMBER: Final = "274н"
ORDER_DATE: Final = "2025-05-13"
ORDER_TITLE: Final = (
    "Об утверждении унифицированных форм медицинской документации, используемых в медицинских "
    "организациях, оказывающих медицинскую помощь в амбулаторных условиях, и порядков их ведения"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "82433",
    "date": "2025-05-30",
}
EFFECTIVE_FROM: Final = "2025-09-01"
EFFECTIVE_UNTIL: Final = "2031-09-01"
EO_NUMBER: Final = "0001202505300033"

# ------------------------------------------------------------------------------ layout helpers


def text(value: str, *, bold: bool = False, small: bool = False) -> dict[str, Any]:
    segment: dict[str, Any] = {"kind": "text", "text": value}
    if bold:
        segment["bold"] = True
    if small:
        segment["small"] = True
    return segment


def blank(
    field_id: str,
    length: float,
    *,
    grow: bool = False,
    part: str | None = None,
    caption: str | None = None,
    lines: int | None = None,
) -> dict[str, Any]:
    segment: dict[str, Any] = {"kind": "field", "fieldId": field_id, "length": length}
    if lines:
        segment["lines"] = lines
    if grow:
        segment["grow"] = True
    if part:
        segment["part"] = part
    if caption:
        segment["caption"] = caption
    return segment


def options(
    field_id: str, separator: str = ", ", *, codes: bool = True, underline: bool = False
) -> dict[str, Any]:
    segment: dict[str, Any] = {"kind": "options", "fieldId": field_id, "separator": separator}
    if not codes:
        segment["codes"] = False
    if underline:
        segment["mark"] = "underline"
    return segment


def check(field_id: str) -> dict[str, Any]:
    return {"kind": "check", "fieldId": field_id}


def signature(field_id: str, length: float = 14) -> dict[str, Any]:
    return {"kind": "signature", "fieldId": field_id, "length": length, "caption": "подпись"}


def row(
    *segments: dict[str, Any],
    align: str | None = None,
    bold: bool = False,
    size: str | None = None,
    gap: str | None = None,
    box: str | None = None,
    split_percent: float | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"segments": list(segments)}
    if align:
        result["align"] = align
    if bold:
        result["bold"] = True
    if size:
        result["size"] = size
    if gap:
        result["gap"] = gap
    if box:
        result["box"] = box
    if split_percent is not None:
        result["splitPercent"] = split_percent
    return result


def date_blanks(
    field_id: str, *, month_length: float, year_length: float = 3
) -> list[dict[str, Any]]:
    """`«__» ______ 20__ г.` — one date field printed as three blanks."""
    return [
        text("«"),
        blank(field_id, 3, part="day"),
        text("»"),
        blank(field_id, month_length, part="month"),
        text("20"),
        blank(field_id, year_length, part="year2"),
    ]


# ---------------------------------------------------------------------------------- the fields


def field_rule(status: str, *paragraphs: str, note: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"status": status, "paragraphIds": list(paragraphs)}
    if note:
        result["note"] = note
    return result


def field_def(
    field_id: str,
    label: str,
    field_type: str,
    rule: dict[str, Any],
    *,
    required: bool | None = None,
    basis: str | None = None,
    anchor: str | None = None,
    printed: bool = True,
    prefill: dict[str, Any] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """A blueprint field; `anchor` is the printed phrase searched for on the blank page."""
    field: dict[str, Any] = {"id": field_id, "label": label, "type": field_type}
    if not printed:
        field["labelPrinted"] = False
    field["required"] = bool(required)
    if required:
        field["requiredBasis"] = basis or "source"
    field.update(extra)
    if prefill:
        field["prefill"] = prefill
    field["rule"] = rule
    field["_anchor"] = anchor if anchor is not None else (label if printed else None)
    return field


def address_fields(
    prefix: str, caption: str, path: str, paragraph_note: str, paragraph: str = "6.1"
) -> list[dict[str, Any]]:
    """The eight blanks of one registration address, bound to `patient.<path>.*`."""
    by_line = field_rule("by-line", paragraph, note=paragraph_note)
    specs = (
        ("Subject", "субъект Российской Федерации", "subject", True, 70, caption),
        ("District", "район", "district", False, 52, None),
        ("Locality", "населенный пункт", "locality", True, 28, None),
        ("Street", "улица", "street", False, 27, None),
        ("House", "дом", "house", False, 4, None),
        ("Building", "строение/корпус", "building", False, 4, None),
        ("Apartment", "квартира", "apartment", False, 6, None),
        ("Phone", "тел.", "phone", False, 20, None),
    )
    fields: list[dict[str, Any]] = []
    for suffix, label, part, required, _length, anchor in specs:
        fields.append(
            field_def(
                f"{prefix}{suffix}",
                label,
                "text",
                by_line,
                required=required,
                basis="editorial",
                anchor=anchor or label,
                prefill={"sources": [f"patient.{path}.{part}"]},
                maxLength=120,
            )
        )
    return fields


def code_field(
    field_id: str, label: str, anchor: str, paragraphs: tuple[str, ...], **extra: Any
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "choice",
        field_rule("defined", *paragraphs),
        anchor=anchor,
        **extra,
    )


ICD10_PATTERN: Final = "^[A-Z][0-9]{2}(?:\\.[0-9]{1,2})?$"
ICD10_MESSAGE: Final = "Код МКБ-10 в формате J45.0"
SNILS_PATTERN: Final = "^[0-9]{3}-[0-9]{3}-[0-9]{3} [0-9]{2}$"
UNDEFINED_SIGNATURE_NOTE: Final = (
    "Порядок не описывает подпись на бумажной форме; п. 8 говорит только о подписи электронной "
    "формы руководителем организации."
)


def address_rows(
    prefix: str, caption: str, district_length: float, street_length: float
) -> list[dict[str, Any]]:
    return [
        row(text(caption), blank(f"{prefix}Subject", 30, grow=True)),
        row(
            text("район"),
            blank(f"{prefix}District", district_length, grow=True),
            text("населенный пункт"),
            blank(f"{prefix}Locality", 28, grow=True),
        ),
        row(
            text("улица"),
            blank(f"{prefix}Street", street_length, grow=True),
            text("дом"),
            blank(f"{prefix}House", 4),
            text("строение/корпус"),
            blank(f"{prefix}Building", 4),
            text("квартира"),
            blank(f"{prefix}Apartment", 6),
            text("тел."),
            blank(f"{prefix}Phone", 20, grow=True),
        ),
    ]


# --------------------------------------------------------------------------- reviewed OCR fixes
# The code lists of the order (regions, climate, climatic factors, social-support categories)
# are printed the same way in appendices 6, 8, 10 and 12; the OCR slips are the same too.

FOOTNOTE_MARK: Final = "footnote reference mark recognised as punctuation"
DASH: Final = "typographic dash printed in the list, recognised as a hyphen"
LOOKALIKE: Final = "Latin letters recognised for the Cyrillic ones of the same shape"


def list_corrections(
    *,
    kuzbass: int,
    alania: int,
    ugra: int,
    climate: int,
    ussr: int | None = None,
) -> tuple[Correction, ...]:
    """Reviewed fixes of the printed code lists, keyed by the PDF page each text sits on."""
    fixes: list[Correction] = [
        Correction(kuzbass, "область - Кузбасс", "область – Кузбасс", DASH),
        Correction(alania, "Осетия - Алания", "Осетия – Алания", DASH),
        Correction(ugra, "округ- Югра", "округ – Югра", "spacing of the dash in the printed list"),
        Correction(climate, "морской - континентальный", "морской – континентальный", DASH),
    ]
    if ussr is not None:
        fixes.append(Correction(ussr, "CCCP", "СССР", LOOKALIKE))
    return tuple(fixes)


QUOTE_FIX_97: Final = "OCR renders the opening « of «97» as <"
