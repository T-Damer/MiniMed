from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import cast

import yaml
from pydantic import Field

from .esklp_grls_crosswalk import (
    EsklpGrlsCrosswalk,
    EsklpPresentation,
    EsklpRegistration,
    build_esklp_grls_crosswalk,
)
from .instruction_card_drafts import (
    instruction_body_fact_segments,
    instruction_dosage_drafts,
    instruction_fact_type_for_heading,
)
from .knowledge import (
    KnowledgeDocumentLink,
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeFact,
    KnowledgeName,
    KnowledgeRelation,
    KnowledgeReviewTask,
    KnowledgeWorkspace,
    MedicationProfile,
    RelationWeightComponents,
    load_workspace_documents,
    validate_knowledge_workspace,
)
from .models import CamelModel, PackChunk, PackDocument, RegistrySource
from .source_registry import load_source_registry

_SPACE_PATTERN = re.compile(r"\s+")
_ENTRY_SPLIT_PATTERN = re.compile(r";\s+(?=[^/;]{1,160},\s*\d)")
_STRENGTH_FIELD_PATTERN = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:мкг|мг|кг|г|ме|ед|%)",
    re.IGNORECASE,
)
_TRADEMARK_PATTERN = re.compile(r"[®™℠]")
_ROUTES = (
    ("для приема внутрь", "oral"),
    ("внутрив", "parenteral"),
    ("внутримыш", "parenteral"),
    ("для местного", "topical"),
    ("наружн", "topical"),
    ("ингаля", "inhalation"),
    ("ректаль", "rectal"),
    ("вагиналь", "vaginal"),
    ("глазн", "ophthalmic"),
    ("офтальм", "ophthalmic"),
    ("назаль", "nasal"),
)


class GrlsPackage(CamelModel):
    description: str
    prescription_status: str | None = None
    raw_text: str


class GrlsPresentation(CamelModel):
    dosage_form: str
    strength: str | None = None
    route: str | None = None
    packages: list[GrlsPackage] = Field(default_factory=list)


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", str(value).replace("\xa0", " ")).strip(" ;")
    return cleaned or None


def _normalized(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value.casefold().replace("ё", "е")).strip()


def _trade_name_key(value: str) -> str:
    return _normalized(_TRADEMARK_PATTERN.sub("", value))


def _stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(_normalized(value).encode()).hexdigest()[:16]
    return f"{prefix}.{digest}"


def _sha256_json(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _route_for_form(dosage_form: str) -> str | None:
    normalized = _normalized(dosage_form)
    return next((route for marker, route in _ROUTES if marker in normalized), None)


def _prescription_status(value: str) -> str | None:
    normalized = _normalized(value)
    if "без рецепта" in normalized:
        return "Без рецепта"
    if "по рецепту" in normalized:
        return "По рецепту"
    return None


def _display_strength(value: str) -> str:
    return value.replace("|", "/")


def parse_grls_presentations(value: object | None) -> list[GrlsPresentation]:
    raw = _clean(value)
    if raw is None:
        return []
    entries = [entry.strip(" ;") for entry in _ENTRY_SPLIT_PATTERN.split(raw) if entry.strip(" ;")]
    grouped: dict[tuple[str, str], GrlsPresentation] = {}
    seen_packages: dict[tuple[str, str], set[str]] = {}
    for entry in entries:
        parts = [part.strip() for part in entry.split(",")]
        strength_index = next(
            (
                index
                for index, part in enumerate(parts[1:], start=1)
                if _STRENGTH_FIELD_PATTERN.search(part)
            ),
            None,
        )
        if strength_index is None:
            continue
        dosage_form = _clean(", ".join(parts[:strength_index]))
        raw_strength = _clean(parts[strength_index])
        if dosage_form is None or raw_strength is None:
            continue
        strength = _display_strength(raw_strength)
        package_text = _clean(", ".join(parts[strength_index + 1 :])) or entry
        status = _prescription_status(package_text)
        description = re.sub(
            r"\s+-\s+(?:По рецепту|Без рецепта)\s*$",
            "",
            package_text,
            flags=re.IGNORECASE,
        ).strip()
        key = (_normalized(dosage_form), _normalized(strength))
        presentation = grouped.get(key)
        if presentation is None:
            presentation = GrlsPresentation(
                dosage_form=dosage_form,
                strength=strength,
                route=_route_for_form(dosage_form),
            )
            grouped[key] = presentation
            seen_packages[key] = set()
        package_key = _normalized(entry)
        if package_key not in seen_packages[key]:
            presentation.packages.append(
                GrlsPackage(
                    description=description,
                    prescription_status=status,
                    raw_text=entry,
                )
            )
            seen_packages[key].add(package_key)
    return list(grouped.values())


def _split_values(value: object | None, separator: str = ";") -> list[str]:
    raw = _clean(value)
    if raw is None:
        return []
    values: list[str] = []
    for item in raw.split(separator):
        cleaned = _clean(item)
        if cleaned and _normalized(cleaned) not in {_normalized(existing) for existing in values}:
            values.append(cleaned)
    return values


def _split_inn(value: object | None) -> list[str]:
    return [
        cleaned
        for part in _split_values(value, "+")
        if (cleaned := _clean(part.strip("[]"))) is not None
    ]


def _load_catalog(path: Path) -> tuple[dict[str, dict[str, object]], dict[str, object]]:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("records"), list):
        raise ValueError("GRLS catalog must contain a records list.")
    records: dict[str, dict[str, object]] = {}
    for item in payload["records"]:
        if not isinstance(item, dict):
            raise ValueError("Every GRLS catalog record must be an object.")
        record = {str(key): value for key, value in item.items()}
        registration_number = _clean(record.get("registrationNumber"))
        if registration_number is None:
            continue
        if registration_number in records:
            raise ValueError(f"Duplicate GRLS registration: {registration_number}.")
        records[registration_number] = record
    return records, {str(key): value for key, value in payload.items() if key != "records"}


