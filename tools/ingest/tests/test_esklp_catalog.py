from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile

from typer.testing import CliRunner

from localmed_ingest.catalog_module_builder import CoverageLedgerEnvelope
from localmed_ingest.regulated_catalog_cli import app

_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _xlsx(rows: list[list[str]], *, edition: str = "15.01.2026") -> bytes:
    strings: list[str] = []
    indexes: dict[str, int] = {}
    for row in rows:
        for value in row:
            if value and value not in indexes:
                indexes[value] = len(strings)
                strings.append(value)

    def column_name(index: int) -> str:
        result = ""
        while index:
            index, remainder = divmod(index - 1, 26)
            result = chr(65 + remainder) + result
        return result

    shared = "".join(f'<si><t xml:space="preserve">{escape(value)}</t></si>' for value in strings)
    sheet_rows: list[str] = []
    for row_number, row in enumerate(rows, 1):
        cells = "".join(
            f'<c r="{column_name(column + 1)}{row_number}" t="s"><v>{indexes[value]}</v></c>'
            for column, value in enumerate(row)
            if value
        )
        sheet_rows.append(f'<row r="{row_number}">{cells}</row>')
    sheet = f'<worksheet xmlns="{_NS}"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    metadata = (
        f'<worksheet xmlns="{_NS}"><sheetData>'
        f'<row r="1"><c r="A1" t="inlineStr"><is><t>'
        f"Действующие данные по состоянию на {escape(edition)}</t>"
        f'</is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>'
        f"Версия формата</t></is></c></row>"
        '<row r="4"><c r="A4" t="inlineStr"><is><t>2.0.4</t></is></c></row>'
        "</sheetData></worksheet>"
    )
    output = io.BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("xl/sharedStrings.xml", f'<sst xmlns="{_NS}">{shared}</sst>')
        archive.writestr("xl/worksheets/sheet1.xml", metadata)
        archive.writestr("xl/worksheets/sheet2.xml", sheet)
    return output.getvalue()


