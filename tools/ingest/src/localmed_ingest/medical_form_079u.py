"""Reviewed blueprint of form 079/у «Медицинская справка о состоянии здоровья ребенка, направляемого
в организацию отдыха детей и их оздоровления» (order 274н, appendices 11 and 12).

The blank is appendix 11 (PDF pages 54–55, two sides), the «Порядок заполнения» is appendix 12
(PDF pages 56–59). Same method as `medical_form_070u`: every printed caption is located in the OCR
text of the blank, every cited paragraph is cut from the OCR text of the order.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    EFFECTIVE_FROM,
    EFFECTIVE_UNTIL,
    FOOTNOTE_MARK,
    ICD10_MESSAGE,
    ICD10_PATTERN,
    ORDER_DATE,
    ORDER_NUMBER,
    ORDER_TITLE,
    REGISTRATION,
    address_fields,
    blank,
    field_def,
    field_rule,
    options,
    row,
    signature,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.274n.079u"
FORM_NUMBER: Final = "079/у"
FORM_TITLE: Final = (
    "Медицинская справка о состоянии здоровья ребенка, направляемого в организацию отдыха "
    "детей и их оздоровления"
)

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {56: 0.12, 57: 0.18, 58: 0.155, 59: 0.10}

CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(57, 'учета".', "учета.", FOOTNOTE_MARK),
    Correction(58, "проведения?", "проведения.", FOOTNOTE_MARK),
    Correction(
        58,
        "в связи имеющимися",
        "в связи с имеющимися",
        "a preposition at the start of a printed line is not recognised",
    ),
    Correction(
        59,
        "инфекционных заболеваний а также",
        "инфекционных заболеваний, а также",
        "comma lost together with a footnote mark",
    ),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = ()
SCAN_REVIEWED: Final = ()


def _rule(status: str, *paragraphs: str, note: str | None = None) -> dict[str, Any]:
    return field_rule(status, *paragraphs, note=note)


def _icd(field_id: str, label: str, rule: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "icd10",
        rule,
        anchor="код по МКБ",
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
        **extra,
    )


def _build_fields() -> list[dict[str, Any]]:
    identity = _rule("defined", "7.1")
    past = _rule("defined", "7.5")
    state = _rule("defined", "7.7")
    education = _rule(
        "by-line",
        "7.4",
        note=(
            "Пункт 7.4 называет строку «Сведения об образовательной организации» и тип "
            "организации; номер, класс, группу и наименование порядок отдельно не определяет."
        ),
    )
    fields: list[dict[str, Any]] = [
        field_def(
            "organization",
            "Наименование и адрес медицинской организации (фамилия, имя, отчество (при наличии) "
            "индивидуального предпринимателя и адрес осуществления медицинской деятельности)",
            "text",
            _rule("undefined", note="Порядок не описывает заполнение шапки."),
            required=True,
            basis="editorial",
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
            _rule("undefined", note="Порядок не описывает заполнение шапки."),
            required=True,
            basis="editorial",
            anchor="Основной государственный регистрационный номер",
            prefill={"sources": ["organization.ogrn"]},
            pattern="^(?:[0-9]{13}|[0-9]{15})$",
            patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
        ),
        field_def(
            "patientFullName",
            "Фамилия, имя, отчество (при наличии) ребенка",
            "text",
            identity,
            required=True,
            prefill={"sources": ["patient.fullName"]},
            maxLength=200,
        ),
        field_def(
            "patientBirthDate",
            "Дата рождения",
            "date",
            identity,
            required=True,
            prefill={"sources": ["patient.birthDate"]},
            notAfter="today",
        ),
        field_def(
            "patientSex",
            "Пол",
            "choice",
            identity,
            required=True,
            prefill={"sources": ["patient.sex"], "map": {"male": "1", "female": "2"}},
            options=[{"value": "1", "label": "муж."}, {"value": "2", "label": "жен."}],
            anchor="Пол: муж. - 1, жен. - 2",
        ),
        field_def(
            "citizenship",
            "Гражданство",
            "text",
            _rule(
                "undefined",
                note="Порядок не называет строку «Гражданство» (п. 7.1 перечисляет ФИО, пол и "
                "дату рождения).",
            ),
            prefill={"sources": ["patient.citizenship"]},
            maxLength=80,
        ),
        *address_fields(
            "residence",
            "Регистрация по месту жительства: субъект Российской Федерации",
            "address",
            "Пункт 7.2 называет строку «Регистрация по месту жительства» целиком; её части "
            "(район, улица, телефон и др.) порядок отдельно не определяет.",
            "7.2",
        ),
        *address_fields(
            "stay",
            "Регистрация по месту пребывания: субъект Российской Федерации",
            "stayAddress",
            "Пункт 7.3 называет строку «Регистрация по месту пребывания» целиком; её части "
            "(район, улица, телефон и др.) порядок отдельно не определяет.",
            "7.3",
        ),
        field_def(
            "educationType",
            "Сведения об образовательной организации: тип",
            "text",
            _rule("defined", "7.4"),
            anchor="Сведения об образовательной организации",
            maxLength=120,
        ),
        field_def(
            "educationNumber",
            "№ образовательной организации",
            "text",
            education,
            anchor="Сведения об образовательной организации: тип",
            maxLength=40,
        ),
        field_def(
            "educationClass",
            "класс (образовательная организация)",
            "text",
            education,
            anchor="класс",
            maxLength=40,
        ),
        field_def(
            "educationName",
            "(наименование) образовательной организации",
            "text",
            education,
            anchor="(наименование)",
            maxLength=200,
        ),
        field_def(
            "educationUnitNumber",
            "№ (структурное подразделение)",
            "text",
            education,
            anchor="наименование",
            maxLength=40,
        ),
        field_def(
            "educationGroup",
            "группа",
            "text",
            education,
            anchor="группа",
            maxLength=40,
        ),
        field_def(
            "educationGrade",
            "Класс",
            "text",
            education,
            anchor="Класс",
            maxLength=40,
        ),
    ]
    for index in (1, 2, 3):
        fields += [
            field_def(
                f"past{index}",
                f"Перенесенные заболевания, операции, травмы ({index})",
                "text",
                past,
                anchor="Перенесенные заболевания, операции, травмы",
                maxLength=300,
            ),
            _icd(f"past{index}Icd", f"код по МКБ (перенесенное заболевание {index})", past),
            field_def(
                f"past{index}Date",
                f"Дата (перенесенное заболевание {index})",
                "date",
                past,
                anchor="Дата",
                notAfter="today",
            ),
        ]
    fields += [
        field_def(
            "vaccinationsAndExams",
            "Проведенные профилактические прививки и результаты обследований, в том числе в "
            "целях выявления туберкулеза",
            "text",
            _rule("defined", "7.6"),
            multiline=True,
            maxLength=1500,
        ),
    ]
    for index in (1, 2, 3):
        fields += [
            field_def(
                f"health{index}",
                f"Состояние здоровья: диагноз заболевания ({index})",
                "text",
                state,
                anchor="Диагноз заболевания" if index == 1 else "код по МКБ",
                prefill={"sources": ["episode.diagnosis.text"]} if index == 1 else None,
                maxLength=300,
            ),
            _icd(
                f"health{index}Icd",
                f"код по МКБ (диагноз {index})",
                state,
                **({"prefill": {"sources": ["episode.diagnosis.icd10"]}} if index == 1 else {}),
            ),
        ]
    fields += [
        field_def(
            "allergies",
            "Аллергические заболевания (пищевая, лекарственная, бытовая аллергия), "
            "аллергические реакции",
            "text",
            _rule("defined", "7.8"),
            multiline=True,
            maxLength=500,
            anchor="Аллергические заболевания",
        ),
        field_def(
            "treatmentRegime",
            "Назначенный лечащим врачом режим лечения (диета, прием лекарственных препаратов "
            "для медицинского применения и специализированных продуктов лечебного питания)",
            "text",
            _rule("defined", "7.9"),
            multiline=True,
            maxLength=1000,
            anchor="Назначенный лечащим врачом режим лечения",
        ),
        field_def(
            "heightCm",
            "Рост",
            "text",
            _rule("defined", "7.10"),
            maxLength=10,
        ),
        field_def(
            "weightKg",
            "масса тела",
            "text",
            _rule("defined", "7.10"),
            maxLength=10,
        ),
        field_def(
            "anthropometryNote",
            "(дефицит массы тела, избыток массы тела, низкий рост, высокий рост - нужное "
            "подчеркнуть)",
            "choice",
            _rule("defined", "7.10"),
            multiple=True,
            options=[
                {"value": "1", "label": "дефицит массы тела"},
                {"value": "2", "label": "избыток массы тела"},
                {"value": "3", "label": "низкий рост"},
                {"value": "4", "label": "высокий рост"},
            ],
            anchor="дефицит массы тела, избыток массы тела, низкий рост, высокий рост",
        ),
        field_def(
            "healthGroup",
            "Группа здоровья",
            "text",
            _rule("defined", "7.11"),
            maxLength=60,
        ),
        field_def(
            "physicalCultureGroup",
            "Медицинская группа для занятий физической культурой",
            "text",
            _rule("defined", "7.11"),
            maxLength=100,
        ),
        field_def(
            "accessibleEnvironment",
            "Нуждаемость в условиях доступной среды",
            "choice",
            _rule("defined", "7.12"),
            options=[{"value": "1", "label": "да"}, {"value": "2", "label": "нет"}],
            anchor="Нуждаемость в условиях доступной среды: да - 1, нет - 2",
        ),
        field_def(
            "escortNeed",
            "Необходимость сопровождения ребенка законным представителем в период пребывания в "
            "организации отдыха детей и их оздоровления и (или) нуждающегося в индивидуальной "
            "помощи в связи с имеющимися физическими, психическими, интеллектуальными или "
            "сенсорными нарушениями",
            "text",
            _rule("defined", "7.13"),
            multiline=True,
            maxLength=500,
            anchor="Необходимость сопровождения ребенка законным представителем",
        ),
        field_def(
            "noInfectionContact",
            "Отсутствие контакта с больными инфекционными заболеваниями",
            "text",
            _rule("defined", "7.14"),
            maxLength=300,
        ),
        field_def(
            "pediculosisExam",
            "Осмотр на педикулез и чесотку",
            "text",
            _rule("defined", "7.15"),
            multiline=True,
            maxLength=300,
        ),
        field_def(
            "helminthExam",
            "Обследование на гельминтозы (энтеробиоз, гименолепидоз)",
            "text",
            _rule("defined", "7.15"),
            multiline=True,
            maxLength=300,
            anchor="Обследование на гельминтозы",
        ),
        field_def(
            "noContraindications",
            "Отсутствие медицинских противопоказаний для пребывания в организации отдыха "
            "детей и их оздоровления",
            "text",
            _rule("defined", "7.16"),
            required=True,
            multiline=True,
            maxLength=600,
        ),
        field_def(
            "doctor",
            "Должность, специальность, фамилия, имя, отчество (при наличии) и подпись врача",
            "text",
            _rule("defined", "8"),
            required=True,
            prefill={"sources": ["clinician.position", "clinician.fullName"], "join": " "},
            multiline=True,
            maxLength=300,
        ),
        field_def(
            "doctorSignature",
            "подпись врача",
            "signature",
            _rule("defined", "8"),
            anchor="и подпись врача",
        ),
        field_def(
            "head",
            "Фамилия, имя, отчество (при наличии) и подпись руководителя медицинской организации",
            "text",
            _rule("defined", "9"),
            required=True,
            multiline=True,
            maxLength=300,
        ),
        field_def(
            "headSignature",
            "подпись руководителя медицинской организации",
            "signature",
            _rule("defined", "9"),
            anchor="и подпись руководителя медицинской организации",
        ),
        field_def("stamp", "М.П. (при наличии)", "stamp", _rule("defined", "10")),
        field_def(
            "formDate",
            "Дата выдачи справки",
            "date",
            _rule("defined", "10"),
            required=True,
            printed=False,
            anchor="20 г.",
            prefill={"sources": ["today"]},
        ),
    ]
    return fields


FIELDS: Final = _build_fields()


def _address_ids(prefix: str) -> list[str]:
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


SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "organization",
        "title": "Организация",
        "description": "Подставляется из настроек «Врач и организация».",
        "fieldIds": ["organization", "organizationOgrn"],
    },
    {
        "id": "child",
        "title": "Ребёнок",
        "fieldIds": ["patientFullName", "patientBirthDate", "patientSex", "citizenship"],
    },
    {
        "id": "residence",
        "title": "Регистрация по месту жительства",
        "fieldIds": _address_ids("residence"),
    },
    {"id": "stay", "title": "Регистрация по месту пребывания", "fieldIds": _address_ids("stay")},
    {
        "id": "education",
        "title": "Образовательная организация",
        "description": (
            "Тип посещаемой организации; если ребёнок её не посещает, указывается "
            "«неорганизованный» (п. 7.4)."
        ),
        "fieldIds": [
            "educationType",
            "educationNumber",
            "educationClass",
            "educationName",
            "educationUnitNumber",
            "educationGroup",
            "educationGrade",
        ],
    },
    {
        "id": "past",
        "title": "Перенесённые заболевания, операции, травмы",
        "description": "С датой и кодом по МКБ (п. 7.5).",
        "fieldIds": [
            f"past{index}{suffix}" for index in (1, 2, 3) for suffix in ("", "Icd", "Date")
        ],
    },
    {
        "id": "vaccinations",
        "title": "Прививки и обследования",
        "fieldIds": ["vaccinationsAndExams"],
    },
    {
        "id": "health",
        "title": "Состояние здоровья",
        "description": "Диагноз имеющегося заболевания и код по МКБ (п. 7.7).",
        "fieldIds": [f"health{index}{suffix}" for index in (1, 2, 3) for suffix in ("", "Icd")],
    },
    {
        "id": "regime",
        "title": "Режим, развитие и группы",
        "fieldIds": [
            "allergies",
            "treatmentRegime",
            "heightCm",
            "weightKg",
            "anthropometryNote",
            "healthGroup",
            "physicalCultureGroup",
            "accessibleEnvironment",
            "escortNeed",
        ],
    },
    {
        "id": "infection",
        "title": "Инфекционная безопасность",
        "fieldIds": ["noInfectionContact", "pediculosisExam", "helminthExam"],
    },
    {
        "id": "conclusion",
        "title": "Заключение и подписи",
        "description": "Подписи и печать ставятся на бумажной справке (п. 8–10).",
        "fieldIds": ["noContraindications", "doctor", "head", "formDate"],
    },
]


# One character of the body font (14 pt) on the scan, in pixels at 100 dpi: the blank lengths below
# were measured on the scan in pixels and are converted to printed characters.
_PX_PER_CH: Final = 9.72


def _ch(pixels: float) -> float:
    return round(pixels / _PX_PER_CH, 1)


def _t(
    value: str, *, indent: float | None = None, joined: bool = False, bold: bool = False
) -> dict[str, Any]:
    """A caption; `indent` is the extra space before it (mm) where the scan spreads the line."""
    segment = text(value, bold=bold)
    if joined:
        segment["joined"] = True
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def _b(
    field_id: str,
    pixels: float,
    *,
    grow: bool = False,
    indent: float | None = None,
    part: str | None = None,
) -> dict[str, Any]:
    segment = blank(field_id, _ch(pixels), grow=grow, part=part)
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def _ruled(pixels: float, *, indent: float | None = None) -> dict[str, Any]:
    """A ruled line that is the continuation of the blank before it (no field of its own)."""
    segment: dict[str, Any] = {"kind": "rule", "length": _ch(pixels), "grow": True}
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def _stretch(value: str) -> dict[str, Any]:
    """One printed line of a justified paragraph: spread over the whole width."""
    return row(text(value), align="stretch")


def _address(
    prefix: str, caption: str, widths: tuple[float, float, float, float]
) -> list[dict[str, Any]]:
    """The five printed lines of a registration address (the scan justifies each of them)."""
    subject, district, rest, locality = widths
    return [
        _stretch(caption),
        row(
            _b(f"{prefix}Subject", subject, grow=True),
            text("район"),
            _b(f"{prefix}District", district, grow=True),
        ),
        row(
            _ruled(rest),
            text("населенный"),
            _t("пункт", indent=1.5),
            _b(f"{prefix}Locality", locality, grow=True),
        ),
        row(
            text("улица"),
            _b(f"{prefix}Street", 272, grow=True, indent=3.6),
            _t("дом", indent=2.9),
            _b(f"{prefix}House", 40, indent=2.4),
            _t("строение/корпус", indent=5.7),
            _b(f"{prefix}Building", 40, indent=5.2),
        ),
        row(
            text("квартира"),
            _b(f"{prefix}Apartment", 54),
            text("тел."),
            _b(f"{prefix}Phone", 190),
        ),
    ]


def _past_row(index: int) -> dict[str, Any]:
    """«__________ код по МКБ ______ Дата «__» ________ 20__г.» — one printed line, to the edge."""
    return row(
        _b(f"past{index}", 202),
        text("код по МКБ"),
        _b(f"past{index}Icd", 78),
        _t("Дата", indent=1.5),
        _t("«"),
        _b(f"past{index}Date", 39, part="day"),
        _t("»", joined=True),
        _b(f"past{index}Date", 117, grow=True, part="month"),
        text("20"),
        _b(f"past{index}Date", 28, part="year2"),
        _t("г.", joined=True),
    )


def _diagnosis_row(
    field_id: str, icd_id: str, lead: str | None, icd_pixels: float
) -> dict[str, Any]:
    segments = [text(lead)] if lead else []
    return row(
        *segments,
        _b(field_id, 312, grow=True),
        text("код по МКБ"),
        _b(icd_id, icd_pixels, indent=0.8),
    )


def _signature_block(caption: list[str], entry_id: str, signature_id: str) -> list[dict[str, Any]]:
    """The caption lines, then the two ruled lines of the entry; the signature sits on the last."""
    return [
        *[_stretch(line) for line in caption[:-1]],
        row(text(caption[-1])),
        row(blank(entry_id, 40, grow=True)),
        row(_ruled(60), signature(signature_id, 14)),
    ]


LAYOUT: Final[dict[str, Any]] = {
    "page": {
        "size": "A4",
        "orientation": "portrait",
        "marginMm": {"top": 10, "right": 12.6, "bottom": 10, "left": 17.5},
        "fontSizePt": 14,
    },
    "blocks": [
        {
            "id": "header",
            "insetMm": {"left": 5.9, "right": 1.8},
            "columns": [
                {
                    "widthPercent": 45,
                    "align": "left",
                    "rows": [
                        row(
                            text("Наименование и адрес медицинской организации"),
                            align="stretch",
                            size="caption",
                        ),
                        row(text("(фамилия, имя, отчество (при наличии)"), size="caption"),
                        row(
                            text("индивидуального предпринимателя и адрес"),
                            size="caption",
                        ),
                        row(
                            text("осуществления медицинской деятельности)"),
                            size="caption",
                        ),
                        row(
                            text("Основной государственный регистрационный"),
                            align="stretch",
                            size="caption",
                        ),
                        row(text("номер"), size="caption"),
                        row(
                            text("(Основной государственный регистрационный"),
                            size="caption",
                        ),
                        row(text("номер индивидуального предпринимателя)"), size="caption"),
                        row(blank("organization", _ch(270))),
                        row(blank("organizationOgrn", _ch(270))),
                    ],
                },
                {
                    "widthPercent": 36,
                    "align": "center",
                    "rows": [
                        row(text("Медицинская документация"), size="caption"),
                        row(text("Учетная форма № 079/у"), size="caption"),
                        row(
                            text("Утверждена приказом Министерства"),
                            size="caption",
                            gap="small",
                        ),
                        row(text("здравоохранения Российской Федерации"), size="caption"),
                        row(text("от 13 мая 2025 г. № 274н"), size="caption"),
                    ],
                },
            ],
        },
        {
            "id": "title",
            "insetMm": {"left": 4.6},
            "columns": [
                {
                    "widthPercent": 100,
                    "align": "center",
                    "rows": [
                        row(
                            text("Медицинская справка о состоянии здоровья ребенка, направляемого"),
                            align="center",
                            bold=True,
                            gap="large",
                        ),
                        row(
                            text("в организацию отдыха детей и их оздоровления"),
                            align="center",
                            bold=True,
                        ),
                    ],
                }
            ],
        },
        {
            "id": "child",
            "insetMm": {"left": 4.6},
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text("Фамилия, имя, отчество (при наличии) ребенка"),
                            _b("patientFullName", 272, grow=True),
                            gap="medium",
                        ),
                        row({"kind": "rule", "length": 70, "grow": True}),
                        row(
                            text("Дата рождения:"),
                            _t("«"),
                            _b("patientBirthDate", 24, part="day"),
                            _t("»", joined=True),
                            _b("patientBirthDate", 84, part="month"),
                            _b("patientBirthDate", 30, part="year"),
                            text("г."),
                            text("Пол:"),
                            options("patientSex"),
                        ),
                        row(text("Гражданство"), _b("citizenship", 195)),
                        *_address(
                            "residence",
                            "Регистрация по месту жительства: субъект Российской Федерации",
                            (347, 278, 228, 276),
                        ),
                        *_address(
                            "stay",
                            "Регистрация по месту пребывания: субъект Российской Федерации",
                            (349, 273, 242, 242),
                        ),
                        row(
                            text("Сведения об образовательной организации: тип:"),
                            _b("educationType", 146, grow=True),
                            text("№"),
                            _b("educationNumber", 108, grow=True),
                        ),
                        row(text("класс"), _b("educationClass", 194)),
                        row(
                            text("(наименование)"),
                            _b("educationName", 505, grow=True, indent=10),
                        ),
                        row(
                            text("№"),
                            _b("educationUnitNumber", 133),
                            text("группа"),
                            _b("educationGroup", 148),
                            text("Класс"),
                            _b("educationGrade", 254, grow=True),
                        ),
                        row(text("Перенесенные заболевания, операции, травмы")),
                        row(
                            _b("past1", 202),
                            text("код по Международной статистической классификации"),
                            align="stretch",
                        ),
                        row(
                            text("болезней и проблем, связанных со здоровьем (далее – МКБ)"),
                            _b("past1Icd", 185),
                            align="stretch",
                        ),
                        row(
                            text("Дата"),
                            _t("«"),
                            _b("past1Date", 40, part="day"),
                            _t("»", joined=True),
                            _b("past1Date", 95, part="month"),
                            text("20"),
                            _b("past1Date", 20, part="year2"),
                            _t("г.", joined=True),
                        ),
                        _past_row(2),
                        _past_row(3),
                        _stretch(
                            "Проведенные профилактические прививки и результаты обследований, "
                            "в том числе"
                        ),
                        row(
                            text("в целях выявления туберкулеза"),
                            _b("vaccinationsAndExams", 419, grow=True),
                        ),
                        row(_ruled(679)),
                        row(text("Состояние здоровья:")),
                        _diagnosis_row("health1", "health1Icd", "Диагноз заболевания", 89),
                        _diagnosis_row("health2", "health2Icd", None, 78),
                        _diagnosis_row("health3", "health3Icd", None, 78),
                    ],
                }
            ],
        },
        {
            "id": "back",
            "pageBreakBefore": True,
            "insetMm": {"right": 4.4},
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        # the sheet starts 3.7 mm lower than its first text line is set (the scan
                        # prints the page number «2» above the text)
                        {
                            **_stretch(
                                "Аллергические заболевания (пищевая, лекарственная, бытовая "
                                "аллергия),"
                            ),
                            "spaceBeforeMm": 3.7,
                        },
                        row(
                            text("аллергические реакции:"),
                            _b("allergies", 466),
                            align="stretch",
                        ),
                        row(_ruled(680)),
                        _stretch(
                            "Назначенный лечащим врачом режим лечения (диета, прием лекарственных"
                        ),
                        _stretch(
                            "препаратов для медицинского применения и специализированных продуктов"
                        ),
                        row(
                            text("лечебного питания)"),
                            _b("treatmentRegime", 514, grow=True),
                        ),
                        row(_ruled(679)),
                        row(
                            text("Рост"),
                            _b("heightCm", 49),
                            text(", масса тела"),
                            _b("weightKg", 69),
                            _t("(", joined=True),
                            {
                                **options("anthropometryNote", ", ", codes=False, underline=True),
                                "range": [0, 2],
                                "joined": True,
                            },
                        ),
                        row(
                            {
                                **options("anthropometryNote", ", ", codes=False, underline=True),
                                "range": [2, 4],
                            },
                            _t("- нужное подчеркнуть)", joined=True),
                        ),
                        row(text("Группа здоровья"), _b("healthGroup", 544, grow=True)),
                        row(
                            text("Медицинская группа для занятий физической культурой"),
                            _b("physicalCultureGroup", 204),
                            align="stretch",
                        ),
                        row(
                            text("Нуждаемость в условиях доступной среды: да – 1, нет - 2"),
                            _b("accessibleEnvironment", 78),
                        ),
                        _stretch(
                            "Необходимость сопровождения ребенка законным представителем в период"
                        ),
                        _stretch(
                            "пребывания в организации отдыха детей и их оздоровления и (или) "
                            "нуждающегося"
                        ),
                        _stretch(
                            "в индивидуальной помощи в связи с имеющимися физическими, "
                            "психическими,"
                        ),
                        row(
                            text("интеллектуальными или сенсорными нарушениями"),
                            _b("escortNeed", 263, grow=True),
                        ),
                        row(_ruled(680)),
                        row(
                            text("Отсутствие контакта с больными инфекционными заболеваниями"),
                            _b("noInfectionContact", 126, grow=True),
                        ),
                        row(
                            text("Осмотр на педикулез и чесотку"),
                            _b("pediculosisExam", 263, indent=6.3),
                            align="stretch",
                        ),
                        row(_ruled(680)),
                        _stretch("Обследование на гельминтозы (энтеробиоз, гименолепидоз)"),
                        row(_b("helminthExam", 680, grow=True)),
                        _stretch(
                            "Отсутствие медицинских противопоказаний для пребывания в "
                            "организации отдыха"
                        ),
                        row(
                            text("детей и их оздоровления"),
                            _b("noContraindications", 476, grow=True),
                        ),
                        row(_ruled(680)),
                        row(_ruled(680)),
                        *_signature_block(
                            [
                                "Должность, специальность, фамилия, имя, отчество (при наличии) "
                                "и подпись врача"
                            ],
                            "doctor",
                            "doctorSignature",
                        ),
                        *_signature_block(
                            [
                                "Фамилия, имя, отчество (при наличии) и подпись руководителя "
                                "медицинской",
                                "организации",
                            ],
                            "head",
                            "headSignature",
                        ),
                        row({"kind": "stamp", "fieldId": "stamp", "text": "М.П. (при наличии)"}),
                        row(
                            _t("«"),
                            _b("formDate", 30, part="day"),
                            _t("»", joined=True),
                            _b("formDate", 173, part="month"),
                            text("20"),
                            _b("formDate", 32, part="year2"),
                            _t("г.", joined=True),
                        ),
                    ],
                }
            ],
        },
    ],
}

NOTES: Final[list[str]] = [
    "Подписи полей в повторяющихся строках («(1)», «(2)»), пояснения в скобках и уточнения "
    "«обратный талон»/«заключение» добавлены для различения полей; напечатанные подписи "
    "проверяются по OCR бланка (blankLabelsVerified).",
    "Бланк 079/у (приложение № 11) двусторонний: оборотная сторона начинается с аллергических "
    "заболеваний и на печати идёт с новой страницы.",
    "Строка «Гражданство» напечатана на бланке, но порядок её не называет (rule.status = "
    "undefined); значение подставляется из карточки пациента, если оно там указано.",
    "Строка «Состояние здоровья» подставляет основной диагноз эпизода в первую строку; он "
    "правится вручную: п. 7.7 говорит об «имеющемся заболевании», а не о диагнозе эпизода.",
    "Строки образовательной организации: порядок определяет только тип (п. 7.4); номер, класс, "
    "группу и наименование бланк печатает двумя строками (по порядку печати).",
    "Обязательность полей (required) порядок прямо не задаёт: basis = source — пункт говорит, "
    "что строка «заполняется»/«указывается»/«дается заключение»; basis = editorial — вывод по "
    "виду бланка. Незаполненные обязательные поля подсвечиваются, печать не блокируется.",
    "Подписи врача (п. 8) и руководителя медицинской организации (п. 9) ставятся на бумажной "
    "справке; в месте печати проставляется печать и указывается дата выдачи (п. 10).",
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
    blank_appendix=11,
    blank_pages=(54, 55),
    rules_appendix=12,
    rules_pages=(56, 57, 58, 59),
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
)