def _registry_document_id(registration_number: str) -> str:
    return _stable_id("drug.registry.ru", registration_number)


def _presentation_heading(presentation: GrlsPresentation) -> str:
    suffix = presentation.strength or "дозировка не указана"
    return f"{presentation.dosage_form} — {suffix}"


def _source_marker(record: dict[str, object], fields: list[str]) -> str:
    marker = {
        "recordId": record["registrationNumber"],
        "sourceEdition": record.get("sourceEdition"),
        "sourceWorkbook": record.get("sourceWorkbook"),
        "fields": fields,
    }
    return (
        f"<!-- localmed:source {json.dumps(marker, ensure_ascii=False, separators=(',', ':'))} -->"
    )


def _write_registry_card(
    workspace: Path,
    record: dict[str, object],
    presentations: list[GrlsPresentation],
    *,
    instruction_document_id: str,
    esklp_crosswalk_status: str | None,
    esklp_metadata: dict[str, object] | None,
) -> Path:
    registration_number = cast(str, record["registrationNumber"])
    trade_name = cast(str, record["tradeName"])
    inn = _clean(record.get("inn")) or "не указано"
    status = _clean(record.get("status")) or "не указан"
    source_edition = _clean(record.get("sourceEdition")) or "unknown"
    groups = _split_values(record.get("pharmacotherapeuticGroup"))
    document_metadata: dict[str, object] = {
        "authorityTier": "official-registry",
        "officialSourceUrl": record.get("officialUrl"),
        "registrationNumber": registration_number,
        "tradeName": trade_name,
        "inn": inn,
        "registrationStatus": status,
        "prescriptionStatus": _clean(record.get("prescriptionStatus")),
        "holder": _clean(record.get("holder")),
        "manufacturer": _clean(record.get("manufacturer")),
        "registrationDate": _clean(record.get("registrationDate")),
        "pharmacotherapeuticGroups": groups,
        "presentations": [
            presentation.model_dump(by_alias=True, mode="json") for presentation in presentations
        ],
        "instructionDocumentId": instruction_document_id,
        "sourceEdition": source_edition,
        "sourceWorkbook": record.get("sourceWorkbook"),
        "contentMode": "registry-normalized",
        "rights": {
            "licenseId": "grls-redistribution-review-required",
            "allowsDerivativeProcessing": False,
            "allowsRedistribution": False,
        },
    }
    if esklp_crosswalk_status is not None:
        document_metadata["esklpCrosswalkStatus"] = esklp_crosswalk_status
    if esklp_metadata is not None:
        document_metadata.update(esklp_metadata)
        for source_key, target_key in (
            ("esklpMnnDocumentId", "mnnDocumentId"),
            ("esklpStandardizedInn", "standardizedInn"),
            ("esklpSmnnCode", "smnnCode"),
            ("esklpSmnnCodes", "smnnCodes"),
            ("esklpKlpCodes", "klpCodes"),
        ):
            if source_key in esklp_metadata:
                document_metadata[target_key] = esklp_metadata[source_key]

    metadata = {
        "id": _registry_document_id(registration_number),
        "title": f"{trade_name}: регистрационная карточка ГРЛС",
        "short_title": trade_name,
        "version_label": f"grls-{source_edition.replace('.', '-')}",
        "source_type": "official_registry_summary",
        "status": "active" if "действ" in _normalized(status) else "historical",
        "source_file": record.get("officialUrl"),
        "source_checksum": _sha256_json(record),
        "synthetic_fixture": False,
        "metadata": document_metadata,
    }
    groups_text = "; ".join(groups) if groups else "не указана"
    summary = (
        f"В Государственном реестре лекарственных средств зарегистрирован препарат "
        f"«{trade_name}». МНН: {inn}. Регистрационное удостоверение: "
        f"{registration_number}. Статус: {status}. Фармакотерапевтическая группа: "
        f"{groups_text}."
    )
    body = [
        "# Регистрационная запись",
        "",
        _source_marker(
            record,
            [
                "tradeName",
                "inn",
                "registrationNumber",
                "status",
                "pharmacotherapeuticGroup",
            ],
        ),
        summary,
        "",
        "# Формы и дозировки",
        "",
    ]
    for presentation in presentations:
        package_descriptions = "; ".join(item.description for item in presentation.packages)
        prescription_statuses = sorted(
            {
                item.prescription_status
                for item in presentation.packages
                if item.prescription_status is not None
            }
        )
        strength_text = presentation.strength or "не указана"
        body.extend(
            [
                f"## {_presentation_heading(presentation)}",
                "",
                _source_marker(record, ["tradeName", "inn", "registrationNumber", "releaseForms"]),
                (
                    f"Препарат «{trade_name}», МНН — {inn}, регистрационное удостоверение "
                    f"{registration_number}: лекарственная форма — {presentation.dosage_form}; "
                    f"дозировка — {strength_text}; варианты упаковки — "
                    f"{package_descriptions or 'не указаны'}; условия отпуска — "
                    f"{', '.join(prescription_statuses) or 'не указаны'}."
                ),
                "",
            ]
        )
    path = workspace / f"{_registry_document_id(registration_number)}.md"
    path.write_text(
        "---\n"
        + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False)
        + "---\n\n"
        + "\n".join(body).rstrip()
        + "\n",
        encoding="utf-8",
    )
    return path


