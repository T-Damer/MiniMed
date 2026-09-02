from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from .models import CamelModel

_RULE_VERSION = "instruction-card-drafts-v2-heading-exact-body-marker"
_GROUP_RULES = {
    "identity": {"общая информация", "наименование лекарственного препарата"},
    "use": {"показания к применению"},
    "warning": {"противопоказания", "особые указания", "меры предосторожности"},
    "administration": {"способ применения", "способ применения и дозы", "режим дозирования"},
    "adverse-reaction": {
        "нежелательные реакции",
        "возможные нежелательные реакции",
        "побочное действие",
    },
    "storage": {"условия хранения", "хранение"},
}
_FACT_TYPE_BY_HEADING = {
    "показания к применению": "indication",
    "противопоказания": "contraindication",
    "особые указания": "warning",
    "меры предосторожности": "warning",
    "особые указания и меры предосторожности": "warning",
    "способ применения": "administration",
    "способ применения и дозы": "administration",
    "режим дозирования": "administration",
    "нежелательные реакции": "adverse-reaction",
    "возможные нежелательные реакции": "adverse-reaction",
    "побочное действие": "adverse-reaction",
    "условия хранения": "storage",
    "хранение": "storage",
}
_BODY_FACT_HEADING_PATTERN = re.compile(
    r"(?:(?<=\n\n)|\A)(?:\d+\s*[.)]?\s*)?(?P<heading>"
    + "|".join(
        re.escape(heading) for heading in sorted(_FACT_TYPE_BY_HEADING, key=len, reverse=True)
    )
    + r")(?=[\s.:])",
    re.IGNORECASE,
)
_REQUIRED_COLUMNS = {
    "documents": {"id", "title", "source_type", "current_version_id"},
    "document_versions": {"id", "document_id", "source_checksum"},
    "sections": {"id", "document_version_id", "title", "order_index", "anchor"},
    "chunks": {"id", "document_version_id", "section_id", "order_index", "original_text", "anchor"},
}
_HEADING_PREFIX = re.compile(r"^\s*\d+\s*[.)]?\s*")
_HEADING_TRAILING = re.compile(r"[.:;]+\s*$")
_WHITESPACE = re.compile(r"\s+")
_TOC_PAGE_LINE = re.compile(r"^(?:[.·…]\s*)*\d+\s*$")
_DOSE_NUMBER = r"\d+(?:[.,]\d+)?"
_DOSE_EXPRESSION_PATTERN = re.compile(
    rf"(?P<limit>\b(?:до|не\s+более)\s+)?"
    rf"(?P<first>{_DOSE_NUMBER})\s*"
    rf"(?:(?P<connector>[-–—]|или)\s*(?P<second>{_DOSE_NUMBER})\s*)?"
    r"(?P<unit>мкг|мг|г|мл|"
    r"таблет(?:ка|ки|ку|ок|ке)|ингаляци(?:я|и|ю|й)|"
    r"капл(?:я|и|ю|ель)|доз(?:а|ы|у|е)|впрыскивани(?:е|я)|"
    r"суппозитори(?:й|я|ев))"
    r"(?:\s*/\s*(?P<per>кг|м2|м²))?"
    r"(?:\s*/\s*(?P<per_time>мин(?:ут(?:у|ы)?)?|ч(?:ас(?:а|ов)?)?))?\b",
    re.IGNORECASE,
)
_DOSE_CONTEXT_PATTERN = re.compile(
    r"доз|принима|применя|ввод|назнач|кажд|раз(?:а)?\s+в",
    re.IGNORECASE,
)
_SCHEDULE_CONTEXT_PATTERN = re.compile(
    r"сут(?:ки|ок)|день|дня|недел|однократ|утром|вечером|на\s+ночь",
    re.IGNORECASE,
)
_NEGATIVE_DOSAGE_PATTERN = re.compile(
    r"не\s+рекоменд|противопоказ|не\s+следует\s+примен",
    re.IGNORECASE,
)
_INCOMPLETE_NEGATIVE_PATTERN = re.compile(
    r"^\s*(?:принимать|применять)\s+более",
    re.IGNORECASE,
)
_FREQUENCY_PATTERN = re.compile(
    rf"(?P<limit>не\s+более|до)?\s*"
    rf"(?P<first>{_DOSE_NUMBER}|один|два|три|четыре)\s*"
    rf"(?:[-–—]\s*(?P<second>{_DOSE_NUMBER}|двух|трех|трёх|четырех|четырёх)\s*)?"
    r"раз(?:а)?\s+в\s+(?P<period>сутки|суток|день)",
    re.IGNORECASE,
)
_INTERVAL_PATTERN = re.compile(
    rf"(?:(?P<minimum>интервал[^.\n]{{0,40}}не\s+менее)\s*|каждые\s*)"
    rf"(?P<value>{_DOSE_NUMBER})\s*(?P<unit>ч(?:ас(?:а|ов)?)?|мин(?:ут(?:ы)?)?)\b",
    re.IGNORECASE,
)
_AGE_RANGE_PATTERN = re.compile(
    r"(?:от\s+)?\d+(?:[.,]\d+)?\s*"
    r"(?:(?:месяц(?:а|ев)?|лет|год(?:а|ов)?)\s*)?(?:до|[-–—])\s*"
    r"\d+(?:[.,]\d+)?\s*(?:месяц(?:а|ев)?|лет|год(?:а|ов)?)|"
    r"(?:старше|младше|до)\s+\d+(?:[.,]\d+)?\s*"
    r"(?:месяц(?:а|ев)?|лет|год(?:а|ов)?)",
    re.IGNORECASE,
)
_WEIGHT_RANGE_PATTERN = re.compile(
    r"(?:от\s+)?\d+(?:[.,]\d+)?\s*(?:до|[-–—])\s*\d+(?:[.,]\d+)?\s*кг|"
    r"(?:мас(?:са|сой)\s+тела\s+)?(?:менее|до|более|свыше)\s+\d+(?:[.,]\d+)?\s*кг",
    re.IGNORECASE,
)
_OCR_WORD_BREAK = re.compile(r"(?<=[А-Яа-яЁё])-\s*\n\s*(?=[А-Яа-яЁё])")
_WORD_FREQUENCIES = {
    "один": 1,
    "два": 2,
    "двух": 2,
    "три": 3,
    "трех": 3,
    "трёх": 3,
    "четыре": 4,
    "четырех": 4,
    "четырёх": 4,
}


