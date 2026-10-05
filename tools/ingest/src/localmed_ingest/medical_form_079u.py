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
    address_rows,
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


def _icd_row(
    label: str, field_id: str, icd_id: str, *, extra_lead: str | None = None
) -> dict[str, Any]:
    lead = [text(extra_lead)] if extra_lead else []
    return row(*lead, blank(field_id, 30, grow=True), text("код по МКБ"), blank(icd_id, 14))


def _past_row(index: int) -> dict[str, Any]:
    return row(
        blank(f"past{index}", 24, grow=True),
        text("код по МКБ"),
        blank(f"past{index}Icd", 10),
        text("Дата"),
        *date_blanks(f"past{index}Date", month_length=12),
        text("г."),
    )


LAYOUT: Final[dict[str, Any]] = {
    "page": {
        "size": "A4",
        "orientation": "portrait",
        "marginMm": {"top": 10, "right": 10, "bottom": 10, "left": 15},
        "fontSizePt": 10,
    },
    "blocks": [
        {
            "id": "header",
            "columns": [
                {
                    "widthPercent": 56,
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
                        row(
                            text(
                                "Основной государственный регистрационный номер (Основной "
                                "государственный регистрационный номер индивидуального "
                                "предпринимателя)"
                            ),
                            size="small",
                        ),
                        row(blank("organization", 40, grow=True), gap="small"),
                        row(blank("organizationOgrn", 40, grow=True)),
                    ],
                },
                {
                    "widthPercent": 44,
                    "align": "center",
                    "rows": [
                        row(text("Медицинская документация"), size="small"),
                        row(text("Учетная форма № 079/у"), size="small"),
                        row(
                            text(
                                "Утверждена приказом Министерства здравоохранения Российской "
                                "Федерации от 13 мая 2025 г. № 274н"
                            ),
                            size="small",
                            gap="small",
                        ),
                    ],
                },
            ],
        },
        {
            "id": "title",
            "columns": [
                {
                    "widthPercent": 100,
                    "align": "center",
                    "rows": [
                        row(
                            text(
                                "Медицинская справка о состоянии здоровья ребенка, направляемого "
                                "в организацию отдыха детей и их оздоровления",
                                bold=True,
                            ),
                            align="center",
                            size="title",
                            gap="large",
                        ),
                    ],
                }
            ],
        },
        {
            "id": "child",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text("Фамилия, имя, отчество (при наличии) ребенка"),
                            blank("patientFullName", 40, grow=True),
                            gap="medium",
                        ),
                        row(
                            text("Дата рождения:"),
                            *date_blanks("patientBirthDate", month_length=10),
                            text("г."),
                            text("Пол:"),
                            options("patientSex"),
                        ),
                        row(text("Гражданство"), blank("citizenship", 24)),
                        *address_rows(
                            "residence",
                            "Регистрация по месту жительства: субъект Российской Федерации",
                            52,
                            27,
                        ),
                        *address_rows(
                            "stay",
                            "Регистрация по месту пребывания: субъект Российской Федерации",
                            48,
                            28,
                        ),
                        row(
                            text("Сведения об образовательной организации: тип:"),
                            blank("educationType", 16, grow=True),
                            text("№"),
                            blank("educationNumber", 12),
                        ),
                        row(text("класс"), blank("educationClass", 22)),
                        row(text("(наименование)"), blank("educationName", 40, grow=True)),
                        row(
                            text("№"),
                            blank("educationUnitNumber", 16),
                            text("группа"),
                            blank("educationGroup", 16),
                            text("Класс"),
                            blank("educationGrade", 24, grow=True),
                        ),
                        row(text("Перенесенные заболевания, операции, травмы"), gap="small"),
                        row(
                            blank("past1", 20),
                            text(
                                "код по Международной статистической классификации болезней и "
                                "проблем, связанных со здоровьем (далее – МКБ)"
                            ),
                            blank("past1Icd", 20),
                        ),
                        row(text("Дата"), *date_blanks("past1Date", month_length=12), text("г.")),
                        _past_row(2),
                        _past_row(3),
                        row(
                            text(
                                "Проведенные профилактические прививки и результаты "
                                "обследований, в том числе в целях выявления туберкулеза"
                            ),
                            blank("vaccinationsAndExams", 30, grow=True, lines=1),
                        ),
                        row(text("Состояние здоровья:"), gap="small"),
                        row(
                            text("Диагноз заболевания"),
                            blank("health1", 30, grow=True),
                            text("код по МКБ"),
                            blank("health1Icd", 12),
                        ),
                        _icd_row("", "health2", "health2Icd"),
                        _icd_row("", "health3", "health3Icd"),
                    ],
                }
            ],
        },
        {
            "id": "back",
            "pageBreakBefore": True,
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text(
                                "Аллергические заболевания (пищевая, лекарственная, бытовая "
                                "аллергия), аллергические реакции:"
                            ),
                            blank("allergies", 20, grow=True, lines=1),
                            align="justify",
                        ),
                        row(
                            text(
                                "Назначенный лечащим врачом режим лечения (диета, прием "
                                "лекарственных препаратов для медицинского применения и "
                                "специализированных продуктов лечебного питания)"
                            ),
                            blank("treatmentRegime", 20, grow=True, lines=1),
                            gap="small",
                        ),
                        row(
                            text("Рост"),
                            blank("heightCm", 8),
                            text(", масса тела"),
                            blank("weightKg", 10),
                            options("anthropometryNote", ", ", codes=False, underline=True),
                            gap="small",
                        ),
                        row(text("(нужное подчеркнуть)"), size="small"),
                        row(text("Группа здоровья"), blank("healthGroup", 40, grow=True)),
                        row(
                            text("Медицинская группа для занятий физической культурой"),
                            blank("physicalCultureGroup", 20, grow=True),
                        ),
                        row(
                            text("Нуждаемость в условиях доступной среды: да – 1, нет - 2"),
                            blank("accessibleEnvironment", 8),
                        ),
                        row(
                            text(
                                "Необходимость сопровождения ребенка законным представителем в "
                                "период пребывания в организации отдыха детей и их оздоровления "
                                "и (или) нуждающегося в индивидуальной помощи в связи с "
                                "имеющимися физическими, психическими, интеллектуальными или "
                                "сенсорными нарушениями"
                            ),
                            blank("escortNeed", 20, grow=True, lines=1),
                            align="justify",
                        ),
                        row(
                            text("Отсутствие контакта с больными инфекционными заболеваниями"),
                            blank("noInfectionContact", 16, grow=True),
                        ),
                        row(
                            text("Осмотр на педикулез и чесотку"),
                            blank("pediculosisExam", 20, grow=True, lines=1),
                        ),
                        row(
                            text("Обследование на гельминтозы (энтеробиоз, гименолепидоз)"),
                            blank("helminthExam", 20, grow=True),
                        ),
                        row(
                            text(
                                "Отсутствие медицинских противопоказаний для пребывания в "
                                "организации отдыха детей и их оздоровления"
                            ),
                            blank("noContraindications", 20, grow=True, lines=2),
                            gap="small",
                        ),
                        row(
                            text(
                                "Должность, специальность, фамилия, имя, отчество (при "
                                "наличии) и подпись врача"
                            ),
                            gap="large",
                        ),
                        row(
                            blank("doctor", 40, grow=True, lines=2),
                            signature("doctorSignature"),
                        ),
                        row(
                            text(
                                "Фамилия, имя, отчество (при наличии) и подпись руководителя "
                                "медицинской организации"
                            ),
                            gap="large",
                        ),
                        row(
                            blank("head", 40, grow=True, lines=2),
                            signature("headSignature"),
                        ),
                        row(
                            {"kind": "stamp", "fieldId": "stamp", "text": "М.П. (при наличии)"},
                            gap="large",
                        ),
                        row(*date_blanks("formDate", month_length=18), text("г.")),
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
