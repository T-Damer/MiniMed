"""Text normalization of the ESKLP registry values that reach the cards (STATE ESKLP-TEXT).

Two defects of the 2026-08-28 modules (owner QA on Android) are normalized here, by one rule that
the row parser, the ledger builder, the card text generator and the repair of the released
modules all call:

* Period and change dates arrive as raw spreadsheet serial numbers ("46069.0"). They are written
  as dd.mm.yyyy (`registry_date`). A value that is not a serial number is returned untouched.
* The quantity cell of a primary package arrives as a damaged tail ("000 FLASK" where the registry
  holds a quantity of the form "1 000", "667 BAG" for "16 667"): the leading digit group is
  missing, so what is left is a number in 3-digit groups followed by the package name. Such a
  quantity is wrong by construction and the package must read as its name only
  (`clean_package`). The unit count of the line already states the quantity: in the released data
  17 050 of 19 948 damaged values are exactly the tail of that unit count. The value as the
  registry file delivered it stays traceable in a `...Raw` key of the position.

Nothing here drops a value silently: a changed field keeps the original in `<field>Raw`. The one
exception is a plain whole-day serial ("46069.0"): the date is its exact inverse, so ~600 000 raw
copies would only grow the module metadata (`lossy_date_raw`).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import date, timedelta
from typing import cast

#: Day zero of the spreadsheet 1900 date system (it counts the nonexistent 1900-02-29).
EXCEL_EPOCH = date(1899, 12, 30)
#: Serial numbers read as dates: 1950-01-01 .. 2100-12-31. A registry period never lies outside.
MIN_SERIAL = 18264
MAX_SERIAL = 73415
RAW_SUFFIX = "Raw"

_SERIAL = r"\d{5}(?:\.\d+)?"
_SERIAL_ONLY = re.compile(rf"^(?P<serial>{_SERIAL})$")
_RANGE_SPLIT = re.compile(r"(\s+-\s+|\s*[–—;]\s*)")
_SERIAL_RANGE = re.compile(rf"^(?P<a>{_SERIAL})\s*-\s*(?P<b>{_SERIAL})$")
_ISO_DATE = re.compile(
    r"^(?P<y>\d{4})-(?P<m>\d{2})-(?P<d>\d{2})"
    r"(?:[T ](?P<h>\d{2}):(?P<min>\d{2})(?::\d{2}(?:\.\d+)?)?)?$"
)
#: A serial number inside a card text after the label of the period field.
_PERIOD_IN_TEXT = re.compile(
    rf"(?P<label>Период действия: )"
    rf"(?P<value>{_SERIAL}(?:\s*[-–—]\s*{_SERIAL})?)(?=\.(?:\s|$)|$)"
)
# The damaged quantity tail in front of a package name: digit groups of three, then the name.
# A value is a damaged tail only when a package name follows: a measure unit after the number
# ("500 ml") would be a real quantity and stays.
_NAME_AHEAD = r"(?!(?:мл|л|г|кг|мг|мкг|шт|ед|ме|доз[аы]?)(?!\w))(?=\D)"
_DAMAGED_QUANTITY = re.compile(rf"^\d{{3}}(?: \d{{3}})*(?:,\d+)?\s+{_NAME_AHEAD}", re.IGNORECASE)
_PACKAGE_IN_TEXT = re.compile(
    rf"(?P<label>(?:Первичная|Вторичная) упаковка: )\d{{3}}(?: \d{{3}})*(?:,\d+)?\s+{_NAME_AHEAD}",
    re.IGNORECASE,
)

# A chunk limit can cut the label of the first value of a chunk ("ичная упаковка: ...").
_CUT_PERIOD_AT_START = re.compile(
    rf"^(?P<label>(?:\S{{0,8}} )?действия: )"
    rf"(?P<value>{_SERIAL}(?:\s*[-–—]\s*{_SERIAL})?)(?=\.(?:\s|$)|$)"
)
_CUT_PACKAGE_AT_START = re.compile(
    rf"^(?P<label>(?:\S{{0,10}} )?упаковка: )\d{{3}}(?: \d{{3}})*(?:,\d+)?\s+{_NAME_AHEAD}",
    re.IGNORECASE,
)

#: Position fields that hold a spreadsheet date, and the fields of a node that do.
DATE_FIELDS = ("validityPeriod", "changedAt")
PACKAGE_FIELDS = ("primaryPackage", "secondaryPackage")


_PLAIN_SERIAL = re.compile(r"^\d{5}(?:\.0+)?$")


def lossy_date_raw(raw: str | None) -> str | None:
    """The original of a converted date when the converted text cannot give it back exactly.

    A plain whole-day serial is the exact inverse of its date and is not stored; a range, a time
    of day or an ISO text is.
    """
    return None if raw is None or _PLAIN_SERIAL.match(raw) else raw


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _serial_text(serial: str) -> str | None:
    number = float(serial)
    if not MIN_SERIAL <= number <= MAX_SERIAL:
        return None
    days = int(number)
    seconds = round((number - days) * 86400)
    moment = EXCEL_EPOCH + timedelta(days=days)
    text = moment.strftime("%d.%m.%Y")
    if seconds:
        text += f" {seconds // 3600:02d}:{seconds % 3600 // 60:02d}"
    return text


def _one_date(part: str) -> str | None:
    serial = _SERIAL_ONLY.match(part)
    if serial:
        return _serial_text(serial.group("serial"))
    iso = _ISO_DATE.match(part)
    if iso:
        try:
            day = date(int(iso.group("y")), int(iso.group("m")), int(iso.group("d")))
        except ValueError:
            return None
        text = day.strftime("%d.%m.%Y")
        if iso.group("h") and (iso.group("h"), iso.group("min")) != ("00", "00"):
            text += f" {iso.group('h')}:{iso.group('min')}"
        return text
    return None


def registry_date(value: object | None) -> str | None:
    """A registry date as dd.mm.yyyy: a spreadsheet serial number, an ISO date, or a range of them.

    Text that is none of those (an already formatted date, a free note) is returned as it was
    (trimmed); a range keeps the parts that are not dates. `None` for an empty value.
    """
    text = _clean(value)
    if text is None:
        return None
    whole = _one_date(text)
    if whole is not None:
        return whole
    serial_range = _SERIAL_RANGE.match(text)
    if serial_range:
        pieces = [serial_range.group("a"), " - ", serial_range.group("b")]
    else:
        pieces = _RANGE_SPLIT.split(text)
    converted: list[str] = []
    changed = False
    for index, piece in enumerate(pieces):
        if index % 2 == 1:
            converted.append(piece)
            continue
        date_text = _one_date(piece.strip())
        if date_text is None:
            converted.append(piece)
        else:
            converted.append(date_text)
            changed = True
    return "".join(converted) if changed else text


def damaged_quantity(value: object | None) -> bool:
    """True when `value` starts with a quantity tail that lost its leading digit group."""
    text = _clean(value)
    return text is not None and _DAMAGED_QUANTITY.match(text) is not None


def clean_package(value: object | None) -> str | None:
    """A package as its name: a damaged quantity tail in front of the name is removed."""
    text = _clean(value)
    if text is None:
        return None
    return _DAMAGED_QUANTITY.sub("", text, count=1)


def normalize_text(text: str) -> str:
    """The generated card text with spreadsheet dates and damaged package quantities repaired.

    Only the label-anchored fields of the registry lines are touched; a chunk cut in the middle of
    a value is left as it is.
    """

    def period(match: re.Match[str]) -> str:
        value = registry_date(match.group("value")) or match.group("value")
        return f"{match.group('label')}{value}"

    result = _CUT_PERIOD_AT_START.sub(period, _PERIOD_IN_TEXT.sub(period, text))
    result = _PACKAGE_IN_TEXT.sub(lambda match: match.group("label"), result)
    return _CUT_PACKAGE_AT_START.sub(lambda match: match.group("label"), result)


def _object(value: object) -> dict[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    mapping = cast(Mapping[object, object], value)
    return {str(key): item for key, item in mapping.items()}


def _normalize_fields(
    item: Mapping[str, object], fields: tuple[str, ...], rule: str
) -> dict[str, object]:
    result = dict(item)
    for field in fields:
        if field not in item:
            continue
        old = item[field]
        if not isinstance(old, str):
            continue
        new = registry_date(old) if rule == "date" else clean_package(old)
        raw_key = f"{field}{RAW_SUFFIX}"
        if new is not None and new != old:
            result[field] = new
            # The first raw value wins: a repeated pass keeps the registry's own string.
            raw = lossy_date_raw(old) if rule == "date" else old
            if raw is not None and result.get(raw_key) is None:
                result[raw_key] = raw
    return result


def without_empty_raw(item: Mapping[str, object]) -> dict[str, object]:
    """Drop the `<field>Raw` keys a model dump leaves as null: only changed fields carry one."""
    return {
        key: value
        for key, value in item.items()
        if not (key.endswith((RAW_SUFFIX, "_raw")) and value is None)
    }


def normalize_position(position: Mapping[str, object]) -> dict[str, object]:
    """A KLP position with its dates and packages normalized; changed fields keep `<field>Raw`."""
    result = _normalize_fields(position, DATE_FIELDS, "date")
    return without_empty_raw(_normalize_fields(result, PACKAGE_FIELDS, "package"))


def normalize_node(node: Mapping[str, object]) -> dict[str, object]:
    """An SMNN node with its own dates and every KLP position normalized (a copy)."""
    result = _normalize_fields(node, DATE_FIELDS, "date")
    positions = node.get("klpPositions")
    if isinstance(positions, list):
        normalized: list[object] = []
        for item in cast(list[object], positions):
            mapping = _object(item)
            normalized.append(normalize_position(mapping) if mapping is not None else item)
        result["klpPositions"] = normalized
    return without_empty_raw(result)


def raw_residue(node: Mapping[str, object]) -> list[str]:
    """Values of a node that still show a spreadsheet serial date or a damaged package quantity."""
    found: list[str] = []
    for field in DATE_FIELDS:
        value = node.get(field)
        if isinstance(value, str) and registry_date(value) != _clean(value):
            found.append(value)
    positions = node.get("klpPositions")
    if isinstance(positions, list):
        for item in cast(list[object], positions):
            mapping = _object(item)
            if mapping is None:
                continue
            for field in DATE_FIELDS:
                value = mapping.get(field)
                if isinstance(value, str) and registry_date(value) != _clean(value):
                    found.append(value)
            for field in PACKAGE_FIELDS:
                value = mapping.get(field)
                if isinstance(value, str) and damaged_quantity(value):
                    found.append(value)
    return found
