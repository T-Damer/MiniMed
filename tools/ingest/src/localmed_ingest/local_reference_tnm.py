"""Personal-use TNM module from the MedElement "Spravochnik vracha" ``tnm.sqlite``.

One Markdown document per localisation. The source keeps each TNM block (T, N, M, pTNM, G, stage
groups, prognostic factors, rules) as an HTML fragment; ``local_reference_html`` turns it into
Markdown without rewording anything, and stage tables into GFM tables (a rowspan/colspan cell is
repeated, a table that cannot be converted faithfully is marked, not guessed). ICD-10 codes found
in the anatomical-sites block go to ``icd10Codes`` so a code search finds the right document.

The text of the UICC/AJCC TNM classification is for the owner's personal use only (see
``local_reference_common``): the module is packaged as a local-only bundle and never enters git.
"""

from __future__ import annotations

import re
import sqlite3
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .local_reference_common import (
    RIGHTS_STATUS,
    SOURCE_LABEL,
    SOURCE_TYPE,
    LocalModuleSpec,
    file_sha256,
    front_matter_document,
    source_marker,
    write_workspace,
)
from .local_reference_html import (
    Conversion,
    field_to_markdown,
    html_text,
)

MODULE_ID = "minimed.local.tnm.ru"
DOCUMENT_PREFIX = "local.tnm."
DATABASE_NAME = "tnm.sqlite"
SOURCE_NAME = "Справочник врача (MedElement), справочник TNM"
SPEC = LocalModuleSpec(
    module_id=MODULE_ID,
    file_stem=MODULE_ID,
    title="TNM (личное)",
    collection="local-tnm",
    document_prefix=DOCUMENT_PREFIX,
    source_name=SOURCE_NAME,
    description_head=(
        "Классификация TNM по локализациям: категории T, N, M, pTNM, G, группировка по стадиям, "
        "прогностические факторы и правила, с кодами МКБ-10:"
    ),
    tags=("oncology", "tnm", "staging", "personal-use-only", "local"),
)
# (column, section title) in the order of the source record.
SECTIONS: tuple[tuple[str, str], ...] = (
    ("anatomical_sites", "Анатомические области и коды МКБ-10"),
    ("lymph_nodes", "Регионарные лимфатические узлы"),
    ("t", "T — первичная опухоль"),
    ("n", "N — регионарные лимфатические узлы"),
    ("m", "M — отдалённые метастазы"),
    ("ptnm", "pTNM — патогистологическая классификация"),
    ("g", "G — гистопатологическая градация"),
    ("stage", "Группировка по стадиям"),
    ("prognostic", "Прогностические факторы"),
    ("rules", "Правила классификации"),
)
_TNM_WORD = re.compile(r"(?:T\s?NM|ТNM|ТNМ|TNМ|UICC|AJCC|МСР)", re.IGNORECASE)
_EDITION = re.compile(
    r"(?P<number>\d{1,2})\s*-?\s*(?:е|й|го|ое|ого)?\s*(?:изд(?:ани[еяю]|\b\.?)|пересмотр[а-я]*)"
    r"(?:\s*,?\s*(?P<year>(?:19|20)\d{2}))?",
    re.IGNORECASE,
)
_ICD_CODE = re.compile(
    r"(?<![0-9A-Za-zА-Яа-я])(?P<letter>[CСD])(?P<number>\d{2})(?:\.(?P<sub>\d{1,2}))?"
    r"(?:\s*[-–—]\s*(?P<letter2>[CСD])?(?P<number2>\d{2})(?:\.(?P<sub2>\d{1,2}))?)?"
)


@dataclass
class TnmPrepareReport:
    source_sha256: str = ""
    documents: int = 0
    tables: int = 0
    merged_cells: int = 0
    table_problems: list[str] = field(default_factory=list[str])
    documents_without_icd10: list[int] = field(default_factory=list[int])
    icd10_codes: int = 0
    editions_stated: dict[str, int] = field(default_factory=dict[str, int])
    documents_stating_edition: int = 0
    edition: str = ""
    output: str = ""


def extract_icd10(text: str) -> list[str]:
    """ICD-10 codes of a free text, Cyrillic look-alike letters normalised, ranges expanded.

    ``C02-06`` becomes C02..C06; a dotted code also brings its category. Order of appearance.
    """
    codes: list[str] = []

    def add(code: str) -> None:
        if code not in codes:
            codes.append(code)

    for match in _ICD_CODE.finditer(text):
        letter = "C" if match["letter"] in ("C", "С") else "D"
        number, sub = match["number"], match["sub"]
        start = f"{letter}{number}" + (f".{sub}" if sub else "")
        if match["number2"]:
            letter2 = match["letter2"]
            end_letter = letter if letter2 is None else ("C" if letter2 in ("C", "С") else "D")
            first, last = int(number), int(match["number2"])
            if (
                not sub
                and not match["sub2"]
                and end_letter == letter
                and first <= last <= first + 40
            ):
                for category in range(first, last + 1):
                    add(f"{letter}{category:02d}")
                continue
            add(start)
            add(f"{end_letter}{match['number2']}" + (f".{match['sub2']}" if match["sub2"] else ""))
            continue
        add(start)
    for code in list(codes):
        if "." in code:
            add(code.split(".")[0])
    return codes


_OTHER_CLASSIFICATION = re.compile(r"(?:ВОЗ|WHO|IARC|МКБ|ICD|FIGO|ФИГО)", re.IGNORECASE)


