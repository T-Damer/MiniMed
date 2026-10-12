"""Personal-use lab reference module from the MedElement "Spravochnik vracha" analyses database.

Input: ``analyzes.sqlite`` (read-only). One Markdown document per analysis with the reference
ranges of the compilation (one laboratory's), indications, preparation, sampling rules,
interfering factors, reasons for deviations, description and related studies. Source words are
never rewritten: numbers are printed as stored (no unit conversion), qualitative norms as text,
HTML becomes clean Markdown (``local_reference_html``), and source defects are marked instead of
repaired.

The source is for the owner's personal use only (see ``local_reference_common``); the module is
packaged as a local-only bundle and never enters git.
"""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from .local_reference_common import (
    RIGHTS_STATUS,
    SOURCE_LABEL,
    SOURCE_TYPE,
    AliasRow,
    LocalModuleSpec,
    file_sha256,
    front_matter_document,
    source_marker,
    text_sha256,
    write_workspace,
)
from .local_reference_html import (
    Conversion,
    collapse_spaces,
    escape_markdown,
    field_to_markdown,
    html_text,
    plain_inline,
    split_lines,
    table_lines,
)

MODULE_ID = "minimed.local.lab-reference.ru"
DOCUMENT_PREFIX = "local.lab."
DATABASE_NAME = "analyzes.sqlite"
SOURCE_NAME = "Справочник врача (MedElement), лабораторные исследования (подборка Ситилаб)"
SPEC = LocalModuleSpec(
    module_id=MODULE_ID,
    file_stem=MODULE_ID,
    title="Лабораторные нормы (личное)",
    collection="local-lab-reference",
    document_prefix=DOCUMENT_PREFIX,
    source_name=SOURCE_NAME,
    description_head=(
        "Лабораторные исследования с референсными значениями, показаниями, подготовкой, "
        "правилами взятия биоматериала и причинами отклонений (подборка одной лаборатории):"
    ),
    tags=("laboratory", "reference-ranges", "personal-use-only", "local"),
)
MISSING_TEXT = "[нет текста в источнике]"
RANGE_NOTE = (
    "Референсные значения — по подборке одной лаборатории; у лаборатории, выполняющей анализ, "
    "они могут отличаться, и приоритет у значений в её бланке."
)
_RTF_ERROR = "@ERROR_NO_RTF@"
_NAME_SEPARATOR = re.compile(r"[,;]")
_PROFILE = "Профиль"


@dataclass
class LabPrepareReport:
    source_sha256: str = ""
    documents: int = 0
    profiles: int = 0
    parameters: int = 0
    reference_rows: int = 0
    documents_with_ranges: int = 0
    documents_without_ranges: int = 0
    rows_without_value: int = 0
    empty_rows_omitted: int = 0
    rows_with_missing_text: int = 0
    inverted_ranges: int = 0
    html_fields: int = 0
    html_tables: int = 0
    table_problems: list[str] = field(default_factory=list[str])
    aliases: int = 0
    cito_flag_values: dict[str, int] = field(default_factory=dict[str, int])
    output: str = ""


@dataclass(frozen=True)
class _Row:
    sex: str
    age: str
    value: str
    units: str
    comment: str
    commentary: str


@dataclass
class _Parameter:
    code: str
    name: str
    english: str
    rows: list[_Row] = field(default_factory=list[_Row])


def format_number(value: float) -> str:
    """The stored number exactly: no unit conversion, no trailing zeros of the float repr."""
    text = f"{Decimal(repr(value)):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def format_value(
    low: float | None, high: float | None, quality: str | None
) -> tuple[str, bool, bool]:
    """(cell text, source text was missing, bounds inverted)."""
    parts: list[str] = []
    inverted = False
    if low is not None and high is not None:
        low_text, high_text = format_number(low), format_number(high)
        if low_text == high_text:
            parts.append(low_text)
        elif low > high:
            inverted = True
            parts.append(f"{low_text}–{high_text} [нижняя граница больше верхней в источнике]")
        else:
            parts.append(f"{low_text}–{high_text}")
    elif high is not None:
        parts.append(f"< {format_number(high)}")
    elif low is not None:
        parts.append(f"> {format_number(low)}")
    missing = False
    if quality is not None and quality.strip():
        text = plain_inline(quality.replace(_RTF_ERROR, MISSING_TEXT))
        missing = _RTF_ERROR in quality
        parts.append(text)
    return "; ".join(parts) if parts else "—", missing, inverted


