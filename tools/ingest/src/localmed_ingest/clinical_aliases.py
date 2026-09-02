from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from pydantic import Field

from .clinical_catalog import (
    CatalogModel,
    ClinicalCoverageLedger,
    ClinicalMedicationLink,
)
from .knowledge import KnowledgeWorkspace

_SPACE_PATTERN = re.compile(r"\s+")
_PARENTHETICAL_PATTERN = re.compile(r"^(?P<base>[^()]+?)\s*\((?P<detail>[^()]+)\)\s*$")
_INLINE_PARENTHETICAL_PATTERN = re.compile(
    r"^(?P<prefix>[^\s()]+)\s+\((?P<detail>[^\s()]+)\)\s+(?P<suffix>[^()]+)$"
)
_DASHED_ENTRY_PATTERN = re.compile(r"^(?P<left>.+?)\s*[–—-]\s*(?P<right>.+)$", re.DOTALL)
_SYNONYM_PATTERN = re.compile(
    r"^(?:синоним(?:ы)?|другое название)\s*[:–—-]\s*(?P<value>.+)$",
    re.IGNORECASE | re.DOTALL,
)
_KEYWORD_SECTION_PATTERN = re.compile(r"^ключевые слова(?:\s*(?:[№#]?\s*\d+|[^\w\s]+))*$")
_EXPLICIT_KEYWORDS_PATTERN = re.compile(
    r"^\s*ключевые слова\s*:\s*(?P<value>[^\n]+)$",
    re.IGNORECASE | re.MULTILINE,
)
_ABBREVIATION_ENTRY_PATTERN = re.compile(
    r"^(?P<left>.+?)(?:\s+[–—]\s+|\s+-\s+|-\s+)(?P<right>.+)$",
    re.DOTALL,
)
_KEYWORD_BULLET_PATTERN = re.compile(r"(?<![0-9A-Za-zА-Яа-яЁё])o(?=\s+)")
_TOKEN_PATTERN = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+")
_ACRONYM_CHARACTER_PATTERN = re.compile(r"^[0-9A-Za-zА-Яа-яЁё./+\-\s]+$")
_IGNORED_TITLE_TOKENS = {
    "взрослых",
    "взрослого",
    "детей",
    "детского",
    "пациентов",
    "пациента",
    "у",
}
_MAX_ALIAS_LENGTH = 160
_MAX_ALIAS_WORDS = 16
_MAX_KEYWORD_LENGTH = 160
_MAX_KEYWORD_WORDS = 16
_MAX_KEYWORDS_PER_RECORD = 64


class ClinicalAliasProvenance(CatalogModel):
    alias: str
    origin: Literal["input", "title", "section"]
    db_filename: str | None = None
    section_id: str | None = None
    section_title: str | None = None
    chunk_id: str | None = None
    source_text: str
    page_start: int | None = None
    page_end: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    source_spans: list[dict[str, object]] = Field(default_factory=lambda: list[dict[str, object]]())


class ClinicalKeywordProvenance(CatalogModel):
    keyword: str
    origin: Literal["input", "section"]
    db_filename: str | None = None
    section_id: str | None = None
    section_title: str | None = None
    chunk_id: str | None = None
    source_text: str
    page_start: int | None = None
    page_end: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    source_spans: list[dict[str, object]] = Field(default_factory=lambda: list[dict[str, object]]())


class ClinicalAliasRecordReport(CatalogModel):
    record_id: str
    official_id: str
    title: str
    exact_module_id: str | None = None
    db_filename: str | None = None
    aliases: list[ClinicalAliasProvenance] = Field(
        default_factory=lambda: list[ClinicalAliasProvenance]()
    )
    keywords: list[ClinicalKeywordProvenance] = Field(
        default_factory=lambda: list[ClinicalKeywordProvenance]()
    )
    medication_links: list[ClinicalMedicationLink] = Field(
        default_factory=lambda: list[ClinicalMedicationLink]()
    )
    diagnostics: list[str] = Field(default_factory=lambda: list[str]())


class ClinicalAliasUnmatchedRecord(CatalogModel):
    record_id: str
    official_id: str
    diagnostic: str


class ClinicalAliasEnrichmentSummary(CatalogModel):
    records_total: int
    matched_databases: int
    records_with_aliases: int
    aliases_total: int
    records_with_keywords: int
    keywords_total: int
    records_with_medication_links: int
    medication_links_total: int
    unmatched_records: int
    unmatched_databases: int


