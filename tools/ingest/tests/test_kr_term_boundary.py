from __future__ import annotations

import pytest

from localmed_ingest.kr_term_boundary import (
    looks_like_abbreviation_entry,
    split_term_definition,
    term_defect,
    term_names,
)


def _split(paragraph: str) -> tuple[str, str, tuple[str, ...]]:
    result = split_term_definition(paragraph)
    assert result is not None, paragraph
    return result.term, result.definition, result.flags


def test_plain_dash_separates_term_and_definition() -> None:
    term, definition, flags = _split(
        "Депрессия – процесс формирования перелома суставной поверхности кости."
    )
    assert term == "Депрессия"
    assert definition.startswith("процесс формирования")
    assert flags == ()


@pytest.mark.parametrize("dash", ["–", "—", "-"])
def test_all_dash_kinds_split_when_spaced(dash: str) -> None:
    term, definition, _ = _split(f"Исход {dash} любой возможный результат воздействия.")
    assert (term, definition) == ("Исход", "любой возможный результат воздействия.")


def test_dash_inside_bracket_is_not_the_boundary() -> None:
    term, definition, _ = _split(
        "Толерантность (лат. – tolerantia, «выносливость, способность переносить») — "
        "прогрессирующее снижение эффекта."
    )
    assert term == "Толерантность (лат. – tolerantia, «выносливость, способность переносить»)"
    assert definition == "прогрессирующее снижение эффекта."
    assert term_defect(term) is None


def test_dash_inside_quotation_is_not_the_boundary() -> None:
    term, definition, _ = _split("Шкала «ДА – НЕТ» – опросник из двух ответов.")
    assert term == "Шкала «ДА – НЕТ»"
    assert definition == "опросник из двух ответов."


def test_hyphenated_compound_word_is_not_split() -> None:
    term, definition, _ = _split("Кислотно-основное состояние - соотношение ионов водорода.")
    assert term == "Кислотно-основное состояние"
    assert definition == "соотношение ионов водорода."


def test_list_marker_is_peeled_and_reported() -> None:
    for paragraph in (
        "а) простой стеатоз – состояние без воспаления.",
        "• простой стеатоз – состояние без воспаления.",
        "1) простой стеатоз – состояние без воспаления.",
        "- простой стеатоз – состояние без воспаления.",
    ):
        term, _, flags = _split(paragraph)
        assert term == "простой стеатоз"
        assert flags == ("list-item",)


def test_trailing_comma_before_the_dash_is_dropped() -> None:
    term, _, _ = _split("Рвота беременных, возникающая более 2-3 раз в сутки, – осложнение.")
    assert term == "Рвота беременных, возникающая более 2-3 раз в сутки"


def test_missing_closing_bracket_falls_back_and_is_rejected() -> None:
    result = split_term_definition("mFOLFOX6 (далее по тексту – FOLFOX – режим химиотерапии")
    assert result is not None
    assert "unbalanced-source-bracket" in result.flags
    assert term_defect(result.term) == "unbalanced-bracket"


def test_no_dash_means_no_pair() -> None:
    assert split_term_definition("Противорецидивное или поддерживающее лечение.") is None
    assert split_term_definition("   ") is None


@pytest.mark.parametrize(
    ("term", "defect"),
    [
        ("балла", None),  # a lone lowercase word is a valid headword; the score line is not
        ("2 балла", "score-line"),
        ("0-3 балла", "score-line"),
        ("…#", "footnote-marker"),
        ("*", "too-short"),
        ("--", "empty-or-symbol"),
        ("со сдвигом рамки", "fragment-of-list-item"),
        ("Агорафобия происходит от греческого корня «агора»", "sentence-as-term"),
        (
            "Диапазон проявлений крайне широк: от элементарных автоматизмов",
            "sentence-as-term",
        ),
        ("Толерантность (лат.", "unbalanced-bracket"),
        ("Депрессия", None),
        ("рН", None),
        ("situs ambiguos (гетеротаксия)", None),
        ("Гипертоническая болезнь (далее ГБ)", None),
    ],
)
def test_term_defect(term: str, defect: str | None) -> None:
    assert term_defect(term) == defect


def test_term_longer_than_twelve_words_is_a_sentence() -> None:
    assert term_defect(" ".join(["слово"] * 13)) == "sentence-as-term"


def test_names_take_brackets_as_aliases() -> None:
    names = term_names(
        "Малый для гестационного возраста плод (МГВ, англ. - small for gestational age, SGA)"
    )
    assert names.title == "Малый для гестационного возраста плод"
    assert names.aliases == ("МГВ", "small for gestational age", "SGA")


def test_alias_split_keeps_a_quotation_together() -> None:
    names = term_names("Толерантность (лат. – tolerantia, «выносливость, способность переносить»)")
    assert names.aliases == ("tolerantia", "«выносливость, способность переносить»")


def test_generic_bracket_label_is_not_an_alias() -> None:
    assert term_names("Регургитация (симптом)").aliases == ()


def test_names_join_text_around_an_inner_bracket() -> None:
    assert term_names("Катетерная абляция (КА) аритмии").title == "Катетерная абляция аритмии"
    assert term_names("Катетерная абляция (КА) аритмии").aliases == ("КА",)


def test_names_take_or_clause_as_alias() -> None:
    names = term_names("Пограничные опухоли яичников (ПОЯ), или атипически пролиферирующие опухоли")
    assert names.title == "Пограничные опухоли яичников"
    assert names.aliases == ("ПОЯ", "атипически пролиферирующие опухоли")


def test_names_keep_a_term_without_brackets_whole() -> None:
    names = term_names("Острая надпочечниковая недостаточность")
    assert (names.title, names.aliases) == ("Острая надпочечниковая недостаточность", ())


def test_names_never_return_the_title_as_its_own_alias() -> None:
    assert term_names("Бред (бред)").aliases == ()


def test_abbreviation_entry_detection() -> None:
    assert looks_like_abbreviation_entry("ПМ", "продольная меланонихия")
    assert looks_like_abbreviation_entry("БЭП", "базовая энергетическая потребность.")
    assert not looks_like_abbreviation_entry("Депрессия", "психическое расстройство")
    assert not looks_like_abbreviation_entry(
        "ЭКГ", "метод регистрации электрической активности сердца при помощи электродов на коже"
    )
