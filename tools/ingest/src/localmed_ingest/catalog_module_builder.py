from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

CatalogFamily = Literal["clinical", "medication", "legal"]
PointerFamily = CatalogFamily | Literal["reference"]

_SAFE_STEM_PATTERN = re.compile(r"[^0-9A-Za-zА-Яа-я._-]+")
_SPACE_PATTERN = re.compile(r"\s+")
_MAX_FILENAME_BYTES = 255
_MARKDOWN_FILENAME_SUFFIX = ".md"
CORE_POINTER_ID_PREFIX = "core.catalog.pointer"


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True, extra="forbid")


class CatalogModuleBuild(CamelModel):
    module_id: str
    title: str
    directory: str
    record_count: int = Field(ge=1)
    document_ids: list[str]
    coverage_counts: dict[str, int]


class CatalogModuleBuildReport(CamelModel):
    schema_version: int = 1
    family: PointerFamily
    version: str
    built_at: str
    source_ledger_checksum: str
    modules: list[CatalogModuleBuild]
    total_documents: int
    warnings: list[str] = Field(default_factory=list)


class CoreCatalogRelationStub(CamelModel):
    predicate: str
    target_id: str
    weight: float = Field(ge=0, le=1)


class CoreCatalogTopicStub(CamelModel):
    """Python projection of the shared CoreCatalogTopicStub contract."""

    id: str
    entity_type: Literal["disease", "medication", "regulation", "reference"]
    title: str
    summary: str
    aliases: list[str] = Field(default_factory=list)
    module_ids: list[str] = Field(min_length=1)
    relations: list[CoreCatalogRelationStub] = Field(
        default_factory=lambda: list[CoreCatalogRelationStub]()
    )


class LedgerModule(CamelModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        extra="allow",
    )
    module_id: str
    title: str
    record_ids: list[str]
    coverage_counts: dict[str, int] = Field(default_factory=dict)


class CoverageLedgerEnvelope(CamelModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        extra="allow",
    )
    schema_version: int = Field(ge=1)
    records: list[dict[str, object]]
    modules: list[LedgerModule]

    @model_validator(mode="after")
    def validate_records(self) -> CoverageLedgerEnvelope:
        record_ids = [str(record.get("recordId", "")) for record in self.records]
        if any(not record_id for record_id in record_ids):
            raise ValueError("Every coverage-ledger record requires recordId.")
        if len(record_ids) != len(set(record_ids)):
            raise ValueError("Coverage ledger contains duplicate recordId values.")
        known = set(record_ids)
        module_ids = [module.module_id for module in self.modules]
        if len(module_ids) != len(set(module_ids)):
            raise ValueError("Coverage ledger contains duplicate moduleId values.")
        module_records = {module.module_id: set(module.record_ids) for module in self.modules}
        for module in self.modules:
            if len(module.record_ids) != len(set(module.record_ids)):
                raise ValueError(f"Module {module.module_id} contains duplicate record references.")
            missing = [record_id for record_id in module.record_ids if record_id not in known]
            if missing:
                raise ValueError(
                    f"Module {module.module_id} references unknown records: {', '.join(missing)}"
                )
        for record, record_id in zip(self.records, record_ids, strict=True):
            primary_value = record.get("primaryModuleId")
            primary = primary_value.strip() if isinstance(primary_value, str) else ""
            if not primary:
                raise ValueError(f"Coverage-ledger record {record_id} requires primaryModuleId.")
            if primary not in module_records:
                raise ValueError(f"Record {record_id} references unknown primary module {primary}.")
            if record_id not in module_records[primary]:
                raise ValueError(f"Primary module {primary} does not include record {record_id}.")
        return self


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_stem(value: str) -> str:
    return _SAFE_STEM_PATTERN.sub("-", value).strip("-.") or "record"


