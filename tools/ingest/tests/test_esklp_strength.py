"""STATE DOSE1: a ЕСКЛП dosage is read from its two cells, never glued from a placeholder.

The raw cells below are the registry's own (data/build/release-esklp, edition 2026-08-28): the
combination drugs of QA 0.6.60 item 4 carry «1.0» in «Кол-во» and the whole composite dosage in
«Единица измерения дозировки».
"""

from __future__ import annotations

import pytest

from localmed_ingest import esklp_catalog
from localmed_ingest.esklp_rows import parse_smnn_rows, parse_trade_rows
from localmed_ingest.esklp_strength import (
    has_glued_placeholder,
    is_unstated,
    registry_strength,
    repair_strength,
)

# (quantity cell, unit cell, the dosage the card must show)
REAL_COMPOSITE_CELLS = [
    ("1.0", "325 мг+10 мг+20 мг", "325 мг+10 мг+20 мг"),  # парацетамол+фенилэфрин+фенирамин
    ("1.0", "650 мг+10 мг+20 мг", "650 мг+10 мг+20 мг"),
    ("1.0", "250 мг+65 мг+250 мг", "250 мг+65 мг+250 мг"),  # Цитрамон
    ("1.0", "1.42 мг+18.26 мг+20 мг/мл", "1.42 мг+18.26 мг+20 мг/мл"),  # Корвалол, капли
    ("1.0", "25 мг+1 мг+0.4 мг/мл", "25 мг+1 мг+0.4 мг/мл"),
    ("1.0", "0.0005 мг", "0.0005 мг"),  # a single substance whose unit cell is the expression
    ("1.0", "(125 мг+2 мг)/5 мл", "(125 мг+2 мг)/5 мл"),
]


@pytest.mark.parametrize(("quantity", "unit", "expected"), REAL_COMPOSITE_CELLS)
def test_composite_dosage_drops_the_placeholder_quantity(
    quantity: str, unit: str, expected: str
) -> None:
    assert registry_strength(quantity, unit) == expected
    assert registry_strength(quantity, unit, separator=" ") == expected


@pytest.mark.parametrize(
    ("quantity", "unit", "separator", "expected"),
    [
        ("100.0", "мг", "", "100.0мг"),
        ("100.0", "мг", " ", "100.0 мг"),
        ("1.0", "мг/мл", "", "1.0мг/мл"),  # a real 1 mg/ml keeps its quantity
        ("0.01", "%", "", "0.01%"),
        ("875+125", "мг", "", "875+125мг"),
        ("500 мг", "мг", "", "500 мг"),  # the unit is already in the quantity
        ("5", None, "", "5"),
        ("1.0E8", "КОЕ", "", "1.0E8КОЕ"),
    ],
)
def test_a_plain_quantity_and_unit_are_joined_as_before(
    quantity: str, unit: str | None, separator: str, expected: str
) -> None:
    assert registry_strength(quantity, unit, separator=separator) == expected


@pytest.mark.parametrize(
    ("quantity", "unit"),
    [("1.0", "~"), ("1.0", "НЕ УКАЗАНО"), ("1.0", None), ("НЕ УКАЗАНО", "~"), (None, None)],
)
def test_an_unstated_dosage_is_absent(quantity: str | None, unit: str | None) -> None:
    assert registry_strength(quantity, unit) is None
    assert registry_strength(quantity, unit, separator=" ") is None


def test_unstated_vocabulary() -> None:
    for value in (None, "", " ", "~", "НЕ УКАЗАНО", "не указано", "—"):
        assert is_unstated(value)
    for value in ("0", "500 мг", "1.0"):
        assert not is_unstated(value)


GLUED_BEFORE_THE_FIX = [
    # (glued string stored on the node, the trade-name spelling that proves it, the dosage)
    ("1.0325 мг+10 мг+20 мг", "1.0 325 мг+10 мг+20 мг", "325 мг+10 мг+20 мг"),
    ("1.0650 мг+10 мг+20 мг", "1.0 650 мг+10 мг+20 мг", "650 мг+10 мг+20 мг"),
    ("1.0250 мг+65 мг+250 мг", "1.0 250 мг+65 мг+250 мг", "250 мг+65 мг+250 мг"),
    ("1.01.42 мг+18.26 мг+20 мг/мл", "1.0 1.42 мг+18.26 мг+20 мг/мл", "1.42 мг+18.26 мг+20 мг/мл"),
    ("1.025 мг+1 мг+0.4 мг/мл", "1.0 25 мг+1 мг+0.4 мг/мл", "25 мг+1 мг+0.4 мг/мл"),
    ("1.00.0005 мг", "1.0 0.0005 мг", "0.0005 мг"),
]


@pytest.mark.parametrize(("glued", "spelling", "fixed"), GLUED_BEFORE_THE_FIX)
def test_a_glued_dosage_is_repaired_when_the_node_proves_it(
    glued: str, spelling: str, fixed: str
) -> None:
    assert has_glued_placeholder(spelling)
    assert repair_strength(spelling) == fixed
    assert repair_strength(glued, [spelling]) == fixed


def test_a_real_decimal_is_not_repaired_without_evidence() -> None:
    assert repair_strength("1.025 мг", ["1.0 мг"]) == "1.025 мг"
    assert repair_strength("1.0мг/мл", ["1.0 мг/мл"]) == "1.0мг/мл"
    assert not has_glued_placeholder("1.0мг/мл")
    assert not has_glued_placeholder("1.025 мг")