def split_names(value: str | None) -> list[str]:
    """Comma-separated alternative names without splitting inside parentheses."""
    if not value:
        return []
    text = html_text(value)
    names: list[str] = []
    depth = 0
    start = 0
    for index, character in enumerate(text):
        if character in "([":
            depth += 1
        elif character in ")]":
            depth = max(depth - 1, 0)
        elif depth == 0 and _NAME_SEPARATOR.match(character):
            names.append(text[start:index])
            start = index + 1
    names.append(text[start:])
    cleaned = (collapse_spaces(name).rstrip(".").strip() for name in names)
    return list(dict.fromkeys(name for name in cleaned if len(name) >= 2))


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _document_id(analysis_id: int) -> str:
    return f"{DOCUMENT_PREFIX}{analysis_id}"


class _Tables:
    """Lookup tables of the source."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        def pairs(query: str) -> dict[int, sqlite3.Row]:
            return {int(row["id"]): row for row in connection.execute(query)}

        self.biomaterials = pairs("SELECT id, title FROM biomaterials")
        self.preparations = pairs("SELECT id, directive FROM preparations")
        self.deviations = pairs("SELECT id, elevated_values, low_values FROM deviation_reasons")
        self.nms = pairs("SELECT id, code, title FROM nms_names")
        self.sections = pairs("SELECT id, parent_id, title FROM sections")
        self.methods = pairs("SELECT id, title FROM research_methods")
        self.formats = pairs("SELECT id, title FROM result_formats")
        self.method_links = _links(
            connection, "analyzes_research_methods", "analyze_id", "research_method_id"
        )
        self.format_links = _links(
            connection, "analyzes_result_formats", "analyze_id", "result_format_id"
        )
        self.composition = _links(
            connection, "analyzes_complex_researches", "complex_research_id", "analyze_id"
        )
        self.part_of = _links(
            connection, "analyzes_complex_researches", "analyze_id", "complex_research_id"
        )
        self.recommended = _links(
            connection, "analyzes_recommended_analyzes", "analyze_id", "recommended_analyze_id"
        )

    def section_path(self, section_id: int | None) -> list[str]:
        path: list[str] = []
        seen: set[int] = set()
        while section_id is not None and section_id in self.sections and section_id not in seen:
            seen.add(section_id)
            row = self.sections[section_id]
            title = collapse_spaces(_text(row["title"]))
            if not path or path[0] != title:
                path.insert(0, title)
            section_id = row["parent_id"]
        return path


def _links(
    connection: sqlite3.Connection, table: str, key: str, target: str
) -> dict[int, list[int]]:
    links: dict[int, list[int]] = defaultdict(list)
    for row in connection.execute(f"SELECT {key}, {target} FROM {table} ORDER BY id"):
        links[int(row[0])].append(int(row[1]))
    return links


def _parameters(
    connection: sqlite3.Connection, report: LabPrepareReport
) -> dict[int, list[_Parameter]]:
    query = """
        SELECT asp.analyze_id, p.id AS parameter_id, p.title, p.print_title, p.secondary_title,
               a.units, a.sex, a.age, a.min_norm, a.max_norm, a.quality_norm, a.commentary
        FROM analyzes_slis_parameters asp
        JOIN slis_parameters p ON p.id = asp.slis_parameter_id
        JOIN slis_attributes a ON a.id = asp.slis_attribute_id
        ORDER BY asp.analyze_id, asp.id
    """
    result: dict[int, list[_Parameter]] = defaultdict(list)
    index: dict[tuple[int, int], _Parameter] = {}
    for row in connection.execute(query):
        analysis_id, parameter_id = int(row["analyze_id"]), int(row["parameter_id"])
        parameter = index.get((analysis_id, parameter_id))
        if parameter is None:
            parameter = _Parameter(
                code=html_text(_text(row["title"])),
                name=html_text(_text(row["print_title"])),
                english=html_text(_text(row["secondary_title"])),
            )
            index[(analysis_id, parameter_id)] = parameter
            result[analysis_id].append(parameter)
            report.parameters += 1
        value, missing, inverted = format_value(
            row["min_norm"], row["max_norm"], row["quality_norm"]
        )
        commentary_missing = _RTF_ERROR in _text(row["commentary"])
        comment = plain_inline(_text(row["commentary"]).replace(_RTF_ERROR, MISSING_TEXT))
        report.reference_rows += 1
        report.rows_without_value += value == "—"
        report.rows_with_missing_text += missing or commentary_missing
        report.inverted_ranges += inverted
        parameter.rows.append(
            _Row(
                sex=plain_inline(_text(row["sex"])) or "—",
                age=plain_inline(_text(row["age"])) or "—",
                value=value,
                units=plain_inline(_text(row["units"])),
                comment=comment,
                commentary=_text(row["commentary"]).replace(_RTF_ERROR, MISSING_TEXT),
            )
        )
    return result


class _Body:
    def __init__(self, raw_path: str, row_id: int, report: LabPrepareReport) -> None:
        self.blocks: list[str] = []
        self._raw_path = raw_path
        self._row_id = row_id
        self._report = report

    def heading(self, level: int, title: str) -> None:
        self.blocks.append(f"{'#' * level} {title}")

    def paragraphs(self, blocks: list[str], selector: str, kind: str = "sqlite-field") -> None:
        if not blocks:
            return
        self.blocks.append(source_marker(self._raw_path, selector, kind))
        self.blocks.extend(blocks)

    def section(
        self,
        title: str,
        parts: list[tuple[str | None, str | None, str, str]],
        *,
        level: int = 2,
    ) -> None:
        """A section from (subheading, value, column, table) parts; skipped when all are empty."""
        converted: list[tuple[str | None, Conversion, str, str]] = []
        for subheading, value, column, table in parts:
            conversion = field_to_markdown(value)
            if conversion.blocks:
                converted.append((subheading, conversion, column, table))
                if value and "<" in value:
                    self._report.html_fields += 1
                self._report.html_tables += conversion.tables
                self._report.table_problems.extend(
                    f"analysis {self._row_id}: {problem}" for problem in conversion.problems
                )
        if not converted:
            return
        self.heading(level, title)
        for subheading, conversion, column, table in converted:
            if subheading:
                self.heading(level + 1, subheading)
            self.paragraphs(conversion.blocks, f"{table}:id={self._row_id}#{column}")


def _heading_text(parameter: _Parameter) -> str:
    name = parameter.name or parameter.code or parameter.english
    folded = name.casefold()
    code = parameter.code if parameter.code.casefold() not in folded else ""
    english = parameter.english if parameter.english.casefold() not in folded else ""
    text = name + (f" [{code}]" if code and code != name else "")
    if english and english.casefold() != code.casefold():
        text += f" — {english}"
    return escape_markdown(text)


def _shared_commentary(parameter: _Parameter) -> str:
    commentaries = {row.commentary for row in parameter.rows}
    if len(commentaries) == 1 and all(row.commentary for row in parameter.rows):
        return commentaries.pop()
    return ""


def _range_section(
    body: _Body,
    analysis_id: int,
    parameters: list[_Parameter],
    raw_path: str,
    report: LabPrepareReport,
) -> bool:
    """Reference tables per parameter; returns False when the source has no values at all."""
    selector = f"analyzes_slis_parameters:analyze_id={analysis_id}"
    sections: list[list[str]] = []
    bare: list[str] = []
    for parameter in parameters:
        shared = _shared_commentary(parameter)
        kept = [
            row
            for row in parameter.rows
            if not (
                row.sex == "—"
                and row.age == "—"
                and row.value == "—"
                and (shared or not row.comment)
            )
        ]
        report.empty_rows_omitted += len(parameter.rows) - len(kept)
        if not kept and not shared:
            units = sorted({row.units for row in parameter.rows if row.units})
            bare.append(
                f"- {_heading_text(parameter)}"
                + (f"; единицы: {', '.join(units)}" if units else "")
            )
            continue
        block = [
            f"### {_heading_text(parameter)}",
            source_marker(raw_path, selector, "sqlite-rows"),
        ]
        if kept:
            with_units = any(row.units for row in kept)
            with_comment = not shared and any(row.comment for row in kept)
            header = ["Пол / группа", "Возраст", "Значение"]
            header += ["Единицы"] if with_units else []
            header += ["Комментарий"] if with_comment else []
            rows: list[list[str]] = []
            for row in kept:
                cells = [row.sex, row.age, row.value]
                cells += [row.units or "—"] if with_units else []
                cells += [row.comment or "—"] if with_comment else []
                rows.append(cells)
            block.extend(table_lines(header, rows))
        if shared:
            block.append("Комментарий лаборатории:")
            block.extend(field_to_markdown(shared).blocks)
        sections.append(block)
    if sections:
        body.heading(2, "Референсные значения")
        body.blocks.append(f"*{RANGE_NOTE}*")
        for block in sections:
            body.blocks.extend(block)
    if bare:
        if sections:
            body.heading(3, "Показатели без референсных значений")
        else:
            body.heading(2, "Показатели результата")
        body.paragraphs(split_lines(bare), selector, "sqlite-rows")
    return bool(sections)


def _titles(ids: list[int], titles: dict[int, tuple[str, str]]) -> list[str]:
    return [
        f"- {escape_markdown(titles[item][0])} ({escape_markdown(titles[item][1])})"
        if titles[item][1]
        else f"- {escape_markdown(titles[item][0])}"
        for item in ids
        if item in titles
    ]


def _analysis_document(
    row: sqlite3.Row,
    *,
    tables: _Tables,
    parameters: list[_Parameter],
    titles: dict[int, tuple[str, str]],
    source_sha256: str,
    report: LabPrepareReport,
) -> tuple[str, str, list[AliasRow]]:
    analysis_id = int(row["id"])
    raw_path = f"{SOURCE_LABEL}/{DATABASE_NAME}"
    title = html_text(_text(row["rus_name"]))
    if not title:
        raise ValueError(f"Analysis {analysis_id} has no Russian name")
    body = _Body(raw_path, analysis_id, report)
    section_path = tables.section_path(row["subsection_id"])
    foreign = html_text(_text(row["foreign_name"]))
    alternative = html_text(_text(row["alternative_rus_name"]))

    # General facts.
    body.heading(2, "Общие сведения")
    facts: list[str] = []
    code = _text(row["code"])
    kind = _text(row["service_type"])
    identity = " ".join(
        part
        for part in (
            f"Код услуги: {escape_markdown(code)}." if code else "",
            f"Вид: {escape_markdown(kind.lower())}." if kind else "",
            f"Раздел: {escape_markdown(' / '.join(section_path))}." if section_path else "",
        )
        if part
    )
    if identity:
        facts.append(identity)
    nms = tables.nms.get(row["nms_name_id"]) if row["nms_name_id"] is not None else None
    if nms is not None:
        nms_text = collapse_spaces(f"{_text(nms['code'])} {_text(nms['title'])}")
        facts.append(f"Номенклатура медицинских услуг: {escape_markdown(nms_text)}.")
    if alternative:
        facts.append(f"Другие названия: {escape_markdown(alternative.rstrip('.'))}.")
    if foreign:
        facts.append(f"Названия на других языках: {escape_markdown(foreign.rstrip('.'))}.")
    details: list[str] = []
    if row["execution_period"] is not None:
        details.append(f"Срок выполнения, дней: {int(row['execution_period'])}.")
    cito_deadline = collapse_spaces(_text(row["cito_deadline"]))
    if cito_deadline:
        details.append(
            f"Срочное исполнение (cito), срок: {escape_markdown(cito_deadline.rstrip('.'))}."
        )
    method_format = collapse_spaces(_text(row["method_format"]))
    if method_format:
        details.append(f"Метод: {escape_markdown(method_format.rstrip('.'))}.")
    methods = [
        html_text(_text(tables.methods[i]["title"]))
        for i in tables.method_links.get(analysis_id, [])
        if i in tables.methods
    ]
    if methods:
        details.append(f"Методы исследования: {escape_markdown('; '.join(methods))}.")
    formats = [
        html_text(_text(tables.formats[i]["title"]))
        for i in tables.format_links.get(analysis_id, [])
        if i in tables.formats
    ]
    if formats:
        details.append(f"Формат результата: {escape_markdown('; '.join(formats))}.")
    if details:
        facts.append(" ".join(details))
    body.paragraphs(facts, f"analyzes:id={analysis_id}", "sqlite-row")
    report.cito_flag_values[str(row["cito"])] = report.cito_flag_values.get(str(row["cito"]), 0) + 1

    # Reference ranges.
    if parameters and _range_section(body, analysis_id, parameters, raw_path, report):
        report.documents_with_ranges += 1
    else:
        report.documents_without_ranges += 1

    # Text sections.
    body.section("Показания", [(None, row["appointments"], "appointments", "analyzes")])
    preparation = tables.preparations.get(row["preparation_id"])
    directive = _text(preparation["directive"]) if preparation is not None else ""
    outcome = _text(row["outcome_factors"])
    folded_directive, folded_outcome = (
        collapse_spaces(directive).casefold(),
        collapse_spaces(outcome).casefold(),
    )
    if folded_outcome and folded_outcome in folded_directive:
        outcome = ""
    elif folded_directive and folded_directive in folded_outcome:
        directive = ""
    body.section(
        "Подготовка",
        [
            (None, directive, "directive", "preparations"),
            (None, outcome, "outcome_factors", "analyzes"),
        ],
    )
    biomaterial = tables.biomaterials.get(row["biomaterial_id"])
    sampling_parts: list[tuple[str | None, str | None, str, str]] = []
    if biomaterial is not None:
        material = escape_markdown(html_text(_text(biomaterial["title"])))
        sampling_parts.append((None, f"Биоматериал: {material}.", "title", "biomaterials"))
    sampling_parts.append((None, row["collection_rules"], "collection_rules", "analyzes"))
    body.section("Биоматериал и правила взятия", sampling_parts)
    body.section(
        "Что влияет на результат",
        [(None, row["interfering_factors"], "interfering_factors", "analyzes")],
    )
    deviation = tables.deviations.get(row["deviation_reason_id"])
    if deviation is not None:
        body.section(
            "Причины отклонений",
            [
                (
                    "Повышение значений",
                    deviation["elevated_values"],
                    "elevated_values",
                    "deviation_reasons",
                ),
                ("Понижение значений", deviation["low_values"], "low_values", "deviation_reasons"),
            ],
        )
    body.section("Описание", [(None, row["description"], "description", "analyzes")])
    related: list[tuple[str, list[int]]] = [
        ("Состав профиля", tables.composition.get(analysis_id, [])),
        ("Входит в профили", tables.part_of.get(analysis_id, [])),
        ("Рекомендуется вместе", tables.recommended.get(analysis_id, [])),
    ]
    related = [
        (label, [i for i in ids if i in titles and i != analysis_id]) for label, ids in related
    ]
    if any(ids for _label, ids in related):
        body.heading(2, "Связанные исследования")
        for label, ids in related:
            if not ids:
                continue
            body.heading(3, label)
            body.paragraphs(
                split_lines(_titles(ids, titles)), f"analyzes:id={analysis_id}", "sqlite-links"
            )

    # Aliases: other names and parameter codes.
    names = split_names(row["alternative_rus_name"])
    foreign_names = split_names(row["foreign_name"])
    codes = list(
        dict.fromkeys(
            item
            for parameter in parameters
            for item in (parameter.code, parameter.english)
            if len(item) >= 2 and item.casefold() != title.casefold()
        )
    )
    alias_rows: list[AliasRow] = []
    seen: set[str] = {title.casefold()}
    for category, weight, values in (
        ("lab-name", 1.0, names),
        ("lab-foreign-name", 0.9, foreign_names),
        ("lab-parameter", 0.7, codes),
    ):
        for value in values:
            key = value.casefold()
            if key in seen or len(value) > 120:
                continue
            seen.add(key)
            alias_rows.append(
                AliasRow(
                    id=f"alias.lab.{text_sha256(f'{analysis_id}|{key}')[:16]}",
                    canonical_term=title,
                    alias=value,
                    category=category,
                    weight=weight,
                )
            )

    metadata: dict[str, object] = {
        "id": _document_id(analysis_id),
        "title": title,
        "version_label": f"medsolutions-analyzes-{source_sha256[:8]}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["medical-reference", "laboratory-diagnostics"],
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
            "sourceTable": "analyzes",
            "sourceRowId": analysis_id,
            "serviceCode": code or None,
            "serviceType": kind or None,
            "labSection": section_path,
            "aliases": [a.alias for a in alias_rows if a.category != "lab-parameter"],
            "parameterCodes": codes,
            "isProfile": kind == _PROFILE,
            "relatedDocuments": {
                "composition": [
                    _document_id(i) for i in tables.composition.get(analysis_id, []) if i in titles
                ],
                "partOf": [
                    _document_id(i) for i in tables.part_of.get(analysis_id, []) if i in titles
                ],
                "recommended": [
                    _document_id(i) for i in tables.recommended.get(analysis_id, []) if i in titles
                ],
            },
        },
    }
    return _document_id(analysis_id), front_matter_document(metadata, body.blocks), alias_rows


def prepare_lab_reference(database: Path, output: Path) -> LabPrepareReport:
    """Write the Markdown workspace of the lab module."""
    source_sha256 = file_sha256(database)
    report = LabPrepareReport(source_sha256=source_sha256)
    built_at = datetime.fromtimestamp(database.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        tables = _Tables(connection)
        parameters = _parameters(connection, report)
        analyses = list(connection.execute("SELECT * FROM analyzes ORDER BY id"))
    titles: dict[int, tuple[str, str]] = {
        int(row["id"]): (html_text(_text(row["rus_name"])), _text(row["code"])) for row in analyses
    }
    documents: dict[str, str] = {}
    aliases: dict[str, AliasRow] = {}
    for row in analyses:
        analysis_id = int(row["id"])
        document_id, markdown, alias_rows = _analysis_document(
            row,
            tables=tables,
            parameters=parameters.get(analysis_id, []),
            titles=titles,
            source_sha256=source_sha256,
            report=report,
        )
        documents[f"{document_id}.md"] = markdown
        report.documents += 1
        report.profiles += _text(row["service_type"]) == _PROFILE
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