def _bounded_filename_stem(value: str) -> str:
    stem = _safe_stem(value)
    max_stem_bytes = _MAX_FILENAME_BYTES - len(_MARKDOWN_FILENAME_SUFFIX.encode("utf-8"))
    if len(stem.encode("utf-8")) <= max_stem_bytes:
        return stem

    suffix = f"-{hashlib.sha256(value.encode('utf-8')).hexdigest()}"
    prefix_budget = max_stem_bytes - len(suffix.encode("utf-8"))
    prefix = stem.encode("utf-8")[:prefix_budget].decode("utf-8", errors="ignore").rstrip("-")
    return f"{prefix}{suffix}" if prefix else f"record{suffix}"


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _list(value: object | None) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in cast(list[object], value):
        cleaned = _clean(item)
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def _sha256_bytes(payload: bytes) -> str:
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _canonical_checksum(record: dict[str, object]) -> str:
    payload = json.dumps(
        record,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return _sha256_bytes(payload)


def _load_ledger(path: Path) -> CoverageLedgerEnvelope:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Coverage ledger must be a JSON object.")
    return CoverageLedgerEnvelope.model_validate(payload)


def _module_manifest(module: LedgerModule, version: str, built_at: str) -> dict[str, object]:
    return {
        "id": module.module_id,
        "version": version,
        "schemaVersion": 2,
        "title": module.title,
        "builtAt": built_at,
    }


def _front_matter(
    *,
    document_id: str,
    title: str,
    short_title: str | None,
    version_label: str,
    source_type: str,
    status: str,
    specialties: list[str],
    source_url: str | None,
    source_checksum: str,
    metadata: dict[str, object],
) -> str:
    payload: dict[str, object] = {
        "id": document_id,
        "title": title,
        "short_title": short_title,
        "version_label": version_label,
        "source_type": source_type,
        "status": status,
        "specialties": specialties,
        "source_file": source_url,
        "source_checksum": source_checksum,
        "synthetic_fixture": False,
        "metadata": metadata,
    }
    compact = {key: value for key, value in payload.items() if value not in (None, [], {})}
    return yaml.safe_dump(
        compact,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).rstrip()


def _source_marker(record_id: str, field: str) -> str:
    payload = json.dumps(
        {"recordId": record_id, "field": field, "kind": "catalog-metadata"},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"<!-- localmed:source {payload} -->"


def _format_values(values: list[str]) -> str:
    return ", ".join(values) if values else "не указано в каталоге"


def _reference_display_title(document: _ReferenceSourceDocument) -> str:
    title = document.title
    code = document.mkb_code or (document.icd10_codes[0] if document.icd10_codes else None)
    if code:
        title = re.sub(rf"^{re.escape(code)}\s*", "", title)
    return re.sub(r"\s*,\s*МКБ-10\s*$", "", title).strip() or document.title


def _object_list(value: object | None) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [cast(dict[str, object], item) for item in items if isinstance(item, dict)]


def _object_value(value: object | None) -> dict[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    mapping = cast(Mapping[object, object], value)
    return {str(key): item for key, item in mapping.items()}


def _text_values(value: object | None) -> list[str]:
    if isinstance(value, list):
        return _list(cast(list[object], value))
    cleaned = _clean(value)
    return [cleaned] if cleaned else []


def _unique_texts(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _display_value(value: object | None) -> str:
    if isinstance(value, bool):
        return "Да" if value else "Нет"
    return _clean(value) or "не указано в каталоге"


def _clinical_document(record: dict[str, object]) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = cast(str, record["recordId"])
    official_id = _clean(record.get("officialId")) or record_id
    title = _clean(record.get("title")) or official_id
    version = _clean(record.get("versionLabel")) or official_id
    status = _clean(record.get("status")) or "unknown"
    source_url = _clean(record.get("sourceUrl")) or _clean(record.get("officialUrl"))
    coverage = _clean(record.get("coverageState")) or "metadata-only"
    rights = _clean(record.get("rights")) or "unknown"
    icd_codes = _list(record.get("icd10Codes"))
    age_categories = _list(record.get("ageCategories"))
    specialties = _list(record.get("specialties")) or ["general-medicine"]
    developer = _clean(record.get("developer"))
    application_status = _clean(record.get("applicationStatus"))
    notes = _list(record.get("notes"))
    metadata: dict[str, object] = {
        "catalogFamily": "clinical",
        "coverageState": coverage,
        "rights": rights,
        "officialId": official_id,
        "officialUrl": _clean(record.get("officialUrl")),
        "sourceUrl": source_url,
        "applicationStatus": application_status,
        "icd10Codes": icd_codes,
        "ageCategories": age_categories,
        "developer": developer,
        "moduleIds": _list(record.get("moduleIds")),
        "primaryModuleId": _clean(record.get("primaryModuleId")),
        "notes": notes,
        "contentMode": "catalog-metadata",
        "fullTextAvailable": coverage == "published",
    }
    body = [
        "# Сведения о рекомендации",
        "",
        _source_marker(record_id, "identity"),
        (
            f"Клиническая рекомендация «{title}» зарегистрирована в каталоге "
            f"под идентификатором {official_id}. Редакция: {version}. "
            f"Статус применения: {application_status or status}."
        ),
        "",
        "# Применимость и классификация",
        "",
        _source_marker(record_id, "classification"),
        (
            f"Коды МКБ-10: {_format_values(icd_codes)}. "
            f"Возрастные категории: {_format_values(age_categories)}. "
            f"Разработчик: {developer or 'не указан в каталоге'}."
        ),
        "",
        "# Доступность источника",
        "",
        _source_marker(record_id, "coverage"),
        (
            f"Состояние покрытия MiniMed: {coverage}. "
            f"Права на распространение: {rights}. Полный текст не считается "
            "установленным, пока запись не имеет состояния published и не прошла "
            "проверку модуля."
        ),
    ]
    if source_url:
        body.extend(["", f"Первоисточник или объявленный источник: {source_url}"])
    if notes:
        body.extend(["", "# Примечания покрытия", "", *[f"- {note}" for note in notes]])
    front = _front_matter(
        document_id=record_id,
        title=title,
        short_title=None,
        version_label=version,
        source_type="clinical_recommendation_catalog_record",
        status=status,
        specialties=specialties,
        source_url=source_url,
        source_checksum=_canonical_checksum(record),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(record_id)}.title",
            "canonicalTerm": title,
            "alias": title,
            "category": "clinical-recommendation",
            "weight": 1.0,
        }
    ]
    return record_id, front, "\n".join(body).rstrip() + "\n", aliases


def _esklp_document(record: dict[str, object]) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = cast(str, record["recordId"])
    standardized_inn = _clean(record.get("standardizedInn")) or record_id
    inn = _list(record.get("inn"))
    component_inns = _list(record.get("componentInns"))
    atc = _list(record.get("atcCodes"))
    dosage_forms = _list(record.get("dosageForms"))
    strengths = _list(record.get("strengths"))
    smnn_nodes = _object_list(record.get("smnnNodes"))
    status = _clean(record.get("status")) or "unknown"
    edition = _clean(record.get("sourceEdition")) or record_id
    source_url = _clean(record.get("sourceUrl"))
    official_url = _clean(record.get("officialUrl"))
    source_archive = _clean(record.get("sourceArchive"))
    coverage = _clean(record.get("coverageState")) or "metadata-only"
    rights = _clean(record.get("rights")) or "unknown"

    node_data: list[
        tuple[str, list[dict[str, object]], list[dict[str, object]], list[str], list[str]]
    ] = []
    all_forms = list(dosage_forms)
    all_strengths = list(strengths)
    for node in smnn_nodes:
        smnn_code = _clean(node.get("smnnCode")) or standardized_inn
        trade_names = _object_list(node.get("tradeNames"))
        klp_positions = _object_list(node.get("klpPositions"))
        node_forms = _text_values(node.get("dosageForms")) + _text_values(node.get("dosageForm"))
        node_strengths = _text_values(node.get("strengths")) + _text_values(node.get("strength"))
        all_forms.extend(node_forms)
        all_strengths.extend(node_strengths)
        for child in [*trade_names, *klp_positions]:
            all_forms.extend(_text_values(child.get("dosageForm")))
            all_strengths.extend(_text_values(child.get("strength")))
        node_data.append((smnn_code, trade_names, klp_positions, node_forms, node_strengths))
    all_forms = _unique_texts(all_forms)
    all_strengths = _unique_texts(all_strengths)

    metadata: dict[str, object] = {
        "catalogFamily": "medication",
        "recordKind": "esklp-mnn",
        "coverageState": coverage,
        "rights": rights,
        "standardizedInn": standardized_inn,
        "inn": inn,
        "componentInns": component_inns,
        "atcCodes": atc,
        "dosageForms": dosage_forms,
        "strengths": strengths,
        "smnnNodes": smnn_nodes,
        "sourceEdition": edition,
        "sourceUrl": source_url,
        "officialUrl": official_url,
        "sourceArchive": source_archive,
        "status": status,
        "moduleIds": _list(record.get("moduleIds")),
        "primaryModuleId": _clean(record.get("primaryModuleId")),
        "contentMode": "esklp-mnn",
        "trustedDoseData": False,
    }
    body = [
        "# Сведения о стандартизированном МНН",
        "",
        _source_marker(record_id, "identity"),
        (
            f"Стандартизированное МНН: {standardized_inn}. МНН записи: {_format_values(inn)}. "
            f"Статус записи ЕСКЛП: {status}."
        ),
        "",
        "# Формы и дозировки",
        "",
        _source_marker(record_id, "classification"),
        f"МНН: {standardized_inn}. Лекарственные формы: {_format_values(all_forms)}.",
        "",
        f"Доступные дозировки/концентрации: {_format_values(all_strengths)}.",
        "",
        f"АТХ: {_format_values(atc)}.",
    ]
    if component_inns:
        body.extend(
            [
                "",
                "# Компонентные МНН",
                "",
                _source_marker(record_id, "components"),
                f"Компонентные МНН: {_format_values(component_inns)}.",
            ]
        )

    trade_lines: list[str] = []
    klp_lines: list[str] = []
    smnn_lines: list[str] = []
    aliases_terms = [standardized_inn, *inn, *component_inns]
    for dosage_form in all_forms:
        aliases_terms.append(f"{standardized_inn} {dosage_form}")
    for smnn_code, trade_names, klp_positions, node_forms, node_strengths in node_data:
        forms_for_node = _unique_texts(node_forms)
        strengths_for_node = _unique_texts(node_strengths)
        presentation_forms = list(forms_for_node)
        presentation_strengths = list(strengths_for_node)
        for child in [*trade_names, *klp_positions]:
            presentation_forms.extend(_text_values(child.get("dosageForm")))
            presentation_strengths.extend(_text_values(child.get("strength")))
        smnn_lines.append(
            f"- СМНН: {standardized_inn}; smnnCode: {smnn_code}. Формы: "
            f"{_format_values(_unique_texts(presentation_forms))}. "
            f"Дозировки/концентрации: {_format_values(_unique_texts(presentation_strengths))}."
        )
        for trade in trade_names:
            trade_name = _clean(trade.get("tradeName"))
            if not trade_name:
                continue
            aliases_terms.append(trade_name)
            registration = _clean(trade.get("registrationNumber"))
            trade_forms = _text_values(trade.get("dosageForm")) or forms_for_node
            trade_strengths = _text_values(trade.get("strength")) or strengths_for_node
            normalized_inns = _text_values(trade.get("normalizedInns"))
            normalized_forms_strengths = _text_values(trade.get("normalizedFormsStrengths"))
            aliases_terms.extend(normalized_inns)
            for dosage_form in trade_forms:
                aliases_terms.append(f"{trade_name} {dosage_form}")
            unit = _clean(trade.get("unit"))
            trade_lines.append(
                f"- ТН: {trade_name}. Регистрация: {registration or 'не указана в каталоге'}. "
                f"СМНН: {standardized_inn}; smnnCode: {smnn_code}. "
                f"Лекарственная форма: {_format_values(trade_forms)}. "
                f"Дозировка/концентрация: {_format_values(trade_strengths)}. "
                f"Единица: {_display_value(unit)}. Нормализованные МНН: "
                f"{_format_values(normalized_inns)}. "
                f"Нормализованные формы/дозировки: {_format_values(normalized_forms_strengths)}."
            )

        for klp in klp_positions:
            klp_registration = _clean(klp.get("registrationNumber"))
            klp_trade_name = _clean(klp.get("tradeName"))
            if not klp_trade_name and klp_registration:
                klp_trade_name = next(
                    (
                        _clean(trade.get("tradeName"))
                        for trade in trade_names
                        if _clean(trade.get("registrationNumber")) == klp_registration
                    ),
                    None,
                )
            if klp_trade_name:
                aliases_terms.append(klp_trade_name)
            klp_forms = _text_values(klp.get("dosageForm")) or forms_for_node
            klp_strengths = _text_values(klp.get("strength")) or strengths_for_node
            for dosage_form in klp_forms:
                if klp_trade_name:
                    aliases_terms.append(f"{klp_trade_name} {dosage_form}")
            klp_lines.append(
                f"- КЛП: {_display_value(klp.get('klpCode'))}. ТН: "
                f"{klp_trade_name or 'не указано в каталоге'}. Регистрация: "
                f"{klp_registration or 'не указана в каталоге'}. СМНН: {standardized_inn}; "
                f"smnnCode: {smnn_code}. Лекарственная форма: "
                f"{_format_values(klp_forms)}. Дозировка/концентрация: "
                f"{_format_values(klp_strengths)}. Единица: "
                f"{_display_value(klp.get('unit'))}. "
                f"Количество единиц: {_display_value(klp.get('unitCount'))}. "
                f"Первичная упаковка: {_display_value(klp.get('primaryPackage'))}. "
                f"Вторичная упаковка: {_display_value(klp.get('secondaryPackage'))}. "
                f"Содержимое упаковки: {_display_value(klp.get('packageContents'))}. "
                f"Держатель регистрации: {_display_value(klp.get('holder'))}. "
                f"Производитель: {_display_value(klp.get('manufacturer'))}. "
                f"Жизненно необходимый препарат: {_display_value(klp.get('essentialDrug'))}. "
                f"Период действия: {_display_value(klp.get('validityPeriod'))}. "
                f"Цена: {_display_value(klp.get('price'))}."
            )

    if smnn_lines:
        body.extend(["", *smnn_lines])
    body.extend(
        [
            "",
            "# Торговые наименования",
            "",
            "<details>",
            "<summary>Торговые наименования</summary>",
            "",
            *trade_lines,
        ]
    )
    if klp_lines:
        body.extend(["", *klp_lines])
    if not trade_lines and not klp_lines:
        body.append("Торговые наименования и позиции КЛП не указаны в каталоге.")
    body.extend(
        [
            "",
            "</details>",
            "",
            "# Ограничения данных",
            "",
            _source_marker(record_id, "coverage"),
            (
                "Доступны только регистрационные сведения ЕСКЛП. Они не подтверждают дозы, "
                "показания, "
                "противопоказания, взаимодействия, эквивалентность или пути введения. "
                "Клинические сведения должны быть подтверждены отдельным проверенным источником."
            ),
        ]
    )
    if source_url:
        body.extend(["", f"Источник: ЕСКЛП — {source_url}"])
    else:
        body.extend(["", "Источник: ЕСКЛП."])
    if official_url and official_url != source_url:
        body.extend(["", f"Официальная страница записи: {official_url}"])

    front = _front_matter(
        document_id=record_id,
        title=standardized_inn,
        short_title=standardized_inn,
        version_label=edition,
        source_type="official_registry_summary",
        status=status,
        specialties=["pharmacology"],
        source_url=source_url or official_url,
        source_checksum=_canonical_checksum(record),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(record_id)}.{index}",
            "canonicalTerm": standardized_inn,
            "alias": alias,
            "category": "medication",
            "weight": 1.0,
        }
        for index, alias in enumerate(_unique_texts(aliases_terms), start=1)
    ]
    return record_id, front, "\n".join(body).rstrip() + "\n", aliases


def _core_pointer_id(target_document_id: str, family: str) -> str:
    suffix = hashlib.sha256(target_document_id.encode("utf-8")).hexdigest()[:16]
    return f"{CORE_POINTER_ID_PREFIX}.{family}.{_safe_stem(target_document_id)}-{suffix}"


