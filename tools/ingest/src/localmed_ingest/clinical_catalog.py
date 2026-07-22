from __future__ import annotations

import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

CoverageState = Literal[
    "published",
    "metadata-only",
    "needs-review",
    "blocked-source",
    "licence-restricted",
    "superseded",
    "historical",
    "failed-validation",
]
RecordStatus = Literal["active", "superseded", "historical", "unknown"]
RightsState = Literal["redistributable", "metadata-only", "restricted", "unknown"]

_SPACE_PATTERN = re.compile(r"\s+")
_SPLIT_PATTERN = re.compile(r"[;,|\n]+")
_SAFE_ID_PATTERN = re.compile(r"[^0-9A-Za-zА-Яа-я._-]+")


class CatalogModel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: _to_camel(value), populate_by_name=True)


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


def _normalized(value: object) -> str:
    return _SPACE_PATTERN.sub(" ", str(value).replace("ё", "е").lower()).strip()


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _split_values(value: object | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_split_values(item))
        return _deduplicate(result)
    cleaned = _clean(value)
    if cleaned is None:
        return []
    return _deduplicate(part.strip() for part in _SPLIT_PATTERN.split(cleaned) if part.strip())


def _deduplicate(values: Any) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = str(raw).strip()
        key = _normalized(value)
        if not value or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class ClinicalModuleRule(CatalogModel):
    id: str
    title: str
    priority: int = 0
    title_keywords: list[str] = Field(default_factory=list)
    developer_keywords: list[str] = Field(default_factory=list)
    icd10_prefixes: list[str] = Field(default_factory=list)
    age_keywords: list[str] = Field(default_factory=list)
    specialties: list[str] = Field(default_factory=list)
    fallback: bool = False

    @model_validator(mode="after")
    def validate_rule(self) -> ClinicalModuleRule:
        has_matcher = any(
            (
                self.title_keywords,
                self.developer_keywords,
                self.icd10_prefixes,
                self.age_keywords,
            )
        )
        if not self.fallback and not has_matcher:
            raise ValueError(f"Clinical module rule {self.id} has no matchers.")
        return self


class ClinicalModuleTaxonomy(CatalogModel):
    schema_version: int = Field(default=1, ge=1)
    modules: list[ClinicalModuleRule]

    @model_validator(mode="after")
    def validate_modules(self) -> ClinicalModuleTaxonomy:
        if not self.modules:
            raise ValueError("Clinical module taxonomy must contain at least one module.")
        identifiers = [module.id for module in self.modules]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Clinical module taxonomy contains duplicate module ids.")
        if sum(module.fallback for module in self.modules) != 1:
            raise ValueError("Clinical module taxonomy must contain exactly one fallback module.")
        return self


class CoverageOverride(CatalogModel):
    coverage_state: CoverageState | None = None
    rights: RightsState | None = None
    source_url: str | None = None
    module_ids: list[str] | None = None
    notes: list[str] = Field(default_factory=list)


class CoverageOverrideFile(CatalogModel):
    schema_version: int = Field(default=1, ge=1)
    records: dict[str, CoverageOverride] = Field(default_factory=dict)


class ClinicalCatalogRecord(CatalogModel):
    record_id: str
    official_id: str
    title: str
    version_label: str
    status: RecordStatus
    application_status: str | None = None
    age_categories: list[str] = Field(default_factory=list)
    icd10_codes: list[str] = Field(default_factory=list)
    developer: str | None = None
    published_at: str | None = None
    official_url: str
    source_url: str | None = None
    coverage_state: CoverageState = "metadata-only"
    rights: RightsState = "unknown"
    module_ids: list[str]
    primary_module_id: str
    specialties: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    raw_metadata: dict[str, object] = Field(default_factory=dict)


class ClinicalModulePlanEntry(CatalogModel):
    module_id: str
    title: str
    priority: int
    record_ids: list[str]
    coverage_counts: dict[str, int]
    specialties: list[str]


class ClinicalCoverageSummary(CatalogModel):
    total_records: int
    coverage_counts: dict[str, int]
    status_counts: dict[str, int]
    module_counts: dict[str, int]


