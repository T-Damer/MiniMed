"""Reviewed blueprint of form 058/у «Экстренное извещение о случае инфекционной, паразитарной
болезни и носительства возбудителей инфекционных болезней, пищевого отравления, укуса или удара,
нанесенного животным» (order of Минздрав России of 20.08.2026 № 740н, Минюст 16.09.2026 № 88291,
eoNumber 0001202609170010).

PDF page 1 is the order itself, pages 2–3 are appendix 1 (the blank: two sheets), pages 4–9 are
appendix 2 («Порядок ведения»). The order enters into force on 1 March 2027 and acts until
1 March 2033 (clause 2 of the order, PDF page 1): the form in use today has no source on the
portal and is not built, so this schema describes the form **not yet in force**
(`source.effectiveFrom` = 2027-03-01).

The blueprint is the human-reviewed reading of the scanned blank: the printed captions, the lines
as printed (one layout row per printed line, blank lengths in underscores of the 12 pt original,
measured from the strokes of the scan), and the binding of every field to the paragraph of the
«Порядок» that governs it (the order numbers the filling rules «10.1.» … «10.12.», «11.»).
`medical_forms.prepare_form` checks each printed caption against the OCR text of the blank pages
and cuts every cited paragraph from the OCR text of the order.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    ICD10_MESSAGE,
    ICD10_PATTERN,
    SNILS_PATTERN,
    blank,
    field_def,
    field_rule,
    options,
    row,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.740n.058u"
FORM_NUMBER: Final = "058/у"
FORM_TITLE: Final = (
    "Экстренное извещение о случае инфекционной, паразитарной болезни и носительства "
    "возбудителей инфекционных болезней, пищевого отравления, укуса или удара, нанесенного "
    "животным"
)
ORDER_NUMBER: Final = "740н"
ORDER_DATE: Final = "2026-08-20"
ORDER_TITLE: Final = (
    "Об утверждении учетной формы № 058/у «Экстренное извещение о случае инфекционной, "
    "паразитарной болезни и носительства возбудителей инфекционных болезней, пищевого "
    "отравления, укуса или удара, нанесенного животным» и порядка ее ведения"
)
REGISTRATION: Final = {
    "authority": "Министерство юстиции Российской Федерации",
    "number": "88291",
    "date": "2026-09-16",
}
# Clause 2 of the order: «вступает в силу с 1 марта 2027 г. и действует до 1 марта 2033 г.»
EFFECTIVE_FROM: Final = "2027-03-01"
EFFECTIVE_UNTIL: Final = "2033-03-01"
EDITION_NOTE: Final = "вступает в силу 01.03.2027 (п. 2 приказа); до этой даты форма не действует"
BLANK_APPENDIX: Final = 1
BLANK_PAGES: Final = (2, 3)
RULES_APPENDIX: Final = 2
RULES_PAGES: Final = (4, 5, 6, 7, 8, 9)

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {4: 0.14, 5: 0.225, 6: 0.2, 7: 0.09, 8: 0.15, 9: 0.3}

_FOOTNOTE_MARK = "footnote reference mark recognised as punctuation"
_LOST_WORD = "short word at the start of a printed line lost by the OCR"
_CAPITAL = "capital letter recognised for a lower-case word"
_EN_DASH = "en dash printed in the running text (checked on the scan), recognised as a hyphen"
_STRAY = "stray mark of the scan read as a letter"
_LOST_PERIOD = "period after a footnote reference lost by the OCR"
CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(6, "в м отношении", "в отношении", _STRAY),
    Correction(6, "медицинскаю", "медицинскую", "OCR confuses у and ю"),
    Correction(6, " - ", " – ", _EN_DASH),
    Correction(7, " - ", " – ", _EN_DASH),
    Correction(7, "лет) , , неработающих", "лет), неработающих", _FOOTNOTE_MARK),
    Correction(8, "иное. строке", "иное. В строке", _LOST_WORD),
    Correction(8, "23- 27", "23–27", _EN_DASH),
    Correction(9, "мероприятия дополнительные", "мероприятия и дополнительные", _LOST_WORD),
    Correction(
        9,
        "непищевым сырьем животного происхождения",
        "непищевым сырьем животного происхождения.",
        _LOST_PERIOD,
    ),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = ()
SCAN_REVIEWED: Final[tuple[str, ...]] = ()

_UNDEFINED_NOTE_SENT: Final = (
    "Порядок (п. 10.12) описывает только дату и время информирования территориального органа "
    "(строка 17); строку «отправка экстренного извещения» он не называет."
)
_BY_LINE_ACTUAL: Final = (
    "Строка «Адрес фактического проживания» напечатана под строкой {line}; п. 10.4 называет "
    "только строки 7 и 7.1 целиком, части адреса отдельно порядок не определяет."
)
_BY_LINE_ADDRESS: Final = (
    "Пункт 10.4 называет строку {line} целиком; её части (район, улица, дом и др.) порядок "
    "отдельно не определяет."
)

MARK_RULE: Final = "5"  # the order: answers are marked by underlining the offered variants


def _choice(
    field_id: str,
    label: str,
    anchor: str,
    paragraph: str,
    items: list[tuple[str, str]],
    *,
    required: bool = False,
    printed: bool = True,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "choice",
        field_rule("defined", paragraph, MARK_RULE),
        required=required,
        printed=printed,
        anchor=anchor,
        options=[{"value": value, "label": name} for value, name in items],
    )


def _date(
    field_id: str,
    label: str,
    anchor: str,
    paragraph: str,
    *,
    required: bool = False,
    prefill: dict[str, Any] | None = None,
    printed: bool = True,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "date",
        field_rule("defined", paragraph),
        required=required,
        printed=printed,
        anchor=anchor,
        prefill=prefill,
        notAfter="today",
    )


def _text(
    field_id: str,
    label: str,
    anchor: str,
    paragraph: str,
    *,
    required: bool = False,
    prefill: dict[str, Any] | None = None,
    printed: bool = True,
    max_length: int = 300,
    multiline: bool = False,
    **extra: Any,
) -> dict[str, Any]:
    if multiline:
        extra["multiline"] = True
    return field_def(
        field_id,
        label,
        "text",
        field_rule("defined", paragraph),
        required=required,
        printed=printed,
        anchor=anchor,
        prefill=prefill,
        maxLength=max_length,
        **extra,
    )


ADDRESS_PARTS: Final = (
    ("Subject", "субъект Российской Федерации", "subject", 70),
    ("District", "район", "district", 52),
    ("Locality", "населенный пункт", "locality", 28),
    ("Street", "улица", "street", 27),
    ("House", "дом", "house", 10),
    ("Building", "корпус", "building", 10),
    ("Apartment", "квартира", "apartment", 10),
)


def _address(
    prefix: str,
    caption: str,
    path: str | None,
    note: str,
    *,
    required: bool = False,
) -> list[dict[str, Any]]:
    """The seven blanks of one address line group of items 7 and 7.1 (no phone on this blank)."""
    by_line = field_rule("by-line", "10.4", note=note)
    fields: list[dict[str, Any]] = []
    for suffix, label, part, length in ADDRESS_PARTS:
        fields.append(
            field_def(
                f"{prefix}{suffix}",
                f"{caption}: {label}",
                "text",
                by_line,
                required=required and suffix in ("Subject", "Locality"),
                basis="editorial",
                anchor=label,
                prefill={"sources": [f"patient.{path}.{part}"]} if path else None,
                maxLength=length,
            )
        )
    return fields


FIELDS: Final[list[dict[str, Any]]] = [
    # ---------------------------------------------------------------- the title sheet (п. 9)
    _text(
        "organization",
        "Наименование и адрес медицинской организации (фамилия, имя, отчество (при наличии) "
        "индивидуального предпринимателя и адрес осуществления медицинской деятельности)",
        "Наименование и адрес медицинской организации",
        "9",
        required=True,
        prefill={"sources": ["organization.name", "organization.address"], "join": ", "},
        max_length=400,
        multiline=True,
    ),
    _text(
        "organizationOgrn",
        "Основной государственный регистрационный номер (Основной государственный "
        "регистрационный номер индивидуального предпринимателя)",
        "Основной государственный регистрационный номер",
        "9",
        required=True,
        prefill={"sources": ["organization.ogrn"]},
        max_length=15,
        pattern="^(?:[0-9]{13}|[0-9]{15})$",
        patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
    ),
    _text(
        "formNumber",
        "Регистрационный номер экстренного извещения (№ в заголовке)",
        "НАНЕСЕННОГО ЖИВОТНЫМ №",
        "9",
        required=True,
        printed=False,
        max_length=40,
    ),
    _date(
        "formDate",
        "Дата заполнения экстренного извещения",
        "Дата заполнения экстренного извещения: число месяц год",
        "9",
        required=True,
        prefill={"sources": ["today"]},
    ),
    # ----------------------------------------------------------------- items 1–3 (п. 10.1–10.3)
    _text(
        "diagnosis",
        "Диагноз",
        "1. Диагноз",
        "10.1",
        required=True,
        prefill={"sources": ["episode.diagnosis.text"]},
        multiline=True,
    ),
    field_def(
        "diagnosisIcd",
        "Диагноз: код по МКБ",
        "icd10",
        field_rule("defined", "10.1"),
        required=True,
        anchor="код по МКБ",
        prefill={"sources": ["episode.diagnosis.icd10"]},
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
    ),
    _text(
        "externalCause",
        "Внешняя причина (при травмах)",
        "Внешняя причина (при травмах)",
        "10.1",
        multiline=True,
    ),
    field_def(
        "externalCauseIcd",
        "Внешняя причина (при травмах): код по МКБ",
        "icd10",
        field_rule("defined", "10.1"),
        anchor="код по МКБ",
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
    ),
    _choice(
        "diagnosisKind",
        "Диагноз: предварительный или заключительный (1.1)",
        "1.1. Предварительный – 1, заключительный – 2",
        "10.1",
        [("1", "Предварительный"), ("2", "заключительный")],
        required=True,
        printed=False,
    ),
    _choice(
        "labConfirmed",
        "Лабораторное подтверждение",
        "Лабораторное подтверждение: да – 1, нет – 2",
        "10.1",
        [("1", "да"), ("2", "нет")],
        required=True,
    ),
    _choice(
        "noticeKind",
        "Извещение",
        "Извещение: первичное – 1, повторное – 2",
        "10.2",
        [("1", "первичное"), ("2", "повторное")],
        required=True,
    ),
    _choice(
        "reason",
        "Причина подачи экстренного извещения",
        "Причина подачи экстренного извещения: установление диагноза (подозрение) – 1, "
        "уточнение диагноза – 2, смерть – 3",
        "10.3",
        [
            ("1", "установление диагноза (подозрение)"),
            ("2", "уточнение диагноза"),
            ("3", "смерть"),
        ],
        required=True,
    ),
    # ------------------------------------------------------- items 4–9 (п. 10.4, 10.5)
    _text(
        "patientFullName",
        "Фамилия, имя, отчество (при наличии) пациента",
        "Фамилия, имя, отчество (при наличии) пациента",
        "10.4",
        required=True,
        prefill={"sources": ["patient.fullName"]},
        max_length=200,
    ),
    field_def(
        "patientSex",
        "Пол",
        "choice",
        field_rule("defined", "10.4", MARK_RULE),
        required=True,
        prefill={"sources": ["patient.sex"], "map": {"male": "1", "female": "2"}},
        options=[{"value": "1", "label": "мужской"}, {"value": "2", "label": "женский"}],
        anchor="Пол: мужской – 1, женский – 2",
    ),
    _date(
        "patientBirthDate",
        "Дата рождения",
        "Дата рождения: число месяц год",
        "10.4",
        required=True,
        prefill={"sources": ["patient.birthDate"]},
    ),
    *_address(
        "residence",
        "Регистрация по месту жительства",
        "address",
        _BY_LINE_ADDRESS.format(line="7 «Регистрация по месту жительства»"),
        required=True,
    ),
    *_address(
        "residenceActual",
        "Адрес фактического проживания (к регистрации по месту жительства)",
        None,
        _BY_LINE_ACTUAL.format(line="7"),
    ),
    *_address(
        "stay",
        "Регистрация по месту пребывания",
        "stayAddress",
        _BY_LINE_ADDRESS.format(line="7.1 «Регистрация по месту пребывания»"),
    ),
    *_address(
        "stayActual",
        "Адрес фактического проживания (к регистрации по месту пребывания)",
        None,
        _BY_LINE_ACTUAL.format(line="7.1"),
    ),
    _text(
        "citizenship",
        "гражданство (для иностранных граждан)",
        "гражданство",
        "10.4",
        max_length=120,
    ),
    _date(
        "entryDate",
        "дата въезда в Российскую Федерацию",
        "дата въезда в Российскую Федерацию: число месяц год",
        "10.4",
    ),
    _text(
        "snils",
        "Страховой номер индивидуального лицевого счета (при наличии)",
        "Страховой номер индивидуального лицевого счета (при наличии)",
        "10.4",
        prefill={"sources": ["patient.snils"]},
        max_length=14,
        pattern=SNILS_PATTERN,
        patternMessage="СНИЛС в формате 123-456-789 01",
    ),
    _text(
        "patientPhone",
        "Контактный телефон (при наличии)",
        "Контактный телефон (при наличии)",
        "10.5",
        prefill={"sources": ["patient.address.phone"]},
        max_length=60,
    ),
    # ------------------------------------------------------------ item 10 (п. 10.6)
    _choice(
        "occupation",
        "Занятость",
        "Занятость: работает – 1, обучающийся – 2, отдыхающий – 3, получатель социальных "
        "услуг – 4, не работает – 5, прочее – 6",
        "10.6",
        [
            ("1", "работает"),
            ("2", "обучающийся"),
            ("3", "отдыхающий"),
            ("4", "получатель социальных услуг"),
            ("5", "не работает"),
            ("6", "прочее"),
        ],
        required=True,
    ),
    _choice(
        "occupationChild",
        "Для детей",
        "Для детей: дошкольник, организован – 7, дошкольник, не организован – 8, школьник – 9",
        "10.6",
        [
            ("7", "дошкольник, организован"),
            ("8", "дошкольник, не организован"),
            ("9", "школьник"),
        ],
    ),
    _text(
        "workplace",
        "Место работы (службы), обучения, отдыха, нахождения в санаторно-курортной "
        "организации, в организации, осуществляющей стационарное или полустационарное "
        "социальное обслуживание",
        "Место работы (службы), обучения, отдыха, нахождения в санаторно-курортной организации, "
        "в организации, осуществляющей стационарное или полустационарное социальное обслуживание",
        "10.6",
        prefill={"sources": ["patient.workplace"]},
        multiline=True,
    ),
    _text(
        "studyGroup",
        "Факультет, курс, группа, класс, иное",
        "Факультет, курс, группа, класс, иное",
        "10.6",
    ),
    _text(
        "jobDuties",
        "Выполняемые виды работ (для работающего)",
        "Выполняемые виды работ (для работающего)",
        "10.6",
        multiline=True,
    ),
    _text(
        "occupationExtra",
        "Дополнительные сведения",
        "Дополнительные сведения",
        "10.6",
        multiline=True,
    ),
    # ------------------------------------------------------------ item 11 (п. 10.7)
    _date(
        "onsetDate",
        "Дата заболевания (со слов пациента/законного представителя пациента)",
        "заболевания (со слов пациента/законного представителя пациента)",
        "10.7",
        required=True,
    ),
    _date(
        "firstVisitDate",
        "Дата первичного обращения к врачу-специалисту (фельдшеру, акушеру (акушерке) по "
        "поводу данного заболевания (при наличии сведений)",
        "первичного обращения к врачу-специалисту (фельдшеру, акушеру (акушерке) по поводу "
        "данного заболевания (при наличии сведений)",
        "10.7",
    ),
    _date(
        "diagnosisDate",
        "Дата установления диагноза",
        "установления диагноза",
        "10.7",
        required=True,
    ),
    _date(
        "lastVisitDate",
        "Дата последнего посещения места работы (службы), обучения, отдыха, нахождения в "
        "санаторно-курортной организации, организации, осуществляющей стационарное или "
        "полустационарное социальное обслуживание (со слов пациента/законного представителя "
        "пациента)",
        "последнего посещения места работы (службы), обучения, отдыха, нахождения в "
        "санаторно-курортной организации, организации, осуществляющей стационарное или "
        "полустационарное социальное обслуживание (со слов пациента/законного представителя "
        "пациента)",
        "10.7",
    ),
    _date(
        "hospitalizationDate",
        "Дата госпитализации (при наличии сведений)",
        "госпитализации (при наличии сведений)",
        "10.7",
    ),
    _text(
        "hospitalizationPlace",
        "место госпитализации (при наличии сведений)",
        "место госпитализации",
        "10.7",
        multiline=True,
    ),
    _date("deathDate", "Дата смерти", "смерти: число месяц год", "10.7"),
    # ------------------------------------------------------------ item 12 (п. 10.8)
    _choice(
        "biter",
        "кем укушен",
        "кем укушен: животное – 1, клещ – 2",
        "10.8",
        [("1", "животное"), ("2", "клещ")],
    ),
    _choice(
        "animalKind",
        "Животное: домашнее или дикое",
        "животное домашнее – 1.1, дикое – 1.2",
        "10.8",
        [("1.1", "домашнее"), ("1.2", "дикое")],
        printed=False,
    ),
    _text(
        "animalSpecies",
        "вид (подвид) животного",
        "вид (подвид) животного",
        "10.8",
    ),
    _choice(
        "injuryKind",
        "характер травмы",
        "характер травмы (укус – 1, удар – 2, оцарапывание – 3, ослюнение – 4, присасывание – 5)",
        "10.8",
        [
            ("1", "укус"),
            ("2", "удар"),
            ("3", "оцарапывание"),
            ("4", "ослюнение"),
            ("5", "присасывание"),
        ],
    ),
    _text("injuryLocation", "локализация травмы", "локализация травмы", "10.8"),
    _text(
        "biteLocation",
        "где укушен (страна, субъект Российской Федерации, населенный пункт)",
        "где укушен",
        "10.8",
    ),
    # ------------------------------------------------------------ item 13 (п. 10.9)
    _text(
        "foodProduct",
        "подозрительный продукт (блюдо) при подозрении на пищевое отравление",
        "При подозрении на пищевое отравление, указать подозрительный продукт (блюдо)",
        "10.9",
    ),
    _text("foodPurchase", "дата и место приобретения", "дата и место приобретения", "10.9"),
    # ------------------------------------------------------- items 14–16 (п. 10.10, 10.11)
    _choice(
        "travelAbroad",
        "Сведения о месте нахождения пациента за последние 30 дней до появления клинических "
        "симптомов заболевания за пределами Российской Федерации или за пределами "
        "населенного пункта фактического пребывания (при наличии)",
        "Сведения о месте нахождения пациента за последние 30 дней до появления клинических "
        "симптомов заболевания за пределами Российской Федерации или за пределами "
        "населенного пункта фактического пребывания (при наличии): да – 1, нет – 2",
        "10.10",
        [("1", "да"), ("2", "нет")],
    ),
    _text(
        "travelPlace",
        "страна/населенный пункт и период пребывания",
        "страна/населенный пункт и период пребывания",
        "10.10",
        multiline=True,
    ),
    _text(
        "contactHistory",
        "Наличие в анамнезе контакта за последние 30 дней с инфекционным больным (человеком "
        "или животным), сырьем животного происхождения (при наличии сведений, перечислить)",
        "Наличие в анамнезе контакта за последние 30 дней с инфекционным больным (человеком "
        "или животным), сырьем животного происхождения (при наличии сведений, перечислить)",
        "10.10",
        multiline=True,
    ),
    _text(
        "measures",
        "Проведенные первичные противоэпидемические мероприятия и дополнительные сведения",
        "Проведенные первичные противоэпидемические мероприятия и дополнительные сведения",
        "10.11",
        multiline=True,
        max_length=1000,
    ),
    # ------------------------------------------------------------ item 17 (п. 10.12)
    _date(
        "informedDate",
        "Информирование территориального органа: дата",
        "Информирование территориального органа федерального органа исполнительной власти, "
        "осуществляющего федеральный государственный санитарно-эпидемиологический контроль "
        "(надзор)",
        "10.12",
        required=True,
    ),
    _text(
        "informedHour",
        "Информирование территориального органа: час",
        "час",
        "10.12",
        required=True,
        max_length=2,
        pattern="^(?:[01]?[0-9]|2[0-3])$",
        patternMessage="Час от 0 до 23",
    ),
    _text(
        "informedMinute",
        "Информирование территориального органа: минута",
        "минута",
        "10.12",
        required=True,
        max_length=2,
        pattern="^[0-5]?[0-9]$",
        patternMessage="Минута от 0 до 59",
    ),
    field_def(
        "sentDate",
        "отправка экстренного извещения",
        "date",
        field_rule("undefined", note=_UNDEFINED_NOTE_SENT),
        anchor="отправка экстренного извещения",
        notAfter="today",
    ),
    # ------------------------------------------------------------ the signatories (п. 11)
    _text(
        "filledByName",
        "Фамилия, имя, отчество (при наличии) лица, заполнившего извещение",
        "Фамилия, имя, отчество (при наличии) лица, заполнившего извещение",
        "11",
        required=True,
        prefill={"sources": ["clinician.fullName"]},
        max_length=200,
    ),
    _text(
        "filledByPosition",
        "Должность лица, заполнившего извещение",
        "должность",
        "11",
        required=True,
        prefill={"sources": ["clinician.position"]},
        max_length=200,
    ),
    _text(
        "acceptedByName",
        "Фамилия, имя, отчество (при наличии) лица, принявшего сообщение",
        "Фамилия, имя, отчество (при наличии) лица, принявшего сообщение",
        "11",
        max_length=200,
    ),
    _text(
        "acceptedRegNumber",
        "Регистрационный № принятого извещения",
        "Регистрационный № принятого извещения",
        "11",
        max_length=40,
    ),
]

# --------------------------------------------------------------------------- screen sections


def _ids(prefix: str) -> list[str]:
    return [f"{prefix}{suffix}" for suffix, *_ in ADDRESS_PARTS]


SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "notice",
        "title": "Извещение",
        "description": (
            "Регистрационный номер и дата заполнения указываются на титульном листе (п. 9)."
        ),
        "fieldIds": ["formNumber", "formDate"],
    },
    {
        "id": "organization",
        "title": "Организация",
        "description": "Подставляется из настроек «Врач и организация».",
        "fieldIds": ["organization", "organizationOgrn"],
    },
    {
        "id": "diagnosis",
        "title": "Диагноз и причина подачи",
        "description": "Строки 1–3 (п. 10.1–10.3).",
        "fieldIds": [
            "diagnosis",
            "diagnosisIcd",
            "externalCause",
            "externalCauseIcd",
            "diagnosisKind",
            "labConfirmed",
            "noticeKind",
            "reason",
        ],
    },
    {
        "id": "patient",
        "title": "Пациент",
        "description": (
            "Строки 4–6, 8, 9: на основании сведений медицинской документации (п. 10.4)."
        ),
        "fieldIds": [
            "patientFullName",
            "patientSex",
            "patientBirthDate",
            "snils",
            "patientPhone",
        ],
    },
    {
        "id": "residence",
        "title": "Регистрация по месту жительства",
        "fieldIds": _ids("residence"),
    },
    {
        "id": "residenceActual",
        "title": "Адрес фактического проживания (к регистрации по месту жительства)",
        "fieldIds": _ids("residenceActual"),
    },
    {
        "id": "stay",
        "title": "Регистрация по месту пребывания",
        "fieldIds": _ids("stay"),
    },
    {
        "id": "stayActual",
        "title": "Адрес фактического проживания (к регистрации по месту пребывания)",
        "fieldIds": _ids("stayActual"),
    },
    {
        "id": "foreign",
        "title": "Для иностранных граждан",
        "description": "Строка 7.2 заполняется для иностранных граждан (п. 10.4).",
        "fieldIds": ["citizenship", "entryDate"],
    },
    {
        "id": "occupation",
        "title": "Занятость",
        "description": "Строка 10 и сведения о месте работы или учёбы (п. 10.6).",
        "fieldIds": [
            "occupation",
            "occupationChild",
            "workplace",
            "studyGroup",
            "jobDuties",
            "occupationExtra",
        ],
    },
    {
        "id": "dates",
        "title": "Даты",
        "description": "Строка 11 (п. 10.7).",
        "fieldIds": [
            "onsetDate",
            "firstVisitDate",
            "diagnosisDate",
            "lastVisitDate",
            "hospitalizationDate",
            "hospitalizationPlace",
            "deathDate",
        ],
    },
    {
        "id": "animal",
        "title": "Укус или удар, нанесенный животным",
        "description": "Строка 12 заполняется при укусе или ударе, в том числе клещом (п. 10.8).",
        "fieldIds": [
            "biter",
            "animalKind",
            "animalSpecies",
            "injuryKind",
            "injuryLocation",
            "biteLocation",
        ],
    },
    {
        "id": "food",
        "title": "Подозрение на пищевое отравление",
        "description": "Строка 13 (п. 10.9).",
        "fieldIds": ["foodProduct", "foodPurchase"],
    },
    {
        "id": "anamnesis",
        "title": "Пребывание, контакты, мероприятия",
        "description": "Строки 14–16 (п. 10.10, 10.11).",
        "fieldIds": ["travelAbroad", "travelPlace", "contactHistory", "measures"],
    },
    {
        "id": "informing",
        "title": "Информирование территориального органа",
        "description": "Строка 17 (п. 10.12).",
        "fieldIds": ["informedDate", "informedHour", "informedMinute", "sentDate"],
    },
    {
        "id": "signatories",
        "title": "Заполнил и принял",
        "description": (
            "П. 11: сведения о медицинском работнике и о сотруднике территориального органа."
        ),
        "fieldIds": ["filledByName", "filledByPosition", "acceptedByName", "acceptedRegNumber"],
    },
]


# ------------------------------------------------------------------------------- print layout


def _flow(*segments: dict[str, Any]) -> dict[str, Any]:
    """One printed paragraph whose picked options wrap inside the line like words."""
    return row(*segments, align="justify")


def _caption(value: str) -> dict[str, Any]:
    """The small italic explanation the blank prints under a ruled line, centred."""
    return row(text(value, small=True), align="center")


def _stretch(*segments: dict[str, Any]) -> dict[str, Any]:
    return row(*segments, align="stretch")


def _date_row(
    prefix: str, field_id: str, lengths: tuple[float, float, float], *, grow_year: bool = False
) -> dict[str, Any]:
    """`число ___ месяц ___ год ___`; `grow_year` when the printed line ends at the margin."""
    day, month, year = lengths
    return row(
        text(prefix),
        blank(field_id, day, part="day"),
        text("месяц"),
        blank(field_id, month, part="month"),
        text("год"),
        blank(field_id, year, part="year", grow=grow_year),
    )


def _address_rows(
    prefix: str,
    registration_caption: str | None,
    lengths: tuple[float, float, float],
    street_lengths: tuple[float, float, float, float],
    *,
    commas: bool,
) -> list[dict[str, Any]]:
    subject, district, locality = lengths
    street, house, building, apartment = street_lengths
    rows: list[dict[str, Any]] = []
    if registration_caption:
        rows.append(row(text(registration_caption)))
    comma = ", " if commas else ""
    rows.append(
        row(
            text("субъект Российской Федерации"),
            blank(f"{prefix}Subject", subject),
            text(f"{comma}район"),
            blank(f"{prefix}District", district),
            text(f"{comma}населенный пункт"),
            blank(f"{prefix}Locality", locality, grow=True),
        )
    )
    rows.append(
        row(
            text("улица"),
            blank(f"{prefix}Street", street),
            text("дом"),
            blank(f"{prefix}House", house),
            text("корпус"),
            blank(f"{prefix}Building", building),
            text("квартира"),
            blank(f"{prefix}Apartment", apartment),
        )
    )
    return rows


def _block(block_id: str, *rows: dict[str, Any], page_break: bool = False) -> dict[str, Any]:
    block: dict[str, Any] = {
        "id": block_id,
        "columns": [{"widthPercent": 100, "rows": list(rows)}],
    }
    if page_break:
        block["pageBreakBefore"] = True
    return block


LAYOUT: Final[dict[str, Any]] = {
    "page": {
        "size": "A4",
        "orientation": "portrait",
        "marginMm": {"top": 20, "right": 11, "bottom": 10, "left": 19},
        "fontSizePt": 12,
    },
    "blocks": [
        {
            "id": "header",
            "columns": [
                {
                    "widthPercent": 58,
                    "align": "left",
                    "rows": [
                        row(text("Наименование и адрес медицинской организации")),
                        row(text("(фамилия, имя, отчество (при наличии) индивидуального")),
                        row(text("предпринимателя и адрес осуществления медицинской")),
                        row(text("деятельности)")),
                        row(text("Основной государственный регистрационный номер")),
                        row(text("(Основной государственный регистрационный")),
                        row(text("номер индивидуального предпринимателя)")),
                        row(blank("organization", 47, grow=True)),
                        row(blank("organizationOgrn", 47, grow=True)),
                    ],
                },
                {
                    "widthPercent": 36,
                    "align": "left",
                    "rows": [
                        row(text("Медицинская документация")),
                        row(text("Учетная форма № 058/у")),
                        row(text("Утверждена приказом")),
                        row(text("Министерства здравоохранения")),
                        row(text("Российской Федерации")),
                        row(text("от 20 августа 2026 г. № 740н")),
                    ],
                },
            ],
        },
        _block(
            "title",
            row(
                text("ЭКСТРЕННОЕ ИЗВЕЩЕНИЕ О СЛУЧАЕ ИНФЕКЦИОННОЙ, ПАРАЗИТАРНОЙ"),
                align="center",
                bold=True,
            ),
            row(
                text("БОЛЕЗНИ И НОСИТЕЛЬСТВА ВОЗБУДИТЕЛЕЙ ИНФЕКЦИОННЫХ БОЛЕЗНЕЙ,"),
                align="center",
                bold=True,
            ),
            row(
                text("ПИЩЕВОГО ОТРАВЛЕНИЯ, УКУСА ИЛИ УДАРА, НАНЕСЕННОГО ЖИВОТНЫМ №", bold=True),
                blank("formNumber", 5),
                align="center",
            ),
        ),
        _block(
            "filled",
            _date_row("Дата заполнения экстренного извещения: число", "formDate", (4, 8, 4)),
        ),
        _block(
            "diagnosis",
            row(
                text("1. Диагноз"),
                blank("diagnosis", 47, grow=True),
                text("код по МКБ"),
                blank("diagnosisIcd", 16),
            ),
            row(
                text("Внешняя причина (при травмах)"),
                blank("externalCause", 29, grow=True),
                text("код по МКБ"),
                blank("externalCauseIcd", 16),
            ),
            row(text("1.1."), options("diagnosisKind", ", ", underline=True)),
            row(
                text("1.2. Лабораторное подтверждение:"),
                options("labConfirmed", ", ", underline=True),
            ),
            row(text("2. Извещение:"), options("noticeKind", ", ", underline=True)),
            _flow(
                text("3. Причина подачи экстренного извещения: "),
                options("reason", ", ", underline=True),
            ),
        ),
        _block(
            "patient",
            row(
                text("4. Фамилия, имя, отчество (при наличии) пациента"),
                blank("patientFullName", 40, grow=True),
            ),
            row(text("5. Пол:"), options("patientSex", ", ", underline=True)),
            _date_row("6. Дата рождения: число", "patientBirthDate", (11, 18, 8)),
        ),
        _block(
            "residence",
            *_address_rows(
                "residence",
                "7. Регистрация по месту жительства:",
                (13, 9, 11),
                (11, 6, 7, 9),
                commas=False,
            ),
            *_address_rows(
                "residenceActual",
                "Адрес фактического проживания:",
                (10, 9, 14),
                (19, 6, 7, 9),
                commas=True,
            ),
            *_address_rows(
                "stay",
                "7.1. Регистрация по месту пребывания:",
                (10, 9, 14),
                (19, 6, 7, 9),
                commas=True,
            ),
            *_address_rows(
                "stayActual",
                "Адрес фактического проживания:",
                (10, 9, 14),
                (19, 6, 7, 9),
                commas=True,
            ),
        ),
        _block(
            "foreign",
            row(text("7.2. Для иностранных граждан:")),
            row(text("гражданство"), blank("citizenship", 56, grow=True)),
            _date_row(
                "дата въезда в Российскую Федерацию: число",
                "entryDate",
                (9, 14, 12),
                grow_year=True,
            ),
        ),
        _block(
            "contact",
            row(
                text("8. Страховой номер индивидуального лицевого счета (при наличии):"),
                blank("snils", 23),
            ),
            row(text("9. Контактный телефон (при наличии)"), blank("patientPhone", 49)),
            _flow(
                text("10. Занятость: "),
                options("occupation", ", ", underline=True),
            ),
            row(text("Для детей:"), options("occupationChild", ", ", underline=True)),
        ),
        _block(
            "workplace",
            {
                # the second sheet starts 2.4 mm lower than the first form line of the first sheet
                # (the scan prints the page number «2» above the text)
                **_stretch(
                    text(
                        "Место работы (службы), обучения, отдыха, нахождения в "
                        "санаторно-курортной организации,"
                    )
                ),
                "spaceBeforeMm": 2.4,
            },
            _stretch(
                text(
                    "в организации, осуществляющей стационарное или полустационарное социальное "
                    "обслуживание"
                )
            ),
            row(blank("workplace", 84, grow=True)),
            row(text("Факультет, курс, группа, класс, иное"), blank("studyGroup", 52, grow=True)),
            row(
                text("Выполняемые виды работ (для работающего):"),
                blank("jobDuties", 44, grow=True),
            ),
            row(text("Дополнительные сведения"), blank("occupationExtra", 61, grow=True)),
            row({"kind": "rule", "length": 84, "grow": True}),
            page_break=True,
        ),
        _block(
            "dates",
            row(text("11. Дата:")),
            _date_row(
                "заболевания (со слов пациента/законного представителя пациента): число",
                "onsetDate",
                (3, 4, 5),
                grow_year=True,
            ),
            _stretch(
                text(
                    "первичного обращения к врачу-специалисту (фельдшеру, акушеру (акушерке) по "
                    "поводу данного"
                )
            ),
            _date_row("заболевания (при наличии сведений): число", "firstVisitDate", (8, 9, 10)),
            _date_row("установления диагноза: число", "diagnosisDate", (6, 6, 8)),
            _stretch(
                text(
                    "последнего посещения места работы (службы), обучения, отдыха, нахождения в "
                    "санаторно-"
                )
            ),
            _stretch(
                text(
                    "курортной организации, организации, осуществляющей стационарное или "
                    "полустационарное"
                )
            ),
            _stretch(
                text("социальное обслуживание (со слов пациента/законного представителя пациента):")
            ),
            _date_row("число", "lastVisitDate", (6, 5, 5)),
            row(
                text("госпитализации (при наличии сведений): число"),
                blank("hospitalizationDate", 4, part="day"),
                text("месяц"),
                blank("hospitalizationDate", 3, part="month"),
                text("год"),
                blank("hospitalizationDate", 6, part="year"),
                text("место госпитализации"),
            ),
            row(text("(при наличии сведений)"), blank("hospitalizationPlace", 63, grow=True)),
            _date_row("смерти: число", "deathDate", (8, 9, 10)),
        ),
        _block(
            "animal",
            _stretch(
                text(
                    "12. Если заболевание (травма) связано с укусом или ударом, нанесенным "
                    "животным, в том числе"
                )
            ),
            row(text("клещом, указать:")),
            row(text("кем укушен:"), options("biter", ", ", underline=True)),
            row(text("животное"), options("animalKind", ", ", underline=True)),
            row(text("вид (подвид) животного"), blank("animalSpecies", 59, grow=True)),
            _flow(
                text("характер травмы"),
                text("("),
                {**options("injuryKind", ", ", underline=True), "joined": True},
                {**text(")"), "joined": True},
            ),
            row(text("локализация травмы:"), blank("injuryLocation", 64, grow=True)),
            row(text("где укушен"), blank("biteLocation", 72, grow=True)),
            _caption("(страна, субъект Российской Федерации, населенный пункт)"),
        ),
        _block(
            "food",
            _stretch(
                text(
                    "13. При подозрении на пищевое отравление, указать подозрительный продукт "
                    "(блюдо)"
                ),
                blank("foodProduct", 8),
            ),
            row(text("дата и место приобретения"), blank("foodPurchase", 18), text(",")),
        ),
        _block(
            "anamnesis",
            _stretch(
                text(
                    "14. Сведения о месте нахождения пациента за последние 30 дней до появления "
                    "клинических"
                )
            ),
            _stretch(
                text(
                    "симптомов заболевания за пределами Российской Федерации или за пределами "
                    "населенного пункта"
                )
            ),
            row(
                text("фактического пребывания (при наличии):"),
                options("travelAbroad", ", ", underline=True),
            ),
            row(blank("travelPlace", 82, grow=True)),
            _caption("(страна/населенный пункт и период пребывания)"),
            _stretch(
                text(
                    "15. Наличие в анамнезе контакта за последние 30 дней с инфекционным больным "
                    "(человеком или"
                )
            ),
            _stretch(
                text(
                    "животным), сырьем животного происхождения (при наличии сведений, перечислить)"
                ),
                blank("contactHistory", 12),
            ),
            _stretch(
                text(
                    "16. Проведенные первичные противоэпидемические мероприятия и "
                    "дополнительные сведения"
                ),
                {"kind": "rule", "length": 3},
            ),
            row(blank("measures", 84, grow=True, lines=1)),
        ),
        _block(
            "informing",
            _stretch(
                text(
                    "17. Информирование территориального органа федерального органа "
                    "исполнительной власти,"
                )
            ),
            _stretch(
                text(
                    "осуществляющего федеральный государственный санитарно-эпидемиологический "
                    "контроль"
                )
            ),
            row(text("(надзор):")),
            row(
                text("число"),
                blank("informedDate", 3, part="day"),
                text("месяц"),
                blank("informedDate", 5, part="month"),
                text("год"),
                blank("informedDate", 4, part="year"),
                text("час"),
                blank("informedHour", 4),
                text("минута"),
                blank("informedMinute", 5),
                text("(по телефону, письменно, электронным"),
            ),
            row(text("способом связи)")),
            _date_row("отправка экстренного извещения: число", "sentDate", (6, 10, 7)),
        ),
        _block(
            "signatories",
            row(
                text("Фамилия, имя, отчество (при наличии) лица, заполнившего извещение"),
                blank("filledByName", 21, grow=True),
            ),
            row(text("должность"), blank("filledByPosition", 28)),
            row(
                text("Фамилия, имя, отчество (при наличии) лица, принявшего сообщение"),
                blank("acceptedByName", 24),
            ),
            row(text("Регистрационный № принятого извещения"), blank("acceptedRegNumber", 7)),
        ),
    ],
}


NOTES: Final[list[str]] = [
    "Приказ от 20.08.2026 № 740н вступает в силу 1 марта 2027 г. и действует до 1 марта 2033 г. "
    "(п. 2 приказа, PDF-страница 1). Форма, действующая до этой даты, источника на портале "
    "не имеет "
    "и в приложении не воспроизводится; схема описывает форму, ещё не вступившую в силу.",
    "В правом верхнем углу бланка «от … 2026 г. № …» вписаны от руки; в схеме напечатаны "
    "реквизиты приказа (от 20 августа 2026 г. № 740н) по тексту самого приказа.",
    "Бумажная форма заполняется внесением сведений и подчеркиванием ответов из предложенных "
    "вариантов (п. 5): выбранные варианты отмечаются подчёркиванием, а не обводкой.",
    "Если внесение сведений невозможно ввиду их отсутствия, в Извещении делается запись "
    "«не установлено» (п. 6); приложение не подставляет эту запись само.",
    "Адрес фактического проживания напечатан отдельной строкой под строкой 7 и под строкой 7.1; "
    "приложение хранит только адрес регистрации и адрес пребывания, поэтому эти строки не "
    "подставляются.",
    "«Гражданство» и «дата въезда» (строка 7.2) относятся к иностранным гражданам (п. 10.4): "
    "гражданство из карты пациента не подставляется, чтобы не печатать его в строке для "
    "иностранцев гражданам России.",
    "Строка 10 бланка продолжается строкой «Для детей» с кодами 7–9; это один вопрос о занятости, "
    "в схеме — два поля (коды 1–6 и 7–9), как их называет и п. 10.6.",
    "Часы и минуты информирования территориального органа (строка 17) — отдельные поля; "
    "пояснение «(по телефону, письменно, электронным способом связи)» напечатано без поля.",
    "Форма не печатает подписей: порядок называет только строки с фамилией, именем, отчеством и "
    "должностью лица, заполнившего извещение (п. 11); п. 3 говорит об электронном извещении, "
    "подписанном усиленной квалифицированной электронной подписью, — приложение таких документов "
    "не выпускает.",
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
    edition_note=EDITION_NOTE,
)
