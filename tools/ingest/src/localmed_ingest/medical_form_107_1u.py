"""Reviewed blueprint of the prescription blank 107-1/у (order 1094н of 24.11.2021, appendix 2).

The blank is printed on PDF page 23 (front) and on the upper part of PDF page 24 (reverse side: the
mark of the врачебная комиссия and the pharmacy cells); the rest of page 24 is the next blank
(148-1/у-88). Requirements for the lines: appendix 3 «Порядок оформления рецептурных бланков»
(paragraphs 1–18) and appendix 1 «Порядок назначения лекарственных препаратов»
(paragraphs 16, 17, 23).
The print is a draft for the doctor: the organisation prints its own blanks (see the notes).
"""

from __future__ import annotations

from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    blank,
    date_blanks,
    field_def,
    field_rule,
    options,
    row,
    text,
)
from localmed_ingest.medical_form_prescription import (
    FORM_TEXT_NOTES,
    SURNAME_INITIALS_NOTE,
    block,
    blueprint_kwargs,
    column,
    first_row_space,
    p1,
    p3,
    pct,
    plain_field,
    reverse_blocks,
    rule,
    ruled_field,
    t,
    tight,
)
from localmed_ingest.medical_forms import FormBlueprint

FORM_ID: Final = "ru.minzdrav.1094n.107-1u"
FORM_NUMBER: Final = "107-1/у"
FORM_TITLE: Final = "Рецептурный бланк"
BLANK_PAGES: Final = (23, 24)
# Share of each scan page (origin at the bottom) that belongs to this blank: the page 23 below the
# appendix header and the heading «Форма рецептурного бланка № 107-1/у», and the reverse side at
# the top of page 24 (the next heading and blank follow below).
BLANK_REGIONS: Final[dict[int, tuple[float, float]]] = {23: (0.0, 0.77), 24: (0.735, 0.935)}

UNDEFINED_HEADER: Final = "Порядок не описывает эту графу шапки бланка."