@dataclass(frozen=True)
class InstructionDosageDraft:
    start: int
    end: int
    quote: str
    structured: dict[str, object]
    population: dict[str, object]


class InstructionCardDraftExport(CamelModel):
    input: str
    output: str
    documents: int
    group_coverage: dict[str, int]
    missing_group_counts: dict[str, int]
    extraction_rule_version: str = _RULE_VERSION


def _normal_heading(title: str) -> str:
    value = _HEADING_PREFIX.sub("", title).casefold()
    value = _HEADING_TRAILING.sub("", value)
    return _WHITESPACE.sub(" ", value).strip()


def _validate_input(connection: sqlite3.Connection, input_path: Path) -> None:
    integrity = connection.execute("PRAGMA integrity_check").fetchone()
    if integrity is None or integrity[0] != "ok":
        raise ValueError(f"Instruction draft input failed integrity check: {input_path}")
    for table, required in _REQUIRED_COLUMNS.items():
        columns = {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}
        missing = sorted(required - columns)
        if missing:
            raise ValueError(
                f"Instruction draft input {input_path} lacks {table} columns: {missing}"
            )


def _group_for_heading(title: str) -> str | None:
    normalized = _normal_heading(title)
    return next(
        (group for group, headings in _GROUP_RULES.items() if normalized in headings),
        None,
    )


def instruction_fact_type_for_heading(title: str) -> str | None:
    """Map only an exact known instruction heading to a structured fact type."""
    normalized = _normal_heading(title)
    exact = _FACT_TYPE_BY_HEADING.get(normalized)
    if exact is not None:
        return exact
    if normalized.startswith("применение препарата "):
        return "administration"
    if normalized.startswith("прием препарата "):
        return "administration"
    if normalized.startswith("хранение препарата "):
        return "storage"
    return None


def instruction_body_fact_segments(text: str) -> list[tuple[str, int, int, str]]:
    """Split exact body sections only when a known heading starts a paragraph."""
    markers: list[tuple[str, int]] = []
    for match in _BODY_FACT_HEADING_PATTERN.finditer(text):
        following_lines = text[match.end() :].splitlines(keepends=True)
        if _next_nonblank_is_toc_page(following_lines, 0):
            continue
        fact_type = _FACT_TYPE_BY_HEADING[_normal_heading(match.group("heading"))]
        markers.append((fact_type, match.start()))
    segments: list[tuple[str, int, int, str]] = []
    for index, (fact_type, start) in enumerate(markers):
        raw_end = markers[index + 1][1] if index + 1 < len(markers) else len(text)
        quote = text[start:raw_end].rstrip()
        if quote:
            segments.append((fact_type, start, start + len(quote), quote))
    return segments