def _document_by_registration(
    documents: Iterable[PackDocument], *, source_type: str
) -> dict[str, PackDocument]:
    result: dict[str, PackDocument] = {}
    for document in documents:
        if document.source_type != source_type:
            continue
        registration_number = document.metadata.get("registrationNumber")
        if isinstance(registration_number, str):
            result[registration_number] = document
    return result


def _section_chunk(document: PackDocument, title: str) -> PackChunk:
    for section in document.sections:
        if section.title == title and section.chunks:
            return section.chunks[0]
    raise ValueError(f"{document.id}: no source chunk for section {title!r}.")


def _evidence(
    document: PackDocument,
    chunk: PackChunk,
    registration_number: str,
    *,
    quote: str | None = None,
    start_offset: int | None = None,
    end_offset: int | None = None,
) -> list[KnowledgeEvidence]:
    section = next(
        section
        for section in document.sections
        if any(item.id == chunk.id for item in section.chunks)
    )
    source_locator: dict[str, object] = {
        "registrationNumber": registration_number,
        "anchor": chunk.anchor,
        "pageStart": chunk.page_start,
        "pageEnd": chunk.page_end,
        "sourceSpans": chunk.metadata.get("sourceSpans", []),
    }
    if start_offset is not None:
        source_locator["startOffset"] = start_offset
    if end_offset is not None:
        source_locator["endOffset"] = end_offset
    return [
        KnowledgeEvidence(
            document_id=document.id,
            document_version_id=document.version.id,
            section_id=section.id,
            chunk_id=chunk.id,
            quote=quote or chunk.original_text,
            source_locator=source_locator,
        )
    ]


