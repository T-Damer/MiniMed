"""Reviewed blueprint of the prescription blank 148-1/у-88 (order 1094н of 24.11.2021, appendix 2).

The blank is printed on the lower part of PDF page 24 (front; the upper part is the reverse side of
107-1/у) and on the upper part of PDF page 25 (reverse side: the mark of the врачебная комиссия and
the pharmacy cells; the rest of page 25 is the blank 148-1/у-04(л)). Requirements for the lines:
appendix 3 «Порядок оформления рецептурных бланков» (paragraphs 1–18) and appendix 1 «Порядок
назначения лекарственных препаратов» (paragraphs 16, 17, 20). The blank is printed
typographically only (appendix 3, paragraph 1); the print here is a draft for the doctor.
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
from localmed_ingest.medical_form_prescription import (
    FORM_TEXT_NOTES,
    SURNAME_INITIALS_NOTE,
    block,
    blueprint_kwargs,
    cells,
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

FORM_ID: Final = "ru.minzdrav.1094n.148-1u-88"
FORM_NUMBER: Final = "148-1/у-88"
FORM_TITLE: Final = "Рецептурный бланк"
BLANK_PAGES: Final = (24, 25)
# The blank starts under the reverse side of 107-1/у (below the heading «Форма рецептурного бланка
# № 148-1/у-88»); its own reverse side is at the top of page 25.
BLANK_REGIONS: Final[dict[int, tuple[float, float]]] = {24: (0.0, 0.69), 25: (0.735, 0.935)}

FIELDS: Final[list[dict[str, Any]]] = [
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
        "series",
        "Серия",
        "text",
        field_rule(
            "undefined",
            note=(
                "Порядок не описывает серию бланка 148-1/у-88: бланк изготавливается "
                "исключительно типографским способом (п. 1 приложения № 3)."
            ),
        ),
        maxLength=10,
        anchor="Серия",
    ),
    field_def(
        "number",
        "№",
        "text",
        field_rule("undefined", note="Порядок не описывает номер бланка 148-1/у-88."),
        maxLength=10,
        anchor="Серия №",
    ),
    field_def(
        "recipeDate",
        "Дата оформления рецепта",
        "date",
        field_rule(
            "defined",
            p3(1),
            note="Пункт 1 требует дату выписки (оформления) рецепта на бланке.",
        ),
        required=True,
        prefill={"sources": ["today"]},
        notAfter="today",
        anchor="(дата оформления-рецепта)",
    ),
    field_def(
        "recipeKind",
        "(взрослый, детский - нужное подчеркнуть)",
        "choice",
        field_rule("undefined", note="Порядок не описывает отметку «взрослый, детский»."),
        options=[{"value": "adult", "label": "взрослый"}, {"value": "child", "label": "детский"}],
        anchor="(взрослый, детский - нужное подчеркнуть)",
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
        "addressOrCard",
        "Адрес места жительства или № медицинской карты амбулаторного пациента, получающего "
        "медицинскую помощь в амбулаторных условиях",
        "text",
        field_rule(
            "defined",
            p3(9),
            note=(
                "Указывается почтовый адрес места жительства (пребывания, фактического "
                "проживания) или номер медицинской карты; указание и адреса, и номера не "
                "является ошибкой."
            ),
        ),
        required=True,
        prefill={
            "sources": [
                "patient.address.subject",
                "patient.address.district",
                "patient.address.locality",
                "patient.address.street",
                "patient.address.house",
                "patient.address.building",
                "patient.address.apartment",
            ],
            "join": ", ",
        },
        maxLength=300,
        anchor="медицинскую помощь в амбулаторных условиях",
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
            p1(20),
            note=(
                "На одном бланке разрешено назначение только одного наименования препарата "
                "(п. 15). Рецепт действителен 15 дней (п. 20 приложения № 1). Графы «Руб.» и "
                "«Коп.» порядок не описывает."
            ),
        ),
        required=True,
        multiline=True,
        maxLength=600,
        anchor="Rp:",
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

SECTIONS: Final[list[dict[str, Any]]] = [
    {
        "id": "organization",
        "title": "Организация и бланк",
        "fieldIds": ["organizationStamp", "entrepreneurStamp", "series", "number"],
    },
    {
        "id": "recipe",
        "title": "Рецепт",
        "fieldIds": ["recipeKind", "recipeDate", "prescription"],
    },
    {
        "id": "patient",
        "title": "Пациент",
        "fieldIds": ["patientFullName", "patientBirthDate", "addressOrCard"],
    },
    {"id": "doctor", "title": "Врач", "fieldIds": ["doctorFullName"]},
    {
        "id": "reverse",
        "title": "Оборотная сторона",
        "description": "Графы заполняет аптечная организация.",
        "fieldIds": ["pharmacyPrepared", "pharmacyChecked", "pharmacyReleased"],
    },
]

MARGIN_LEFT: Final = 29.4
MARGIN_RIGHT: Final = 15.2
CONTENT_MM: Final = 210 - MARGIN_LEFT - MARGIN_RIGHT


def _w(width_mm: float) -> float:
    return pct(width_mm, CONTENT_MM)


def _layout() -> dict[str, Any]:
    left, right, gap = _w(80.4), _w(83), 2
    blocks = [
        block("ministry", column(100, row(text("Министерство здравоохранения")))),
        block(
            "header",
            column(
                left,
                row(text("Российской Федерации")),
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
                right,
                row(text("Код формы по ОКУД 3108805")),
                row(text("Медицинская документация")),
                row(text("Форма № 148-1/у-88")),
                row(text("Утверждена приказом")),
                row(text("Министерства здравоохранения")),
                row(text("Российской Федерации")),
                row(
                    text("от"),
                    t("24 ноября 2021 г.", underline=True),
                    t("№", indent=2),
                    t("1094н", underline=True),
                ),
            ),
            gap=gap,
        ),
        block("separator", column(_w(136.4), row(rule(style="dashed")))),
        block(
            "series",
            column(
                100,
                tight(
                    row(
                        t("Серия", indent=27.4, small=True),
                        cells("series", 3, 7.1, height=8.6),
                        t("№", small=True, indent=2),
                        cells("number", 4, 6.8, height=8.6),
                    ),
                    8.6,
                ),
            ),
        ),
        block(
            "recipe-date",
            column(
                100,
                row(
                    t("РЕЦЕПТ", large=True),
                    t("«", indent=24),
                    blank("recipeDate", 3, part="day"),
                    t("»", joined=True),
                    blank("recipeDate", 19, part="month"),
                    text("20"),
                    blank("recipeDate", 3, part="year2"),
                    text("г."),
                ),
                row(t("(дата оформления-рецепта)", indent=43.9)),
            ),
        ),
        block(
            "kind",
            column(
                100,
                row(
                    t("(", indent=15.9),
                    {**options("recipeKind", ", ", codes=False, underline=True), "joined": True},
                    text("- нужное подчеркнуть)"),
                ),
            ),
        ),
        block(
            "patient",
            column(
                _w(140.4),
                row(text("Фамилия, инициалы имени и отчества (последнее – при наличии)")),
                row(text("пациента"), blank("patientFullName", 40, grow=True)),
            ),
        ),
        block(
            "birth",
            column(
                _w(150.6),
                row(text("Дата рождения"), blank("patientBirthDate", 40, grow=True)),
            ),
        ),
        block(
            "address",
            column(
                100,
                row(
                    text(
                        "Адрес места жительства или № медицинской карты амбулаторного пациента,"
                        " получающего"
                    ),
                    align="stretch",
                ),
            ),
        ),
        block(
            "address-card",
            column(
                _w(160.6),
                row(
                    text("медицинскую помощь в амбулаторных условиях"),
                    blank("addressOrCard", 40, grow=True),
                ),
            ),
        ),
        block(
            "doctor",
            column(
                _w(139.1),
                row(text("Фамилия, инициалы имени и отчества (последнее – при наличии)")),
                row(
                    text("лечащего врача (фельдшера, акушерки)"),
                    blank("doctorFullName", 40, grow=True),
                ),
            ),
        ),
        block(
            "rp",
            column(
                _w(67.7),
                tight(row(text("Руб."), t("Коп.", indent=13), t("Rp:", indent=20.5)), 2.8),
                row(ruled_field("prescription", 5, pitch=4.1)),
            ),
        ),
        block("rp-end", column(_w(90), tight(row(rule(style="dashed")), 3.4))),
        block(
            "signature",
            column(
                100,
                row(
                    {
                        "kind": "stamp",
                        "fieldId": "doctorSignature",
                        "text": "Подпись и печать лечащего врача",
                    },
                    {"kind": "stamp", "fieldId": "doctorSeal", "text": "М.П.", "indentMm": 40},
                ),
                row(text("(подпись фельдшера, акушерки)")),
            ),
        ),
        block(
            "validity",
            column(100, row(text("Рецепт действителен в течение 15 дней"), align="center")),
        ),
        *reverse_blocks(
            ("pharmacyPrepared", "pharmacyChecked", "pharmacyReleased"),
            CONTENT_MM,
            2.3,
            box_mm=21.5,
            head_mm=8.3,
            table_gap=13.3,
        ),
    ]
    first_row_space(blocks[0], 79.5)
    # «Серия» and «№» are not in the OCR text, so the calibration cannot place the comb: measured
    # on the scan (the cells start 3 mm lower than the flow of the lines above puts them).
    blocks[3]["columns"][0]["rows"][0]["spaceBeforeMm"] = 3.0
    return {
        "page": {
            "size": "A4",
            "orientation": "portrait",
            "marginMm": {"top": 18, "right": MARGIN_RIGHT, "bottom": 10, "left": MARGIN_LEFT},
            "fontSizePt": 12,
        },
        "blocks": blocks,
    }


LAYOUT: Final[dict[str, Any]] = _layout()

NOTES: Final[list[str]] = [
    *FORM_TEXT_NOTES,
    "Бланк 148-1/у-88 оформляется при назначении наркотических и психотропных препаратов списка II "
    "в виде трансдермальных терапевтических систем и ряда других препаратов, перечисленных в "
    "п. 9 приложения № 1; изготавливается исключительно типографским способом (п. 1 приложения "
    "№ 3), поэтому печать приложения — только образец.",
    "Подпись под строкой «(дата оформления-рецепта)»: дефис между словами напечатан в бланке "
    "именно так.",
    "Серия и номер бланка нанесены типографским способом; порядок их не описывает. Рамка из "
    "ячеек в приложении декоративная, здесь она воспроизведена сплошными ячейками.",
    "Рецепт на бланке 148-1/у-88 действителен в течение 15 дней со дня оформления (п. 20 "
    "приложения № 1).",
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
    # «Серия», «№», «Rp:» are set small or dotted, so the recogniser drops them (seen on the scan).
    scan_reviewed_captions=("Серия", "Серия №", "Rp:"),
    **blueprint_kwargs(),
)