FIELDS: Final[list[dict[str, Any]]] = [
    field_def(
        "okudCode",
        "Код формы по ОКУД",
        "text",
        field_rule("undefined", note="Порядок не описывает; на бланке код формы не напечатан."),
        maxLength=20,
    ),
    field_def(
        "okpoCode",
        "Код учреждения по ОКПО",
        "text",
        field_rule("undefined", note=UNDEFINED_HEADER),
        maxLength=20,
    ),
    field_def(
        "organizationStamp",
        "Наименование (штамп) медицинской организации",
        "text",
        field_rule(
            "defined",
            p3(1),
            note=(
                "Штамп содержит наименование, адрес и телефон организации; телефон приложение "
                "не хранит. Заполняется либо штамп организации, либо штамп индивидуального "
                "предпринимателя."
            ),
        ),
        prefill={"sources": ["organization.name", "organization.address"], "join": ", "},
        multiline=True,
        maxLength=400,
        anchor="медицинской организации",
    ),
    field_def(
        "entrepreneurStamp",
        "Наименование (штамп) индивидуального предпринимателя (указать адрес, номер и дату "
        "лицензии, наименование органа государственной власти, выдавшего лицензию)",
        "text",
        field_rule("defined", p3(2)),
        multiline=True,
        maxLength=500,
        anchor="индивидуального предпринимателя",
    ),
    field_def(
        "recipeKind",
        "РЕЦЕПТ (взрослый, детский – нужное подчеркнуть)",
        "choice",
        field_rule("undefined", note="Порядок не описывает отметку «взрослый, детский»."),
        options=[{"value": "adult", "label": "взрослый"}, {"value": "child", "label": "детский"}],
        anchor="(взрослый, детский - нужное подчеркнуть)",
    ),
    field_def(
        "recipeDate",
        "Дата выписки (оформления) рецепта",
        "date",
        field_rule(
            "defined",
            p3(1),
            note="Пункт 1 требует дату выписки (оформления) рецепта на бланке; подписи нет.",
        ),
        required=True,
        printed=False,
        prefill={"sources": ["today"]},
        notAfter="today",
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
        field_rule(
            "defined",
            p3(7),
            note=(
                "Для детей до 1 года в графе указывается ещё количество полных месяцев; поле "
                "хранит дату, месяцы дописываются от руки."
            ),
        ),
        required=True,
        prefill={"sources": ["patient.birthDate"]},
        notAfter="today",
        anchor="Дата рождения",
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
]

RP_NOTE: Final = (
    "На одном бланке разрешено до трёх наименований препаратов, но только одно — для "
    "антипсихотических, анксиолитиков, снотворных, седативных и антидепрессантов, "
    "не подлежащих предметно-количественному учету (п. 15). Графы «руб.|коп.» порядок не описывает."
)
for index in (1, 2, 3):
    FIELDS.append(
        field_def(
            f"prescription{index}",
            f"Rp. (препарат {index})",
            "text",
            field_rule("defined", p3(11), p3(15), p1(16), p1(17), note=RP_NOTE),
            required=index == 1,
            basis="source",
            multiline=True,
            maxLength=600,
            anchor="Rp.",
        )
    )
FIELDS.extend(
    [
        field_def(
            "validity",
            "Рецепт действителен в течение 60 дней, до 1 года (нужное подчеркнуть)",
            "choice",
            field_rule("defined", p1(23)),
            options=[{"value": "60", "label": "60 дней"}, {"value": "year", "label": "до 1 года"}],
            anchor="Рецепт действителен в течение 60 дней, до 1 года",
        ),
        field_def(
            "validityDays",
            "(указать количество дней)",
            "text",
            field_rule(
                "by-line",
                p1(23),
                note=(
                    "Пункт 23 говорит о сроке до одного года с надписью «По специальному "
                    "назначению» и периодичностью отпуска; сама графа в нём не названа."
                ),
            ),
            maxLength=40,
            anchor="(указать количество дней)",
        ),
        field_def(
            "doctorSignature",
            "Подпись и печать лечащего врача (подпись фельдшера, акушерки)",
            "signature",
            field_rule("defined", p3(14)),
            anchor="Подпись",
        ),
        field_def(
            "doctorSeal",
            "М.П.",
            "stamp",
            field_rule("defined", p3(14), note="Для 107-1/у печать «Для рецептов» не обязательна."),
            anchor="М.П.",
        ),
        field_def(
            "commissionMark",
            "Отметка о назначении лекарственного препарата по решению врачебной комиссии",
            "stamp",
            field_rule("defined", p3(17)),
            anchor="Отметка о назначении лекарственного препарата по решению врачебной комиссии",
        ),
        *[
            field_def(
                field_id,
                label,
                "text",
                field_rule("undefined", note="Порядок не описывает эти графы оборотной стороны."),
                maxLength=80,
                anchor=label,
            )
            for field_id, label in (
                ("pharmacyPrepared", "Приготовил"),
                ("pharmacyChecked", "Проверил"),
                ("pharmacyReleased", "Отпустил"),
            )
        ],
    ]
)

SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "organization",
        "title": "Организация",
        "fieldIds": ["okudCode", "okpoCode", "organizationStamp", "entrepreneurStamp"],
    },
    {
        "id": "recipe",
        "title": "Рецепт",
        "fieldIds": [
            "recipeKind",
            "recipeDate",
            "prescription1",
            "prescription2",
            "prescription3",
            "validity",
            "validityDays",
        ],
    },
    {"id": "patient", "title": "Пациент", "fieldIds": ["patientFullName", "patientBirthDate"]},
    {"id": "doctor", "title": "Врач", "fieldIds": ["doctorFullName"]},
    {
        "id": "reverse",
        "title": "Оборотная сторона",
        "description": "Графы заполняет аптечная организация.",
        "fieldIds": ["pharmacyPrepared", "pharmacyChecked", "pharmacyReleased"],
    },
]


MARGIN_LEFT: Final = 29.4
MARGIN_RIGHT: Final = 15.2  # the blank's rules and boxes end at 194.8 mm on the scan
CONTENT_MM: Final = 210 - MARGIN_LEFT - MARGIN_RIGHT


def _w(width_mm: float) -> float:
    return pct(width_mm, CONTENT_MM)


def _prescription(index: int) -> list[dict[str, Any]]:
    return [
        block(
            f"rp{index}",
            column(
                _w(68),
                tight(row(text("руб.|коп.| Rp.")), 2.85),
                row(ruled_field(f"prescription{index}", 2, pitch=4.15)),
            ),
        ),
        block(f"rp{index}-end", column(_w(91), tight(row(rule(style="dashed")), 3.43))),
    ]