def _instruction_facts(
    document: PackDocument,
    registration_id: str,
    registration_number: str,
) -> list[KnowledgeFact]:
    extraction = document.metadata.get("extraction")
    requires_review = isinstance(extraction, dict) and extraction.get("requiresReview") is True
    facts: list[KnowledgeFact] = []
    for section in document.sections:
        fact_type = instruction_fact_type_for_heading(section.title)
        for chunk in section.chunks:
            segments = (
                [(fact_type, 0, len(chunk.original_text), chunk.original_text)]
                if fact_type is not None
                else instruction_body_fact_segments(chunk.original_text)
            )
            for segment_type, start, end, segment_quote in segments:
                match_kind = (
                    "exact-section-heading" if fact_type is not None else "body-heading-segment"
                )
                fact_id = _stable_id(
                    "fact.grls",
                    f"{registration_id}|{segment_type}|{chunk.id}|{start}",
                )
                facts.append(
                    KnowledgeFact(
                        id=fact_id,
                        entity_id=registration_id,
                        fact_type=segment_type,
                        text=segment_quote,
                        authority_tier="official-label",
                        review_status="proposed",
                        evidence=_evidence(
                            document,
                            chunk,
                            registration_number,
                            quote=segment_quote,
                            start_offset=start,
                            end_offset=end,
                        ),
                        metadata={
                            "projectionKind": "exact-instruction-section",
                            "matchKind": match_kind,
                            "sectionTitle": section.title,
                            "sourceExtractionRequiresReview": requires_review,
                        },
                    )
                )
                if segment_type != "administration":
                    continue
                for dosage in instruction_dosage_drafts(segment_quote):
                    dosage_start = start + dosage.start
                    dosage_end = start + dosage.end
                    facts.append(
                        KnowledgeFact(
                            id=_stable_id(
                                "fact.grls",
                                f"{registration_id}|dosage|{chunk.id}|{dosage_start}",
                            ),
                            entity_id=registration_id,
                            fact_type="dosage",
                            text=dosage.quote,
                            structured=dosage.structured,
                            population=dosage.population,
                            approval_status="registered",
                            authority_tier="official-label",
                            review_status="proposed",
                            evidence=_evidence(
                                document,
                                chunk,
                                registration_number,
                                quote=dosage.quote,
                                start_offset=dosage_start,
                                end_offset=dosage_end,
                            ),
                            metadata={
                                "projectionKind": "exact-instruction-dosage-paragraph",
                                "extractionRule": "instruction-dosage-v1",
                                "parentAdministrationFactId": fact_id,
                                "sectionTitle": section.title,
                                "sourceExtractionRequiresReview": requires_review,
                            },
                        )
                    )
    return facts


def _relation(
    subject_id: str,
    predicate: str,
    object_id: str,
    evidence: list[KnowledgeEvidence],
) -> KnowledgeRelation:
    relation_id = _stable_id("relation.grls", f"{subject_id}|{predicate}|{object_id}")
    return KnowledgeRelation(
        id=relation_id,
        subject_entity_id=subject_id,
        predicate=predicate,
        object_entity_id=object_id,
        relation_status="registry-identity",
        authority_tier="official-registry",
        review_status="proposed",
        weights=RelationWeightComponents(
            authority=0.95,
            evidence_quality=1.0,
            applicability=1.0,
            recency=1.0,
            editorial_review=0.0,
        ),
        evidence=evidence,
    )


def _add_entity(entities: dict[str, KnowledgeEntity], entity: KnowledgeEntity) -> None:
    existing = entities.get(entity.id)
    if existing is None:
        entities[entity.id] = entity
        return
    if existing.model_dump(mode="json") != entity.model_dump(mode="json"):
        raise ValueError(f"Conflicting generated GRLS entity: {entity.id}.")


def _add_document_link(
    links: dict[str, KnowledgeDocumentLink],
    *,
    entity_id: str,
    document: PackDocument,
    link_type: str,
    metadata: dict[str, object] | None = None,
) -> None:
    link_id = _stable_id("link.grls", f"{entity_id}|{document.version.id}|{link_type}")
    links[link_id] = KnowledgeDocumentLink(
        id=link_id,
        entity_id=entity_id,
        document_id=document.id,
        document_version_id=document.version.id,
        link_type=link_type,
        review_status="proposed",
        metadata=metadata or {},
    )


def _crosswalk_presentations(
    entry: EsklpRegistration,
    trade_name: str,
    presentation: GrlsPresentation | None = None,
) -> tuple[list[EsklpPresentation], str]:
    trade_key = _trade_name_key(trade_name)
    candidates = [
        item
        for item in entry.presentations
        if item.trade_name is not None and _trade_name_key(item.trade_name) == trade_key
    ]
    if not candidates:
        candidates = [item for item in entry.presentations if item.trade_name is None]
    if not candidates:
        return [], "registration"
    if presentation is None:
        return candidates, "registration-and-trade"

    exact = [
        item
        for item in candidates
        if (
            presentation.dosage_form is None
            or (
                item.dosage_form is not None
                and _normalized(item.dosage_form) == _normalized(presentation.dosage_form)
            )
        )
        and (
            presentation.strength is None
            or (
                item.strength is not None
                and _normalized(item.strength) == _normalized(presentation.strength)
            )
        )
    ]
    return (
        exact or candidates
    ), "exact-registration-trade-presentation" if exact else "registration-and-trade"


