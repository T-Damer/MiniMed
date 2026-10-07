"""Deterministic preparer for the vaccination calendars of order 1122н (docs/research/vax1-*).

`fetch` downloads the official publication of the order and of the amending order with its
provenance, `ocr` recognises the scans (the repository's macOS Vision step), `prepare` builds the
structured calendar JSON from the reviewed transcription (`vaccination_calendar_1122n`) and checks
every transcribed word against the OCR text of the page the row is printed on: a word the OCR does
not find is recorded on the row, a row below the coverage floor stops the build. `check-updates`
asks the portal whether another order amends 1122н.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from localmed_ingest import vaccination_calendar_1122n as blueprint
from localmed_ingest.medical_forms import (
    PRAVO_API,
    PRAVO_PAGE,
    PRAVO_PDF,
    fetch_official_order,
    run_ocr,
    sha256_file,
)

SCHEMA_VERSION: Final = 2
CALENDAR_ID: Final = "ru.minzdrav.1122n"
OCR_METHOD: Final = "macos-vision-ocr-v1"
TRANSCRIPTION_METHOD: Final = "read-from-scan-and-checked-against-ocr-v1"
# A transcribed unit whose words the OCR finds less often than this stops the build.
COVERAGE_FLOOR: Final = 0.8
# Sources the registry knows; a new amending order has to be reviewed and added here.
SOURCES: Final[tuple[dict[str, str], ...]] = (
    {
        "role": "order",
        "eoNumber": blueprint.BASE_EO_NUMBER,
        "number": "1122н",
        "date": "2021-12-06",
    },
    {
        "role": "amendment",
        "eoNumber": blueprint.AMENDMENT_EO_NUMBER,
        "number": "677н",
        "date": "2023-12-12",
    },
)
KNOWN_ORDER_NUMBERS: Final = frozenset(source["eoNumber"] for source in SOURCES)
# Cyrillic and Latin letters of the same shape, so an OCR confusion does not count as a miss.
LOOKALIKE: Final = str.maketrans(
    {
        "a": "а",
        "b": "в",
        "c": "с",
        "e": "е",
        "h": "н",
        "k": "к",
        "m": "м",
        "o": "о",
        "p": "р",
        "t": "т",
        "x": "х",
        "y": "у",
        "ё": "е",
    }
)
WORD = re.compile(r"[a-zа-яё0-9]+", re.IGNORECASE)
ORDINALS: Final = {"Первая": 1, "Вторая": 2, "Третья": 3, "Четвертая": 4}
STEP = re.compile(
    r"(?P<ordinal>Первая|Вторая|Третья|Четвертая)? ?(?P<kind>[Вв]акцинация|[Рр]евакцинация)"
    r" против (?P<target>.+?)"
    r"(?: \((?P<qualifier>группы риска)\))?"
    r"(?: – (?P<condition>.+))?"
)
PAIRED_STEPS = re.compile(r"Вакцинация против (?P<target>.+), ревакцинация против (?P=target)")


class VaccinationSourceError(RuntimeError):
    """The transcription does not agree with the official source or with itself."""


def words(text: str) -> list[str]:
    return [match.group(0).lower().translate(LOOKALIKE) for match in WORD.finditer(text)]


def _page_texts(ocr_json: dict[str, Any]) -> dict[int, list[str]]:
    return {
        int(page["page"]): words(" ".join(str(line["text"]) for line in page["lines"]))
        for page in ocr_json["pages"]
    }


def _found(token: str, pool: set[str]) -> bool:
    if token in pool:
        return True
    if len(token) < 5:
        return False
    return bool(difflib.get_close_matches(token, pool, n=1, cutoff=0.8))


def check_against_ocr(
    texts: Sequence[str], pages: Sequence[int], page_words: dict[int, list[str]]
) -> dict[str, Any]:
    """Share of the transcribed words the OCR finds on the pages of the row, and the misses."""
    pool: set[str] = set()
    for page in pages:
        pool.update(page_words[page])
    tokens = [token for text in texts for token in words(text)]
    missing = [token for token in tokens if not _found(token, pool)]
    coverage = 1.0 if not tokens else (len(tokens) - len(missing)) / len(tokens)
    return {
        "ocrCoverage": round(coverage, 3),
        "ocrUnmatchedWords": sorted(set(missing)),
    }


def _source_url(eo_number: str, page: int) -> str:
    return f"{PRAVO_PDF}{eo_number}#page={page}"


def _source_ref(eo_number: str, appendix: str, pages: Sequence[int]) -> dict[str, Any]:
    return {
        "eoNumber": eo_number,
        "appendix": appendix,
        "pdfPages": list(pages),
        "url": _source_url(eo_number, pages[0]),
    }


def parse_item(text: str) -> dict[str, Any]:
    """Structure of one vaccination named in Appendix 1; the wording itself stays in `text`."""
    paired = PAIRED_STEPS.fullmatch(text)
    if paired:
        target = paired.group("target")
        steps = [
            {"kind": "vaccination", "ordinal": None},
            {"kind": "revaccination", "ordinal": None},
        ]
        qualifier = None
        condition = None
    else:
        match = STEP.fullmatch(text)
        if not match:
            raise VaccinationSourceError(f"cannot read the vaccination {text!r}")
        target = match.group("target")
        steps = [
            {
                "kind": "vaccination"
                if match.group("kind").lower() == "вакцинация"
                else "revaccination",
                "ordinal": ORDINALS.get(match.group("ordinal") or ""),
            }
        ]
        qualifier = match.group("qualifier")
        condition = match.group("condition")
    if target not in blueprint.INFECTIONS:
        raise VaccinationSourceError(f"unknown infection {target!r} in {text!r}")
    key, label = blueprint.INFECTIONS[target]
    return {
        "text": text,
        "infectionKey": key,
        "infection": label,
        "targets": list(blueprint.INFECTION_TARGETS[key]),
        "steps": steps,
        "qualifier": qualifier,
        "condition": condition,
        "product": _product(key, steps),
    }


def _product(infection_key: str, steps: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The vaccine Appendix 3 names for a single step; `None` when it names none."""
    if len(steps) != 1:
        return None
    step = steps[0]
    entry = blueprint.PRODUCTS.get((infection_key, step["kind"], step["ordinal"]))
    if entry is None:
        return None
    code, label, risk_code = entry
    return {
        "code": code,
        "label": label,
        "riskCode": risk_code,
        "procedureNumber": blueprint.PRODUCT_PARAGRAPH,
    }