class ClinicalAliasEnrichmentReport(CatalogModel):
    schema_version: int = 1
    generated_at: str
    input_ledger_checksum: str
    summary: ClinicalAliasEnrichmentSummary
    records: list[ClinicalAliasRecordReport]
    unmatched_records: list[ClinicalAliasUnmatchedRecord] = Field(
        default_factory=lambda: list[ClinicalAliasUnmatchedRecord]()
    )
    unmatched_databases: list[str] = Field(default_factory=lambda: list[str]())


@dataclass(frozen=True)
class _SourceChunk:
    section_id: str
    section_title: str
    chunk_id: str
    source_text: str
    page_start: int | None
    page_end: int | None
    char_start: int | None
    char_end: int | None
    source_spans: list[dict[str, object]]


def _clean(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value.replace("\xa0", " ")).strip()


def _normalized(value: str) -> str:
    return _clean(value).replace("ё", "е").casefold()


def _tokens(value: str) -> set[str]:
    return {
        token
        for raw_token in _TOKEN_PATTERN.findall(_normalized(value))
        if ((token := raw_token.casefold()).isdigit() or len(token) >= 2)
        and token not in _IGNORED_TITLE_TOKENS
    }


def _safe_alias(value: str) -> str | None:
    cleaned = _clean(value).strip(" ,;:–—-")
    if not cleaned or len(cleaned) > _MAX_ALIAS_LENGTH:
        return None
    if len(cleaned.split()) > _MAX_ALIAS_WORDS:
        return None
    if not any(character.isalpha() for character in cleaned):
        return None
    if "http://" in cleaned.casefold() or "https://" in cleaned.casefold():
        return None
    return cleaned


def _safe_keyword(value: str) -> str | None:
    cleaned = re.sub(r"^(?:[•●▪◦]|o)\s+", "", _clean(value), flags=re.IGNORECASE)
    cleaned = cleaned.lstrip("-–—•●▪◦* ").strip(" ,;:–—-")
    if not cleaned or len(cleaned) > _MAX_KEYWORD_LENGTH:
        return None
    if len(cleaned.split()) > _MAX_KEYWORD_WORDS:
        return None
    if not any(character.isalpha() for character in cleaned):
        return None
    return cleaned


def _looks_like_abbreviation_label(value: str) -> bool:
    cleaned = re.sub(r"[*#]+", "", _clean(value)).strip(" -–—")
    tokens = cleaned.split()
    letters = [character for character in cleaned if character.isalpha()]
    uppercase = sum(character.isupper() for character in letters)
    if not letters:
        return False
    if _looks_like_acronym(cleaned):
        return True
    if (
        len(cleaned) <= 18
        and len(tokens) <= 3
        and (any(character.isdigit() for character in cleaned) or "/" in cleaned or "-" in cleaned)
    ):
        return True
    if len(tokens) == 1 and len(letters) <= 8 and uppercase >= 2:
        return uppercase / len(letters) >= 0.5
    if tokens and tokens[0].casefold() in {"анти", "а"} and len(cleaned) <= 18:
        return True
    return len(tokens) >= 2 and "типа" in {token.casefold() for token in tokens} and uppercase >= 1


def _is_abbreviation_entry(value: str) -> bool:
    match = _ABBREVIATION_ENTRY_PATTERN.fullmatch(_clean(value))
    return match is not None and _looks_like_abbreviation_label(match.group("left"))


def _looks_like_acronym(value: str) -> bool:
    cleaned = _clean(value)
    if not 2 <= len(cleaned) <= 24 or not _ACRONYM_CHARACTER_PATTERN.fullmatch(cleaned):
        return False
    letters = [character for character in cleaned if character.isalpha()]
    if len(letters) < 2 or len(cleaned.split()) > 3:
        return False
    uppercase = sum(character.isupper() for character in letters)
    return uppercase / len(letters) >= 0.75


def _simple_reordered_variant(base: str, detail: str) -> str | None:
    base_words = base.split()
    detail_words = detail.split()
    if not 1 <= len(base_words) <= 6 or not 1 <= len(detail_words) <= 3:
        return None
    if _looks_like_acronym(detail):
        return None
    if any(not word.replace("-", "").isalpha() for word in [*base_words, *detail_words]):
        return None
    if _normalized(detail_words[0]) in {"в", "для", "при", "с", "у"}:
        return None
    reordered = f"{detail[0].upper()}{detail[1:]} {base[0].lower()}{base[1:]}"
    return _safe_alias(reordered)