_REFERENCE_SOURCE_TYPES = frozenset(
    {"medical_reference", "rls_mkb_reference", "krasotaimedicina_reference"}
)
_REFERENCE_ENTITY_TYPES = frozenset({"condition", "disease", "reference", "symptom", "syndrome"})
_REFERENCE_SCHEMA = {
    "documents": frozenset(
        {
            "id",
            "title",
            "short_title",
            "source_type",
            "status",
            "specialty_json",
            "metadata_json",
            "current_version_id",
        }
    ),
    "document_versions": frozenset(
        {"id", "document_id", "version_label", "source_checksum", "extracted_at"}
    ),
    "sections": frozenset({"id", "document_version_id", "title", "order_index"}),
    "chunks": frozenset(
        {"id", "document_version_id", "section_id", "order_index", "original_text", "anchor"}
    ),
    "aliases": frozenset({"id", "canonical_term", "alias", "category", "weight"}),
}


@dataclass(frozen=True)
class _ReferenceDefinition:
    text: str
    section_id: str
    section_title: str
    chunk_id: str
    anchor: str


@dataclass(frozen=True)
class _ReferenceClassificationNode:
    code: str
    title: str
    source_url: str
    source_document_id: str
    source_document_version_id: str
    source_checksum: str
    source_chunk_id: str
    source_anchor: str


@dataclass(frozen=True)
class _ReferenceSourceDocument:
    document_id: str
    title: str
    short_title: str | None
    source_type: str
    status: str
    specialties: tuple[str, ...]
    version_id: str
    version_label: str
    source_checksum: str
    extracted_at: str
    source_kind: str
    entity_type: str
    mkb_code: str | None
    icd10_codes: tuple[str, ...]
    source_url: str
    official_source_url: str | None
    publisher: str | None
    rights_status: str | None
    requires_review: bool | None
    definition: _ReferenceDefinition | None
    classification_path: tuple[_ReferenceClassificationNode, ...]


@dataclass(frozen=True)
class _ReferenceSourceAlias:
    alias_id: str
    canonical_term: str
    alias: str
    category: str | None
    weight: float


def _required_reference_text(value: object, field: str, context: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{context} {field} must be a string.")
    cleaned = _clean(value)
    if cleaned is None:
        raise ValueError(f"{context} {field} must not be blank.")
    return cleaned


def _optional_reference_text(value: object, field: str, context: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{context} {field} must be a string when present.")
    return _clean(value)


def _reference_json_strings(value: object, field: str, context: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ValueError(f"{context} {field} must be a JSON array of strings.")
    result: list[str] = []
    for item in cast(list[object], value):
        result.append(_required_reference_text(item, field, context))
    return tuple(_unique_texts(result))


def _reference_metadata_object(value: object, document_id: str) -> dict[str, object]:
    context = f"Reference document {document_id}"
    if not isinstance(value, str):
        raise ValueError(f"{context} metadata_json must be a JSON object.")
    try:
        payload: object = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError(f"{context} metadata_json is invalid JSON.") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{context} metadata_json must be a JSON object.")
    mapping = cast(Mapping[object, object], payload)
    return {str(key): item for key, item in mapping.items()}


def _reference_metadata_text(
    metadata: Mapping[str, object], field: str, document_id: str
) -> str | None:
    return _optional_reference_text(
        metadata.get(field),
        field,
        f"Reference document {document_id} metadata",
    )


def _reference_entity_type(
    source_type: str,
    title: str,
    mkb_code: str | None,
    icd10_codes: tuple[str, ...],
    declared: str | None,
    document_id: str,
) -> str:
    if declared is not None:
        if declared not in _REFERENCE_ENTITY_TYPES:
            raise ValueError(f"Reference document {document_id} has invalid entityType.")
        return declared
    if source_type == "medical_reference":
        return "reference"
    if re.search(r"\bсиндром\b", title, re.IGNORECASE):
        return "syndrome"
    for code in (mkb_code, *icd10_codes):
        if code is None:
            continue
        prefix = code[:1].upper()
        if prefix == "R":
            return "symptom"
        if prefix in "STVWXYZ":
            return "condition"
    return "disease"


def _reference_key(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value).strip().casefold()


def _reference_source_keys(record: _ReferenceSourceDocument) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            _reference_key(value)
            for value in (record.title, record.short_title, record.mkb_code, *record.icd10_codes)
            if value
        )
    )


def _reference_table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table}")')}


def _reference_definition_text(value: object, context: str) -> str:
    text = _required_reference_text(value, "original_text", context)
    text = re.sub(r"\[([^\]]+)]\([^)]+\)", r"\1", text)
    return _SPACE_PATTERN.sub(" ", text.replace("**", "")).strip()


_REFERENCE_CLASSIFICATION_TITLE_PATTERN = re.compile(
    r"^(?P<code>[A-Za-zА-Яа-яЁё]\d{2}(?:\.\d)?(?:-[A-Za-zА-Яа-яЁё]?\d{2}(?:\.\d)?)?)\s+(?P<title>.+)$"
)
_REFERENCE_CLASSIFICATION_SOURCE_PATTERN = re.compile(r"Источник:\s*(\S+)")


def _reference_classification_nodes(
    connection: sqlite3.Connection,
) -> dict[str, _ReferenceClassificationNode]:
    nodes: dict[str, _ReferenceClassificationNode] = {}
    for row in connection.execute(
        """SELECT d.id AS document_id, v.id AS version_id, v.source_checksum,
                  s.title, c.id AS chunk_id, c.original_text, c.anchor
           FROM documents AS d
           JOIN document_versions AS v ON v.id = d.current_version_id
           JOIN sections AS s ON s.document_version_id = v.id
           JOIN chunks AS c ON c.section_id = s.id
           WHERE d.source_type = 'medical_reference'
             AND (d.id = 'rls.mkb.classification'
                  OR json_extract(d.metadata_json, '$.coverage') = 'full-index')
           ORDER BY d.id, s.order_index, c.order_index"""
    ):
        section_title = _clean(str(row["title"]))
        if section_title is None:
            continue
        match = _REFERENCE_CLASSIFICATION_TITLE_PATTERN.match(section_title)
        if match is None:
            continue
        source_text = _required_reference_text(
            row["original_text"], "original_text", "Reference classification chunk"
        )
        source_match = _REFERENCE_CLASSIFICATION_SOURCE_PATTERN.search(source_text)
        if source_match is None:
            continue
        code = match.group("code")
        code_key = _reference_key(code)
        if code_key in nodes:
            continue
        document_id = _required_reference_text(
            row["document_id"], "id", "Reference classification document"
        )
        nodes[code_key] = _ReferenceClassificationNode(
            code=code,
            title=match.group("title").strip(),
            source_url=_required_reference_text(
                source_match.group(1), "sourceUrl", f"Reference classification {code}"
            ),
            source_document_id=document_id,
            source_document_version_id=_required_reference_text(
                row["version_id"], "id", f"Reference classification {code} version"
            ),
            source_checksum=_required_reference_text(
                row["source_checksum"],
                "source_checksum",
                f"Reference classification {code} version",
            ),
            source_chunk_id=_required_reference_text(
                row["chunk_id"], "id", f"Reference classification {code} chunk"
            ),
            source_anchor=_required_reference_text(
                row["anchor"], "anchor", f"Reference classification {code} chunk"
            ),
        )
    return nodes


def _reference_classification_parent_code(code: str) -> str | None:
    if "." not in code:
        return None
    return code.rsplit(".", 1)[0]


def _reference_classification_range(code: str) -> tuple[str, int, int] | None:
    parts = code.split("-", 1)
    if len(parts) != 2:
        return None
    first, second = parts
    first_match = re.fullmatch(r"([A-Za-zА-Яа-яЁё])(\d{2})", first)
    second_match = re.fullmatch(r"([A-Za-zА-Яа-яЁё]?)(\d{2})", second)
    if first_match is None or second_match is None:
        return None
    second_letter = second_match.group(1) or first_match.group(1)
    if _reference_key(second_letter) != _reference_key(first_match.group(1)):
        return None
    return first_match.group(1), int(first_match.group(2)), int(second_match.group(2))


def _reference_classification_path(
    code: str | None,
    nodes: Mapping[str, _ReferenceClassificationNode],
) -> tuple[_ReferenceClassificationNode, ...]:
    if code is None:
        return ()
    normalized_code = _reference_key(code).upper()
    path: list[_ReferenceClassificationNode] = []
    parent_code = _reference_classification_parent_code(normalized_code)
    if parent_code is not None:
        parent = nodes.get(_reference_key(parent_code))
        if parent is not None:
            path.append(parent)
        range_target = parent_code
    else:
        range_target = normalized_code
    target_match = re.fullmatch(r"([A-Za-zА-Яа-яЁё])(\d{2})", range_target)
    if target_match is None:
        return tuple(path)
    target_letter = target_match.group(1)
    target_number = int(target_match.group(2))
    candidates: list[tuple[int, str, _ReferenceClassificationNode]] = []
    for node in nodes.values():
        bounds = _reference_classification_range(node.code)
        if bounds is None:
            continue
        letter, start, end = bounds
        if (
            _reference_key(letter) == _reference_key(target_letter)
            and start <= target_number <= end
            and _reference_key(node.code) != _reference_key(normalized_code)
        ):
            candidates.append((end - start, node.code, node))
    if candidates:
        path.append(min(candidates, key=lambda item: (item[0], item[1]))[2])
    return tuple(path)


