"""Reviewed blueprint of form 076/у «Санаторно-курортная карта для детей» (order 274н,
appendices 9–10).

The blank is appendix 9 (PDF pages 45–46), the «Порядок заполнения» is appendix 10 (PDF pages
47–53). The shared reading of the sanatorium cards lives in `medical_form_sanatorium`; this module
holds the paragraph numbers, page limits and reviewed OCR corrections of this form.
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

FORM_ID: Final = "ru.minzdrav.274n.076u"
FORM_NUMBER: Final = "076/у"
FORM_TITLE: Final = "Санаторно-курортная карта для детей"

# Footnotes sit under this normalised height of the page (reviewed on the scan, per page).
FOOTNOTE_BELOW: Final[dict[int, float]] = {47: 0.15, 48: 0.175, 49: 0.12, 51: 0.10, 53: 0.20}

VARIANT: Final = Variant(
    child=True,
    title=FORM_TITLE,
    form_label="Санаторно-курортная карта для детей №",
    person_caption="Фамилия, имя, отчество (при наличии) ребенка",
    p_identity="7.1",
    p_residence="7.2",
    p_stay="7.3",
    p_education="7.4",
    p_oms="7.5",
    p_social_group="7.6",
    p_region="7.7",
    p_climate="7.8",
    p_factors="7.9",
    p_support="7.10",
    p_escort="7.11",
    p_document="7.12",
    p_snils="7.13",
    p_accessible="7.14",
    p_clinical="7.15",
    p_infection="7.16",
    p_parasites="7.17",
    p_voucher="7.18",
    p_paper_sign="8",
    p_talon="9",
    head_label="Заведующий отделением /председатель врачебной комиссии",
)

CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(48, "учета®", "учета.", FOOTNOTE_MARK),
    Correction(49, "тОлько", "только", "capital letter recognised for a lower-case letter"),
    Correction(49, "Федерации?, в котором", "Федерации, в котором", FOOTNOTE_MARK),
    Correction(51, "услуг®:", "услуг:", FOOTNOTE_MARK),
    Correction(53, 'обследования"° и', "обследования и", FOOTNOTE_MARK),
    Correction(
        53,
        "инфекционных заболеваний а также",
        "инфекционных заболеваний, а также",
        "comma lost together with a footnote mark",
    ),
    *list_corrections(kuzbass=49, alania=50, ugra=51, climate=51, ussr=51),
)
ROW_CORRECTIONS: Final[tuple[Correction, ...]] = (
    Correction(52, "«°»", "«8»", "OCR renders the digit 8 of «8» as a degree sign"),
)
SCAN_REVIEWED: Final = ()

NOTES: Final[list[str]] = [
    "Подписи полей в повторяющихся строках («(1)», «(2)»), пояснения в скобках и уточнения "
    "«обратный талон»/«заключение» добавлены для различения полей; напечатанные подписи "
    "проверяются по OCR бланка (blankLabelsVerified).",
    "Бланк 076/у (приложение № 9) двусторонний: лицевая сторона с обратным талоном и оборотная "
    "сторона (клиническая часть, заключение, отрывной талон); на печати оборотная сторона "
    "начинается с новой страницы.",
    "Обратный талон заполняет лечащий врач санаторно-курортной организации (п. 9): его строки "
    "не обязательны и описаны порядком только как группа (rule.status = by-line).",
    "Обязательность полей (required) порядок прямо не задаёт: basis = source — пункт говорит, "
    "что строка «заполняется»/«указывается»; basis = editorial — вывод по виду бланка. "
    "Незаполненные обязательные поля подсвечиваются, печать не блокируется.",
    "Перечень кодов субъектов Российской Федерации в п. 7.7 печатного текста повторяет код 82 "
    "(Республика Дагестан) дважды; в схеме он указан один раз.",
    "Строки о социальных услугах заполняются только на ребёнка-инвалида (п. 7.6); п. 8 требует "
    "подпись заведующего отделением или председателя врачебной комиссии только для лица, "
    "имеющего право на набор социальных услуг.",
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
    blank_appendix=9,
    blank_pages=(45, 46),
    rules_appendix=10,
    rules_pages=(47, 48, 49, 50, 51, 52, 53),
    footnote_below=dict(FOOTNOTE_BELOW),
    corrections=CORRECTIONS,
    fields=build_fields(VARIANT),
    code_lists={
        "regionCode": "7.7",
        "climateCode": "7.8",
        "climateFactorsCode": "7.9",
        "socialSupportCode": "7.10",
    },
    sequential_lists={"7.8": 9, "7.9": 9, "7.10": 10},
    sections=build_sections(VARIANT),
    layout=build_layout(VARIANT, FORM_NUMBER),
    notes=NOTES,
    row_corrections=ROW_CORRECTIONS,
    scan_reviewed_captions=SCAN_REVIEWED,
)
