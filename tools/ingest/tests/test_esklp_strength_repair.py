"""STATE DOSE1: the released ЕСКЛП modules are repaired without the registry archive.

The strings are the stored ones of the released nervous-system module, card
`esklp.mnn.парацетамол-фенилэфрин-фенирамин` (QA 0.6.60 item 4).
"""

from __future__ import annotations

from typing import Any

from localmed_ingest.esklp_strength_repair import (
    card_residue,
    index_text,
    repair_card_metadata,
    repair_chunk_text,
)

FORM = "ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ПРИЕМА ВНУТРЬ"


def _card() -> dict[str, Any]:
    return {
        "strengths": [
            "1.0325 мг+10 мг+20 мг",
            "1.0650 мг+10 мг+20 мг",
            "325 мг + 10 мг + 20 мг",
            "НЕ УКАЗАНО",
            "650 мг + 10 мг + 20 мг",
        ],
        "smnnNodes": [
            {
                "strength": "1.0325 мг+10 мг+20 мг",
                "tradeNames": [
                    {"tradeName": "Колдакт Хот Дринк", "strength": "1.0 325 мг+10 мг+20 мг"}
                ],
                "klpPositions": [
                    {"tradeName": "ТераФлю", "strength": "НЕ УКАЗАНО"},
                    {"tradeName": "Флюкомп", "strength": "325 мг + 10 мг + 20 мг"},
                ],
            },
            {
                "strength": "1.0650 мг+10 мг+20 мг",
                "tradeNames": [
                    {"tradeName": "ТераФлю Экстра", "strength": "1.0 650 мг+10 мг+20 мг"}
                ],
                "klpPositions": [{"tradeName": "Флюкомп", "strength": "650 мг + 10 мг + 20 мг"}],
            },
        ],
    }


def test_the_card_metadata_loses_the_placeholder_and_the_unstated_value() -> None:
    card = _card()
    repair = repair_card_metadata(card)
    assert [node["strength"] for node in card["smnnNodes"]] == [
        "325 мг+10 мг+20 мг",
        "650 мг+10 мг+20 мг",
    ]
    assert card["smnnNodes"][0]["tradeNames"][0]["strength"] == "325 мг+10 мг+20 мг"
    # The registry's own klp rows are kept as they are.
    assert card["smnnNodes"][0]["klpPositions"][0]["strength"] == "НЕ УКАЗАНО"
    assert card["strengths"] == ["325 мг+10 мг+20 мг", "650 мг+10 мг+20 мг"]
    assert repair.node_strengths == 2
    assert repair.trade_strengths == 2
    assert repair.unresolved == []
    assert card_residue(card) == []


def test_a_real_one_milligram_dosage_and_an_unstated_one_are_told_apart() -> None:
    card: dict[str, Any] = {
        "strengths": ["1.0мг/мл", "1.0~"],
        "smnnNodes": [
            {
                "strength": "1.0мг/мл",
                "tradeNames": [{"strength": "1.0 мг/мл"}],
                "klpPositions": [],
            },
            {"strength": "1.0~", "tradeNames": [{"strength": "1.0 ~"}], "klpPositions": []},
        ],
    }
    repair = repair_card_metadata(card)
    assert [node["strength"] for node in card["smnnNodes"]] == ["1.0мг/мл", None]
    assert card["smnnNodes"][1]["tradeNames"][0]["strength"] is None
    assert card["smnnNodes"][0]["tradeNames"][0]["strength"] == "1.0 мг/мл"
    assert card["strengths"] == ["1.0мг/мл"]
    assert repair.changed


def test_a_card_without_the_defect_is_not_touched() -> None:
    card: dict[str, Any] = {
        "strengths": ["500.0мг"],
        "smnnNodes": [
            {
                "strength": "500.0мг",
                "tradeNames": [{"strength": "500.0 мг"}],
                "klpPositions": [{"strength": "500 мг"}],
            }
        ],
    }
    before = repr(card)
    assert not repair_card_metadata(card).changed
    assert repr(card) == before


