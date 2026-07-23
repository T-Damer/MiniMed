from __future__ import annotations

import hashlib
import json
import re
import shutil
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

CatalogFamily = Literal["clinical", "medication", "legal"]

_SAFE_STEM_PATTERN = re.compile(r"[^0-9A-Za-zА-Яа-я._-]+")
_SPACE_PATTERN = re.compile(r"\s+")


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
    family: CatalogFamily
    version: str
    built_at: str
    source_ledger_checksum: str
    modules: list[CatalogModuleBuild]
    total_documents: int
    warnings: list[str] = Field(default_factory=list)


class LedgerModule(CamelModel):
    module_id: str
    title: str
    record_ids: list[str]
    coverage_counts: dict[str, int] = Field(default_factory=dict)


class CoverageLedgerEnvelope(CamelModel):
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
        for module in self.modules:
            missing = [record_id for record_id in module.record_ids if record_id not in known]
            if missing:
                raise ValueError(
                    f"Module {module.module_id} references unknown records: {', '.join(missing)}"
                )
        return self


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_stem(value: str) -> str:
    return _SAFE_STEM_PATTERN.sub("-", value).strip("-.") or "record"


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _list(value: object | None) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
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
        f"Клиническая рекомендация «{title}» зарегистрирована в каталоге под идентификатором {official_id}. Редакция: {version}. Статус применения: {application_status or status}.",
        "",
        "# Применимость и классификация",
        "",
        _source_marker(record_id, "classification"),
        f"Коды МКБ-10: {_format_values(icd_codes)}. Возрастные категории: {_format_values(age_categories)}. Разработчик: {developer or 'не указан в каталоге'}.",
        "",
        "# Доступность источника",
        "",
        _source_marker(record_id, "coverage"),
        f"Состояние покрытия MiniMed: {coverage}. Права на распространение: {rights}. Полный текст не считается установленным, пока запись не имеет состояния published и не прошла проверку модуля.",
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
    aliases = [
        {
            "id": f"alias.{_safe_stem(record_id)}.title",
            "canonicalTerm": title,
            "alias": title,
            "category": "clinical-recommendation",
            "weight": 1.0,
        }
    ]
    return record_id, front, "\n".join(body).rstrip() + "\n", aliases


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
        f"Лекарственный препарат «{trade_name}». Регистрационный номер: {registration}. МНН: {_format_values(inn)}. Статус регистрации: {status}.",
        "",
        "# Форма и классификация",
        "",
        _source_marker(record_id, "classification"),
        f"АТХ: {_format_values(atc)}. Лекарственная форма: {dosage_form or 'не указана в каталоге'}. Дозировки/концентрации: {_format_values(strengths)}. Пути введения: {_format_values(routes)}.",
        "",
        "# Ограничения данных",
        "",
        _source_marker(record_id, "coverage"),
        f"Состояние покрытия MiniMed: {coverage}. Эта карточка не подтверждает дозы, показания, противопоказания или взаимодействия. Такие сведения становятся доверенными только из проверенной редакции инструкции с точной ссылкой на источник.",
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
        f"{document_type}: «{title}». Номер документа: {number or 'не указан'}. Электронный номер опубликования: {eo_number}.",
        "",
        "# Даты и орган",
        "",
        _source_marker(record_id, "publication"),
        f"Дата документа: {document_date or 'не указана'}. Дата официального опубликования: {publish_date or 'не указана'}. Орган(ы): {_format_values(authorities)}.",
        "",
        "# Применимость и ограничения",
        "",
        _source_marker(record_id, "coverage"),
        f"Состояние покрытия MiniMed: {coverage}. Наличие записи об опубликовании не доказывает текущую применимость, отсутствие изменений или связь с заменяющим актом. Эти отношения требуют отдельной проверки.",
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
    aliases = [
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
    for module in ledger.modules:
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
        for record_id in module.record_ids:
            record = records[record_id]
            document_id, front, body, record_aliases = _render_record(family, record)
            document_ids.append(document_id)
            aliases.extend(record_aliases)
            path = module_dir / f"{_safe_stem(document_id)}.md"
            path.write_text(f"---\n{front}\n---\n\n{body}", encoding="utf-8")
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
                coverage_counts=module.coverage_counts,
            )
        )
    report = CatalogModuleBuildReport(
        family=family,
        version=version,
        built_at=timestamp,
        source_ledger_checksum=_sha256_file(ledger_path),
        modules=builds,
        total_documents=sum(module.record_count for module in builds),
        warnings=warnings,
    )
    (target / "module-build-report.json").write_text(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return report