def _number(value: str) -> int | float:
    numeric = float(value.replace(",", "."))
    return int(numeric) if numeric.is_integer() else numeric


def _dose_unit(value: str) -> str:
    normalized = value.casefold()
    if normalized.startswith("таблет"):
        return "tablet"
    if normalized.startswith("ингаляци"):
        return "inhalation"
    if normalized.startswith("капл"):
        return "drop"
    if normalized.startswith("доз"):
        return "dose"
    if normalized.startswith("впрыскивани"):
        return "spray"
    if normalized.startswith("суппозитори"):
        return "suppository"
    return normalized


def _frequency_number(value: str) -> int | float:
    word_value = _WORD_FREQUENCIES.get(value.casefold())
    return word_value if word_value is not None else _number(value)


def _dose_role(prefix: str) -> str | None:
    normalized = prefix.casefold()
    if "суточ" in normalized and (
        "максимальн" in normalized or re.search(r"не\s+(?:должна\s+)?превыш", normalized)
    ):
        return "maximum-daily"
    if "суточ" in normalized:
        return "daily"
    if "разов" in normalized:
        return "single"
    if "курсов" in normalized:
        return "course"
    return None


def _dose_expressions(text: str) -> list[dict[str, object]]:
    expressions: list[dict[str, object]] = []
    for match in _DOSE_EXPRESSION_PATTERN.finditer(text):
        if re.match(r"\s*/\s*доз", text[match.end() :], re.IGNORECASE):
            continue
        per_time = match.group("per_time")
        if (
            per_time
            and not match.group("per")
            and re.search(
                r"клиренс|\bкк\b|\bскф\b",
                text[max(0, match.start() - 80) : match.end() + 20],
                re.IGNORECASE,
            )
        ):
            continue
        expression: dict[str, object] = {
            "unit": _dose_unit(match.group("unit")),
            "sourceText": match.group(0).strip(),
        }
        first = _number(match.group("first"))
        second_raw = match.group("second")
        connector = match.group("connector")
        prefix = text[max(0, match.start() - 90) : match.start()]
        contextual_limit = re.search(
            r"не\s+(?:принимать\s+)?более[^.;:]{0,30}$|не\s+(?:должна\s+)?превыш[^.;:]{0,30}$",
            prefix,
            re.IGNORECASE,
        )
        if match.group("limit") or contextual_limit:
            expression["maximum"] = _number(second_raw) if second_raw else first
        elif second_raw is None:
            expression["value"] = first
        elif connector and connector.casefold() == "или":
            expression["values"] = [first, _number(second_raw)]
        else:
            expression["minimum"] = first
            expression["maximum"] = _number(second_raw)
        if per := match.group("per"):
            expression["per"] = "m2" if per.casefold() in {"м2", "м²"} else "kg"
        if per_time:
            expression["perTime"] = "minute" if per_time.casefold().startswith("мин") else "hour"
            expression["role"] = "administration-rate"
        elif role := _dose_role(prefix):
            expression["role"] = role
        expressions.append(expression)
    return expressions


def _frequency_expressions(text: str) -> list[dict[str, object]]:
    frequencies: list[dict[str, object]] = []
    for match in _FREQUENCY_PATTERN.finditer(text):
        first = _frequency_number(match.group("first"))
        second_raw = match.group("second")
        frequency: dict[str, object] = {
            "period": "day",
            "sourceText": match.group(0).strip(),
        }
        if match.group("limit"):
            frequency["maximum"] = _frequency_number(second_raw) if second_raw else first
        elif second_raw is None:
            frequency["value"] = first
        else:
            frequency["minimum"] = first
            frequency["maximum"] = _frequency_number(second_raw)
        frequencies.append(frequency)
    return frequencies


def _interval_expressions(text: str) -> list[dict[str, object]]:
    return [
        {
            "value": _number(match.group("value")),
            "unit": "minute" if match.group("unit").casefold().startswith("мин") else "hour",
            "kind": "minimum" if match.group("minimum") else "exact",
            "sourceText": match.group(0).strip(),
        }
        for match in _INTERVAL_PATTERN.finditer(text)
    ]


