"""Reviewed blueprint of form 025-1/у «Талон пациента, получающего медицинскую помощь в
амбулаторных условиях» (order 274н, appendices 3 and 4).

The blank is appendix 3 (PDF pages 19–20, a landscape sheet printed on both sides; the scan is
rotated by 90°), the «Порядок заполнения» is appendix 4 (PDF pages 21–28). The talon is a numbered
list of 51 items; every field here is named by the number the blank prints, its choices are the
legends printed in the item itself, and the paragraph 9.x that governs the item is cited. Items
the order does not describe are marked `undefined`, never invented.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    EFFECTIVE_FROM,
    EFFECTIVE_UNTIL,
    FOOTNOTE_MARK,
    ICD10_MESSAGE,
    ICD10_PATTERN,
    LOOKALIKE,
    ORDER_DATE,
    ORDER_NUMBER,
    ORDER_TITLE,
    REGISTRATION,
    SNILS_PATTERN,
    blank,
    date_blanks,
    field_def,
    field_rule,
    options,
    row,
    signature,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.274n.025-1u"
FORM_NUMBER: Final = "025-1/у"
FORM_TITLE: Final = "Талон пациента, получающего медицинскую помощь в амбулаторных условиях"

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {
    21: 0.09,
    22: 0.15,
    23: 0.08,
    24: 0.22,
    25: 0.09,
    27: 0.08,
}

CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(22, "«Талон No»", "«Талон №»", "OCR renders № as No"),
    Correction(
        22,
        "медицинской деятельности основной",
        "медицинской деятельности и основной",
        "the conjunction at the end of a printed line is not recognised",
    ),
    Correction(
        26,
        "при отсутствии пациента",
        "при отсутствии у пациента",
        "a short word at the start of a printed line is not recognised",
    ),
    Correction(
        26,
        "повторное В текущем",
        "повторное в текущем",
        "capital letter recognised for a lower-case word",
    ),
    Correction(
        26,
        "заболевании, том числе",
        "заболевании, в том числе",
        "a short word at the start of a printed line is not recognised",
    ),
    Correction(
        26,
        "заболеваниях, соответствующие им",
        "заболеваниях, и соответствующие им",
        "a short word at the start of a printed line is not recognised",
    ),
    Correction(
        24,
        "у пациента группы инвалидности",
        "у пациента группы инвалидности.",
        "sentence-final dot lost together with a footnote mark",
    ),
    Correction(
        24,
        "факт установления инвалидности",
        "факт установления инвалидности.",
        "sentence-final dot lost together with a footnote mark",
    ),
    Correction(
        25, "доказывается", "оказывается", "OCR confuses the first letters of «оказывается»"
    ),
    Correction(
        25, "В ТОМ числе", "в том числе", "capital letters recognised for a lower-case phrase"
    ),
    Correction(25, 'помощь"', "помощь.", FOOTNOTE_MARK),
    Correction(25, "(коды А00 - T98)", "(коды A00 - T98)", LOOKALIKE),
    Correction(25, "комиссиями!?;", "комиссиями;", FOOTNOTE_MARK),
    Correction(
        26, "КОД ПО МКБ", "код по МКБ", "capital letters recognised for a lower-case phrase"
    ),
    Correction(27, 'здравоохранения"3.', "здравоохранения.", FOOTNOTE_MARK),
    Correction(
        27, "ВИД аппаратуры", "вид аппаратуры", "capital letters recognised for a lower-case word"
    ),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(
        24,
        "медициними рабовкано средедикоедникая оброзоаниеоказывается",
        "первичная доврачебная медико-санитарная помощь оказывается медицинскими работниками "
        "со средним медицинским образованием;",
        "garbled line (two printed lines merged by the OCR) recovered from the scan",
    ),
    Correction(
        26,
        "9.21 В строке",
        "9.21. В строке",
        "the dot after the paragraph number is not recognised",
    ),
)
# The OCR of the rotated scan garbled the printed «2. Код меры социальной поддержки»; seen on it.
SCAN_REVIEWED: Final[tuple[str, ...]] = ("Код меры социальной поддержки",)

ICD_KW: Final[dict[str, Any]] = {"pattern": ICD10_PATTERN, "patternMessage": ICD10_MESSAGE}


def opts(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"value": value, "label": label} for value, label in pairs]


YES_NO: Final = opts(("1", "да"), ("2", "нет"))
SIGN_OPTIONS: Final = opts(
    ("1", "острое"),
    ("2", "впервые в жизни установленное хроническое"),
    ("3", "ранее установленное хроническое"),
)
DN_OPTIONS: Final = opts(
    ("1", "состоит"),
    ("2", "взят"),
    ("3", "снят"),
    ("3.1", "выздоровление"),
    ("3.2", "выбытие"),
    ("3.3", "смерть"),
    ("3.4", "прочие"),
)
TRAUMA_OPTIONS: Final = opts(
    ("1", "производственная"),
    ("2", "транспортная"),
    ("2.1", "ДТП"),
    ("3", "спортивная"),
    ("4", "уличная"),
    ("5", "сельскохозяйственная"),
    ("6", "бытовая"),
    ("7", "школьная"),
    ("8", "прочая"),
)
DN_STATE: Final = opts(("1", "состоит"), ("2", "взят"), ("3", "снят"))
DN_OFF: Final = opts(
    ("3.1", "выздоровление"), ("3.2", "выбытие"), ("3.3", "смерть"), ("3.4", "прочие")
)

# paragraph of «Порядок заполнения» that governs each printed item
P: Final = {
    "open": "9.1",
    "social": "9.2",
    "socialUntil": "9.3",
    "oms": "9.4",
    "snils": "9.5",
    "person": "9.6",
    "employment": "9.7",
    "workplace": "9.8",
    "disability": "9.9",
    "disabilityGroup": "9.10",
    "careType": "9.11",
    "place": "9.12",
    "visit": "9.13",
    "appeal": "9.14",
    "closed": "9.15",
    "kind": "9.16",
    "result": "9.17",
    "payment": "9.18",
    "dates": "9.19",
    "prelim": "9.20",
    "external": "9.21",
    "extra": "9.22",
    "signMain": "9.23",
    "dn": "9.24",
    "trauma": "9.25",
    "final": "9.26",
    "extraFinal": "9.27",
    "signFinal": "9.28",
    "dnFinal": "9.29",
    "traumaFinal": "9.30",
    "operation": "9.31",
    "anesthesia": "9.32",
    "intervention": "9.33",
    "interventionDoctor": "9.34",
    "prescription": "9.35",
    "tempDisability": "9.36",
    "close": "9.37",
    "doctor": "9.38",
}


def rule(key: str) -> dict[str, Any]:
    return field_rule("defined", P[key])


def txt(field_id: str, label: str, key: str, **kw: Any) -> dict[str, Any]:
    kw.setdefault("maxLength", 200)
    return field_def(field_id, label, "text", rule(key), **kw)


def date(field_id: str, label: str, key: str, **kw: Any) -> dict[str, Any]:
    return field_def(field_id, label, "date", rule(key), **kw)


def choice(
    field_id: str, label: str, key: str, options_: list[dict[str, str]], **kw: Any
) -> dict[str, Any]:
    return field_def(field_id, label, "choice", rule(key), options=options_, **kw)


def icd(field_id: str, label: str, key: str, **kw: Any) -> dict[str, Any]:
    return field_def(field_id, label, "icd10", rule(key), anchor="код по МКБ", **ICD_KW, **kw)


def _undefined(note: str) -> dict[str, Any]:
    return field_rule("undefined", note=note)


NOTE_CELLS: Final = (
    "Бланк печатает у осложнений и сопутствующих заболеваний графы «признак», «ДН» и «снят с "
    "ДН»; порядок их не описывает (п. 9.24 говорит о диспансерном наблюдении по основному "
    "заболеванию). Варианты взяты из легенд строк 29 и 30 того же бланка."
)


def cells(prefix: str, number: str) -> list[dict[str, Any]]:
    """The «признак», «ДН» and «снят с ДН» blanks printed at the end of a diagnosis line."""
    note = _undefined(NOTE_CELLS)
    return [
        field_def(
            f"{prefix}Sign",
            f"признак ({number})",
            "choice",
            note,
            options=SIGN_OPTIONS,
            anchor="признак",
        ),
        field_def(f"{prefix}Dn", f"ДН ({number})", "choice", note, options=DN_STATE, anchor="ДН"),
        field_def(
            f"{prefix}DnOff",
            f"снят с ДН ({number})",
            "choice",
            note,
            options=DN_OFF,
            anchor="снят с ДН",
        ),
    ]


def _build_fields() -> list[dict[str, Any]]:
    undefined_header = _undefined("Порядок не описывает заполнение шапки.")
    fields: list[dict[str, Any]] = [
        field_def(
            "organization",
            "Наименование и адрес медицинской организации (фамилия, имя, отчество (при наличии) "
            "индивидуального предпринимателя и адрес осуществления медицинской деятельности)",
            "text",
            field_rule(
                "defined",
                "8.1",
            ),
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
            field_rule("defined", "8.1"),
            required=True,
            basis="source",
            anchor="Основной государственный регистрационный номер",
            prefill={"sources": ["organization.ogrn"]},
            pattern="^(?:[0-9]{13}|[0-9]{15})$",
            patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
        ),
        field_def(
            "talonNumber",
            "Талон №",
            "text",
            field_rule("defined", "8.2"),
            required=True,
            basis="source",
            anchor="ТАЛОН ПАЦИЕНТА, ПОЛУЧАЮЩЕГО МЕДИЦИНСКУЮ ПОМОЩЬ",
            maxLength=40,
        ),
        # ---- 1–5
        date(
            "openDate",
            "1. Дата открытия талона",
            "open",
            required=True,
            basis="source",
            anchor="Дата открытия талона",
            prefill={"sources": ["today"]},
        ),
        txt(
            "cardNumber",
            "1.1. Номер медицинской карты пациента, получающего помощь в амбулаторных условиях",
            "open",
            anchor="Номер медицинской карты пациента",
            maxLength=40,
        ),
        txt(
            "areaNumber",
            "1.2. Номер участка (при наличии)",
            "open",
            anchor="Номер участка",
            maxLength=20,
        ),
        choice(
            "socialSupportCode",
            "2. Код меры социальной поддержки",
            "social",
            [],
            anchor="Код меры социальной поддержки",
        ),
        date(
            "socialSupportUntil",
            "3. Установлена до",
            "socialUntil",
            anchor="Установлена до",
        ),
        txt(
            "omsSeries",
            "4. Полис обязательного медицинского страхования: серия",
            "oms",
            anchor="Полис обязательного медицинского страхования",
            maxLength=20,
        ),
        txt(
            "omsNumber",
            "№ полиса обязательного медицинского страхования",
            "oms",
            anchor="выдан",
            prefill={"sources": ["patient.omsPolicy.number"]},
            maxLength=40,
        ),
        txt(
            "omsIssuer",
            "выдан (страховая медицинская организация)",
            "oms",
            anchor="выдан",
            prefill={"sources": ["patient.omsPolicy.insurer"]},
            maxLength=200,
        ),
        date(
            "omsIssueDate",
            "дата выдачи полиса",
            "oms",
            anchor="дата выдачи",
            prefill={"sources": ["patient.omsPolicy.issuedAt"]},
            notAfter="today",
        ),
        field_def(
            "snils",
            "5. Страховой номер индивидуального лицевого счёта",
            "text",
            rule("snils"),
            required=True,
            basis="source",
            anchor="Страховой номер индивидуального лицевого счёта",
            prefill={"sources": ["patient.snils"]},
            pattern=SNILS_PATTERN,
            patternMessage="СНИЛС в формате 123-456-789 01",
        ),
        # ---- 6–12
        field_def(
            "surname",
            "6. Фамилия",
            "text",
            rule("person"),
            required=True,
            basis="source",
            prefill={"sources": ["patient.fullName"], "words": {"from": 0, "count": 1}},
            maxLength=80,
        ),
        field_def(
            "firstName",
            "7. Имя",
            "text",
            rule("person"),
            required=True,
            basis="source",
            prefill={"sources": ["patient.fullName"], "words": {"from": 1, "count": 1}},
            maxLength=80,
        ),
        field_def(
            "patronymic",
            "8. Отчество (при наличии)",
            "text",
            rule("person"),
            prefill={"sources": ["patient.fullName"], "words": {"from": 2}},
            maxLength=80,
        ),
        field_def(
            "patientSex",
            "9. Пол",
            "choice",
            rule("person"),
            required=True,
            basis="source",
            prefill={"sources": ["patient.sex"], "map": {"male": "1", "female": "2"}},
            options=opts(("1", "муж."), ("2", "жен.")),
            anchor="Пол: муж. - 1, жен. - 2",
        ),
        field_def(
            "patientBirthDate",
            "10. Дата рождения",
            "date",
            rule("person"),
            required=True,
            basis="source",
            prefill={"sources": ["patient.birthDate"]},
            notAfter="today",
            anchor="Дата рождения",
        ),
    ]
    undefined_idoc = _undefined(
        "Порядок называет строки 6–12 (п. 9.6); строка 10.1 «Документ, удостоверяющий "
        "личность» в нём не упомянута."
    )
    fields += [
        field_def(
            "idDocType",
            "10.1. Документ, удостоверяющий личность",
            "text",
            undefined_idoc,
            anchor="Документ, удостоверяющий личность",
            maxLength=100,
        ),
        field_def(
            "idDocSeries",
            "серия документа, удостоверяющего личность",
            "text",
            undefined_idoc,
            anchor="серия",
            maxLength=20,
        ),
        field_def(
            "idDocNumber",
            "№ документа, удостоверяющего личность",
            "text",
            undefined_idoc,
            anchor="Документ, удостоверяющий личность",
            maxLength=30,
        ),
        field_def(
            "citizenship",
            "гражданство",
            "text",
            undefined_idoc,
            anchor="гражданство",
            prefill={"sources": ["patient.citizenship"]},
            maxLength=80,
        ),
    ]
    by_line_11 = field_rule(
        "by-line",
        "9.6",
        note=(
            "Пункт 9.6 называет строку 11 «Регистрация по месту жительства» целиком; её части "
            "(район, улица, телефон и др.) порядок отдельно не определяет."
        ),
    )
    for suffix, label, part, anchor in (
        (
            "Subject",
            "11. Регистрация по месту жительства: субъект Российской Федерации",
            "subject",
            "Регистрация по месту жительства: субъект Российской Федерации",
        ),
        ("District", "район", "district", "район"),
        ("Locality", "населенный пункт", "locality", "населенный пункт"),
        ("Street", "улица", "street", "улица"),
        ("House", "дом", "house", "дом"),
        ("Building", "строение/корпус", "building", "строение/корпус"),
        ("Apartment", "квартира", "apartment", "квартира"),
        ("Phone", "тел.", "phone", "тел."),
    ):
        fields.append(
            field_def(
                f"residence{suffix}",
                label,
                "text",
                by_line_11,
                anchor=anchor,
                prefill={"sources": [f"patient.address.{part}"]},
                maxLength=120,
            )
        )
    undefined_stay = _undefined(
        "Пункт 9.6 перечисляет строки 6–12; строка 11.1 «Регистрация по месту пребывания» в нём "
        "не названа."
    )
    for suffix, label, part, anchor in (
        (
            "Subject",
            "11.1. Регистрация по месту пребывания: субъект Российской Федерации",
            "subject",
            "Регистрация по месту пребывания: субъект Российской Федерации",
        ),
        ("District", "район (место пребывания)", "district", "район"),
        ("Locality", "населенный пункт (место пребывания)", "locality", "населенный пункт"),
        ("Street", "улица (место пребывания)", "street", "улица"),
        ("House", "дом (место пребывания)", "house", "дом"),
        ("Building", "строение/корпус (место пребывания)", "building", "строение/корпус"),
        ("Apartment", "квартира (место пребывания)", "apartment", "квартира"),
        ("Phone", "тел. (место пребывания)", "phone", "тел."),
    ):
        fields.append(
            field_def(
                f"stay{suffix}",
                label,
                "text",
                undefined_stay,
                anchor=anchor,
                prefill={"sources": [f"patient.stayAddress.{part}"]},
                maxLength=120,
            )
        )
    fields += [
        choice(
            "localityType",
            "12. Местность",
            "person",
            opts(("1", "городская"), ("2", "сельская")),
            anchor="Местность: городская - 1, сельская - 2",
        ),
        choice(
            "employment",
            "13. Занятость",
            "employment",
            opts(
                ("1", "работает"),
                ("2", "проходит военную службу или приравненную к ней службу"),
                ("3", "пенсионер"),
                ("4", "обучающийся"),
                ("5", "не работает"),
                ("6", "прочие"),
            ),
            anchor="Занятость: работает - 1",
        ),
        txt(
            "workplace",
            "14. Место работы, учебы",
            "workplace",
            anchor="Место работы, учебы",
            prefill={"sources": ["patient.workplace"]},
            maxLength=200,
        ),
        choice(
            "disability",
            "15. Инвалидность: установлена",
            "disability",
            opts(("1", "впервые"), ("2", "повторно")),
            anchor="Инвалидность: установлена впервые - 1, повторно - 2",
        ),
        choice(
            "disabilityGroup",
            "16. Группа инвалидности",
            "disabilityGroup",
            opts(("1", "I"), ("2", "II"), ("3", "III")),
            anchor="Группа инвалидности: I - 1, II - 2, III - 3",
        ),
        choice(
            "careType",
            "17. Оказываемая медицинская помощь",
            "careType",
            opts(
                ("1", "первичная доврачебная медико-санитарная помощь"),
                ("2", "первичная врачебная медико-санитарная помощь"),
                ("3", "первичная специализированная медико-санитарная помощь"),
                ("4", "паллиативная медицинская помощь"),
            ),
            anchor="Оказываемая медицинская помощь: первичная доврачебная медико-санитарная помощь",
        ),
        choice(
            "visitPlace",
            "18. Место обращения (посещения)",
            "place",
            opts(
                ("1", "поликлиника и (или) ее подразделения"),
                ("2", "на дому"),
                ("3", "центр здоровья"),
                ("4", "мобильная медицинская бригада"),
                ("5", "фельдшерско-акушерский пункт (включая передвижные)"),
                ("6", "фельдшерский пункт (включая передвижные)"),
                ("7", "здравпункт"),
                ("8", "иные медицинские организации"),
            ),
            anchor="Место обращения (посещения): поликлиника и (или) ее подразделения",
        ),
        choice(
            "visitPurposeDisease",
            "19. Посещение (цель): по заболеванию (коды A00 - T98)",
            "visit",
            opts(
                ("1", "по заболеванию (коды A00 - T98)"),
                ("1.1", "из них: в неотложной форме"),
                ("1.2", "активное посещение"),
                ("1.3", "диспансерное наблюдение"),
                ("1.4", "дневной стационар"),
                ("1.5", "консультативный прием"),
                ("1.6", "по направлению"),
            ),
            multiple=True,
            anchor="Посещение (цель)",
        ),
        choice(
            "visitPurposePrevention",
            "19. Посещение (цель): с профилактическими и иными целями (коды Z00 - Z99)",
            "visit",
            opts(
                ("2", "с профилактическими и иными целями (коды Z00 - Z99)"),
                ("2.1", "медицинский осмотр"),
                ("2.2", "диспансеризация и профилактический медицинский осмотр"),
                ("2.3", "комплексное обследование"),
                ("2.4", "паллиативная медицинская помощь"),
                ("2.5", "патронаж"),
                ("2.6", "другие обстоятельства"),
            ),
            multiple=True,
            anchor="с профилактическими и иными целями",
        ),
        choice(
            "appealPurpose",
            "20. Обращение (цель)",
            "appeal",
            opts(
                ("1", "по заболеванию (коды A00 - T98)"),
                ("2", "с профилактической целью (коды Z00 - Z99)"),
            ),
            anchor="Обращение (цель): по заболеванию",
        ),
        choice(
            "closedCase",
            "21. Обращение (законченный случай лечения)",
            "closed",
            YES_NO,
            anchor="Обращение (законченный случай лечения): да - 1, нет - 2",
        ),
        choice(
            "appealKind",
            "22. Обращение",
            "kind",
            opts(("1", "первичное"), ("2", "повторное")),
            anchor="Обращение: первичное - 1, повторное - 2",
        ),
        choice(
            "result",
            "23.1. Результат обращения: выздоровление",
            "result",
            opts(
                ("1", "выздоровление"),
                ("2", "без изменения"),
                ("3", "улучшение"),
                ("4", "ухудшение"),
                ("5", "летальный исход"),
            ),
            anchor="Выздоровление - 1, без изменения - 2",
        ),
        choice(
            "referral",
            "23.2. Дано направление для оказания медицинской помощи",
            "result",
            opts(
                ("1", "по экстренным показаниям"),
                ("2", "на госпитализацию в дневной стационар"),
                ("3", "на обследование"),
                ("4", "на консультацию"),
                ("5", "на санаторно-курортное лечение"),
                ("6", "на медицинскую реабилитацию"),
                (
                    "7",
                    "отказ от прохождения медицинских обследований при диспансеризации или "
                    "медицинском осмотре",
                ),
            ),
            multiple=True,
            anchor="Дано направление для оказания медицинской помощи: по экстренным показаниям",
        ),
        choice(
            "payment",
            "24. Основной вид оплаты",
            "payment",
            opts(
                ("1", "обязательное медицинское страхование"),
                ("2", "средства бюджета (всех уровней)"),
                ("3", "платные медицинские услуги"),
                ("4", "в том числе добровольное медицинское страхование"),
                ("5", "другое"),
            ),
            anchor="Основной вид оплаты: обязательное медицинское страхование",
        ),
    ]
    for index in range(1, 18):
        fields.append(
            date(
                f"visitDate{index}",
                f"25. Даты посещений ({index})",
                "dates",
                anchor="Даты посещений",
                notAfter="today",
            )
        )
    # ---- 26–31 preliminary diagnosis
    fields += [
        txt(
            "prelimDiagnosis",
            "26. Диагноз предварительный",
            "prelim",
            anchor="Диагноз предварительный",
            prefill={"sources": ["episode.diagnosis.text"]},
            multiline=True,
            maxLength=300,
        ),
        icd(
            "prelimDiagnosisIcd",
            "код по МКБ (диагноз предварительный)",
            "prelim",
            prefill={"sources": ["episode.diagnosis.icd10"]},
        ),
        txt(
            "prelimComplications",
            "26.1. Осложнения основанного заболевания",
            "prelim",
            anchor="Осложнения основанного заболевания",
        ),
        icd("prelimComplicationsIcd", "код по МКБ (26.1)", "prelim"),
        *cells("prelimComplications", "26.1."),
    ]

    def comorbidity_rows(prefix: str, number: str, key: str) -> None:
        for index in range(1, 4):
            fields.extend(
                [
                    txt(
                        f"{prefix}{index}",
                        f"{number} Сопутствующие заболевания ({index})",
                        key,
                        anchor="Сопутствующие заболевания",
                    ),
                    icd(f"{prefix}{index}Icd", f"код по МКБ ({number}, {index})", key),
                    *cells(f"{prefix}{index}", f"{number}, {index}"),
                ]
            )

    comorbidity_rows("prelimComorbidity", "26.2.", "prelim")
    fields += [
        txt(
            "prelimExternalCause",
            "27. Внешняя причина (при наличии травм и отравлений)",
            "external",
            anchor="Внешняя причина (при наличии травм и отравлений)",
        ),
        icd("prelimExternalCauseIcd", "код по МКБ (27)", "external"),
        txt(
            "prelimExtra",
            "28. Дополнительные сведения о заболевании",
            "extra",
            anchor="Дополнительные сведения о заболевании",
            multiline=True,
            maxLength=500,
        ),
        choice(
            "prelimSign",
            "29. Заболевание основное (признак)",
            "signMain",
            SIGN_OPTIONS,
            anchor="Заболевание основное (признак): острое - 1",
        ),
        choice(
            "prelimDn",
            "30. Диспансерное наблюдение по основному заболеванию",
            "dn",
            DN_OPTIONS,
            anchor="Диспансерное наблюдение по основному заболеванию: состоит - 1",
        ),
        choice(
            "prelimTrauma",
            "31. Травма",
            "trauma",
            TRAUMA_OPTIONS,
            anchor="Травма: производственная - 1, транспортная - 2",
        ),
        # ---- 32–37 final diagnosis
        txt(
            "finalDiagnosis",
            "32. Заключительный клинический диагноз: основное заболевание",
            "final",
            anchor="Заключительный клинический диагноз: основное заболевание",
            multiline=True,
            maxLength=300,
        ),
        icd("finalDiagnosisIcd", "код по МКБ (диагноз заключительный)", "final"),
    ]
    fields += [
        field_def(
            "finalComplications",
            "32.1. Осложнения основанного заболевания (заключительный диагноз)",
            "text",
            field_rule(
                "by-line",
                "9.26",
                note=(
                    "Пункт 9.26 описывает строку 32 и называет подпункт 32.2; подпункт 32.1 "
                    "порядок отдельно не называет."
                ),
            ),
            anchor="Осложнения основанного заболевания",
            maxLength=200,
        ),
        field_def(
            "finalComplicationsIcd",
            "код по МКБ (32.1)",
            "icd10",
            field_rule("by-line", "9.26", note="Подпункт 32.1 порядок отдельно не называет."),
            anchor="код по МКБ",
            **ICD_KW,
        ),
        *cells("finalComplications", "32.1."),
    ]
    comorbidity_rows("finalComorbidity", "32.2.", "final")
    fields += [
        txt(
            "finalExternalCause",
            "33. Внешняя причина (при наличии травм и отравлений)",
            "final",
            anchor="Внешняя причина (при наличии травм и отравлений)",
        ),
        icd("finalExternalCauseIcd", "код по МКБ (33)", "final"),
        txt(
            "finalExtra",
            "34. Дополнительные сведения о заболевании (заключительный диагноз)",
            "extraFinal",
            anchor="Дополнительные сведения о заболевании",
            multiline=True,
            maxLength=500,
        ),
        choice(
            "finalSign",
            "35. Заболевание основное (признак)",
            "signFinal",
            SIGN_OPTIONS,
            anchor="Заболевание основное (признак): острое - 1",
        ),
        choice(
            "finalDn",
            "36. Диспансерное наблюдение по основному заболеванию",
            "dnFinal",
            DN_OPTIONS,
            anchor="Диспансерное наблюдение по основному заболеванию: состоит - 1",
        ),
        choice(
            "finalTrauma",
            "37. Травма",
            "traumaFinal",
            TRAUMA_OPTIONS,
            anchor="Травма: производственная - 1, транспортная - 2",
        ),
        # ---- 38–43 operations and interventions
        txt(
            "operationName",
            "38. Наименование операции",
            "operation",
            anchor="Наименование операции",
        ),
        txt("operationCode", "код* (операция)", "operation", anchor="код", maxLength=40),
        choice(
            "anesthesia",
            "39. Анестезия",
            "anesthesia",
            opts(("1", "общая"), ("2", "местная"), ("3", "комбинированная")),
            anchor="Анестезия: общая - 1, местная - 2, комбинированная - 3",
        ),
        choice(
            "apparatus",
            "40. Операция проведена с использованием аппаратуры",
            "anesthesia",
            opts(
                ("1", "лазерной"),
                ("2", "криогенной"),
                ("3", "эндоскопической"),
                ("4", "рентгеновской"),
                ("5", "иной"),
            ),
            anchor="Операция проведена с использованием аппаратуры: лазерной - 1",
        ),
        txt(
            "operationDoctorPosition",
            "41. Врач: должность, специальность",
            "anesthesia",
            anchor="Врач: должность, специальность",
        ),
        txt(
            "operationDoctorName",
            "41. Врач: фамилия, имя, отчество (при наличии)",
            "anesthesia",
            anchor="фамилия, имя, отчество (при наличии)",
        ),
        txt("operationDoctorCode", "код врача (41)", "anesthesia", anchor="код", maxLength=40),
    ]
    for index in (1, 2, 3, 4):
        fields += [
            txt(
                f"intervention{index}",
                f"42. Иные медицинские вмешательства, в том числе с целью исследования ({index})",
                "intervention",
                anchor="Иные медицинские вмешательства, в том числе с целью исследования"
                if index == 1
                else "в том числе лабораторные, инструментальные и лучевые",
            ),
            txt(
                f"intervention{index}Qty",
                f"кол-во (42, {index})",
                "intervention",
                anchor="кол-во",
                maxLength=10,
            ),
            txt(
                f"intervention{index}Code",
                f"код (42, {index})",
                "intervention",
                anchor="код",
                maxLength=40,
            ),
        ]
    fields += [
        txt(
            "interventionDoctorPosition",
            "43. Врач: должность, специальность",
            "interventionDoctor",
            anchor="Врач: должность, специальность",
        ),
        txt(
            "interventionDoctorName",
            "43. Врач: фамилия, имя, отчество (при наличии)",
            "interventionDoctor",
            anchor="фамилия, имя, отчество (при наличии)",
        ),
        txt(
            "interventionDoctorCode",
            "код врача (43)",
            "interventionDoctor",
            anchor="код",
            maxLength=40,
        ),
    ]
    # ---- 44 prescriptions table
    columns = (
        ("Date", "Дата", "date"),
        ("Series", "серия", "text"),
        ("Number", "номер", "text"),
        (
            "Name",
            "Наименование лекарственного препарата, специализированных продуктов лечебного "
            "питания, медицинских изделий",
            "text",
        ),
        ("Benefit", "Льгота (%)", "text"),
        ("Form", "Лек. форма", "text"),
        ("Dose", "Доза", "text"),
        ("Qty", "Кол-во", "text"),
        ("Icd", "Код МКБ", "icd10"),
        ("DoctorCode", "Код врача", "text"),
    )
    for index in (1, 2, 3):
        for suffix, label, kind in columns:
            extra: dict[str, Any] = {}
            if kind == "date":
                extra["notAfter"] = "today"
            if kind == "icd10":
                extra.update(ICD_KW)
            fields.append(
                field_def(
                    f"prescription{index}{suffix}",
                    f"44. Рецепт {index}: {label}",
                    kind,
                    rule("prescription"),
                    anchor="Рецепты на лекарственные препараты",
                    maxLength=200,
                    **extra,
                )
            )
    # ---- 45–51 temporary disability
    fields += [
        choice(
            "tempDocKind",
            "45. Документ о временной нетрудоспособности",
            "tempDisability",
            opts(("1", "листок нетрудоспособности"), ("2", "справка")),
            anchor="Документ о временной нетрудоспособности: листок нетрудоспособности - 1",
        ),
        choice(
            "tempReason",
            "46. Повод выдачи",
            "tempDisability",
            opts(
                ("1", "заболевание"),
                ("2", "уход за больным членом семьи"),
                ("3", "в связи с карантином"),
                ("4", "на период санаторно-курортного лечения"),
            ),
            anchor="Повод выдачи: заболевание - 1, уход за больным членом семьи - 2",
        ),
        txt(
            "tempCareRecipient",
            "уход за больным членом семьи: фамилия, имя, отчество (при наличии), пол, возраст",
            "tempDisability",
            anchor="фамилия, имя, отчество (при наличии), пол, возраст",
            maxLength=200,
        ),
        date("tempIssueDate", "47. Дата выдачи", "tempDisability", anchor="Дата выдачи"),
    ]
    for index in range(1, 7):
        fields.append(
            date(
                f"tempExtension{index}",
                f"48. Даты продления ({index})",
                "tempDisability",
                anchor="Даты продления",
            )
        )
    fields += [
        date(
            "tempCloseDate",
            "49. Дата закрытия документа о временной нетрудоспособности",
            "tempDisability",
            anchor="Дата закрытия документа о временной нетрудоспособности",
        ),
        date("closeDate", "50. Дата закрытия талона", "close", anchor="Дата закрытия талона"),
        txt(
            "doctorPosition",
            "51. Врач: должность, специальность",
            "doctor",
            anchor="Врач: должность, специальность",
            prefill={"sources": ["clinician.position"]},
            required=True,
            basis="source",
        ),
        txt(
            "doctorName",
            "51. Врач: фамилия, имя, отчество (при наличии)",
            "doctor",
            anchor="фамилия, имя, отчество (при наличии), подпись",
            prefill={"sources": ["clinician.fullName"]},
            required=True,
            basis="source",
        ),
        field_def(
            "doctorSignature",
            "подпись врача",
            "signature",
            field_rule("defined", P["doctor"]),
            anchor="подпись",
        ),
    ]
    _ = undefined_header
    return fields


FIELDS: Final = _build_fields()

# Choice fields whose options are the «code» - name list of a paragraph.
CODE_LISTS: Final = {"socialSupportCode": "9.2"}
SEQUENTIAL_LISTS: Final = {"9.2": 10}


# --------------------------------------------------------------------------- screen sections


def _rows(prefix: str, count: int, *suffixes: str) -> list[str]:
    cells = suffixes or ("",)
    return [f"{prefix}{index}{suffix}" for index in range(1, count + 1) for suffix in cells]


def _address(prefix: str) -> list[str]:
    return [
        f"{prefix}{part}"
        for part in (
            "Subject",
            "District",
            "Locality",
            "Street",
            "House",
            "Building",
            "Apartment",
            "Phone",
        )
    ]


COMORBIDITY_CELLS: Final = ("", "Icd", "Sign", "Dn", "DnOff")


def _cells(prefix: str) -> list[str]:
    return [f"{prefix}{suffix}" for suffix in ("Sign", "Dn", "DnOff")]


SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "talon",
        "title": "Талон",
        "description": "Номер — индивидуальный номер формы № 025/у (п. 8.2).",
        "fieldIds": ["talonNumber", "openDate", "cardNumber", "areaNumber"],
    },
    {
        "id": "organization",
        "title": "Организация",
        "description": "Подставляется из настроек «Врач и организация».",
        "fieldIds": ["organization", "organizationOgrn"],
    },
    {
        "id": "social",
        "title": "Социальная поддержка и полис",
        "fieldIds": [
            "socialSupportCode",
            "socialSupportUntil",
            "omsSeries",
            "omsNumber",
            "omsIssuer",
            "omsIssueDate",
            "snils",
        ],
    },
    {
        "id": "patient",
        "title": "Пациент",
        "description": "Строки 6–12 заполняются по сведениям формы № 025/у (п. 9.6).",
        "fieldIds": [
            "surname",
            "firstName",
            "patronymic",
            "patientSex",
            "patientBirthDate",
            "idDocType",
            "idDocSeries",
            "idDocNumber",
            "citizenship",
            "localityType",
        ],
    },
    {
        "id": "residence",
        "title": "Регистрация по месту жительства",
        "fieldIds": _address("residence"),
    },
    {"id": "stay", "title": "Регистрация по месту пребывания", "fieldIds": _address("stay")},
    {
        "id": "employment",
        "title": "Занятость и инвалидность",
        "fieldIds": ["employment", "workplace", "disability", "disabilityGroup"],
    },
    {
        "id": "appeal",
        "title": "Обращение",
        "fieldIds": [
            "careType",
            "visitPlace",
            "visitPurposeDisease",
            "visitPurposePrevention",
            "appealPurpose",
            "closedCase",
            "appealKind",
            "result",
            "referral",
            "payment",
        ],
    },
    {"id": "visits", "title": "Даты посещений", "fieldIds": _rows("visitDate", 17)},
    {
        "id": "prelim",
        "title": "Диагноз предварительный (26–31)",
        "description": "Код по МКБ указывается обязательно (п. 9.20).",
        "fieldIds": [
            "prelimDiagnosis",
            "prelimDiagnosisIcd",
            "prelimComplications",
            "prelimComplicationsIcd",
            *_cells("prelimComplications"),
            *_rows("prelimComorbidity", 3, *COMORBIDITY_CELLS),
            "prelimExternalCause",
            "prelimExternalCauseIcd",
            "prelimExtra",
            "prelimSign",
            "prelimDn",
            "prelimTrauma",
        ],
    },
    {
        "id": "final",
        "title": "Заключительный клинический диагноз (32–37)",
        "fieldIds": [
            "finalDiagnosis",
            "finalDiagnosisIcd",
            "finalComplications",
            "finalComplicationsIcd",
            *_cells("finalComplications"),
            *_rows("finalComorbidity", 3, *COMORBIDITY_CELLS),
            "finalExternalCause",
            "finalExternalCauseIcd",
            "finalExtra",
            "finalSign",
            "finalDn",
            "finalTrauma",
        ],
    },
    {
        "id": "operation",
        "title": "Операции и вмешательства (38–43)",
        "fieldIds": [
            "operationName",
            "operationCode",
            "anesthesia",
            "apparatus",
            "operationDoctorPosition",
            "operationDoctorName",
            "operationDoctorCode",
            *_rows("intervention", 4, "", "Qty", "Code"),
            "interventionDoctorPosition",
            "interventionDoctorName",
            "interventionDoctorCode",
        ],
    },
    {
        "id": "prescriptions",
        "title": "Рецепты (44)",
        "description": "Для пациентов, имеющих право на набор социальных услуг (п. 9.35).",
        "fieldIds": [
            f"prescription{index}{suffix}"
            for index in (1, 2, 3)
            for suffix in (
                "Date",
                "Series",
                "Number",
                "Name",
                "Benefit",
                "Form",
                "Dose",
                "Qty",
                "Icd",
                "DoctorCode",
            )
        ],
    },
    {
        "id": "tempDisability",
        "title": "Временная нетрудоспособность (45–49)",
        "fieldIds": [
            "tempDocKind",
            "tempReason",
            "tempCareRecipient",
            "tempIssueDate",
            *_rows("tempExtension", 6),
            "tempCloseDate",
        ],
    },
    {
        "id": "close",
        "title": "Закрытие талона и врач (50–51)",
        "description": "Подпись врача ставится на бумажном талоне.",
        "fieldIds": ["closeDate", "doctorPosition", "doctorName"],
    },
]


# ------------------------------------------------------------------------------- print layout


def _line(*segments: dict[str, Any], **kw: Any) -> dict[str, Any]:
    return row(*segments, **kw)


def _item(label: str, field_id: str, length: float) -> dict[str, Any]:
    return _line(text(label), blank(field_id, length, grow=True))


def _opt(label: str, field_id: str, separator: str = ", ") -> dict[str, Any]:
    return _line(text(label), options(field_id, separator))


def _single(block_id: str, rows: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"id": block_id, "columns": [{"widthPercent": 100, "rows": rows}], **extra}


def _comorbidity_lines(prefix: str, number: str) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for index in range(1, 4):
        lead = [text(f"{number} Сопутствующие заболевания:")] if index == 1 else []
        lines.append(
            _line(
                *lead,
                blank(f"{prefix}{index}", 30, grow=True),
                text("код по МКБ"),
                blank(f"{prefix}{index}Icd", 8),
                text("признак"),
                blank(f"{prefix}{index}Sign", 5),
                text("ДН"),
                blank(f"{prefix}{index}Dn", 5),
                text("снят с ДН"),
                blank(f"{prefix}{index}DnOff", 6),
            )
        )
    return lines


def _diagnosis_block(
    block_id: str,
    number: str,
    title: str,
    prefix: str,
    items: tuple[str, str, str, str, str, str, str, str],
    *,
    first_field: str,
    first_icd: str,
    complications: str,
    complications_icd: str,
    external: str,
    external_icd: str,
    extra: str,
    sign: str,
    dn: str,
    trauma: str,
) -> dict[str, Any]:
    n_main, n_compl, n_comorb, n_ext, n_extra, n_sign, n_dn, n_trauma = items
    rows: list[dict[str, Any]] = [
        _line(
            text(f"{n_main} {title}"),
            blank(first_field, 30, grow=True),
            text("код по МКБ"),
            blank(first_icd, 10),
        ),
        _line(
            text(f"{n_compl} Осложнения основанного заболевания:"),
            blank(complications, 30, grow=True),
            text("код по МКБ"),
            blank(complications_icd, 8),
            text("признак"),
            blank(f"{complications}Sign", 5),
            text("ДН"),
            blank(f"{complications}Dn", 5),
            text("снят с ДН"),
            blank(f"{complications}DnOff", 6),
        ),
        *_comorbidity_lines(prefix, n_comorb),
        _line(
            text(f"{n_ext} Внешняя причина (при наличии травм и отравлений)"),
            blank(external, 30, grow=True),
            text("код по МКБ"),
            blank(external_icd, 10),
        ),
        _line(
            text(f"{n_extra} Дополнительные сведения о заболевании"),
            blank(extra, 30, grow=True, lines=1),
        ),
        _opt(f"{n_sign} Заболевание основное (признак):", sign, ", "),
        _opt(f"{n_dn} Диспансерное наблюдение по основному заболеванию:", dn, ", "),
        _opt(f"{n_trauma} Травма:", trauma, ", "),
    ]
    return _single(block_id, rows, framed=True)


def _date_row(label: str, field_id: str) -> list[dict[str, Any]]:
    return [text(label), *date_blanks(field_id, month_length=8), text("г.")]


LAYOUT: Final[dict[str, Any]] = {
    "page": {
        "size": "A4",
        "orientation": "landscape",
        "marginMm": {"top": 7, "right": 8, "bottom": 7, "left": 8},
        "fontSizePt": 9.5,
    },
    "blocks": [
        {
            "id": "header",
            "columns": [
                {
                    "widthPercent": 60,
                    "align": "left",
                    "rows": [
                        row(
                            text(
                                "Наименование и адрес медицинской организации (фамилия, имя, "
                                "отчество (при наличии) индивидуального предпринимателя и адрес "
                                "осуществления медицинской деятельности)"
                            ),
                            size="small",
                        ),
                        row(blank("organization", 40, grow=True)),
                        row(
                            text(
                                "Основной государственный регистрационный номер (Основной "
                                "государственный регистрационный номер индивидуального "
                                "предпринимателя)"
                            ),
                            size="small",
                            gap="small",
                        ),
                        row(blank("organizationOgrn", 40, grow=True)),
                    ],
                },
                {
                    "widthPercent": 40,
                    "align": "center",
                    "rows": [
                        row(text("Медицинская документация"), size="small"),
                        row(text("Учетная форма № 025-1/у"), size="small"),
                        row(
                            text(
                                "Утверждена приказом Министерства здравоохранения Российской "
                                "Федерации от 13 мая 2025 г. № 274н"
                            ),
                            size="small",
                        ),
                    ],
                },
            ],
        },
        _single(
            "title",
            [
                _line(
                    text(
                        "ТАЛОН ПАЦИЕНТА, ПОЛУЧАЮЩЕГО МЕДИЦИНСКУЮ ПОМОЩЬ В АМБУЛАТОРНЫХ УСЛОВИЯХ, №",
                        bold=True,
                    ),
                    blank("talonNumber", 16),
                    align="center",
                    size="title",
                    gap="medium",
                )
            ],
        ),
        _single(
            "items",
            [
                _line(*_date_row("1. Дата открытия талона:", "openDate")),
                _item(
                    "1.1. Номер медицинской карты пациента, получающего помощь в "
                    "амбулаторных условиях",
                    "cardNumber",
                    20,
                ),
                _item("1.2. Номер участка (при наличии)", "areaNumber", 20),
                _line(
                    text("2. Код меры социальной поддержки"),
                    blank("socialSupportCode", 10),
                    text("3. Установлена до"),
                    *date_blanks("socialSupportUntil", month_length=8),
                    text("г."),
                ),
                _line(
                    text("4. Полис обязательного медицинского страхования: серия"),
                    blank("omsSeries", 12),
                    text("№"),
                    blank("omsNumber", 16),
                    text("выдан"),
                    blank("omsIssuer", 20, grow=True),
                    text(", дата выдачи"),
                    *date_blanks("omsIssueDate", month_length=8),
                    text("г."),
                ),
                _item("5. Страховой номер индивидуального лицевого счёта", "snils", 22),
                _line(
                    text("6. Фамилия"),
                    blank("surname", 18),
                    text("7. Имя"),
                    blank("firstName", 18),
                    text("8. Отчество (при наличии)"),
                    blank("patronymic", 18),
                    text("9. Пол:"),
                    options("patientSex"),
                ),
                _line(
                    text("10. Дата рождения:"),
                    *date_blanks("patientBirthDate", month_length=8),
                    text("г. 10.1. Документ, удостоверяющий личность"),
                    blank("idDocType", 14),
                    text("серия"),
                    blank("idDocSeries", 8),
                    text("№"),
                    blank("idDocNumber", 10),
                    text("гражданство"),
                    blank("citizenship", 12),
                ),
                _line(
                    text("11. Регистрация по месту жительства: субъект Российской Федерации"),
                    blank("residenceSubject", 14),
                    text("район"),
                    blank("residenceDistrict", 14),
                    text("населенный пункт"),
                    blank("residenceLocality", 14),
                    text("улица"),
                    blank("residenceStreet", 12),
                ),
                _line(
                    text("дом"),
                    blank("residenceHouse", 6),
                    text("строение/корпус"),
                    blank("residenceBuilding", 6),
                    text("квартира"),
                    blank("residenceApartment", 8),
                    text("тел."),
                    blank("residencePhone", 14),
                ),
                _line(
                    text("11.1. Регистрация по месту пребывания: субъект Российской Федерации"),
                    blank("staySubject", 14),
                    text("район"),
                    blank("stayDistrict", 14),
                    text("населенный пункт"),
                    blank("stayLocality", 14),
                    text("улица"),
                    blank("stayStreet", 12),
                    text("дом"),
                    blank("stayHouse", 6),
                ),
                _line(
                    text("строение/корпус"),
                    blank("stayBuilding", 6),
                    text("квартира"),
                    blank("stayApartment", 8),
                    text("тел."),
                    blank("stayPhone", 14),
                ),
                _opt("12. Местность:", "localityType"),
                _opt("13. Занятость:", "employment"),
                _item("14. Место работы, учебы", "workplace", 40),
                _line(
                    text("15. Инвалидность: установлена"),
                    options("disability"),
                    text("16. Группа инвалидности:"),
                    options("disabilityGroup"),
                ),
                _opt("17. Оказываемая медицинская помощь:", "careType"),
                _opt("18. Место обращения (посещения):", "visitPlace"),
                _line(text("19. Посещение (цель):")),
                _line(options("visitPurposeDisease", ", ")),
                _line(options("visitPurposePrevention", ", ")),
                _opt("20. Обращение (цель):", "appealPurpose"),
                _opt("21. Обращение (законченный случай лечения):", "closedCase"),
                _opt("22. Обращение:", "appealKind"),
                _line(text("23. Результат обращения:")),
                _opt("23.1.", "result"),
                _opt("23.2. Дано направление для оказания медицинской помощи:", "referral"),
                _opt("24. Основной вид оплаты:", "payment"),
                {
                    "segments": [
                        {
                            "kind": "table",
                            "header": [],
                            "rows": [
                                [{"text": "25. Даты посещений"}]
                                + [f"visitDate{index}" for index in range(1, 9)],
                                [f"visitDate{index}" for index in range(9, 18)],
                            ],
                        }
                    ]
                },
            ],
            framed=True,
        ),
        {
            "id": "back-title",
            "pageBreakBefore": True,
            "columns": [
                {
                    "widthPercent": 100,
                    "align": "right",
                    "rows": [
                        row(text("2"), align="center"),
                        row(text("оборотная сторона формы № 025-1/у"), align="right"),
                    ],
                }
            ],
        },
        _diagnosis_block(
            "prelim",
            "26",
            "Диагноз предварительный",
            "prelimComorbidity",
            ("26.", "26.1.", "26.2.", "27.", "28.", "29.", "30.", "31."),
            first_field="prelimDiagnosis",
            first_icd="prelimDiagnosisIcd",
            complications="prelimComplications",
            complications_icd="prelimComplicationsIcd",
            external="prelimExternalCause",
            external_icd="prelimExternalCauseIcd",
            extra="prelimExtra",
            sign="prelimSign",
            dn="prelimDn",
            trauma="prelimTrauma",
        ),
        _diagnosis_block(
            "final",
            "32",
            "Заключительный клинический диагноз: основное заболевание",
            "finalComorbidity",
            ("32.", "32.1.", "32.2.", "33.", "34.", "35.", "36.", "37."),
            first_field="finalDiagnosis",
            first_icd="finalDiagnosisIcd",
            complications="finalComplications",
            complications_icd="finalComplicationsIcd",
            external="finalExternalCause",
            external_icd="finalExternalCauseIcd",
            extra="finalExtra",
            sign="finalSign",
            dn="finalDn",
            trauma="finalTrauma",
        ),
        _single(
            "operation",
            [
                _line(
                    text("38. Наименование операции:"),
                    blank("operationName", 40, grow=True),
                    text("код*"),
                    blank("operationCode", 14),
                ),
                _opt("39. Анестезия:", "anesthesia"),
                _opt("40. Операция проведена с использованием аппаратуры:", "apparatus"),
                _line(
                    text("41. Врач: должность, специальность"),
                    blank("operationDoctorPosition", 20, grow=True),
                    text("фамилия, имя, отчество (при наличии)"),
                    blank("operationDoctorName", 24, grow=True),
                    text("код"),
                    blank("operationDoctorCode", 8),
                ),
                _line(
                    text("42. Иные медицинские вмешательства, в том числе с целью исследования:"),
                    blank("intervention1", 20, grow=True),
                    text("кол-во"),
                    blank("intervention1Qty", 6),
                    text("код"),
                    blank("intervention1Code", 14),
                ),
                _line(
                    text("в том числе лабораторные, инструментальные и лучевые"),
                    blank("intervention2", 20, grow=True),
                    text("кол-во"),
                    blank("intervention2Qty", 6),
                    text("код"),
                    blank("intervention2Code", 14),
                ),
                _line(
                    blank("intervention3", 20, grow=True),
                    text("кол-во"),
                    blank("intervention3Qty", 6),
                    text("код"),
                    blank("intervention3Code", 14),
                ),
                _line(
                    blank("intervention4", 20, grow=True),
                    text("кол-во"),
                    blank("intervention4Qty", 6),
                    text("код"),
                    blank("intervention4Code", 14),
                ),
                _line(
                    text("43. Врач: должность, специальность"),
                    blank("interventionDoctorPosition", 20, grow=True),
                    text("фамилия, имя, отчество (при наличии)"),
                    blank("interventionDoctorName", 24, grow=True),
                    text("код"),
                    blank("interventionDoctorCode", 8),
                ),
            ],
            framed=True,
        ),
        _single(
            "prescriptions",
            [
                _line(
                    text(
                        "44. Рецепты на лекарственные препараты, специализированные продукты "
                        "лечебного питания, медицинские изделия:"
                    )
                ),
                {
                    "segments": [
                        {
                            "kind": "table",
                            "header": [
                                [
                                    {"text": "Дата", "rowSpan": 2},
                                    {"text": "Рецепт", "colSpan": 2},
                                    {
                                        "text": (
                                            "Наименование лекарственного препарата, "
                                            "специализированных продуктов лечебного питания, "
                                            "медицинских изделий"
                                        ),
                                        "rowSpan": 2,
                                    },
                                    {"text": "Льгота (%)", "rowSpan": 2},
                                    {"text": "Лек. форма", "rowSpan": 2},
                                    {"text": "Доза", "rowSpan": 2},
                                    {"text": "Кол-во", "rowSpan": 2},
                                    {"text": "Код МКБ", "rowSpan": 2},
                                    {"text": "Код врача", "rowSpan": 2},
                                ],
                                [{"text": "серия"}, {"text": "номер"}],
                            ],
                            "rows": [
                                [
                                    f"prescription{index}{suffix}"
                                    for suffix in (
                                        "Date",
                                        "Series",
                                        "Number",
                                        "Name",
                                        "Benefit",
                                        "Form",
                                        "Dose",
                                        "Qty",
                                        "Icd",
                                        "DoctorCode",
                                    )
                                ]
                                for index in (1, 2, 3)
                            ],
                            "columnWeights": [7, 6, 6, 22, 7, 8, 7, 7, 8, 9],
                        }
                    ]
                },
            ],
        ),
        _single(
            "temp-disability",
            [
                _line(
                    text("45. Документ о временной нетрудоспособности:"),
                    options("tempDocKind"),
                ),
                _line(
                    text("46. Повод выдачи:"),
                    options("tempReason"),
                    text("(фамилия, имя, отчество (при наличии), пол, возраст"),
                    blank("tempCareRecipient", 24, grow=True),
                    text(")"),
                ),
                _line(*_date_row("47. Дата выдачи:", "tempIssueDate")),
                _line(
                    text("48. Даты продления:"),
                    *[
                        segment
                        for index in range(1, 7)
                        for segment in (
                            *date_blanks(f"tempExtension{index}", month_length=6),
                            text("г."),
                        )
                    ],
                ),
                _line(
                    *_date_row(
                        "49. Дата закрытия документа о временной нетрудоспособности:",
                        "tempCloseDate",
                    )
                ),
                _line(*_date_row("50. Дата закрытия талона:", "closeDate")),
                _line(
                    text("51. Врач: должность, специальность"),
                    blank("doctorPosition", 20, grow=True),
                    text("фамилия, имя, отчество (при наличии), подпись"),
                    blank("doctorName", 24, grow=True),
                    signature("doctorSignature", 12),
                ),
            ],
            framed=True,
        ),
    ],
}

NOTES: Final[list[str]] = [
    "Подписи полей в повторяющихся строках («(1)», «(2)»), пояснения в скобках и уточнения "
    "«обратный талон»/«заключение» добавлены для различения полей; напечатанные подписи "
    "проверяются по OCR бланка (blankLabelsVerified).",
    "Бланк 025-1/у (приложение № 3) — альбомный лист, печатается с двух сторон: лицевая сторона "
    "(строки 1–25) и оборотная (строки 26–51); на печати оборотная сторона начинается с новой "
    "страницы. Скан бланка в официальном PDF повёрнут на 90°.",
    "Строки бланка называются номерами (1, 1.1, …, 51); варианты ответов — легенды, напечатанные "
    "в самой строке. Напечатанное в бланке подчёркивание ответа заменено выбором.",
    "Строка 19 «Посещение (цель)» разбита на два поля по двум напечатанным вариантам (1 и 2) "
    "со своими подпунктами; в каждом можно отметить несколько кодов.",
    "Строки 6–8 (фамилия, имя, отчество) подставляются из полного ФИО пациента по словам "
    "(привязка `words` в схеме); отчество — всё, что следует за вторым словом.",
    "Строки 10.1 и 11.1 напечатаны на бланке, но п. 9.6 порядка перечисляет только строки 6–12 "
    "(rule.status = undefined). Графы «признак», «ДН», «снят с ДН» у сопутствующих заболеваний "
    "порядок не описывает; их варианты взяты из легенд строк 29–30 бланка.",
    "Таблица рецептов (строка 44) и таблица дат посещений (строка 25) печатаются как таблицы; "
    "рецептов на бланке три строки, дат посещений семнадцать ячеек (восемь в первой строке "
    "таблицы после подписи «25. Даты посещений» и девять во второй), вмешательств (строка 42) "
    "четыре строки, сопутствующих заболеваний (26.2 и 32.2) по три строки, как напечатано.",
    "Графы «признак», «ДН», «снят с ДН» напечатаны у осложнений (26.1, 32.1) и у каждой строки "
    "сопутствующих заболеваний; код по МКБ напечатан у строк 26, 26.1, 27, 32, 32.1, 33 и "
    "у каждой строки сопутствующих заболеваний. Привязка граф к строкам прочитана по скану, "
    "повёрнутому и слегка перекошенному.",
    "В печатном тексте п. 9.21 после номера пропущена точка; в схеме она восстановлена и "
    "записана в `source.extraction.corrections`, чтобы абзац находился по номеру.",
    "«код*» у строки 39 напечатан на бланке со звёздочкой без сноски; в схеме он привязан к "
    "наименованию операции (п. 9.31 называет код операции).",
    "Обязательность полей (required) порядок прямо не задаёт: basis = source — пункт говорит, "
    "что строка «указывается»; незаполненные обязательные поля подсвечиваются, печать не "
    "блокируется.",
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
    blank_appendix=3,
    blank_pages=(19, 20),
    rules_appendix=4,
    rules_pages=(21, 22, 23, 24, 25, 26, 27, 28),
    footnote_below=dict(FOOTNOTE_BELOW),
    corrections=CORRECTIONS,
    fields=FIELDS,
    code_lists=dict(CODE_LISTS),
    sequential_lists=dict(SEQUENTIAL_LISTS),
    sections=SECTIONS,
    layout=LAYOUT,
    notes=NOTES,
    row_corrections=ROW_CORRECTIONS,
    scan_reviewed_captions=SCAN_REVIEWED,
)
