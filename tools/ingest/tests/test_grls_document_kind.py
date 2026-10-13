from __future__ import annotations

from localmed_ingest.grls_document_kind import classify_scan_document, fold_scan_text

SECTIONS = (
    "Показания к применению Препарат применяют при инфекциях. "
    "Противопоказания Гиперчувствительность. "
    "Способ применения и дозы Внутрь по таблетке. "
    "Побочное действие Тошнота. Передозировка Симптомы. "
    "Особые указания Осторожность. Условия хранения В сухом месте. "
    "Форма выпуска Таблетки. " + "Лекарственное средство применяют внутрь после еды. " * 90
)


def kind(text: str) -> str:
    return classify_scan_document(text).kind


def test_stamp_between_the_title_words_does_not_hide_the_instruction() -> None:
    text = (
        "Общая информация ЛП-Nº(002651)-(РГ-RU) от 29.06.2023 "
        "ИНСТРУКЦИЯ ПОСЛЕДОВАТЕЛЬНОСТЬ 0001) ПО МЕДИЦИНСКОМУ ПРИМЕНЕНИЮ ЛЕКАРСТВЕННОГО ПРЕПАРАТА "
        + SECTIONS
    )
    assert kind(text) == "national-instruction"


def test_latin_lookalike_letters_are_read_as_cyrillic() -> None:
    assert fold_scan_text("ИНCTPУКЦИЯ") == "инструкция" or "инс" in fold_scan_text("ИНCTPУКЦИЯ")
    text = "ИНCTPУКЦИЯ по медицинскому применению препарата " + SECTIONS
    assert kind(text) == "national-instruction"


def test_amendment_sheet_is_not_the_instruction_it_amends() -> None:
    text = (
        "МИНИСТЕРСТВО ЗДРАВООХРАНЕНИЯ ИНСТРУКЦИЯ по медицинскому применению "
        "лекарственного препарата "
        "Урофурагин таблетки 50 мг Изменение Nº 1 Дата внесения Изменения «25» 04 2022 г. "
        "Старая редакция Новая редакция Форма выпуска Форма выпуска Таблетки 50 мг. "
        "Таблетки 50 мг. "
        "По 30 таблеток в блистер. По 30 таблеток в контурную ячейковую упаковку."
    )
    evidence = classify_scan_document(text)
    assert evidence.kind == "amendment"
    assert evidence.section_types <= 2


def test_a_full_instruction_with_an_amendment_cover_stays_an_instruction() -> None:
    text = (
        "ИНСТРУКЦИЯ по медицинскому применению препарата Изменение № 3 "
        "Старая редакция Новая редакция " + SECTIONS
    )
    assert kind(text) == "national-instruction"


def test_leaflet_and_ohlp_titles() -> None:
    assert (
        kind("Листок-вкладыш – информация для пациента Препарат таблетки. " + SECTIONS) == "leaflet"
    )
    assert kind("Листок-вкладьи информация для пациента Препарат. " + SECTIONS) == "leaflet"
    assert kind("Общая характеристика лекарственного препарата. " + SECTIONS) == "ohlp"


def test_standard_sections_without_a_readable_title_count_as_an_instruction() -> None:
    assert kind(SECTIONS) == "national-instruction"
    assert (
        kind("1. Что из себя представляет препарат и для чего его применяют " + SECTIONS)
        == "leaflet"
    )


def test_text_without_title_or_sections_is_other_and_no_text_is_unknown() -> None:
    other = classify_scan_document(
        "Регистрационное удостоверение выдано обществу с ограниченной ответственностью " * 3
    )
    assert other.kind == "other"
    assert classify_scan_document("").kind == "unknown"
    assert classify_scan_document("<!-- localmed:source {} --> ## 1").kind == "unknown"