def _population(text: str) -> dict[str, object]:
    population: dict[str, object] = {}
    normalized = text.casefold()
    age_groups: list[str] = []
    if "взросл" in normalized:
        age_groups.append("adults")
    if "подрост" in normalized:
        age_groups.append("adolescents")
    if re.search(r"\bдет(?:и|ям|ей|ьми|ский|ского)|реб[её]н", normalized):
        age_groups.append("children")
    if age_groups:
        for key in ("ageGroup", "ageRange", "weight", "weightRange"):
            population.pop(key, None)
        population["ageGroup"] = age_groups[0] if len(age_groups) == 1 else age_groups
    age_ranges = [match.group(0).strip() for match in _AGE_RANGE_PATTERN.finditer(text)]
    if age_ranges:
        population["ageRange"] = age_ranges[0] if len(age_ranges) == 1 else age_ranges
    weight_ranges = [match.group(0).strip() for match in _WEIGHT_RANGE_PATTERN.finditer(text)]
    if weight_ranges:
        population["weightRange"] = weight_ranges[0] if len(weight_ranges) == 1 else weight_ranges
    return population


def _route(text: str) -> str | None:
    normalized = text.casefold()
    if "внутривенн" in normalized and "внутримышечн" in normalized:
        return "intravenous-or-intramuscular"
    if "внутривенн" in normalized:
        return "intravenous"
    if "внутримышечн" in normalized:
        return "intramuscular"
    if "ингаляцион" in normalized:
        return "inhalation"
    if re.search(r"\bвнутрь\b|пероральн", normalized):
        return "oral"
    return None


def _paragraphs(text: str) -> list[tuple[int, int, str]]:
    paragraphs: list[tuple[int, int, str]] = []
    for match in re.finditer(r"(?:\A|\n[ \t]*\n)(?P<body>.*?)(?=\n[ \t]*\n|\Z)", text, re.DOTALL):
        quote = match.group("body").strip()
        if not quote:
            continue
        start = match.start("body") + len(match.group("body")) - len(match.group("body").lstrip())
        paragraphs.append((start, start + len(quote), quote))
    return paragraphs


def instruction_dosage_drafts(text: str) -> list[InstructionDosageDraft]:
    """Extract exact, review-only dosage paragraphs from an administration section."""
    drafts: list[InstructionDosageDraft] = []
    for start, end, quote in _paragraphs(text):
        parse_text = _WHITESPACE.sub(" ", _OCR_WORD_BREAK.sub("", quote)).strip()
        explicit_population = _population(parse_text)
        paragraph_route = _route(parse_text)
        expressions = _dose_expressions(parse_text)
        has_dose_context = (
            _DOSE_CONTEXT_PATTERN.search(parse_text) is not None
            or _SCHEDULE_CONTEXT_PATTERN.search(parse_text) is not None
            or any(expression.get("per") in {"kg", "m2"} for expression in expressions)
            or bool(explicit_population)
        )
        if not expressions or not has_dose_context:
            continue
        if _INCOMPLETE_NEGATIVE_PATTERN.search(parse_text) or (
            _NEGATIVE_DOSAGE_PATTERN.search(parse_text)
            and not re.search(
                r"рекомендуемая|обычная|разовая|суточная|принимать|применять\s+по",
                parse_text,
                re.IGNORECASE,
            )
        ):
            continue
        paragraph_population = explicit_population
        if any(expression.get("per") == "kg" for expression in expressions):
            paragraph_population.setdefault("weight", "required")
        if paragraph_route is not None:
            paragraph_population.setdefault("route", paragraph_route)
        structured: dict[str, object] = {"doseExpressions": expressions}
        if frequencies := _frequency_expressions(parse_text):
            structured["frequencyExpressions"] = frequencies
        if intervals := _interval_expressions(parse_text):
            structured["intervalExpressions"] = intervals
        drafts.append(
            InstructionDosageDraft(
                start=start,
                end=end,
                quote=quote,
                structured=structured,
                population=paragraph_population,
            )
        )
    return drafts


def _body_heading_markers(text: str) -> list[tuple[str, int, int, str]]:
    """Return exact physical heading lines at a chunk boundary or after a blank line."""
    markers: list[tuple[str, int, int, str]] = []
    offset = 0
    after_blank = False
    lines = text.splitlines(keepends=True)
    for index, physical_line in enumerate(lines):
        line = physical_line.rstrip("\r\n")
        is_blank = not line.strip(" \t")
        is_marker_position = offset == 0 or after_blank
        if not is_blank and is_marker_position:
            group = _group_for_heading(line.strip(" \t"))
            if group is not None and not _next_nonblank_is_toc_page(lines, index + 1):
                markers.append((group, offset, offset + len(line), line))
        after_blank = is_blank
        offset += len(physical_line)
    return markers


