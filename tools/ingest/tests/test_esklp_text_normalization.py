"""ESKLP-TEXT: spreadsheet serial dates and damaged package quantities never reach a card.

Owner QA on Android showed registry lines like "Период действия: 46069.0. Цена: не указано в
каталоге." and "Первичная упаковка: 000 ФЛАКОН" next to "Количество единиц: 1000". The examples
below are values of the released 2026-08-28 modules (data/build/release-esklp); the rows are small
synthetic excerpts shaped like the real ones.

Root causes, from the released data (the registry archive is not on this machine):

* the period and change dates are raw spreadsheet serials ("46069.0") in every one of the
  ~600 000 klp rows and ~7 000 nodes; nothing converted them;
* all 19 948 primary packages that start with a digit are quantity tails whose leading digit group
  is missing ("000 ФЛАКОН" next to a unit count of 1000, "667 ПАКЕТ" next to 16667): a quantity of
  its own is meaningless there and the unit count already carries it.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest import esklp_catalog
from localmed_ingest.builder import build_content_pack
from localmed_ingest.catalog_module_builder import build_catalog_metadata_modules
from localmed_ingest.esklp_rows import (  # pyright: ignore[reportPrivateUsage]
    _KLP_MARKERS,
    parse_klp_rows,
)
from localmed_ingest.esklp_strength_repair import (
    card_residue,
    repair_card_metadata,
    repair_chunk_text,
)
from localmed_ingest.esklp_text import (
    clean_package,
    damaged_quantity,
    normalize_node,
    normalize_text,
    registry_date,
)

# (the registry cell, the date a card must show)
REAL_SERIALS = [
    ("46069.0", "16.02.2026"),  # КЛП of the AVVA amoxicillin, reader excerpt of the QA
    ("44014.0", "02.07.2020"),  # Немозол, antiparasitic module
    ("45631.0", "05.12.2024"),
    ("43692.0", "15.08.2019"),  # node validity of albendazole
    ("44799.0", "26.08.2022"),  # node change date of albendazole
    ("46168.0", "26.05.2026"),  # benzyl benzoate ointment
    ("46069", "16.02.2026"),  # the same value without the ".0"
]


@pytest.mark.parametrize(("cell", "expected"), REAL_SERIALS)
def test_a_serial_date_is_written_as_dd_mm_yyyy(cell: str, expected: str) -> None:
    assert registry_date(cell) == expected


@pytest.mark.parametrize(
    ("cell", "expected"),
    [
        ("44014.0 - 46069.0", "02.07.2020 - 16.02.2026"),
        ("44014.0-46069.0", "02.07.2020 - 16.02.2026"),
        ("44014.0; 46069.0", "02.07.2020; 16.02.2026"),
        ("2026-01-15", "15.01.2026"),
        ("2026-01-15 00:00:00", "15.01.2026"),
        ("2026-01-15T09:30:00", "15.01.2026 09:30"),
        ("46069.5", "16.02.2026 12:00"),
        ("44014.0 - бессрочно", "02.07.2020 - бессрочно"),
    ],
)
def test_ranges_and_formatted_datetimes_are_read_too(cell: str, expected: str) -> None:
    assert registry_date(cell) == expected


@pytest.mark.parametrize(
    "cell",
    ["15.01.2026", "бессрочно", "5.0", "12345", "12345678", "2026-08-28/2027-08-27", "Нет"],
)
def test_a_value_that_is_not_a_date_stays_exactly_as_it_is(cell: str) -> None:
    assert registry_date(cell) == cell


def test_an_empty_date_is_absent() -> None:
    assert registry_date(None) is None
    assert registry_date("  ") is None


# (the package as the released module stores it, the unit count of its line, the package name)
REAL_DAMAGED_PACKAGES = [
    ("000 ФЛАКОН", 1000, "мл", "ФЛАКОН"),
    ("000 БАНКА", 3000, "г (г лекарственной формы)", "БАНКА"),
    ("000 БУТЫЛЬ", 10000, "мл", "БУТЫЛЬ"),
    ("667 ПАКЕТ", 16667, "шт. (таблетка)", "ПАКЕТ"),
    ("771 ПАКЕТ", 43771, "шт. (таблетка)", "ПАКЕТ"),
    ("000 000 ФЛАКОН", 1000000, "мг (мг действующего вещества)", "ФЛАКОН"),
    ("200 000 ФЛАКОН", 60000000, "ЕД", "ФЛАКОН"),
    ("333 333 МЕШКИ ПОЛИЭТИЛЕНОВЫЕ", 9999999, "шт. (таблетка)", "МЕШКИ ПОЛИЭТИЛЕНОВЫЕ"),
    ("042,7 ПАКЕТ", 85.196, "г (г лекарственной формы)", "ПАКЕТ"),
    ("025,4 ФЛАКОН", 1025.4, "мг (мг действующего вещества)", "ФЛАКОН"),
    ("000 КОНТЕЙНЕРЫ С 2 ПОРТАМИ", 9000, "мл", "КОНТЕЙНЕРЫ С 2 ПОРТАМИ"),
    ('500 СИСТЕМЫ ПЛАСТИКОВЫЕ "СТЕЙ СЕЙФ" ("STAY SAFE")', 10000, "мл", None),
]


@pytest.mark.parametrize(("stored", "unit_count", "unit", "name"), REAL_DAMAGED_PACKAGES)
def test_a_damaged_quantity_in_front_of_a_package_is_removed(
    stored: str, unit_count: float, unit: str, name: str | None
) -> None:
    assert damaged_quantity(stored)
    cleaned = clean_package(stored)
    assert cleaned is not None
    assert not damaged_quantity(cleaned)
    if name is not None:
        assert cleaned == name
    # The quantity of the line is still there, whole, in its own field.
    assert unit_count > 0
    assert unit


@pytest.mark.parametrize(
    "package",
    [
        "ФЛАКОН",
        "УПАКОВКА ЯЧЕЙКОВАЯ КОНТУРНАЯ",
        "1 ФЛАКОН",  # a real count of the registry fixture
        "10 000 ФЛАКОН",  # a whole number in groups is a quantity, not a tail
        "КОНТЕЙНЕРЫ С 2 ПОРТАМИ",
        "ФЛАКОНЫ 10 МЛ",
        "КОНТЕЙНЕРЫ ПЛАСТИКОВЫЕ 450 МЛ",
        "500 МЛ ФЛАКОН",  # a number in front of a unit is a volume, never a lost tail
    ],
)
def test_a_real_package_text_is_kept(package: str) -> None:
    assert not damaged_quantity(package)
    assert clean_package(package) == package


# ---------------------------------------------------------------------------------------------
# The row builder: raw klp cells in, a position with clean fields and the original kept.
# ---------------------------------------------------------------------------------------------


def _klp_rows(*data: list[str]) -> list[list[str]]:
    header: list[list[str]] = [[""] * 31 for _ in range(4)]
    for (row, column), text in _KLP_MARKERS.items():
        if row < 4:
            header[row][column] = text
    numbering = [str(index) for index in range(1, 32)]
    return [*header, numbering, *data]


def _klp_data_row(**cells: str) -> list[str]:
    row = [""] * 31
    row[0] = "21.20.10.243-000001-1-00012-0000000000000"
    row[1] = "БЕНЗИЛБЕНЗОАТ"
    row[3] = "21.20.10.243-000001-1-00012-2000001929311"
    row[4] = "Бензилбензоат"
    row[6] = "МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ"
    row[7] = "20 %"
    row[8] = "г (г лекарственной формы)"
    row[9] = "3000"
    row[15] = "П N014775/01-2003"
    row[24] = "Да"
    for key, value in cells.items():
        row[int(key.removeprefix("c"))] = value
    return row


def test_a_klp_row_with_serial_period_and_damaged_package_gets_clean_fields() -> None:
    rows = parse_klp_rows(_klp_rows(_klp_data_row(c10="000", c11="БАНКА", c26="43915.0", c29="")))
    position = esklp_catalog._klp_position(  # pyright: ignore[reportPrivateUsage]
        esklp_catalog._row_mapping(rows[0])  # pyright: ignore[reportPrivateUsage]
    )
    assert position.unit_count == 3000
    assert position.primary_package == "БАНКА"
    assert position.validity_period == "25.03.2020"
    dumped = position.model_dump(by_alias=True, mode="json")
    assert dumped["primaryPackageRaw"] == "000 БАНКА"
    # A plain serial is the exact inverse of its date, so only the lossy package keeps a twin.
    assert "validityPeriodRaw" not in dumped
    assert "secondaryPackageRaw" not in dumped
    assert "changedAtRaw" not in dumped


def test_a_clean_klp_row_has_no_raw_twins() -> None:
    rows = parse_klp_rows(
        _klp_rows(_klp_data_row(c11="ТУБА", c13="КАРТОННАЯ ПАЧКА", c26="15.01.2026"))
    )
    position = esklp_catalog._klp_position(  # pyright: ignore[reportPrivateUsage]
        esklp_catalog._row_mapping(rows[0])  # pyright: ignore[reportPrivateUsage]
    )
    assert (position.primary_package, position.secondary_package) == ("ТУБА", "КАРТОННАЯ ПАЧКА")
    assert position.validity_period == "15.01.2026"
    assert not [key for key in position.model_dump(by_alias=True, mode="json") if "Raw" in key]


# ---------------------------------------------------------------------------------------------
# The card builder, on a ledger of an older build (serial dates, damaged packages).
# ---------------------------------------------------------------------------------------------

_MODULE_ID = "minimed.medications.esklp.ru"
_RECORD_ID = "esklp.mnn.benzilbenzoat"


def _ledger(path: Path) -> None:
    positions: list[dict[str, object]] = [
        {
            "klpCode": "21.20.10.243-000001-1-00012-2000001929311",
            "tradeName": "Бензилбензоат",
            "registrationNumber": "ЛП-№(014230)-(РГ-RU)",
            "dosageForm": "МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ",
            "strength": "20 %",
            "unit": "г (г лекарственной формы)",
            "unitCount": 50,
            "primaryPackage": "ТУБА",
            "secondaryPackage": "КАРТОННАЯ ПАЧКА",
            "packageContents": "~",
            "holder": "ООО ПРОМОМЕД РУС",
            "manufacturer": "АО БИОХИМИК",
            "essentialDrug": True,
            "validityPeriod": "46168.0",
            "price": None,
        },
        {
            "klpCode": "21.20.10.243-000001-1-00017-2000000771345",
            "tradeName": "Бензилбензоат",
            "registrationNumber": "П N014775/01-2003",
            "dosageForm": "ЭМУЛЬСИЯ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ",
            "strength": "20 %",
            "unit": "г (г лекарственной формы)",
            "unitCount": 3000,
            "primaryPackage": "000 БАНКА",
            "secondaryPackage": "ЯЩИКИ",
            "packageContents": "~",
            "holder": "ОАО ЛУГАНСКИЙ ХИМИКО-ФАРМАЦЕВТИЧЕСКИЙ ЗАВОД",
            "manufacturer": "ОАО ЛУГАНСКИЙ ХИМИКО-ФАРМАЦЕВТИЧЕСКИЙ ЗАВОД",
            "essentialDrug": True,
            "validityPeriod": "43915.0",
            "price": None,
        },
    ]
    node: dict[str, object] = {
        "smnnCode": "21.20.10.243-000001-1-00012-0000000000000",
        "validityPeriod": "43692.0",
        "changedAt": "44799.0",
        "tradeNames": [],
        "klpPositions": positions,
    }
    record: dict[str, object] = {
        "recordKind": "esklp-mnn",
        "recordId": _RECORD_ID,
        "standardizedInn": "БЕНЗИЛБЕНЗОАТ",
        "inn": ["БЕНЗИЛБЕНЗОАТ"],
        "componentInns": [],
        "atcCodes": ["P03AX01"],
        "dosageForms": ["МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ"],
        "strengths": ["20 %"],
        "smnnNodes": [node],
        "sourceEdition": "2026-08-28",
        "sourceUrl": "https://example.test/esklp/export",
        "officialUrl": "https://esklp.example.test/mnn/benzilbenzoat",
        "sourceArchive": "esklp_20260828_excel_00001.zip",
        "status": "active",
        "coverageState": "metadata-only",
        "rights": "unknown",
        "moduleIds": [_MODULE_ID],
        "primaryModuleId": _MODULE_ID,
    }
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-07-23T00:00:00Z",
                "sourceChecksum": "sha256:" + "0" * 64,
                "summary": {"totalRecords": 1},
                "records": [record],
                "modules": [
                    {
                        "moduleId": _MODULE_ID,
                        "title": "ЕСКЛП",
                        "recordIds": [_RECORD_ID],
                        "coverageCounts": {"metadata-only": 1},
                        "priority": 100,
                        "specialties": ["fixture"],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_the_card_text_and_metadata_of_an_old_ledger_are_clean(tmp_path: Path) -> None:
    ledger = tmp_path / "esklp.json"
    _ledger(ledger)
    output = tmp_path / "modules"
    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="medication",
        version="2026.08.1",
        built_at="2026-08-30T00:00:00Z",
    )
    module_dir = output / report.modules[0].directory
    markdown = next(module_dir.glob("*.md")).read_text(encoding="utf-8")
    lines = [line for line in markdown.splitlines() if line.startswith("- КЛП:")]
    assert len(lines) == 2
    assert "Количество единиц: 50. Первичная упаковка: ТУБА. Вторичная упаковка:" in lines[0]
    assert "Период действия: 26.05.2026. Цена: не указано в каталоге." in lines[0]
    assert "Количество единиц: 3000. Первичная упаковка: БАНКА. Вторичная упаковка:" in lines[1]
    assert "Период действия: 25.03.2020. Цена: не указано в каталоге." in lines[1]
    assert not any(".0." in line or "000 БАНКА" in line for line in lines)

    database = tmp_path / "esklp.db"
    build_content_pack(module_dir, database)
    with sqlite3.connect(database) as connection:
        stored = connection.execute(
            "SELECT metadata_json FROM documents WHERE id = ?", (_RECORD_ID,)
        ).fetchone()
    assert stored is not None
    metadata = json.loads(stored[0])
    node = metadata["smnnNodes"][0]
    assert (node["validityPeriod"], node["changedAt"]) == ("15.08.2019", "26.08.2022")
    clean, damaged = node["klpPositions"]
    assert clean["validityPeriod"] == "26.05.2026"
    assert not [key for key in (*clean, *node) if key.endswith("Raw")]
    assert (damaged["primaryPackage"], damaged["primaryPackageRaw"]) == ("БАНКА", "000 БАНКА")
    assert damaged["validityPeriod"] == "25.03.2020"
    assert damaged["unitCount"] == 3000


def test_a_date_the_conversion_cannot_undo_keeps_the_registry_string() -> None:
    node: dict[str, object] = {"validityPeriod": "44014.0 - 46069.0", "changedAt": "46069.5"}
    fixed = normalize_node(node)
    assert fixed == {
        "validityPeriod": "02.07.2020 - 16.02.2026",
        "changedAt": "16.02.2026 12:00",
        "validityPeriodRaw": "44014.0 - 46069.0",
        "changedAtRaw": "46069.5",
    }
    assert normalize_node(fixed) == fixed


def test_normalizing_a_node_twice_changes_nothing_and_keeps_the_first_raw() -> None:
    node: dict[str, object] = {
        "validityPeriod": "43692.0",
        "klpPositions": [{"primaryPackage": "000 ФЛАКОН", "validityPeriod": "44014.0"}],
    }
    once = normalize_node(node)
    assert normalize_node(once) == once
    position = once["klpPositions"]
    assert isinstance(position, list)
    assert position[0] == {
        "primaryPackage": "ФЛАКОН",
        "validityPeriod": "02.07.2020",
        "primaryPackageRaw": "000 ФЛАКОН",
    }
    # The input is not touched.
    assert node["validityPeriod"] == "43692.0"


# ---------------------------------------------------------------------------------------------
# The repair of the released modules (scripts/repair_esklp_strengths.py runs these two functions).
# ---------------------------------------------------------------------------------------------

REAL_LINE = (
    "- КЛП: 21.20.10.243-000001-1-00017-2000000771345. ТН: Бензилбензоат. Регистрация: П "
    "N014775/01-2003. СМНН: БЕНЗИЛБЕНЗОАТ; smnnCode: 21.20.10.243-000001-1-00017-0000000000000. "
    "Лекарственная форма: ЭМУЛЬСИЯ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ. Дозировка/концентрация: 20 %. "
    "Единица: г (г лекарственной формы). Количество единиц: 3000. Первичная упаковка: 000 БАНКА. "
    "Вторичная упаковка: ЯЩИКИ. Содержимое упаковки: ~. Держатель регистрации: ОАО ЛУГАНСКИЙ "
    "ХИМИКО-ФАРМАЦЕВТИЧЕСКИЙ ЗАВОД. Производитель: ОАО ЛУГАНСКИЙ ХИМИКО-ФАРМАЦЕВТИЧЕСКИЙ ЗАВОД. "
    "Жизненно необходимый препарат: Да. Период действия: 43915.0. Цена: не указано в каталоге."
)


def test_the_text_of_a_released_chunk_is_repaired() -> None:
    repaired = normalize_text(REAL_LINE)
    assert (
        "Количество единиц: 3000. Первичная упаковка: БАНКА. Вторичная упаковка: ЯЩИКИ." in repaired
    )
    assert "Период действия: 25.03.2020. Цена: не указано в каталоге." in repaired
    assert repaired.replace("БАНКА", "000 БАНКА").replace("25.03.2020", "43915.0") == REAL_LINE
    assert repair_chunk_text(REAL_LINE, {}) == repaired
    assert normalize_text(repaired) == repaired


def test_a_chunk_cut_in_the_middle_of_a_value_is_left_alone() -> None:
    cut = "Количество единиц: 3000. Первичная упаковка: 000 БАНКА. Вторичная упаковка: ЯЩ"
    assert normalize_text(cut).endswith("Первичная упаковка: БАНКА. Вторичная упаковка: ЯЩ")
    assert normalize_text("Жизненно необходимый препарат: Да. Период действия: 4391") == (
        "Жизненно необходимый препарат: Да. Период действия: 4391"
    )
    assert normalize_text("Период действия: 43915.0") == "Период действия: 25.03.2020"
    # Other numbers in the text are never read as dates.
    assert normalize_text("Единица: мл. Количество единиц: 46069.") == (
        "Единица: мл. Количество единиц: 46069."
    )


def test_a_label_cut_by_the_chunk_limit_at_the_start_of_a_chunk_is_still_repaired() -> None:
    assert normalize_text("ичная упаковка: 000 КОНТЕЙНЕР. Вторичная упаковка: ПАКЕТЫ") == (
        "ичная упаковка: КОНТЕЙНЕР. Вторичная упаковка: ПАКЕТЫ"
    )
    assert normalize_text("действия: 44014.0. Цена: не указано в каталоге.") == (
        "действия: 02.07.2020. Цена: не указано в каталоге."
    )
    # Only the start of a chunk: the same words inside a line need their whole label.
    assert normalize_text("Содержимое: упаковка: 000 КОНТЕЙНЕР") == (
        "Содержимое: упаковка: 000 КОНТЕЙНЕР"
    )


def _stored_card() -> dict[str, Any]:
    return {
        "strengths": ["20 %"],
        "smnnNodes": [
            {
                "smnnCode": "21.20.10.243-000001-1-00017-0000000000000",
                "strength": "20 %",
                "validityPeriod": "43692.0",
                "changedAt": "44799.0",
                "tradeNames": [],
                "klpPositions": [
                    {
                        "klpCode": "21.20.10.243-000001-1-00017-2000000771345",
                        "unitCount": 3000,
                        "primaryPackage": "000 БАНКА",
                        "secondaryPackage": "ЯЩИКИ",
                        "validityPeriod": "43915.0",
                        "changedAt": None,
                    },
                    {
                        "klpCode": "21.20.10.243-000001-1-00012-2000001929311",
                        "unitCount": 50,
                        "primaryPackage": "ТУБА",
                        "validityPeriod": "46168.0",
                    },
                ],
            }
        ],
    }


def test_the_metadata_of_a_released_card_is_repaired_once() -> None:
    metadata = _stored_card()
    assert card_residue(metadata)
    repair = repair_card_metadata(metadata)
    assert repair.changed
    assert repair.registry_nodes == 1
    assert repair.registry_positions == 2
    assert not repair.changes
    assert card_residue(metadata) == []
    node = metadata["smnnNodes"][0]
    assert node["validityPeriod"] == "15.08.2019"
    assert "validityPeriodRaw" not in node
    damaged, clean = node["klpPositions"]
    assert damaged["primaryPackage"] == "БАНКА"
    assert damaged["primaryPackageRaw"] == "000 БАНКА"
    assert damaged["validityPeriod"] == "25.03.2020"
    assert clean["validityPeriod"] == "26.05.2026"
    assert "primaryPackageRaw" not in clean
    assert damaged["changedAt"] is None

    again = repair_card_metadata(metadata)
    assert not again.changed
