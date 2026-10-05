"""Reviewed blueprint of form 072/у «Санаторно-курортная карта» (order 274н, appendices 7 and 8).

The blank is appendix 7 (PDF pages 37–38: the certificate with the return coupon, then the reverse
side), the «Порядок заполнения» is appendix 8 (PDF pages 39–44). The shared reading of the
sanatorium cards lives in `medical_form_sanatorium`; this module holds the paragraph numbers,
page limits and reviewed OCR corrections of this form.
"""

from __future__ import annotations

from typing import Final

from localmed_ingest.medical_form_kit import (
    EFFECTIVE_FROM,
    EFFECTIVE_UNTIL,
    FOOTNOTE_MARK,
    ORDER_DATE,
    ORDER_NUMBER,
    ORDER_TITLE,
    QUOTE_FIX_97,
    REGISTRATION,
    list_corrections,
)
from localmed_ingest.medical_form_sanatorium import (
    Variant,
    build_fields,
    build_layout,
    build_sections,
)
from localmed_ingest.medical_forms import Correction, FormBlueprint

FORM_ID: Final = "ru.minzdrav.274n.072u"
FORM_NUMBER: Final = "072/у"
FORM_TITLE: Final = "Санаторно-курортная карта"

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {39: 0.14, 40: 0.14, 43: 0.10}

VARIANT: Final = Variant(
    child=False,
    title=FORM_TITLE,
    form_label="Санаторно-курортная карта №",
    person_caption="Фамилия, имя, отчество (при наличии) пациента",
    p_identity="7.1",
    p_residence="7.1",
    p_stay="7.1",
    p_education=None,
    p_oms="7.2",
    p_social_group="7.3",
    p_region="7.4",
    p_climate="7.5",
    p_factors="7.6",
    p_support="7.7",
    p_escort="7.8",
    p_document="7.9",
    p_snils="7.10",
    p_accessible=None,
    p_clinical="7.11",
    p_infection=None,
    p_parasites=None,
    p_voucher="7.12",
    p_paper_sign="8",
    p_talon="9",
    head_label="Заведующий отделением (председатель врачебной комиссии)",
)

CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(40, "Код субъекта . Российской", "Код субъекта Российской", FOOTNOTE_MARK),
    Correction(40, "Федерации , в котором", "Федерации, в котором", FOOTNOTE_MARK),
    Correction(43, "услуго:", "услуг:", FOOTNOTE_MARK),
    Correction(44, "025/y", "025/у", "Latin y recognised for the Cyrillic у"),
    Correction(
        44, "имеющих 1 группу", "имеющих I группу", "Roman numeral I recognised as the digit 1"
    ),
    *list_corrections(kuzbass=41, alania=42, ugra=42, climate=42, ussr=43),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (Correction(42, "<97»", "«97»", QUOTE_FIX_97),)
# The OCR of the crowded address lines of PDF page 37 dropped «дом»; seen on the scan.
SCAN_REVIEWED: Final = ("дом",)

NOTES: Final[list[str]] = [
    "Подписи полей в повторяющихся строках («(1)», «(2)»), пояснения в скобках и уточнения "
    "«обратный талон»/«заключение» добавлены для различения полей; напечатанные подписи "
    "проверяются по OCR бланка (blankLabelsVerified).",
    "Бланк 072/у (приложение № 7) двусторонний: лицевая сторона с обратным талоном и оборотная "
    "сторона (клиническая часть, заключение, отрывной талон); на печати оборотная сторона "
    "начинается с новой страницы.",
    "Обратный талон заполняет лечащий врач санаторно-курортной организации (п. 9): его строки "
    "не обязательны и описаны порядком только как группа (rule.status = by-line).",
    "Обязательность полей (required) порядок прямо не задаёт: basis = source — пункт говорит, "
    "что строка «заполняется»/«указывается»; basis = editorial — вывод по виду бланка. "
    "Незаполненные обязательные поля подсвечиваются, печать не блокируется.",
    "Перечень кодов субъектов Российской Федерации в п. 7.4 печатного текста повторяет код 82 "
    "(Республика Дагестан) дважды; в схеме он указан один раз.",
    "Подписи на бумажном бланке по п. 8 ставит заведующий отделением или председатель врачебной "
    "комиссии, по п. 9 — лечащий и главный врач санаторно-курортной организации; печать "
    "организации проставляется на оттиск (при наличии).",
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
    blank_appendix=7,
    blank_pages=(37, 38),
    rules_appendix=8,
    rules_pages=(39, 40, 41, 42, 43, 44),
    footnote_below=dict(FOOTNOTE_BELOW),
    corrections=CORRECTIONS,
    fields=build_fields(VARIANT),
    code_lists={
        "regionCode": "7.4",
        "climateCode": "7.5",
        "climateFactorsCode": "7.6",
        "socialSupportCode": "7.7",
    },
    sequential_lists={"7.5": 9, "7.6": 9, "7.7": 10},
    sections=build_sections(VARIANT),
    layout=build_layout(VARIANT, FORM_NUMBER),
    notes=NOTES,
    row_corrections=ROW_CORRECTIONS,
    scan_reviewed_captions=SCAN_REVIEWED,
)