def _title_variants(title: str) -> list[str]:
    variants: list[str] = []
    inline_parenthetical = _INLINE_PARENTHETICAL_PATTERN.fullmatch(_clean(title))
    if inline_parenthetical:
        prefix = inline_parenthetical.group("prefix")
        detail = inline_parenthetical.group("detail")
        suffix = inline_parenthetical.group("suffix")
        if all(value.replace("-", "").isalpha() for value in (prefix, detail)):
            without_parenthetical = _safe_alias(f"{prefix} {suffix}")
            replacement = _safe_alias(f"{detail[0].upper()}{detail[1:]} {suffix}")
            if without_parenthetical:
                variants.append(without_parenthetical)
            if replacement:
                variants.append(replacement)

    parenthetical = _PARENTHETICAL_PATTERN.fullmatch(_clean(title))
    if parenthetical:
        base = _safe_alias(parenthetical.group("base"))
        detail = _safe_alias(parenthetical.group("detail"))
        if base:
            variants.append(base)
        if detail and _looks_like_acronym(detail):
            variants.append(detail)
        elif base and detail:
            reordered = _simple_reordered_variant(base, detail)
            if reordered:
                variants.append(reordered)

    slash_parts = [_safe_alias(part) for part in re.split(r"\s+/\s+", title)]
    if len(slash_parts) > 1 and all(slash_parts):
        variants.extend(cast(list[str], slash_parts))
    return _deduplicate(variants, excluded={_normalized(title)})


def _deduplicate(values: list[str], *, excluded: set[str] | None = None) -> list[str]:
    result: list[str] = []
    seen = set(excluded or set())
    for value in values:
        key = _normalized(value)
        if key and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _lexically_related(candidate: str, title_variants: list[str]) -> bool:
    candidate_tokens = _tokens(candidate)
    if not candidate_tokens:
        return False
    return any(candidate_tokens <= _tokens(title) for title in title_variants)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _database_official_id(path: Path) -> str | None:
    prefix = "clinical-"
    marker = "-clinical-"
    if not path.name.startswith(prefix) or not path.name.endswith(".db"):
        return None
    official_id, separator, _suffix = path.name[len(prefix) :].partition(marker)
    return official_id if separator and official_id else None


def _database_index(directory: Path) -> dict[str, list[Path]]:
    index: dict[str, list[Path]] = {}
    for path in sorted(directory.glob("clinical-*.db"), key=lambda item: item.name):
        official_id = _database_official_id(path)
        if official_id is not None:
            index.setdefault(official_id, []).append(path)
    return index


def _medication_relation_index(directory: Path | None) -> dict[str, list[ClinicalMedicationLink]]:
    if directory is None:
        return {}
    if not directory.is_dir():
        raise ValueError("Clinical medication relation directory must exist and be a directory.")
    result: dict[str, list[ClinicalMedicationLink]] = {}
    for path in sorted(directory.glob("*.json"), key=lambda item: item.name):
        workspace = KnowledgeWorkspace.model_validate_json(path.read_text(encoding="utf-8"))
        conditions = [entity for entity in workspace.entities if entity.entity_type == "condition"]
        if len(conditions) != 1:
            raise ValueError(f"{path}: expected exactly one condition entity.")
        condition = conditions[0]
        official_id = condition.external_ids.get("officialClinicalId")
        target_document_id = condition.metadata.get("sourceDocumentId")
        if not official_id or not isinstance(target_document_id, str) or not target_document_id:
            raise ValueError(f"{path}: condition identity is incomplete.")
        if official_id in result:
            raise ValueError(f"Duplicate clinical medication relation set for {official_id}.")
        entities = {entity.id: entity for entity in workspace.entities}
        links: list[ClinicalMedicationLink] = []
        for relation in workspace.relations:
            medication = entities.get(relation.subject_entity_id)
            if (
                relation.object_entity_id != condition.id
                or relation.predicate != "recommended-for"
                or relation.relation_status != "guideline"
                or relation.review_status != "proposed"
                or medication is None
                or medication.entity_type != "medication"
                or len(relation.evidence) != 1
            ):
                raise ValueError(f"{path}: unsupported clinical medication relation {relation.id}.")
            mnn_document_id = medication.external_ids.get("esklpMnnDocumentId")
            inn = medication.medication.inn if medication.medication else None
            evidence = relation.evidence[0]
            source_anchor = evidence.source_locator.get("anchor")
            population = relation.metadata.get("population", {})
            if not isinstance(population, dict):
                raise ValueError(f"{path}: relation {relation.id} has invalid population metadata.")
            raw_age_groups = population.get("ageGroups", [])
            if not isinstance(raw_age_groups, list) or any(
                not isinstance(value, str) or not value.strip() for value in raw_age_groups
            ):
                raise ValueError(f"{path}: relation {relation.id} has invalid age groups.")
            if (
                not mnn_document_id
                or not inn
                or not isinstance(source_anchor, str)
                or not source_anchor
                or evidence.document_id != target_document_id
            ):
                raise ValueError(f"{path}: relation {relation.id} has incomplete source identity.")
            links.append(
                ClinicalMedicationLink(
                    relation_id=relation.id,
                    mnn_document_id=mnn_document_id,
                    inn=inn,
                    target_document_id=target_document_id,
                    age_groups=list(dict.fromkeys(raw_age_groups)),
                    evidence_quote=evidence.quote,
                    source_anchor=source_anchor,
                    source_section_id=evidence.section_id,
                    source_chunk_id=evidence.chunk_id,
                )
            )
        result[official_id] = sorted(links, key=lambda link: link.relation_id)
    return result