def _item_band(item: dict[str, Any], row: blueprint.NationalRow) -> str:
    """`all` for an age row, `risk` for a printed «группы риска», else the category's band."""
    if row.age is not None or row.population == "adults":
        return "risk" if item["qualifier"] else "all"
    return blueprint.CATEGORY_CHART[row.number][0]


def _national_item(row: blueprint.NationalRow, index: int, text: str) -> dict[str, Any]:
    item = parse_item(text)
    return {"id": f"n-{row.number:02d}-{index}", **item, "band": _item_band(item, row)}


def _national_rows(page_words: dict[int, list[str]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in blueprint.NATIONAL_ROWS:
        verification = check_against_ocr([row.category, *row.items], row.pages, page_words)
        rows.append(
            {
                "id": f"n-{row.number:02d}",
                "number": str(row.number),
                "category": row.category,
                "ageLabel": row.age_label,
                "age": (
                    None
                    if row.age is None
                    else {"unit": row.age[0], "from": row.age[1], "to": row.age[2]}
                ),
                "population": row.population,
                "ageSpan": (
                    {"fromMonths": blueprint.CATEGORY_CHART[row.number][1], "toMonths": None}
                    if row.age is None and row.population != "adults"
                    else None
                ),
                "items": [
                    _national_item(row, index, item)
                    for index, item in enumerate(row.items, start=1)
                ],
                "source": _source_ref(blueprint.BASE_EO_NUMBER, "1", row.pages),
                "verification": verification,
            }
        )
    return rows


def _blocks(blocks: Sequence[blueprint.Block]) -> list[dict[str, str]]:
    return [
        {"kind": "bullet" if kind == "b" else "paragraph", "text": text} for kind, text in blocks
    ]


def _epidemic_rows(
    page_words_by_order: dict[str, dict[int, list[str]]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in blueprint.EPIDEMIC_ROWS:
        eo_number = blueprint.AMENDMENT_EO_NUMBER if row.amended_by else blueprint.BASE_EO_NUMBER
        texts = [row.vaccine, *(text for _kind, text in row.blocks)]
        verification = check_against_ocr(texts, row.pages, page_words_by_order[eo_number])
        entry: dict[str, Any] = {
            "id": f"e-{row.number:02d}",
            "number": str(row.number),
            "vaccine": row.vaccine,
            "target": row.vaccine.removeprefix("Против "),
            "categories": _blocks(row.blocks),
            "population": row.population,
            "source": _source_ref(eo_number, "2", row.pages),
            "verification": verification,
        }
        if row.amended_by:
            entry["amendedBy"] = row.amended_by
            entry["previousEdition"] = {
                "categories": _blocks(row.previous_blocks),
                "source": _source_ref(blueprint.BASE_EO_NUMBER, "2", (12,)),
                "verification": check_against_ocr(
                    [text for _kind, text in row.previous_blocks],
                    (12,),
                    page_words_by_order[blueprint.BASE_EO_NUMBER],
                ),
            }
        rows.append(entry)
    return rows


def _applies_to(item: blueprint.ProcedureItem) -> list[str]:
    """What a paragraph of Appendix 3 is about; every infection must occur in its text."""
    text = " ".join(item.blocks).lower()
    for key in item.applies_to:
        if key == "general":
            continue
        stem = blueprint.APPLIES_TO_STEMS.get(key)
        if stem is None or stem not in text:
            raise VaccinationSourceError(f"paragraph {item.number} is not about {key!r}")
    return list(item.applies_to)


def _procedure_items(
    page_words_by_order: dict[str, dict[int, list[str]]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in blueprint.PROCEDURE_ITEMS:
        eo_number = blueprint.AMENDMENT_EO_NUMBER if item.amended_by else blueprint.BASE_EO_NUMBER
        entry: dict[str, Any] = {
            "id": f"p-{item.number:02d}",
            "number": str(item.number),
            "appliesTo": _applies_to(item),
            "blocks": list(item.blocks),
            "source": _source_ref(eo_number, "3", item.pages),
            "verification": check_against_ocr(
                item.blocks, item.pages, page_words_by_order[eo_number]
            ),
        }
        if item.footnote is not None:
            footnote = blueprint.PROCEDURE_FOOTNOTES[item.footnote]
            entry["footnote"] = {
                "number": item.footnote,
                "text": footnote,
                "verification": check_against_ocr(
                    [footnote], item.pages, page_words_by_order[eo_number]
                ),
            }
        if item.amended_by:
            entry["amendedBy"] = item.amended_by
        items.append(entry)
    return items


def _source_record(source: dict[str, str], record: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": source["role"],
        "eoNumber": record["eoNumber"],
        "orderNumber": record["orderNumber"],
        "orderDate": record["orderDate"],
        "title": " ".join(str(record["complexName"]).split()),
        "registration": record["registration"],
        "publicationUrl": record["publicationUrl"],
        "pdfUrl": record["pdfUrl"],
        "pagesCount": record["pagesCount"],
        "bytes": record["bytes"],
        "sha256": record["sha256"],
        "retrievedAt": record["retrievedAt"],
    }


def _all_rows_checked(calendar: dict[str, Any]) -> None:
    """Stop when a transcribed row is not supported by the OCR text of its pages."""
    units = [
        *calendar["national"]["rows"],
        *calendar["epidemic"]["rows"],
        *calendar["procedure"]["items"],
    ]
    units += [
        {"id": f"{row['id']}/previous", "verification": row["previousEdition"]["verification"]}
        for row in calendar["epidemic"]["rows"]
        if "previousEdition" in row
    ]
    units += [
        {"id": f"{item['id']}/footnote", "verification": item["footnote"]["verification"]}
        for item in calendar["procedure"]["items"]
        if "footnote" in item
    ]
    weak = [
        (unit["id"], unit["verification"])
        for unit in units
        if unit["verification"]["ocrCoverage"] < COVERAGE_FLOOR
    ]
    if weak:
        raise VaccinationSourceError(f"rows below the OCR coverage floor: {weak}")


def prepare(source_dir: Path, ocr_dir: Path | None = None) -> dict[str, Any]:
    """Build the calendar from `<eoNumber>.source.json` and `<eoNumber>.ocr.json` files."""
    ocr_root = ocr_dir or source_dir
    records: dict[str, dict[str, Any]] = {}
    page_words_by_order: dict[str, dict[int, list[str]]] = {}
    for source in SOURCES:
        eo_number = source["eoNumber"]
        record = json.loads((source_dir / f"{eo_number}.source.json").read_text(encoding="utf-8"))
        if record["orderNumber"] != source["number"] or record["orderDate"] != source["date"]:
            raise VaccinationSourceError(f"{eo_number} is not order {source['number']}")
        records[eo_number] = record
        ocr_json = json.loads((ocr_root / f"{eo_number}.ocr.json").read_text(encoding="utf-8"))
        page_words_by_order[eo_number] = _page_texts(ocr_json)
        if len(page_words_by_order[eo_number]) != record["pagesCount"]:
            raise VaccinationSourceError(f"{eo_number}: OCR page count differs from the source")
    calendar: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "id": CALENDAR_ID,
        "title": "Национальный календарь профилактических прививок и календарь профилактических "
        "прививок по эпидемическим показаниям",
        "edition": {
            "editionLine": "по приказу № 1122н в ред. приказа № 677н",
            "label": "Приказ Минздрава России от 06.12.2021 № 1122н (рег. Минюста № 66435 от "
            "20.12.2021) в редакции приказа от 12.12.2023 № 677н (рег. Минюста № 77040 от "
            "30.01.2024)",
            "inForceFrom": "2024-09-01",
            "validUntil": "2030-09-01",
            "checkedOn": "2026-10-05",
            "amendingOrders": ["677н"],
            "searchNote": "Поиск на publication.pravo.gov.ru по номеру 1122н и по словам "
            "«прививок», «календаря» (2026-10-05) нашёл один изменяющий приказ — № 677н.",
        },
        "sources": [_source_record(source, records[source["eoNumber"]]) for source in SOURCES],
        "national": {
            "appendix": "1",
            "title": "Национальный календарь профилактических прививок",
            "columns": [
                "№ п/п",
                "Категории и возраст граждан, подлежащих обязательной вакцинации",
                "Наименование профилактической прививки",
            ],
            "chart": {
                "targets": [{"key": key, "label": label} for key, label in blueprint.CHART_TARGETS],
            },
            "rows": _national_rows(page_words_by_order[blueprint.BASE_EO_NUMBER]),
        },
        "epidemic": {
            "appendix": "2",
            "title": "Календарь профилактических прививок по эпидемическим показаниям",
            "columns": [
                "№ п/п",
                "Наименование профилактической прививки",
                "Категории граждан, подлежащих обязательной вакцинации",
            ],
            "rows": _epidemic_rows(page_words_by_order),
        },
        "procedure": {
            "appendix": "3",
            "title": "Порядок проведения профилактических прививок",
            "items": _procedure_items(page_words_by_order),
        },
        "review": {
            "transcription": TRANSCRIPTION_METHOD,
            "ocrMethod": OCR_METHOD,
            "clinicalReview": "none",
            "notes": list(blueprint.REVIEW_NOTES),
        },
    }
    _all_rows_checked(calendar)
    return calendar


def write_calendar(calendar: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(calendar, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ocr_only_words(
    source_dir: Path, ocr_dir: Path | None = None
) -> dict[str, dict[int, list[str]]]:
    """OCR words of table pages that appear in no transcribed text of the page (review aid)."""
    ocr_root = ocr_dir or source_dir
    calendar = prepare(source_dir, ocr_dir)
    used: dict[tuple[str, int], Counter[str]] = {}

    def add(eo_number: str, pages: Sequence[int], texts: Sequence[str]) -> None:
        for page in pages:
            used.setdefault((eo_number, page), Counter()).update(
                token for text in texts for token in words(text)
            )

    for row in calendar["national"]["rows"]:
        add(
            row["source"]["eoNumber"],
            row["source"]["pdfPages"],
            [row["category"], *(i["text"] for i in row["items"])],
        )
    for row in calendar["epidemic"]["rows"]:
        add(
            row["source"]["eoNumber"],
            row["source"]["pdfPages"],
            [row["vaccine"], *(b["text"] for b in row["categories"])],
        )
    for item in calendar["procedure"]["items"]:
        add(item["source"]["eoNumber"], item["source"]["pdfPages"], item["blocks"])
        if "footnote" in item:
            add(item["source"]["eoNumber"], item["source"]["pdfPages"], [item["footnote"]["text"]])
    for row in calendar["epidemic"]["rows"]:
        if "previousEdition" in row:
            previous = row["previousEdition"]
            add(
                previous["source"]["eoNumber"],
                previous["source"]["pdfPages"],
                [block["text"] for block in previous["categories"]],
            )
    result: dict[str, dict[int, list[str]]] = {}
    for source in SOURCES:
        eo_number = source["eoNumber"]
        ocr_json = json.loads((ocr_root / f"{eo_number}.ocr.json").read_text(encoding="utf-8"))
        for page, tokens in _page_texts(ocr_json).items():
            pool = set(used.get((eo_number, page), Counter()))
            extra = [token for token in tokens if len(token) >= 5 and not _found(token, pool)]
            if extra:
                result.setdefault(eo_number, {})[page] = sorted(set(extra))
    return result


def check_updates() -> list[str]:
    """Orders on the portal that mention 1122н and are not in the registry (needs the network)."""
    unknown: list[str] = []
    query = urllib.parse.urlencode({"Name": "1122н", "PageSize": 100})
    with urllib.request.urlopen(f"{PRAVO_API}/Documents?{query}", timeout=60) as response:
        listing = json.load(response)
    for item in listing.get("items", []):
        title = str(item.get("complexName", ""))
        if "Министерства здравоохранения" not in title or "прививок" not in title:
            continue
        if str(item["eoNumber"]) not in KNOWN_ORDER_NUMBERS:
            unknown.append(
                f"{item['eoNumber']} {item['documentDate'][:10]} {' '.join(title.split())}"
            )
    return unknown


def fetch(out_dir: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for source in SOURCES:
        record = fetch_official_order(out_dir, number=source["number"], date=source["date"])
        if record["eoNumber"] != source["eoNumber"]:
            raise VaccinationSourceError(f"portal returned {record['eoNumber']} for {source}")
        records.append(record)
    return records


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vaccination_calendar", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_cmd = sub.add_parser("fetch", help="download the official PDFs with their provenance")
    fetch_cmd.add_argument("--out", type=Path, default=Path("data/raw/vaccination-calendar"))
    ocr_cmd = sub.add_parser("ocr", help="recognise the scanned PDFs (macOS Vision)")
    ocr_cmd.add_argument("--dir", type=Path, default=Path("data/raw/vaccination-calendar"))
    ocr_cmd.add_argument("--swift", type=Path, default=Path("tools/ingest/macos_vision_ocr.swift"))
    prepare_cmd = sub.add_parser("prepare", help="build the calendar JSON")
    prepare_cmd.add_argument("--dir", type=Path, default=Path("data/raw/vaccination-calendar"))
    prepare_cmd.add_argument("--out", type=Path, required=True)
    review_cmd = sub.add_parser("review", help="list OCR words that no transcribed text covers")
    review_cmd.add_argument("--dir", type=Path, default=Path("data/raw/vaccination-calendar"))
    sub.add_parser("check-updates", help="ask the portal for orders that mention 1122н")
    args = parser.parse_args(argv)
    if args.command == "fetch":
        for record in fetch(args.out):
            print(json.dumps(record, ensure_ascii=False))
    elif args.command == "ocr":
        for source in SOURCES:
            eo_number = source["eoNumber"]
            run_ocr(args.dir / f"{eo_number}.pdf", args.dir / f"{eo_number}.ocr.json", args.swift)
            print(f"recognised {eo_number} ({sha256_file(args.dir / f'{eo_number}.pdf')})")
    elif args.command == "prepare":
        write_calendar(prepare(args.dir), args.out)
        print(f"wrote {args.out}")
    elif args.command == "review":
        print(json.dumps(ocr_only_words(args.dir), ensure_ascii=False, indent=2))
    else:
        unknown = check_updates()
        for line in unknown:
            print(f"NEW: {line}")
        print(f"{len(unknown)} order(s) not in the registry at {datetime.now(UTC).date()}")
        return 1 if unknown else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["PRAVO_PAGE", "main", "prepare"]
