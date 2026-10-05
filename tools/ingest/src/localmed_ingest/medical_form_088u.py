"""Reviewed blueprint of form 088/у «Направление на медико-социальную экспертизу медицинской
организацией» (joint order of Минтруд России № 488н and Минздрав России № 551н of 12.08.2022).

The blank is appendix 1 (PDF pages 2–14, thirteen sheets that flow one into the next: tables and
paragraphs run across the page breaks), the «Порядок заполнения» is appendix 2 (PDF pages 15–31).
Unlike the Минздрав orders of 2025 the rules are not numbered «9.1. text»: paragraph 10 is a list
«1) … 47)» of items, and under an item a line «в подпункте X.Y делается …» governs one printed
point. The preparer cuts item `N)` as paragraph `10.N` and the line for point X.Y of item N as
`10.N.X.Y` (`medical_forms.split_item_paragraphs`).

Same method as `medical_form_070u`: every printed caption is located in the OCR text of the blank
(or confirmed on the scan), every cited paragraph is cut from the OCR text of the order and
checked word by word against the scan image.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    ICD10_MESSAGE,
    ICD10_PATTERN,
    SNILS_PATTERN,
    blank,
    check,
    field_def,
    field_rule,
    options,
    row,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.mintrud-minzdrav.488n-551n.088u"
FORM_NUMBER: Final = "088/у"
FORM_TITLE: Final = "Направление на медико-социальную экспертизу медицинской организацией"
ISSUER: Final = (
    "Министерство труда и социальной защиты Российской Федерации и "
    "Министерство здравоохранения Российской Федерации"
)
ORDER_NUMBER: Final = "488н/551н"
ORDER_DATE: Final = "2022-08-12"
ORDER_TITLE: Final = (
    "Об утверждении формы направления на медико-социальную экспертизу медицинской организацией "
    "и порядка ее заполнения"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "70900",
    "date": "2022-11-10",
}
# «вступает в силу по истечении 10 дней после дня официального опубликования» (clause 3 of the
# order; published 10.11.2022), the provisions on the Единый портал госуслуг from 01.02.2023.
EFFECTIVE_FROM: Final = "2022-11-21"
EDITION_NOTE: Final = (
    "вступил в силу по истечении 10 дней после дня официального опубликования 10.11.2022; "
    "положения об использовании единого портала государственных и муниципальных услуг — "
    "с 01.02.2023; срок действия приказом не ограничен; заменил приказ от 01.02.2021 № 27н/36н"
)
BLANK_APPENDIX: Final = 1
BLANK_PAGES: Final = tuple(range(2, 15))
RULES_APPENDIX: Final = 2
RULES_PAGES: Final = tuple(range(15, 32))

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {
    15: 0.145,
    16: 0.15,
    17: 0.147,
    19: 0.10,
    23: 0.12,
    24: 0.09,
    26: 0.153,
    29: 0.18,
    31: 0.30,
}

_FOOTNOTE = "footnote reference mark recognised as punctuation or a digit"
_DASH = "typographic dash (en dash) printed in the order, recognised as a hyphen"
_LOOKALIKE = "Latin letter recognised for the Cyrillic one of the same shape"
_LEAD = "short word at the start of a printed line is lost or changed in case"
_PUNCT = "punctuation at the end of the item read wrongly (the scan has a semicolon)"
_STRAY = "stray fragment recognised inside the printed line"

# Whole printed lines or fragments fixed after comparison with the scan image (each page of the
# order was read against the OCR text). The scan prints an en dash in «(далее – …)» and in
# «– для лиц», but a plain hyphen in «1941 - 1945» (page 25), which is therefore left alone.
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(
        16, "МеДИЦИНСКОЙ", "медицинской", "capital letters recognised inside a lower-case word"
    ),
    Correction(17, "(далее -", "(далее –", _DASH),
    Correction(17, "Правил' такой", "Правил такой", _FOOTNOTE),
    Correction(17, "Правил® освидетельствование", "Правил освидетельствование", _FOOTNOTE),
    Correction(17, "Правил'° освидетельствование", "Правил освидетельствование", _FOOTNOTE),
    Correction(17, "088/y", "088/у", _LOOKALIKE),
    Correction(17, 'Правил":', "Правил:", _FOOTNOTE),
    Correction(18, "до 1 года - число", "до 1 года – число", _DASH),
    Correction(18, "гражданина - мужской", "гражданина – мужской", _DASH),
    Correction(18, "гражданина - женский", "гражданина – женский", _DASH),
    Correction(19, "Федерации»!?;", "Федерации»;", _FOOTNOTE),
    Correction(19, "учете - для лиц", "учете – для лиц", _DASH),
    Correction(19, "специальности - для лиц", "специальности – для лиц", _DASH),
    Correction(20, "жительства - указывается", "жительства – указывается", _DASH),
    Correction(20, "гражданин,", "гражданин;", _PUNCT),
    Correction(20, "гражданина,", "гражданина;", _PUNCT),
    Correction(
        20,
        "если гражданин состоит на воинском учете,",
        "если гражданин состоит на воинском учете;",
        _PUNCT,
    ),
    Correction(21, "подпункте 13.2.1 делается", "в подпункте 13.2.1 делается", _LEAD),
    Correction(21, "подпункте 13.2.2 делается", "в подпункте 13.2.2 делается", _LEAD),
    Correction(21, "подпункте 13.3 делается", "в подпункте 13.3 делается", _LEAD),
    Correction(21, "отметка «Х» случае", "отметка «Х» в случае", _LEAD),
    Correction(22, "подпункте 17.2.1 делается", "в подпункте 17.2.1 делается", _LEAD),
    Correction(22, "В подпункте 17.2.3", "в подпункте 17.2.3", _LEAD),
    Correction(22, "В подпункте 17.3.1", "в подпункте 17.3.1", _LEAD),
    Correction(22, "ЛИЦО:", "лицо:", _LEAD),
    Correction(23, "«X»", "«Х»", _LOOKALIKE),
    Correction(23, "(ero законным", "(его законным", "OCR confuses «го» and «ro»"),
    Correction(23, "Правил':", "Правил:", _FOOTNOTE),
    Correction(23, "Правил4:", "Правил:", _FOOTNOTE),
    Correction(23, "экспертизы - личное", "экспертизы – личное", _DASH),
    Correction(23, "экспертизы - без", "экспертизы – без", _DASH),
    Correction(24, "(далее - единый", "(далее – единый", _DASH),
    Correction(24, "Правил';", "Правил;", _FOOTNOTE),
    Correction(24, "отметка г «Х»", "отметка «Х»", _STRAY),
    Correction(25, "подпункте 20.4.1 делается", "в подпункте 20.4.1 делается", _LEAD),
    Correction(25, "В подпункте 20.4.2", "в подпункте 20.4.2", _LEAD),
    Correction(25, "подпункте 20.4.3 делается", "в подпункте 20.4.3 делается", _LEAD),
    Correction(25, "подпункте 20.4.4 делается", "в подпункте 20.4.4 делается", _LEAD),
    Correction(25, "«X»", "«Х»", _LOOKALIKE),
    Correction(25, "В подпункте 20.4.6", "в подпункте 20.4.6", _LEAD),
    Correction(25, "особого риска»,", "особого риска»;", _PUNCT),
    Correction(26, "Федерации , а также", "Федерации, а также", _FOOTNOTE),
    Correction(27, "направлении в детально", "направлении детально", _STRAY),
    Correction(28, "Функций;", "функций;", "capital letter recognised for a lower-case word"),
    Correction(28, "(далее - ЭЛН)", "(далее – ЭЛН)", _DASH),
    Correction(29, "о весе гражданина,", "о весе гражданина;", _PUNCT),
    Correction(29, "врачей - специалистов", "врачей – специалистов", _DASH),
    Correction(
        29, "проведенных медицинской организацией", "о проведенных медицинской организацией", _LEAD
    ),
    Correction(29, "медицинских M обследованиях", "медицинских обследованиях", _STRAY),
    Correction(29, "обследования' (при", "обследования (при", _FOOTNOTE),
    Correction(29, "(далее - МКБ)", "(далее – МКБ)", _DASH),
    Correction(30, "организации,", "организации;", _PUNCT),
    Correction(30, "(далее - пострадавший", "(далее – пострадавший", _DASH),
    Correction(30, "088/y", "088/у", _LOOKALIKE),
    Correction(31, "Правил'8, , подписывается", "Правил, подписывается", _FOOTNOTE),
)


# ------------------------------------------------------------------------------- field helpers

# Points that have a line of their own in the order and introduce the points under them
# («в подпункте 20.3 делается отметка о периоде …:» then 20.3.1 … 20.3.4); a field of such a point
# cites that line as well.
GROUP_LINES: Final = frozenset(
    {"17.2", "17.3", "17.4", "17.6", "19.2", "19.3", "20.1", "20.3", "20.4", "27.1", "27.2"}
)


def rule(
    item: int, sub: str | None = None, *, status: str = "defined", note: str | None = None
) -> dict[str, Any]:
    """The rule of a field: item `N)` of paragraph 10 and the line of its printed point."""
    paragraphs = [f"10.{item}"]
    if sub:
        parent = sub.rsplit(".", 1)[0]
        if parent in GROUP_LINES:
            paragraphs.append(f"10.{item}.{parent}")
        paragraphs.append(f"10.{item}.{sub}")
    return field_rule(status, *paragraphs, note=note)


def box(
    field_id: str,
    label: str,
    item: int,
    sub: str | None = None,
    *,
    anchor: str | None = None,
    sub_line: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """A checkbox «нужное отметить»; `sub_line` names the line when it governs several points."""
    return field_def(
        field_id,
        label,
        "checkbox",
        rule(item, sub_line or sub),
        anchor=anchor if anchor is not None else label,
        **extra,
    )


def entry(
    field_id: str,
    label: str,
    item: int,
    sub: str | None = None,
    *,
    kind: str = "text",
    anchor: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        kind,
        rule(item, sub),
        anchor=anchor if anchor is not None else label,
        **extra,
    )


def undefined(
    field_id: str, label: str, note: str, *, kind: str = "text", **extra: Any
) -> dict[str, Any]:
    return field_def(field_id, label, kind, field_rule("undefined", note=note), **extra)


def date_entry(
    field_id: str, label: str, item: int, sub: str | None = None, **extra: Any
) -> dict[str, Any]:
    return entry(field_id, label, item, sub, kind="date", notAfter="today", **extra)


def icd(
    field_id: str, label: str, item: int, sub: str | None = None, **extra: Any
) -> dict[str, Any]:
    return entry(
        field_id,
        label,
        item,
        sub,
        kind="icd10",
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
        **extra,
    )


def prognosis(field_id: str, label: str, item: int, labels: list[str]) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "choice",
        rule(item),
        options=[{"value": str(i + 1), "label": value} for i, value in enumerate(labels)],
        anchor=label,
    )


# The captions of the free-text lines of the blank that have no number of their own
_FREE_LINES_NOTE = (
    "Свободные строки предназначены для текстовой информации (п. 8 Порядка); отдельный пункт "
    "Порядка эту строку не называет."
)

PROFILE_NOTE: Final = (
    "Пункт Порядка называет строку целиком; порядок не задаёт, из каких данных гражданина её "
    "составлять."
)


def _fields() -> list[dict[str, Any]]:
    f: list[dict[str, Any]] = []
    # ---- header lines (items 1–3)
    f += [
        entry(
            "organizationName",
            "наименование медицинской организации",
            1,
            required=True,
            basis="source",
            prefill={"sources": ["organization.name"]},
            multiline=True,
            maxLength=300,
        ),
        entry(
            "organizationAddress",
            "адрес медицинской организации",
            2,
            required=True,
            basis="source",
            prefill={"sources": ["organization.address"]},
            multiline=True,
            maxLength=300,
        ),
        entry(
            "organizationOgrn",
            "ОГРН медицинской организации",
            3,
            required=True,
            basis="source",
            prefill={"sources": ["organization.ogrn"]},
            pattern="^(?:[0-9]{13}|[0-9]{15})$",
            patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
        ),
    ]
    # ---- 1–4
    f += [
        entry(
            "protocolNumber",
            "Номер протокола врачебной комиссии медицинской организации",
            4,
            required=True,
            basis="source",
            anchor="Номер и дата протокола врачебной комиссии",
            maxLength=60,
        ),
        date_entry(
            "protocolDate",
            "Дата протокола врачебной комиссии медицинской организации",
            4,
            required=True,
            basis="source",
            anchor="содержащего решение о направлении гражданина",
        ),
        box(
            "needsHomeVisit",
            "медико-социальную экспертизу необходимо проводить на дому",
            5,
            anchor="необходимо проводить на дому",
        ),
        box(
            "needsPalliativeCare",
            "Гражданин нуждается в оказании паллиативной медицинской помощи",
            6,
        ),
        box(
            "needsPrimaryProsthetics",
            "Гражданин, находящийся на лечении в стационаре в связи с операцией по ампутации "
            "(реампутации) конечности (конечностей), нуждающийся в первичном протезировании",
            7,
            anchor="нуждающийся в первичном протезировании",
        ),
    ]
    # ---- 5 purposes
    for index, (field_id, label) in enumerate(PURPOSES, start=1):
        f.append(box(field_id, label, 8, f"5.{index}"))
    # ---- section I, 6–10
    f += [
        entry(
            "patientFullName",
            "Фамилия, имя, отчество (при наличии)",
            9,
            required=True,
            basis="source",
            prefill={"sources": ["patient.fullName"]},
            maxLength=200,
        ),
        date_entry(
            "patientBirthDate",
            "Дата рождения (день, месяц, год)",
            10,
            required=True,
            basis="source",
            prefill={"sources": ["patient.birthDate"]},
        ),
        entry(
            "patientAge",
            "возраст (число полных лет, для ребенка в возрасте до 1 года – число полных месяцев)",
            10,
            required=True,
            basis="source",
            anchor="возраст (число полных лет, для ребенка в возрасте до 1 года",
            maxLength=40,
        ),
        box(
            "sexMale",
            "Мужской",
            11,
            "8.1",
            anchor="8. Пол (нужное отметить)",
            prefill={"sources": ["patient.sex"], "map": {"male": "true"}},
        ),
        box(
            "sexFemale",
            "Женский",
            11,
            "8.2",
            anchor="8. Пол (нужное отметить)",
            prefill={"sources": ["patient.sex"], "map": {"female": "true"}},
        ),
        box("citizenshipRussian", "Гражданин Российской Федерации", 12, "9.1"),
        box(
            "citizenshipForeign",
            "Гражданин иностранного государства, находящийся на территории Российской Федерации",
            12,
            "9.2",
        ),
        box(
            "citizenshipStateless",
            "Лицо без гражданства, находящееся на территории Российской Федерации",
            12,
            "9.2",
        ),
        box(
            "militaryRegistered",
            "Гражданин, состоящий на воинском учете",
            13,
            "10.1",
        ),
        box(
            "militaryObligedNotRegistered",
            "Гражданин, не состоящий на воинском учете, но обязанный состоять на воинском учете",
            13,
            "10.2",
        ),
        box(
            "militaryEnrolling",
            "Гражданин, поступающий на воинский учет",
            13,
            "10.3",
        ),
        box(
            "militaryNotRegistered",
            "Гражданин, не состоящий на воинском учете",
            13,
            "10.4",
        ),
    ]
    # ---- 11–12 address
    f += [
        entry(
            "residenceCountry",
            "Государство",
            14,
            "11.1",
            anchor="11.1. Государство",
            required=True,
            basis="source",
            maxLength=120,
        ),
        entry(
            "residencePostcode",
            "Почтовый индекс",
            14,
            "11.2",
            anchor="11.2. Почтовый индекс",
            required=True,
            basis="source",
            maxLength=20,
        ),
        entry(
            "residenceSubject",
            "Субъект Российской Федерации",
            14,
            "11.3",
            anchor="11.3. Субъект Российской Федерации",
            required=True,
            basis="source",
            prefill={"sources": ["patient.address.subject"]},
            maxLength=120,
        ),
        entry(
            "residenceDistrict",
            "Район",
            14,
            "11.4",
            anchor="11.4. Район",
            prefill={"sources": ["patient.address.district"]},
            maxLength=120,
        ),
        entry(
            "residenceLocality",
            "Наименование населенного пункта",
            14,
            "11.5",
            anchor="11.5. Наименование населенного пункта",
            required=True,
            basis="source",
            prefill={"sources": ["patient.address.locality"]},
            maxLength=120,
        ),
        entry(
            "residenceStreet",
            "Улица",
            14,
            "11.6",
            anchor="11.6. Улица",
            prefill={"sources": ["patient.address.street"]},
            maxLength=120,
        ),
        entry(
            "residenceHouse",
            "Дом (корпус, строение)",
            14,
            "11.7",
            anchor="11.7. Дом (корпус, строение)",
            prefill={"sources": ["patient.address.house", "patient.address.building"]},
            maxLength=40,
        ),
        entry(
            "residenceApartment",
            "Квартира",
            14,
            "11.8",
            anchor="11.8. Квартира",
            prefill={"sources": ["patient.address.apartment"]},
            maxLength=20,
        ),
        box(
            "noFixedResidence",
            "Лицо без определенного места жительства",
            15,
            anchor="Лицо без определенного места жительства",
        ),
    ]
    # ---- 13 location
    for suffix, number, label, address_label, ogrn_label, _anchor in LOCATIONS:
        f.append(box(f"stay{suffix}", label, 16, number))
        if address_label:
            f.append(
                entry(
                    f"stay{suffix}Address",
                    address_label,
                    16,
                    f"{number}.1",
                    multiline=True,
                    maxLength=300,
                )
            )
            f.append(
                entry(
                    f"stay{suffix}Ogrn",
                    ogrn_label,
                    16,
                    f"{number}.2",
                    maxLength=20,
                )
            )
    f.append(
        box(
            "stayAtResidence",
            "По месту жительства (по месту пребывания, фактического проживания на территории "
            "Российской Федерации)",
            16,
            "13.5",
            anchor="По месту жительства (по месту пребывания",
        )
    )
    # ---- 14–16 contacts, SNILS, identity document
    f += [
        entry(
            "contactPhones",
            "Номера телефонов",
            17,
            "14.1",
            anchor="14.1. Номера телефонов",
            prefill={"sources": ["patient.address.phone"]},
            maxLength=120,
        ),
        entry(
            "contactEmail",
            "Адрес электронной почты (при наличии)",
            17,
            "14.2",
            anchor="14.2. Адрес электронной почты",
            maxLength=120,
        ),
        entry(
            "snils",
            "СНИЛС",
            18,
            anchor="СНИЛС:",
            prefill={"sources": ["patient.snils"]},
            pattern=SNILS_PATTERN,
            patternMessage="СНИЛС в формате 123-456-789 01",
        ),
        entry(
            "omsPolicyNumber",
            "Номер полиса обязательного медицинского страхования (при наличии)",
            18,
            anchor="Номер полиса обязательного медицинского страхования",
            prefill={"sources": ["patient.omsPolicy.number"]},
            maxLength=60,
        ),
        entry("idDocName", "Наименование", 19, "16.1", anchor="16.1. Наименование", maxLength=200),
        entry("idDocSeries", "Серия", 19, "16.2", anchor="16.2. Серия", maxLength=30),
        entry("idDocNumber", "номер", 19, "16.2", anchor="номер", maxLength=30),
        entry("idDocIssuedBy", "Кем выдан", 19, "16.3", anchor="16.3. Кем выдан", maxLength=300),
        date_entry(
            "idDocIssueDate",
            "Дата выдачи (день, месяц, год)",
            19,
            "16.4",
            anchor="16.4. Дата выдачи",
        ),
    ]
    # ---- 17 representative
    f += [
        entry(
            "repFullName",
            "Фамилия, имя, отчество (при наличии)",
            20,
            "17.1",
            anchor="17.1. Фамилия, имя, отчество",
            maxLength=200,
        ),
        date_entry(
            "repBirthDate",
            "Дата рождения (день, месяц, год)",
            20,
            "17.1.1",
            anchor="17.1.1. Дата рождения",
        ),
        entry(
            "repAuthDocName",
            "Наименование (документ, удостоверяющий полномочия)",
            20,
            "17.2.1",
            anchor="17.2.1. Наименование",
            maxLength=200,
        ),
        entry("repAuthDocSeries", "Серия", 20, "17.2.2", anchor="17.2.2. Серия", maxLength=30),
        entry("repAuthDocNumber", "номер", 20, "17.2.2", anchor="номер", maxLength=30),
        entry(
            "repAuthDocIssuedBy",
            "Кем выдан",
            20,
            "17.2.3",
            anchor="17.2.3. Кем выдан",
            maxLength=300,
        ),
        date_entry(
            "repAuthDocIssueDate",
            "Дата выдачи (день, месяц, год)",
            20,
            "17.2.4",
            anchor="17.2.4. Дата выдачи",
        ),
        entry(
            "repIdDocName",
            "Наименование (документ, удостоверяющий личность)",
            20,
            "17.3.1",
            anchor="17.3.1. Наименование",
            maxLength=200,
        ),
        entry("repIdDocSeries", "Серия", 20, "17.3.2", anchor="17.3.2. Серия", maxLength=30),
        entry("repIdDocNumber", "номер", 20, "17.3.2", anchor="номер", maxLength=30),
        entry(
            "repIdDocIssuedBy", "Кем выдан", 20, "17.3.3", anchor="17.3.3. Кем выдан", maxLength=300
        ),
        date_entry(
            "repIdDocIssueDate",
            "Дата выдачи (день, месяц, год)",
            20,
            "17.3.4",
            anchor="17.3.4. Дата выдачи",
        ),
        entry(
            "repPhones",
            "Номера телефонов (представитель)",
            20,
            "17.4.1",
            anchor="17.4.1. Номера телефонов",
            maxLength=120,
        ),
        entry(
            "repEmail",
            "Адрес электронной почты (при наличии) (представитель)",
            20,
            "17.4.2",
            anchor="17.4.2. Адрес электронной почты",
            maxLength=120,
        ),
        entry(
            "repSnils",
            "Страховой номер индивидуального лицевого счета (СНИЛС)",
            20,
            "17.5",
            anchor="17.5. Страховой номер индивидуального лицевого счета",
            pattern=SNILS_PATTERN,
            patternMessage="СНИЛС в формате 123-456-789 01",
        ),
        entry(
            "guardianOrgName",
            "Наименование (организация-опекун)",
            20,
            "17.6.1",
            anchor="17.6.1. Наименование",
            maxLength=300,
        ),
        entry(
            "guardianOrgAddress",
            "Адрес (организация-опекун)",
            20,
            "17.6.2",
            anchor="17.6.2. Адрес",
            maxLength=300,
        ),
        entry(
            "guardianOrgOgrn",
            "Основной государственный регистрационный номер (ОГРН)",
            20,
            "17.6.3",
            anchor="17.6.3. Основной государственный регистрационный номер",
            pattern="^(?:[0-9]{13}|[0-9]{15})$",
            patternMessage="ОГРН — 13 цифр",
        ),
    ]
    # ---- 18–19
    f += [
        box("referralFirst", "Первично", 21, "18.1"),
        box("referralRepeat", "Повторно", 21, "18.2"),
        date_entry(
            "consentDate",
            "Гражданин (его законный или уполномоченный представитель) дал согласие на "
            "направление и проведение медико-социальной экспертизы",
            22,
            "19.1",
            anchor="Гражданин (его законный или уполномоченный представитель) дал согласие",
        ),
        box("consentInPerson", "с личным присутствием (очно)", 22, "19.2.1"),
        box("consentRemote", "без личного присутствия (заочно)", 22, "19.2.2"),
        box(
            "noticePhone",
            "по каналам телефонной связи, включая мобильную связь, в том числе посредством "
            "направления коротких текстовых сообщений",
            22,
            "19.3.1",
        ),
        box(
            "noticePost",
            "в форме документа на бумажном носителе заказным почтовым отправлением",
            22,
            "19.3.2",
        ),
        box(
            "noticePortal",
            "в форме электронного документа с использованием федеральной государственной "
            "информационной системы «Единый портал государственных и муниципальных услуг "
            "(функций)»",
            22,
            "19.3.3",
        ),
    ]
    # ---- 20 previous examination
    for index, (field_id, label) in enumerate(PREV_GROUPS, start=1):
        f.append(box(field_id, label, 23, f"20.1.{index}"))
    f.append(
        date_entry(
            "prevDisabilityUntil",
            "Дата, до которой установлена инвалидность (день, месяц, год)",
            23,
            "20.2",
            anchor="20.2. Дата, до которой установлена инвалидность",
        )
    )
    for index, (field_id, label) in enumerate(PREV_PERIODS, start=1):
        f.append(box(field_id, label, 23, f"20.3.{index}"))
    for index, (field_id, label) in enumerate(PREV_CAUSES, start=1):
        f.append(box(field_id, label, 23, f"20.4.{index}"))
    f += [
        entry(
            "prevCauseOtherText",
            "Иные причины, установленные законодательством Российской Федерации (указать)",
            23,
            "20.4.17",
            anchor="Иные причины",
            multiline=True,
            maxLength=300,
        ),
        entry(
            "prevCauseLegacyText",
            "Причины инвалидности, установленные в соответствии с "
            "законодательством, действовавшим на момент установления инвалидности (указать)",
            23,
            "20.4.18",
            anchor="20.4.18. Причины инвалидности",
            multiline=True,
            maxLength=500,
        ),
        entry(
            "prevProfLossPercent",
            "Степень утраты профессиональной трудоспособности в "
            "процентах на момент направления гражданина на медико-социальную экспертизу",
            23,
            "20.5",
            anchor="20.5. Степень утраты профессиональной трудоспособности",
            maxLength=20,
        ),
        entry(
            "prevProfLossTerm",
            "Срок, на который установлена степень утраты профессиональной "
            "трудоспособности в процентах",
            23,
            "20.6",
            anchor="20.6. Срок, на который установлена степень",
            maxLength=60,
        ),
        date_entry(
            "prevProfLossUntil",
            "Дата, до которой установлена степень утраты "
            "профессиональной трудоспособности в процентах (день, месяц, год)",
            23,
            "20.7",
            anchor="20.7. Дата, до которой установлена степень",
        ),
        entry(
            "prevProfLossRepeat",
            "Степени утраты профессиональной трудоспособности (в "
            "процентах), установленные по повторным несчастным случаям на производстве и "
            "профессиональным заболеваниям, и даты, до которых они установлены",
            23,
            "20.8",
            anchor="20.8. Степени утраты профессиональной трудоспособности",
            multiline=True,
            maxLength=500,
        ),
    ]
    # ---- 21–22 education and work
    f += [
        entry(
            "educationOrg",
            "Наименование и адрес образовательной организации, в которой "
            "гражданин получает образование",
            24,
            "21.1",
            anchor="21.1. Наименование и адрес образовательной организации",
            multiline=True,
            maxLength=400,
        ),
        entry(
            "educationCourse",
            "Курс, класс, возрастная группа детского дошкольного "
            "учреждения (нужное подчеркнуть и указать)",
            24,
            "21.2",
            anchor="21.2. Курс, класс, возрастная группа",
            maxLength=120,
        ),
        entry(
            "educationProfession",
            "Профессия (специальность), для получения которой проводится обучение",
            24,
            "21.3",
            anchor="21.3. Профессия (специальность)",
            multiline=True,
            maxLength=300,
        ),
        field_def(
            "employment",
            "Сведения о трудовой деятельности (при осуществлении трудовой деятельности)",
            "text",
            rule(
                25,
                status="by-line",
                note="Под заголовком пункта 22 бланк печатает "
                "свободную строку без номера. Пункт 25 Порядка говорит, что для "
                "неработающего гражданина «необходимо отметить «не работает»», но не "
                "называет эту строку.",
            ),
            anchor="22. Сведения о трудовой деятельности",
            maxLength=200,
        ),
        entry(
            "workProfession",
            "Основная профессия (специальность, должность)",
            25,
            "22.1",
            anchor="22.1. Основная профессия",
            maxLength=200,
        ),
        entry(
            "workQualification",
            "Квалификация (класс, разряд, категория, звание)",
            25,
            "22.2",
            anchor="22.2. Квалификация",
            maxLength=200,
        ),
        entry(
            "workExperience", "Стаж работы", 25, "22.3", anchor="22.3. Стаж работы", maxLength=60
        ),
        entry(
            "workCurrentJob",
            "Выполняемая работа на момент направления на медико-социальную "
            "экспертизу с указанием профессии (специальности, должности)",
            25,
            "22.4",
            anchor="22.4. Выполняемая работа",
            multiline=True,
            maxLength=300,
        ),
        entry(
            "workConditions",
            "Условия и характер выполняемого труда",
            25,
            "22.5",
            anchor="22.5. Условия и характер выполняемого труда",
            multiline=True,
            maxLength=300,
        ),
        entry(
            "workPlace",
            "Место работы (наименование организации)",
            25,
            "22.6",
            anchor="22.6. Место работы",
            prefill={"sources": ["patient.workplace"]},
            multiline=True,
            maxLength=300,
        ),
        entry(
            "workAddress",
            "Адрес места работы",
            25,
            "22.7",
            anchor="22.7. Адрес места работы",
            multiline=True,
            maxLength=300,
        ),
    ]
    # ---- section II
    f += [
        entry(
            "observedSinceYear",
            "Наблюдается в медицинской организации с … года",
            26,
            anchor="23. Наблюдается в медицинской организации",
            required=True,
            basis="source",
            pattern="^[0-9]{4}$",
            patternMessage="Год из четырёх цифр",
            maxLength=4,
        ),
        entry(
            "anamnesisDisease",
            "Анамнез заболевания",
            27,
            anchor="24. Анамнез заболевания",
            required=True,
            basis="source",
            multiline=True,
            maxLength=4000,
        ),
        entry(
            "anamnesisLife",
            "Анамнез жизни",
            28,
            anchor="25. Анамнез жизни",
            required=True,
            basis="source",
            multiline=True,
            maxLength=4000,
        ),
    ]
    for index in range(1, 5):
        columns = (
            ("Number", "№ п/п", "text", 12),
            ("Start", "Дата (число, месяц, год) начала временной нетрудоспособности", "date", 0),
            ("End", "Дата (число, месяц, год) окончания временной нетрудоспособности", "date", 0),
            ("Days", "Число дней (месяцев и дней) временной нетрудоспособности", "text", 40),
            ("Diagnosis", "Диагноз", "text", 80),
        )
        for suffix, label, kind, length in columns:
            extra: dict[str, Any] = (
                {"notAfter": "today"} if kind == "date" and suffix == "Start" else {}
            )
            if length:
                extra["maxLength"] = length
            f.append(
                field_def(
                    f"tempDisability{index}{suffix}",
                    f"26. Строка {index}: {label}",
                    kind,
                    rule(29, status="by-line", note=TABLE_NOTE),
                    anchor="Частота и длительность временной нетрудоспособности",
                    **extra,
                )
            )
    f += [
        box(
            "elnPresent",
            "Наличие листка нетрудоспособности в форме электронного документа (далее – ЭЛН)",
            29,
            "26.1",
            anchor="26.1. Наличие листка нетрудоспособности",
        ),
        entry("elnNumber", "№ ЭЛН", 29, "26.2", anchor="26.2."),
        field_def(
            "rehabProgramNumber",
            "индивидуальная программа реабилитации или абилитации инвалида (ребенка-инвалида) №",
            "text",
            rule(30, status="by-line", note=RESULTS_NOTE),
            anchor="абилитации инвалида (ребенка-инвалида)",
            maxLength=40,
        ),
        field_def(
            "msProtocolNumber",
            "протокол проведения медико-социальной экспертизы №",
            "text",
            rule(30, status="by-line", note=RESULTS_NOTE),
            anchor="к протоколу проведения медико-социальной экспертизы",
            maxLength=40,
        ),
        field_def(
            "msProtocolDate",
            "протокол проведения медико-социальной экспертизы от (день, месяц, год)",
            "date",
            rule(30, status="by-line", note=RESULTS_NOTE),
            anchor="к протоколу проведения медико-социальной экспертизы",
            notAfter="today",
        ),
    ]
    for field_id, number, label in REHAB_RESULTS:
        f.append(box(field_id, label, 30, number))
    f.append(
        field_def(
            "rehabMeasuresDone",
            "Мероприятия по медицинской реабилитации, протезированию и ортезированию, сроки их "
            "предоставления и эффективность (свободные строки под пунктом 27)",
            "text",
            rule(
                30,
                status="by-line",
                note=_FREE_LINES_NOTE + " Пункт 30 Порядка "
                "перечисляет, что указывается в пункте 27: мероприятия, сроки, эффективность.",
            ),
            printed=False,
            multiline=True,
            maxLength=1000,
        )
    )
    # ---- 28 anthropometry
    for field_id, number, label, length in ANTHROPOMETRY:
        f.append(entry(field_id, label, 31, number, maxLength=length))
    # ---- 29–31
    f += [
        entry(
            "healthStatus",
            "Состояние здоровья гражданина при направлении на медико-социальную экспертизу",
            32,
            anchor="29. Состояние здоровья гражданина",
            required=True,
            basis="source",
            multiline=True,
            maxLength=4000,
        ),
        entry(
            "complaints",
            "Жалобы гражданина на состояние своего здоровья",
            32,
            "29.1",
            anchor="29.1. Жалобы гражданина",
            required=True,
            basis="source",
            multiline=True,
            maxLength=2000,
        ),
    ]
    for index in range(1, 3):
        for suffix, label, kind, length in (
            ("Number", "№ п/п", "text", 12),
            ("Date", "Дата обследования", "date", 0),
            ("Code", "Код (при наличии)", "text", 40),
            ("Name", "Наименование обследования", "text", 200),
            ("Result", "Результат обследования", "text", 300),
        ):
            extra = {"maxLength": length} if length else {"notAfter": "today"}
            f.append(
                field_def(
                    f"exam{index}{suffix}",
                    f"30. Строка {index}: {label}",
                    kind,
                    rule(33, status="by-line", note=TABLE_NOTE),
                    anchor="Сведения о медицинских обследованиях",
                    **extra,
                )
            )
    f += [
        entry(
            "diagnosisMain",
            "Основное заболевание",
            34,
            "31.1",
            anchor="31.1. Основное заболевание",
            required=True,
            basis="source",
            prefill={"sources": ["episode.diagnosis.text"]},
            multiline=True,
            maxLength=1000,
        ),
        icd(
            "diagnosisMainIcd",
            "Код основного заболевания по Международной статистической "
            "классификации болезней и проблем, связанных со здоровьем (далее – МКБ)",
            34,
            "31.2",
            anchor="31.2. Код основного заболевания",
            required=True,
            basis="source",
            prefill={"sources": ["episode.diagnosis.icd10"]},
        ),
        entry(
            "diagnosisComplications",
            "Осложнения, вызванные основным заболеванием",
            34,
            "31.3",
            anchor="31.3. Осложнения, вызванные основным заболеванием",
            multiline=True,
            maxLength=1000,
        ),
        entry(
            "comorbidities",
            "Сопутствующие заболевания",
            34,
            "31.4",
            anchor="31.4. Сопутствующие заболевания",
            multiline=True,
            maxLength=1000,
        ),
        entry(
            "comorbiditiesIcd",
            "Коды сопутствующих заболеваний по МКБ",
            34,
            "31.5",
            anchor="31.5. Коды сопутствующих заболеваний по МКБ",
            maxLength=200,
        ),
        entry(
            "comorbidityComplications",
            "Осложнения, вызванные сопутствующими заболеваниями",
            34,
            "31.6",
            anchor="31.6. Осложнения, вызванные сопутствующими заболеваниями",
            multiline=True,
            maxLength=1000,
        ),
    ]
    f += [
        prognosis("clinicalPrognosis", "Клинический прогноз", 35, PROGNOSIS),
        prognosis("rehabPotential", "Реабилитационный потенциал", 36, POTENTIAL),
        prognosis("rehabPrognosis", "Реабилитационный прогноз", 37, PROGNOSIS),
        entry(
            "rehabRecommendations",
            "Рекомендуемые мероприятия по медицинской реабилитации",
            38,
            anchor="35. Рекомендуемые мероприятия по медицинской реабилитации",
            multiline=True,
            maxLength=2000,
        ),
        entry(
            "medicationsList",
            "Перечень лекарственных препаратов для медицинского применения и "
            "медицинских изделий (заполняется в отношении граждан, пострадавших в результате "
            "несчастных случаев на производстве и профессиональных заболеваний)",
            38,
            "35.1",
            anchor="35.1. Перечень лекарственных препаратов",
            multiline=True,
            maxLength=2000,
        ),
        entry(
            "reconstructiveSurgery",
            "Рекомендуемые мероприятия по реконструктивной хирургии",
            39,
            anchor="36. Рекомендуемые мероприятия по реконструктивной хирургии",
            multiline=True,
            maxLength=2000,
        ),
        entry(
            "prostheticsOrthotics",
            "Рекомендуемые мероприятия по протезированию и "
            "ортезированию, техническим средствам реабилитации",
            40,
            anchor="37. Рекомендуемые мероприятия по протезированию",
            multiline=True,
            maxLength=2000,
        ),
        entry(
            "sanatoriumTreatment",
            "Санаторно-курортное лечение (заполняется в отношении "
            "граждан, пострадавших в результате несчастных случаев на производстве и "
            "профессиональных заболеваний)",
            41,
            anchor="38. Санаторно-курортное лечение",
            multiline=True,
            maxLength=2000,
        ),
        entry(
            "specialMedicalCare",
            "Посторонний специальный медицинский уход (заполняется в "
            "отношении граждан, пострадавших в результате несчастных случаев на производстве и "
            "профессиональных заболеваний)",
            42,
            anchor="39. Посторонний специальный медицинский уход",
            multiline=True,
            maxLength=2000,
        ),
        date_entry(
            "fillDate",
            "Дата заполнения «Направления на медико-социальную экспертизу "
            "медицинской организацией» (день, месяц, год)",
            43,
            required=True,
            basis="source",
            anchor="40. Дата заполнения",
            prefill={"sources": ["today"]},
        ),
        entry(
            "commissionChairName",
            "Председатель врачебной комиссии (расшифровка подписи)",
            44,
            required=True,
            basis="source",
            anchor="Председатель врачебной",
            maxLength=200,
        ),
        field_def(
            "commissionChairSignature",
            "подпись председателя врачебной комиссии",
            "signature",
            rule(46),
            anchor="(подпись)",
        ),
    ]
    for index in range(1, 5):
        f.append(
            entry(
                f"commissionMember{index}Name",
                f"Член врачебной комиссии {index} (расшифровка подписи)",
                45,
                anchor="Члены врачебной комиссии",
                maxLength=200,
            )
        )
        f.append(
            field_def(
                f"commissionMember{index}Signature",
                f"подпись члена врачебной комиссии {index}",
                "signature",
                rule(46),
                anchor="(подпись)",
            )
        )
    f.append(field_def("stamp", "М.П. (при наличии)", "stamp", rule(46)))
    return f


TABLE_NOTE: Final = (
    "Пункт Порядка называет графы таблицы целиком («в соответствующих графах таблицы»); "
    "значение отдельной графы он не определяет."
)
RESULTS_NOTE: Final = (
    "Пункт 30 Порядка называет номер и дату разработки индивидуальной программы реабилитации; на "
    "бланке после неё стоит ещё «к протоколу проведения медико-социальной экспертизы № … от …», "
    "и какая из дат (программы или протокола) здесь указывается, порядок не говорит."
)

PURPOSES: Final[list[tuple[str, str]]] = [
    ("purposeDisabilityGroup", "Установление группы инвалидности"),
    ("purposeChildDisabled", "Установление категории «ребенок-инвалид»"),
    ("purposeDisabilityCauses", "Установление причин инвалидности"),
    ("purposeDisabilityOnset", "Установление времени наступления инвалидности"),
    ("purposeDisabilityTerm", "Установление срока инвалидности"),
    (
        "purposeProfessionalLoss",
        "Определение степени утраты профессиональной трудоспособности в процентах",
    ),
    (
        "purposeLawEnforcementLoss",
        "Определение стойкой утраты трудоспособности сотрудника "
        "органов внутренних дел Российской Федерации, сотрудника органов принудительного "
        "исполнения Российской Федерации, лица, проходящего службу в войсках национальной гвардии "
        "Российской Федерации и имеющего специальное звание полиции",
    ),
    (
        "purposeCareNeedConscript",
        "Определение нуждаемости по состоянию здоровья в постоянном "
        "постороннем уходе (помощи, надзоре) отца, матери, жены, родного брата, родной сестры, "
        "дедушки, бабушки или усыновителя гражданина, призываемого на военную службу "
        "(военнослужащего, проходящего военную службу по контракту) и на военную службу по "
        "мобилизации",
    ),
    (
        "purposeCareNeedCivilServant",
        "Определение нуждаемости по состоянию здоровья в постоянном "
        "постороннем уходе (помощи, надзоре) отца, матери, родного брата, родной сестры, дедушки, "
        "бабушки или усыновителя государственного гражданского служащего, подлежащего назначению "
        "на иную должность гражданской службы в порядке ротации",
    ),
    (
        "purposeRehabProgramDisabled",
        "Разработка индивидуальной программы реабилитации или "
        "абилитации инвалида (ребенка-инвалида)",
    ),
    (
        "purposeRehabProgramOccupational",
        "Разработка программы реабилитации лица, пострадавшего "
        "в результате несчастного случая на производстве и профессионального заболевания",
    ),
]

# suffix, point, caption, address caption, OGRN caption, anchor of the box
LOCATIONS: Final[list[tuple[str, str, str, str, str, str]]] = [
    (
        "Hospital",
        "13.1",
        "В медицинской организации, оказывающей медицинскую помощь в стационарных условиях",
        "Адрес медицинской организации",
        "ОГРН медицинской организации",
        "13.1.",
    ),
    (
        "CareHome",
        "13.2",
        "В организации социального обслуживания, оказывающей социальные услуги "
        "в стационарной форме социального обслуживания",
        "Адрес организации социального обслуживания",
        "ОГРН организации социального обслуживания",
        "13.2.",
    ),
    (
        "Prison",
        "13.3",
        "В исправительном учреждении",
        "Адрес исправительного учреждения",
        "ОГРН исправительного учреждения",
        "13.3.",
    ),
    ("OtherOrg", "13.4", "Иная организация", "Адрес организации", "ОГРН организации", "13.4."),
]

PREV_GROUPS: Final[list[tuple[str, str]]] = [
    ("prevGroup1", "Первая группа"),
    ("prevGroup2", "Вторая группа"),
    ("prevGroup3", "Третья группа"),
    ("prevChildDisabled", "Категория «ребенок-инвалид»"),
]
PREV_PERIODS: Final[list[tuple[str, str]]] = [
    ("prevPeriodOneYear", "Один год"),
    ("prevPeriodTwoYears", "Два года"),
    ("prevPeriodThreeYears", "Три года"),
    ("prevPeriodFourPlus", "Четыре и более лет"),
]
PREV_CAUSES: Final[list[tuple[str, str]]] = [
    ("prevCauseGeneralDisease", "Общее заболевание"),
    ("prevCauseWorkInjury", "Трудовое увечье"),
    ("prevCauseOccupationalDisease", "Профессиональное заболевание"),
    ("prevCauseFromChildhood", "Инвалидность с детства"),
    (
        "prevCauseChildhoodWarWound",
        "Инвалидность с детства вследствие ранения (контузии, "
        "увечья), связанная с боевыми действиями в период Великой Отечественной войны 1941 - 1945 "
        "годов",
    ),
    ("prevCauseMilitaryInjury", "Военная травма"),
    ("prevCauseDiseaseInMilitaryService", "Заболевание получено в период военной службы"),
    (
        "prevCauseRadiationChernobylService",
        "Заболевание радиационно обусловленное получено при "
        "исполнении обязанностей военной службы (служебных обязанностей) в связи с катастрофой на "
        "Чернобыльской АЭС",
    ),
    ("prevCauseChernobyl", "Заболевание связано с катастрофой на Чернобыльской АЭС"),
    (
        "prevCauseChernobylOtherDuties",
        "Заболевание, полученное при исполнении иных обязанностей "
        "военной службы (служебных обязанностей), связано с катастрофой на Чернобыльской АЭС",
    ),
    ("prevCauseMayak", "Заболевание связано с аварией на производственном объединении «Маяк»"),
    (
        "prevCauseMayakOtherDuties",
        "Заболевание, полученное при исполнении иных обязанностей "
        "военной службы (служебных обязанностей), связано с аварией на производственном "
        "объединении «Маяк»",
    ),
    ("prevCauseRadiationEffects", "Заболевание связано с последствиями радиационных воздействий"),
    (
        "prevCauseRadiationSpecialRisk",
        "Заболевание радиационно обусловленное получено при "
        "исполнении обязанностей военной службы (служебных обязанностей) в связи с "
        "непосредственным участием в действиях подразделений особого риска",
    ),
    (
        "prevCauseWarServiceSupport",
        "Заболевание (ранение, контузия, увечье), полученное лицом, "
        "обслуживавшим действующие воинские части Вооруженных Сил СССР и Вооруженных Сил "
        "Российской Федерации, находившиеся на территориях других государств в период ведения в "
        "этих государствах боевых действий",
    ),
    (
        "prevCauseDagestan",
        "Инвалидность вследствие ранения (контузии, увечья), полученного в "
        "связи с участием в боевых действиях в составе отрядов самообороны Республики Дагестан в "
        "период с августа по сентябрь 1999 г. в ходе контртеррористических операций на территории "
        "Республики Дагестан",
    ),
    (
        "prevCauseOther",
        "Иные причины, установленные законодательством Российской Федерации (указать)",
    ),
]

# id, point, caption
REHAB_RESULTS: Final[list[tuple[str, str, str]]] = [
    ("rehabRestore", "27.1", "Восстановление нарушенных функций"),
    ("rehabRestoreFull", "27.1.1", "Полное"),
    ("rehabRestorePartial", "27.1.2", "Частичное"),
    ("rehabRestoreNone", "27.1.3", "Положительные результаты отсутствуют"),
    ("rehabCompensate", "27.2", "Достижение компенсации утраченных либо отсутствующих функций"),
    ("rehabCompensateFull", "27.2.1", "Полное"),
    ("rehabCompensatePartial", "27.2.2", "Частичное"),
    ("rehabCompensateNone", "27.2.3", "Положительные результаты отсутствуют"),
]

# id, point, caption, maximum length
ANTHROPOMETRY: Final[list[tuple[str, str, str, int]]] = [
    ("bodyHeight", "28.1", "Рост", 20),
    ("bodyWeight", "28.2", "Вес", 20),
    ("bodyMassIndex", "28.3", "Индекс массы тела", 20),
    ("bodyBuild", "28.4", "Телосложение", 100),
    (
        "dailyOutput",
        "28.5",
        "Суточный объем физиологических отправлений (мл) (при наличии "
        "медицинских показаний в обеспечении абсорбирующим бельем)",
        40,
    ),
    (
        "waistVolume",
        "28.6",
        "Объем талии (при наличии медицинских показаний в обеспечении абсорбирующим бельем)",
        20,
    ),
    (
        "hipVolume",
        "28.6",
        "Объем бедер (при наличии медицинских показаний в обеспечении абсорбирующим бельем)",
        20,
    ),
    ("birthWeight", "28.7", "Масса тела при рождении (в отношении детей в возрасте до 3 лет)", 20),
    (
        "physicalDevelopment",
        "28.8",
        "Физическое развитие (в отношении детей в возрасте до 3 лет)",
        100,
    ),
]

PROGNOSIS: Final[list[str]] = [
    "благоприятный",
    "относительно благоприятный",
    "сомнительный (неопределенный)",
    "неблагоприятный",
]
POTENTIAL: Final[list[str]] = ["высокий", "удовлетворительный", "низкий", "отсутствует"]

FIELDS: Final[list[dict[str, Any]]] = _fields()

# The captions of the boxed tables are read by the OCR column by column, so the words of one
# caption are not contiguous in its text. Every caption of a checkbox and of the numbered table
# cells was read word by word on the scan image; `medical_forms.prepare_form` records the ones the
# OCR text does not contain contiguously in the schema (`captionsReviewedOnScan`).
SCAN_REVIEWED: Final[tuple[str, ...]] = tuple(
    dict.fromkeys(
        str(field["_anchor"])
        for field in FIELDS
        if field["type"] == "checkbox"
        or field["id"]
        in {
            "prevCauseOtherText",
            *(field_id for field_id, _n, _l, _m in ANTHROPOMETRY),
            "stayCareHomeAddress",
            "stayCareHomeOgrn",
            "stayPrisonAddress",
            "stayPrisonOgrn",
            "stayOtherOrgOgrn",
        }
    )
)


# --------------------------------------------------------------------------- screen sections


def _section(section_id: str, title: str, *field_ids: str, description: str | None = None):
    result: dict[str, Any] = {"id": section_id, "title": title, "fieldIds": list(field_ids)}
    if description:
        result["description"] = description
    return result


def _ids(prefix: str, pairs: list[tuple[str, str]]) -> list[str]:
    return [field_id for field_id, _label in pairs]


SECTIONS: Final[list[dict[str, Any]]] = [
    _section(
        "organization",
        "Медицинская организация",
        "organizationName",
        "organizationAddress",
        "organizationOgrn",
        description="Подставляется из настроек «Врач и организация».",
    ),
    _section(
        "decision",
        "Решение врачебной комиссии (п. 1–4)",
        "protocolNumber",
        "protocolDate",
        "needsHomeVisit",
        "needsPalliativeCare",
        "needsPrimaryProsthetics",
    ),
    _section(
        "purpose",
        "Цель направления (п. 5)",
        *[field_id for field_id, _ in PURPOSES],
        description="Отметьте цели: каждая формулировка взята из пункта 22 Правил признания лица "
        "инвалидом.",
    ),
    _section(
        "citizen",
        "Раздел I. Гражданин (п. 6–10)",
        "patientFullName",
        "patientBirthDate",
        "patientAge",
        "sexMale",
        "sexFemale",
        "citizenshipRussian",
        "citizenshipForeign",
        "citizenshipStateless",
        "militaryRegistered",
        "militaryObligedNotRegistered",
        "militaryEnrolling",
        "militaryNotRegistered",
    ),
    _section(
        "residence",
        "Адрес места жительства (п. 11–12)",
        "residenceCountry",
        "residencePostcode",
        "residenceSubject",
        "residenceDistrict",
        "residenceLocality",
        "residenceStreet",
        "residenceHouse",
        "residenceApartment",
        "noFixedResidence",
    ),
    _section(
        "location",
        "Где находится гражданин (п. 13)",
        "stayHospital",
        "stayHospitalAddress",
        "stayHospitalOgrn",
        "stayCareHome",
        "stayCareHomeAddress",
        "stayCareHomeOgrn",
        "stayPrison",
        "stayPrisonAddress",
        "stayPrisonOgrn",
        "stayOtherOrg",
        "stayOtherOrgAddress",
        "stayOtherOrgOgrn",
        "stayAtResidence",
    ),
    _section(
        "contacts",
        "Контакты, СНИЛС, документ, удостоверяющий личность (п. 14–16)",
        "contactPhones",
        "contactEmail",
        "snils",
        "omsPolicyNumber",
        "idDocName",
        "idDocSeries",
        "idDocNumber",
        "idDocIssuedBy",
        "idDocIssueDate",
    ),
    _section(
        "representative",
        "Законный или уполномоченный представитель (п. 17)",
        "repFullName",
        "repBirthDate",
        "repAuthDocName",
        "repAuthDocSeries",
        "repAuthDocNumber",
        "repAuthDocIssuedBy",
        "repAuthDocIssueDate",
        "repIdDocName",
        "repIdDocSeries",
        "repIdDocNumber",
        "repIdDocIssuedBy",
        "repIdDocIssueDate",
        "repPhones",
        "repEmail",
        "repSnils",
        "guardianOrgName",
        "guardianOrgAddress",
        "guardianOrgOgrn",
        description="Заполняется, если у гражданина есть законный или уполномоченный представитель "
        "(п. 20 Порядка).",
    ),
    _section(
        "referral",
        "Вид направления и согласие (п. 18–19)",
        "referralFirst",
        "referralRepeat",
        "consentDate",
        "consentInPerson",
        "consentRemote",
        "noticePhone",
        "noticePost",
        "noticePortal",
    ),
    _section(
        "previous",
        "Результаты предыдущей экспертизы (п. 20)",
        *_ids("", PREV_GROUPS),
        "prevDisabilityUntil",
        *_ids("", PREV_PERIODS),
        *_ids("", PREV_CAUSES),
        "prevCauseOtherText",
        "prevCauseLegacyText",
        "prevProfLossPercent",
        "prevProfLossTerm",
        "prevProfLossUntil",
        "prevProfLossRepeat",
        description="Заполняется при повторном направлении (п. 23 Порядка).",
    ),
    _section(
        "education-work",
        "Образование и трудовая деятельность (п. 21–22)",
        "educationOrg",
        "educationCourse",
        "educationProfession",
        "employment",
        "workProfession",
        "workQualification",
        "workExperience",
        "workCurrentJob",
        "workConditions",
        "workPlace",
        "workAddress",
    ),
    _section(
        "anamnesis",
        "Раздел II. Анамнез (п. 23–25)",
        "observedSinceYear",
        "anamnesisDisease",
        "anamnesisLife",
    ),
    _section(
        "disability-leave",
        "Временная нетрудоспособность и реабилитация (п. 26–27)",
        *[
            f"tempDisability{index}{suffix}"
            for index in range(1, 5)
            for suffix in ("Number", "Start", "End", "Days", "Diagnosis")
        ],
        "elnPresent",
        "elnNumber",
        "rehabProgramNumber",
        "msProtocolNumber",
        "msProtocolDate",
        *[field_id for field_id, _n, _l in REHAB_RESULTS],
        "rehabMeasuresDone",
    ),
    _section(
        "anthropometry",
        "Антропометрические данные (п. 28)",
        *[field_id for field_id, _n, _l, _m in ANTHROPOMETRY],
    ),
    _section(
        "health",
        "Состояние здоровья и обследования (п. 29–30)",
        "healthStatus",
        "complaints",
        *[
            f"exam{index}{suffix}"
            for index in range(1, 3)
            for suffix in ("Number", "Date", "Code", "Name", "Result")
        ],
    ),
    _section(
        "diagnosis",
        "Диагноз (п. 31)",
        "diagnosisMain",
        "diagnosisMainIcd",
        "diagnosisComplications",
        "comorbidities",
        "comorbiditiesIcd",
        "comorbidityComplications",
        description="Код по МКБ основного заболевания подставляется из диагноза эпизода.",
    ),
    _section(
        "recommendations",
        "Прогноз и рекомендуемые мероприятия (п. 32–39)",
        "clinicalPrognosis",
        "rehabPotential",
        "rehabPrognosis",
        "rehabRecommendations",
        "medicationsList",
        "reconstructiveSurgery",
        "prostheticsOrthotics",
        "sanatoriumTreatment",
        "specialMedicalCare",
    ),
    _section(
        "signatories",
        "Дата и врачебная комиссия (п. 40)",
        "fillDate",
        "commissionChairName",
        *[f"commissionMember{index}Name" for index in range(1, 5)],
        description="Подписи и печать ставятся на бумажной форме (п. 46 Порядка).",
    ),
]

# ------------------------------------------------------------------------------- print layout

# every printed line of the blank is one row; a justified line is `stretch`, the last line of a
# paragraph is left-aligned. Spaces above the rows are measured against the scan
# (`medical_form_overlay calibrate`) and merged from tools/ingest/medical-form-calibration.


def _s(value: str) -> dict[str, Any]:
    """A full justified line."""
    return row(text(value), align="stretch")


def _l(value: str) -> dict[str, Any]:
    """A line that ends its paragraph."""
    return row(text(value))


def _para(*lines: str) -> list[dict[str, Any]]:
    return [_s(value) for value in lines[:-1]] + [_l(lines[-1])]


# the lines inside the boxed tables are set a little looser than the running text of the sheet
CELL_LINE_HEIGHT: Final = 1.225
RULED_PITCH_MM: Final = 5.69  # the pitch of the ruled lines of the blank, measured on the scan


def _rule_rows(count: int) -> list[dict[str, Any]]:
    """Ruled continuation lines; the blank rules its lines a little closer than its text lines."""
    return [
        {**row({"kind": "rule", "length": 10, "grow": True}), "heightMm": RULED_PITCH_MM}
        for _ in range(count)
    ]


def _cap(label: str, field_id: str, length: float = 30, **kw: Any) -> dict[str, Any]:
    """`11.1. Государство: ______` — a caption and a growing blank on one line."""
    return row(text(label), blank(field_id, length, grow=True, **kw))


def _date(
    field_id: str, *, month: float = 10, year: float = 4, century: bool = False, tail: str = "г."
) -> list[dict[str, Any]]:
    """«__» ______ ____ г. (the blank prints «20__» in some places, a bare year in others)."""
    parts = [
        text("«"),
        blank(field_id, 2, part="day"),
        text("»"),
        blank(field_id, month, part="month"),
    ]
    if century:
        parts += [text("20"), blank(field_id, year, part="year2")]
    else:
        parts.append(blank(field_id, year, part="year"))
    parts.append(text(tail))
    return parts


def _cell(*segments: dict[str, Any], span: int | None = None, align: str | None = None):
    result: dict[str, Any] = {"segments": list(segments)}
    if span:
        result["colSpan"] = span
    if align:
        result["align"] = align
    return result


def _box_cell(number: str, field_id: str, caption: str, **kw: Any) -> dict[str, Any]:
    return _cell(text(number), check(field_id), text(caption), **kw)


FILL: Final = {"text": " "}


def _grid(
    rows: list[list[Any]],
    weights: list[float],
    *,
    header: list[list[dict[str, Any]]] | None = None,
    pad: tuple[float, float, float, float] = (0.9, 1.5, 1.5, 0.9),
    row_height: float | None = None,
) -> dict[str, Any]:
    grid: dict[str, Any] = {
        "kind": "table",
        "header": header or [],
        "rows": rows,
        "columnWeights": weights,
        "cellPaddingMm": {"x": pad[0], "y": pad[1], "top": pad[2], "right": pad[3]},
    }
    grid["cellLineHeight"] = CELL_LINE_HEIGHT
    if row_height is not None:
        grid["rowHeightMm"] = row_height
    return grid


def _table_row(grid: dict[str, Any]) -> dict[str, Any]:
    return row(grid)


def _block(block_id: str, rows: list[dict[str, Any]], *, new_sheet: bool = True) -> dict[str, Any]:
    block: dict[str, Any] = {
        "id": block_id,
        "columns": [{"widthPercent": 100, "rows": rows}],
    }
    if new_sheet:
        block["pageBreakBefore"] = True
    return block


def _heading(value: str) -> dict[str, Any]:
    return row(text(value, bold=True), align="center")


def _purpose_cell(index: int) -> dict[str, Any]:
    field_id, label = PURPOSES[index - 1]
    return _box_cell(f"5.{index}.", field_id, label)


def _sheet_1() -> list[dict[str, Any]]:
    return [
        row(text("Медицинская документация"), align="right"),
        row(text("Форма № 088/у"), align="right"),
        row(
            blank(
                "organizationName", 40, grow=True, caption="(наименование медицинской организации)"
            )
        ),
        row(blank("organizationAddress", 40, grow=True, caption="(адрес медицинской организации)")),
        row(
            blank("organizationOgrn", 30, caption="(ОГРН медицинской организации)"), align="center"
        ),
        row(text("НАПРАВЛЕНИЕ НА МЕДИКО-СОЦИАЛЬНУЮ ЭКСПЕРТИЗУ", bold=True), align="center"),
        row(text("МЕДИЦИНСКОЙ ОРГАНИЗАЦИЕЙ", bold=True), align="center"),
        _s("1. Номер и дата протокола врачебной комиссии медицинской организации,"),
        _s("содержащего решение о направлении гражданина на медико-социальную экспертизу:"),
        row(
            text("№"),
            blank("protocolNumber", 5),
            text("от"),
            *_date("protocolDate", month=11, year=3, century=True),
        ),
        _s("2. Гражданин по состоянию здоровья не может явиться в бюро (главное бюро,"),
        _s("Федеральное бюро) медико-социальной экспертизы: медико-социальную экспертизу"),
        row(text("необходимо проводить на дому"), {**check("needsHomeVisit"), "inline": True}),
        row(
            text("3. Гражданин нуждается в оказании паллиативной медицинской помощи"),
            check("needsPalliativeCare"),
            align="stretch",
        ),
        _l("(при нуждаемости в оказании паллиативной медицинской помощи)"),
        _s("4. Гражданин, находящийся на лечении в стационаре в связи с операцией"),
        _s("по ампутации (реампутации) конечности (конечностей), нуждающийся в первичном"),
        row(
            text("протезировании"),
            {**check("needsPrimaryProsthetics"), "inline": True},
            text("(при нуждаемости в первичном протезировании)"),
        ),
        _s("5. Цель направления гражданина на медико-социальную экспертизу (нужное"),
        _l("отметить):"),
        row(
            _grid(
                [
                    [_purpose_cell(1), _purpose_cell(2), _purpose_cell(3)],
                    [
                        _purpose_cell(4),
                        _purpose_cell(5),
                        _cell(
                            text("5.6."),
                            check(PURPOSES[5][0]),
                            text("Определение степени утраты профессиональной"),
                        ),
                    ],
                ],
                [1, 1, 1],
            )
        ),
    ]


def _sheet_2() -> list[dict[str, Any]]:
    return [
        row(
            _grid(
                [
                    [FILL, FILL, _cell(text("трудоспособности в процентах"))],
                    [_purpose_cell(7), _purpose_cell(8), _purpose_cell(9)],
                    [_purpose_cell(10), _purpose_cell(11), FILL],
                ],
                [1, 1, 1],
            )
        ),
        _heading("Раздел I. Данные о гражданине"),
        _l("6. Фамилия, имя, отчество (при наличии):"),
        row(blank("patientFullName", 40, grow=True)),
        row(
            text("7. Дата рождения (день, месяц, год):"),
            *_date("patientBirthDate"),
        ),
        _s("возраст (число полных лет, для ребенка в возрасте до 1 года – число полных"),
        row(text("месяцев):"), blank("patientAge", 30, grow=True)),
        _l("8. Пол (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell("8.1.", "sexMale", "Мужской"),
                        _box_cell("8.2.", "sexFemale", "Женский"),
                    ]
                ],
                [1, 1],
                pad=(0.9, 2.9, 4.4, 0.9),
            )
        ),
    ]


def _sheet_3() -> list[dict[str, Any]]:
    return [
        _l("9. Гражданство (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell(
                            "9.1.",
                            "citizenshipRussian",
                            "Гражданин Российской Федерации",
                            align="justify",
                        ),
                        _box_cell(
                            "9.2.",
                            "citizenshipForeign",
                            "Гражданин иностранного "
                            "государства, находящийся на территории Российской Федерации",
                            align="justify",
                        ),
                        _box_cell(
                            "9.3.",
                            "citizenshipStateless",
                            "Лицо без гражданства, находящееся на территории Российской Федерации",
                            align="justify",
                        ),
                    ]
                ],
                [1, 1, 1],
                pad=(0.9, 3.0, 2.2, 0.9),
            )
        ),
        _l("10. Отношение к воинской обязанности (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell(
                            "10.1.",
                            "militaryRegistered",
                            "Гражданин, состоящий на воинском учете",
                            align="justify",
                        ),
                        _box_cell(
                            "10.2.",
                            "militaryObligedNotRegistered",
                            "Гражданин, не состоящий на воинском учете, но обязанный "
                            "состоять на воинском учете",
                            align="justify",
                        ),
                    ],
                    [
                        _box_cell(
                            "10.3.",
                            "militaryEnrolling",
                            "Гражданин, поступающий на воинский учет",
                            align="justify",
                        ),
                        _box_cell(
                            "10.4.",
                            "militaryNotRegistered",
                            "Гражданин, не состоящий на воинском учете",
                            align="justify",
                        ),
                    ],
                ],
                [1, 1],
                pad=(0.9, 3.5, 2.2, 0.9),
            )
        ),
        _s("11. Адрес места жительства (при отсутствии места жительства указывается адрес"),
        _s("места пребывания, фактического проживания на территории Российской Федерации,"),
        _s("место нахождения пенсионного дела инвалида, выехавшего на постоянное"),
        _l("жительство за пределы территории Российской Федерации):"),
        _cap("11.1. Государство:", "residenceCountry"),
        _cap("11.2. Почтовый индекс:", "residencePostcode"),
        _cap("11.3. Субъект Российской Федерации:", "residenceSubject"),
        _cap("11.4. Район:", "residenceDistrict"),
        _cap("11.5. Наименование населенного пункта:", "residenceLocality"),
        _cap("11.6. Улица:", "residenceStreet"),
        row(text("11.7. Дом (корпус, строение):"), blank("residenceHouse", 14)),
        row(text("11.8. Квартира:"), blank("residenceApartment", 11)),
        row(
            text("12. Лицо без определенного места жительства"),
            {**check("noFixedResidence"), "inline": True},
            text("(в случае если гражданин не имеет"),
        ),
        _l("определенного места жительства)"),
        _l("13. Гражданин находится (нужное отметить и указать):"),
        row(
            _grid(
                [
                    [
                        _box_cell(
                            "13.1.",
                            "stayHospital",
                            "В медицинской организации, "
                            "оказывающей медицинскую помощь в стационарных условиях",
                            align="justify",
                        ),
                        _cell(
                            text("13.1.1."),
                            text("Адрес медицинской организации:"),
                            blank("stayHospitalAddress", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            {"kind": "rule", "length": 10, "grow": True},
                            align="justify",
                        ),
                        _cell(
                            text("13.1.2."),
                            text("ОГРН медицинской организации:"),
                            blank("stayHospitalOgrn", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            align="justify",
                        ),
                    ],
                    [
                        _box_cell(
                            "13.2.",
                            "stayCareHome",
                            "В организации социального обслуживания, оказывающей социальные",
                            align="justify",
                        ),
                        _cell(
                            text("13.2.1."),
                            text("Адрес организации социального обслуживания:"),
                            blank("stayCareHomeAddress", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            {"kind": "rule", "length": 10, "grow": True},
                            align="justify",
                        ),
                        _cell(
                            text("13.2.2."),
                            text("ОГРН организации социального обслуживания:"),
                            align="justify",
                        ),
                    ],
                ],
                [265, 325, 188],
            )
        ),
    ]


def _sheet_4() -> list[dict[str, Any]]:
    return [
        row(
            _grid(
                [
                    [
                        _cell(
                            text("услуги в стационарной форме социального обслуживания"),
                            align="justify",
                        ),
                        FILL,
                        _cell(blank("stayCareHomeOgrn", 20, grow=True)),
                    ],
                    [
                        _box_cell(
                            "13.3.", "stayPrison", "В исправительном учреждении", align="justify"
                        ),
                        _cell(
                            text("13.3.1."),
                            text("Адрес исправительного учреждения:"),
                            blank("stayPrisonAddress", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            {"kind": "rule", "length": 10, "grow": True},
                            align="justify",
                        ),
                        _cell(
                            text("13.3.2."),
                            text("ОГРН исправительного учреждения:"),
                            blank("stayPrisonOgrn", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            align="justify",
                        ),
                    ],
                    [
                        _box_cell("13.4.", "stayOtherOrg", "Иная организация", align="justify"),
                        _cell(
                            text("13.4.1. Адрес организации:"),
                            blank("stayOtherOrgAddress", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            {"kind": "rule", "length": 10, "grow": True},
                        ),
                        _cell(
                            text("13.4.2."),
                            text("ОГРН организации:"),
                            blank("stayOtherOrgOgrn", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            align="justify",
                        ),
                    ],
                    [
                        _cell(
                            text("13.5."),
                            check("stayAtResidence"),
                            text(
                                "По месту жительства (по месту пребывания, фактического "
                                "проживания на территории Российской Федерации)"
                            ),
                            span=3,
                        )
                    ],
                ],
                [265, 325, 188],
            )
        ),
        _l("14. Контактная информация:"),
        _cap("14.1. Номера телефонов:", "contactPhones"),
        _cap("14.2. Адрес электронной почты (при наличии):", "contactEmail", 25),
        _s("15. Сведения о страховом номере индивидуального лицевого счета (СНИЛС) и полисе"),
        _l("обязательного медицинского страхования:"),
        row(text("СНИЛС:"), blank("snils", 18)),
        _s("Номер полиса обязательного медицинского страхования (при наличии):"),
        row(blank("omsPolicyNumber", 24)),
        _l("16. Документ, удостоверяющий личность:"),
        _cap("16.1. Наименование:", "idDocName"),
        row(
            text("16.2. Серия"), blank("idDocSeries", 11), text(", номер"), blank("idDocNumber", 14)
        ),
        _cap("16.3. Кем выдан:", "idDocIssuedBy"),
        row(text("16.4. Дата выдачи (день, месяц, год):"), *_date("idDocIssueDate", month=11)),
        _s("17. Сведения о законном или уполномоченном представителе гражданина,"),
        _l("направляемого на медико-социальную экспертизу:"),
        _cap("17.1. Фамилия, имя, отчество (при наличии):", "repFullName"),
        row(text("17.1.1. Дата рождения (день, месяц, год):"), *_date("repBirthDate", month=8)),
        _s("17.2. Документ, удостоверяющий полномочия законного или уполномоченного"),
        row(text("представителя:")),
        _cap("17.2.1. Наименование:", "repAuthDocName"),
        row(
            text("17.2.2. Серия"),
            blank("repAuthDocSeries", 11),
            text(", номер"),
            blank("repAuthDocNumber", 14),
        ),
        _cap("17.2.3. Кем выдан:", "repAuthDocIssuedBy"),
        row(
            text("17.2.4. Дата выдачи (день, месяц, год):"), *_date("repAuthDocIssueDate", month=11)
        ),
        _l("17.3. Документ, удостоверяющий личность:"),
    ]


def _sheet_5() -> list[dict[str, Any]]:
    return [
        _cap("17.3.1. Наименование:", "repIdDocName"),
        row(
            text("17.3.2. Серия"),
            blank("repIdDocSeries", 11),
            text(", номер"),
            blank("repIdDocNumber", 14),
        ),
        _cap("17.3.3. Кем выдан:", "repIdDocIssuedBy"),
        row(text("17.3.4. Дата выдачи (день, месяц, год):"), *_date("repIdDocIssueDate", month=12)),
        _l("17.4. Контактная информация:"),
        _cap("17.4.1. Номера телефонов:", "repPhones"),
        _cap("17.4.2. Адрес электронной почты (при наличии):", "repEmail", 25),
        row(
            text("17.5. Страховой номер индивидуального лицевого счета (СНИЛС):"),
            blank("repSnils", 14),
        ),
        _s("17.6. Сведения об организации в случае возложения опеки (попечительства) на"),
        _l("юридическое лицо:"),
        _cap("17.6.1. Наименование:", "guardianOrgName"),
        _cap("17.6.2. Адрес:", "guardianOrgAddress"),
        row(
            text("17.6.3. Основной государственный регистрационный номер (ОГРН):"),
            blank("guardianOrgOgrn", 14),
        ),
        _l("18. Гражданин направляется на медико-социальную экспертизу (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell("18.1.", "referralFirst", "Первично"),
                        _box_cell("18.2.", "referralRepeat", "Повторно"),
                    ]
                ],
                [1, 1],
                pad=(0.9, 2.0, 3.5, 0.9),
            )
        ),
        _s("19. Сведения из согласия на направление и проведение медико-социальной"),
        _l("экспертизы:"),
        _s("19.1. Гражданин (его законный или уполномоченный представитель) дал согласие на"),
        _s("направление и проведение медико-социальной экспертизы"),
        row(*_date("consentDate", month=7, year=3, century=True)),
        _s("19.2. Предпочтительная форма проведения медико-социальной экспертизы (нужное"),
        _l("отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell("19.2.1.", "consentInPerson", "с личным присутствием (очно)"),
                        _box_cell("19.2.2.", "consentRemote", "без личного присутствия (заочно)"),
                    ]
                ],
                [1, 1],
                pad=(0.9, 2.0, 3.5, 0.9),
            )
        ),
        _s("19.3. Предпочтительный способ получения уведомления о проведении медико-"),
        _l("социальной экспертизы (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell(
                            "19.3.1.",
                            "noticePhone",
                            "по каналам телефонной связи, включая "
                            "мобильную связь, в том числе посредством направления коротких "
                            "текстовых сообщений",
                        ),
                        _box_cell(
                            "19.3.2.",
                            "noticePost",
                            "в форме документа на бумажном носителе заказным почтовым отправлением",
                        ),
                        _box_cell(
                            "19.3.3.",
                            "noticePortal",
                            "в форме электронного документа с "
                            "использованием федеральной государственной информационной "
                            "системы «Единый портал государственных и муниципальных услуг "
                            "(функций)»",
                        ),
                    ]
                ],
                [1, 1, 1],
                pad=(0.9, 2.0, 3.5, 0.9),
            )
        ),
        _s("20. Сведения о результатах предыдущей медико-социальной экспертизы (в случае"),
        _l("направления на медико-социальную экспертизу повторно):"),
    ]


def _cause(index: int) -> dict[str, Any]:
    field_id, label = PREV_CAUSES[index - 1]
    # the blank keeps «(контузии, увечья)» together on one printed line
    return _box_cell(
        f"20.4.{index}.", field_id, label.replace("(контузии, увечья)", "(контузии,\u00a0увечья)")
    )


def _sheet_6() -> list[dict[str, Any]]:
    return [
        _s("20.1. Наличие инвалидности на момент направления на медико-социальную"),
        _l("экспертизу (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell("20.1.1.", "prevGroup1", "Первая группа"),
                        _box_cell("20.1.2.", "prevGroup2", "Вторая группа"),
                        _box_cell("20.1.3.", "prevGroup3", "Третья группа"),
                        _box_cell("20.1.4.", "prevChildDisabled", "Категория «ребенок-инвалид»"),
                    ]
                ],
                [194, 193, 193, 200],
            )
        ),
        _s("20.2. Дата, до которой установлена инвалидность (день, месяц, год)"),
        row(*_date("prevDisabilityUntil", month=11, year=3, century=True)),
        _s("20.3. Период, в течение которого гражданин находился на инвалидности на момент"),
        _l("направления на медико-социальную экспертизу (нужное отметить):"),
        row(
            _grid(
                [
                    [
                        _box_cell("20.3.1.", PREV_PERIODS[0][0], "Один год"),
                        _box_cell("20.3.2.", PREV_PERIODS[1][0], "Два года"),
                        _box_cell("20.3.3.", PREV_PERIODS[2][0], "Три года"),
                        _box_cell("20.3.4.", PREV_PERIODS[3][0], "Четыре и более лет"),
                    ]
                ],
                [192, 190, 172, 226],
            )
        ),
        _s("20.4. Причина инвалидности, имеющаяся на момент направления на медико-"),
        _l("социальную экспертизу (нужное отметить):"),
        row(
            _grid(
                [
                    [_cause(1), _cause(2), _cause(3), _cause(4)],
                    [_cause(5), _cause(6), _cause(7), _cause(8)],
                    [_cause(9), _cause(10), _cause(11), _cause(12)],
                ],
                [184, 183, 182, 231],
                pad=(0.9, 3.5, 1.5, 0.9),
            )
        ),
    ]


def _sheet_7() -> list[dict[str, Any]]:
    return [
        row(
            _grid(
                [
                    [_cause(13), _cause(14), _cause(15), _cause(16)],
                    [
                        _cell(
                            text("20.4.17."),
                            check(PREV_CAUSES[16][0]),
                            text(
                                "Иные причины, установленные законодательством Российской "
                                "Федерации (указать):"
                            ),
                            blank("prevCauseOtherText", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                        ),
                        _cell(
                            text(
                                "20.4.18. Причины инвалидности, установленные в "
                                "соответствии с законодательством, действовавшим на момент "
                                "установления инвалидности (указать):"
                            ),
                            blank("prevCauseLegacyText", 20, grow=True),
                            {"kind": "rule", "length": 10, "grow": True},
                            {"kind": "rule", "length": 10, "grow": True},
                            span=3,
                        ),
                    ],
                ],
                [184, 183, 182, 231],
                pad=(0.9, 3.5, 1.5, 0.9),
            )
        ),
        _s("20.5. Степень утраты профессиональной трудоспособности в процентах на момент"),
        row(
            text("направления гражданина на медико-социальную экспертизу:"),
            blank("prevProfLossPercent", 14, grow=True),
        ),
        _s("20.6. Срок, на который установлена степень утраты профессиональной"),
        row(text("трудоспособности в процентах:"), blank("prevProfLossTerm", 30, grow=True)),
        _s("20.7. Дата, до которой установлена степень утраты профессиональной"),
        row(text("трудоспособности в процентах (день, месяц, год):"), *_date("prevProfLossUntil")),
        _s("20.8. Степени утраты профессиональной трудоспособности (в процентах),"),
        _s("установленные по повторным несчастным случаям на производстве и"),
        _s("профессиональным заболеваниям, и даты, до которых они установлены:"),
    ]


def _sheet_8() -> list[dict[str, Any]]:
    return [
        row(blank("prevProfLossRepeat", 40, grow=True)),
        *_rule_rows(2),
        _l("21. Сведения о получении образования (при получении образования):"),
        _s("21.1. Наименование и адрес образовательной организации, в которой гражданин"),
        row(text("получает образование:"), blank("educationOrg", 30, grow=True)),
        *_rule_rows(2),
        _s("21.2. Курс, класс, возрастная группа детского дошкольного учреждения (нужное"),
        row(text("подчеркнуть и указать:"), blank("educationCourse", 30, grow=True)),
        _l("21.3. Профессия (специальность), для получения которой проводится обучение:"),
        row(blank("educationProfession", 40, grow=True)),
        *_rule_rows(1),
        _l("22. Сведения о трудовой деятельности (при осуществлении трудовой деятельности):"),
        row(blank("employment", 40, grow=True)),
        _l("22.1. Основная профессия (специальность, должность):"),
        row(blank("workProfession", 40, grow=True)),
        _l("22.2. Квалификация (класс, разряд, категория, звание):"),
        row(blank("workQualification", 40, grow=True)),
        _cap("22.3. Стаж работы:", "workExperience"),
        _s("22.4. Выполняемая работа на момент направления на медико-социальную экспертизу"),
        _l("с указанием профессии (специальности, должности):"),
        row(blank("workCurrentJob", 40, grow=True)),
        *_rule_rows(2),
        _cap("22.5. Условия и характер выполняемого труда:", "workConditions"),
        *_rule_rows(2),
        _cap("22.6. Место работы (наименование организации):", "workPlace"),
        *_rule_rows(2),
        _cap("22.7. Адрес места работы:", "workAddress"),
        *_rule_rows(1),
        _heading("Раздел II. Клинико-функциональные данные гражданина"),
        row(
            text("23. Наблюдается в медицинской организации с"),
            blank("observedSinceYear", 5),
            text("года"),
        ),
        _cap("24. Анамнез заболевания:", "anamnesisDisease"),
        *_rule_rows(2),
    ]


def _sheet_9() -> list[dict[str, Any]]:
    return [
        *_rule_rows(10),
        _l("25. Анамнез жизни:"),
        row(blank("anamnesisLife", 40, grow=True)),
        *_rule_rows(10),
        _s("26. Частота и длительность временной нетрудоспособности (сведения за последние"),
        _l("12 месяцев):"),
        row(
            _grid(
                [
                    [
                        f"tempDisability{index}{suffix}"
                        for suffix in ("Number", "Start", "End", "Days", "Diagnosis")
                    ]
                    for index in range(1, 5)
                ],
                [47, 210, 228, 213, 82],
                row_height=9.7,
                header=[
                    [
                        {"text": "№ п/п"},
                        {"text": "Дата (число, месяц, год) начала временной нетрудоспособности"},
                        {"text": "Дата (число, месяц, год) окончания временной нетрудоспособности"},
                        {"text": "Число дней (месяцев и дней) временной нетрудоспособности"},
                        {"text": "Диагноз"},
                    ]
                ],
            )
        ),
        _s("26.1. Наличие листка нетрудоспособности в форме электронного документа (далее –"),
        row(text("ЭЛН)"), {**check("elnPresent"), "inline": True}),
        row(text("26.2. № ЭЛН:"), blank("elnNumber", 16)),
        _s("27. Результаты и эффективность проведенных мероприятий медицинской"),
        _s("реабилитации, рекомендованных индивидуальной программой реабилитации или"),
        row(
            text("абилитации инвалида (ребенка-инвалида) №"),
            blank("rehabProgramNumber", 5),
            text("к протоколу проведения медико-"),
            align="stretch",
        ),
        row(
            text("социальной экспертизы №"),
            blank("msProtocolNumber", 4),
            text("от"),
            *_date("msProtocolDate", month=7, year=3, century=True, tail="г. (нужное отметить):"),
        ),
    ]


def _sheet_10() -> list[dict[str, Any]]:
    def result_row(first: int) -> list[Any]:
        ids = REHAB_RESULTS[first : first + 4]
        numbers = (
            ["27.1.", "27.1.1.", "27.1.2.", "27.1.3."]
            if first == 0
            else ["27.2.", "27.2.1.", "27.2.2.", "27.2.3."]
        )
        return [
            _box_cell(number, field_id, label)
            for number, (field_id, _n, label) in zip(numbers, ids, strict=True)
        ]

    return [
        row(_grid([result_row(0), result_row(4)], [195, 195, 194, 196])),
        row(blank("rehabMeasuresDone", 40, grow=True)),
        *_rule_rows(3),
        _l("28. Антропометрические данные и физиологические параметры:"),
        row(
            _grid(
                [
                    [
                        _cell(text("28.1. Рост:"), blank("bodyHeight", 10)),
                        _cell(text("28.2. Вес:"), blank("bodyWeight", 10)),
                        _cell(
                            text("28.3. Индекс массы тела:"), blank("bodyMassIndex", 20, grow=True)
                        ),
                    ],
                    [
                        _cell(text("28.4. Телосложение:"), blank("bodyBuild", 20, grow=True)),
                        _cell(
                            text(
                                "28.5. Суточный объем физиологических отправлений (мл) (при "
                                "наличии медицинских показаний в обеспечении абсорбирующим "
                                "бельем):"
                            ),
                            blank("dailyOutput", 1),
                        ),
                        _cell(
                            text(
                                "28.6. Объем талии/бедер (при наличии медицинских показаний "
                                "в обеспечении абсорбирующим бельем):"
                            ),
                            blank("waistVolume", 6),
                            text("/"),
                            blank("hipVolume", 6),
                        ),
                    ],
                ],
                [257, 262, 261],
            )
        ),
        row(
            _grid(
                [
                    [
                        _cell(
                            text(
                                "28.7. Масса тела при рождении (в отношении детей в возрасте до "
                                "3 лет):"
                            ),
                            blank("birthWeight", 2),
                        ),
                        _cell(
                            text(
                                "28.8. Физическое развитие (в отношении детей в возрасте до 3 лет):"
                            ),
                            blank("physicalDevelopment", 10),
                        ),
                    ]
                ],
                [358, 349],
            )
        ),
        _s("29. Состояние здоровья гражданина при направлении на медико-социальную"),
        row(text("экспертизу:"), blank("healthStatus", 30, grow=True)),
        *_rule_rows(9),
        _l("29.1. Жалобы гражданина на состояние своего здоровья:"),
        row(blank("complaints", 40, grow=True)),
        *_rule_rows(1),
    ]


def _sheet_11() -> list[dict[str, Any]]:
    return [
        *_rule_rows(4),
        _s("30. Сведения о медицинских обследованиях, необходимых для получения клинико-"),
        _s("функциональных данных в зависимости от заболевания в целях проведения медико-"),
        _l("социальной экспертизы:"),
        row(
            _grid(
                [
                    [
                        f"exam{index}{suffix}"
                        for suffix in ("Number", "Date", "Code", "Name", "Result")
                    ]
                    for index in range(1, 3)
                ],
                [47, 145, 170, 210, 208],
                row_height=11.2,
                header=[
                    [
                        {"text": "№ п/п"},
                        {"text": "Дата обследования"},
                        {"text": "Код (при наличии)"},
                        {"text": "Наименование обследования"},
                        {"text": "Результат обследования"},
                    ]
                ],
            )
        ),
        _l("31. Диагноз при направлении на медико-социальную экспертизу:"),
        _cap("31.1. Основное заболевание:", "diagnosisMain"),
        *_rule_rows(3),
        _s("31.2. Код основного заболевания по Международной статистической классификации"),
        _s("болезней и проблем, связанных со здоровьем (далее – МКБ):"),
        row(blank("diagnosisMainIcd", 40, grow=True)),
        _l("31.3. Осложнения, вызванные основным заболеванием:"),
        row(blank("diagnosisComplications", 40, grow=True)),
        *_rule_rows(4),
        _cap("31.4. Сопутствующие заболевания:", "comorbidities"),
        *_rule_rows(3),
        _cap("31.5. Коды сопутствующих заболеваний по МКБ:", "comorbiditiesIcd"),
        *_rule_rows(1),
        _l("31.6. Осложнения, вызванные сопутствующими заболеваниями:"),
        row(blank("comorbidityComplications", 40, grow=True)),
        *_rule_rows(3),
    ]


def _sheet_12() -> list[dict[str, Any]]:
    return [
        row(
            text("32. Клинический прогноз:"),
            {**options("clinicalPrognosis", ", ", codes=False, underline=True), "range": [0, 2]},
            align="stretch",
        ),
        row(
            {**options("clinicalPrognosis", ", ", codes=False, underline=True), "range": [2, 4]},
            text("(нужное подчеркнуть)"),
        ),
        row(
            text("33. Реабилитационный потенциал:"),
            {**options("rehabPotential", ", ", codes=False, underline=True), "range": [0, 3]},
            align="stretch",
        ),
        row(
            {**options("rehabPotential", ", ", codes=False, underline=True), "range": [3, 4]},
            text("(нужное подчеркнуть)"),
        ),
        row(
            text("34. Реабилитационный прогноз:"),
            {**options("rehabPrognosis", ", ", codes=False, underline=True), "range": [0, 2]},
            align="stretch",
        ),
        row(
            {**options("rehabPrognosis", ", ", codes=False, underline=True), "range": [2, 4]},
            text("(нужное подчеркнуть)"),
        ),
        _l("35. Рекомендуемые мероприятия по медицинской реабилитации:"),
        row(blank("rehabRecommendations", 40, grow=True)),
        *_rule_rows(5),
        _s("35.1. Перечень лекарственных препаратов для медицинского применения и"),
        _s("медицинских изделий (заполняется в отношении граждан, пострадавших в результате"),
        _l("несчастных случаев на производстве и профессиональных заболеваний):"),
        row(blank("medicationsList", 40, grow=True)),
        *_rule_rows(5),
        _l("36. Рекомендуемые мероприятия по реконструктивной хирургии:"),
        row(blank("reconstructiveSurgery", 40, grow=True)),
        *_rule_rows(5),
        _s("37. Рекомендуемые мероприятия по протезированию и ортезированию, техническим"),
        _l("средствам реабилитации:"),
        row(blank("prostheticsOrthotics", 40, grow=True)),
        *_rule_rows(5),
        _s("38. Санаторно-курортное лечение (заполняется в отношении граждан, пострадавших"),
        _l("в результате несчастных случаев на производстве и профессиональных заболеваний):"),
        row(blank("sanatoriumTreatment", 40, grow=True)),
        *_rule_rows(2),
    ]


def _signature_cells(name_id: str, signature_id: str) -> list[dict[str, Any]]:
    # the captions «(подпись)» «(расшифровка подписи)» are full-size words on the next printed line
    return [
        {"kind": "signature", "fieldId": signature_id, "length": 11.5, "caption": "\u00a0"},
        blank(name_id, 30, grow=True),
    ]


def _spacer(indent_mm: float) -> dict[str, Any]:
    """Empty space that moves the signature blank to its column on the sheet."""
    return {"kind": "text", "text": "\u00a0", "indentMm": indent_mm}


def _signature_captions(indent_mm: float = 86.0) -> dict[str, Any]:
    return row(
        {"kind": "text", "text": "(подпись)", "indentMm": indent_mm},
        {"kind": "text", "text": "(расшифровка подписи)", "indentMm": 3.5},
    )


def _sheet_13() -> list[dict[str, Any]]:
    return [
        *_rule_rows(2),
        _s("39. Посторонний специальный медицинский уход (заполняется в отношении граждан,"),
        _s("пострадавших в результате несчастных случаев на производстве и профессиональных"),
        _l("заболеваний):"),
        row(blank("specialMedicalCare", 40, grow=True)),
        *_rule_rows(2),
        _s("40. Дата заполнения «Направления на медико-социальную экспертизу медицинской"),
        row(
            text("организацией» (день, месяц, год):"),
            *_date("fillDate", month=9, year=3, century=True),
        ),
        _l("Председатель врачебной"),
        row(
            text("комиссии:"),
            _spacer(51),
            *_signature_cells("commissionChairName", "commissionChairSignature"),
        ),
        _signature_captions(),
        row(
            text("Члены врачебной комиссии:"),
            _spacer(15),
            *_signature_cells("commissionMember1Name", "commissionMember1Signature"),
        ),
        _signature_captions(),
        *[
            item
            for index in range(2, 5)
            for item in (
                row(
                    _spacer(81),
                    *_signature_cells(
                        f"commissionMember{index}Name", f"commissionMember{index}Signature"
                    ),
                ),
                _signature_captions(),
            )
        ],
        row({"kind": "stamp", "fieldId": "stamp", "text": "М.П. (при наличии)"}),
    ]


LAYOUT: Final[dict[str, Any]] = {
    "page": {
        "size": "A4",
        "orientation": "portrait",
        "marginMm": {"top": 22.5, "right": 7.3, "bottom": 8, "left": 20.2},
        "fontSizePt": 14,
        "lineHeight": 1.17,
    },
    "blocks": [
        _block("sheet-1", _sheet_1(), new_sheet=False),
        _block("sheet-2", _sheet_2()),
        _block("sheet-3", _sheet_3()),
        _block("sheet-4", _sheet_4()),
        _block("sheet-5", _sheet_5()),
        _block("sheet-6", _sheet_6()),
        _block("sheet-7", _sheet_7()),
        _block("sheet-8", _sheet_8()),
        _block("sheet-9", _sheet_9()),
        _block("sheet-10", _sheet_10()),
        _block("sheet-11", _sheet_11()),
        _block("sheet-12", _sheet_12()),
        _block("sheet-13", _sheet_13()),
    ],
}

NOTES: Final[list[str]] = [
    "Приказ 488н/551н вступает в силу «по истечении 10 дней после дня официального "
    "опубликования» (пункт 3 приказа; опубликован 10.11.2022), положения об использовании "
    "единого портала государственных и муниципальных услуг — с 01.02.2023. Дата effectiveFrom "
    "2022-11-21 вычислена по этой формуле (первый день после десяти дней), в тексте приказа "
    "календарной даты нет. Срок действия приказ не ограничивает; пункт 2 приказа признаёт "
    "утратившим силу приказ от 01.02.2021 № 27н/36н.",
    "«Порядок заполнения» (приложение № 2) не нумерует абзацы как «9.1.»: пункт 10 — список "
    "«1) … 47)», а под пунктами со вложенными подпунктами стоят строки «в подпункте X.Y делается "
    "…». Идентификатор правила: 10.N — пункт N) списка, 10.N.X.Y — строка для подпункта X.Y "
    "бланка внутри него (строка «в подпунктах 9.2, 9.3» одна, она цитируется как 10.12.9.2).",
    "Бланк (приложение № 1) течёт со страницы на страницу: таблицы и абзацы переходят через "
    "границу страницы. Печать повторяет разрыв каждой из 13 страниц приказа (PDF-страницы "
    "2–14); номер страницы приказа и заголовок «Приложение № 1 …» в бланк не входят. Ячейка, "
    "разорванная границей страницы (5.6, 13.2), напечатана двумя частями.",
    "Подстановка: ФИО, дата рождения, пол (две отметки «Мужской»/«Женский»), СНИЛС, номер "
    "полиса ОМС, адрес места жительства (субъект, район, населённый пункт, улица, дом/корпус/"
    "строение, квартира), телефон, место работы (22.6), диагноз и код МКБ основного заболевания "
    "(31.1–31.2), организация, ОГРН и дата заполнения. Не подставляются: гражданство (в "
    "приложении хранится произвольной строкой, а бланк различает три категории), документ, "
    "удостоверяющий личность (приложение его не хранит), возраст, рост и вес, председатель и "
    "члены врачебной комиссии (врач, заполняющий форму, не обязательно её член или председатель).",
    "Обязательность (required): basis = source только там, где пункт Порядка без оговорки "
    "говорит, что запись делается (организация, протокол ВК, ФИО, дата рождения и возраст, "
    "основные строки адреса, год наблюдения, анамнезы, состояние здоровья, диагноз, дата, "
    "председатель ВК). Всё, что порядок ставит в зависимость от случая («в случае, если …»), не "
    "обязательно. Пустое обязательное поле только подсвечивается, печать не блокируется.",
    "Бланк отличается от текста приказа в нескольких местах, они оставлены как напечатаны: "
    "пункт 44 Порядка и пункт 46 пишут «на медико-социальной экспертизу»; пункт 14 Порядка "
    "называет строку 11.8 «в пункте 11.8»; в подпункте 20.4.5 дата «1941 - 1945» напечатана с "
    "дефисом, а не тире.",
    "Пункт 28.6 бланка печатает две графы «____/____» (объём талии и бёдер): это два поля. "
    "У подпункта 28.5 бланк не рисует строку; поле dailyOutput печатается короткой чертой после "
    "подписи, чтобы значение было видно на бумаге.",
    "Пункт 27: в пункте 30 Порядка сказано «указывается ее номер и дата разработки» "
    "(индивидуальной "
    "программы реабилитации), а бланк после номера программы печатает «к протоколу проведения "
    "медико-социальной экспертизы № … от «…»»; какая дата имеется в виду, порядок не уточняет — "
    "три поля помечены by-line.",
    "Скан официального приказа на publication.pravo.gov.ru — страница 599 × 857 pt (211,3 × 302,5 "
    "мм), не A4: печать идёт на A4 (210 × 297 мм), отклонение формата листа 6 мм — свойство "
    "скана, не бланка.",
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
    corrections=(),
    fields=FIELDS,
    code_lists={},
    sequential_lists={},
    sections=SECTIONS,
    layout=LAYOUT,
    notes=NOTES,
    row_corrections=ROW_CORRECTIONS,
    scan_reviewed_captions=SCAN_REVIEWED,
    issuer=ISSUER,
    issuer_short="Минтруда России и Минздрава России",
    item_paragraphs="10",
    edition_note=EDITION_NOTE,
)