def _source_spans(
    metadata_json: str, diagnostics: list[str], chunk_id: str
) -> list[dict[str, object]]:
    try:
        metadata_value: object = json.loads(metadata_json)
    except json.JSONDecodeError:
        diagnostics.append(f"invalid-chunk-metadata:{chunk_id}")
        return []
    if not isinstance(metadata_value, dict):
        return []
    metadata = cast(dict[str, object], metadata_value)
    source_spans = metadata.get("sourceSpans")
    if not isinstance(source_spans, list):
        return []
    return [
        cast(dict[str, object], item)
        for item in cast(list[object], source_spans)
        if isinstance(item, dict)
    ]


def _keyword_section(title: str) -> bool:
    return _KEYWORD_SECTION_PATTERN.fullmatch(_normalized(title)) is not None


def _candidate_section(title: str) -> bool:
    normalized = _normalized(title)
    return (
        _keyword_section(title)
        or "сокращен" in normalized
        or "синоним" in normalized
        or ("термин" in normalized and "определен" in normalized)
    )


def _sqlite_normalized(value: str | None) -> str:
    return _normalized(value or "")


def _read_source_chunks(
    connection: sqlite3.Connection,
    diagnostics: list[str],
) -> list[_SourceChunk]:
    section_rows = connection.execute(
        "SELECT id, title FROM sections ORDER BY order_index, id"
    ).fetchall()
    all_sections = {cast(str, section_id): cast(str, title) for section_id, title in section_rows}
    candidate_sections = {
        cast(str, section_id): cast(str, title)
        for section_id, title in section_rows
        if _candidate_section(cast(str, title))
    }
    connection.create_function("minimed_normalized", 1, _sqlite_normalized, deterministic=True)
    parameters: tuple[str, ...] = tuple(candidate_sections)
    section_condition = ""
    if candidate_sections:
        placeholders = ",".join("?" for _item in candidate_sections)
        section_condition = f"section_id IN ({placeholders}) OR "
    rows = connection.execute(
        f"""SELECT id, section_id, original_text, page_start, page_end,
                   char_start, char_end, metadata_json
            FROM chunks
            WHERE {section_condition}
                  instr(minimed_normalized(original_text), 'ключевые слова:') > 0
            ORDER BY order_index, id""",
        parameters,
    ).fetchall()
    return [
        _SourceChunk(
            section_id=cast(str, section_id),
            section_title=all_sections[cast(str, section_id)],
            chunk_id=cast(str, chunk_id),
            source_text=cast(str, source_text),
            page_start=cast(int | None, page_start),
            page_end=cast(int | None, page_end),
            char_start=cast(int | None, char_start),
            char_end=cast(int | None, char_end),
            source_spans=_source_spans(cast(str, metadata_json), diagnostics, cast(str, chunk_id)),
        )
        for (
            chunk_id,
            section_id,
            source_text,
            page_start,
            page_end,
            char_start,
            char_end,
            metadata_json,
        ) in rows
    ]


