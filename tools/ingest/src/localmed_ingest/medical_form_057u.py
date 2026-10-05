"""Reviewed blueprint of form 057/у «Направление для оказания медицинской помощи».

Order of Минздрав России of 02.09.2025 № 519н (Минюст 16.10.2025 № 83857), eoNumber
0001202510160032: PDF page 2 is the blank (appendix 1), PDF pages 3–5 are the «Порядок ведения»
(appendix 2). The old form of the same number (order 255 of 2004) is repealed; this is its
successor. The order names no date of entry into force, so the general rule applies (see
`EDITION_NOTE`).

The blueprint is the human-reviewed reading of the scanned blank: printed captions, the lines as
printed (one layout row per printed line), and the binding of every field to the paragraph of the
«Порядок» that governs it. `medical_forms.prepare_form` checks every caption against the OCR text
of the blank and cuts every cited paragraph from the OCR text of the order.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    blank,
    field_def,
    field_rule,
    options,
    row,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.519n.057u"
FORM_NUMBER: Final = "057/у"
FORM_TITLE: Final = "Направление для оказания медицинской помощи"
ORDER_NUMBER: Final = "519н"
ORDER_DATE: Final = "2025-09-02"
ORDER_TITLE: Final = (
    "Об утверждении учетной формы «Направление для оказания медицинской помощи» "
    "и порядка ее ведения"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "83857",
    "date": "2025-10-16",
}
# No entry-into-force clause in the order: the general rule for orders of federal executive bodies
# (Указ Президента РФ от 23.05.1996 № 763, п. 12) is «по истечении 10 дней после дня официального
# опубликования»; official publication on the portal: 16.10.2025.
EFFECTIVE_FROM: Final = "2025-10-27"
EDITION_NOTE: Final = (
    "срок вступления в силу приказом не установлен; дата — по общему правилу, через 10 дней "
    "после официального опубликования 16.10.2025"
)
BLANK_APPENDIX: Final = 1
BLANK_PAGES: Final = (2,)
RULES_APPENDIX: Final = 2
RULES_PAGES: Final = (3, 4, 5)

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {3: 0.115, 4: 0.105, 5: 0.12}

_LOST_PAREN = "opening parenthesis of a printed bracket lost by the OCR"
CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(5, "которые не / имеют", "которые не имеют", "stray mark of the scan read as «/»"),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(4, "номер Основной государственный", "номер (Основной государственный", _LOST_PAREN),
)
# Captions the OCR dropped from the crowded header and the address lines of the blank; each was
# read on the scan (PDF page 2).
SCAN_REVIEWED: Final = (
    "(фамилия, имя, отчество (при наличии) индивидуального предпринимателя и адрес",
    "Основной государственный регистрационный номер",
    "улица",
)


def _by_line(note: str, *paragraphs: str) -> dict[str, Any]:
    return field_rule("by-line", *paragraphs, note=note)


_ADDRESS_NOTE = (
    "Пункт 9.4 называет строки «Регистрация по месту жительства» и «Регистрация по месту "
    "пребывания» целиком (заполняются по учетной форме № 025/у); их части порядок отдельно не "
    "определяет."
)


def _address_fields(prefix: str, path: str, caption: str) -> list[dict[str, Any]]:
    specs = (
        ("Subject", "субъект Российской Федерации", "subject", True, caption),
        ("District", "район", "district", False, "район"),
        ("Locality", "населенный пункт", "locality", True, "населенный пункт"),
        ("Street", "улица", "street", False, "улица"),
        ("House", "дом", "house", False, "дом"),
        ("Building", "строение/корпус", "building", False, "строение/корпус"),
        ("Apartment", "квартира", "apartment", False, "квартира"),
    )
    return [
        field_def(
            f"{prefix}{suffix}",
            label,
            "text",
            _by_line(_ADDRESS_NOTE, "9.4"),
            required=required,
            basis="editorial",
            anchor=anchor,
            prefill={"sources": [f"patient.{path}.{part}"]},
            maxLength=120,
        )
        for suffix, label, part, required, anchor in specs
    ]


def _choice(
    field_id: str,
    label: str,
    anchor: str,
    items: list[tuple[str, str]],
    *paragraphs: str,
    required: bool = False,
    **extra: Any,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "choice",
        field_rule("defined", *paragraphs),
        required=required,
        basis="source" if required else None,
        anchor=anchor,
        options=[{"value": value, "label": name} for value, name in items],
        **extra,
    )


FIELDS: Final[list[dict[str, Any]]] = [
    field_def(
        "organization",
        "Наименование и адрес медицинской организации (фамилия, имя, отчество (при наличии) "
        "индивидуального предпринимателя и адрес осуществления медицинской деятельности)",
        "text",
        field_rule("defined", "8", "9.2"),
        required=True,
        basis="source",
        anchor="Наименование и адрес медицинской организации",
        prefill={"sources": ["organization.name", "organization.address"], "join": ", "},
        multiline=True,
        maxLength=400,
    ),
    field_def(
        "organizationOgrn",
        "Основной государственный регистрационный номер (Основной государственный "
        "регистрационный номер индивидуального предпринимателя)",
        "text",
        field_rule("defined", "8", "9.2"),
        required=True,
        basis="source",
        anchor="Основной государственный регистрационный номер",
        prefill={"sources": ["organization.ogrn"]},
        pattern="^(?:[0-9]{13}|[0-9]{15})$",
        patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
    ),
    field_def(
        "formNumber",
        "Направление для оказания медицинской помощи №",
        "text",
        field_rule("defined", "8"),
        required=True,
        basis="source",
        anchor="НАПРАВЛЕНИЕ ДЛЯ ОКАЗАНИЯ МЕДИЦИНСКОЙ ПОМОЩИ",
        maxLength=40,
    ),
    field_def(
        "formDate",
        "Дата заполнения направления",
        "date",
        field_rule("defined", "9.1"),
        required=True,
        basis="source",
        anchor="Дата заполнения направления",
        prefill={"sources": ["today"]},
    ),
    field_def(
        "destinationOrganization",
        "наименование медицинской организации, куда направлен пациент",
        "text",
        _by_line(
            "Пункт 9.2 относит «куда направлен пациент» к строке с наименованием и адресом "
            "организации в шапке бланка; сам бланк печатает отдельную строку с подписью "
            "«(наименование медицинской организации, куда направлен пациент)». Поле заполняется "
            "по этой подписи.",
            "9.2",
        ),
        required=True,
        basis="source",
        anchor="наименование медицинской организации, куда направлен пациент",
        maxLength=300,
    ),
    field_def(
        "omsPolicyNumber",
        "Полис обязательного медицинского страхования",
        "text",
        field_rule("defined", "9.3"),
        required=True,
        basis="source",
        anchor="Полис обязательного медицинского страхования",
        prefill={"sources": ["patient.omsPolicy.number"]},
        maxLength=60,
    ),
    field_def(
        "omsPolicyIssueDate",
        "дата выдачи полиса обязательного медицинского страхования",
        "date",
        field_rule("defined", "9.3"),
        required=True,
        basis="source",
        anchor="дата выдачи полиса обязательного медицинского страхования",
        prefill={"sources": ["patient.omsPolicy.issuedAt"]},
        notAfter="today",
    ),
    field_def(
        "omsInsurer",
        "данные о страховой медицинской организации, выбранной застрахованным лицом или "
        "определенной застрахованному лицу",
        "text",
        field_rule("defined", "9.3"),
        required=True,
        basis="source",
        anchor="данные о страховой медицинской организации",
        prefill={"sources": ["patient.omsPolicy.insurer"]},
        multiline=True,
        maxLength=300,
    ),
    field_def(
        "patientFullName",
        "Фамилия, имя, отчество (при наличии) пациента",
        "text",
        field_rule("defined", "9.4"),
        required=True,
        basis="source",
        anchor="Фамилия, имя, отчество (при наличии) пациента",
        prefill={"sources": ["patient.fullName"]},
        maxLength=200,
    ),
    field_def(
        "patientBirthDate",
        "Дата рождения",
        "date",
        field_rule("defined", "9.4"),
        required=True,
        basis="source",
        anchor="Дата рождения",
        prefill={"sources": ["patient.birthDate"]},
        notAfter="today",
    ),
    _choice(
        "patientSex",
        "Пол",
        "Пол: муж – 1, жен – 2",
        [("1", "муж"), ("2", "жен")],
        "6",
        "9.4",
        required=True,
        prefill={"sources": ["patient.sex"], "map": {"male": "1", "female": "2"}},
    ),
    *_address_fields(
        "residence",
        "address",
        "Регистрация по месту жительства: субъект Российской Федерации",
    ),
    *_address_fields(
        "stay",
        "stayAddress",
        "Регистрация по месту пребывания: субъект Российской Федерации",
    ),
    field_def(
        "localityType",
        "Местность",
        "choice",
        field_rule(
            "undefined",
            note=(
                "Порядок не называет строку «Местность»: п. 9.4 перечисляет строки, заполняемые "
                "по форме № 025/у, и в этот перечень она не входит; ответ подчеркивается (п. 6)."
            ),
        ),
        anchor="Местность: городская – 1, сельская – 2",
        options=[{"value": "1", "label": "городская"}, {"value": "2", "label": "сельская"}],
    ),
    _choice(
        "employment",
        "Занятость",
        "Занятость: работает",
        [
            ("1", "работает"),
            ("2", "проходит военную службу или приравненную к ней службу"),
            ("3", "пенсионер"),
            ("4", "обучающийся"),
            ("5", "не работает"),
            ("6", "прочие"),
        ],
        "6",
        "9.5",
    ),
    field_def(
        "diagnosis",
        "Код диагноза по Международной статистической классификации болезней и проблем, "
        "связанных со здоровьем",
        "text",
        field_rule("defined", "9.6"),
        required=True,
        basis="source",
        anchor="Код диагноза по Международной статистической классификации болезней и проблем, "
        "связанных со здоровьем",
        prefill={"sources": ["episode.diagnosis.text", "episode.diagnosis.icd10"], "join": ", "},
        multiline=True,
        maxLength=400,
    ),
    field_def(
        "purpose",
        "Направляется для оказания медицинской помощи",
        "text",
        field_rule("defined", "9.7"),
        required=True,
        basis="source",
        anchor="Направляется для оказания медицинской помощи",
        multiline=True,
        maxLength=300,
    ),
    _choice(
        "careForm",
        "форма",
        "форма: экстренная – 1, неотложная – 2, плановая – 3",
        [("1", "экстренная"), ("2", "неотложная"), ("3", "плановая")],
        "6",
        "9.7",
        required=True,
    ),
    _choice(
        "careKind",
        "вид",
        "вид: первичная медико-санитарная помощь, в том числе специализированная – 1",
        [
            ("1", "первичная медико-санитарная помощь, в том числе специализированная"),
            ("2", "специализированная, в том числе высокотехнологичная медицинская помощь"),
            ("3", "паллиативная медицинская помощь"),
            ("4", "скорая специализированная медицинская помощь"),
        ],
        "6",
        "9.7",
        required=True,
    ),
    _choice(
        "careConditions",
        "условия",
        "условия: амбулаторно – 1; в дневном стационаре – 2; стационарно – 3",
        [("1", "амбулаторно"), ("2", "в дневном стационаре"), ("3", "стационарно")],
        "6",
        "9.7",
        required=True,
    ),
    field_def(
        "justification",
        "Обоснование (показания) направления с указанием числа назначаемых курсов (циклов) лечения",
        "text",
        field_rule("defined", "9.8"),
        required=True,
        basis="source",
        anchor="Обоснование (показания) направления с указанием числа назначаемых курсов "
        "(циклов) лечения",
        multiline=True,
        maxLength=800,
    ),
    field_def(
        "referrerPosition",
        "Должность, специальность медицинского работника, направившего пациента",
        "text",
        field_rule("defined", "9.9"),
        required=True,
        basis="source",
        anchor="Должность, специальность медицинского работника, направившего пациента",
        prefill={"sources": ["clinician.position"]},
        multiline=True,
        maxLength=300,
    ),
    field_def(
        "referrerSignature",
        "(подпись)",
        "signature",
        field_rule("defined", "9.9"),
        anchor="(подпись)",
    ),
    field_def(
        "referrerName",
        "Фамилия, имя, отчество (при наличии)",
        "text",
        field_rule("defined", "9.9"),
        required=True,
        basis="source",
        anchor="Фамилия, имя, отчество (при наличии)",
        prefill={"sources": ["clinician.fullName"]},
        maxLength=200,
    ),
    field_def(
        "stamp",
        "М.П. (при наличии)",
        "stamp",
        field_rule("defined", "10"),
        anchor="М.П. (при наличии)",
    ),
]

SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "organization",
        "title": "Организация и номер направления",
        "fieldIds": [
            "organization",
            "organizationOgrn",
            "formNumber",
            "formDate",
            "destinationOrganization",
        ],
    },
    {
        "id": "insurance",
        "title": "Полис обязательного медицинского страхования",
        "fieldIds": ["omsPolicyNumber", "omsPolicyIssueDate", "omsInsurer"],
    },
    {
        "id": "patient",
        "title": "Пациент",
        "description": "Заполняется по сведениям формы № 025/у (п. 9.4).",
        "fieldIds": [
            "patientFullName",
            "patientBirthDate",
            "patientSex",
            "residenceSubject",
            "residenceDistrict",
            "residenceLocality",
            "residenceStreet",
            "residenceHouse",
            "residenceBuilding",
            "residenceApartment",
            "staySubject",
            "stayDistrict",
            "stayLocality",
            "stayStreet",
            "stayHouse",
            "stayBuilding",
            "stayApartment",
            "localityType",
            "employment",
        ],
    },
    {
        "id": "referral",
        "title": "Направление",
        "fieldIds": [
            "diagnosis",
            "purpose",
            "careForm",
            "careKind",
            "careConditions",
            "justification",
        ],
    },
    {
        "id": "referrer",
        "title": "Направивший медицинский работник",
        "description": "Подпись и печать ставятся на бумажной форме.",
        "fieldIds": ["referrerPosition", "referrerName"],
    },
]


def _lines(*texts: str) -> list[dict[str, Any]]:
    return [row(text(value)) for value in texts]


def _date_words(field_id: str, *, day: float, month: float, year: float) -> list[dict[str, Any]]:
    """`число ______ месяц ____________ год __________` — one date field, three blanks."""
    return [
        text("число"),
        blank(field_id, day, part="day"),
        text("месяц"),
        blank(field_id, month, part="month"),
        text("год"),
        blank(field_id, year, part="year"),
    ]


def _address_rows(prefix: str, caption: str) -> list[dict[str, Any]]:
    return [
        row(
            text(caption),
            blank(f"{prefix}Subject", 30, grow=True),
            text("район"),
            blank(f"{prefix}District", 20, grow=True),
        ),
        row(
            text("населенный пункт"),
            blank(f"{prefix}Locality", 30, grow=True),
            text("улица"),
            blank(f"{prefix}Street", 30, grow=True),
            text("дом"),
            blank(f"{prefix}House", 4),
            text("строение/корпус"),
            blank(f"{prefix}Building", 4),
            text("квартира"),
            blank(f"{prefix}Apartment", 4),
        ),
    ]


def _one_column(block_id: str, rows: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"id": block_id, "columns": [{"widthPercent": 100, "rows": rows}], **extra}


LAYOUT: Final[dict[str, Any]] = {
    "page": {
        "size": "A4",
        "orientation": "portrait",
        "marginMm": {"top": 10, "right": 10, "bottom": 10, "left": 15},
        "fontSizePt": 10.5,
    },
    "blocks": [
        {
            "id": "header",
            "columns": [
                {
                    "widthPercent": 48,
                    "align": "left",
                    "rows": [
                        *_lines(
                            "Наименование и адрес медицинской организации",
                            "в пределах места нахождения",
                            "(фамилия, имя, отчество (при наличии)",
                            "индивидуального предпринимателя и адрес",
                            "осуществления медицинской деятельности)",
                            "Основной государственный регистрационный номер",
                            "(Основной государственный регистрационный",
                            "номер индивидуального предпринимателя)",
                        ),
                        row(blank("organization", 40, grow=True), gap="small"),
                        row(blank("organizationOgrn", 40, grow=True)),
                    ],
                },
                {
                    "widthPercent": 36,
                    "align": "center",
                    "rows": [
                        row(text("Медицинская документация"), align="center"),
                        row(text("Учетная форма № 057/у"), align="center"),
                        row(text("Утверждена приказом Министерства"), align="center", gap="small"),
                        row(text("здравоохранения Российской Федерации"), align="center"),
                        row(text("от «02» сентября 2025 г. № 519н"), align="center"),
                    ],
                },
            ],
        },
        _one_column(
            "title",
            [
                row(
                    text("НАПРАВЛЕНИЕ ДЛЯ ОКАЗАНИЯ МЕДИЦИНСКОЙ ПОМОЩИ №", bold=True),
                    blank("formNumber", 8),
                    align="center",
                    bold=True,
                    gap="large",
                )
            ],
        ),
        _one_column(
            "date",
            [
                row(
                    text("Дата заполнения направления:"),
                    *_date_words("formDate", day=6, month=12, year=10),
                    gap="medium",
                ),
                row(blank("destinationOrganization", 60, grow=True), gap="small"),
                row(
                    text("(наименование медицинской организации, куда направлен пациент)"),
                    align="center",
                ),
            ],
        ),
        _one_column(
            "insurance",
            [
                row(
                    text("Полис обязательного медицинского страхования:"),
                    blank("omsPolicyNumber", 40, grow=True),
                    gap="small",
                ),
                row(
                    text("дата выдачи полиса обязательного медицинского страхования:"),
                    *_date_words("omsPolicyIssueDate", day=6, month=10, year=8),
                ),
                row(
                    text(
                        "данные о страховой медицинской организации, выбранной застрахованным "
                        "лицом или определенной застрахованному"
                    ),
                    align="stretch",
                ),
                row(text("лицу"), blank("omsInsurer", 60, grow=True)),
            ],
        ),
        _one_column(
            "patient",
            [
                row(
                    text("Фамилия, имя, отчество (при наличии) пациента"),
                    blank("patientFullName", 60, grow=True),
                    gap="small",
                ),
                row({"kind": "rule", "length": 60, "grow": True}),
                row(
                    text("Дата рождения: «"),
                    blank("patientBirthDate", 4, part="day"),
                    text("»"),
                    blank("patientBirthDate", 14, part="month"),
                    blank("patientBirthDate", 8, part="year"),
                    text("г."),
                    text("Пол:"),
                    options("patientSex", ", "),
                ),
                *_address_rows(
                    "residence", "Регистрация по месту жительства: субъект Российской Федерации"
                ),
                *_address_rows(
                    "stay", "Регистрация по месту пребывания: субъект Российской Федерации"
                ),
                row(text("Местность:"), options("localityType", ", ", underline=True)),
                row(
                    text("Занятость:"),
                    options("employment", ", ", underline=True),
                    align="justify",
                ),
            ],
        ),
        _one_column(
            "referral",
            [
                row(
                    text(
                        "Код диагноза по Международной статистической классификации болезней "
                        "и проблем, связанных со здоровьем"
                    ),
                    align="stretch",
                ),
                row(blank("diagnosis", 60, grow=True)),
                row({"kind": "rule", "length": 60, "grow": True}),
                row(
                    text("Направляется для оказания медицинской помощи:"),
                    blank("purpose", 60, grow=True),
                    text(","),
                    gap="medium",
                ),
                row(text("форма:"), options("careForm", ", ", underline=True), text(";")),
                row(
                    text("вид:"),
                    {
                        **options("careKind", ", ", underline=True),
                        "separators": [", ", ", ", "; "],
                    },
                    text(";"),
                    align="justify",
                ),
                row(
                    text("условия:"),
                    {**options("careConditions", "; ", underline=True)},
                    text("."),
                ),
                row(
                    text(
                        "Обоснование (показания) направления с указанием числа назначаемых "
                        "курсов (циклов) лечения"
                    ),
                    blank("justification", 20, grow=True),
                ),
                row({"kind": "rule", "length": 60, "grow": True}),
                row({"kind": "rule", "length": 60, "grow": True}),
                row(
                    text("Должность, специальность медицинского работника, направившего пациента"),
                    blank("referrerPosition", 30, grow=True),
                ),
                row({"kind": "rule", "length": 60, "grow": True}),
            ],
        ),
        _one_column(
            "signatures",
            [
                row(
                    {
                        "kind": "signature",
                        "fieldId": "referrerSignature",
                        "length": 20,
                        "caption": "(подпись)",
                    },
                    blank(
                        "referrerName",
                        40,
                        grow=True,
                        caption="Фамилия, имя, отчество (при наличии)",
                    ),
                    gap="large",
                ),
                row(
                    {"kind": "stamp", "fieldId": "stamp", "text": "М.П. (при наличии)"},
                    gap="large",
                ),
            ],
        ),
    ],
}

NOTES: Final[list[str]] = [
    "Приказ № 519н не содержит срока вступления в силу; в схеме действует с 27.10.2025 — по общему "
    "правилу (10 дней после официального опубликования 16.10.2025), срок окончания не установлен. "
    "Прежняя форма № 057/у-04 (приказ 2004 г. № 255) признана утратившей силу.",
    "Пункт 6 порядка: на бумажном носителе врач вносит сведения и подчеркивает ответы из "
    "предложенных вариантов — выбранные варианты на печати подчеркиваются.",
    "Пункт 9.2 относит «куда направлен пациент» к шапке бланка; бланк печатает отдельную строку "
    "«(наименование медицинской организации, куда направлен пациент)» — поле создано по этой "
    "подписи (rule.status = by-line).",
    "Строка «Местность» порядком не описана (п. 9.4 её не перечисляет): rule.status = undefined.",
    "Обязательность полей (required) порядок прямо не задаёт: basis = source — пункт говорит, что "
    "в строке «указывается»/«заполняется» значение; basis = editorial — вывод по виду бланка. "
    "Незаполненные обязательные поля подсвечиваются, печать не блокируется.",
    "Направление формируется на бумажном носителе в случае направления пациента для оказания "
    "первичной, специализированной, паллиативной помощи, скорой специализированной помощи (п. 2); "
    "электронный документ с усиленной квалифицированной подписью приложение не создаёт.",
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
    effective_until=None,
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
    edition_note=EDITION_NOTE,
)
