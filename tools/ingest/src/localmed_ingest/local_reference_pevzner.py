"""Personal-use Pevzner diet tables from the MedElement "Spravochnik vracha" database.

Input: ``mes.sqlite`` (read-only), tables ``therapeutic_diets`` (one row per numbered diet:
indications, purpose, general characteristics, composition, meal regime, products, menu; HTML
fragments), ``standard_diets`` and ``standard_therapeutic_diets`` (the mapping of numbered diets to
the standard variants). The text is a third-party textbook compilation shared for the owner's
personal use only (see ``local_reference_common``): nothing derived from it may enter git, and
every writer refuses an output path that git does not ignore.

One Markdown document per diet table. Source words are never rewritten; HTML becomes clean
Markdown (``local_reference_html``). Each document names the standard diet variant of the official
mapping (order 330, Table 1; ``diets_official.OFFICIAL_NUMBERED_DIETS``), so the public pack's
short titles (OVD, SHD, ...) link to it. The database's own mapping is only compared with the
official one and the differences are reported.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .diets_official import OFFICIAL_NUMBERED_DIETS, VARIANTS, base_code
from .local_reference_common import (
    RIGHTS_STATUS,
    SOURCE_LABEL,
    SOURCE_TYPE,
    AliasRow,
    LocalModuleSpec,
    ensure_gitignored,
    file_sha256,
    front_matter_document,
    source_marker,
    text_sha256,
    write_workspace,
)
from .local_reference_html import field_to_markdown, html_text

MODULE_ID = "minimed.local.pevzner-diets.ru"
DOCUMENT_PREFIX = "local.pevzner."
DATABASE_NAME = "mes.sqlite"
SOURCE_NAME = "Справочник врача (MedElement), лечебные диеты по Певзнеру"
SPEC = LocalModuleSpec(
    module_id=MODULE_ID,
    file_stem=MODULE_ID,
    title="Диеты по Певзнеру (личное)",
    collection="local-pevzner-diets",
    document_prefix=DOCUMENT_PREFIX,
    source_name=SOURCE_NAME,
    description_head=(
        "Столы по Певзнеру: показания, цель, характеристика, химический состав, режим питания, "
        "рекомендуемые и исключаемые продукты, примерное меню."
    ),
    tags=("diets", "pevzner", "personal-use-only", "local"),
)
# (section title, source column). Empty columns give no section.
SECTIONS: tuple[tuple[str, str], ...] = (
    ("Показания", "indications"),
    ("Цель", "purpose"),
    ("Общая характеристика", "general"),
    ("Химический состав и энергоценность", "composition"),
    ("Режим питания", "diet"),
    ("Рекомендуемые и исключаемые продукты", "products"),
    ("Примерное меню", "menu"),
)
_QUALIFIER = re.compile(r"\(([^)]*)\)$")


@dataclass
class PevznerPrepareReport:
    source_sha256: str = ""
    documents: int = 0
    sections: dict[str, int] = field(default_factory=dict[str, int])
    empty_fields: dict[str, int] = field(default_factory=dict[str, int])
    ignored_memo_rows: int = 0
    html_tables: int = 0
    conversion_problems: list[str] = field(default_factory=list[str])
    documents_without_variant: list[str] = field(default_factory=list[str])
    mapping_only_in_database: list[str] = field(default_factory=list[str])
    mapping_only_in_official: list[str] = field(default_factory=list[str])
    aliases: int = 0
    output: str = ""


def _text(value: object) -> str:
    return value if isinstance(value, str) else ""


def variants_of(title: str) -> list[tuple[str, str]]:
    """(abbreviation, qualifier) of every standard variant the official mapping gives to a table."""
    found: list[tuple[str, str]] = []
    for variant in VARIANTS:
        for code in OFFICIAL_NUMBERED_DIETS[variant.key]:
            if base_code(code) == title:
                match = _QUALIFIER.search(code)
                found.append((variant.abbreviation, match.group(1) if match else ""))
    return found


def variant_line(title: str) -> str | None:
    found = variants_of(title)
    if not found:
        return None
    parts = [f"{abbr} ({qualifier})" if qualifier else abbr for abbr, qualifier in found]
    return "Стандартная диета по приказу №330: " + ", ".join(parts) + "."


def _mapping_differences(connection: sqlite3.Connection, report: PevznerPrepareReport) -> None:
    abbreviations = {
        row["id"]: row["title"]
        for row in connection.execute("SELECT id, title FROM standard_diets")
    }
    in_database: set[tuple[str, str]] = set()
    for row in connection.execute("SELECT title, standard_diet_id FROM standard_therapeutic_diets"):
        label = abbreviations.get(int(row["standard_diet_id"]), "")
        match = re.search(r"\(([^)]*)\)$", label)
        abbreviation = (match.group(1) if match else "").split(",")[-1].strip()
        # The database lists the tuberculosis variant as ВБДт; the official name is ВКД.
        abbreviation = "ВКД" if abbreviation == "ВБДт" else abbreviation
        in_database.add((str(row["title"]), abbreviation))
    official = {
        (code, variant.abbreviation)
        for variant in VARIANTS
        for code in OFFICIAL_NUMBERED_DIETS[variant.key]
    }
    report.mapping_only_in_database = sorted(f"{t} -> {a}" for t, a in in_database - official)
    report.mapping_only_in_official = sorted(f"{t} -> {a}" for t, a in official - in_database)


def _document(
    row: sqlite3.Row, source_sha256: str, raw_path: str, report: PevznerPrepareReport
) -> tuple[str, str, list[AliasRow]]:
    row_id = int(row["id"])
    number = html_text(_text(row["title"]))
    title = f"Стол №{number}"
    document_id = f"{DOCUMENT_PREFIX}diet.{row_id}"
    blocks: list[str] = []
    line = variant_line(number)
    if line is None:
        report.documents_without_variant.append(number)
    else:
        blocks += [
            "# Стандартная диета",
            source_marker(raw_path, "official-mapping", "order-330"),
            line,
        ]
    for heading, column in SECTIONS:
        conversion = field_to_markdown(_text(row[column]))
        if not conversion.blocks:
            report.empty_fields[column] = report.empty_fields.get(column, 0) + 1
            continue
        report.sections[column] = report.sections.get(column, 0) + 1
        report.html_tables += conversion.tables
        report.conversion_problems += [f"{number}/{column}: {p}" for p in conversion.problems]
        blocks += [
            f"# {heading}",
            source_marker(raw_path, f"therapeutic_diets:id={row_id}:{column}", "sqlite-row"),
            *conversion.blocks,
        ]
    if _text(row["memo"]).strip():
        report.ignored_memo_rows += 1
    aliases = [f"стол {number}", f"диета номер {number}"] if number[:1].isdigit() else []
    alias_rows = [
        AliasRow(
            id=f"alias.pevzner.{text_sha256(f'{row_id}|{alias}')[:16]}",
            canonical_term=title,
            alias=alias,
            category="local-diet",
            weight=1.2,
        )
        for alias in aliases
    ]
    metadata: dict[str, object] = {
        "id": document_id,
        "title": title,
        "short_title": f"{title} (Певзнер)",
        "version_label": f"medsolutions-mes-{source_sha256[:8]}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["nutrition", "medical-reference"],
        "source_file": raw_path,
        "source_checksum": f"sha256:{source_sha256}",
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "Справочник врача (MedElement)",
            "sourceName": SOURCE_NAME,
            "edition": (
                f"снимок базы {DATABASE_NAME} {source_sha256[:12]}; версия приложения не указана"
            ),
            "rightsStatus": RIGHTS_STATUS,
            "localOnly": True,
            "requiresReview": True,
            "sourceTable": "therapeutic_diets",
            "sourceRowId": row_id,
            "dietTable": number,
            "standardDiets": [abbr for abbr, _qualifier in variants_of(number)],
            "navigationAliases": aliases,
        },
    }
    return document_id, front_matter_document(metadata, blocks), alias_rows


def prepare_pevzner_diets(database: Path, output: Path) -> PevznerPrepareReport:
    """Write the Markdown workspace of the personal Pevzner module (gitignored output only)."""
    ensure_gitignored(output)
    source_sha256 = file_sha256(database)
    report = PevznerPrepareReport(source_sha256=source_sha256)
    built_at = datetime.fromtimestamp(database.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    raw_path = f"{SOURCE_LABEL}/{DATABASE_NAME}"
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = list(connection.execute("SELECT * FROM therapeutic_diets ORDER BY id"))
        _mapping_differences(connection, report)
    documents: dict[str, str] = {}
    aliases: dict[str, AliasRow] = {}
    for row in rows:
        document_id, markdown, alias_rows = _document(row, source_sha256, raw_path, report)
        documents[f"{document_id}.md"] = markdown
        report.documents += 1
        for alias in alias_rows:
            aliases.setdefault(alias.id, alias)
    report.aliases = len(aliases)
    report.output = str(output)
    write_workspace(
        output,
        documents,
        pack_id=MODULE_ID,
        title=SPEC.title,
        version=f"0.1.0-{source_sha256[:8]}",
        built_at=built_at,
        aliases=sorted(aliases.values(), key=lambda item: item.id),
        report=asdict(report),
    )
    return report