def _validated_chunks(
    path: Path,
    *,
    official_id: str,
    record_id: str,
    diagnostics: list[str],
) -> list[_SourceChunk] | None:
    try:
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as connection:
            document = connection.execute(
                "SELECT metadata_json FROM documents WHERE id = ?",
                (record_id,),
            ).fetchone()
            if document is None:
                diagnostics.append("target-document-not-found")
                return None
            metadata_value: object = json.loads(cast(str, document[0]))
            if not isinstance(metadata_value, dict):
                diagnostics.append("official-id-mismatch")
                return None
            metadata = cast(dict[str, object], metadata_value)
            if metadata.get("officialId") != official_id:
                diagnostics.append("official-id-mismatch")
                return None
            return _read_source_chunks(connection, diagnostics)
    except (json.JSONDecodeError, sqlite3.Error) as error:
        diagnostics.append(f"invalid-database:{type(error).__name__}")
        return None


def _source_blocks(source_text: str) -> list[str]:
    return [block.strip() for block in re.split(r"\n\s*\n", source_text) if block.strip()]


def _section_aliases(chunk: _SourceChunk, title_variants: list[str]) -> list[tuple[str, str]]:
    aliases: list[tuple[str, str]] = []
    normalized_title = _normalized(chunk.section_title)
    for source_block in _source_blocks(chunk.source_text):
        compact = _clean(source_block)
        if "сокращен" in normalized_title:
            entry = _DASHED_ENTRY_PATTERN.fullmatch(compact)
            if entry is None:
                continue
            acronym = _safe_alias(entry.group("left"))
            expansion = _safe_alias(entry.group("right"))
            if (
                acronym
                and expansion
                and _looks_like_acronym(acronym)
                and _lexically_related(expansion, title_variants)
            ):
                aliases.extend([(expansion, source_block), (acronym, source_block)])
            continue

        synonym = _SYNONYM_PATTERN.fullmatch(compact)
        if synonym is not None:
            candidates = re.split(r"\s*;\s*|\s+/\s+", synonym.group("value"))
        elif "термин" in normalized_title and "определен" in normalized_title:
            entry = _DASHED_ENTRY_PATTERN.fullmatch(compact)
            candidates = [entry.group("left")] if entry is not None else []
        else:
            candidates = []
        for raw_candidate in candidates:
            candidate = _safe_alias(raw_candidate)
            if candidate and _lexically_related(candidate, title_variants):
                aliases.append((candidate, source_block))
    return aliases


def _split_keyword_values(value: str) -> list[str]:
    values: list[str] = []
    for item in _split_top_level(value, {";", "\n"}):
        cleaned_item = item.strip()
        if not cleaned_item:
            continue
        marker_count = len(_KEYWORD_BULLET_PATTERN.findall(cleaned_item))
        bullet_items = (
            _KEYWORD_BULLET_PATTERN.split(cleaned_item) if marker_count >= 2 else [cleaned_item]
        )
        for bullet_item in bullet_items:
            if not bullet_item.strip() or _is_abbreviation_entry(bullet_item):
                continue
            comma_parts = [
                part.strip() for part in _split_top_level(bullet_item, {","}) if part.strip()
            ]
            candidates = comma_parts if 1 < len(comma_parts) <= 20 else [bullet_item]
            for candidate in candidates:
                keyword = _safe_keyword(candidate)
                if keyword:
                    values.append(keyword)
    return _deduplicate(values)[:_MAX_KEYWORDS_PER_RECORD]


def _split_top_level(value: str, delimiters: set[str]) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    for index, character in enumerate(value):
        if character in "([{":
            depth += 1
        elif character in ")]}":
            depth = max(0, depth - 1)
        elif character in delimiters and depth == 0:
            parts.append(value[start:index])
            start = index + 1
    parts.append(value[start:])
    return parts


def _section_keywords(chunk: _SourceChunk) -> list[tuple[str, str]]:
    keywords: list[tuple[str, str]] = []
    if _keyword_section(chunk.section_title):
        source_blocks = _source_blocks(chunk.source_text)
        marker_index = next(
            (
                index
                for index, source_block in enumerate(source_blocks)
                if _normalized(source_block) == "ключевые слова"
            ),
            None,
        )
        if marker_index is not None:
            source_blocks = source_blocks[marker_index + 1 :]
        for source_block in source_blocks:
            explicit = _EXPLICIT_KEYWORDS_PATTERN.fullmatch(source_block)
            value = explicit.group("value") if explicit else source_block
            keywords.extend((keyword, source_block) for keyword in _split_keyword_values(value))
        return keywords

    for explicit in _EXPLICIT_KEYWORDS_PATTERN.finditer(chunk.source_text):
        source_text = explicit.group(0).strip()
        keywords.extend(
            (keyword, source_text) for keyword in _split_keyword_values(explicit.group("value"))
        )
    return keywords


