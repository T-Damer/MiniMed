"""Reviewed blueprint of form 070/у (Минздрав order № 274н of 13.05.2025, appendices 5 and 6).

The blueprint is the human-reviewed reading of the scanned blank (appendix 5, PDF page 29): the
printed captions, the order of the lines and their approximate blank lengths (measured on the scan,
in printed characters), plus the binding of every field to the paragraph of «Порядок заполнения»
(appendix 6, PDF pages 30–36) that governs it. `medical_forms.prepare_form` checks each printed
caption against the OCR text of the blank page and cuts every cited paragraph from the OCR text of
the order, so a wrong anchor or paragraph fails the build instead of shipping silently.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    EFFECTIVE_FROM,
    EFFECTIVE_UNTIL,
    ICD10_MESSAGE,
    ICD10_PATTERN,
    ORDER_DATE,
    ORDER_NUMBER,
    ORDER_TITLE,
    REGISTRATION,
    SNILS_PATTERN,
    UNDEFINED_SIGNATURE_NOTE,
    address_fields,
    address_rows,
    blank,
    check,
    code_field,
    date_blanks,
    field_def,
    field_rule,
    options,
    row,
    signature,
    text,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.274n.070u"
FORM_NUMBER: Final = "070/у"
FORM_TITLE: Final = "Справка для получения путевки на санаторно-курортное лечение"
BLANK_APPENDIX: Final = 5
BLANK_PAGES: Final = (29,)
RULES_APPENDIX: Final = 6
RULES_PAGES: Final = (30, 31, 32, 33, 34, 35, 36)

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {30: 0.12, 31: 0.15, 34: 0.08, 35: 0.08}

_FOOTNOTE_MARK = "footnote reference mark recognised as punctuation"
_CAPITAL = "capital letter recognised for a lower-case word"
_FRAGMENT = "fragment of the next printed line merged into this one"
_DASH = "typographic dash printed in the list, recognised as a hyphen"
CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(31, "Федерации°, , в котором", "Федерации, в котором", _FOOTNOTE_MARK),
    Correction(32, "область - Кузбасс", "область – Кузбасс", _DASH),
    Correction(33, "Респуолика", "Республика", "OCR confuses б and у"),
    Correction(33, "Осетия - Алания", "Осетия – Алания", _DASH),
    Correction(33, "морской - континентальный", "морской – континентальный", _DASH),
    Correction(33, "округ- Югра", "округ – Югра", "spacing of the dash in the printed list"),
    Correction(34, "услуг?:", "услуг:", _FOOTNOTE_MARK),
    Correction(35, "направляется В санаторно", "направляется в санаторно", _CAPITAL),
    Correction(35, "143н°", "143н", _FOOTNOTE_MARK),
    Correction(35, "пребывания В : санаторно", "пребывания в санаторно", _FRAGMENT),
)


FIELDS: Final[list[dict[str, Any]]] = [
    field_def(
        "formNumber",
        "Справка №",
        "text",
        field_rule("undefined", note="Порядок не определяет нумерацию справок."),
        maxLength=40,
    ),
    field_def(
        "formDate",
        "Дата справки",
        "date",
        field_rule(
            "undefined",
            note=(
                "Порядок не определяет дату справки; п. 7 упоминает только дату выдачи "
                "в оттиске печати."
            ),
        ),
        required=True,
        basis="editorial",
        printed=False,
        anchor="года",
        prefill={"sources": ["today"]},
    ),
    field_def(
        "organization",
        "Наименование и адрес медицинской организации (фамилия, имя, отчество (при наличии) "
        "индивидуального предпринимателя и адрес осуществления медицинской деятельности)",
        "text",
        field_rule("undefined", note="Порядок не описывает заполнение шапки."),
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
        field_rule("undefined", note="Порядок не описывает заполнение шапки."),
        required=True,
        basis="editorial",
        anchor="Основной государственный регистрационный номер",
        prefill={"sources": ["organization.ogrn"]},
        pattern="^(?:[0-9]{13}|[0-9]{15})$",
        patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
    ),
    field_def(
        "patientFullName",
        "Фамилия, имя, отчество (при наличии) пациента",
        "text",
        field_rule("defined", "6.1"),
        required=True,
        prefill={"sources": ["patient.fullName"]},
        maxLength=200,
    ),
    field_def(
        "patientBirthDate",
        "Дата рождения",
        "date",
        field_rule("defined", "6.1"),
        required=True,
        prefill={"sources": ["patient.birthDate"]},
        notAfter="today",
    ),
    field_def(
        "patientSex",
        "Пол",
        "choice",
        field_rule("defined", "6.1"),
        required=True,
        prefill={"sources": ["patient.sex"], "map": {"male": "1", "female": "2"}},
        options=[{"value": "1", "label": "муж."}, {"value": "2", "label": "жен."}],
        anchor="Пол: муж. - 1, жен. - 2",
    ),
    *address_fields(
        "residence",
        "Регистрация по месту жительства: субъект Российской Федерации",
        "address",
        "Пункт 6.1 называет строку «Регистрация по месту жительства» целиком; её части "
        "(район, улица, телефон и др.) порядок отдельно не определяет.",
    ),
    *address_fields(
        "stay",
        "Регистрация по месту пребывания: субъект Российской Федерации",
        "stayAddress",
        "Пункт 6.1 называет строку «Регистрация по месту пребывания» целиком; её части "
        "(район, улица, телефон и др.) порядок отдельно не определяет.",
    ),
    field_def(
        "omsPolicyNumber",
        "Полис обязательного медицинского страхования",
        "text",
        field_rule("defined", "6.2"),
        required=True,
        prefill={"sources": ["patient.omsPolicy.number"]},
        maxLength=60,
    ),
    field_def(
        "omsPolicyIssueDate",
        "дата выдачи полиса обязательного медицинского страхования",
        "date",
        field_rule("defined", "6.2"),
        required=True,
        prefill={"sources": ["patient.omsPolicy.issuedAt"]},
        notAfter="today",
    ),
    field_def(
        "omsInsurer",
        "данные о страховой медицинской организации, выбранной застрахованным лицом или "
        "определенной застрахованному лицу",
        "text",
        field_rule("defined", "6.2"),
        required=True,
        anchor="данные о страховой медицинской организации",
        prefill={"sources": ["patient.omsPolicy.insurer"]},
        multiline=True,
        maxLength=300,
    ),
    code_field("regionCode", "Код субъекта Российской Федерации", "Код субъекта", ("6.3", "6.4")),
    code_field(
        "climateCode",
        "Климат в месте проживания пациента (код)",
        "Климат в месте проживания пациента",
        ("6.3", "6.5"),
    ),
    code_field(
        "climateFactorsCode",
        "Климатические факторы в месте проживания пациента (код)",
        "Климатические факторы в месте проживания пациента",
        ("6.3", "6.6"),
    ),
    code_field(
        "socialSupportCode",
        "Код меры социальной поддержки",
        "Код меры социальной поддержки",
        ("6.3", "6.7"),
    ),
    field_def(
        "escort",
        "Сопровождение",
        "choice",
        field_rule("defined", "6.3", "6.8"),
        options=[{"value": "1", "label": "да"}, {"value": "2", "label": "нет"}],
        anchor="Сопровождение: да - 1, нет - 2",
    ),
    field_def(
        "socialDocSeries",
        "серия",
        "text",
        field_rule("defined", "6.3", "6.9"),
        anchor="Документ, подтверждающий право на получение мер социальной поддержки",
        maxLength=40,
    ),
    field_def(
        "socialDocNumber",
        "номер",
        "text",
        field_rule("defined", "6.3", "6.9"),
        anchor="номер",
        maxLength=40,
    ),
    field_def(
        "socialDocIssueDate",
        "дата выдачи",
        "date",
        field_rule("defined", "6.3", "6.9"),
        anchor="дата выдачи",
        notAfter="today",
    ),
    field_def(
        "snils",
        "Страховой номер индивидуального лицевого счета",
        "text",
        field_rule("defined", "6.10"),
        required=True,
        prefill={"sources": ["patient.snils"]},
        pattern=SNILS_PATTERN,
        patternMessage="СНИЛС в формате 123-456-789 01",
    ),
    field_def(
        "diagnosis",
        "Диагноз заболевания, для лечения которого направляется в санаторно-курортную организацию",
        "text",
        field_rule("defined", "6.11"),
        required=True,
        anchor="Диагноз заболевания, для лечения которого направляется",
        prefill={"sources": ["episode.diagnosis.text"]},
        multiline=True,
        maxLength=300,
    ),
    field_def(
        "diagnosisIcd",
        "код по Международной статистической классификации болезней и проблем, связанных со "
        "здоровьем (далее – МКБ)",
        "icd10",
        field_rule("defined", "6.11"),
        required=True,
        anchor="классификации болезней и проблем, связанных со здоровьем",
        prefill={"sources": ["episode.diagnosis.icd10"]},
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
    ),
    field_def(
        "comorbidities",
        "Сопутствующие заболевания",
        "text",
        field_rule("defined", "6.11"),
        multiline=True,
        maxLength=300,
    ),
    field_def(
        "comorbiditiesIcd",
        "код по МКБ (сопутствующие заболевания)",
        "icd10",
        field_rule("defined", "6.11"),
        anchor="код по МКБ",
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
    ),
    field_def(
        "disabilityCause",
        "Заболевание, являющееся причиной инвалидности",
        "text",
        field_rule("defined", "6.11"),
        multiline=True,
        maxLength=300,
    ),
    field_def(
        "disabilityCauseIcd",
        "код по МКБ (причина инвалидности)",
        "icd10",
        field_rule("defined", "6.11"),
        anchor="код по МКБ",
        pattern=ICD10_PATTERN,
        patternMessage=ICD10_MESSAGE,
    ),
    field_def(
        "noContraindications",
        "Противопоказания для санаторно-курортного лечения отсутствуют",
        "checkbox",
        field_rule("defined", "6.11"),
    ),
    field_def(
        "treatmentSetting",
        "Рекомендуемое лечение",
        "choice",
        field_rule("defined", "6.12"),
        required=True,
        options=[
            {"value": "1", "label": "в условиях пребывания в санаторно-курортной организации"},
            {"value": "2", "label": "амбулаторно"},
        ],
        anchor="Рекомендуемое лечение: в условиях пребывания в санаторно-курортной организации",
    ),
    field_def(
        "preferredPlace",
        "Предпочтительное место лечения",
        "text",
        field_rule("defined", "6.12"),
        required=True,
        multiline=True,
        maxLength=300,
    ),
    field_def(
        "seasons",
        "Рекомендуемые сезоны лечения",
        "choice",
        field_rule("defined", "6.12"),
        required=True,
        multiple=True,
        options=[
            {"value": "1", "label": "зима"},
            {"value": "2", "label": "весна"},
            {"value": "3", "label": "лето"},
            {"value": "4", "label": "осень"},
        ],
        anchor="Рекомендуемые сезоны лечения: зима - 1, весна - 2, лето - 3, осень - 4",
    ),
    field_def(
        "attendingDoctor",
        "Лечащий врач, должность врача-специалиста",
        "text",
        field_rule("defined", "6.13"),
        required=True,
        prefill={"sources": ["clinician.position", "clinician.fullName"], "join": " "},
        maxLength=200,
    ),
    field_def(
        "attendingDoctorSignature",
        "подпись лечащего врача",
        "signature",
        field_rule("undefined", note=UNDEFINED_SIGNATURE_NOTE),
        anchor="подпись",
    ),
    field_def(
        "headOfDepartment",
        "Заведующий отделением",
        "text",
        field_rule("defined", "6.14"),
        required=True,
        maxLength=200,
    ),
    field_def(
        "headOfDepartmentSignature",
        "подпись заведующего отделением",
        "signature",
        field_rule("undefined", note=UNDEFINED_SIGNATURE_NOTE),
        anchor="подпись",
    ),
    field_def(
        "commissionChair",
        "Председатель врачебной комиссии",
        "text",
        field_rule("defined", "6.15"),
        required=True,
        maxLength=200,
    ),
    field_def(
        "commissionChairSignature",
        "подпись председателя врачебной комиссии",
        "signature",
        field_rule("undefined", note=UNDEFINED_SIGNATURE_NOTE),
        anchor="подпись",
    ),
    field_def(
        "stamp",
        "М.П. (при наличии)",
        "stamp",
        field_rule("defined", "7"),
    ),
]

# Choice fields whose options are the «code» - name list of a paragraph.
CODE_LISTS: Final = {
    "regionCode": "6.4",
    "climateCode": "6.5",
    "climateFactorsCode": "6.6",
    "socialSupportCode": "6.7",
}
# A list must be strictly ascending by numeric code (checked, then kept in printed order).
SEQUENTIAL_LISTS: Final = {"6.5": 9, "6.6": 9, "6.7": 10}

# --------------------------------------------------------------------------- screen sections

SECTIONS: Final[list[dict[str, Any]]] = [
    {"id": "certificate", "title": "Справка", "fieldIds": ["formNumber", "formDate"]},
    {
        "id": "organization",
        "title": "Организация",
        "description": "Подставляется из настроек «Врач и организация».",
        "fieldIds": ["organization", "organizationOgrn"],
    },
    {
        "id": "patient",
        "title": "Пациент",
        "fieldIds": ["patientFullName", "patientBirthDate", "patientSex", "snils"],
    },
    {
        "id": "residence",
        "title": "Регистрация по месту жительства",
        "fieldIds": [
            f"residence{part}"
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
        ],
    },
    {
        "id": "stay",
        "title": "Регистрация по месту пребывания",
        "fieldIds": [
            f"stay{part}"
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
        ],
    },
    {
        "id": "oms",
        "title": "Полис обязательного медицинского страхования",
        "fieldIds": ["omsPolicyNumber", "omsPolicyIssueDate", "omsInsurer"],
    },
    {
        "id": "social",
        "title": "Набор социальных услуг",
        "description": (
            "Заполняется только на граждан, имеющих право на набор социальных услуг (п. 6.3)."
        ),
        "fieldIds": [
            "regionCode",
            "climateCode",
            "climateFactorsCode",
            "socialSupportCode",
            "escort",
            "socialDocSeries",
            "socialDocNumber",
            "socialDocIssueDate",
        ],
    },
    {
        "id": "diagnoses",
        "title": "Диагнозы",
        "description": "Код по МКБ указывается обязательно (п. 6.11).",
        "fieldIds": [
            "diagnosis",
            "diagnosisIcd",
            "comorbidities",
            "comorbiditiesIcd",
            "disabilityCause",
            "disabilityCauseIcd",
            "noContraindications",
        ],
    },
    {
        "id": "recommendation",
        "title": "Рекомендуемое лечение",
        "description": (
            "Заполняется в соответствии с Перечнем медицинских показаний и "
            "противопоказаний (п. 6.12)."
        ),
        "fieldIds": ["treatmentSetting", "preferredPlace", "seasons"],
    },
    {
        "id": "signatories",
        "title": "Врач и подписи",
        "description": "Подписи и печать ставятся на бумажной форме.",
        "fieldIds": ["attendingDoctor", "headOfDepartment", "commissionChair"],
    },
]


# ------------------------------------------------------------------------------- print layout


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
                    "widthPercent": 51,
                    "align": "left",
                    "rows": [
                        row(text("Наименование и адрес медицинской организации")),
                        row(text("(фамилия, имя, отчество (при наличии) индивидуального")),
                        row(text("предпринимателя и адрес осуществления медицинской")),
                        row(text("деятельности)")),
                        row(text("Основной государственный регистрационный номер")),
                        row(text("(Основной государственный регистрационный")),
                        row(text("номер индивидуального предпринимателя)")),
                        row(blank("organization", 40, grow=True), gap="small"),
                        row(blank("organizationOgrn", 40, grow=True)),
                    ],
                },
                {
                    "widthPercent": 36,
                    "align": "center",
                    "rows": [
                        row(text("Медицинская документация")),
                        row(text("Учетная форма № 070/у")),
                        row(text("Утверждена приказом Министерства"), gap="small"),
                        row(text("здравоохранения Российской Федерации")),
                        row(text("от 13 мая 2025 г. № 274н")),
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
                            text("Справка №", bold=True),
                            blank("formNumber", 17),
                            align="center",
                            size="title",
                            gap="large",
                        ),
                        row(
                            text("для получения путевки на санаторно-курортное лечение", bold=True),
                            align="center",
                            size="title",
                        ),
                        row(
                            *date_blanks("formDate", month_length=12),
                            text("года", bold=True),
                            align="center",
                            size="title",
                        ),
                    ],
                }
            ],
        },
        {
            "id": "validity",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text(
                                "Настоящая справка не заменяет санаторно-курортной карты и не "
                                "дает права на санаторно-курортное лечение. Справка действительна "
                                "в течение 12 месяцев"
                            ),
                            align="justify",
                            gap="medium",
                        )
                    ],
                }
            ],
        },
        {
            "id": "patient",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text("Фамилия, имя, отчество (при наличии) пациента"),
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
                    ],
                }
            ],
        },
        {
            "id": "insurance",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text("Полис обязательного медицинского страхования:"),
                            blank("omsPolicyNumber", 40, grow=True),
                        ),
                        row(
                            text("дата выдачи полиса обязательного медицинского страхования"),
                            *date_blanks("omsPolicyIssueDate", month_length=12, year_length=6),
                            text("г."),
                        ),
                        row(
                            text(
                                "данные о страховой медицинской организации, выбранной "
                                "застрахованным лицом или определенной"
                            ),
                            align="justify",
                        ),
                        row(text("застрахованному лицу"), blank("omsInsurer", 40, grow=True)),
                    ],
                }
            ],
        },
        {
            "id": "social",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(text("Код субъекта Российской Федерации"), blank("regionCode", 6)),
                        row(
                            text("Климат в месте проживания пациента (код)"),
                            blank("climateCode", 5),
                        ),
                        row(
                            text("Климатические факторы в месте проживания пациента (код)"),
                            blank("climateFactorsCode", 6),
                        ),
                        row(text("Код меры социальной поддержки"), blank("socialSupportCode", 27)),
                        row(
                            text("Сопровождение: да – 1, нет - 2"),
                            blank("escort", 10),
                        ),
                        row(
                            text(
                                "Документ, подтверждающий право на получение мер социальной "
                                "поддержки в виде набора социальных услуг:"
                            )
                        ),
                        row(
                            text("серия"),
                            blank("socialDocSeries", 11),
                            text("номер"),
                            blank("socialDocNumber", 17),
                            text("дата выдачи"),
                            *date_blanks("socialDocIssueDate", month_length=11),
                            text("г."),
                        ),
                        row(
                            text("Страховой номер индивидуального лицевого счета:"),
                            blank("snils", 36),
                        ),
                    ],
                }
            ],
        },
        {
            "id": "diagnoses",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text(
                                "Диагноз заболевания, для лечения которого направляется в "
                                "санаторно-курортную организацию:"
                            ),
                            align="justify",
                        ),
                        row(
                            blank("diagnosis", 40, grow=True),
                            text("код по Международной статистической"),
                        ),
                        row(
                            text(
                                "классификации болезней и проблем, связанных со здоровьем "
                                "(далее – МКБ)"
                            ),
                            blank("diagnosisIcd", 27, grow=True),
                        ),
                        row(
                            text("Сопутствующие заболевания"),
                            blank("comorbidities", 30, grow=True),
                            text("код по МКБ"),
                            blank("comorbiditiesIcd", 16),
                        ),
                        row(
                            text("Заболевание, являющееся причиной инвалидности"),
                            blank("disabilityCause", 22, grow=True),
                            text("код по МКБ"),
                            blank("disabilityCauseIcd", 16),
                        ),
                    ],
                }
            ],
        },
        {
            "id": "recommendation",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text("Противопоказания для санаторно-курортного лечения отсутствуют"),
                            check("noContraindications"),
                            box="outline",
                            gap="medium",
                        ),
                        row(
                            text("Рекомендуемое лечение:"),
                            options("treatmentSetting", "; "),
                            gap="medium",
                        ),
                        row(
                            text("Предпочтительное место лечения"),
                            blank("preferredPlace", 40, grow=True),
                            box="split",
                            split_percent=30,
                            gap="medium",
                        ),
                        row(
                            text("Рекомендуемые сезоны лечения:"),
                            options("seasons"),
                            gap="medium",
                        ),
                    ],
                }
            ],
        },
        {
            "id": "signatures",
            "columns": [
                {
                    "widthPercent": 100,
                    "rows": [
                        row(
                            text("Лечащий врач, должность врача-специалиста"),
                            blank(
                                "attendingDoctor",
                                30,
                                grow=True,
                                caption="(фамилия, имя, отчество (при наличии)",
                            ),
                            signature("attendingDoctorSignature"),
                            gap="medium",
                        ),
                        row(
                            text("Заведующий отделением"),
                            blank(
                                "headOfDepartment",
                                30,
                                grow=True,
                                caption="(фамилия, имя, отчество (при наличии)",
                            ),
                            signature("headOfDepartmentSignature"),
                        ),
                        row(
                            text("Председатель врачебной комиссии"),
                            blank(
                                "commissionChair",
                                30,
                                grow=True,
                                caption="(фамилия, имя, отчество (при наличии)",
                            ),
                            signature("commissionChairSignature"),
                        ),
                        row(
                            {"kind": "stamp", "fieldId": "stamp", "text": "М.П. (при наличии)"},
                            gap="large",
                        ),
                    ],
                }
            ],
        },
    ],
}


NOTES: Final[list[str]] = [
    "Бланк 070/у (приложение № 5) не содержит строки о месте работы или учёбы; привязка "
    "patient.workplace для этой формы не используется.",
    "Обязательность полей (required) порядок прямо не задаёт: basis = source — пункт говорит, "
    "что в строке «указывается» значение; basis = editorial — вывод по виду бланка. Незаполненные "
    "обязательные поля подсвечиваются, печать не блокируется.",
    "Перечень кодов субъектов Российской Федерации в п. 6.4 печатного текста повторяет код 82 "
    "(Республика Дагестан) дважды; в схеме он указан один раз.",
    "Подписи на бумажной форме и дата справки порядком не определены (п. 8 касается только "
    "электронной подписи руководителя организации).",
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
    code_lists=dict(CODE_LISTS),
    sequential_lists=dict(SEQUENTIAL_LISTS),
    sections=SECTIONS,
    layout=LAYOUT,
    notes=NOTES,
)
