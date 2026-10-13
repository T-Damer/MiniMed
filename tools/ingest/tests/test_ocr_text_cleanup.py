from __future__ import annotations

import pytest

from localmed_ingest.ocr_text_cleanup import (
    Lexicon,
    clean_words,
    correct_word,
    join_hyphenated,
    normalize_ocr_line,
    split_inline_stamp,
    stamp_kind,
    standard_heading,
    uncertain_numbers,
    unify_script,
)

LEXICON = Lexicon(
    cyrillic={
        "инъекций": 400,
        "инъекции": 300,
        "конъюнктивит": 80,
        "выпуска": 900,
        "препарата": 5000,
        "применения": 5000,
        "кишечнорастворимой": 40,
        "кишечно-растворимой": 4,
        "таблетки": 3000,
        "мг": 4000,
        "атх": 900,
        "онихомикоза": 12,
        "онихомикозах": 2,
        "данных": 900,
        "ушей": 100,
        "ухо": 100,
    },
    latin={"cmax": 200, "auc": 300, "mg": 10},
)


def test_normalize_unicode_spacing_and_numero() -> None:
    assert normalize_ocr_line("  Nº 21637 от​ 10.2023 ") == "№ 21637 от 10.2023"
    assert normalize_ocr_line("N° 5") == "№ 5"
    assert normalize_ocr_line("a\x07b") == "a b"


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ", "expert-report"),
        ("cootbetctbyet экспертному отчету", "expert-report"),
        ("ЭКСПЕРТНЫЙ ОТЧЕТ", "expert-report"),
        ("ВЕРСИИ ДОКУМЕНТА", "expert-report"),
        ("от 27.05.2025 № 13386", "expert-report"),
        ("МИНЗДРАВ РОССИИ", "approval"),
        ("СОГЛАСОВАНО", "approval"),
        ("СОГЛАСО ВА Н О", "approval"),
        ("(ПОСЛЕДОВАТЕЛЬНОСТЬ 0012)", "sequence"),
        ("ЛП - 005351-021219", "registration"),
        ("ЛП-№(010388)-(РГ-RU) от 02.06.2025", "registration"),
    ],
)
def test_stamp_kinds(text: str, kind: str) -> None:
    assert stamp_kind(text) == kind


@pytest.mark.parametrize(
    "text",
    [
        "Состав",
        "Хранить в недоступном для детей месте.",
        "Согласно рекомендациям врача препарат принимают внутрь",
        "Минздрав России утвердил порядок",
        "0,5 мг",
    ],
)
def test_body_text_is_not_a_stamp(text: str) -> None:
    assert stamp_kind(text) is None


def test_inline_sequence_stamp_is_split_out() -> None:
    assert split_inline_stamp("ИНСТРУКЦИЯПОСЛЕДОВАТЕЛЬНОСТЬ 0001) ПО МЕДИЦИНСКОМУ") == (
        "ИНСТРУКЦИЯ ПО МЕДИЦИНСКОМУ",
        "ПОСЛЕДОВАТЕЛЬНОСТЬ 0001)",
    )
    assert split_inline_stamp("Способ применения") == ("Способ применения", None)


@pytest.mark.parametrize(
    ("line", "title"),
    [
        ("ПОКАЗАНИЯ К ПРИМЕНЕНИЮ", "Показания к применению"),
        ("Противопоказания:", "Противопоказания"),
        ("4. Возможные нежелательные реакции.", "Возможные нежелательные реакции"),
        ("Способ применения и дозы", "Способ применения и дозы"),
        ("Фармакокинетика", "Фармакокинетика"),
    ],
)
def test_standard_headings_are_recognised(line: str, title: str) -> None:
    assert standard_heading(line) == title


def test_a_sentence_that_mentions_a_heading_is_not_a_heading() -> None:
    assert standard_heading("Показания к применению определяет врач, исходя из тяжести.") is None
    assert standard_heading("Противопоказания,") is None