def _provenance(
    alias: str,
    *,
    origin: Literal["input", "title", "section"],
    source_text: str,
    db_filename: str | None,
    chunk: _SourceChunk | None = None,
) -> ClinicalAliasProvenance:
    return ClinicalAliasProvenance(
        alias=alias,
        origin=origin,
        db_filename=db_filename,
        section_id=chunk.section_id if chunk else None,
        section_title=chunk.section_title if chunk else None,
        chunk_id=chunk.chunk_id if chunk else None,
        source_text=source_text,
        page_start=chunk.page_start if chunk else None,
        page_end=chunk.page_end if chunk else None,
        char_start=chunk.char_start if chunk else None,
        char_end=chunk.char_end if chunk else None,
        source_spans=chunk.source_spans if chunk else [],
    )


def _keyword_provenance(
    keyword: str,
    *,
    origin: Literal["input", "section"],
    source_text: str,
    db_filename: str | None,
    chunk: _SourceChunk | None = None,
) -> ClinicalKeywordProvenance:
    return ClinicalKeywordProvenance(
        keyword=keyword,
        origin=origin,
        db_filename=db_filename,
        section_id=chunk.section_id if chunk else None,
        section_title=chunk.section_title if chunk else None,
        chunk_id=chunk.chunk_id if chunk else None,
        source_text=source_text,
        page_start=chunk.page_start if chunk else None,
        page_end=chunk.page_end if chunk else None,
        char_start=chunk.char_start if chunk else None,
        char_end=chunk.char_end if chunk else None,
        source_spans=chunk.source_spans if chunk else [],
    )


