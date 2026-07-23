from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import yaml
from pydantic import Field, model_validator

from .clinical_catalog import CoverageState, RightsState, load_catalog_rows
from .models import CamelModel

MedicationStatus = Literal["active", "suspended", "withdrawn", "historical", "unknown"]

_SPACE_PATTERN = re.compile(r"\s+")
_SPLIT_PATTERN = re.compile(r"[;,|\n]+")
_SAFE_ID_PATTERN = re.compile(r"[^0-9A-Za-zА-Яа-я._-]+")


def _normalized(value: object) -> str:
    return _SPACE_PATTERN.sub(" ", str(value).replace("ё", "е").lower()).strip()


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _split(value: object | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        values = [item for nested in value for item in _split(nested)]
    else:
        cleaned = _clean(value)
        values = [] if cleaned is None else _SPLIT_PATTERN.split(cleaned)
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        item = str(raw).strip()
        key = _normalized(item)
        if item and key not in seen:
            seen.add(key)
            result.append(item)
    return result


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class MedicationModuleRule(CamelModel):
    id: str
    title: str
    atc_prefixes: list[str] = Field(default_factory=list)
    name_keywords: list[str] = Field(default_factory=list)
    priority: int = 0
    fallback: bool = False

    @model_validator(mode="after")
    def validate_rule(self) -> MedicationModuleRule:
        if not self.fallback and not (self.atc_prefixes or self.name_keywords):
            raise ValueError(f"Medication module rule {self.id} has no matchers.")
        return self


class MedicationModuleTaxonomy(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    modules: list[MedicationModuleRule]

    @model_validator(mode="after")
    def validate_modules(self) -> MedicationModuleTaxonomy:
        identifiers = [module.id for module in self.modules]
        if not identifiers:
            raise ValueError("Medication module taxonomy is empty.")
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Medication module taxonomy contains duplicate module ids.")
        if sum(module.fallback for module in self.modules) != 1:
            raise ValueError("Medication module taxonomy must contain one fallback module.")
        return self


class MedicationCoverageOverride(CamelModel):
    coverage_state: CoverageState | None = None
    rights: RightsState | None = None
    source_url: str | None = None
    module_ids: list[str] | None = None
    notes: list[str] = Field(default_factory=list)


class MedicationCoverageOverrides(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    records: dict[str, MedicationCoverageOverride] = Field(default_factory=dict)


class MedicationCatalogRecord(CamelModel):
    record_id: str
    registration_number: str
    trade_name: str
    inn: list[str]
    atc_codes: list[str]
    dosage_form: str | None = None
    strengths: list[str] = Field(default_factory=list)
    routes: list[str] = Field(default_factory=list)
    manufacturer: str | None = None
    holder: str | None = None
    status: MedicationStatus
    pediatric_use: str | None = None
    prescription_status: str | None = None
    source_edition: str | None = None
    official_url: str | None = None
    source_url: str | None = None
    coverage_state: CoverageState = "metadata-only"
    rights: RightsState = "unknown"
    module_ids: list[str]
    primary_module_id: str
    notes: list[str] = Field(default_factory=list)
    raw_metadata: dict[str, object] = Field(default_factory=dict)


class MedicationModulePlanEntry(CamelModel):
    module_id: str
    title: str
    record_ids: list[str]
    coverage_counts: dict[str, int]


class MedicationCoverageSummary(CamelModel):
    total_records: int
    coverage_counts: dict[str, int]
    status_counts: dict[str, int]
    module_counts: dict[str, int]


class MedicationCoverageLedger(CamelModel):
    schema_version: int = 1
    generated_at: str
    source_checksum: str
    taxonomy_checksum: str
    records: list[MedicationCatalogRecord]
    modules: list[MedicationModulePlanEntry]
    summary: MedicationCoverageSummary
    warnings: list[str] = Field(default_factory=list)


_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "registration_number": (
        "registrationnumber",
        "registration_number",
        "регистрационный номер",
        "номер регистрационного удостоверения",
        "ру",
    ),
    "trade_name": ("tradename", "trade_name", "торговое наименование", "наименование"),
    "inn": ("inn", "мнн", "международное непатентованное наименование"),
    "atc_codes": ("atc", "atccode", "atc_codes", "атх", "код атх"),
    "dosage_form": ("dosageform", "dosage_form", "лекарственная форма", "форма"),
    "strengths": ("strength", "strengths", "дозировка", "дозировки", "концентрация"),
    "routes": ("route", "routes", "путь введения", "пути введения"),
    "manufacturer": ("manufacturer", "производитель"),
    "holder": ("holder", "держатель", "владелец регистрационного удостоверения"),
    "status": ("status", "статус", "статус регистрации"),
    "pediatric_use": ("pediatricuse", "pediatric_use", "применение у детей"),
    "prescription_status": ("prescriptionstatus", "prescription_status", "условия отпуска"),
    "source_edition": ("sourceedition", "source_edition", "редакция", "дата обновления"),
    "official_url": ("officialurl", "official_url", "официальная ссылка", "url"),
    "source_url": ("sourceurl", "source_url", "ссылка на инструкцию", "instructionurl"),
}


def _key(value: str) -> str:
    return re.sub(r"[^0-9a-zа-я]+", "", _normalized(value))


def _value(row: dict[str, object], field: str) -> object | None:
    normalized = {_key(name): value for name, value in row.items()}
    for alias in _FIELD_ALIASES[field]:
        candidate = normalized.get(_key(alias))
        if candidate not in (None, ""):
            return candidate
    return None


def _status(value: str | None) -> MedicationStatus:
    normalized = _normalized(value or "")
    if any(marker in normalized for marker in ("приостанов", "suspend")):
        return "suspended"
    if any(marker in normalized for marker in ("отмен", "аннулир", "withdraw")):
        return "withdrawn"
    if any(marker in normalized for marker in ("архив", "истор", "histor")):
        return "historical"
    if any(marker in normalized for marker in ("действ", "active", "зарегистр")):
        return "active"
    return "unknown"


def load_medication_taxonomy(path: Path) -> MedicationModuleTaxonomy:
    payload: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Medication module taxonomy must be a YAML mapping.")
    return MedicationModuleTaxonomy.model_validate(payload)


def load_medication_overrides(path: Path | None) -> MedicationCoverageOverrides:
    if path is None:
        return MedicationCoverageOverrides()
    payload: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Medication coverage overrides must be a YAML mapping.")
    return MedicationCoverageOverrides.model_validate(payload)


def _score(rule: MedicationModuleRule, names: str, atc_codes: list[str]) -> int:
    if rule.fallback:
        return 0
    score = 30 * sum(
        code.upper().replace(".", "").startswith(prefix.upper().replace(".", ""))
        for code in atc_codes
        for prefix in rule.atc_prefixes
    )
    score += 10 * sum(_normalized(keyword) in names for keyword in rule.name_keywords)
    return score


def _assign_modules(
    taxonomy: MedicationModuleTaxonomy,
    *,
    trade_name: str,
    inn: list[str],
    atc_codes: list[str],
) -> tuple[list[MedicationModuleRule], MedicationModuleRule]:
    fallback = next(module for module in taxonomy.modules if module.fallback)
    names = _normalized(" ".join([trade_name, *inn]))
    scored = [
        (_score(module, names, atc_codes), module)
        for module in taxonomy.modules
        if not module.fallback
    ]
    matches = [pair for pair in scored if pair[0] > 0]
    matches.sort(key=lambda pair: (-pair[0], -pair[1].priority, pair[1].id))
    if not matches:
        return [fallback], fallback
    modules = [module for _score_value, module in matches]
    return modules, modules[0]


def _record_id(registration_number: str) -> str:
    safe = _SAFE_ID_PATTERN.sub("-", registration_number).strip("-.")
    return f"drug.ru.{safe or 'unknown'}"


def _normalize_record(
    row: dict[str, object],
    taxonomy: MedicationModuleTaxonomy,
    overrides: MedicationCoverageOverrides,
) -> MedicationCatalogRecord:
    registration_number = _clean(_value(row, "registration_number"))
    trade_name = _clean(_value(row, "trade_name"))
    if registration_number is None or trade_name is None:
        raise ValueError("Every medication record requires a registration number and trade name.")
    inn = _split(_value(row, "inn"))
    atc_codes = _split(_value(row, "atc_codes"))
    modules, primary = _assign_modules(
        taxonomy,
        trade_name=trade_name,
        inn=inn,
        atc_codes=atc_codes,
    )
    override = overrides.records.get(registration_number)
    if override is not None and override.module_ids:
        by_id = {module.id: module for module in taxonomy.modules}
        unknown = [module_id for module_id in override.module_ids if module_id not in by_id]
        if unknown:
            raise ValueError(
                f"Medication override for {registration_number} references unknown modules: "
                f"{', '.join(unknown)}"
            )
        modules = [by_id[module_id] for module_id in override.module_ids]
        primary = modules[0]
    status = _status(_clean(_value(row, "status")))
    coverage_state: CoverageState = "metadata-only"
    if status in {"withdrawn", "historical"}:
        coverage_state = "historical"
    rights: RightsState = "unknown"
    source_url = _clean(_value(row, "source_url"))
    notes: list[str] = []
    if override is not None:
        coverage_state = override.coverage_state or coverage_state
        rights = override.rights or rights
        source_url = override.source_url or source_url
        notes.extend(override.notes)
    return MedicationCatalogRecord(
        record_id=_record_id(registration_number),
        registration_number=registration_number,
        trade_name=trade_name,
        inn=inn,
        atc_codes=atc_codes,
        dosage_form=_clean(_value(row, "dosage_form")),
        strengths=_split(_value(row, "strengths")),
        routes=_split(_value(row, "routes")),
        manufacturer=_clean(_value(row, "manufacturer")),
        holder=_clean(_value(row, "holder")),
        status=status,
        pediatric_use=_clean(_value(row, "pediatric_use")),
        prescription_status=_clean(_value(row, "prescription_status")),
        source_edition=_clean(_value(row, "source_edition")),
        official_url=_clean(_value(row, "official_url")),
        source_url=source_url,
        coverage_state=coverage_state,
        rights=rights,
        module_ids=[module.id for module in modules],
        primary_module_id=primary.id,
        notes=notes,
        raw_metadata=row,
    )


def build_medication_coverage_ledger(
    source: Path,
    taxonomy_path: Path,
    *,
    overrides_path: Path | None = None,
    generated_at: str | None = None,
) -> MedicationCoverageLedger:
    taxonomy = load_medication_taxonomy(taxonomy_path)
    overrides = load_medication_overrides(overrides_path)
    records: list[MedicationCatalogRecord] = []
    warnings: list[str] = []
    by_registration: dict[str, MedicationCatalogRecord] = {}
    for index, row in enumerate(load_catalog_rows(source)):
        try:
            record = _normalize_record(row, taxonomy, overrides)
        except ValueError as error:
            warnings.append(f"row {index + 1}: {error}")
            continue
        previous = by_registration.get(record.registration_number)
        if previous is not None:
            if (
                _normalized(previous.trade_name) != _normalized(record.trade_name)
                or previous.source_edition != record.source_edition
            ):
                raise ValueError(
                    f"Conflicting duplicate medication registration: {record.registration_number}"
                )
            warnings.append(f"duplicate row ignored: {record.registration_number}")
            continue
        by_registration[record.registration_number] = record
        records.append(record)
    records.sort(key=lambda item: (item.primary_module_id, item.inn, item.trade_name))
    grouped: dict[str, list[MedicationCatalogRecord]] = defaultdict(list)
    for record in records:
        for module_id in record.module_ids:
            grouped[module_id].append(record)
    modules: list[MedicationModulePlanEntry] = []
    for rule in sorted(taxonomy.modules, key=lambda item: (-item.priority, item.id)):
        members = grouped.get(rule.id, [])
        if not members:
            continue
        modules.append(
            MedicationModulePlanEntry(
                module_id=rule.id,
                title=rule.title,
                record_ids=[record.record_id for record in members],
                coverage_counts=dict(Counter(record.coverage_state for record in members)),
            )
        )
    summary = MedicationCoverageSummary(
        total_records=len(records),
        coverage_counts=dict(Counter(record.coverage_state for record in records)),
        status_counts=dict(Counter(record.status for record in records)),
        module_counts={module.module_id: len(module.record_ids) for module in modules},
    )
    return MedicationCoverageLedger(
        generated_at=generated_at or _utc_now(),
        source_checksum=_sha256_file(source),
        taxonomy_checksum=_sha256_file(taxonomy_path),
        records=records,
        modules=modules,
        summary=summary,
        warnings=warnings,
    )


def write_medication_coverage_ledger(ledger: MedicationCoverageLedger, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(ledger.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
