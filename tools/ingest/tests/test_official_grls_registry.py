from __future__ import annotations

import json
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from localmed_ingest.official_grls_registry import (
    _hidden_fields,
    _instruction_url,
    parse_grls_archive,
)


def xlsx(status: str, rows: list[tuple[str, str]]) -> bytes:
    cells = [
        '<row r="1"/>',
        '<row r="2"/>',
        (
            '<row r="3"><c r="D3" t="inlineStr"><is><t>'
            "Государственный реестр по состоянию на 24.07.2026"
            "</t></is></c></row>"
        ),
        '<row r="4"/>',
        '<row r="5"/>',
        f'<row r="6"><c r="C6" t="inlineStr"><is><t>{status}</t></is></c></row>',
    ]
    for index, (registration_number, trade_name) in enumerate(rows, start=7):
        cells.append(
            f'<row r="{index}">'
            f'<c r="C{index}" t="inlineStr"><is><t>{registration_number}</t></is></c>'
            f'<c r="I{index}" t="inlineStr"><is><t>{trade_name}</t></is></c>'
            f'<c r="J{index}" t="inlineStr"><is><t>тестовое МНН</t></is></c>'
            f'<c r="K{index}" t="inlineStr"><is><t>'
            "таблетки, 500 мг - По рецепту;"
            "</t></is></c>"
            "</row>"
        )
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(cells)}</sheetData>"
        "</worksheet>"
    ).encode()
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return output.getvalue()


def test_grls_archive_prefers_current_records_and_parses_instruction_metadata() -> None:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "grls-Действует-на-подтверждении.xlsx",
            xlsx(
                "Действует, на подтверждении государственной регистрации",
                [("ЛП-1", "Текущий препарат")],
            ),
        )
        archive.writestr(
            "grls-Истёкший.xlsx",
            xlsx(
                "Истёкший",
                [("ЛП-1", "Старая редакция"), ("ЛП-2", "Исторический препарат")],
            ),
        )

    records, source_counts, edition = parse_grls_archive(output.getvalue())

    assert edition == "24.07.2026"
    assert source_counts == {
        "Действует, на подтверждении государственной регистрации": 1,
        "Истёкший": 2,
    }
    assert [(record["registrationNumber"], record["tradeName"]) for record in records] == [
        ("ЛП-1", "Текущий препарат"),
        ("ЛП-2", "Исторический препарат"),
    ]
    assert records[0]["dosageForm"] == "таблетки"
    assert records[0]["prescriptionStatus"] == "По рецепту"

    assert _hidden_fields('<input type="hidden" name="__VIEWSTATE" value="token" />') == {
        "__VIEWSTATE": "token"
    }
    url, label = _instruction_url(
        json.dumps(
            {
                "d": json.dumps(
                    {
                        "Sources": [
                            {
                                "Instructions": [
                                    {
                                        "Images": [
                                            {
                                                "Url": "\\InstrImg\\2026\\07\\24\\test.pdf",
                                                "Label": "Текущая инструкция",
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    ensure_ascii=False,
                )
            },
            ensure_ascii=False,
        ).encode()
    )
    assert url == "https://grls.rosminzdrav.ru/InstrImg/2026/07/24/test.pdf"
    assert label == "Текущая инструкция"