@pytest.mark.parametrize(
    "value", ["1.0~", "1.0 ~", "1.0НЕ УКАЗАНО", "1.0 НЕ УКАЗАНО", "НЕ УКАЗАНО", "~", None]
)
def test_the_placeholder_before_nothing_is_absent(value: str | None) -> None:
    assert repair_strength(value) is None


# ---------------------------------------------------------------------------------------------
# The builder, on the registry rows themselves.
# ---------------------------------------------------------------------------------------------


def _row(width: int, values: dict[int, str]) -> list[str]:
    result = [""] * width
    for column, value in values.items():
        result[column] = value
    return result


def _trade_rows(*data: list[str]) -> list[list[str]]:
    header = _row(
        12,
        {
            0: "Торговое наименование",
            1: "Номер регистрационного удостоверения",
            2: "Код узла СМНН",
            3: "Стандартизованное МНН",
            4: "Стандартизованная лекарственная форма",
            5: "Стандартизованная дозировка",
            6: "Единица измерения дозировки",
            9: "Единица измерения лекарственного препарата",
            10: "Список нормализованных МНН",
            11: "Список нормализованных лекарственных форм и дозировок",
        },
    )
    return [
        header,
        _row(7, {5: "Кол-во", 6: "Единица измерения"}),
        _row(8, {7: "Наименование"}),
        [str(index) for index in range(1, 13)],
        *data,
    ]


def _smnn_rows(*data: list[str]) -> list[list[str]]:
    header = _row(
        37,
        {
            0: "Стандартизованное МНН",
            1: "Код узла СМНН",
            3: "Стандартизованная лекарственная форма",
            4: "Стандартизованная дозировка",
            5: "Единица измерения дозировки",
            9: "Единица измерения лекарственного препарата",
            12: "Наименование ФТГ",
            13: "АТХ",
            15: "ЖНВЛП",
            16: (
                "Наличие в лекарственном препарате наркотических средств, психотропных "
                "веществ и их прекурсоров"
            ),
            17: "Период действия узла СМНН",
            19: "Дата изменения записи",
            33: "Список нормализованных МНН для узла СМНН",
            34: "Список нормализованных лекарственных форм и дозировок для узла СМНН",
            35: "КЛП",
            36: "Некорректные данные",
        },
    )
    return [
        header,
        _row(6, {4: "Кол-во", 5: "Единица измерения"}),
        _row(10, {9: "Наименование"}),
        [str(index) for index in range(1, 38)],
        *data,
    ]


def test_the_builder_reads_the_raw_rows_of_a_combination_drug() -> None:
    trade = parse_trade_rows(
        _trade_rows(
            _row(
                12,
                {
                    0: "Колдакт Хот Дринк",
                    1: "ЛП-007263",
                    2: "21.20.10.232-000033-1-00013-0000000000000",
                    3: "ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН",
                    4: "ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ПРИЕМА ВНУТРЬ",
                    5: "1.0",
                    6: "325 мг+10 мг+20 мг",
                    9: "г",
                },
            ),
            _row(
                12,
                {
                    0: "Аспинат",
                    1: "ЛП-000001",
                    2: "21.20.10.100-000001-1-00001-0000000000000",
                    3: "АЦЕТИЛСАЛИЦИЛОВАЯ КИСЛОТА",
                    4: "ТАБЛЕТКИ",
                    5: "500.0",
                    6: "мг",
                },
            ),
            _row(
                12,
                {
                    0: "Без дозировки",
                    1: "ЛП-000002",
                    2: "21.20.10.100-000002-1-00001-0000000000000",
                    3: "МИРАМИСТИН",
                    4: "РАСТВОР",
                    5: "1.0",
                    6: "~",
                },
            ),
        )
    )
    assert [row.strength for row in trade] == ["325 мг+10 мг+20 мг", "500.0 мг", None]
    assert [
        esklp_catalog._trade_name(row.model_dump()).strength  # pyright: ignore[reportPrivateUsage]
        for row in trade
    ] == [
        "325 мг+10 мг+20 мг",
        "500.0 мг",
        None,
    ]

    smnn = parse_smnn_rows(
        _smnn_rows(
            _row(
                37,
                {
                    0: "ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН",
                    1: "21.20.10.232-000033-1-00013-0000000000000",
                    3: "ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ПРИЕМА ВНУТРЬ",
                    4: "1.0",
                    5: "325 мг+10 мг+20 мг",
                    9: "г",
                },
            ),
            _row(
                37,
                {
                    0: "ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН",
                    1: "21.20.10.232-000033-1-00020-0000000000000",
                    3: "ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ПРИЕМА ВНУТРЬ",
                    4: "1.0",
                    5: "650 мг+10 мг+20 мг",
                    9: "г",
                },
            ),
            _row(
                37,
                {
                    0: "ПРОПОЛИС",
                    1: "21.20.10.251-000024-1-00001-0000000000000",
                    3: "ЭЛИКСИР",
                    4: "1.0",
                    5: "~",
                },
            ),
            _row(
                37,
                {
                    0: "ДИАЗЕПАМ",
                    1: "21.20.10.251-000024-1-00002-0000000000000",
                    3: "РАСТВОР",
                    4: "1.0",
                    5: "мг/мл",
                },
            ),
        )
    )
    nodes = [
        esklp_catalog._smnn_node(row.model_dump())  # pyright: ignore[reportPrivateUsage]
        for row in smnn
    ]
    assert [node.strength for node in nodes] == [
        "325 мг+10 мг+20 мг",
        "650 мг+10 мг+20 мг",
        None,
        "1.0мг/мл",
    ]