def _read_reference_database(
    source_sqlite: Path,
) -> tuple[list[_ReferenceSourceDocument], list[_ReferenceSourceAlias]]:
    source = source_sqlite.resolve()
    if not source.is_file():
        raise ValueError(f"Reference SQLite source is not a file: {source}")
    try:
        connection = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    except sqlite3.DatabaseError as error:
        raise ValueError(f"Reference SQLite source is not a valid database: {source}") from error
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        integrity = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
        if integrity != ["ok"]:
            raise ValueError(f"Reference SQLite source failed integrity check: {integrity[:5]}")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Reference SQLite source failed foreign-key check.")
        tables = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        missing_tables = sorted(set(_REFERENCE_SCHEMA) - tables)
        if missing_tables:
            raise ValueError(f"Reference SQLite source lacks tables: {missing_tables}")
        for table, required_columns in _REFERENCE_SCHEMA.items():
            missing_columns = sorted(required_columns - _reference_table_columns(connection, table))
            if missing_columns:
                raise ValueError(f"Reference SQLite source table {table} lacks: {missing_columns}")

        classification_nodes = _reference_classification_nodes(connection)
        definitions: dict[str, _ReferenceDefinition] = {}
        for row in connection.execute(
            """SELECT d.id AS document_id, s.id AS section_id, s.title AS section_title,
                      c.id AS chunk_id, c.original_text, c.anchor
               FROM documents AS d
               JOIN document_versions AS v ON v.id = d.current_version_id
               JOIN sections AS s ON s.document_version_id = v.id
               JOIN chunks AS c ON c.section_id = s.id
               WHERE d.source_type = 'krasotaimedicina_reference'
                 AND trim(s.title) = 'Краткое описание'
               ORDER BY d.id, s.order_index, c.order_index"""
        ):
            document_id = str(row["document_id"])
            if document_id in definitions:
                continue
            context = f"Reference definition {document_id}"
            definitions[document_id] = _ReferenceDefinition(
                text=_reference_definition_text(row["original_text"], context),
                section_id=_required_reference_text(row["section_id"], "section_id", context),
                section_title=_required_reference_text(
                    row["section_title"], "section_title", context
                ),
                chunk_id=_required_reference_text(row["chunk_id"], "chunk_id", context),
                anchor=_required_reference_text(row["anchor"], "anchor", context),
            )

        document_rows = connection.execute(
            """SELECT d.id, d.title, d.short_title, d.source_type, d.status,
                      d.specialty_json, d.metadata_json, d.current_version_id,
                      v.id AS version_id, v.document_id AS version_document_id,
                      v.version_label, v.source_checksum, v.extracted_at
               FROM documents AS d
               LEFT JOIN document_versions AS v ON v.id = d.current_version_id
               ORDER BY d.id"""
        ).fetchall()
        documents: list[_ReferenceSourceDocument] = []
        seen_document_ids: set[str] = set()
        for row in document_rows:
            document_id = _required_reference_text(row["id"], "id", "Reference document")
            context = f"Reference document {document_id}"
            if document_id in seen_document_ids:
                raise ValueError(
                    f"Reference SQLite source contains duplicate document id: {document_id}"
                )
            seen_document_ids.add(document_id)
            source_type = _required_reference_text(row["source_type"], "source_type", context)
            if source_type not in _REFERENCE_SOURCE_TYPES:
                raise ValueError(
                    f"Reference document {document_id} has unsupported source_type: {source_type}"
                )
            title = _required_reference_text(row["title"], "title", context)
            short_title = _optional_reference_text(row["short_title"], "short_title", context)
            status = _required_reference_text(row["status"], "status", context)
            try:
                specialty_payload: object = json.loads(str(row["specialty_json"]))
            except (TypeError, json.JSONDecodeError) as error:
                raise ValueError(f"{context} specialty_json is invalid JSON.") from error
            specialties = _reference_json_strings(specialty_payload, "specialty_json", context)
            metadata = _reference_metadata_object(row["metadata_json"], document_id)
            current_version_id = _required_reference_text(
                row["current_version_id"], "current_version_id", context
            )
            version_id = _required_reference_text(row["version_id"], "id", f"{context} version")
            version_document_id = _required_reference_text(
                row["version_document_id"], "document_id", f"{context} version"
            )
            if version_id != current_version_id or version_document_id != document_id:
                raise ValueError(f"{context} current version does not match document_versions.")
            version_label = _required_reference_text(
                row["version_label"], "version_label", f"{context} version"
            )
            source_checksum = _required_reference_text(
                row["source_checksum"], "source_checksum", f"{context} version"
            )
            extracted_at = _required_reference_text(
                row["extracted_at"], "extracted_at", f"{context} version"
            )
            mkb_code = _reference_metadata_text(metadata, "mkbCode", document_id)
            icd10_codes = _reference_json_strings(
                metadata.get("icd10Codes", []), "icd10Codes", context
            )
            if mkb_code and _reference_key(mkb_code) not in {
                _reference_key(code) for code in icd10_codes
            }:
                icd10_codes = (mkb_code, *icd10_codes)
            source_file = _reference_metadata_text(metadata, "sourceFile", document_id)
            official_source_url = _reference_metadata_text(
                metadata, "officialSourceUrl", document_id
            )
            source_url = source_file or official_source_url
            if source_url is None:
                raise ValueError(f"{context} metadata lacks sourceFile or officialSourceUrl.")
            source_kind = (
                _reference_metadata_text(metadata, "sourceKind", document_id) or source_type
            )
            publisher = _reference_metadata_text(metadata, "publisher", document_id)
            rights_status = _reference_metadata_text(metadata, "rightsStatus", document_id)
            requires_review_value = metadata.get("requiresReview")
            if requires_review_value is not None and not isinstance(requires_review_value, bool):
                raise ValueError(f"{context} metadata requiresReview must be a boolean.")
            entity_type = _reference_entity_type(
                source_type,
                title,
                mkb_code,
                icd10_codes,
                _reference_metadata_text(metadata, "entityType", document_id),
                document_id,
            )
            documents.append(
                _ReferenceSourceDocument(
                    document_id=document_id,
                    title=title,
                    short_title=short_title,
                    source_type=source_type,
                    status=status,
                    specialties=specialties,
                    version_id=version_id,
                    version_label=version_label,
                    source_checksum=source_checksum,
                    extracted_at=extracted_at,
                    source_kind=source_kind,
                    entity_type=entity_type,
                    mkb_code=mkb_code,
                    icd10_codes=icd10_codes,
                    source_url=source_url,
                    official_source_url=official_source_url,
                    publisher=publisher,
                    rights_status=rights_status,
                    requires_review=requires_review_value,
                    definition=definitions.get(document_id),
                    classification_path=_reference_classification_path(
                        mkb_code or (icd10_codes[0] if icd10_codes else None),
                        classification_nodes,
                    ),
                )
            )

        aliases: list[_ReferenceSourceAlias] = []
        seen_alias_ids: set[str] = set()
        for row in connection.execute(
            "SELECT id, canonical_term, alias, category, weight FROM aliases ORDER BY id"
        ):
            alias_id = _required_reference_text(row["id"], "id", "Reference alias")
            if alias_id in seen_alias_ids:
                raise ValueError(f"Reference SQLite source contains duplicate alias id: {alias_id}")
            seen_alias_ids.add(alias_id)
            canonical_term = _required_reference_text(
                row["canonical_term"], "canonical_term", f"Reference alias {alias_id}"
            )
            alias = _required_reference_text(row["alias"], "alias", f"Reference alias {alias_id}")
            category = _optional_reference_text(
                row["category"], "category", f"Reference alias {alias_id}"
            )
            weight_value = row["weight"]
            if isinstance(weight_value, bool) or not isinstance(weight_value, (int, float)):
                raise ValueError(f"Reference alias {alias_id} weight must be a number.")
            weight = float(weight_value)
            if not math.isfinite(weight) or weight <= 0:
                raise ValueError(f"Reference alias {alias_id} weight must be finite and positive.")
            aliases.append(
                _ReferenceSourceAlias(
                    alias_id=alias_id,
                    canonical_term=canonical_term,
                    alias=alias,
                    category=category,
                    weight=weight,
                )
            )
        return documents, aliases
    except sqlite3.DatabaseError as error:
        raise ValueError(f"Unable to read reference SQLite source: {source}") from error
    finally:
        connection.close()


def _map_reference_aliases(
    documents: list[_ReferenceSourceDocument],
    aliases: list[_ReferenceSourceAlias],
) -> tuple[dict[str, list[_ReferenceSourceAlias]], list[str]]:
    targets_by_key: dict[str, set[str]] = {}
    for document in documents:
        for key in _reference_source_keys(document):
            targets_by_key.setdefault(key, set()).add(document.document_id)
    aliases_by_document: dict[str, list[_ReferenceSourceAlias]] = {}
    unmatched = 0
    for source_alias in aliases:
        target_ids = targets_by_key.get(_reference_key(source_alias.canonical_term), set())
        if not target_ids:
            unmatched += 1
            continue
        # Aliases are global query expansions, not document edges. Attach each one
        # once to a deterministic pointer even when several sources share its code.
        target_id = min(target_ids)
        aliases_by_document.setdefault(target_id, []).append(source_alias)
    for target_aliases in aliases_by_document.values():
        target_aliases.sort(key=lambda item: item.alias_id)
    warnings: list[str] = []
    if unmatched:
        warnings.append(f"Skipped {unmatched} unmapped source aliases.")
    return aliases_by_document, warnings