def test_the_card_text_names_the_dosage_once_and_without_the_placeholder() -> None:
    changes = repair_card_metadata(_card()).changes
    list_chunk = (
        f"МНН: ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН. Лекарственные формы: {FORM}.\n\n"
        "Доступные дозировки/концентрации: 1.0325 мг+10 мг+20 мг, 1.0650 мг+10 мг+20 мг, "
        "325 мг + 10 мг + 20 мг, НЕ УКАЗАНО, 650 мг + 10 мг + 20 мг, 1.0 325 мг+10 мг+20 мг, "
        "1.0 650 мг+10 мг+20 мг.\n\nАТХ: N02BE51."
    )
    assert repair_chunk_text(list_chunk, changes) == (
        f"МНН: ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН. Лекарственные формы: {FORM}.\n\n"
        "Доступные дозировки/концентрации: 325 мг+10 мг+20 мг, 650 мг+10 мг+20 мг.\n\n"
        "АТХ: N02BE51."
    )
    trade_line = (
        "- ТН: Колдакт Хот Дринк. Регистрация: ЛП-007263. СМНН: ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН; "
        f"smnnCode: 21.20.10.232-000033-1-00013-0000000000000. Лекарственная форма: {FORM}. "
        "Дозировка/концентрация: 1.0 325 мг+10 мг+20 мг. Единица: г. Нормализованные МНН: "
        f"ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН. Нормализованные формы/дозировки: {FORM} "
        "(325 мг + 10 мг + 20 мг)."
    )
    repaired = repair_chunk_text(trade_line, changes)
    assert "Дозировка/концентрация: 325 мг+10 мг+20 мг. Единица: г." in repaired
    assert "1.0" not in repaired


def test_an_unstated_dosage_reads_like_any_other_empty_field() -> None:
    klp_line = (
        "- КЛП: 21.20.10.232-000033-1-00013-2000001250422. ТН: ТераФлю. Лекарственная форма: "
        f"{FORM}. Дозировка/концентрация: НЕ УКАЗАНО. Единица: г (г лекарственной формы). "
        "Количество единиц: 46.4. Содержимое упаковки: ~. Нормализованные формы/дозировки: "
        f"{FORM} (НЕ УКАЗАНО)."
    )
    repaired = repair_chunk_text(klp_line, {})
    assert "Дозировка/концентрация: не указано в каталоге. Единица:" in repaired
    assert "Содержимое упаковки: ~." in repaired  # the builder's own wording stays
    assert "НЕ УКАЗАНО" not in repaired
    assert repaired.endswith(f"Нормализованные формы/дозировки: {FORM}.")


def test_a_text_cut_inside_its_label_is_still_repaired() -> None:
    assert repair_chunk_text("…ия: НЕ УКАЗАНО. Единица: мл. Количество единиц: 5.", {}) == (
        "…ия: не указано в каталоге. Единица: мл. Количество единиц: 5."
    )
    assert repair_chunk_text("Дозировка/концентрация: 1.0 25 мг+1 мг", {}) == (
        "Дозировка/концентрация: 25 мг+1 мг"
    )


def test_a_text_cut_at_either_end_of_a_chunk_is_still_repaired() -> None:
    # The chunk limit cuts a line anywhere: the label may be in the chunk before, the value may end it.
    assert repair_chunk_text("НЕ УКАЗАНО. Единица: шт. (таблетка).", {}) == (
        "не указано в каталоге. Единица: шт. (таблетка)."
    )
    assert repair_chunk_text("1.0 ~. Единица: мл. Нормализованные МНН: ПАРА", {}) == (
        "не указано в каталоге. Единица: мл. Нормализованные МНН: ПАРА"
    )
    assert repair_chunk_text("форма: ТАБЛЕТКИ. Дозировка/концентрация: НЕ УКАЗАНО", {}) == (
        "форма: ТАБЛЕТКИ. Дозировка/концентрация: не указано в каталоге"
    )


def test_a_tail_cut_in_two_by_the_chunk_limit_leaves_no_half_of_it() -> None:
    assert repair_chunk_text("форма: СИРОП (НЕ", {}) == "форма: СИРОП"
    assert repair_chunk_text("НЕ УКАЗАНО).\n- ТН: Кислород", {}) == ".\n- ТН: Кислород"


def test_a_chunk_without_a_dosage_is_returned_as_it_was() -> None:
    text = "Компонентные МНН: ПАРАЦЕТАМОЛ, ФЕНИЛЭФРИН, ФЕНИРАМИН.\n\nЦена: не указано в каталоге."
    assert repair_chunk_text(text, {}) == text


def test_the_search_text_keeps_every_token_once_with_its_stem() -> None:
    # The shape of the stored `normalized_text` of the released modules.
    assert index_text("Дозировки: Сведения о стандартизированном МНН МНН") == (
        "дозировки дозировк сведения сведен стандартизированном стандартизированн мнн"
    )
