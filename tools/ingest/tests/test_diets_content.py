"""Checks of the committed official diet tables (``content/diets-official``, order 330 Tables 2a-7).

Verified 2026-10-13 against three independent copies of the order and the 70n amendment items; these
tests keep the numeric columns parsable so a re-extraction cannot silently corrupt a value.
"""

from __future__ import annotations

import re
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[3] / "content" / "diets-official"
TABLES_FILE = CONTENT / "reference.diets.instruction-tables.md"

NUMBER = re.compile(r"^\d+(?:,\d+)?$")
CELL_NUMBER = re.compile(r"^(?:\d+(?:,\d+)?(?:/\d+(?:,\d+)?)?(?: шт\.)?|-|)(?: <[*\d]+>)?$")
OIL_ADJUSTMENT = re.compile(r"^(?:|масло\s*[+-]\s*\d+ г\.?)$")


def _tables() -> dict[str, list[list[str]]]:
    """Table number (2a, 3, ..., 7) -> data rows (header and separator rows dropped)."""
    result: dict[str, list[list[str]]] = {}
    key = ""
    seen_header = False
    for line in TABLES_FILE.read_text(encoding="utf-8").splitlines():
        heading = re.match(r"# Таблица (\d+[а-я]?)\.", line)
        if heading:
            key = heading.group(1)
            result[key] = []
            seen_header = False
            continue
        if line.startswith("# "):
            key = ""
        if not key or not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if re.fullmatch(r"-{3,}", cells[0]):
            continue
        if line.startswith("| Наименование") or line.startswith("| Продукты"):
            seen_header = True
            continue
        if seen_header or key == "7":
            result[key].append(cells)
    return result


def test_file_has_no_status_note_and_all_tables() -> None:
    text = TABLES_FILE.read_text(encoding="utf-8")
    assert "не сверены построчно" not in text
    assert "machineExtracted" not in text
    assert list(_tables()) == ["2а", "3", "4", "5", "6", "7"]


def test_adult_and_child_tables_carry_numbers_in_every_value_column() -> None:
    tables = _tables()
    expected_widths = {"2а": 3, "3": 3, "4": 5, "5": 4}
    for key, width in expected_widths.items():
        rows = tables[key]
        assert len(rows) > 25, key
        for row in rows:
            assert len(row) == width, (key, row)
            for cell in row[1:]:
                assert CELL_NUMBER.fullmatch(cell), (key, row)
        valued = [row for row in rows if any(NUMBER.fullmatch(cell) for cell in row[1:])]
        assert len(valued) >= len(rows) - 12, key


def test_gross_is_not_smaller_than_net_in_the_adult_tables() -> None:
    for key in ("2а", "3"):
        for row in _tables()[key]:
            gross, net = (re.sub(r"[^\d,]", "", cell) for cell in row[1:3])
            if gross and net and "шт" not in row[1]:
                assert float(gross.replace(",", ".")) >= float(net.replace(",", ".")), (key, row)


def test_substitution_table_rows_have_macros_and_oil_adjustment_units() -> None:
    rows = _tables()["7"]
    food_rows = [row for row in rows if len(row) == 6 and NUMBER.fullmatch(row[1])]
    assert len(food_rows) >= 50
    for name, grams, protein, fat, carbs, adjustment in food_rows:
        assert name, grams
        assert 5 <= float(grams.replace(",", ".")) <= 1000, name
        assert NUMBER.fullmatch(protein), name
        assert NUMBER.fullmatch(fat), name
        assert NUMBER.fullmatch(carbs) or carbs == "-", name
        assert OIL_ADJUSTMENT.fullmatch(adjustment), (name, adjustment)
    names = {row[0] for row in food_rows}
    assert {"Хлеб ржано-пшеничный", "Баранина I к.", "Мясо верблюда"} <= names


def test_interchangeability_table_has_numeric_masses_and_no_mirror_artefacts() -> None:
    rows = _tables()["6"]
    assert len(rows) >= 55
    for row in rows:
        assert len(row) == 5, row
        assert re.fullmatch(r"\d+,\d+", row[1]), row
        assert re.fullmatch(r"\d+,\d+(?:/\d+,\d+)?(?: <\d>)?", row[3]), row
    text = TABLES_FILE.read_text(encoding="utf-8")
    assert "ко- ровье" not in text
    assert "/ /" not in text
    cream = next(row for row in rows if row[2].startswith("Сливки сухие"))
    assert cream[2].count("(") == cream[2].count(")")
