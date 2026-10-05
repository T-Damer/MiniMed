"""Reviewed blueprint of form 003-В/у «Медицинское заключение о наличии (об отсутствии) у водителей
транспортных средств (кандидатов в водители транспортных средств) медицинских противопоказаний,
медицинских показаний или медицинских ограничений к управлению транспортными средствами»
(Минздрав order № 1092н of 24.11.2021, Минюст № 66130 of 30.11.2021).

The order is 17 PDF pages: pages 1–3 the order, 4–10 appendix 1 (the procedure of the examination,
not a form), 11–14 appendix 2 (the procedure of issuing the certificate — the «filling rules»: the
lines of the blank are described in item 6 as sub-items «1)» … «11)»), 15–16 appendix 3 (the blank
itself), 17 the recommended sample of the register of issued certificates (not a form; not built).
The blank is one printed sheet: the scan breaks it over two PDF pages only because the heading of
the appendix takes the top of page 15.

Same method as `medical_form_070u`: every printed caption is located in the OCR text of the blank
(or confirmed on the scan and listed), every cited paragraph is cut from the OCR text of the order.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_driver import (
    PAD,
    PRESENCE_OPTIONS,
    RESULT_ROWS,
    V_OPTION,
    YES_NO_OPTIONS,
    column,
    date_row,
    presence_rows,
    rule_seg,
    table,
)
from localmed_ingest.medical_form_kit import (
    blank,
    date_blanks,  # noqa: F401  (kept for symmetry with the other blueprints)
    field_def,
    field_rule,
    options,
    row,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.1092n.003-vu"
FORM_NUMBER: Final = "003-В/у"
FORM_TITLE: Final = (
    "Медицинское заключение о наличии (об отсутствии) у водителей транспортных средств "
    "(кандидатов в водители транспортных средств) медицинских противопоказаний, медицинских "
    "показаний или медицинских ограничений к управлению транспортными средствами"
)
ORDER_NUMBER: Final = "1092н"
ORDER_DATE: Final = "2021-11-24"
ORDER_TITLE: Final = (
    "Об утверждении порядка проведения обязательного медицинского освидетельствования водителей "
    "транспортных средств (кандидатов в водители транспортных средств), порядка выдачи и формы "
    "медицинского заключения о наличии (об отсутствии) у водителей транспортных средств "
    "(кандидатов в водители транспортных средств) медицинских противопоказаний, медицинских "
    "показаний или медицинских ограничений к управлению транспортными средствами, а также о "
    "признании утратившими силу отдельных приказов Министерства здравоохранения Российской "
    "Федерации"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "66130",
    "date": "2021-11-30",
}
# Item 5 of the order: item 1 (the appendices) «вступает в силу с 1 марта 2022 г. и действует до
# 1 марта 2028 г.»
EFFECTIVE_FROM: Final = "2022-03-01"
EFFECTIVE_UNTIL: Final = "2028-03-01"

BLANK_APPENDIX: Final = 3
BLANK_PAGES: Final = (15, 16)
RULES_APPENDIX: Final = 2
RULES_PAGES: Final = (11, 12, 13, 14)

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {11: 0.15, 12: 0.135, 13: 0.21, 14: 0.2}

_FOOTNOTE_MARK = "footnote reference mark recognised as punctuation"
_X_MASK = "x"
_CYR_X = "х"
CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(12, "ГОД.", "год.", "capital letters recognised for a lower-case word"),
    Correction(
        12,
        "«xx " + _CYR_X * 9 + "»",
        "«xx " + _X_MASK * 9 + "»",
        "Cyrillic х recognised for the Latin x of the printed format mask (same glyph)",
    ),
    Correction(
        12, "«x» -", "«x» –", "typographic dash printed in the text, recognised as a hyphen"
    ),
    Correction(13, "жительства*;", "жительства;", _FOOTNOTE_MARK),
    Correction(13, "фамилия, ИМЯ,", "фамилия, имя,", "capital letters recognised for a word"),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(
        12,
        "Федерации порядке",
        "Федерации порядке.",
        "the full stop after the footnote mark 3 is lost by the OCR",
    ),
)

# Printed captions the OCR dropped or garbled on the crowded lines of the blank (page 15 is full of
# ruled blanks and boxed tables); each was read on the scan.
SCAN_REVIEWED: Final = (
    "Медицинское заключение серия",
    "квартира",
    "комната",
    "отсутствие (наличие) медицинских ограничений",
    "Обязательное медицинское освидетельствование проведено",
    "Категории «С», «СЕ», «D», «DE»",
)

CATEGORIES: Final[tuple[tuple[str, str], ...]] = (
    ("A", "A"),
    ("B", "B"),
    ("C", "C"),
    ("D", "D"),
    ("BE", "BE"),
    ("CE", "CE"),
    ("DE", "DE"),
    ("Tm", "Tm"),
    ("Tb", "Tb"),
    ("M", "M"),
    ("A1", "A1"),
    ("B1", "B1"),
    ("C1", "C1"),
    ("D1", "D1"),
    ("C1E", "C1E"),
    ("D1E", "D1E"),
)
RESTRICTION_ROWS: Final[tuple[tuple[str, str, str], ...]] = (
    (
        "restrictionMotorcycle",
        "Категории «А» или «М», подкатегории «А1» или «В1» с мотоциклетной посадкой или рулем "
        "мотоциклетного типа",
        "Категории «А» или «М», подкатегории «А1» или «В1» с мотоциклетной посадкой",
    ),
    (
        "restrictionCar",
        "Категории «В» или «ВЕ», подкатегории «В1» (кроме транспортного средства с "
        "мотоциклетной посадкой или рулем мотоциклетного типа)",
        "Категории «В» или «ВЕ», подкатегории «В1»",
    ),
    (
        "restrictionHeavy",
        "Категории «С», «СЕ», «D», «DE», «Tm» или «Tb», подкатегории «С1», «D1», «С1Е» или «D1E»",
        "Категории «С», «СЕ», «D», «DE»",
    ),
)
INDICATION_ROWS: Final[tuple[tuple[str, str, str], ...]] = (
    ("indicationManual", "С ручным управлением", "С ручным управлением"),
    (
        "indicationAutomatic",
        "С автоматической трансмиссией",
        "автоматической трансмиссией",
    ),
    (
        "indicationParking",
        "Оборудованным акустической парковочной системой",
        "Оборудованным акустической парковочной системой",
    ),
    (
        "indicationVision",
        "С использованием водителем транспортного средства медицинских изделий для коррекции "
        "зрения",
        "медицинских изделий для коррекции зрения",
    ),
    (
        "indicationHearing",
        "С использованием водителем транспортного средства медицинских изделий для компенсации "
        "потери слуха",
        "медицинских изделий для компенсации потери",
    ),
)


def _rule(status: str, *paragraphs: str, required: bool = False, note: str | None = None):
    """A rule citing its paragraphs; item 4 (every line and table is filled) backs `required`."""
    ids = [*(["4"] if required else []), *paragraphs]
    return field_rule(status, *ids, note=note)


def _field(
    field_id: str,
    label: str,
    field_type: str,
    rule: dict[str, Any],
    *,
    required: bool = False,
    anchor: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        field_type,
        rule,
        required=required,
        basis="source",
        anchor=anchor,
        **extra,
    )


ADDRESS_NOTE: Final = (
    "Пункт 6 (подпункт 3) называет строку 3 «Регистрация по месту жительства (пребывания)» "
    "целиком; её части (район, город, улица, дом и др.) порядок отдельно не определяет."
)
VZ_OPTIONS: Final = [
    {"value": "V", "label": "«V» — категория выбрана"},
    {"value": "Z", "label": "«Z» — иная категория"},
]


def _address_fields() -> list[dict[str, Any]]:
    by_line = _rule("by-line", "6.3", note=ADDRESS_NOTE)
    specs = (
        ("residenceSubject", "субъект Российской Федерации", True, "subject"),
        ("residenceDistrict", "район", False, "district"),
        ("residenceCity", "город", False, None),
        ("residenceLocality", "населенный пункт", True, "locality"),
        ("residenceStreet", "улица", False, "street"),
        ("residenceHouse", "дом", False, "house"),
        ("residenceBuilding", "строение", False, "building"),
        ("residenceCorpus", "корпус", False, None),
        ("residenceApartment", "квартира", False, "apartment"),
        ("residenceRoom", "комната", False, None),
    )
    fields = []
    for field_id, label, required, part in specs:
        extra: dict[str, Any] = {"maxLength": 120}
        if part:
            extra["prefill"] = {"sources": [f"patient.address.{part}"]}
        fields.append(_field(field_id, label, "text", by_line, **extra))
        fields[-1]["required"] = False
        fields[-1].pop("requiredBasis", None)
        if required:
            fields[-1]["required"] = True
            fields[-1]["requiredBasis"] = "editorial"
    return fields


def _build_fields() -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = [
        _field(
            "orgName",
            "Наименование медицинской организации",
            "text",
            _rule(
                "defined",
                "5",
                note=(
                    "У индивидуального предпринимателя в этой строке — его фамилия, имя, "
                    "отчество (при наличии); адрес — по месту жительства (п. 5)."
                ),
            ),
            required=True,
            prefill={"sources": ["organization.name"]},
            maxLength=300,
        ),
        _field(
            "orgLicense",
            "Лицензия",
            "text",
            _rule("defined", "5"),
            required=True,
            maxLength=120,
        ),
        _field(
            "orgAddress",
            "Адрес",
            "text",
            _rule("defined", "5"),
            required=True,
            prefill={"sources": ["organization.address"]},
            maxLength=300,
        ),
        _field(
            "orgOkpo",
            "Код по ОКПО",
            "text",
            _rule("defined", "5"),
            required=True,
            maxLength=20,
        ),
        _field(
            "certSeries",
            "Серия медицинского заключения",
            "text",
            _rule("defined", "3"),
            required=True,
            anchor="Медицинское заключение серия",
            pattern="^[0-9]{2}$",
            patternMessage="Серия — две цифры (формат «xx xxxxxxxxx», п. 3)",
            maxLength=2,
        ),
        _field(
            "certNumber",
            "Номер медицинского заключения",
            "text",
            _rule("defined", "3"),
            required=True,
            anchor="Медицинское заключение серия",
            pattern="^[0-9]{9}$",
            patternMessage="Номер — девять цифр (формат «xx xxxxxxxxx», п. 3)",
            maxLength=9,
        ),
        _field(
            "patientFullName",
            "Фамилия, имя, отчество (при наличии)",
            "text",
            _rule("defined", "6.1", required=True),
            required=True,
            prefill={"sources": ["patient.fullName"]},
            maxLength=200,
        ),
        _field(
            "patientBirthDate",
            "Дата рождения",
            "date",
            _rule("defined", "6.2", required=True),
            required=True,
            anchor="Дата рождения",
            prefill={"sources": ["patient.birthDate"]},
            notAfter="today",
        ),
        *_address_fields(),
        _field(
            "formDate",
            "Дата выдачи медицинского заключения",
            "date",
            _rule("defined", "6.4", required=True),
            required=True,
            prefill={"sources": ["today"]},
        ),
    ]
    for field_id, label, anchor in RESULT_ROWS:
        fields.append(
            _field(
                field_id,
                label,
                "text",
                _rule("defined", "6.5", required=True),
                required=True,
                anchor=anchor,
                multiline=True,
                maxLength=600,
            )
        )
    for field_id, label, anchor in (
        (
            "contraindications",
            "отсутствие (наличие) медицинских противопоказаний к управлению транспортным средством",
            "отсутствие (наличие) медицинских противопоказаний",
        ),
        (
            "indications",
            "отсутствие (наличие) медицинских показаний к управлению транспортным средством",
            "отсутствие (наличие) медицинских показаний",
        ),
        (
            "restrictions",
            "отсутствие (наличие) медицинских ограничений к управлению транспортным средством",
            "отсутствие (наличие) медицинских ограничений",
        ),
    ):
        fields.append(
            _field(
                field_id,
                label,
                "choice",
                _rule("defined", "6.6", required=True),
                required=True,
                anchor=anchor,
                options=PRESENCE_OPTIONS,
            )
        )
    fields.append(
        _field(
            "afterLicenseReturn",
            "Обязательное медицинское освидетельствование проведено в связи с возвратом "
            "водительского удостоверения",
            "choice",
            _rule("defined", "6.7", required=True),
            required=True,
            anchor="Обязательное медицинское освидетельствование проведено",
            options=YES_NO_OPTIONS,
        )
    )
    for code, caption in CATEGORIES:
        note = (
            "Для категории «M» отметка делается по положениям пункта 7 статьи 25 Федерального "
            "закона от 10 декабря 1995 г. № 196-ФЗ (текст п. 6, подпункт 8)."
            if code == "M"
            else None
        )
        fields.append(
            _field(
                f"category{code}",
                f"«{caption}»",
                "choice",
                _rule("defined", "6.8", required=True, note=note),
                required=True,
                options=VZ_OPTIONS,
            )
        )
        fields[-1]["_anchor"] = None
    for field_id, label, anchor in RESTRICTION_ROWS:
        fields.append(
            _field(
                field_id,
                label,
                "choice",
                _rule("defined", "6.9"),
                anchor=anchor,
                options=V_OPTION,
            )
        )
    for field_id, label, anchor in INDICATION_ROWS:
        fields.append(
            _field(
                field_id,
                label,
                "choice",
                _rule("defined", "6.10"),
                anchor=anchor,
                options=V_OPTION,
            )
        )
    fields.append(
        _field(
            "doctorName",
            "Фамилия, имя, отчество (при наличии), подпись врача, выдавшего медицинское заключение",
            "text",
            _rule("defined", "6.11", required=True),
            required=True,
            prefill={"sources": ["clinician.fullName"]},
            maxLength=200,
        )
    )
    fields.append(
        _field(
            "stamp",
            "МП",
            "stamp",
            _rule("defined", "6.11"),
        )
    )
    # the 16 category captions are single letters: the OCR check would pass on any text, so they
    # are not anchored there; they were compared with the scan by eye (see the notes)
    return fields


FIELDS: Final = _build_fields()

SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "organization",
        "title": "Медицинская организация",
        "description": "Наименование и адрес подставляются из настроек «Врач и организация».",
        "fieldIds": ["orgName", "orgLicense", "orgAddress", "orgOkpo"],
    },
    {
        "id": "certificate",
        "title": "Серия и номер",
        "description": "Формат «xx xxxxxxxxx»; серия включает код субъекта Российской Федерации.",
        "fieldIds": ["certSeries", "certNumber", "formDate"],
    },
    {
        "id": "patient",
        "title": "Освидетельствуемый",
        "fieldIds": ["patientFullName", "patientBirthDate"],
    },
    {
        "id": "residence",
        "title": "Регистрация по месту жительства (пребывания)",
        "fieldIds": [
            "residenceSubject",
            "residenceDistrict",
            "residenceCity",
            "residenceLocality",
            "residenceStreet",
            "residenceHouse",
            "residenceBuilding",
            "residenceCorpus",
            "residenceApartment",
            "residenceRoom",
        ],
    },
    {
        "id": "results",
        "title": "Результаты осмотров и обследований",
        "description": "Результат, фамилия и подпись врача-специалиста и печать — на бумаге.",
        "fieldIds": [field_id for field_id, _label, _anchor in RESULT_ROWS],
    },
    {
        "id": "findings",
        "title": "Выявлено",
        "fieldIds": ["contraindications", "indications", "restrictions", "afterLicenseReturn"],
    },
    {
        "id": "categories",
        "title": "Категории и подкатегории транспортных средств, на управление которыми "
        "предоставляется специальное право",
        "description": "Выбранное отмечается знаком «V», в иных графах ставится знак «Z».",
        "fieldIds": [f"category{code}" for code, _caption in CATEGORIES],
    },
    {
        "id": "restrictions",
        "title": "Медицинские ограничения к управлению транспортным средством",
        "fieldIds": [field_id for field_id, _label, _anchor in RESTRICTION_ROWS],
    },
    {
        "id": "indications",
        "title": "Медицинские показания к управлению транспортным средством",
        "fieldIds": [field_id for field_id, _label, _anchor in INDICATION_ROWS],
    },
    {
        "id": "doctor",
        "title": "Врач, выдавший заключение",
        "description": "Подпись врача и печать организации ставятся на бумажной форме.",
        "fieldIds": ["doctorName"],
    },
]

# ------------------------------------------------------------------------------- print layout


def _build_layout() -> dict[str, Any]:
    result_rows = [[{"text": label}, field_id] for field_id, label, _anchor in RESULT_ROWS]
    restriction_rows = [
        [{"text": label}, field_id] for field_id, label, _anchor in RESTRICTION_ROWS
    ]
    indication_rows = [[{"text": label}, field_id] for field_id, label, _anchor in INDICATION_ROWS]
    categories = table(
        [[{"text": f"«{caption}»"} for _code, caption in CATEGORIES]],
        [[f"category{code}" for code, _caption in CATEGORIES]],
        row_height_mm=4.3,
    )
    blocks: list[dict[str, Any]] = [
        {
            "id": "header",
            "columns": [
                column(
                    [
                        row(text("Наименование медицинской организации")),
                        row(blank("orgName", 40, grow=True)),
                        row(text("Лицензия" + PAD * 10), blank("orgLicense", 25, grow=True)),
                        row(text("Адрес" + PAD * 14), blank("orgAddress", 25, grow=True)),
                        row(text("Код по ОКПО" + PAD * 2), blank("orgOkpo", 25, grow=True)),
                    ],
                    38,
                ),
                column(
                    [
                        row(text("Медицинская документация")),
                        row(text("Форма № 003-В/у")),
                        row(text("Утверждена приказом Министерства здравоохранения")),
                        row(text("Российской Федерации")),
                        row(
                            text("от «"),
                            rule_seg(5),
                            text("»"),
                            rule_seg(12),
                            text("2021 г. №"),
                            rule_seg(5),
                        ),
                    ],
                    58,
                    "center",
                ),
            ],
        },
        {
            "id": "title",
            "columns": [
                column(
                    [
                        row(
                            text("Медицинское заключение серия", bold=True),
                            blank("certSeries", 8),
                            text("№", bold=True),
                            blank("certNumber", 8),
                            align="center",
                            bold=True,
                            gap="large",
                        ),
                        row(
                            text("о наличии (об отсутствии) у водителей транспортных средств"),
                            align="center",
                            bold=True,
                        ),
                        row(
                            text(
                                "(кандидатов в водители транспортных средств) медицинских "
                                "противопоказаний,"
                            ),
                            align="center",
                            bold=True,
                        ),
                        row(
                            text("медицинских показаний или медицинских ограничений"),
                            align="center",
                            bold=True,
                        ),
                        row(
                            text("к управлению транспортными средствами"),
                            align="center",
                            bold=True,
                        ),
                    ],
                    100,
                    "center",
                )
            ],
        },
        {
            "id": "identity",
            "columns": [
                column(
                    [
                        row(
                            text("1. Фамилия, имя, отчество (при наличии)"),
                            blank("patientFullName", 40, grow=True),
                            gap="large",
                        ),
                        date_row("2. Дата рождения:", "patientBirthDate"),
                        row(
                            text(
                                "3. Регистрация по месту жительства (пребывания): "
                                "субъект Российской Федерации"
                            ),
                            blank("residenceSubject", 29, grow=True),
                        ),
                        row(text("район"), blank("residenceDistrict", 40, grow=True)),
                        row(
                            text("город"),
                            blank("residenceCity", 39, grow=True),
                            text("населенный пункт"),
                            blank("residenceLocality", 39, grow=True),
                        ),
                        row(
                            text("улица"),
                            blank("residenceStreet", 59, grow=True),
                            text("дом"),
                            blank("residenceHouse", 11),
                            text("строение"),
                            blank("residenceBuilding", 11),
                        ),
                        row(
                            text("корпус"),
                            blank("residenceCorpus", 11),
                            text("квартира"),
                            blank("residenceApartment", 11),
                            text("комната"),
                            blank("residenceRoom", 11),
                        ),
                        date_row("4. Дата выдачи медицинского заключения:", "formDate"),
                        row(
                            text(
                                "5.1. Результаты осмотров и обследований врачами-специалистами, "
                                "инструментального и лабораторных исследований:"
                            ),
                            align="stretch",
                        ),
                        row(table([], result_rows, [1, 1], 8.5)),
                    ]
                )
            ],
        },
        {
            "id": "findings",
            "columns": [
                column(
                    [
                        row(text("5.2. Выявлено (нужное подчеркнуть):")),
                        *presence_rows(
                            ("contraindications", "indications", "restrictions"),
                            "транспортным средством",
                        ),
                        row(
                            text(
                                "6. Обязательное медицинское освидетельствование проведено в "
                                "связи с возвратом водительского удостоверения:"
                            ),
                            align="stretch",
                        ),
                        row(
                            options("afterLicenseReturn", "/", codes=False, underline=True),
                            text("(нужное подчеркнуть)."),
                        ),
                    ]
                )
            ],
        },
        {
            "id": "categories",
            "columns": [
                column(
                    [
                        row(
                            text("Категории и подкатегории транспортных средств, на управление"),
                            align="center",
                            bold=True,
                        ),
                        row(
                            text("которыми предоставляется специальное право"),
                            align="center",
                            bold=True,
                        ),
                        row(categories),
                        row(
                            text("Медицинские ограничения к управлению транспортным средством"),
                            align="center",
                            bold=True,
                        ),
                        row(table([], restriction_rows, [7, 1], 4.4)),
                        row(
                            text("Медицинские показания к управлению транспортным средством"),
                            align="center",
                            bold=True,
                        ),
                        row(table([], indication_rows, [7, 1], 4.4)),
                    ],
                    100,
                    "center",
                )
            ],
        },
        {
            "id": "signature",
            "columns": [
                column(
                    [
                        row(
                            text(
                                "7. Фамилия, имя, отчество (при наличии), подпись врача, "
                                "выдавшего медицинское заключение:"
                            ),
                        ),
                        row(blank("doctorName", 40, grow=True)),
                        row(
                            {"kind": "stamp", "fieldId": "stamp", "text": "МП"},
                            align="right",
                        ),
                    ]
                )
            ],
        },
    ]
    return {
        "page": {
            "size": "A4",
            "orientation": "portrait",
            "marginMm": {"top": 10, "right": 10, "bottom": 10, "left": 18.8},
            "fontSizePt": 10,
        },
        "blocks": blocks,
    }


LAYOUT: Final = _build_layout()

NOTES: Final[list[str]] = [
    "Черновик для просмотра и печати на обычной бумаге. Пункт 7 Порядка выдачи (приложение № 2 "
    "к приказу № 1092н, стр. 14 PDF): бланк медицинского заключения — защищенная от подделок "
    "полиграфическая продукция уровня защищенности «В», изготавливаемая по единому образцу в "
    "соответствии с Техническими требованиями и условиями изготовления защищенной от подделок "
    "полиграфической продукции, утвержденными приказом Минфина России от 29 сентября 2020 г. "
    "№ 217н. Распечатка из приложения — не бланк строгой отчетности и не заменяет его.",
    "Бланк (приложение № 3) — один печатный лист. Официальный PDF разрывает его на двух страницах "
    "(стр. 15–16) только потому, что заголовок приложения «Приложение № 3 к приказу …» занимает "
    "верх страницы 15; на печати лист один, строки и таблицы идут в том же порядке.",
    "Заполнение описано в приложении № 2 (Порядок выдачи): пункт 6 нумерует свои подпункты «1)» … "
    "«11)» (строки бланка 1–7); в схеме они записаны как 6.1 … 6.11 и в ссылках названы «п. 6, "
    "подпункт N». Общее требование пункта 4: сведения вносятся во все строки и таблицы, а при "
    "отсутствии сведений делается запись «не установлено»; поэтому поля строк и таблиц "
    "обязательны (basis = source), кроме отметок в таблицах «Медицинские ограничения» и "
    "«Медицинские показания» "
    "(подпункты 9–10: отмечается только выбранное) и частей адреса (район, город, улица и др. — "
    "их порядок отдельно не определяет; подставляются, если есть в карточке пациента). "
    "Незаполненные обязательные поля подсвечиваются, печать не блокируется.",
    "Привязки: «населенный пункт» — patient.address.locality (приложение хранит одно поле "
    "населенного пункта; «город» остаётся пустым), «строение» — patient.address.building "
    "(«строение/корпус»), «корпус», «комната» не подставляются. Адрес пациента — адрес регистрации "
    "по месту жительства; адрес по месту пребывания в строку 3 не подставляется.",
    "Строка «от « » ____ 2021 г. №» в шапке («Утверждена приказом Министерства здравоохранения "
    "Российской Федерации …») на образце напечатана с пустыми линиями; порядок не говорит, что в "
    "них вписывать, поэтому они остаются пустыми линиями без поля.",
    "Таблица «Категории и подкатегории…»: по подпункту 8 выбранное отмечается знаком «V», в иных "
    "графах ставится знак «Z»; для категории «M» — по пункту 7 статьи 25 Федерального закона "
    "№ 196-ФЗ. Подписи 16 граф (одиночные буквы) сверены по скану вручную; категории записаны "
    "латинскими буквами (одинаковое начертание с кириллическими не различимо на скане).",
    "Приложение № 3 к приказу содержит также рекомендуемый образец журнала регистрации выданных "
    "заключений (стр. 17 PDF, приложение к Порядку выдачи) — это не бланк заключения и в схему не "
    "входит. Приложение № 1 (стр. 4–10) — порядок освидетельствования, не форма.",
]

BLUEPRINT: Final = FormBlueprint(
    form_id=FORM_ID,
    form_number=FORM_NUMBER,
    title=FORM_TITLE,
    order_number=ORDER_NUMBER,
    order_date=ORDER_DATE,
    order_title=ORDER_TITLE,
    registration=dict(REGISTRATION),
    effective_from=EFFECTIVE_FROM,
    effective_until=EFFECTIVE_UNTIL,
    blank_appendix=BLANK_APPENDIX,
    blank_pages=BLANK_PAGES,
    rules_appendix=RULES_APPENDIX,
    rules_pages=RULES_PAGES,
    footnote_below=dict(FOOTNOTE_BELOW),
    corrections=CORRECTIONS,
    fields=FIELDS,
    code_lists={},
    sequential_lists={},
    sections=SECTIONS,
    layout=LAYOUT,
    notes=NOTES,
    row_corrections=ROW_CORRECTIONS,
    scan_reviewed_captions=SCAN_REVIEWED,
    rules_title="Порядок выдачи медицинского заключения",
    bracket_items=True,
)
