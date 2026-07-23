from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast

import yaml
from pydantic import Field, model_validator

from .clinical_catalog import CoverageState, RightsState
from .models import CamelModel

LegalRecordStatus = Literal["published", "historical", "unknown"]
JsonTransport = Callable[[str, float], object]

_SPACE_PATTERN = re.compile(r"\s+")
_HTML_PATTERN = re.compile(r"<[^>]+>")
_SAFE_ID_PATTERN = re.compile(r"[^0-9A-Za-zА-Яа-я._-]+")
_ALLOWED_HOST = "publication.pravo.gov.ru"
_MAX_RESPONSE_BYTES = 64 * 1024 * 1024


def _normalized(value: object) -> str:
    return _SPACE_PATTERN.sub(" ", str(value).replace("ё", "е").lower()).strip()


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _HTML_PATTERN.sub(" ", str(value).replace("\xa0", " "))
    cleaned = _SPACE_PATTERN.sub(" ", cleaned).strip()
    return cleaned or None


def _optional_int(value: object | None) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256_json(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _as_object_dict(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    return {str(key): cast(object, item) for key, item in value.items()}


def _default_transport(url: str, timeout_seconds: float) -> object:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "MiniMed-Medbase/1.0 (+https://github.com/T-Damer/MiniMed)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(payload) > _MAX_RESPONSE_BYTES:
        raise ValueError("Legal API response exceeds the 64 MiB safety limit.")
    return json.loads(payload.decode("utf-8-sig"))


class LegalQuerySpec(CamelModel):
    id: str
    title: str
    block: str | None = None
    category: str | None = None
    signatory_authority_id: str | None = None
    document_type_ids: list[str] = Field(default_factory=list)
    document_text: str | None = None
    publish_date_from: str | None = None
    publish_date_to: str | None = None
    max_pages: int = Field(default=500, ge=1)


class LegalCatalogConfig(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    base_url: str = "https://publication.pravo.gov.ru"
    page_size: int = 200
    queries: list[LegalQuerySpec]

    @model_validator(mode="after")
    def validate_config(self) -> LegalCatalogConfig:
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme != "https" or parsed.hostname != _ALLOWED_HOST:
            raise ValueError(f"Legal catalog base URL must be https://{_ALLOWED_HOST}.")
        if self.page_size not in {10, 30, 100, 200}:
            raise ValueError("Legal API page size must be 10, 30, 100 or 200.")
        if not self.queries:
            raise ValueError("Legal catalog config must contain at least one query.")
        identifiers = [query.id for query in self.queries]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Legal catalog config contains duplicate query ids.")
        return self


class LegalModuleRule(CamelModel):
    id: str
    title: str
    keywords: list[str] = Field(default_factory=list)
    authority_keywords: list[str] = Field(default_factory=list)
    priority: int = 0
    fallback: bool = False


class LegalModuleTaxonomy(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    modules: list[LegalModuleRule]

    @model_validator(mode="after")
    def validate_modules(self) -> LegalModuleTaxonomy:
        identifiers = [module.id for module in self.modules]
        if not identifiers:
            raise ValueError("Legal module taxonomy is empty.")
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Legal module taxonomy contains duplicate module ids.")
        if sum(module.fallback for module in self.modules) != 1:
            raise ValueError("Legal module taxonomy must contain one fallback module.")
        return self


class LegalCatalogRecord(CamelModel):
    record_id: str
    document_id: str
    eo_number: str
    title: str
    name: str | None = None
    complex_name: str | None = None
    number: str | None = None
    document_date: str | None = None
    publish_date: str | None = None
    justice_registration_number: str | None = None
    justice_registration_date: str | None = None
    pages_count: int | None = None
    pdf_bytes: int | None = None
    signatory_authority_id: str | None = None
    signatory_authorities: list[str] = Field(default_factory=list)
    document_type_id: str | None = None
    document_type: str | None = None
    api_url: str
    status: LegalRecordStatus = "published"
    coverage_state: CoverageState = "metadata-only"
    rights: RightsState = "metadata-only"
    module_ids: list[str]
    primary_module_id: str
    matched_query_ids: list[str]
    notes: list[str] = Field(default_factory=list)
    raw_metadata: dict[str, object] = Field(default_factory=dict)


class LegalModulePlanEntry(CamelModel):
    module_id: str
    title: str
    record_ids: list[str]
    coverage_counts: dict[str, int]


class LegalCatalogSummary(CamelModel):
    total_records: int
    module_counts: dict[str, int]
    coverage_counts: dict[str, int]
    query_counts: dict[str, int]


class LegalCatalogLedger(CamelModel):
    schema_version: int = 1
    generated_at: str
    source: str
    query_config_checksum: str
    taxonomy_checksum: str
    raw_pages_checksum: str
    records: list[LegalCatalogRecord]
    modules: list[LegalModulePlanEntry]
    summary: LegalCatalogSummary
    warnings: list[str] = Field(default_factory=list)


def load_legal_config(path: Path) -> LegalCatalogConfig:
    payload: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Legal catalog config must be a YAML mapping.")
    return LegalCatalogConfig.model_validate(payload)


def load_legal_taxonomy(path: Path) -> LegalModuleTaxonomy:
    payload: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Legal module taxonomy must be a YAML mapping.")
    return LegalModuleTaxonomy.model_validate(payload)


def _query_parameters(query: LegalQuerySpec, page_size: int, page: int) -> list[tuple[str, str]]:
    parameters: list[tuple[str, str]] = [
        ("PageSize", str(page_size)),
        ("Index", str(page)),
        ("SortedBy", "4"),
        ("SortDestination", "2"),
    ]
    optional = {
        "Block": query.block,
        "Category": query.category,
        "SignatoryAuthorityId": query.signatory_authority_id,
        "DocumentText": query.document_text,
        "PublishDateFrom": query.publish_date_from,
        "PublishDateTo": query.publish_date_to,
    }
    parameters.extend((key, value) for key, value in optional.items() if value)
    parameters.extend(("DocumentTypeId", value) for value in query.document_type_ids)
    return parameters


def _api_url(config: LegalCatalogConfig, query: LegalQuerySpec, page: int) -> str:
    query_string = urllib.parse.urlencode(
        _query_parameters(query, config.page_size, page),
        doseq=True,
    )
    return f"{config.base_url.rstrip('/')}/api/Documents?{query_string}"


def _detail_api_url(config: LegalCatalogConfig, eo_number: str) -> str:
    query = urllib.parse.urlencode({"eoNumber": eo_number})
    return f"{config.base_url.rstrip('/')}/api/Document?{query}"


def _response_items(payload: object) -> tuple[list[dict[str, object]], int]:
    mapping = _as_object_dict(payload)
    if mapping is None:
        raise ValueError("Legal API response must be an object.")
    items = mapping.get("items")
    pages = mapping.get("pagesTotalCount", 1)
    if not isinstance(items, list):
        raise ValueError("Legal API response does not contain an items array.")
    rows: list[dict[str, object]] = []
    for index, item in enumerate(items):
        row = _as_object_dict(item)
        if row is None:
            raise ValueError(f"Legal API item {index + 1} is not an object.")
        rows.append(row)
    if not isinstance(pages, int) or isinstance(pages, bool) or pages < 0:
        raise ValueError("Legal API pagesTotalCount must be a non-negative integer.")
    return rows, pages


def _module_score(rule: LegalModuleRule, text: str, authorities: str) -> int:
    if rule.fallback:
        return 0
    score = 20 * sum(_normalized(keyword) in text for keyword in rule.keywords)
    score += 8 * sum(_normalized(keyword) in authorities for keyword in rule.authority_keywords)
    return score


def _assign_modules(
    taxonomy: LegalModuleTaxonomy,
    *,
    text: str,
    authorities: list[str],
) -> tuple[list[LegalModuleRule], LegalModuleRule]:
    fallback = next(module for module in taxonomy.modules if module.fallback)
    normalized_text = _normalized(text)
    normalized_authorities = _normalized(" ".join(authorities))
    scored = [
        (_module_score(module, normalized_text, normalized_authorities), module)
        for module in taxonomy.modules
        if not module.fallback
    ]
    matches = [pair for pair in scored if pair[0] > 0]
    matches.sort(key=lambda pair: (-pair[0], -pair[1].priority, pair[1].id))
    if not matches:
        return [fallback], fallback
    module_rules = [module for _score, module in matches]
    return module_rules, module_rules[0]


def _record_id(eo_number: str) -> str:
    safe = _SAFE_ID_PATTERN.sub("-", eo_number).strip("-.")
    return f"law.ru.{safe or 'unknown'}"


def _authorities(detail: dict[str, object] | None) -> list[str]:
    if detail is None:
        return []
    value = detail.get("signatoryAuthorities")
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for authority in value:
        mapping = _as_object_dict(authority)
        if mapping is None:
            continue
        name = _clean(mapping.get("name"))
        if name and name not in result:
            result.append(name)
    return result


def _document_type(detail: dict[str, object] | None) -> str | None:
    if detail is None:
        return None
    value = _as_object_dict(detail.get("documentType"))
    return _clean(value.get("name")) if value is not None else None


def _build_record(
    *,
    config: LegalCatalogConfig,
    query: LegalQuerySpec,
    item: dict[str, object],
    detail: dict[str, object] | None,
    taxonomy: LegalModuleTaxonomy,
) -> LegalCatalogRecord | None:
    eo_number = _clean(item.get("eoNumber"))
    document_id = _clean(item.get("id"))
    title = _clean(item.get("title")) or _clean(item.get("complexName"))
    if eo_number is None or document_id is None or title is None:
        return None
    authorities = _authorities(detail)
    document_type = _document_type(detail)
    name = _clean(item.get("name"))
    complex_name = _clean(item.get("complexName"))
    classification_text = " ".join(
        value for value in (title, name, complex_name, document_type) if value
    )
    module_rules, primary_rule = _assign_modules(
        taxonomy,
        text=classification_text,
        authorities=authorities,
    )
    raw_metadata: dict[str, object] = dict(item)
    if detail is not None:
        raw_metadata["detail"] = detail
    return LegalCatalogRecord(
        record_id=_record_id(eo_number),
        document_id=document_id,
        eo_number=eo_number,
        title=title,
        name=name,
        complex_name=complex_name,
        number=_clean(item.get("number")),
        document_date=_clean(item.get("documentDate")),
        publish_date=_clean(item.get("publishDateShort")),
        justice_registration_number=_clean(item.get("jdRegNumber")),
        justice_registration_date=_clean(item.get("jdRegDate")),
        pages_count=_optional_int(item.get("pagesCount")),
        pdf_bytes=_optional_int(item.get("pdfFileLength")),
        signatory_authority_id=_clean(item.get("signatoryAuthorityId")),
        signatory_authorities=authorities,
        document_type_id=_clean(item.get("documentTypeId")),
        document_type=document_type,
        api_url=_detail_api_url(config, eo_number),
        module_ids=[module.id for module in module_rules],
        primary_module_id=primary_rule.id,
        matched_query_ids=[query.id],
        notes=[
            "Metadata collected from the read-only official publication API.",
            ("Full-text/PDF packaging requires a separate source-asset and applicability pass."),
        ],
        raw_metadata=raw_metadata,
    )


def _module_plan(
    records: list[LegalCatalogRecord],
    taxonomy: LegalModuleTaxonomy,
) -> list[LegalModulePlanEntry]:
    grouped: dict[str, list[LegalCatalogRecord]] = defaultdict(list)
    for record in records:
        for module_id in record.module_ids:
            grouped[module_id].append(record)
    result: list[LegalModulePlanEntry] = []
    for rule in sorted(taxonomy.modules, key=lambda item: (-item.priority, item.id)):
        members = grouped.get(rule.id, [])
        if not members:
            continue
        result.append(
            LegalModulePlanEntry(
                module_id=rule.id,
                title=rule.title,
                record_ids=[record.record_id for record in members],
                coverage_counts=dict(Counter(record.coverage_state for record in members)),
            )
        )
    return result


def collect_legal_catalog(
    config_path: Path,
    taxonomy_path: Path,
    output: Path,
    *,
    raw_output: Path | None = None,
    include_details: bool = True,
    timeout_seconds: float = 60.0,
    transport: JsonTransport = _default_transport,
    generated_at: str | None = None,
) -> LegalCatalogLedger:
    config = load_legal_config(config_path)
    taxonomy = load_legal_taxonomy(taxonomy_path)
    raw_responses: list[dict[str, object]] = []
    warnings: list[str] = []
    records_by_eo: dict[str, LegalCatalogRecord] = {}
    query_counts: Counter[str] = Counter()

    for query in config.queries:
        page = 1
        total_pages = 1
        while page <= min(total_pages, query.max_pages):
            url = _api_url(config, query, page)
            payload = transport(url, timeout_seconds)
            items, total_pages = _response_items(payload)
            raw_responses.append(
                {"kind": "list", "queryId": query.id, "page": page, "url": url, "payload": payload}
            )
            for item in items:
                eo_number = _clean(item.get("eoNumber"))
                if eo_number is None:
                    warnings.append(f"{query.id} page {page}: skipped item without eoNumber")
                    continue
                query_counts[query.id] += 1
                existing = records_by_eo.get(eo_number)
                if existing is not None:
                    if query.id not in existing.matched_query_ids:
                        existing.matched_query_ids.append(query.id)
                    continue
                detail: dict[str, object] | None = None
                if include_details:
                    detail_url = _detail_api_url(config, eo_number)
                    detail_payload = transport(detail_url, timeout_seconds)
                    detail = _as_object_dict(detail_payload)
                    raw_responses.append(
                        {
                            "kind": "detail",
                            "eoNumber": eo_number,
                            "url": detail_url,
                            "payload": detail_payload,
                        }
                    )
                    if detail is None:
                        warnings.append(f"{eo_number}: detail response was not an object")
                record = _build_record(
                    config=config,
                    query=query,
                    item=item,
                    detail=detail,
                    taxonomy=taxonomy,
                )
                if record is None:
                    warnings.append(
                        f"{query.id} page {page}: skipped item without id, eoNumber or title"
                    )
                    continue
                records_by_eo[eo_number] = record
            page += 1
        if total_pages > query.max_pages:
            warnings.append(
                f"{query.id}: limited to {query.max_pages} of {total_pages} API result pages"
            )

    records = sorted(
        records_by_eo.values(),
        key=lambda item: (item.primary_module_id, item.publish_date or "", item.eo_number),
        reverse=True,
    )
    module_plan = _module_plan(records, taxonomy)
    ledger = LegalCatalogLedger(
        generated_at=generated_at or _utc_now(),
        source=f"{config.base_url.rstrip('/')}/api/Documents",
        query_config_checksum=_sha256_json(config.model_dump(by_alias=True, mode="json")),
        taxonomy_checksum=_sha256_json(taxonomy.model_dump(by_alias=True, mode="json")),
        raw_pages_checksum=_sha256_json(raw_responses),
        records=records,
        modules=module_plan,
        summary=LegalCatalogSummary(
            total_records=len(records),
            module_counts={module.module_id: len(module.record_ids) for module in module_plan},
            coverage_counts=dict(Counter(record.coverage_state for record in records)),
            query_counts=dict(query_counts),
        ),
        warnings=warnings,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(ledger.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    if raw_output is not None:
        raw_output.parent.mkdir(parents=True, exist_ok=True)
        raw_output.write_text(
            json.dumps(raw_responses, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return ledger