def _archive(path: Path) -> bytes:
    def row(width: int, values: dict[int, str]) -> list[str]:
        result = [""] * width
        for column, value in values.items():
            result[column - 1] = value
        return result

    smnn_headers = row(
        37,
        {
            1: "Стандартизованное МНН",
            2: "Код узла СМНН",
            3: "Код ОКПД 2",
            4: "Стандартизованная лекарственная форма",
            5: "Стандартизованная дозировка",
            6: "Единица измерения дозировки",
            10: "Единица измерения лекарственного препарата",
            13: "Наименование ФТГ",
            14: "АТХ",
            16: "ЖНВЛП",
            17: (
                "Наличие в лекарственном препарате наркотических средств, психотропных "
                "веществ и их прекурсоров"
            ),
            18: "Период действия узла СМНН",
            20: "Дата изменения записи",
            21: "Референтные цены",
            34: "Список нормализованных МНН для узла СМНН",
            35: "Список нормализованных лекарственных форм и дозировок для узла СМНН",
            36: "КЛП",
            37: "Некорректные данные",
        },
    )
    smnn = [
        smnn_headers,
        ["", "", "", "", "Кол-во", "Единица измерения"],
        ["", "", "", "", "", "", "", "", "", "Наименование"],
        [str(index) for index in range(1, 38)],
        row(
            37,
            {
                1: "Мирамистин",
                2: "SMNN-001",
                4: "РАСТВОР",
                5: "0.01",
                6: "%",
                10: "мл",
                13: "Антисептическое средство",
                14: "D08AJ01",
                16: "Да",
                17: "Нет",
                18: "15.01.2026",
                20: "16.01.2026",
                34: "МИРАМИСТИН",
                35: "РАСТВОР (0.01%)",
                37: "Некорректные данные: поле формы",
            },
        ),
        row(
            37,
            {
                1: "МИРАМИСТИН",
                2: "SMNN-002",
                4: "МАЗЬ",
                5: "0.02",
                6: "%",
                10: "г",
                13: "Антисептическое средство",
                14: "D08AJ01",
                16: "Да",
                17: "Нет",
                18: "15.01.2026",
                20: "17.01.2026",
                34: "МИРАМИСТИН",
                35: "МАЗЬ (0.02%)",
            },
        ),
        row(
            37,
            {
                1: "Амоксициллин+Клавулановая кислота",
                2: "SMNN-COMBO",
                4: "ТАБЛЕТКИ",
                5: "875+125",
                6: "мг",
                10: "шт.",
                13: "Антибактериальное средство",
                14: "J01CR02",
                16: "Нет",
                17: "Нет",
                18: "15.01.2026",
                20: "18.01.2026",
                34: "АМОКСИЦИЛЛИН+КЛАВУЛАНОВАЯ КИСЛОТА",
                35: "ТАБЛЕТКИ (875+125 мг)",
            },
        ),
    ]
    tn_headers = [
        "Торговое наименование",
        "Номер регистрационного удостоверения",
        "Код узла СМНН",
        "Стандартизованное МНН",
        "Стандартизованная лекарственная форма",
        "Стандартизованная дозировка",
        "Единица измерения дозировки",
        "Код ОКЕИ",
        "Наименование единицы из ОКЕИ",
        "Единица измерения лекарственного препарата",
        "Список нормализованных МНН",
        "Список нормализованных лекарственных форм и дозировок",
    ]
    tn = [
        tn_headers,
        ["", "", "", "", "", "Кол-во", "Единица измерения"],
        ["", "", "", "", "", "", "", "Наименование"],
        [str(index) for index in range(1, 13)],
        row(
            12,
            {
                1: "Мирамистин Альфа",
                2: "ЛП-000001",
                3: "SMNN-001",
                4: "Мирамистин",
                5: "РАСТВОР",
                6: "0.01",
                7: "%",
                10: "мл",
                11: "МИРАМИСТИН",
                12: "РАСТВОР (0.01%)",
            },
        ),
        row(
            12,
            {
                1: "Мирамистин Бета",
                2: "ЛП-000002",
                3: "SMNN-001",
                4: "МИРАМИСТИН",
                5: "РАСТВОР",
                6: "0.01",
                7: "%",
                10: "мл",
                11: "МИРАМИСТИН",
                12: "РАСТВОР (0.01%)",
            },
        ),
    ]
    klp_headers = row(
        31,
        {
            1: "Узел СМНН",
            4: "Код КЛП",
            5: "Торговое наименование",
            6: "Нормализованное МНН",
            7: "Нормализованная лекарственная форма",
            8: "Нормализованная дозировка",
            9: "Наименование единицы измерения лекарственного препарата",
            10: "Кол-во ЕИ ЛП во вторичной (потребительской) упаковке",
            11: "Первичная упаковка",
            13: "Вторичная (потребительская) упаковка",
            15: "Комплектность вторичной (потребительской) упаковки",
            16: "Регистрационное удостоверение",
            21: "Производитель",
            25: "ЖНВЛП",
            26: (
                "Наличие в лекарственном препарате наркотических средств, психотропных "
                "веществ и их прекурсоров"
            ),
            27: "Период действия КЛП",
            29: "Дата изменения записи",
            30: "Предельная отпускная цена на позицию КЛП",
            31: "Некорректные данные",
        },
    )
    klp = [
        klp_headers,
        [
            "Код узла СМНН",
            "Стандартизованное МНН",
            "Стандартизованная лекарственная форма и дозировка",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "Кол-во лекарственной формы",
            "Наименование",
            "Кол-во первичных упаковок",
            "Наименование",
            "",
            "Номер",
            "Владелец регистрационного удостоверения",
        ],
        ["", "", "", "", "", "", "", "", "", "", "", "Наименование", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        [str(index) for index in range(1, 32)],
        row(
            31,
            {
                1: "SMNN-001",
                2: "МИРАМИСТИН",
                3: "РАСТВОР (0.01%)",
                4: "KLP-000001",
                5: "Мирамистин Альфа",
                6: "МИРАМИСТИН",
                7: "РАСТВОР",
                8: "0.01%",
                9: "мл",
                10: "150",
                11: "1",
                12: "ФЛАКОН",
                13: "1",
                14: "ПАЧКА",
                15: "1 флакон",
                16: "ЛП-000001",
                17: "ООО Альфа & Ко",
                21: "АО Завод",
                25: "Да",
                26: "Нет",
                27: "15.01.2026",
                29: "16.01.2026",
                30: "12.50",
                31: "Некорректные данные: упаковка",
            },
        ),
        row(
            31,
            {
                1: "SMNN-001",
                2: "МИРАМИСТИН",
                3: "РАСТВОР (0.01%)",
                4: "KLP-000002",
                5: "Мирамистин Бета",
                6: "МИРАМИСТИН",
                7: "РАСТВОР",
                8: "0.01%",
                9: "мл",
                10: "50",
                11: "1",
                12: "ТУБА",
                13: "1",
                14: "ПАЧКА",
                15: "1 туба",
                16: "ЛП-000002",
                17: "ООО Бета",
                21: "АО Фабрика",
                25: "Да",
                26: "Нет",
                27: "15.01.2026",
                29: "17.01.2026",
                30: "8.75",
            },
        ),
        row(
            31,
            {
                1: "SMNN-002",
                2: "МИРАМИСТИН",
                3: "МАЗЬ (0.02%)",
                4: "KLP-000003",
                5: "Мирамистин Бета",
                6: "МИРАМИСТИН",
                7: "МАЗЬ",
                8: "0.02%",
                9: "г",
                10: "30",
                11: "1",
                12: "ТУБА",
                13: "1",
                14: "ПАЧКА",
                15: "1 туба",
                16: "ЛП-000002",
                17: "ООО Бета",
                21: "АО Фабрика",
                25: "Да",
                26: "Нет",
                27: "15.01.2026",
                29: "18.01.2026",
                30: "9.25",
            },
        ),
    ]
    klp_header = klp[:5]
    klp_shards = [
        [*klp_header, klp[5]],
        [*klp_header, *klp[6:]],
    ]
    members = {
        "esklp_smnn_20260115.xlsx": _xlsx(smnn),
        "tn_smnn_20260115.xlsx": _xlsx(tn),
        "esklp_klp_20260115_00000.xlsx": _xlsx(klp_shards[0]),
        "esklp_klp_20260115_00001.xlsx": _xlsx(klp_shards[1]),
    }
    payload = io.BytesIO()
    with ZipFile(payload, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    data = payload.getvalue()
    path.write_bytes(data)
    return data


def test_esklp_command_builds_mnn_centric_joined_ledger(tmp_path: Path) -> None:
    archive = tmp_path / "esklp_20260115_excel_00001.zip"
    archive_bytes = _archive(archive)
    output = tmp_path / "ledger.json"
    taxonomy = Path(__file__).resolve().parents[3] / "content" / "medication-module-taxonomy.yaml"

    result = CliRunner().invoke(
        app,
        [
            "esklp",
            "--archive",
            str(archive),
            "--taxonomy",
            str(taxonomy),
            "--output",
            str(output),
            "--generated-at",
            "2026-01-20T00:00:00Z",
        ],
    )

    assert result.exit_code == 0, result.stdout
    ledger = json.loads(output.read_text(encoding="utf-8"))
    CoverageLedgerEnvelope.model_validate(ledger)
    assert ledger["sourceChecksum"] == f"sha256:{hashlib.sha256(archive_bytes).hexdigest()}"
    assert ledger["sourceEdition"] == "2026-01-15"
    assert ledger["generatedAt"] == "2026-01-20T00:00:00Z"

    miramistin = next(
        record for record in ledger["records"] if record["standardizedInn"] == "Мирамистин"
    )
    assert miramistin["recordKind"] == "esklp-mnn"
    assert miramistin["recordId"] == "esklp.mnn.мирамистин"
    assert miramistin["moduleIds"] == ["minimed.medications.dermatological.ru"]
    assert [node["smnnCode"] for node in miramistin["smnnNodes"]] == [
        "SMNN-001",
        "SMNN-002",
    ]
    first = miramistin["smnnNodes"][0]
    assert {trade["registrationNumber"] for trade in first["tradeNames"]} == {
        "ЛП-000001",
        "ЛП-000002",
    }
    assert {position["klpCode"] for position in first["klpPositions"]} == {
        "KLP-000001",
        "KLP-000002",
    }
    assert {
        position["klpCode"] for node in miramistin["smnnNodes"] for position in node["klpPositions"]
    } == {"KLP-000001", "KLP-000002", "KLP-000003"}
    assert all("klpPositions" not in trade for trade in first["tradeNames"])
    assert first["diagnostics"] == ["Некорректные данные: поле формы"]
    assert first["klpPositions"][0]["diagnostics"] == ["Некорректные данные: упаковка"]
    assert first["klpPositions"][0]["registrationNumber"] == "ЛП-000001"
    assert first["klpPositions"][0]["primaryPackage"] == "1 ФЛАКОН"
    assert first["klpPositions"][0]["secondaryPackage"] == "1 ПАЧКА"

    combination = next(
        record
        for record in ledger["records"]
        if record["standardizedInn"] == "Амоксициллин+Клавулановая кислота"
    )
    assert combination["componentInns"] == ["Амоксициллин", "Клавулановая кислота"]
