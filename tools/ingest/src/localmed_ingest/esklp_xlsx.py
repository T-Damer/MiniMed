from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from zipfile import BadZipFile, ZipFile

_CELL_REFERENCE = re.compile(r"\$?([A-Za-z]+)\$?[1-9][0-9]*\Z")
_EDITION = re.compile(r"(?<!\d)(\d{2}\.\d{2}\.\d{4})(?!\d)")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _column_index(reference: str | None) -> int:
    if reference is None:
        raise ValueError("XLSX cell is missing a cell reference.")
    match = _CELL_REFERENCE.fullmatch(reference)
    if match is None:
        raise ValueError(f"XLSX cell has an invalid cell reference: {reference!r}.")
    column = 0
    for character in match.group(1).upper():
        column = column * 26 + ord(character) - ord("A") + 1
    return column - 1


def _text_nodes(element: ET.Element, name: str) -> str:
    return "".join(node.text or "" for node in element.iter() if _local_name(node.tag) == name)


def _shared_strings(payload: bytes) -> list[str]:
    strings: list[str] = []
    try:
        for _, element in ET.iterparse(io.BytesIO(payload), events=("end",)):
            if _local_name(element.tag) == "si":
                strings.append(_text_nodes(element, "t"))
                element.clear()
    except (ET.ParseError, UnicodeError) as error:
        raise ValueError("XLSX shared strings XML is invalid.") from error
    return strings


def _cell_text(cell: ET.Element, shared_strings: list[str], sheet_name: str) -> str:
    reference = cell.attrib.get("r", "?")
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return _text_nodes(cell, "t")

    value = next(
        (child for child in cell if _local_name(child.tag) == "v"),
        None,
    )
    text = "" if value is None else "".join(value.itertext())
    if cell_type != "s":
        return text

    index_text = text.strip()
    try:
        index = int(index_text)
    except ValueError as error:
        raise ValueError(
            f"XLSX {sheet_name} cell {reference} has an invalid shared-string index {index_text!r}."
        ) from error
    if not 0 <= index < len(shared_strings):
        raise ValueError(
            f"XLSX {sheet_name} cell {reference} has an out-of-range shared-string index {index}."
        )
    return shared_strings[index]


def _sheet_rows(payload: bytes, sheet_name: str, shared_strings: list[str]) -> list[list[str]]:
    rows: list[list[str]] = []
    has_sheet_data = False
    try:
        for _, element in ET.iterparse(io.BytesIO(payload), events=("end",)):
            name = _local_name(element.tag)
            if name == "sheetData":
                has_sheet_data = True
            elif name == "row":
                values: dict[int, str] = {}
                for cell in element:
                    if _local_name(cell.tag) != "c":
                        continue
                    column = _column_index(cell.attrib.get("r"))
                    values[column] = _cell_text(cell, shared_strings, sheet_name)
                row = [""] * (max(values, default=-1) + 1)
                for column, value in values.items():
                    row[column] = value
                rows.append(row)
                element.clear()
    except (ET.ParseError, UnicodeError) as error:
        raise ValueError(f"XLSX {sheet_name} XML is invalid.") from error
    if not has_sheet_data:
        raise ValueError(f"XLSX {sheet_name} has no sheetData.")
    return rows


def _edition(rows: list[list[str]]) -> str | None:
    for row in rows:
        for value in row:
            for match in _EDITION.finditer(value):
                try:
                    return datetime.strptime(match.group(1), "%d.%m.%Y").date().isoformat()
                except ValueError:
                    continue
    return None


def read_esklp_xlsx(payload: bytes) -> tuple[list[list[str]], str | None]:
    """Read ESKLP sheet2 rows and the edition date declared by sheet1."""
    sheet1_name = "xl/worksheets/sheet1.xml"
    sheet2_name = "xl/worksheets/sheet2.xml"
    try:
        with ZipFile(io.BytesIO(payload)) as workbook:
            names = set(workbook.namelist())
            if sheet1_name not in names:
                raise ValueError("XLSX workbook is missing required sheet1 metadata.")
            if sheet2_name not in names:
                raise ValueError("XLSX workbook is missing required sheet2 data.")
            shared_strings = (
                _shared_strings(workbook.read("xl/sharedStrings.xml"))
                if "xl/sharedStrings.xml" in names
                else []
            )
            metadata = _sheet_rows(workbook.read(sheet1_name), "sheet1", shared_strings)
            rows = _sheet_rows(workbook.read(sheet2_name), "sheet2", shared_strings)
    except ValueError:
        raise
    except (BadZipFile, EOFError, OSError, RuntimeError) as error:
        raise ValueError("Invalid XLSX ZIP archive.") from error

    return rows, _edition(metadata)