def enrich_clinical_aliases(
    input_ledger: Path,
    databases_directory: Path,
    output_ledger: Path,
    report_output: Path,
    medication_relations_directory: Path | None = None,
) -> ClinicalAliasEnrichmentReport:
    """Write an enriched copy of a clinical ledger and traceable alias report."""
    input_path = input_ledger.resolve()
    output_path = output_ledger.resolve()
    report_path = report_output.resolve()
    if output_path == input_path or report_path == input_path:
        raise ValueError("Output ledger and report must not overwrite the input ledger.")
    if output_path == report_path:
        raise ValueError("Output ledger and report must use different paths.")
    if not databases_directory.exists() or not databases_directory.is_dir():
        raise ValueError("Clinical database directory must exist and be a directory.")
    ledger = ClinicalCoverageLedger.model_validate_json(input_ledger.read_text(encoding="utf-8"))
    database_index = _database_index(databases_directory)
    medication_relation_index = _medication_relation_index(medication_relations_directory)
    known_official_ids = {record.official_id for record in ledger.records}
    unknown_relation_ids = sorted(set(medication_relation_index) - known_official_ids)
    if unknown_relation_ids:
        raise ValueError(
            "Clinical medication relations reference unknown official ids: "
            + ", ".join(unknown_relation_ids)
        )
    unmatched_databases = sorted(
        path.name
        for official_id, paths in database_index.items()
        if official_id not in known_official_ids
        for path in paths
    )
    record_reports: list[ClinicalAliasRecordReport] = []
    unmatched_records: list[ClinicalAliasUnmatchedRecord] = []
    matched_databases = 0

    for record in ledger.records:
        paths = database_index.get(record.official_id, [])
        diagnostics: list[str] = []
        database_path: Path | None = None
        chunks: list[_SourceChunk] = []
        if not paths:
            diagnostics.append("database-not-found")
        elif len(paths) > 1:
            diagnostics.append("multiple-databases")
        else:
            candidate = paths[0]
            validated = _validated_chunks(
                candidate,
                official_id=record.official_id,
                record_id=record.record_id,
                diagnostics=diagnostics,
            )
            if validated is not None:
                database_path = candidate
                chunks = validated
                matched_databases += 1

        db_filename = database_path.name if database_path else None
        provenance: list[ClinicalAliasProvenance] = []
        keyword_provenance: list[ClinicalKeywordProvenance] = []
        aliases: list[str] = []
        keywords: list[str] = []
        seen = {_normalized(record.title)}
        keyword_seen: set[str] = set()
        for alias in record.aliases:
            safe = _safe_alias(alias)
            if safe is None or _normalized(safe) in seen:
                continue
            seen.add(_normalized(safe))
            aliases.append(safe)
            provenance.append(
                _provenance(
                    safe,
                    origin="input",
                    source_text=safe,
                    db_filename=db_filename,
                )
            )
        for alias in _title_variants(record.title):
            if _normalized(alias) in seen:
                continue
            seen.add(_normalized(alias))
            aliases.append(alias)
            provenance.append(
                _provenance(
                    alias,
                    origin="title",
                    source_text=record.title,
                    db_filename=db_filename,
                )
            )
        for keyword in record.keywords:
            safe = _safe_keyword(keyword)
            if safe is None or _normalized(safe) in keyword_seen:
                continue
            keyword_seen.add(_normalized(safe))
            keywords.append(safe)
            keyword_provenance.append(
                _keyword_provenance(
                    safe,
                    origin="input",
                    source_text=safe,
                    db_filename=db_filename,
                )
            )

        comparison_titles = [record.title, *aliases]
        for chunk in chunks:
            for alias, source_text in _section_aliases(chunk, comparison_titles):
                if _normalized(alias) in seen:
                    continue
                seen.add(_normalized(alias))
                aliases.append(alias)
                provenance.append(
                    _provenance(
                        alias,
                        origin="section",
                        source_text=source_text,
                        db_filename=db_filename,
                        chunk=chunk,
                    )
                )
            for keyword, source_text in _section_keywords(chunk):
                if len(keywords) >= _MAX_KEYWORDS_PER_RECORD:
                    break
                key = _normalized(keyword)
                if key in keyword_seen:
                    continue
                keyword_seen.add(key)
                keywords.append(keyword)
                keyword_provenance.append(
                    _keyword_provenance(
                        keyword,
                        origin="section",
                        source_text=source_text,
                        db_filename=db_filename,
                        chunk=chunk,
                    )
                )

        record.aliases = aliases
        record.keywords = keywords
        record.clinical_medication_links = medication_relation_index.get(record.official_id, [])
        exact_module_id: str | None = None
        if database_path is not None:
            exact_module_id = f"minimed.clinical.recommendation.{record.official_id}"
            if exact_module_id not in record.module_ids:
                record.module_ids.append(exact_module_id)
        else:
            diagnostic = diagnostics[0] if diagnostics else "database-not-validated"
            unmatched_records.append(
                ClinicalAliasUnmatchedRecord(
                    record_id=record.record_id,
                    official_id=record.official_id,
                    diagnostic=diagnostic,
                )
            )
        record_reports.append(
            ClinicalAliasRecordReport(
                record_id=record.record_id,
                official_id=record.official_id,
                title=record.title,
                exact_module_id=exact_module_id,
                db_filename=db_filename,
                aliases=provenance,
                keywords=keyword_provenance,
                medication_links=record.clinical_medication_links,
                diagnostics=diagnostics,
            )
        )

    output_ledger.parent.mkdir(parents=True, exist_ok=True)
    output_ledger.write_text(
        json.dumps(ledger.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    report = ClinicalAliasEnrichmentReport(
        generated_at=ledger.generated_at,
        input_ledger_checksum=_sha256_file(input_ledger),
        summary=ClinicalAliasEnrichmentSummary(
            records_total=len(ledger.records),
            matched_databases=matched_databases,
            records_with_aliases=sum(bool(record.aliases) for record in ledger.records),
            aliases_total=sum(len(record.aliases) for record in ledger.records),
            records_with_keywords=sum(bool(record.keywords) for record in ledger.records),
            keywords_total=sum(len(record.keywords) for record in ledger.records),
            records_with_medication_links=sum(
                bool(record.clinical_medication_links) for record in ledger.records
            ),
            medication_links_total=sum(
                len(record.clinical_medication_links) for record in ledger.records
            ),
            unmatched_records=len(unmatched_records),
            unmatched_databases=len(unmatched_databases),
        ),
        records=record_reports,
        unmatched_records=unmatched_records,
        unmatched_databases=unmatched_databases,
    )
    report_output.parent.mkdir(parents=True, exist_ok=True)
    report_output.write_text(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return report