class ClinicalCoverageLedger(CatalogModel):
    schema_version: int = 1
    generated_at: str
    source_checksum: str
    taxonomy_checksum: str
    records: list[ClinicalCatalogRecord]
    modules: list[ClinicalModulePlanEntry]
    summary: ClinicalCoverageSummary
    warnings: list[str] = Field(default_factory=list)


_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "official_id": (
        "id",
        "officialid",
        "official_id",
        "idкр",
        "ид",
        "код",
        "номер",
    ),
    "title": ("name", "title", "наименование", "название", "наименование кр"),
    "version_label": (
        "version",
        "versionlabel",
        "version_label",
        "редакция",
        "версия",
    ),
    "icd10_codes": ("mkb10", "icd10", "icd-10", "мкб-10", "мкб10", "коды мкб-10"),
    "age_categories": (
        "age",
        "agecategory",
        "age_categories",
        "возрастная категория",
        "возраст",
    ),
    "developer": ("developer", "разработчик", "организация-разработчик"),
    "published_at": (
        "publishedat",
        "published_at",
        "дата размещения кр",
        "дата публикации",
        "дата размещения",
    ),
    "application_status": (
        "applicationstatus",
        "application_status",
        "status",
        "статус применения кр",
        "статус",
    ),
    "official_url": ("officialurl", "official_url", "url", "ссылка", "адрес"),
    "source_url": ("sourceurl", "source_url", "mirrorurl", "publicmirrorurl"),
}


def _normalized_key(value: str) -> str:
    return re.sub(r"[^0-9a-zа-я]+", "", _normalized(value))


def _row_value(row: dict[str, object], field: str) -> object | None:
    normalized = {_normalized_key(key): value for key, value in row.items()}
    for alias in _FIELD_ALIASES[field]:
        candidate = normalized.get(_normalized_key(alias))
        if candidate not in (None, ""):
            return candidate
    return None


def _load_json_rows(path: Path) -> list[dict[str, object]]:
    payload: object = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = next(
            (
                value
                for key in ("items", "data", "results", "recommendations", "records")
                if isinstance((value := payload.get(key)), list)
            ),
            None,
        )
        if rows is None:
            raise ValueError("Clinical catalog JSON must contain an array or a known array field.")
    else:
        raise ValueError("Clinical catalog JSON must contain an array or object.")
    result: list[dict[str, object]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"Clinical catalog row {index + 1} is not an object.")
        result.append({str(key): cast(object, value) for key, value in row.items()})
    return result


