"""Reviewed blueprint of form 071/у «Медицинское заключение о наличии (об отсутствии) у
трактористов, машинистов и водителей самоходных машин (кандидатов в трактористы, машинисты и
водители самоходных машин) медицинских противопоказаний, медицинских показаний или медицинских
ограничений к управлению самоходными машинами» (Минздрав order № 395н of 09.06.2022, Минюст
№ 68933 of 21.06.2022).

The order is three PDF pages: page 1 the order itself (item 1 approves the form «согласно
приложению», item 2 sets the dates), pages 2–3 the only appendix — the blank (two printed sheets:
the certificate itself, then the tables of categories, restrictions and indications). The order has
**no «Порядок заполнения»** for the form: every field is `undefined`, and the two clauses of the
order are kept as the paragraphs of the schema (`rules`) without a field citing them.

Same method as `medical_form_070u`; the shared pieces of the driver certificates live in
`medical_form_driver`.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_driver import (
    PAD,
    PRESENCE_OPTIONS,
    RESULT_ROWS,
    YES_NO_OPTIONS,
    column,
    date_row,
    presence_rows,
    rule_seg,
    table,
)
from localmed_ingest.medical_form_kit import (
    SNILS_PATTERN,
    blank,
    field_def,
    field_rule,
    options,
    row,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.395n.071u"
FORM_NUMBER: Final = "071/у"
FORM_TITLE: Final = (
    "Медицинское заключение о наличии (об отсутствии) у трактористов, машинистов и водителей "
    "самоходных машин (кандидатов в трактористы, машинисты и водители самоходных машин) "
    "медицинских противопоказаний, медицинских показаний или медицинских ограничений к "
    "управлению самоходными машинами"
)
ORDER_NUMBER: Final = "395н"
ORDER_DATE: Final = "2022-06-09"
ORDER_TITLE: Final = (
    "Об утверждении формы медицинского заключения о наличии (об отсутствии) у трактористов, "
    "машинистов и водителей самоходных машин (кандидатов в трактористы, машинисты и водители "
    "самоходных машин) медицинских противопоказаний, медицинских показаний или медицинских "
    "ограничений к управлению самоходными машинами"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "68933",
    "date": "2022-06-21",
}
# item 2 of the order: «вступает в силу с 3 июля 2022 г. и действует до 1 марта 2028 г.»
EFFECTIVE_FROM: Final = "2022-07-03"
EFFECTIVE_UNTIL: Final = "2028-03-01"

BLANK_APPENDIX: Final = 1  # the order's only appendix; the scan calls it «Приложение», no number
BLANK_PAGES: Final = (2, 3)
# the order's own text, page 1; everything under the signature block is dropped
RULES_PAGES: Final = (1,)
FOOTNOTE_BELOW: Final[dict[int, float]] = {1: 0.26}

CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(
        1,
        "У твердить",
        "Утвердить",
        "a letter of the verb is split off by the wide spacing of the justified line",
    ),
    Correction(
        1,
        "заключения наличии",
        "заключения о наличии",
        "the preposition «о» is lost in the wide spacing of the justified line",
    ),
)

# Captions the OCR dropped or garbled on the crowded, ruled lines of the blank; each was read on the
# scan (page 2 is full of ruled blanks, page 3 of boxed rows).
SCAN_REVIEWED: Final = (
    "Медицинское заключение серия",
    "корпус",
    "квартира",
    "комната",
    "8. Обязательное медицинское освидетельствование проведено",
    "Категории «А II» – внедорожные автотранспортные средства",
    "Категории «А III» – внедорожные автотранспортные средства",
    "Категории «А IV» – внедорожные автотранспортные средства",
)

SECOND_SHEET_TOP_MM: Final = 22.0
CATEGORIES: Final[tuple[str, ...]] = ("A I", "A II", "A III", "A IV", "B", "C", "D", "E", "F")
CATEGORY_ID: Final = {code: "category" + code.replace(" ", "") for code in CATEGORIES}
RESTRICTION_ROWS: Final[tuple[tuple[str, str, str], ...]] = (
    (
        "restrictionAI",
        "Категории «A I» – внедорожные мототранспортные средства (не предназначенные для "
        "движения по автомобильным дорогам общего пользования либо имеющие максимальную "
        "конструктивную скорость 50 километров в час и менее)",
        "Категории «А I» – внедорожные мототранспортные средства",
    ),
    (
        "restrictionAII",
        "Категории «A II» – внедорожные автотранспортные средства, разрешенная максимальная "
        "масса которых не превышает 3500 килограммов и число мест для сидения в которых, за "
        "исключением места водителя, не превышает 8 (не предназначенные для движения по "
        "автомобильным дорогам общего пользования либо имеющие максимальную конструктивную "
        "скорость 50 километров в час и менее)",
        "Категории «А II» – внедорожные автотранспортные средства",
    ),
    (
        "restrictionAIII",
        "Категории «A III» – внедорожные автотранспортные средства, разрешенная максимальная "
        "масса которых превышает 3500 килограммов, за исключением относящихся к категории "
        "«A IV» (не предназначенные для движения по автомобильным дорогам общего пользования "
        "либо имеющие максимальную конструктивную скорость 50 километров в час и менее)",
        "Категории «А III» – внедорожные автотранспортные средства",
    ),
    (
        "restrictionAIV",
        "Категории «A IV» – внедорожные автотранспортные средства, предназначенные для "
        "перевозки пассажиров и имеющие, за исключением места водителя, более 8 мест для "
        "сидения (не предназначенные для движения по автомобильным дорогам общего пользования "
        "либо имеющие максимальную конструктивную скорость 50 километров в час и менее)",
        "Категории «А IV» – внедорожные автотранспортные средства",
    ),
    (
        "restrictionB",
        "Категории «B» – гусеничные и колесные машины с двигателем мощностью до 25,7 киловатта",
        "Категории «В» – гусеничные и колесные машины с двигателем мощностью до",
    ),
    (
        "restrictionC",
        "Категории «C» – колесные машины с двигателем мощностью от 25,7 киловатта до 110,3 "
        "киловатта",
        "колесные машины с двигателем мощностью от 25,7 киловатта до 110,3 киловатта",
    ),
    (
        "restrictionD",
        "Категории «D» – колесные машины с двигателем мощностью свыше 110,3 киловатта",
        "колесные машины с двигателем мощностью свыше 110,3 киловатта",
    ),
    (
        "restrictionE",
        "Категории «E» – гусеничные машины с двигателем мощностью свыше 25,7 киловатта",
        "гусеничные машины с двигателем мощностью свыше 25,7 киловатта",
    ),
    (
        "restrictionF",
        "Категории «F» – самоходные сельскохозяйственные машины",
        "самоходные сельскохозяйственные машины",
    ),
)
INDICATION_ROWS: Final[tuple[tuple[str, str, str], ...]] = (
    ("indicationManual", "С ручным управлением", "С ручным управлением"),
    ("indicationAutomatic", "С автоматической трансмиссией", "автоматической трансмиссией"),
    (
        "indicationParking",
        "Оборудованной акустической парковочной системой",
        "Оборудованной акустической парковочной системой",
    ),
    (
        "indicationVision",
        "С использованием водителем самоходной машины медицинских изделий для коррекции зрения",
        "медицинских изделий для коррекции зрения",
    ),
    (
        "indicationHearing",
        "С использованием водителем самоходной машины медицинских изделий для компенсации "
        "потери слуха",
        "медицинских изделий для компенсации потери",
    ),
)

NO_RULES: Final = (
    "Приказ № 395н утверждает форму (пункт 1) и не содержит порядка её заполнения: как заполнять "
    "эту строку, он не говорит."
)
NO_MARK_RULE: Final = (
    "Приказ № 395н не говорит, каким знаком отмечается выбранное в этой таблице (для формы "
    "003-В/у такой знак задан приказом № 1092н, здесь он не переносится)."
)


def _field(
    field_id: str,
    label: str,
    field_type: str,
    *,
    required: bool = False,
    anchor: str | None = None,
    note: str = NO_RULES,
    **extra: Any,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        field_type,
        field_rule("undefined", note=note),
        required=required,
        basis="editorial",
        anchor=anchor,
        **extra,
    )


def _address_fields() -> list[dict[str, Any]]:
    specs = (
        ("residenceSubject", "субъект Российской Федерации", "subject"),
        ("residenceDistrict", "район", "district"),
        ("residenceLocality", "населенный пункт", "locality"),
        ("residenceStreet", "улица", "street"),
        ("residenceHouse", "дом", "house"),
        ("residenceBuilding", "строение", "building"),
        ("residenceCorpus", "корпус", None),
        ("residenceApartment", "квартира", None),
        ("residenceRoom", "комната", None),
    )
    fields = []
    for field_id, label, part in specs:
        extra: dict[str, Any] = {"maxLength": 120}
        if field_id == "residenceApartment":
            extra["prefill"] = {"sources": ["patient.address.apartment"]}
        elif part:
            extra["prefill"] = {"sources": [f"patient.address.{part}"]}
        fields.append(_field(field_id, label, "text", **extra))
    return fields


def _build_fields() -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = [
        _field(
            "orgName",
            "Наименование медицинской организации",
            "text",
            prefill={"sources": ["organization.name"]},
            maxLength=300,
        ),
        _field("orgLicense", "Лицензия", "text", maxLength=120),
        _field(
            "orgAddress",
            "Адрес",
            "text",
            prefill={"sources": ["organization.address"]},
            maxLength=300,
        ),
        _field("orgOkpo", "Код по ОКПО", "text", maxLength=20),
        _field(
            "certSeries",
            "Серия медицинского заключения",
            "text",
            anchor="Медицинское заключение серия",
            maxLength=10,
        ),
        _field(
            "certNumber",
            "Номер медицинского заключения",
            "text",
            anchor="Медицинское заключение серия",
            maxLength=20,
        ),
        _field(
            "patientFullName",
            "Фамилия, имя, отчество (при наличии)",
            "text",
            required=True,
            prefill={"sources": ["patient.fullName"]},
            maxLength=200,
        ),
        _field(
            "patientBirthDate",
            "Дата рождения",
            "date",
            required=True,
            prefill={"sources": ["patient.birthDate"]},
            notAfter="today",
        ),
        *_address_fields(),
        _field(
            "snils",
            "Страховой номер индивидуального лицевого счета в системе индивидуального "
            "(персонифицированного) учета (СНИЛС)",
            "text",
            anchor="Страховой номер индивидуального лицевого счета",
            prefill={"sources": ["patient.snils"]},
            pattern=SNILS_PATTERN,
            patternMessage="СНИЛС в формате 123-456-789 01",
        ),
        _field(
            "formDate",
            "Дата выдачи медицинского заключения",
            "date",
            required=True,
            anchor="Дата выдачи медицинского заключения",
            prefill={"sources": ["today"]},
        ),
    ]
    for field_id, label, anchor in RESULT_ROWS:
        fields.append(_field(field_id, label, "text", anchor=anchor, multiline=True, maxLength=600))
    for field_id, label, anchor in (
        (
            "contraindications",
            "отсутствие (наличие) медицинских противопоказаний к управлению самоходными машинами",
            "отсутствие (наличие) медицинских противопоказаний",
        ),
        (
            "indications",
            "отсутствие (наличие) медицинских показаний к управлению самоходными машинами",
            "отсутствие (наличие) медицинских показаний",
        ),
        (
            "restrictions",
            "отсутствие (наличие) медицинских ограничений к управлению самоходными машинами",
            "отсутствие (наличие) медицинских ограничений",
        ),
    ):
        fields.append(_field(field_id, label, "choice", anchor=anchor, options=PRESENCE_OPTIONS))
    fields.append(
        _field(
            "afterLicenseReturn",
            "Обязательное медицинское освидетельствование проведено в связи с возвратом "
            "водительского удостоверения",
            "choice",
            anchor="8. Обязательное медицинское освидетельствование проведено",
            options=YES_NO_OPTIONS,
        )
    )
    for code in CATEGORIES:
        fields.append(
            _field(
                CATEGORY_ID[code],
                f"«{code}»",
                "text",
                note=NO_MARK_RULE,
                maxLength=8,
            )
        )
        # one or two letters: an OCR search would pass on any text; compared with the scan by eye
        fields[-1]["_anchor"] = None
    for field_id, label, anchor in RESTRICTION_ROWS:
        fields.append(
            _field(field_id, label, "text", anchor=anchor, note=NO_MARK_RULE, maxLength=8)
        )
    for field_id, label, anchor in INDICATION_ROWS:
        fields.append(
            _field(field_id, label, "text", anchor=anchor, note=NO_MARK_RULE, maxLength=8)
        )
    fields.append(
        _field(
            "doctorName",
            "Фамилия, имя, отчество (при наличии), подпись врача, выдавшего медицинское заключение",
            "text",
            required=True,
            prefill={"sources": ["clinician.fullName"]},
            maxLength=200,
        )
    )
    fields.append(_field("stamp", "МП (при наличии)", "stamp", anchor="МП (при наличии)"))
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
        "title": "Серия, номер и дата",
        "fieldIds": ["certSeries", "certNumber", "formDate"],
    },
    {
        "id": "patient",
        "title": "Освидетельствуемый",
        "fieldIds": ["patientFullName", "patientBirthDate", "snils"],
    },
    {
        "id": "residence",
        "title": "Регистрация по месту жительства (пребывания)",
        "fieldIds": [
            "residenceSubject",
            "residenceDistrict",
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
        "title": "Категории самоходных машин, на управление которыми предоставляется "
        "специальное право",
        "fieldIds": [CATEGORY_ID[code] for code in CATEGORIES],
    },
    {
        "id": "restrictions",
        "title": "Медицинские ограничения к управлению самоходной машиной",
        "fieldIds": [field_id for field_id, _label, _anchor in RESTRICTION_ROWS],
    },
    {
        "id": "indications",
        "title": "Медицинские показания к управлению самоходной машиной",
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

FOOTNOTE: Final = (
    "¹ Постановление Правительства Российской Федерации от 29 декабря 2014 г. № 1604 «О "
    "перечнях медицинских противопоказаний, медицинских показаний и медицинских ограничений к "
    "управлению транспортным средством» (Собрании законодательства Российской Федерации, "
    "2015 г., № 2, ст. 506; 2019, № 32, ст. 4730)."
)


def _build_layout() -> dict[str, Any]:
    result_rows = [[{"text": label}, field_id] for field_id, label, _anchor in RESULT_ROWS]
    restriction_rows = [
        [{"text": label}, field_id] for field_id, label, _anchor in RESTRICTION_ROWS
    ]
    indication_rows = [[{"text": label}, field_id] for field_id, label, _anchor in INDICATION_ROWS]
    categories = table(
        [[{"text": f"«{code}»"} for code in CATEGORIES]],
        [[CATEGORY_ID[code] for code in CATEGORIES]],
        row_height_mm=4.3,
    )
    bold_centered = {"align": "center", "bold": True}
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
                        row(text("Форма № 071/у")),
                        row(text("Утверждена приказом Министерства здравоохранения")),
                        row(text("Российской Федерации")),
                        row(text("от «9» июня 2022 г. № 395н")),
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
                            gap="large",
                            **bold_centered,
                        ),
                        row(
                            text(
                                "о наличии (об отсутствии) у трактористов, машинистов и "
                                "водителей самоходных машин (кандидатов в"
                            ),
                            **bold_centered,
                        ),
                        row(
                            text(
                                "трактористы, машинисты и водители самоходных машин) "
                                "медицинских противопоказаний, медицинских"
                            ),
                            **bold_centered,
                        ),
                        row(
                            text(
                                "показаний или медицинских ограничений к управлению "
                                "самоходными машинами"
                            ),
                            **bold_centered,
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
                            text("населенный пункт"),
                            blank("residenceLocality", 40, grow=True),
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
                        row(
                            text(
                                "4. Страховой номер индивидуального лицевого счета в системе "
                                "индивидуального (персонифицированного) учета"
                            ),
                            align="stretch",
                        ),
                        row(text("(СНИЛС)"), blank("snils", 40, grow=True)),
                        date_row("5. Дата выдачи медицинского заключения:", "formDate"),
                        row(
                            text(
                                "6. Результаты осмотров и обследований врачами-специалистами, "
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
                        row(text("7. Выявлено (нужное подчеркнуть)¹:")),
                        *presence_rows(
                            ("contraindications", "indications", "restrictions"),
                            "самоходными машинами",
                        ),
                        row(
                            text(
                                "8. Обязательное медицинское освидетельствование проведено в "
                                "связи с возвратом водительского удостоверения:"
                            ),
                            options("afterLicenseReturn", "/", codes=False, underline=True),
                        ),
                        row(text("(нужное подчеркнуть).")),
                    ]
                )
            ],
        },
        {
            "id": "footnote",
            "columns": [
                column(
                    [
                        row(rule_seg(30), gap="large"),
                        row(text(FOOTNOTE), align="justify"),
                    ]
                )
            ],
        },
        {
            "id": "categories",
            "pageBreakBefore": True,
            "columns": [
                column(
                    [
                        {
                            **row(
                                text("Категории самоходных машин, на управление"),
                                **bold_centered,
                            ),
                            # the second scan page starts 24 mm below its top edge; the first row of
                            # a page is the reference of the calibration, so the space is set here
                            "spaceBeforeMm": SECOND_SHEET_TOP_MM,
                        },
                        row(
                            text("которыми предоставляется специальное право"),
                            **bold_centered,
                        ),
                        row(categories),
                        row(
                            text("Медицинские ограничения к управлению самоходной машиной"),
                            **bold_centered,
                        ),
                        row(table([], restriction_rows, [7, 1], 4.4, 1.18)),
                        row(
                            text("Медицинские показания к управлению самоходной машиной"),
                            **bold_centered,
                        ),
                        row(table([], indication_rows, [7, 1], 4.4, 1.18)),
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
                                "9. Фамилия, имя, отчество (при наличии), подпись врача, "
                                "выдавшего медицинское заключение:"
                            ),
                        ),
                        row(blank("doctorName", 40, grow=True)),
                        row(
                            {"kind": "stamp", "fieldId": "stamp", "text": "МП (при наличии)"},
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
    "Черновик для просмотра и печати на обычной бумаге. Приказ № 395н утверждает только форму "
    "(пункт 1) и не содержит ни порядка её заполнения, ни требований к бланку; для близкой формы "
    "003-В/у приказ № 1092н требует защищённую от подделок полиграфическую продукцию, для 071/у "
    "такого требования в приказе нет, но и права выдавать заключение распечатка не даёт.",
    "У формы нет «Порядка заполнения»: все поля имеют rule.status = undefined, а в списке "
    "paragraphs схемы (rules) хранятся два пункта самого приказа — пункт 1 (утверждает форму "
    "«согласно приложению») и пункт 2 (вступает в силу с 3 июля 2022 г., действует до 1 марта "
    "2028 г.); ни одно поле на них не ссылается, потому что они не описывают заполнение строк.",
    "Единственное приложение к приказу напечатано без номера («Приложение к приказу …»); в "
    "схеме оно записано как приложение № 1. Бланк — два печатных листа: первый (стр. 2 PDF) "
    "заканчивается строкой 8 и сноской, второй (стр. 3) начинается таблицей категорий.",
    "Обязательность полей (required) приказ не задаёт ни для одной строки; отмечены только "
    "ФИО, дата рождения, дата выдачи и врач (basis = editorial). Незаполненные обязательные поля "
    "подсвечиваются, печать не блокируется.",
    "Знак отметки в таблицах «Категории самоходных машин», «Медицинские ограничения» и "
    "«Медицинские показания» приказ не называет, поэтому поля таблиц — свободный короткий текст "
    "(знак «V»/«Z», принятый для формы 003-В/у, сюда не переносится).",
    "Сноска ¹ к строке 7 напечатана на бланке под строкой 8 и воспроизведена как напечатана, "
    "включая слово «Собрании» (в оригинале так).",
    "Подписи граф таблицы категорий (A I … F) сверены по скану вручную; категории записаны "
    "латинскими буквами (начертание латинских и кириллических букв не различимо на скане). "
    "Строка «от «9» июня 2022 г. № 395н» шапки напечатана на бланке текстом, а не пустыми "
    "линиями.",
    "Привязки: «населенный пункт» — patient.address.locality (города отдельной строки на бланке "
    "нет), «строение» — patient.address.building, «квартира» — patient.address.apartment, "
    "«корпус» и «комната» не подставляются; СНИЛС — patient.snils.",
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
    rules_appendix=None,
    rules_pages=RULES_PAGES,
    footnote_below=dict(FOOTNOTE_BELOW),
    corrections=CORRECTIONS,
    fields=FIELDS,
    code_lists={},
    sequential_lists={},
    sections=SECTIONS,
    layout=LAYOUT,
    notes=NOTES,
    scan_reviewed_captions=SCAN_REVIEWED,
    order_paragraphs=("1", "2"),
    edition_note="единственное приложение, на скане без номера",
)