def _reference_core_pointer_document(
    document: _ReferenceSourceDocument,
    source_aliases: list[_ReferenceSourceAlias],
    module_id: str,
) -> tuple[str, str, str, list[dict[str, object]]]:
    pointer_id = _core_pointer_id(document.document_id, "reference")
    declared_aliases = [source_alias.alias for source_alias in source_aliases]
    metadata: dict[str, object] = {
        "contentMode": "module-pointer",
        "catalogFamily": "reference",
        "entityType": document.entity_type,
        "targetDocumentId": document.document_id,
        "primaryModuleId": module_id,
        "moduleIds": [module_id],
        "sourceDocumentId": document.document_id,
        "sourceDocumentVersionId": document.version_id,
        "sourceType": document.source_type,
        "sourceCategory": document.source_type,
        "sourceKind": document.source_kind,
        "mkbCode": document.mkb_code,
        "icd10Codes": list(document.icd10_codes),
        "sourceUrl": document.source_url,
        "officialSourceUrl": document.official_source_url,
        "publisher": document.publisher,
        "sourceChecksum": document.source_checksum,
        "sourceVersionLabel": document.version_label,
        "sourceExtractedAt": document.extracted_at,
        "rightsStatus": document.rights_status,
        "requiresReview": document.requires_review,
        "declaredAliases": declared_aliases,
        "referenceCoverage": "clinical-definition"
        if document.definition is not None
        else "classification-only",
    }
    if document.classification_path:
        metadata["classificationPath"] = [
            {
                "code": node.code,
                "title": node.title,
                "sourceUrl": node.source_url,
                "sourceDocumentId": node.source_document_id,
                "sourceDocumentVersionId": node.source_document_version_id,
                "sourceChecksum": node.source_checksum,
                "sourceChunkId": node.source_chunk_id,
                "sourceAnchor": node.source_anchor,
            }
            for node in document.classification_path
        ]
    if source_aliases:
        metadata["sourceAliases"] = [
            {
                "sourceAliasId": source_alias.alias_id,
                "canonicalTerm": source_alias.canonical_term,
                "alias": source_alias.alias,
                "category": source_alias.category,
                "weight": source_alias.weight,
                "sourceDocumentId": document.document_id,
                "sourceDocumentVersionId": document.version_id,
                "sourceChecksum": document.source_checksum,
                "sourceKind": "synonyms",
            }
            for source_alias in source_aliases
        ]
    if document.definition is not None:
        definition_hash = hashlib.sha256(
            f"{document.document_id}\0{document.definition.chunk_id}".encode()
        ).hexdigest()[:20]
        metadata["canonicalDefinition"] = {
            "definitionId": f"reference.definition.{definition_hash}",
            "text": document.definition.text,
            "sourceDocumentId": document.document_id,
            "sourceDocumentVersionId": document.version_id,
            "sourceSectionId": document.definition.section_id,
            "sourceChunkId": document.definition.chunk_id,
            "sourceAnchor": document.definition.anchor,
            "sourceSectionTitle": document.definition.section_title,
        }
    metadata = {key: value for key, value in metadata.items() if value is not None}
    body = [
        "# Сведения МКБ-10",
        "",
        _source_marker(document.document_id, "core-pointer"),
        f"МКБ-10: {_format_values(list(document.icd10_codes))} — "
        f"{_reference_display_title(document)}.",
        f"Источник: {document.publisher or document.source_type}; {document.source_url}.",
        "",
    ]
    if document.classification_path:
        body.extend(["# Классификационный контекст", ""])
        for node in document.classification_path:
            body.extend(
                [
                    _source_marker(
                        node.source_document_id,
                        f"classification-context:{node.code}",
                    ),
                    f"- {node.code} {node.title}",
                ]
            )
        body.append("")
    if source_aliases:
        body.extend(
            [
                "# Синонимы",
                "",
                _source_marker(
                    document.document_id,
                    "synonyms",
                ),
            ]
        )
        body.extend(f"- {source_alias.alias}" for source_alias in source_aliases)
        body.append("")
    if document.definition is not None:
        body.extend(
            [
                "# Краткое описание",
                "",
                _source_marker(
                    document.document_id,
                    "clinical-definition",
                ),
                document.definition.text,
                "",
            ]
        )
    else:
        body.extend(
            [
                "# Ограничение покрытия",
                "",
                "В указателе сохранены код, название и доступный "
                "классификационный контекст источника.",
                "Клиническое описание и рекомендации в этом материале отсутствуют.",
                "",
            ]
        )
    front = _front_matter(
        document_id=pointer_id,
        title=document.title,
        short_title=document.short_title or document.title,
        version_label=document.version_label,
        source_type="core_catalog_pointer",
        status=document.status,
        specialties=list(document.specialties),
        source_url=document.source_url,
        source_checksum=document.source_checksum,
        metadata=metadata,
    )
    pointer_aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(pointer_id)}.{index}",
            "canonicalTerm": document.title,
            "alias": source_alias.alias,
            "category": source_alias.category,
            "weight": source_alias.weight,
        }
        for index, source_alias in enumerate(source_aliases, start=1)
    ]
    return pointer_id, front, "\n".join(body) + "\n", pointer_aliases


def _esklp_node_trade_names(node: Mapping[str, object]) -> list[str]:
    return _unique_texts(
        [
            trade_name
            for trade in _object_list(node.get("tradeNames"))
            if (trade_name := _clean(trade.get("tradeName"))) is not None
        ]
    )


def _esklp_node_trade_search_lines(node: Mapping[str, object]) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for trade in _object_list(node.get("tradeNames")):
        trade_name = _clean(trade.get("tradeName"))
        if trade_name is None:
            continue
        presentations = _text_values(trade.get("normalizedFormsStrengths"))
        if presentations:
            line = f"- ТН: {trade_name}; форма/дозировка: {_format_values(presentations)}"
        else:
            dosage_form = _clean(trade.get("dosageForm"))
            strength = _clean(trade.get("strength"))
            details = _unique_texts(
                [value for value in (dosage_form, strength) if value is not None]
            )
            suffix = f"; форма/дозировка: {_format_values(details)}" if details else ""
            line = f"- ТН: {trade_name}{suffix}"
        key = line.casefold()
        if key not in seen:
            seen.add(key)
            lines.append(line)
    return lines


def _esklp_pointer_search_fields(record: Mapping[str, object]) -> dict[str, list[str]]:
    fields: dict[str, list[str]] = {
        "smnnCodes": [],
        "tradeNames": [],
    }
    for node in _object_list(record.get("smnnNodes")):
        fields["smnnCodes"].extend(_text_values(node.get("smnnCode")))
        fields["tradeNames"].extend(_esklp_node_trade_names(node))

    return {key: _unique_texts(values) for key, values in fields.items()}


def project_esklp_mnn_to_core_topic_stub(
    record: Mapping[str, object],
) -> CoreCatalogTopicStub:
    """Project one full ESKLP MNN record into the shared core-topic shape."""
    record_id = _clean(record.get("recordId"))
    if record_id is None:
        raise ValueError("ESKLP MNN record requires recordId.")
    record_kind = record.get("recordKind")
    if record_kind not in (None, "esklp-mnn"):
        raise ValueError(f"Record {record_id} is not an ESKLP MNN record.")
    standardized_inn = _clean(record.get("standardizedInn")) or record_id
    component_inns = _list(record.get("componentInns"))
    inn = _list(record.get("inn"))
    primary_module_id = _clean(record.get("primaryModuleId"))
    if primary_module_id is None:
        raise ValueError(f"ESKLP MNN record {record_id} requires primaryModuleId.")
    module_ids = _unique_texts([*_list(record.get("moduleIds")), primary_module_id])
    fields = _esklp_pointer_search_fields(record)
    aliases = _unique_texts(
        [
            standardized_inn,
            *inn,
            *component_inns,
            *fields["tradeNames"],
        ]
    )
    summary = (
        f"{standardized_inn}. Полные данные находятся в скачиваемом модуле «{primary_module_id}»."
    )
    return CoreCatalogTopicStub(
        id=_core_pointer_id(record_id, "medication"),
        entity_type="medication",
        title=standardized_inn,
        summary=summary,
        aliases=aliases,
        module_ids=module_ids,
        relations=[
            CoreCatalogRelationStub(
                predicate="full-record",
                target_id=record_id,
                weight=1.0,
            )
        ],
    )


def _core_medication_pointer_document(
    record: Mapping[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    stub = project_esklp_mnn_to_core_topic_stub(record)
    record_id = cast(str, _clean(record.get("recordId")))
    standardized_inn = _clean(record.get("standardizedInn")) or record_id
    primary_module_id = _clean(record.get("primaryModuleId"))
    if primary_module_id is None:
        raise ValueError(f"ESKLP MNN record {record_id} requires primaryModuleId.")
    module_ids = stub.module_ids
    source_url = _clean(record.get("sourceUrl")) or _clean(record.get("officialUrl"))
    status = _clean(record.get("status")) or "active"
    edition = _clean(record.get("sourceEdition")) or record_id
    metadata: dict[str, object] = {
        "contentMode": "module-pointer",
        "catalogFamily": "medication",
        "entityType": "medication",
        "targetDocumentId": record_id,
        "primaryModuleId": primary_module_id,
        "moduleIds": module_ids,
        "standardizedInn": standardized_inn,
    }
    body = [
        "# Указатель препарата",
        "",
        _source_marker(record_id, "core-pointer"),
        f"Стандартизированное МНН: {standardized_inn}.",
        "",
        (
            f"Полные данные находятся в скачиваемом модуле «{primary_module_id}» "
            "и не дублируются в ядре."
        ),
    ]
    nodes = sorted(
        _object_list(record.get("smnnNodes")),
        key=lambda node: (
            (_clean(node.get("smnnCode")) or "").casefold(),
            "\x1f".join(_text_values(node.get("dosageForms"))).casefold(),
            (_clean(node.get("dosageForm")) or "").casefold(),
            "\x1f".join(_text_values(node.get("strengths"))).casefold(),
            (_clean(node.get("strength")) or "").casefold(),
        ),
    )
    for node_index, node in enumerate(nodes, start=1):
        smnn_code = _clean(node.get("smnnCode")) or f"СМНН-{node_index}"
        trade_lines = _esklp_node_trade_search_lines(node)
        forms = _unique_texts(
            [
                *_text_values(node.get("dosageForms")),
                *_text_values(node.get("dosageForm")),
            ]
        )
        if not forms:
            forms = _unique_texts(
                [
                    dosage_form
                    for trade in _object_list(node.get("tradeNames"))
                    if (dosage_form := _clean(trade.get("dosageForm"))) is not None
                ]
            )
        strengths = _unique_texts(
            [
                *_text_values(node.get("strengths")),
                *_text_values(node.get("strength")),
            ]
        )
        if not strengths:
            strengths = _unique_texts(
                [
                    strength
                    for trade in _object_list(node.get("tradeNames"))
                    if (strength := _clean(trade.get("strength"))) is not None
                ]
            )
        body.extend(
            [
                "",
                (f"## {smnn_code} — {_format_values(forms)} — {_format_values(strengths)}"),
                "",
                _source_marker(record_id, f"smnn:{smnn_code}"),
                *trade_lines,
            ]
        )
    front = _front_matter(
        document_id=stub.id,
        title=stub.title,
        short_title=stub.title,
        version_label=edition,
        source_type="core_catalog_pointer",
        status=status,
        specialties=["pharmacology"],
        source_url=source_url,
        source_checksum=_canonical_checksum(dict(record)),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(stub.id)}.{index}",
            "canonicalTerm": stub.title,
            "alias": alias,
            "category": "medication",
            "weight": 1.0,
        }
        for index, alias in enumerate(stub.aliases, start=1)
    ]
    return stub.id, front, "\n".join(body).rstrip() + "\n", aliases