def _next_nonblank_is_toc_page(lines: list[str], start: int) -> bool:
    for physical_line in lines[start:]:
        line = physical_line.strip(" \t\r\n")
        if line:
            return _TOC_PAGE_LINE.fullmatch(line) is not None
    return False


def export_instruction_card_drafts(input_path: Path, output: Path) -> InstructionCardDraftExport:
    """Export exact instruction excerpts as external review-only card drafts."""
    if not input_path.is_file():
        raise ValueError(f"Instruction draft input is not a file: {input_path}")
    if input_path.resolve() == output.resolve():
        raise ValueError("Instruction draft output must not overwrite the input SQLite database.")
    try:
        connection = sqlite3.connect(f"file:{input_path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA schema_version").fetchone()
    except sqlite3.DatabaseError as error:
        raise ValueError(
            f"Instruction draft input is not a valid SQLite database: {input_path}"
        ) from error

    try:
        _validate_input(connection, input_path)
        temporary = output.with_name(f".{output.name}.stage-{uuid4().hex}")
        output.parent.mkdir(parents=True, exist_ok=True)
        coverage = {group: 0 for group in _GROUP_RULES}
        missing = {group: 0 for group in _GROUP_RULES}
        documents = 0
        try:
            with temporary.open("w", encoding="utf-8") as destination:
                document_rows = connection.execute(
                    """SELECT d.id, d.title, dv.id AS version_id, dv.source_checksum
                    FROM documents d
                    JOIN document_versions dv ON dv.id = d.current_version_id
                    WHERE d.source_type = 'official_drug_instruction'
                    ORDER BY d.id"""
                )
                for document in document_rows:
                    document_id = str(document["id"])
                    version_id = str(document["version_id"])
                    groups: dict[str, list[dict[str, object]]] = {}
                    rows = connection.execute(
                        """SELECT s.id AS section_id, s.title AS section_title,
                                  s.anchor AS section_anchor, c.id AS chunk_id,
                                  c.anchor AS chunk_anchor, c.original_text
                        FROM sections s
                        JOIN chunks c ON c.section_id = s.id
                        WHERE s.document_version_id = ? AND c.document_version_id = ?
                        ORDER BY s.order_index, c.order_index, c.id""",
                        (version_id, version_id),
                    )
                    chunk_rows = rows.fetchall()
                    for row in chunk_rows:
                        group = _group_for_heading(str(row["section_title"]))
                        if group is None:
                            continue
                        groups.setdefault(group, []).append(
                            {
                                "documentId": document_id,
                                "documentVersionId": version_id,
                                "sectionId": str(row["section_id"]),
                                "chunkId": str(row["chunk_id"]),
                                "anchor": str(row["chunk_anchor"]),
                                "quote": str(row["original_text"]),
                                "sectionAnchor": str(row["section_anchor"]),
                            }
                        )
                    if len(groups) < len(_GROUP_RULES):
                        for row in chunk_rows:
                            for group, start, end, quote in _body_heading_markers(
                                str(row["original_text"])
                            ):
                                if group in groups:
                                    continue
                                groups[group] = [
                                    {
                                        "documentId": document_id,
                                        "documentVersionId": version_id,
                                        "sectionId": str(row["section_id"]),
                                        "chunkId": str(row["chunk_id"]),
                                        "anchor": str(row["chunk_anchor"]),
                                        "quote": quote,
                                        "sectionAnchor": str(row["section_anchor"]),
                                        "matchKind": "body-heading-marker",
                                        "startOffset": start,
                                        "endOffset": end,
                                    }
                                ]
                    missing_groups = [group for group in _GROUP_RULES if group not in groups]
                    for group in groups:
                        coverage[group] += 1
                    for group in missing_groups:
                        missing[group] += 1
                    candidate = {
                        "artifactType": "instruction-card-draft",
                        "reviewStatus": "needs-review",
                        "extractionRule": {
                            "version": _RULE_VERSION,
                            "method": (
                                "exact normalized section-heading match with "
                                "body-heading-marker fallback"
                            ),
                        },
                        "document": {
                            "id": document_id,
                            "title": str(document["title"]),
                            "versionId": version_id,
                            "sourceChecksum": str(document["source_checksum"]),
                        },
                        "groups": groups,
                        "missingGroups": missing_groups,
                    }
                    destination.write(
                        json.dumps(candidate, ensure_ascii=False, separators=(",", ":")) + "\n"
                    )
                    documents += 1
            temporary.replace(output)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    finally:
        connection.close()
    return InstructionCardDraftExport(
        input=str(input_path),
        output=str(output),
        documents=documents,
        group_coverage=coverage,
        missing_group_counts=missing,
    )
