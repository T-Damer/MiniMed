"""Reviewed blueprint of the blank 148-1/у-04(л) (order 1094н of 24.11.2021, appendix 2).

The blank is printed on the lower part of PDF page 25 (the front down to the validity line; the
upper part of the page is the reverse side of 148-1/у-88) and on PDF page 26 (the pharmacy part
and the tear-off stub, which are the lower part of the front, then the reverse side). Requirements
for the lines: appendix 3 «Порядок оформления рецептурных бланков» (paragraphs 1–18) and appendix 1
«Порядок назначения лекарственных препаратов» (paragraphs 16, 17, 21, 22). The blank is for
citizens entitled to free or discounted medicines (appendix 1, paragraph 10); the print is a draft.
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import blank, field_def, field_rule, row, text
from localmed_ingest.medical_form_prescription import (
    FORM_TEXT_NOTES,
    SURNAME_INITIALS_NOTE,
    aligned,
    block,
    blueprint_kwargs,
    boxes,
    cells,
    column,
    first_row_space,
    opts,
    p1,
    p3,
    pct,
    reverse_blocks,
    rule,
    scaled,
    t,
    tight,
)
from localmed_ingest.medical_forms import FormBlueprint

FORM_ID: Final = "ru.minzdrav.1094n.148-1u-04l"
FORM_NUMBER: Final = "148-1/у-04(л)"
FORM_TITLE: Final = "Рецептурный бланк (льготный)"
BLANK_PAGES: Final = (25, 26)
# The blank starts under the reverse side of 148-1/у-88 (below the heading «Форма рецептурного
# бланка № 148-1/у-04(л)») and goes on over the whole of the next page.
BLANK_REGIONS: Final[dict[int, tuple[float, float]]] = {25: (0.0, 0.70), 26: (0.0, 0.935)}

NOT_DESCRIBED: Final = "Порядок не описывает эту графу."


def _undefined(
    field_id: str,
    label: str,
    *,
    anchor: str | None = None,
    max_length: int = 80,
    note: str | None = None,
) -> dict[str, Any]:
    return field_def(
        field_id,
        label,
        "text",
        field_rule("undefined", note=note or NOT_DESCRIBED),
        maxLength=max_length,
        anchor=anchor or label,
    )


FIELDS: Final[list[dict[str, Any]]] = [
    field_def(
        "barcode",
        "МЕСТО ДЛЯ ШТРИХКОДА",
        "stamp",
        field_rule(
            "defined",
            p3(5),
            note="Штрих-код — дополнительный реквизит бланка, изготовленного с помощью компьютера.",
        ),
        anchor="МЕСТО ДЛЯ ШТРИХКОДА",
    ),
    field_def(
        "organizationCode",
        "Код медицинской организации (ОГРН)",
        "text",
        field_rule(
            "defined",
            p3(1),
            p3(5),
            note=(
                "Код организации — ОГРН (13 цифр); для индивидуального предпринимателя — ОГРНИП "
                "(15 цифр) в строке ниже. Проставляется при изготовлении бланка."
            ),
        ),
        prefill={"sources": ["organization.ogrn"]},
        pattern="^[0-9]{13}$",
        patternMessage="ОГРН — 13 цифр",
        anchor="медицинской организации",
    ),
    field_def(
        "entrepreneurCode",
        "Код индивидуального предпринимателя (ОГРНИП)",
        "text",
        field_rule("defined", p3(5)),
        pattern="^[0-9]{15}$",
        patternMessage="ОГРНИП — 15 цифр",
        anchor="индивидуального предпринимателя",
    ),
    field_def(
        "categoryCode",
        "Код категории граждан",
        "text",
        field_rule(
            "defined",
            p3(5),
            note=(
                "Код категории граждан, имеющих право на получение лекарственных препаратов "
                "(статья 6.1 Федерального закона № 178-ФЗ); каждая цифра — в отдельной ячейке."
            ),
        ),
        pattern="^[0-9]{1,3}$",
        patternMessage="Код категории — до трёх цифр",
        anchor="Код категории граждан",
    ),
    field_def(
        "nosologyCode",
        "Код нозологической формы (по МКБ)",
        "icd10",
        field_rule(
            "defined",
            p3(5),
            note="Каждая цифра — в отдельной ячейке, точка — в отдельной ячейке.",
        ),
        prefill={"sources": ["episode.diagnosis.icd10"]},
        pattern="^[A-Z][0-9]{2}(?:\\.[0-9]{1,2})?$",
        patternMessage="Код МКБ-10 в формате J45.0",
        anchor="Код нозологической формы",
    ),
    field_def(
        "fundingSource",
        "Источник финансирования: (подчеркнуть)",
        "choice",
        field_rule("defined", p3(5)),
        options=[
            {"value": "1", "label": "1.Федеральный бюджет"},
            {"value": "2", "label": "2. Бюджет субъекта Российской Федерации"},
            {"value": "3", "label": "3. Муниципальный бюджет"},
        ],
        anchor="Источник финансирования:",
    ),
    field_def(
        "paymentPercent",
        "% оплаты: (подчеркнуть)",
        "choice",
        field_rule("defined", p3(5)),
        options=[
            {"value": "1", "label": "1. Бесплатно"},
            {"value": "2", "label": "2. 50 %"},
            {"value": "3", "label": "3. иной %"},
        ],
        anchor="% оплаты:",
    ),
    field_def(
        "series",
        "Серия",
        "text",
        field_rule(
            "defined",
            p3(1),
            note=(
                "Серия бланка включает код субъекта Российской Федерации — две первые цифры ОКАТО."
            ),
        ),
        maxLength=20,
        anchor="Серия",
    ),
    field_def(
        "number",
        "№",
        "text",
        field_rule("undefined", note="Порядок не описывает номер бланка."),
        maxLength=20,
        anchor="Серия",
    ),
    field_def(
        "recipeDate",
        "Дата оформления",
        "date",
        field_rule(
            "defined",
            p3(1),
            note="Пункт 1 требует дату выписки (оформления) рецепта на бланке.",
        ),
        required=True,
        prefill={"sources": ["today"]},
        notAfter="today",
        anchor="Дата оформления:",
    ),
    field_def(
        "patientFullName",
        "Фамилия, инициалы имени и отчества (последнее – при наличии) пациента",
        "text",
        field_rule("defined", p3(6), note=SURNAME_INITIALS_NOTE),
        required=True,
        prefill={"sources": ["patient.fullName"], "format": "initials"},
        maxLength=120,
        anchor="пациента",
    ),
    field_def(
        "patientBirthDate",
        "Дата рождения",
        "date",
        field_rule("defined", p3(7)),
        required=True,
        prefill={"sources": ["patient.birthDate"]},
        notAfter="today",
        anchor="Дата рождения",
    ),
    field_def(
        "snils",
        "СНИЛС",
        "text",
        field_rule("defined", p3(8), note="СНИЛС указывается при наличии."),
        prefill={"sources": ["patient.snils"]},
        anchor="СНИЛС",
    ),
    field_def(
        "omsPolicyNumber",
        "№ полиса обязательного медицинского страхования",
        "text",
        field_rule("defined", p3(8)),
        prefill={"sources": ["patient.omsPolicy.number"]},
        maxLength=40,
        anchor="№ полиса обязательного медицинского страхования",
    ),
    field_def(
        "medicalCardNumber",
        "Номер медицинской карты пациента, получающего медицинскую помощь в амбулаторных условиях",
        "text",
        field_rule("defined", p3(9)),
        maxLength=60,
        anchor="Номер медицинской карты пациента, получающего медицинскую помощь в амбулаторных",
    ),
    field_def(
        "doctorFullName",
        "Фамилия, инициалы имени и отчества (последнее – при наличии) лечащего врача "
        "(фельдшера, акушерки)",
        "text",
        field_rule("defined", p3(10), note=SURNAME_INITIALS_NOTE),
        required=True,
        prefill={"sources": ["clinician.fullName"], "format": "initials"},
        maxLength=120,
        anchor="лечащего врача (фельдшера, акушерки)",
    ),
    field_def(
        "prescription",
        "Rp:",
        "text",
        field_rule(
            "defined",
            p3(11),
            p3(15),
            p1(16),
            p1(17),
            note=(
                "На одном бланке разрешено назначение только одного наименования препарата "
                "(п. 15). Графы «Руб.» и «Коп.» порядок не описывает. Если рецепт выписан "
                "гражданину по пунктам 38–39 приложения № 1, он действителен 15 дней."
            ),
        ),
        required=True,
        maxLength=300,
        anchor="Rp:",
    ),
    field_def(
        "prescriptionContinued",
        "Rp: (продолжение, вторая строка)",
        "text",
        field_rule(
            "defined", p3(11), note="Вторая строка графы «Rp»: подписи к ней на бланке нет."
        ),
        printed=False,
        maxLength=300,
    ),
    field_def(
        "dtd",
        "D.t.d.",
        "text",
        field_rule(
            "by-line",
            p3(11),
            note=(
                "Пункт 11 называет графу «Rp» целиком (препарат, форма выпуска, дозировка, "
                "количество); строку «D.t.d.» (Da tales doses, приложение № 2 к Порядку "
                "назначения) отдельно не определяет."
            ),
        ),
        maxLength=200,
        anchor="D.t.d.",
    ),
    field_def(
        "signa",
        "Signa:",
        "text",
        field_rule(
            "by-line",
            p3(11),
            p1(17),
            note="Строка «Signa:» — способ применения лекарственного препарата (п. 11, подп. 2).",
        ),
        required=True,
        maxLength=300,
        anchor="Signa:",
    ),
    field_def(
        "doctorSignature",
        "Подпись и печать лечащего врача (подпись фельдшера, акушерки)",
        "signature",
        field_rule("defined", p3(14)),
        anchor="Подпись и печать лечащего врача",
    ),
    field_def(
        "doctorSeal",
        "М.П.",
        "stamp",
        field_rule(
            "defined",
            p3(14),
            note="Рецепт дополнительно заверяется печатью медицинской организации «Для рецептов».",
        ),
        anchor="М.П.",
    ),
    field_def(
        "validity",
        "Рецепт действителен в течение 15 дней, 30 дней, 90 дней (нужное подчеркнуть)",
        "choice",
        field_rule("defined", p1(21), p1(22)),
        options=[
            {"value": "15", "label": "15 дней"},
            {"value": "30", "label": "30 дней"},
            {"value": "90", "label": "90 дней"},
        ],
        anchor="Рецепт действителен в течение 15 дней, 30 дней, 90 дней",
    ),
    _undefined("pharmacyDispensed", "Отпущено по рецепту:"),
    _undefined("pharmacyTradeName", "Торговое наименование и дозировка:"),
    field_def(
        "pharmacyDate",
        "Дата отпуска",
        "date",
        field_rule("undefined", note=NOT_DESCRIBED),
        anchor="Дата отпуска:",
    ),
    _undefined("pharmacyQuantity", "Количество:"),
    _undefined("pharmacyPrepared", "Приготовил:"),
    _undefined("pharmacyChecked", "Проверил:"),
    _undefined("pharmacyReleased", "Отпустил:"),
    *[
        field_def(
            field_id,
            label,
            "text",
            field_rule(
                "defined",
                p3(18),
                note=(
                    "Корешок выдаётся пациенту в аптечной организации; на нём делается отметка о "
                    "наименовании, дозировке, количестве и способе применения."
                ),
            ),
            maxLength=200,
            anchor=label,
        )
        for field_id, label in (
            ("stubDrug", "Наименование лекарственного препарата:"),
            ("stubDose", "Дозировка:"),
            ("stubMethod", "Способ применения:"),
            ("stubDuration", "Продолжительность"),
            ("stubTimesPerDay", "Количество приемов в день:"),
            ("stubPerDose", "На 1 прием:"),
        )
    ],
    field_def(
        "commissionMark",
        "Отметка о назначении лекарственного препарата по решению врачебной комиссии",
        "stamp",
        field_rule("defined", p3(17)),
        anchor="Отметка о назначении лекарственного препарата по решению врачебной комиссии",
    ),
    _undefined(
        "reversePrepared", "Приготовил", note="Порядок не описывает эти графы оборотной стороны."
    ),
    _undefined(
        "reverseChecked", "Проверил", note="Порядок не описывает эти графы оборотной стороны."
    ),
    _undefined(
        "reverseReleased", "Отпустил", note="Порядок не описывает эти графы оборотной стороны."
    ),
]

SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "organization",
        "title": "Организация и бланк",
        "fieldIds": ["organizationCode", "entrepreneurCode", "series", "number"],
    },
    {
        "id": "benefit",
        "title": "Льготная категория",
        "fieldIds": ["categoryCode", "nosologyCode", "fundingSource", "paymentPercent"],
    },
    {
        "id": "patient",
        "title": "Пациент",
        "fieldIds": [
            "patientFullName",
            "patientBirthDate",
            "snils",
            "omsPolicyNumber",
            "medicalCardNumber",
        ],
    },
    {
        "id": "recipe",
        "title": "Рецепт",
        "fieldIds": [
            "recipeDate",
            "prescription",
            "prescriptionContinued",
            "dtd",
            "signa",
            "validity",
        ],
    },
    {"id": "doctor", "title": "Врач", "fieldIds": ["doctorFullName"]},
    {
        "id": "pharmacy",
        "title": "Заполняет аптечная организация",
        "fieldIds": [
            "pharmacyDispensed",
            "pharmacyTradeName",
            "pharmacyDate",
            "pharmacyQuantity",
            "pharmacyPrepared",
            "pharmacyChecked",
            "pharmacyReleased",
        ],
    },
    {
        "id": "stub",
        "title": "Корешок рецептурного бланка",
        "description": "Отметку на корешке делает аптечная организация.",
        "fieldIds": [
            "stubDrug",
            "stubDose",
            "stubMethod",
            "stubDuration",
            "stubTimesPerDay",
            "stubPerDose",
        ],
    },
    {
        "id": "reverse",
        "title": "Оборотная сторона",
        "description": "Графы заполняет аптечная организация.",
        "fieldIds": ["reversePrepared", "reverseChecked", "reverseReleased"],
    },
]

MARGIN_LEFT: Final = 25.4
MARGIN_RIGHT: Final = 3.0  # the line «от «24» ноября 2021 г. № 1094н» ends at 207 mm on the scan
CONTENT_MM: Final = 210 - MARGIN_LEFT - MARGIN_RIGHT


def _w(width_mm: float) -> float:
    return pct(width_mm, CONTENT_MM)


def _x(x_mm: float) -> float:
    """Indent that puts the first thing of a line at `x_mm` on the scan page."""
    return round(x_mm - MARGIN_LEFT, 2)


def _code_stamp(block_id: str, caption: str, field_id: str) -> dict[str, Any]:
    """«Штамп / Код / <caption>» with its two combs: five empty cells, the 15 cells of the code."""
    return block(
        block_id,
        column(
            _w(60),
            scaled(
                tight(
                    aligned(
                        row(t("Штамп", indent=_x(29.0)), boxes(5, 4.64, height=5.8, indent=7.3)),
                        "top",
                    ),
                    3.5,
                ),
                0.72,
            ),
            scaled(row(t("Код", indent=_x(29.0))), 0.72),
            scaled(row(t(caption, indent=_x(29.0))), 0.72),
            tight(
                row(cells(field_id, 15, 3.2, height=3.6, indent=_x(29.7), digits=True)),
                3.6,
            ),
        ),
    )


def _choice_cell(field_id: str, heading: list[str], count: int) -> dict[str, Any]:
    """A cell of the benefit table: a heading and the numbered choices, the picked underlined."""
    segments: list[dict[str, Any]] = [t("\n".join(heading))]
    for index in range(count):
        segments.append(t("\n"))
        segments.append(opts(field_id, only=(index, index + 1)))
    return {"rowSpan": 2, "segments": segments}


def _cell_field(field_id: str, length: float, *, plain: bool = False) -> dict[str, Any]:
    segment: dict[str, Any] = {"kind": "field", "fieldId": field_id, "length": length}
    if plain:
        segment["plain"] = True
    return segment


def _pharmacy_table() -> dict[str, Any]:
    def cell(*segments: dict[str, Any]) -> dict[str, Any]:
        return {"segments": list(segments)}

    return {
        "kind": "table",
        "header": [],
        "columnWeights": [85.5, 88.4],
        "minRowHeightMm": 8.4,
        "cellPaddingMm": {"x": 1.2, "y": 0.3, "top": 0.8},
        "rows": [
            [
                cell(
                    t("Отпущено по рецепту:", underline=True),
                    _cell_field("pharmacyDispensed", 12, plain=True),
                ),
                cell(
                    t("Торговое наименование и дозировка:"),
                    _cell_field("pharmacyTradeName", 12, plain=True),
                ),
            ],
            [
                cell(
                    t("Дата отпуска: «"),
                    {**_cell_field("pharmacyDate", 3), "part": "day"},
                    t("»", joined=True),
                    {**_cell_field("pharmacyDate", 14), "part": "month"},
                    t("20"),
                    {**_cell_field("pharmacyDate", 3), "part": "year2"},
                    t("г."),
                ),
                cell(t("Количество:"), _cell_field("pharmacyQuantity", 12, plain=True)),
            ],
            [
                cell(t("Приготовил:"), _cell_field("pharmacyPrepared", 12, plain=True)),
                cell(
                    t("Проверил:"),
                    _cell_field("pharmacyChecked", 8, plain=True),
                    t("Отпустил:", indent=14),
                    _cell_field("pharmacyReleased", 8, plain=True),
                ),
            ],
        ],
    }


def _stub_table() -> dict[str, Any]:
    def cell(*segments: dict[str, Any]) -> dict[str, Any]:
        return {"segments": list(segments)}

    return {
        "kind": "table",
        "header": [],
        "columnWeights": [85, 89],
        "cellPaddingMm": {"x": 1.2, "y": 0.5, "top": 0.8},
        "rows": [
            [
                cell(
                    t("Корешок рецептурного бланка", underline=True),
                    t("\nНаименование\nлекарственного препарата:"),
                    _cell_field("stubDrug", 12, plain=True),
                    t("\nДозировка:"),
                    _cell_field("stubDose", 26),
                ),
                cell(
                    t("Способ применения:"),
                    _cell_field("stubMethod", 12, plain=True),
                    t("\nПродолжительность"),
                    _cell_field("stubDuration", 19),
                    t("дней", indent=1),
                    t("\n\nКоличество приемов в день:"),
                    _cell_field("stubTimesPerDay", 14),
                    t("раз", indent=1),
                    t("\nНа 1 прием:"),
                    _cell_field("stubPerDose", 25),
                    t("ед.", indent=1),
                ),
            ]
        ],
    }


def _layout() -> dict[str, Any]:
    blocks: list[dict[str, Any]] = [
        block(
            "head",
            column(
                _w(58),
                row(t("Министерство здравоохранения", indent=_x(29.0))),
                row(t("Российской Федерации", indent=_x(29.0))),
                row(t("здравоохранения", indent=_x(29.0))),
            ),
            column(
                _w(52),
                row({"kind": "stamp", "fieldId": "barcode", "text": "МЕСТО ДЛЯ ШТРИХКОДА*"}),
            ),
            column(
                _w(70),
                row(text("УТВЕРЖДЕНА")),
                row(text("приказом Министерства")),
                row(text("Российской Федерации")),
                row(
                    text("от «"),
                    t("24", underline=True, joined=True),
                    t("»", joined=True),
                    t("ноября", underline=True),
                    text("2021 г. №"),
                    t("1094н", underline=True, joined=True),
                ),
                align="center",
            ),
            gap=2,
        ),
        _code_stamp("stamp-organization", "медицинской организации", "organizationCode"),
        _code_stamp("stamp-entrepreneur", "индивидуального предпринимателя", "entrepreneurCode"),
        block(
            "okud",
            column(
                100,
                row(t("Код формы по ОКУД 3108805", indent=_x(141.7))),
                row(t("Форма № 148-1/у-04(л)", indent=_x(155.7))),
            ),
        ),
        block(
            "benefit-table",
            column(
                _w(174.8),
                scaled(
                    row(
                        {
                            "kind": "table",
                            "header": [],
                            "columnWeights": [31.1, 51.9, 56.5, 34.9],
                            "cellPaddingMm": {"x": 1.0, "y": 0.3, "top": 1.2},
                            "rows": [
                                [
                                    {
                                        "segments": [t("Код категории\nграждан\n\n\n\n\u00a0")],
                                        "align": "center",
                                    },
                                    {
                                        "segments": [
                                            t("Код нозологической формы\n(по МКБ)\n\n\n\n\u00a0")
                                        ],
                                        "align": "center",
                                    },
                                    _choice_cell(
                                        "fundingSource",
                                        ["Источник финансирования:", "(подчеркнуть)", ""],
                                        3,
                                    ),
                                    _choice_cell(
                                        "paymentPercent", ["% оплаты:", "(подчеркнуть)", ""], 3
                                    ),
                                ],
                                [
                                    {"segments": [cells("categoryCode", 3, 10.4, height=5.6)]},
                                    {"segments": [cells("nosologyCode", 5, 10.4, height=5.6)]},
                                ],
                            ],
                        }
                    ),
                    0.72,
                ),
            ),
        ),
        block(
            "recipe-line",
            column(
                100,
                tight(
                    aligned(
                        row(
                            t("РЕЦЕПТ", indent=_x(29.4), large=True),
                            t("Серия", indent=_x(57.9) - 21, small=True),
                            blank("series", 12),
                            t("№", small=True),
                            blank("number", 9),
                            t("Дата оформления:"),
                            cells("recipeDate", 2, 3.2, height=6.8, part="day"),
                            cells("recipeDate", 2, 3.2, height=6.8, part="monthNumber", indent=5),
                            t("20", indent=1),
                            blank("recipeDate", 1.5, part="year2"),
                            text("г."),
                        ),
                        "center",
                    ),
                    5.4,
                ),
            ),
        ),
        block(
            "patient",
            column(
                100,
                tight(
                    row(
                        t(
                            "Фамилия, инициалы имени и отчества (последнее – при наличии)",
                            indent=_x(29.4),
                        )
                    ),
                    3.9,
                ),
                tight(
                    aligned(
                        row(
                            t("пациента", indent=_x(29.0)),
                            blank("patientFullName", 36),
                            t("Дата рождения"),
                            cells("patientBirthDate", 2, 3.2, height=8.1, part="day", indent=1.5),
                            cells(
                                "patientBirthDate",
                                2,
                                3.2,
                                height=8.1,
                                part="monthNumber",
                                indent=5,
                            ),
                            cells("patientBirthDate", 4, 3.2, height=8.1, part="year", indent=5),
                        ),
                        "center",
                    ),
                    4.4,
                ),
            ),
        ),
        block(
            "snils",
            column(
                _w(149.5),
                row(
                    {
                        "kind": "table",
                        "header": [],
                        "columnWeights": [21.4, 128.1],
                        "cellPaddingMm": {"x": 0, "y": 0.2},
                        "rows": [
                            [
                                {"segments": [t("СНИЛС", large=True)]},
                                {"segments": [cells("snils", 20, 6.4, height=5.5, digits=True)]},
                            ]
                        ],
                    }
                ),
            ),
        ),
        block(
            "oms",
            column(
                _w(174.6),
                scaled(
                    row(
                        {
                            "kind": "table",
                            "header": [],
                            "columnWeights": [21.4, 153.2],
                            "cellPaddingMm": {"x": 0.3, "y": 0.2},
                            "rows": [
                                [
                                    {
                                        "segments": [
                                            t("№ полиса обязательного медицинского страхования:")
                                        ]
                                    },
                                    {
                                        "segments": [
                                            cells(
                                                "omsPolicyNumber", 24, 6.38, height=13, digits=True
                                            )
                                        ]
                                    },
                                ]
                            ],
                        }
                    ),
                    0.72,
                ),
            ),
        ),
        block(
            "card",
            column(
                100,
                row(
                    t(
                        "Номер медицинской карты пациента, получающего медицинскую помощь в "
                        "амбулаторных",
                        indent=_x(29.4),
                    )
                ),
                row(t("условиях", indent=_x(28.9)), blank("medicalCardNumber", 40, grow=True)),
            ),
        ),
        block(
            "doctor",
            column(
                100,
                row(
                    t(
                        "Фамилия, инициалы имени и отчества (последнее – при наличии)",
                        indent=_x(29.8),
                    )
                ),
                row(
                    t("лечащего врача (фельдшера, акушерки)", indent=_x(29.4)),
                    blank("doctorFullName", 40, grow=True),
                ),
            ),
        ),
        block(
            "rp",
            column(
                100,
                row(
                    t("Руб.", indent=_x(29.8)),
                    t("Коп.", indent=5.1),
                    t("Rp:", indent=5.1),
                    _dotted("prescription"),
                ),
                row(_dotted("prescriptionContinued", indent=_x(61.0))),
                row(t("D.t.d.", indent=_x(61.0)), _dotted("dtd")),
                row(t("Signa:", indent=_x(60.9)), _dotted("signa")),
            ),
        ),
        block("rp-end", column(_w(160), row(rule(40)))),
        block(
            "signature",
            column(
                100,
                row(
                    {
                        "kind": "stamp",
                        "fieldId": "doctorSignature",
                        "text": "Подпись и печать лечащего врача",
                        "indentMm": _x(29.4),
                    }
                ),
                row(
                    t("(подпись фельдшера, акушерки)", indent=_x(29.4)),
                    {"kind": "stamp", "fieldId": "doctorSeal", "text": "М.П.", "indentMm": 60},
                ),
            ),
        ),
        block(
            "validity",
            column(
                100,
                row(
                    t("Рецепт действителен в течение", indent=_x(52.2)),
                    opts("validity"),
                    t("(нужное подчеркнуть)"),
                ),
            ),
        ),
        # second sheet: the pharmacy part and the stub of the front, then the reverse side
        block(
            "pharmacy-title",
            column(
                _w(154.1),
                row(
                    rule(22.8, style="dashed", indent=_x(45.6)),
                    text("(Заполняется специалистом аптечной организации)"),
                    rule(26.4, style="dashed"),
                ),
            ),
            page_break=True,
        ),
        block("pharmacy", column(_w(173.9), row({"kind": "table", **_pharmacy_table_body()}))),
        block(
            "tear-off",
            column(
                _w(170),
                row(
                    rule(60, style="dashed", indent=_x(29.7)),
                    text("(линия отрыва)"),
                    rule(60, style="dashed"),
                ),
            ),
        ),
        block("stub", column(_w(174.2), row({"kind": "table", **_stub_table_body()}))),
        block("footnote-rule", column(_w(56), row(rule(26, style="dashed", indent=_x(30.1))))),
        block(
            "footnote",
            column(
                100,
                row(
                    t(
                        "<*> В случае изготовления рецептурного бланка с использованием "
                        "компьютерных технологий",
                        indent=_x(29.4),
                    )
                ),
            ),
        ),
        *reverse_blocks(
            ("reversePrepared", "reverseChecked", "reverseReleased"),
            CONTENT_MM,
            box_mm=26.0,
            head_mm=8.1,
            body_mm=7.6,
            table_gap=6.0,
            page_break=False,
            box_width_mm=83.1,
            right_inset_mm=207 - 195.5,
            table_width_mm=170.2,
        ),
    ]
    first_row_space(blocks[0], 73.3, 77.3, 72.9)
    first_row_space(next(b for b in blocks if b["id"] == "pharmacy-title"), 3.2)
    return {
        "page": {
            "size": "A4",
            "orientation": "portrait",
            "marginMm": {"top": 18, "right": MARGIN_RIGHT, "bottom": 3, "left": MARGIN_LEFT},
            "fontSizePt": 12,
        },
        "blocks": blocks,
    }


def _dotted(field_id: str, *, indent: float | None = None) -> dict[str, Any]:
    segment: dict[str, Any] = {
        "kind": "field",
        "fieldId": field_id,
        "length": 40,
        "grow": True,
        "lineStyle": "dotted",
    }
    if indent is not None:
        segment["indentMm"] = indent
    return segment


def _pharmacy_table_body() -> dict[str, Any]:
    body = _pharmacy_table()
    del body["kind"]
    return body


def _stub_table_body() -> dict[str, Any]:
    body = _stub_table()
    del body["kind"]
    return body


LAYOUT: Final[dict[str, Any]] = _layout()

NOTES: Final[list[str]] = [
    *FORM_TEXT_NOTES,
    "Бланк 148-1/у-04(л) оформляется при назначении лекарственных препаратов гражданам, имеющим "
    "право на бесплатное получение лекарственных препаратов или получение их со скидкой (п. 10 "
    "приложения № 1); на бумаге оформляются два экземпляра: один остаётся в аптечной организации, "
    "второй — в медицинской документации пациента (п. 35 приложения № 1).",
    "Срок действия: 30 дней со дня оформления; 90 дней для граждан, достигших пенсионного "
    "возраста, инвалидов первой группы, детей-инвалидов и граждан с хроническими заболеваниями, "
    "требующими длительного курсового лечения; 15 дней в случаях пунктов 38 и 39 (п. 21, 22 "
    "приложения № 1).",
    "В бланке напечатано «Министерство здравоохранения / Российской Федерации / "
    "здравоохранения»: повтор слова «здравоохранения» воспроизведён как в приказе.",
    "Страница приказа 26 — продолжение лицевой стороны (часть для аптечной организации и "
    "корешок, линия отрыва) и оборотная сторона на одной странице; так они и воспроизведены.",
    "Серия бланка включает код субъекта Российской Федерации — две первые цифры ОКАТО (п. 1 "
    "приложения № 3); код организации — ОГРН, предпринимателя — ОГРНИП, при изготовлении бланка "
    "(п. 5). Цифры кода категории и МКБ заносятся по одной в ячейку, точка МКБ — в отдельную "
    "ячейку (п. 5).",
]

BLUEPRINT: Final = FormBlueprint(
    form_id=FORM_ID,
    form_number=FORM_NUMBER,
    title=FORM_TITLE,
    blank_pages=BLANK_PAGES,
    blank_regions=dict(BLANK_REGIONS),
    fields=FIELDS,
    sections=SECTIONS,
    layout=LAYOUT,
    notes=NOTES,
    scan_reviewed_captions=("Код категории граждан", "% оплаты:", "Rp:"),
    **blueprint_kwargs(),
)