def _layout() -> dict[str, Any]:
    header_left, header_right, header_gap = _w(85.7), _w(77.7), 2
    blocks = [
        block(
            "header-top",
            column(
                header_left,
                row(text("Министерство здравоохранения")),
                row(text("Российской Федерации")),
            ),
            column(
                header_right,
                row(text("Код формы по ОКУД"), plain_field("okudCode")),
                row(text("Код учреждения по ОКПО"), plain_field("okpoCode")),
            ),
            gap=header_gap,
        ),
        block(
            "documentation",
            column(_w(154.4), row(text("Медицинская документация")), align="center"),
        ),
        block(
            "header-stamps",
            column(
                header_left,
                row(text("Наименование (штамп)")),
                row(text("медицинской организации")),
                row(plain_field("organizationStamp", 40, grow=True)),
                row(text("Наименование (штамп)")),
                row(text("индивидуального предпринимателя")),
                row(text("(указать адрес, номер и дату лицензии,")),
                row(text("наименование органа государственной власти,")),
                row(text("выдавшего лицензию)")),
                row(plain_field("entrepreneurStamp", 40, grow=True)),
            ),
            column(
                header_right,
                row(text("Форма № 107-1/у")),
                row(text("Утверждена приказом")),
                row(text("Министерства здравоохранения")),
                row(text("Российской Федерации")),
                row(
                    text("от"),
                    t("24 ноября 2021 г.", underline=True),
                    t("№", indent=11.5),
                    t("1094н", underline=True),
                ),
            ),
            gap=header_gap,
        ),
        block("separator", column(100, row(rule(style="dashed")))),
        block(
            "recipe-title",
            column(
                100,
                row(t("РЕЦЕПТ", large=True), align="center"),
                row(
                    text("("),
                    {**options("recipeKind", ", ", codes=False, underline=True), "joined": True},
                    text("– нужное подчеркнуть)"),
                    align="center",
                ),
                row(*date_blanks("recipeDate", month_length=14), text("г."), align="center"),
                align="center",
            ),
        ),
        block(
            "people",
            column(
                _w(139.6),
                row(text("Фамилия, инициалы имени и отчества (последнее – при наличии)")),
                row(text("пациента"), blank("patientFullName", 40, grow=True)),
                row(text("Дата рождения"), blank("patientBirthDate", 40, grow=True)),
                row(text("Фамилия, инициалы имени и отчества (последнее – при наличии)")),
                row(
                    text("лечащего врача (фельдшера, акушерки)"),
                    blank("doctorFullName", 40, grow=True),
                ),
            ),
        ),
        *_prescription(1),
        *_prescription(2),
        *_prescription(3),
        block(
            "signature",
            column(
                100,
                row({"kind": "stamp", "fieldId": "doctorSignature", "text": "Подпись"}),
                row(
                    text("и печать лечащего врача"),
                    {"kind": "stamp", "fieldId": "doctorSeal", "text": "М.П.", "indentMm": 68.7},
                ),
                row(text("(подпись фельдшера, акушерки)", small=True)),
            ),
        ),
        block(
            "validity",
            column(
                _w(150),
                row(
                    text("Рецепт действителен в течение"),
                    options("validity", ", ", codes=False, underline=True),
                    text("("),
                    blank("validityDays", 20),
                    t(")", joined=True),
                    align="right",
                ),
                row(
                    t("(нужное подчеркнуть)", indent=43.4),
                    t("(указать количество дней)", indent=20.5),
                ),
            ),
        ),
        *reverse_blocks(("pharmacyPrepared", "pharmacyChecked", "pharmacyReleased"), CONTENT_MM),
    ]
    first_row_space(blocks[0], 52.5)
    return {
        "page": {
            "size": "A4",
            "orientation": "portrait",
            "marginMm": {"top": 25, "right": MARGIN_RIGHT, "bottom": 10, "left": MARGIN_LEFT},
            "fontSizePt": 12,
        },
        "blocks": blocks,
    }


LAYOUT: Final[dict[str, Any]] = _layout()

NOTES: Final[list[str]] = [
    *FORM_TEXT_NOTES,
    "Бланк 107-1/у оформляется при назначении препаратов, не указанных в пунктах 8 и 9 "
    "Порядка назначения, и ряда комбинированных препаратов (п. 11 приложения № 1). Допускается "
    "изготовление бланка с помощью компьютерных технологий (п. 1 приложения № 3).",
    "Печать «Для рецептов» для рецепта на бланке 107-1/у не обязательна (п. 14 приложения № 3).",
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
    **blueprint_kwargs(),
)