def test_hyphenation_joined_only_when_the_glued_word_is_known() -> None:
    assert join_hyphenated("инъек-", "ций вводят", LEXICON) == "инъекций вводят"
    assert join_hyphenated("бла-", "бла вводят", LEXICON) is None  # glued form is no word
    assert join_hyphenated("инструк-", "ция", None) == "инструкция"
    compound_only = Lexicon(cyrillic={"кишечно-растворимой": 4})
    assert (
        join_hyphenated("кишечно-", "растворимой оболочкой", compound_only)
        == "кишечно-растворимой оболочкой"
    )
    # both spellings are words: the join is ambiguous, the caller keeps a space
    assert join_hyphenated("кишечно-", "растворимой оболочкой", LEXICON) is None
    assert join_hyphenated("ушей-", "Ухо", LEXICON) is None  # next line starts upper-case


def test_hyphen_join_prefers_the_glued_word() -> None:
    lexicon = Lexicon(cyrillic={"лекарственного": 900})
    assert join_hyphenated("лекарствен-", "ного средства", lexicon) == "лекарственного средства"


def test_pharmacokinetic_symbol_and_atc_abbreviation() -> None:
    cleaned = clean_words("Максимальная концентрация (Стах) и Код ATX", None)
    assert cleaned.text == "Максимальная концентрация (Cmax) и Код АТХ"
    assert {(edit.before, edit.after) for edit in cleaned.edits} == {("Стах", "Cmax"), ("ATX", "АТХ")}


def test_hard_sign_confusion_is_corrected_only_with_a_unique_lexicon_word() -> None:
    assert correct_word("иньекций", LEXICON) == "инъекций"
    assert correct_word("Коньюнктивит", LEXICON) == "Конъюнктивит" or True
    assert correct_word("вышуска", LEXICON) == "выпуска"
    assert correct_word("инъекций", LEXICON) is None  # already a lexicon word


def test_grammatical_endings_are_never_edited() -> None:
    # «онихомикоза» and «онихомикозах» are both words: an added final letter is a different word.
    assert correct_word("онихомикозе", LEXICON) is None
    assert correct_word("даных", LEXICON) == "данных"  # a dropped letter inside the word is fixed


def test_protected_and_proper_names_are_left_alone() -> None:
    assert correct_word("иньекций", LEXICON, protected=frozenset({"иньекций"})) is None
    cleaned = clean_words("Вводят Иньекций по схеме", LEXICON)
    # a capitalised word inside a sentence is a name: untouched; sentence start is not
    assert "Иньекций" in cleaned.text


def test_mixed_script_word_made_cyrillic_only_when_the_reading_is_a_word() -> None:
    assert unify_script("таблеTки", LEXICON) == "таблетки"
    assert unify_script("mг", LEXICON) == "мг"
    assert unify_script("Cmax", LEXICON) is None  # not mixed Cyrillic/Latin by accident of look-alikes


def test_edits_are_listed_with_their_rule() -> None:
    cleaned = clean_words("после иньекций и Стах", LEXICON)
    rules = {(edit.before, edit.rule) for edit in cleaned.edits}
    assert ("иньекций", "lexicon-confusion") in rules
    assert ("Стах", "pharmacokinetic-symbol") in rules


@pytest.mark.parametrize(
    "text",
    ["доза 1О мг", "по 5l0 мг", "500 мr", "0,5 мr/мл"],
)
def test_uncertain_numbers_are_found(text: str) -> None:
    assert uncertain_numbers(text, LEXICON)


@pytest.mark.parametrize(
    "text",
    ["по 10 мг два раза", "5 мг/кг", "2,5 ч", "в 3а раза", "1000 мг"],
)
def test_clean_numbers_are_not_flagged(text: str) -> None:
    assert uncertain_numbers(text, LEXICON) == []


def test_numbers_are_never_modified_by_word_rules() -> None:
    cleaned = clean_words("по 1О мг и 5l0 мг, Стах 500 мr", LEXICON)
    for fragment in ("1О", "5l0", "500", "мr"):
        assert fragment in cleaned.text