def _crosswalk_metadata(
    entry: EsklpRegistration,
    trade_name: str,
    presentation: GrlsPresentation | None = None,
) -> dict[str, object]:
    presentations, match_level = _crosswalk_presentations(entry, trade_name, presentation)
    smnn_codes = sorted({item.smnn_code for item in presentations})
    klp_codes = sorted({code for item in presentations for code in item.klp_codes})
    metadata: dict[str, object] = {
        "esklpMnnDocumentIds": entry.mnn_document_ids,
        "esklpStandardizedInns": entry.standardized_inns,
        "esklpTradeNames": entry.trade_names,
        "esklpRegistrationNumber": entry.registration_number,
        "esklpSmnnCodes": smnn_codes,
        "esklpKlpCodes": klp_codes,
        "esklpPresentations": [
            item.model_dump(by_alias=True, mode="json") for item in presentations
        ],
        "esklpMatch": match_level,
    }
    if entry.mnn_document_id is not None:
        metadata["esklpMnnDocumentId"] = entry.mnn_document_id
    if entry.standardized_inn is not None:
        metadata["esklpStandardizedInn"] = entry.standardized_inn
    if len(smnn_codes) == 1:
        metadata["esklpSmnnCode"] = smnn_codes[0]
    if len(klp_codes) == 1:
        metadata["esklpKlpCode"] = klp_codes[0]
    return metadata


def _crosswalk_status_metadata(
    crosswalk: EsklpGrlsCrosswalk,
    registration_number: str,
    trade_name: str,
) -> tuple[EsklpRegistration | None, dict[str, object] | None]:
    entry = crosswalk.resolve(registration_number, trade_name)
    if entry is None:
        return None, None
    if entry.status != "matched":
        return entry, None
    return entry, _crosswalk_metadata(entry, trade_name)


def _source_registration(source: RegistrySource) -> str:
    registration_number = source.metadata.get("registrationNumber")
    if not isinstance(registration_number, str) or not registration_number.strip():
        raise ValueError(f"{source.id}: metadata.registrationNumber is required.")
    return registration_number