def _clinical_core_pointer_document(
    record: Mapping[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = _clean(record.get("recordId"))
    if record_id is None:
        raise ValueError("Clinical pointer record requires recordId.")
    title = _clean(record.get("title")) or record_id
    primary_module_id = _clean(record.get("primaryModuleId"))
    if primary_module_id is None:
        raise ValueError(f"Clinical record {record_id} requires primaryModuleId.")
    module_ids = _unique_texts([*_list(record.get("moduleIds")), primary_module_id])
    official_id = _clean(record.get("officialId"))
    declared_aliases = _text_values(record.get("aliases"))
    keywords = _text_values(record.get("keywords"))
    icd_codes = _text_values(record.get("icd10Codes"))
    specialties = _text_values(record.get("specialties"))
    age_categories = _text_values(record.get("ageCategories"))
    clinical_medication_links = _object_list(record.get("clinicalMedicationLinks"))
    canonical_definition = _object_value(record.get("canonicalDefinition"))
    definition_text = _clean(canonical_definition.get("text")) if canonical_definition else None
    definition_section_title = (
        _clean(canonical_definition.get("sourceSectionTitle")) if canonical_definition else None
    ) or "Термины и определения"
    if canonical_definition is not None:
        required_definition_fields = {
            "definitionId",
            "sourceDocumentId",
            "sourceDocumentVersionId",
            "sourceSectionId",
            "sourceChunkId",
            "sourceAnchor",
        }
        missing_definition_fields = sorted(required_definition_fields - canonical_definition.keys())
        if definition_text is None or missing_definition_fields:
            raise ValueError(
                f"Clinical record {record_id} has an incomplete canonical definition: "
                + ", ".join(missing_definition_fields or ["text"])
            )
    declared_entity_type = _clean(record.get("entityType"))
    entity_type: Literal["disease", "reference"] = (
        "disease" if declared_entity_type == "disease" else "reference"
    )
    search_terms = _unique_texts(
        [
            title,
            *declared_aliases,
            *keywords,
            *([official_id] if official_id else []),
            *icd_codes,
            *specialties,
            *age_categories,
        ]
    )
    stub = CoreCatalogTopicStub(
        id=_core_pointer_id(record_id, "clinical"),
        entity_type=entity_type,
        title=title,
        summary=(
            definition_text
            or f"{title}. Полные данные находятся в скачиваемом модуле «{primary_module_id}»."
        ),
        aliases=search_terms,
        module_ids=module_ids,
        relations=[
            CoreCatalogRelationStub(
                predicate="full-record",
                target_id=record_id,
                weight=1.0,
            )
        ],
    )
    source_url = _clean(record.get("sourceUrl")) or _clean(record.get("officialUrl"))
    status = _clean(record.get("status")) or "unknown"
    version = _clean(record.get("versionLabel")) or official_id or record_id
    metadata: dict[str, object] = {
        "contentMode": "module-pointer",
        "catalogFamily": "clinical",
        "entityType": entity_type,
        "targetDocumentId": record_id,
        "primaryModuleId": primary_module_id,
        "moduleIds": module_ids,
        "officialId": official_id,
        "declaredAliases": declared_aliases,
        "keywords": keywords,
        "icd10Codes": icd_codes,
        "specialties": specialties,
        "ageCategories": age_categories,
        "canonicalDefinition": canonical_definition,
        "clinicalMedicationLinks": clinical_medication_links,
    }
    body: list[str] = []
    if definition_text and canonical_definition:
        body.extend(
            [
                "# Определение",
                "",
                definition_text,
                "",
                (
                    "Источник определения: клиническая рекомендация "
                    f"«{title}», раздел «{definition_section_title}»."
                ),
                "",
            ]
        )
    body.extend(
        [
            "# Сведения о документе",
            "",
            _source_marker(record_id, "core-pointer"),
            f"Название: {title}.",
            f"Объявленные алиасы: {_format_values(declared_aliases)}.",
            f"Ключевые слова: {_format_values(keywords)}.",
            f"Официальный идентификатор: {official_id or 'не указан'}.",
            f"МКБ-10: {_format_values(icd_codes)}.",
            f"Специальности: {_format_values(specialties)}.",
            f"Возрастные категории: {_format_values(age_categories)}.",
            "",
            (
                f"Полные данные находятся в скачиваемом модуле «{primary_module_id}» "
                "и не дублируются в ядре."
            ),
        ]
    )
    front = _front_matter(
        document_id=stub.id,
        title=stub.title,
        short_title=stub.title,
        version_label=version,
        source_type="core_catalog_pointer",
        status=status,
        specialties=specialties,
        source_url=source_url,
        source_checksum=_canonical_checksum(dict(record)),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(stub.id)}.{index}",
            "canonicalTerm": stub.title,
            "alias": alias,
            "category": "clinical-recommendation",
            "weight": 1.0,
        }
        for index, alias in enumerate(stub.aliases, start=1)
    ]
    return stub.id, front, "\n".join(body).rstrip() + "\n", aliases


def _legal_core_pointer_document(
    record: Mapping[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = _clean(record.get("recordId"))
    if record_id is None:
        raise ValueError("Legal pointer record requires recordId.")
    title = _clean(record.get("title")) or record_id
    primary_module_id = _clean(record.get("primaryModuleId"))
    if primary_module_id is None:
        raise ValueError(f"Legal record {record_id} requires primaryModuleId.")
    module_ids = _unique_texts([*_list(record.get("moduleIds")), primary_module_id])
    number = _clean(record.get("number"))
    document_type = _clean(record.get("documentType"))
    authorities = _unique_texts(
        [
            *_text_values(record.get("signatoryAuthorities")),
            *_text_values(record.get("authority")),
        ]
    )
    matched_query_ids = _text_values(record.get("matchedQueryIds"))
    search_terms = _unique_texts(
        [
            title,
            *([number] if number else []),
            *([document_type] if document_type else []),
            *authorities,
            *matched_query_ids,
        ]
    )
    stub = CoreCatalogTopicStub(
        id=_core_pointer_id(record_id, "legal"),
        entity_type="regulation",
        title=title,
        summary=(f"{title}. Полные данные находятся в скачиваемом модуле «{primary_module_id}»."),
        aliases=search_terms,
        module_ids=module_ids,
        relations=[
            CoreCatalogRelationStub(
                predicate="full-record",
                target_id=record_id,
                weight=1.0,
            )
        ],
    )
    source_url = _clean(record.get("apiUrl")) or _clean(record.get("sourceUrl"))
    status = _clean(record.get("status")) or "unknown"
    version = _clean(record.get("publishDate")) or number or record_id
    metadata: dict[str, object] = {
        "contentMode": "module-pointer",
        "catalogFamily": "legal",
        "entityType": "regulation",
        "targetDocumentId": record_id,
        "primaryModuleId": primary_module_id,
        "moduleIds": module_ids,
        "number": number,
        "documentType": document_type,
        "authorities": authorities,
        "matchedQueryIds": matched_query_ids,
    }
    body = [
        "# Указатель нормативного документа",
        "",
        _source_marker(record_id, "core-pointer"),
        f"Название: {title}.",
        f"Номер: {number or 'не указан'}.",
        f"Тип документа: {document_type or 'не указан'}.",
        f"Орган: {_format_values(authorities)}.",
        f"Идентификаторы поисковых запросов: {_format_values(matched_query_ids)}.",
        "",
        (
            f"Полные данные находятся в скачиваемом модуле «{primary_module_id}» "
            "и не дублируются в ядре."
        ),
    ]
    front = _front_matter(
        document_id=stub.id,
        title=stub.title,
        short_title=number or stub.title,
        version_label=version,
        source_type="core_catalog_pointer",
        status=status,
        specialties=["health-administration"],
        source_url=source_url,
        source_checksum=_canonical_checksum(dict(record)),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(stub.id)}.{index}",
            "canonicalTerm": stub.title,
            "alias": alias,
            "category": "regulatory-document",
            "weight": 1.0,
        }
        for index, alias in enumerate(stub.aliases, start=1)
    ]
    return stub.id, front, "\n".join(body).rstrip() + "\n", aliases