def _load_delimited_rows(path: Path) -> list[dict[str, object]]:
    text = path.read_text(encoding="utf-8-sig")
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
    reader = csv.DictReader(text.splitlines(), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("Clinical catalog table has no header row.")
    return [
        {str(key): cast(object, value) for key, value in row.items() if key is not None}
        for row in reader
    ]


def load_catalog_rows(path: Path) -> list[dict[str, object]]:
    suffix = path.suffix.lower()
    if suffix in {".json", ".jsonl"}:
        if suffix == ".jsonl":
            rows: list[dict[str, object]] = []
            for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
                if not line.strip():
                    continue
                payload: object = json.loads(line)
                if not isinstance(payload, dict):
                    raise ValueError(f"Clinical catalog JSONL line {line_number} is not an object.")
                rows.append({str(key): cast(object, value) for key, value in payload.items()})
            return rows
        return _load_json_rows(path)
    if suffix in {".csv", ".tsv", ".txt"}:
        return _load_delimited_rows(path)
    raise ValueError(f"Unsupported clinical catalog format: {path.suffix or '<none>'}")


def load_taxonomy(path: Path) -> ClinicalModuleTaxonomy:
    payload: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Clinical module taxonomy must be a YAML mapping.")
    return ClinicalModuleTaxonomy.model_validate(payload)


def load_overrides(path: Path | None) -> CoverageOverrideFile:
    if path is None:
        return CoverageOverrideFile()
    payload: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Clinical coverage overrides must be a YAML mapping.")
    return CoverageOverrideFile.model_validate(payload)


def _record_status(value: str | None) -> RecordStatus:
    normalized = _normalized(value or "")
    if any(marker in normalized for marker in ("замен", "утрат", "не примен", "supersed")):
        return "superseded"
    if any(marker in normalized for marker in ("архив", "истор", "histor")):
        return "historical"
    if any(marker in normalized for marker in ("действ", "примен", "active", "опублик")):
        return "active"
    return "unknown"


def _icd_prefix_matches(code: str, prefix: str) -> bool:
    normalized_code = re.sub(r"[^A-ZА-Я0-9]", "", code.upper())
    normalized_prefix = re.sub(r"[^A-ZА-Я0-9]", "", prefix.upper())
    return bool(normalized_prefix) and normalized_code.startswith(normalized_prefix)


def _rule_score(
    rule: ClinicalModuleRule,
    *,
    title: str,
    developer: str | None,
    icd10_codes: list[str],
    age_categories: list[str],
) -> int:
    if rule.fallback:
        return 0
    title_value = _normalized(title)
    developer_value = _normalized(developer or "")
    age_value = " ".join(_normalized(value) for value in age_categories)
    score = 0
    score += 20 * sum(_normalized(keyword) in title_value for keyword in rule.title_keywords)
    score += 8 * sum(_normalized(keyword) in developer_value for keyword in rule.developer_keywords)
    score += 30 * sum(
        _icd_prefix_matches(code, prefix)
        for code in icd10_codes
        for prefix in rule.icd10_prefixes
    )
    score += 5 * sum(_normalized(keyword) in age_value for keyword in rule.age_keywords)
    return score


def _assign_modules(
    taxonomy: ClinicalModuleTaxonomy,
    *,
    title: str,
    developer: str | None,
    icd10_codes: list[str],
    age_categories: list[str],
) -> tuple[list[ClinicalModuleRule], ClinicalModuleRule]:
    fallback = next(module for module in taxonomy.modules if module.fallback)
    scored = [
        (
            _rule_score(
                module,
                title=title,
                developer=developer,
                icd10_codes=icd10_codes,
                age_categories=age_categories,
            ),
            module,
        )
        for module in taxonomy.modules
        if not module.fallback
    ]
    matches = [module for score, module in scored if score > 0]
    matches.sort(
        key=lambda module: (
            -_rule_score(
                module,
                title=title,
                developer=developer,
                icd10_codes=icd10_codes,
                age_categories=age_categories,
            ),
            -module.priority,
            module.id,
        )
    )
    if not matches:
        return [fallback], fallback
    return matches, matches[0]


def _safe_record_id(official_id: str) -> str:
    safe = _SAFE_ID_PATTERN.sub("-", official_id).strip("-.")
    return f"kr.rf.{safe or 'unknown'}"


def _normalize_row(
    row: dict[str, object],
    taxonomy: ClinicalModuleTaxonomy,
    overrides: CoverageOverrideFile,
) -> ClinicalCatalogRecord:
    official_id = _clean(_row_value(row, "official_id"))
    title = _clean(_row_value(row, "title"))
    if official_id is None or title is None:
        raise ValueError("Every clinical catalog row requires an official id and title.")
    version_label = _clean(_row_value(row, "version_label")) or official_id
    application_status = _clean(_row_value(row, "application_status"))
    status = _record_status(application_status)
    age_categories = _split_values(_row_value(row, "age_categories"))
    icd10_codes = _split_values(_row_value(row, "icd10_codes"))
    developer = _clean(_row_value(row, "developer"))
    published_at = _clean(_row_value(row, "published_at"))
    official_url = _clean(_row_value(row, "official_url")) or (
        f"https://cr.minzdrav.gov.ru/preview-cr/{official_id}"
    )
    source_url = _clean(_row_value(row, "source_url"))
    modules, primary = _assign_modules(
        taxonomy,
        title=title,
        developer=developer,
        icd10_codes=icd10_codes,
        age_categories=age_categories,
    )
    override = overrides.records.get(official_id)
    if override?.module_ids:
        by_id = {module.id: module for module in taxonomy.modules}
        unknown = [module_id for module_id in override.module_ids if module_id not in by_id]
        if unknown:
            raise ValueError(
                f"Coverage override for {official_id} references unknown modules: {', '.join(unknown)}"
            )
        modules = [by_id[module_id] for module_id in override.module_ids]
        primary = modules[0]
    coverage_state: CoverageState = "metadata-only"
    if status == "superseded":
        coverage_state = "superseded"
    elif status == "historical":
        coverage_state = "historical"
    rights: RightsState = "unknown"
    notes: list[str] = []
    if override:
        coverage_state = override.coverage_state or coverage_state
        rights = override.rights or rights
        source_url = override.source_url or source_url
        notes.extend(override.notes)
    specialties = _deduplicate(
        specialty for module in modules for specialty in module.specialties
    )
    return ClinicalCatalogRecord(
        record_id=_safe_record_id(official_id),
        official_id=official_id,
        title=title,
        version_label=version_label,
        status=status,
        application_status=application_status,
        age_categories=age_categories,
        icd10_codes=icd10_codes,
        developer=developer,
        published_at=published_at,
        official_url=official_url,
        source_url=source_url,
        coverage_state=coverage_state,
        rights=rights,
        module_ids=[module.id for module in modules],
        primary_module_id=primary.id,
        specialties=specialties,
        notes=notes,
        raw_metadata=row,
    )


def _module_plan(
    records: list[ClinicalCatalogRecord], taxonomy: ClinicalModuleTaxonomy
) -> list[ClinicalModulePlanEntry]:
    by_module: dict[str, list[ClinicalCatalogRecord]] = defaultdict(list)
    for record in records:
        for module_id in record.module_ids:
            by_module[module_id].append(record)
    result: list[ClinicalModulePlanEntry] = []
    for rule in sorted(taxonomy.modules, key=lambda item: (-item.priority, item.id)):
        members = sorted(by_module.get(rule.id, []), key=lambda item: (item.title, item.official_id))
        if not members:
            continue
        result.append(
            ClinicalModulePlanEntry(
                module_id=rule.id,
                title=rule.title,
                priority=rule.priority,
                record_ids=[record.record_id for record in members],
                coverage_counts=dict(Counter(record.coverage_state for record in members)),
                specialties=rule.specialties,
            )
        )
    return result


def build_clinical_coverage_ledger(
    source: Path,
    taxonomy_path: Path,
    *,
    overrides_path: Path | None = None,
    generated_at: str | None = None,
) -> ClinicalCoverageLedger:
    taxonomy = load_taxonomy(taxonomy_path)
    overrides = load_overrides(overrides_path)
    rows = load_catalog_rows(source)
    records: list[ClinicalCatalogRecord] = []
    warnings: list[str] = []
    by_official_id: dict[str, ClinicalCatalogRecord] = {}
    for index, row in enumerate(rows):
        try:
            record = _normalize_row(row, taxonomy, overrides)
        except ValueError as error:
            warnings.append(f"row {index + 1}: {error}")
            continue
        previous = by_official_id.get(record.official_id)
        if previous is not None:
            if (
                _normalized(previous.title) != _normalized(record.title)
                or previous.version_label != record.version_label
            ):
                raise ValueError(
                    f"Conflicting duplicate clinical recommendation id: {record.official_id}"
                )
            warnings.append(f"duplicate row ignored: {record.official_id}")
            continue
        by_official_id[record.official_id] = record
        records.append(record)
    records.sort(key=lambda item: (item.primary_module_id, item.title, item.official_id))
    modules = _module_plan(records, taxonomy)
    summary = ClinicalCoverageSummary(
        total_records=len(records),
        coverage_counts=dict(Counter(record.coverage_state for record in records)),
        status_counts=dict(Counter(record.status for record in records)),
        module_counts={module.module_id: len(module.record_ids) for module in modules},
    )
    return ClinicalCoverageLedger(
        generated_at=generated_at or _utc_now(),
        source_checksum=_sha256_file(source),
        taxonomy_checksum=_sha256_file(taxonomy_path),
        records=records,
        modules=modules,
        summary=summary,
        warnings=warnings,
    )


def write_clinical_coverage_ledger(ledger: ClinicalCoverageLedger, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(ledger.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