def stated_editions(text: str) -> list[tuple[str, str | None]]:
    """TNM/UICC editions the text names: (edition number, year).

    The edition must follow a TNM/UICC/AJCC mention within 70 characters with no other
    classification (WHO, ICD-O, FIGO) named in between, or be followed by one within 25.
    """
    found: list[tuple[str, str | None]] = []
    for match in _EDITION.finditer(text):
        before = text[max(match.start() - 70, 0) : match.start()]
        mentions = list(_TNM_WORD.finditer(before))
        after = text[match.end() : match.end() + 25]
        near_before = bool(mentions) and not _OTHER_CLASSIFICATION.search(
            before[mentions[-1].end() :]
        )
        if near_before or _TNM_WORD.search(after):
            item = (match["number"], match["year"])
            if item not in found:
                found.append(item)
    return found


def _document(
    row: sqlite3.Row,
    *,
    category: str,
    source_sha256: str,
    edition: str,
    edition_slug: str,
    report: TnmPrepareReport,
) -> tuple[str, str, list[tuple[str, str | None]]]:
    row_id = int(row["id"])
    raw_path = f"{SOURCE_LABEL}/{DATABASE_NAME}"
    name = html_text(row["title"] or "")
    if not name:
        raise ValueError(f"TNM record {row_id} has no title")
    sections: list[tuple[str, str, Conversion]] = []
    plain_parts: list[str] = []
    for column, section_title in SECTIONS:
        value = row[column]
        conversion = field_to_markdown(value)
        if not conversion.blocks:
            continue
        sections.append((column, section_title, conversion))
        plain_parts.append(html_text(value))
        report.tables += conversion.tables
        report.merged_cells += conversion.merged_cells
        report.table_problems.extend(
            f"record {row_id} {column}: {problem}" for problem in conversion.problems
        )
    icd10 = extract_icd10(html_text(row["anatomical_sites"] or ""))
    if not icd10:
        report.documents_without_icd10.append(row_id)
    report.icd10_codes += len(icd10)
    editions = stated_editions(" ".join(plain_parts))
    for number, year in editions:
        label = f"{number}-е издание" + (f", {year}" if year else "")
        report.editions_stated[label] = report.editions_stated.get(label, 0) + 1
    report.documents_stating_edition += bool(editions)

    # Reading order: the classification sections first, the edition as one line at the bottom.
    body: list[str] = []
    for column, section_title, conversion in sections:
        body.append(f"## {section_title}")
        body.append(source_marker(raw_path, f"tnms:id={row_id}#{column}", "sqlite-field"))
        body.extend(conversion.blocks)
    stated = "; ".join(
        f"{number}-е издание" + (f", {year}" if year else "") for number, year in editions
    )
    body.append("## Издание")
    body.append(source_marker(raw_path, f"tnms:id={row_id}", "sqlite-row"))
    body.append(f"TNM (UICC/AJCC), {stated}." if stated else f"{edition}.")

    document_id = f"{DOCUMENT_PREFIX}{row_id}"
    metadata: dict[str, object] = {
        "id": document_id,
        "title": f"TNM: {name}",
        "short_title": name,
        "version_label": f"{edition_slug}-{source_sha256[:8]}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["medical-reference", "oncology"],
        "source_file": raw_path,
        "source_checksum": f"sha256:{source_sha256}",
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "Справочник врача (MedElement)",
            "sourceName": SOURCE_NAME,
            "edition": edition,
            "rightsStatus": RIGHTS_STATUS,
            "localOnly": True,
            "requiresReview": True,
            "sourceTable": "tnms",
            "sourceRowId": row_id,
            "tnmCategory": category or None,
            "tnmLocalisation": name,
            "tnmEditionStatedInText": [
                f"{number}-е издание" + (f", {year}" if year else "") for number, year in editions
            ],
            "icd10Codes": icd10,
        },
    }
    return document_id, front_matter_document(metadata, body), editions


def prepare_tnm(database: Path, output: Path) -> TnmPrepareReport:
    """Write the Markdown workspace of the TNM module."""
    source_sha256 = file_sha256(database)
    report = TnmPrepareReport(source_sha256=source_sha256)
    built_at = datetime.fromtimestamp(database.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        categories = {
            int(row["id"]): html_text(row["title"] or "")
            for row in connection.execute("SELECT id, title FROM tnm_categories")
        }
        rows = list(connection.execute("SELECT * FROM tnms ORDER BY id"))
    # The edition of the set: the one the records name most often (all stated ones are listed).
    scan = Counter(
        edition
        for row in rows
        for edition in stated_editions(
            " ".join(html_text(row[column] or "") for column, _title in SECTIONS)
        )
    )
    numbers = Counter(number for (number, _year), count in scan.items() for _ in range(count))
    edition_slug = "uicc-tnm-unstated"
    if numbers:
        top = numbers.most_common(1)[0][0]
        edition_slug = f"uicc-tnm-{top}"
        years = sorted({year for (number, year) in scan if number == top and year})
        edition = f"TNM (UICC/AJCC), {top}-е издание" + (f", {'/'.join(years)}" if years else "")
    else:
        edition = "издание TNM в источнике не указано"
    report.edition = edition
    documents: dict[str, str] = {}
    for row in rows:
        document_id, markdown, _editions = _document(
            row,
            category=categories.get(int(row["tnm_category_id"] or 0), ""),
            source_sha256=source_sha256,
            edition=edition,
            edition_slug=edition_slug,
            report=report,
        )
        documents[f"{document_id}.md"] = markdown
        report.documents += 1
    report.output = str(output)
    write_workspace(
        output,
        documents,
        pack_id=MODULE_ID,
        title=SPEC.title,
        version=f"0.1.0-{source_sha256[:8]}",
        built_at=built_at,
        aliases=[],
        report=asdict(report),
    )
    return report