def build_grls_product_workspace(
    catalog_path: Path,
    registry_path: Path,
    workspace: Path,
    output: Path,
    *,
    report_output: Path | None = None,
    esklp_packs: Sequence[Path] | None = None,
) -> dict[str, object]:
    records, catalog_metadata = _load_catalog(catalog_path)
    registry = load_source_registry(registry_path)
    crosswalk = build_esklp_grls_crosswalk(esklp_packs) if esklp_packs is not None else None
    workspace.mkdir(parents=True, exist_ok=True)
    selected: list[tuple[RegistrySource, dict[str, object], list[GrlsPresentation]]] = []
    cards: list[Path] = []
    crosswalk_results: dict[str, tuple[EsklpRegistration | None, dict[str, object] | None]] = {}
    for source in registry.sources:
        registration_number = _source_registration(source)
        record = records.get(registration_number)
        if record is None:
            raise ValueError(f"GRLS catalog does not contain {registration_number}.")
        presentations = parse_grls_presentations(record.get("releaseForms"))
        crosswalk_entry: EsklpRegistration | None = None
        crosswalk_metadata: dict[str, object] | None = None
        crosswalk_status: str | None = None
        if crosswalk is not None:
            trade_name = cast(str, record["tradeName"])
            crosswalk_entry, crosswalk_metadata = _crosswalk_status_metadata(
                crosswalk, registration_number, trade_name
            )
            crosswalk_status = "unmatched" if crosswalk_entry is None else crosswalk_entry.status
            crosswalk_results[registration_number] = (crosswalk_entry, crosswalk_metadata)
        cards.append(
            _write_registry_card(
                workspace,
                record,
                presentations,
                instruction_document_id=source.id,
                esklp_crosswalk_status=crosswalk_status,
                esklp_metadata=crosswalk_metadata,
            )
        )
        selected.append((source, record, presentations))

    documents = load_workspace_documents(workspace)
    registry_documents = _document_by_registration(
        documents, source_type="official_registry_summary"
    )
    instruction_documents = _document_by_registration(
        documents, source_type="official_drug_instruction"
    )
    entities: dict[str, KnowledgeEntity] = {}
    facts: dict[str, KnowledgeFact] = {}
    relations: dict[str, KnowledgeRelation] = {}
    document_links: dict[str, KnowledgeDocumentLink] = {}
    review_tasks: dict[str, KnowledgeReviewTask] = {}
    crosswalk_counts = {"matched": 0, "ambiguous": 0, "unmatched": 0}
    brand_inns: dict[str, set[str]] = {}
    brand_mnn_document_ids: dict[str, set[str]] = {}
    brand_standardized_inns: dict[str, set[str]] = {}

    for source, record, _presentations in selected:
        registration_number = _source_registration(source)
        trade_name = cast(str, record["tradeName"])
        brand_id = _stable_id("medication.brand", trade_name)
        inn = _clean(record.get("inn"))
        if inn and inn != "~":
            brand_inns.setdefault(brand_id, set()).add(inn)
        if crosswalk is None:
            continue
        crosswalk_entry = crosswalk_results[registration_number][0]
        if crosswalk_entry is None or crosswalk_entry.status != "matched":
            continue
        brand_mnn_document_ids.setdefault(brand_id, set()).update(crosswalk_entry.mnn_document_ids)
        brand_standardized_inns.setdefault(brand_id, set()).update(
            crosswalk_entry.standardized_inns
        )

    for source, record, presentations in selected:
        registration_number = _source_registration(source)
        trade_name = cast(str, record["tradeName"])
        inn = _clean(record.get("inn"))
        substances = _split_inn(inn)
        groups = _split_values(record.get("pharmacotherapeuticGroup"))
        registry_document = registry_documents[registration_number]
        instruction_document = instruction_documents.get(registration_number)
        identity_chunk = _section_chunk(registry_document, "Регистрационная запись")
        identity_evidence = _evidence(registry_document, identity_chunk, registration_number)
        crosswalk_entry: EsklpRegistration | None = None
        crosswalk_metadata: dict[str, object] | None = None
        if crosswalk is not None:
            crosswalk_entry, crosswalk_metadata = crosswalk_results[registration_number]
            status = "unmatched" if crosswalk_entry is None else crosswalk_entry.status
            crosswalk_counts[status] += 1

        brand_id = _stable_id("medication.brand", trade_name)
        brand_metadata: dict[str, object] = {}
        if mnn_document_ids := sorted(brand_mnn_document_ids.get(brand_id, set())):
            brand_metadata["esklpMnnDocumentIds"] = mnn_document_ids
        if standardized_inns := sorted(brand_standardized_inns.get(brand_id, set())):
            brand_metadata["esklpStandardizedInns"] = standardized_inns
        _add_entity(
            entities,
            KnowledgeEntity(
                id=brand_id,
                entity_type="medication",
                canonical_name=trade_name,
                names=[KnowledgeName(name=trade_name, name_type="trade-name", weight=1.1)],
                medication=MedicationProfile(
                    concept_level="brand",
                    inn="; ".join(sorted(brand_inns.get(brand_id, set()))) or None,
                    metadata={"jurisdiction": "RU", **brand_metadata},
                ),
                metadata=brand_metadata,
            ),
        )
        registration_id = _stable_id("medication.registration", registration_number)
        registration_metadata: dict[str, object] = {
            "holder": record.get("holder"),
            "manufacturer": record.get("manufacturer"),
            "registrationDate": record.get("registrationDate"),
            "sourceEdition": record.get("sourceEdition"),
        }
        if crosswalk is not None:
            registration_metadata["esklpCrosswalkStatus"] = (
                "unmatched" if crosswalk_entry is None else crosswalk_entry.status
            )
            if crosswalk_entry is not None and crosswalk_entry.status == "ambiguous":
                registration_metadata["esklpCrosswalkReasons"] = crosswalk_entry.ambiguity_reasons
            elif crosswalk_metadata is not None:
                registration_metadata.update(crosswalk_metadata)
        registration_external_ids: dict[str, str] = {"ru-registration-number": registration_number}
        if crosswalk_metadata is not None:
            mnn_document_id = crosswalk_metadata.get("esklpMnnDocumentId")
            if isinstance(mnn_document_id, str):
                registration_external_ids["esklp-mnn-document-id"] = mnn_document_id
        _add_entity(
            entities,
            KnowledgeEntity(
                id=registration_id,
                entity_type="medication",
                canonical_name=f"{trade_name} — {registration_number}",
                external_ids=registration_external_ids,
                medication=MedicationProfile(
                    concept_level="registration",
                    inn=inn,
                    registration_number=registration_number,
                    registration_status=_clean(record.get("status")),
                    metadata=registration_metadata,
                ),
                metadata=registration_metadata,
            ),
        )
        brand_registration = _relation(
            brand_id,
            "registered-as",
            registration_id,
            identity_evidence,
        )
        relations[brand_registration.id] = brand_registration
        _add_document_link(
            document_links,
            entity_id=registration_id,
            document=registry_document,
            link_type="registration-record",
            metadata=crosswalk_metadata,
        )
        if crosswalk_metadata is not None:
            _add_document_link(
                document_links,
                entity_id=brand_id,
                document=registry_document,
                link_type="brand-registration-record",
                metadata=crosswalk_metadata,
            )

        substance_ids: list[str] = []
        for substance in substances:
            substance_id = _stable_id("medication.substance", substance)
            substance_ids.append(substance_id)
            _add_entity(
                entities,
                KnowledgeEntity(
                    id=substance_id,
                    entity_type="medication",
                    canonical_name=substance,
                    names=[KnowledgeName(name=substance, name_type="inn", weight=1.2)],
                    medication=MedicationProfile(
                        concept_level="substance",
                        inn=substance,
                    ),
                ),
            )

        class_ids: list[str] = []
        for group in groups:
            class_id = _stable_id("medication.class", group)
            class_ids.append(class_id)
            existing_class = entities.get(class_id)
            if existing_class is not None and _normalized(
                existing_class.canonical_name
            ) == _normalized(group):
                if group not in {name.name for name in existing_class.names}:
                    existing_class.names.append(
                        KnowledgeName(name=group, name_type="official-group", weight=1.0)
                    )
                continue
            _add_entity(
                entities,
                KnowledgeEntity(
                    id=class_id,
                    entity_type="medication-class",
                    canonical_name=group,
                    names=[KnowledgeName(name=group, name_type="official-group", weight=1.0)],
                    metadata={"source": "GRLS", "jurisdiction": "RU"},
                ),
            )
        for child_id, parent_id in zip(class_ids[1:], class_ids, strict=False):
            relation = _relation(child_id, "subclass-of", parent_id, identity_evidence)
            relations[relation.id] = relation

        if not presentations:
            task_id = _stable_id("review.grls", f"{registration_number}|presentations")
            review_tasks[task_id] = KnowledgeReviewTask(
                id=task_id,
                task_type="registry-normalization",
                target_id=registration_id,
                question="Не удалось выделить лекарственную форму и дозировку из строки ГРЛС.",
                missing_fields=["dosage-form", "strength", "packages"],
                priority=90,
                metadata={"registrationNumber": registration_number},
            )
        for presentation in presentations:
            presentation_crosswalk_metadata = (
                _crosswalk_metadata(crosswalk_entry, trade_name, presentation)
                if crosswalk_entry is not None and crosswalk_entry.status == "matched"
                else {}
            )
            presentation_external_ids: dict[str, str] = {
                "ru-registration-number": registration_number
            }
            mnn_document_id = presentation_crosswalk_metadata.get("esklpMnnDocumentId")
            if isinstance(mnn_document_id, str):
                presentation_external_ids["esklp-mnn-document-id"] = mnn_document_id
            presentation_id = _stable_id(
                "medication.presentation",
                (
                    f"{registration_number}|{trade_name}|{presentation.dosage_form}|"
                    f"{presentation.strength or ''}"
                ),
            )
            _add_entity(
                entities,
                KnowledgeEntity(
                    id=presentation_id,
                    entity_type="medication",
                    canonical_name=f"{trade_name} — {_presentation_heading(presentation)}",
                    names=[
                        KnowledgeName(name=trade_name, name_type="trade-name", weight=1.1),
                        *[
                            KnowledgeName(name=substance, name_type="inn", weight=1.2)
                            for substance in substances
                        ],
                    ],
                    external_ids=presentation_external_ids,
                    medication=MedicationProfile(
                        concept_level="clinical-drug",
                        inn=inn,
                        dosage_form=presentation.dosage_form,
                        route=presentation.route,
                        strength=presentation.strength,
                        registration_number=registration_number,
                        registration_status=_clean(record.get("status")),
                        metadata={
                            "brandEntityId": brand_id,
                            "registrationEntityId": registration_id,
                            "packages": [
                                item.model_dump(by_alias=True, mode="json")
                                for item in presentation.packages
                            ],
                            "pharmacotherapeuticGroups": groups,
                            **presentation_crosswalk_metadata,
                        },
                    ),
                    metadata=presentation_crosswalk_metadata,
                ),
            )
            presentation_chunk = _section_chunk(
                registry_document, _presentation_heading(presentation)
            )
            presentation_evidence = _evidence(
                registry_document, presentation_chunk, registration_number
            )
            for subject_id, predicate, object_id in [
                (brand_id, "has-presentation", presentation_id),
                (registration_id, "covers-presentation", presentation_id),
                *[
                    (substance_id, "active-ingredient-of", presentation_id)
                    for substance_id in substance_ids
                ],
                *[(presentation_id, "classified-as", class_id) for class_id in class_ids],
            ]:
                relation = _relation(
                    subject_id,
                    predicate,
                    object_id,
                    presentation_evidence,
                )
                relations[relation.id] = relation
            if instruction_document is not None:
                for entity_id, link_type in [
                    (brand_id, "product-instruction"),
                    (registration_id, "registration-instruction"),
                    (presentation_id, "presentation-instruction"),
                ]:
                    _add_document_link(
                        document_links,
                        entity_id=entity_id,
                        document=instruction_document,
                        link_type=link_type,
                        metadata=crosswalk_metadata,
                    )
            if crosswalk_metadata is not None:
                _add_document_link(
                    document_links,
                    entity_id=presentation_id,
                    document=registry_document,
                    link_type="presentation-registration-record",
                    metadata=presentation_crosswalk_metadata,
                )

        if crosswalk is not None and (
            crosswalk_entry is None or crosswalk_entry.status != "matched"
        ):
            status = "unmatched" if crosswalk_entry is None else "ambiguous"
            reason = (
                "Точное регистрационное соответствие ЕСКЛП не найдено."
                if crosswalk_entry is None
                else "Точное соответствие ЕСКЛП неоднозначно: "
                + " ".join(crosswalk_entry.ambiguity_reasons)
            )
            task_id = _stable_id("review.grls", f"{registration_number}|esklp-crosswalk")
            review_tasks[task_id] = KnowledgeReviewTask(
                id=task_id,
                task_type="missing-esklp-crosswalk"
                if status == "unmatched"
                else "ambiguous-esklp-crosswalk",
                target_id=registration_id,
                question=(
                    f"{reason} Проверить registrationNumber {registration_number} "
                    "между ГРЛС и ЕСКЛП вручную."
                ),
                missing_fields=[
                    "esklp-mnn-document-id",
                    "esklp-smnn-code",
                    "esklp-klp-provenance",
                ],
                priority=92,
                metadata={
                    "registrationNumber": registration_number,
                    "tradeName": trade_name,
                    "status": status,
                    "reasons": crosswalk_entry.ambiguity_reasons
                    if crosswalk_entry is not None
                    else [reason],
                },
            )

        if instruction_document is None:
            task_id = _stable_id("review.grls", f"{registration_number}|instruction")
            review_tasks[task_id] = KnowledgeReviewTask(
                id=task_id,
                task_type="missing-source",
                target_id=registration_id,
                question="Для регистрационной записи не найден подготовленный документ инструкции.",
                missing_fields=["instruction-document"],
                priority=95,
                metadata={"registrationNumber": registration_number},
            )
        else:
            for fact in _instruction_facts(
                instruction_document,
                registration_id,
                registration_number,
            ):
                facts[fact.id] = fact
            extraction = instruction_document.metadata.get("extraction")
            if isinstance(extraction, dict) and extraction.get("requiresReview") is True:
                task_id = _stable_id("review.grls", f"{registration_number}|document-structure")
                review_tasks[task_id] = KnowledgeReviewTask(
                    id=task_id,
                    task_type="document-structure-review",
                    target_id=registration_id,
                    question="Проверить полноту, заголовки, порядок блоков и таблицы инструкции.",
                    missing_fields=["page-coverage", "heading-structure", "tables"],
                    priority=95,
                    metadata={
                        "registrationNumber": registration_number,
                        "documentId": instruction_document.id,
                    },
                )

    knowledge = KnowledgeWorkspace(
        entities=sorted(entities.values(), key=lambda item: item.id),
        facts=sorted(facts.values(), key=lambda item: item.id),
        relations=sorted(relations.values(), key=lambda item: item.id),
        document_links=sorted(document_links.values(), key=lambda item: item.id),
        review_tasks=sorted(review_tasks.values(), key=lambda item: item.id),
    )
    validate_knowledge_workspace(knowledge, documents)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            knowledge.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    report = {
        "schemaVersion": 1,
        "catalog": str(catalog_path),
        "catalogSourceEdition": catalog_metadata.get("sourceEdition"),
        "registry": str(registry_path),
        "workspace": str(workspace),
        "output": str(output),
        "selectedRegistrations": len(selected),
        "registryCards": len(cards),
        "presentations": sum(len(item[2]) for item in selected),
        "entities": len(knowledge.entities),
        "facts": len(knowledge.facts),
        "relations": len(knowledge.relations),
        "documentLinks": len(knowledge.document_links),
        "reviewTasks": len(knowledge.review_tasks),
    }
    if crosswalk is not None:
        report["esklpCrosswalk"] = {
            "sourcePacks": crosswalk.source_packs,
            "indexedRegistrations": len(crosswalk.registrations),
            "matchedRegistrations": crosswalk_counts["matched"],
            "ambiguousRegistrations": crosswalk_counts["ambiguous"],
            "unmatchedRegistrations": crosswalk_counts["unmatched"],
        }
    if report_output is not None:
        report_output.parent.mkdir(parents=True, exist_ok=True)
        report_output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return report