def _general_medication_core_pointer_document(
    record: Mapping[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = _clean(record.get("recordId"))
    if record_id is None:
        raise ValueError("Medication pointer record requires recordId.")
    registration = _clean(record.get("registrationNumber"))
    trade_name = (
        _clean(record.get("tradeName")) or _clean(record.get("title")) or registration or record_id
    )
    primary_module_id = _clean(record.get("primaryModuleId"))
    if primary_module_id is None:
        raise ValueError(f"Medication record {record_id} requires primaryModuleId.")
    module_ids = _unique_texts([*_list(record.get("moduleIds")), primary_module_id])
    inns = _text_values(record.get("inn"))
    dosage_forms = _unique_texts(
        [
            *_text_values(record.get("dosageForms")),
            *_text_values(record.get("dosageForm")),
        ]
    )
    strengths = _unique_texts(
        [
            *_text_values(record.get("strengths")),
            *_text_values(record.get("strength")),
        ]
    )
    routes = _unique_texts(
        [
            *_text_values(record.get("routes")),
            *_text_values(record.get("route")),
        ]
    )
    search_terms = _unique_texts(
        [
            trade_name,
            *inns,
            *dosage_forms,
            *strengths,
            *routes,
            *([registration] if registration else []),
            *(f"{trade_name} {dosage_form}" for dosage_form in dosage_forms),
            *(f"{trade_name} {strength}" for strength in strengths),
        ]
    )
    stub = CoreCatalogTopicStub(
        id=_core_pointer_id(record_id, "medication"),
        entity_type="medication",
        title=trade_name,
        summary=(
            f"{trade_name}. Полные данные находятся в скачиваемом модуле «{primary_module_id}»."
        ),
        aliases=search_terms,
        module_ids=module_ids,
        relations=[
            CoreCatalogRelationStub(
                predicate="full-record",
                target_id=record_id,
                weight=1.0,
            )
        ],
    )
    source_url = _clean(record.get("sourceUrl")) or _clean(record.get("officialUrl"))
    status = _clean(record.get("status")) or "unknown"
    version = _clean(record.get("sourceEdition")) or registration or record_id
    metadata: dict[str, object] = {
        "contentMode": "module-pointer",
        "catalogFamily": "medication",
        "entityType": "medication",
        "targetDocumentId": record_id,
        "primaryModuleId": primary_module_id,
        "moduleIds": module_ids,
        "tradeName": trade_name,
        "inn": inns,
        "dosageForms": dosage_forms,
        "strengths": strengths,
        "routes": routes,
        "registrationNumber": registration,
        "trustedDoseData": False,
    }
    body = [
        "# Указатель препарата",
        "",
        _source_marker(record_id, "core-pointer"),
        (
            f"ТН: {trade_name}; МНН: {_format_values(inns)}; форма: "
            f"{_format_values(dosage_forms)}; дозировка/концентрация: "
            f"{_format_values(strengths)}; путь введения: {_format_values(routes)}; "
            f"регистрационный номер: {registration or 'не указан'}."
        ),
        "",
        (
            f"Полные данные находятся в скачиваемом модуле «{primary_module_id}» "
            "и не дублируются в ядре."
        ),
    ]
    front = _front_matter(
        document_id=stub.id,
        title=stub.title,
        short_title=stub.title,
        version_label=version,
        source_type="core_catalog_pointer",
        status=status,
        specialties=["pharmacology"],
        source_url=source_url,
        source_checksum=_canonical_checksum(dict(record)),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(stub.id)}.{index}",
            "canonicalTerm": stub.title,
            "alias": alias,
            "category": "medication",
            "weight": 1.0,
        }
        for index, alias in enumerate(stub.aliases, start=1)
    ]
    return stub.id, front, "\n".join(body).rstrip() + "\n", aliases


def _core_catalog_pointer_document(
    family: CatalogFamily,
    record: Mapping[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    if family == "clinical":
        return _clinical_core_pointer_document(record)
    if family == "legal":
        return _legal_core_pointer_document(record)
    if record.get("recordKind") == "esklp-mnn" or (
        "standardizedInn" in record and "smnnNodes" in record
    ):
        return _core_medication_pointer_document(record)
    return _general_medication_core_pointer_document(record)


def build_core_catalog_pointers(
    ledger_path: Path,
    output_root: Path,
    *,
    family: CatalogFamily = "medication",
    version: str,
    core_module_id: str = "minimed.core.ru",
    core_module_title: str = "Ядро MiniMed",
    built_at: str | None = None,
    force: bool = False,
) -> CatalogModuleBuildReport:
    """Build compact core pointers for one catalog-family ledger."""
    ledger = _load_ledger(ledger_path)
    records = ledger.records
    if not records:
        raise ValueError("Coverage ledger contains no records.")
    pointers = [_core_catalog_pointer_document(family, record) for record in records]
    target_ids = {cast(str, record["recordId"]) for record in records}
    pointer_ids = [pointer[0] for pointer in pointers]
    if len(pointer_ids) != len(set(pointer_ids)):
        raise ValueError("Core catalog pointer generation produced duplicate document IDs.")
    collision = sorted(set(pointer_ids) & target_ids)
    if collision:
        raise ValueError(
            "Core catalog pointer IDs collide with target documents: " + ", ".join(collision)
        )

    timestamp = built_at or _utc_now()
    target = output_root.resolve()
    if target.exists():
        if not force:
            raise FileExistsError(f"Output directory already exists: {target}")
        shutil.rmtree(target)
    target.mkdir(parents=True)
    module_dir = target / _safe_stem(core_module_id)
    module_dir.mkdir(parents=True)
    module = LedgerModule(
        module_id=core_module_id,
        title=core_module_title,
        record_ids=pointer_ids,
        coverage_counts={"module-pointer": len(pointer_ids)},
    )
    (module_dir / "manifest.yaml").write_text(
        yaml.safe_dump(
            _module_manifest(module, version, timestamp),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    aliases: list[dict[str, object]] = []
    for pointer_id, front, body, pointer_aliases in pointers:
        aliases.extend(pointer_aliases)
        (module_dir / f"{_bounded_filename_stem(pointer_id)}.md").write_text(
            f"---\n{front}\n---\n\n{body}",
            encoding="utf-8",
        )
    unique_aliases: dict[str, dict[str, object]] = {}
    for alias in aliases:
        alias_id = cast(str, alias["id"])
        if alias_id not in unique_aliases:
            unique_aliases[alias_id] = alias
    (module_dir / "aliases.yaml").write_text(
        yaml.safe_dump(
            {"aliases": list(unique_aliases.values())},
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    report = CatalogModuleBuildReport(
        family=family,
        version=version,
        built_at=timestamp,
        source_ledger_checksum=_sha256_file(ledger_path),
        modules=[
            CatalogModuleBuild(
                module_id=module.module_id,
                title=module.title,
                directory=str(module_dir.relative_to(target)),
                record_count=len(pointer_ids),
                document_ids=pointer_ids,
                coverage_counts=module.coverage_counts,
            )
        ],
        total_documents=len(pointer_ids),
        warnings=[],
    )
    (target / "module-build-report.json").write_text(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return report


def build_core_reference_pointers(
    source_sqlite: Path,
    output_root: Path,
    *,
    module_id: str,
    module_title: str,
    version: str,
    built_at: str | None = None,
    force: bool = False,
) -> CatalogModuleBuildReport:
    """Build compact core pointers from a reference-pack SQLite database."""
    source = source_sqlite.resolve()
    target = output_root.resolve()
    if target == source or source in target.parents:
        raise ValueError("Reference pointer output must be outside the source SQLite path.")
    module_id = _required_reference_text(module_id, "module_id", "Reference pointer target")
    module_title = _required_reference_text(
        module_title, "module_title", "Reference pointer target"
    )
    version = _required_reference_text(version, "version", "Reference pointer target")
    documents, source_aliases = _read_reference_database(source)
    if not documents:
        raise ValueError("Reference SQLite source contains no supported documents.")
    aliases_by_document, warnings = _map_reference_aliases(documents, source_aliases)
    pointers = [
        _reference_core_pointer_document(
            document,
            aliases_by_document.get(document.document_id, []),
            module_id,
        )
        for document in documents
    ]
    pointer_ids = [pointer[0] for pointer in pointers]
    if len(pointer_ids) != len(set(pointer_ids)):
        raise ValueError("Reference pointer generation produced duplicate document IDs.")
    target_ids = {document.document_id for document in documents}
    collision = sorted(set(pointer_ids) & target_ids)
    if collision:
        raise ValueError(
            "Reference pointer IDs collide with target documents: " + ", ".join(collision)
        )

    timestamp = built_at or _utc_now()
    if target.exists():
        if not force:
            raise FileExistsError(f"Output directory already exists: {target}")
        if not target.is_dir():
            raise FileExistsError(f"Output path is not a directory: {target}")
        shutil.rmtree(target)
    target.mkdir(parents=True)
    module_dir = target / _safe_stem(module_id)
    module_dir.mkdir(parents=True)
    module = LedgerModule(
        module_id=module_id,
        title=module_title,
        record_ids=pointer_ids,
        coverage_counts={"module-pointer": len(pointer_ids)},
    )
    (module_dir / "manifest.yaml").write_text(
        yaml.safe_dump(
            _module_manifest(module, version, timestamp),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    aliases: list[dict[str, object]] = []
    for pointer_id, front, body, pointer_aliases in pointers:
        aliases.extend(pointer_aliases)
        (module_dir / f"{_bounded_filename_stem(pointer_id)}.md").write_text(
            f"---\n{front}\n---\n\n{body}",
            encoding="utf-8",
        )
    unique_aliases: dict[str, dict[str, object]] = {}
    for alias in aliases:
        alias_id = cast(str, alias["id"])
        if alias_id in unique_aliases:
            raise ValueError(
                f"Reference pointer generation produced duplicate alias ID: {alias_id}"
            )
        unique_aliases[alias_id] = alias
    (module_dir / "aliases.yaml").write_text(
        yaml.safe_dump(
            {"aliases": list(unique_aliases.values())},
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    report = CatalogModuleBuildReport(
        family="reference",
        version=version,
        built_at=timestamp,
        source_ledger_checksum=_sha256_file(source),
        modules=[
            CatalogModuleBuild(
                module_id=module.module_id,
                title=module.title,
                directory=str(module_dir.relative_to(target)),
                record_count=len(pointer_ids),
                document_ids=pointer_ids,
                coverage_counts=module.coverage_counts,
            )
        ],
        total_documents=len(pointer_ids),
        warnings=warnings,
    )
    (target / "module-build-report.json").write_text(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return report


def _medication_document(
    record: dict[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = cast(str, record["recordId"])
    registration = _clean(record.get("registrationNumber")) or record_id
    trade_name = _clean(record.get("tradeName")) or registration
    inn = _list(record.get("inn"))
    atc = _list(record.get("atcCodes"))
    strengths = _list(record.get("strengths"))
    routes = _list(record.get("routes"))
    dosage_form = _clean(record.get("dosageForm"))
    status = _clean(record.get("status")) or "unknown"
    edition = _clean(record.get("sourceEdition")) or registration
    source_url = _clean(record.get("sourceUrl")) or _clean(record.get("officialUrl"))
    coverage = _clean(record.get("coverageState")) or "metadata-only"
    rights = _clean(record.get("rights")) or "unknown"
    metadata: dict[str, object] = {
        "catalogFamily": "medication",
        "coverageState": coverage,
        "rights": rights,
        "registrationNumber": registration,
        "tradeName": trade_name,
        "inn": inn,
        "atcCodes": atc,
        "dosageForm": dosage_form,
        "strengths": strengths,
        "routes": routes,
        "manufacturer": _clean(record.get("manufacturer")),
        "holder": _clean(record.get("holder")),
        "pediatricUse": _clean(record.get("pediatricUse")),
        "prescriptionStatus": _clean(record.get("prescriptionStatus")),
        "officialUrl": _clean(record.get("officialUrl")),
        "sourceUrl": source_url,
        "moduleIds": _list(record.get("moduleIds")),
        "primaryModuleId": _clean(record.get("primaryModuleId")),
        "contentMode": "catalog-metadata",
        "trustedDoseData": False,
    }
    body = [
        "# Регистрационные сведения",
        "",
        _source_marker(record_id, "identity"),
        (
            f"Лекарственный препарат «{trade_name}». "
            f"Регистрационный номер: {registration}. "
            f"МНН: {_format_values(inn)}. Статус регистрации: {status}."
        ),
        "",
        "# Форма и классификация",
        "",
        _source_marker(record_id, "classification"),
        (
            f"АТХ: {_format_values(atc)}. "
            f"Лекарственная форма: {dosage_form or 'не указана в каталоге'}. "
            f"Дозировки/концентрации: {_format_values(strengths)}. "
            f"Пути введения: {_format_values(routes)}."
        ),
        "",
        "# Ограничения данных",
        "",
        _source_marker(record_id, "coverage"),
        (
            f"Состояние покрытия MiniMed: {coverage}. Эта карточка не подтверждает "
            "дозы, показания, противопоказания или взаимодействия. Такие сведения "
            "становятся доверенными только из проверенной редакции инструкции с "
            "точной ссылкой на источник."
        ),
    ]
    if source_url:
        body.extend(["", f"Официальная или объявленная инструкция: {source_url}"])
    front = _front_matter(
        document_id=record_id,
        title=trade_name,
        short_title=trade_name,
        version_label=edition,
        source_type="medication_registry_record",
        status=status,
        specialties=["pharmacology"],
        source_url=source_url,
        source_checksum=_canonical_checksum(record),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = []
    for index, alias in enumerate([trade_name, *inn]):
        aliases.append(
            {
                "id": f"alias.{_safe_stem(record_id)}.{index + 1}",
                "canonicalTerm": inn[0] if inn else trade_name,
                "alias": alias,
                "category": "medication",
                "weight": 1.0,
            }
        )
    return record_id, front, "\n".join(body).rstrip() + "\n", aliases


def _legal_document(record: dict[str, object]) -> tuple[str, str, str, list[dict[str, object]]]:
    record_id = cast(str, record["recordId"])
    eo_number = _clean(record.get("eoNumber")) or record_id
    title = _clean(record.get("title")) or eo_number
    number = _clean(record.get("number"))
    document_type = _clean(record.get("documentType")) or "нормативный документ"
    publish_date = _clean(record.get("publishDate"))
    document_date = _clean(record.get("documentDate"))
    status = _clean(record.get("status")) or "published"
    source_url = _clean(record.get("apiUrl"))
    authorities = _list(record.get("signatoryAuthorities"))
    coverage = _clean(record.get("coverageState")) or "metadata-only"
    rights = _clean(record.get("rights")) or "metadata-only"
    metadata: dict[str, object] = {
        "catalogFamily": "legal",
        "coverageState": coverage,
        "rights": rights,
        "documentId": _clean(record.get("documentId")),
        "eoNumber": eo_number,
        "number": number,
        "documentDate": document_date,
        "publishDate": publish_date,
        "justiceRegistrationNumber": _clean(record.get("justiceRegistrationNumber")),
        "justiceRegistrationDate": _clean(record.get("justiceRegistrationDate")),
        "signatoryAuthorityId": _clean(record.get("signatoryAuthorityId")),
        "signatoryAuthorities": authorities,
        "documentTypeId": _clean(record.get("documentTypeId")),
        "documentType": document_type,
        "pagesCount": record.get("pagesCount"),
        "pdfBytes": record.get("pdfBytes"),
        "apiUrl": source_url,
        "moduleIds": _list(record.get("moduleIds")),
        "primaryModuleId": _clean(record.get("primaryModuleId")),
        "matchedQueryIds": _list(record.get("matchedQueryIds")),
        "contentMode": "catalog-metadata",
        "applicabilityReviewed": False,
    }
    body = [
        "# Сведения об официальном опубликовании",
        "",
        _source_marker(record_id, "identity"),
        (
            f"{document_type}: «{title}». "
            f"Номер документа: {number or 'не указан'}. "
            f"Электронный номер опубликования: {eo_number}."
        ),
        "",
        "# Даты и орган",
        "",
        _source_marker(record_id, "publication"),
        (
            f"Дата документа: {document_date or 'не указана'}. "
            f"Дата официального опубликования: {publish_date or 'не указана'}. "
            f"Орган(ы): {_format_values(authorities)}."
        ),
        "",
        "# Применимость и ограничения",
        "",
        _source_marker(record_id, "coverage"),
        (
            f"Состояние покрытия MiniMed: {coverage}. Наличие записи об "
            "опубликовании не доказывает текущую применимость, отсутствие изменений "
            "или связь с заменяющим актом. Эти отношения требуют отдельной проверки."
        ),
    ]
    if source_url:
        body.extend(["", f"Карточка официального опубликования: {source_url}"])
    front = _front_matter(
        document_id=record_id,
        title=title,
        short_title=number or title,
        version_label=publish_date or eo_number,
        source_type="official_legal_publication_record",
        status=status,
        specialties=["health-administration"],
        source_url=source_url,
        source_checksum=_canonical_checksum(record),
        metadata=metadata,
    )
    aliases: list[dict[str, object]] = [
        {
            "id": f"alias.{_safe_stem(record_id)}.number",
            "canonicalTerm": title,
            "alias": number or eo_number,
            "category": "regulatory-document",
            "weight": 1.0,
        }
    ]
    return record_id, front, "\n".join(body).rstrip() + "\n", aliases


def _render_record(
    family: CatalogFamily,
    record: dict[str, object],
) -> tuple[str, str, str, list[dict[str, object]]]:
    if family == "clinical":
        return _clinical_document(record)
    if family == "medication":
        if record.get("recordKind") == "esklp-mnn":
            return _esklp_document(record)
        return _medication_document(record)
    return _legal_document(record)


def build_catalog_metadata_modules(
    ledger_path: Path,
    output_root: Path,
    *,
    family: CatalogFamily,
    version: str,
    built_at: str | None = None,
    force: bool = False,
) -> CatalogModuleBuildReport:
    ledger = _load_ledger(ledger_path)
    timestamp = built_at or _utc_now()
    target = output_root.resolve()
    if target.exists():
        if not force:
            raise FileExistsError(f"Output directory already exists: {target}")
        shutil.rmtree(target)
    target.mkdir(parents=True)
    records = {cast(str, record["recordId"]): record for record in ledger.records}
    builds: list[CatalogModuleBuild] = []
    warnings: list[str] = []
    packaged_ids: list[str] = []
    for module in ledger.modules:
        primary_record_ids = [
            record_id
            for record_id in module.record_ids
            if _clean(records[record_id].get("primaryModuleId")) == module.module_id
        ]
        if not primary_record_ids:
            warnings.append(f"module skipped without primary records: {module.module_id}")
            continue
        module_dir = target / _safe_stem(module.module_id)
        module_dir.mkdir(parents=True)
        (module_dir / "manifest.yaml").write_text(
            yaml.safe_dump(
                _module_manifest(module, version, timestamp),
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        aliases: list[dict[str, object]] = []
        document_ids: list[str] = []
        coverage_counts: dict[str, int] = {}
        for record_id in primary_record_ids:
            record = records[record_id]
            document_id, front, body, record_aliases = _render_record(family, record)
            document_ids.append(document_id)
            packaged_ids.append(document_id)
            aliases.extend(record_aliases)
            coverage = _clean(record.get("coverageState")) or "metadata-only"
            coverage_counts[coverage] = coverage_counts.get(coverage, 0) + 1
            document_path = module_dir / f"{_bounded_filename_stem(document_id)}.md"
            document_path.write_text(
                f"---\n{front}\n---\n\n{body}",
                encoding="utf-8",
            )
        unique_aliases: dict[str, dict[str, object]] = {}
        for alias in aliases:
            alias_id = cast(str, alias["id"])
            if alias_id in unique_aliases:
                warnings.append(f"duplicate alias ignored: {alias_id}")
                continue
            unique_aliases[alias_id] = alias
        (module_dir / "aliases.yaml").write_text(
            yaml.safe_dump(
                {"aliases": list(unique_aliases.values())},
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        builds.append(
            CatalogModuleBuild(
                module_id=module.module_id,
                title=module.title,
                directory=str(module_dir.relative_to(target)),
                record_count=len(document_ids),
                document_ids=document_ids,
                coverage_counts=coverage_counts,
            )
        )
    if len(packaged_ids) != len(set(packaged_ids)):
        raise ValueError("Catalog module generation produced duplicate document IDs.")
    if set(packaged_ids) != set(records):
        missing = sorted(set(records) - set(packaged_ids))
        unexpected = sorted(set(packaged_ids) - set(records))
        raise ValueError(
            "Catalog module generation did not preserve canonical ownership: "
            f"missing={missing}, unexpected={unexpected}."
        )
    report = CatalogModuleBuildReport(
        family=family,
        version=version,
        built_at=timestamp,
        source_ledger_checksum=_sha256_file(ledger_path),
        modules=builds,
        total_documents=len(packaged_ids),
        warnings=warnings,
    )
    (target / "module-build-report.json").write_text(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return report
