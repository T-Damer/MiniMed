from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import cast

import yaml
from pydantic import Field

from .knowledge import (
    KnowledgeDocumentLink,
    KnowledgeEntity,
    KnowledgeEvidence,
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
        parts = [part.strip() for part in entry.split(",", 2)]
        if len(parts) < 2 or not any(character.isdigit() for character in parts[1]):
            continue
        dosage_form = _clean(parts[0])
        raw_strength = _clean(parts[1])
        if dosage_form is None or raw_strength is None:
            continue
        strength = _display_strength(raw_strength)
        package_text = _clean(parts[2] if len(parts) > 2 else entry) or entry
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
) -> Path:
    registration_number = cast(str, record["registrationNumber"])
    trade_name = cast(str, record["tradeName"])
    inn = _clean(record.get("inn")) or "не указано"
    status = _clean(record.get("status")) or "не указан"
    source_edition = _clean(record.get("sourceEdition")) or "unknown"
    groups = _split_values(record.get("pharmacotherapeuticGroup"))
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
        "metadata": {
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
                presentation.model_dump(by_alias=True, mode="json")
                for presentation in presentations
            ],
            "sourceEdition": source_edition,
            "sourceWorkbook": record.get("sourceWorkbook"),
            "contentMode": "registry-normalized",
            "rights": {
                "licenseId": "grls-redistribution-review-required",
                "allowsDerivativeProcessing": False,
                "allowsRedistribution": False,
            },
        },
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
) -> list[KnowledgeEvidence]:
    section = next(
        section
        for section in document.sections
        if any(item.id == chunk.id for item in section.chunks)
    )
    return [
        KnowledgeEvidence(
            document_id=document.id,
            document_version_id=document.version.id,
            section_id=section.id,
            chunk_id=chunk.id,
            quote=chunk.original_text,
            source_locator={"registrationNumber": registration_number},
        )
    ]


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
) -> None:
    link_id = _stable_id("link.grls", f"{entity_id}|{document.version.id}|{link_type}")
    links[link_id] = KnowledgeDocumentLink(
        id=link_id,
        entity_id=entity_id,
        document_id=document.id,
        document_version_id=document.version.id,
        link_type=link_type,
        review_status="proposed",
    )


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
) -> dict[str, object]:
    records, catalog_metadata = _load_catalog(catalog_path)
    registry = load_source_registry(registry_path)
    workspace.mkdir(parents=True, exist_ok=True)
    selected: list[tuple[RegistrySource, dict[str, object], list[GrlsPresentation]]] = []
    cards: list[Path] = []
    for source in registry.sources:
        registration_number = _source_registration(source)
        record = records.get(registration_number)
        if record is None:
            raise ValueError(f"GRLS catalog does not contain {registration_number}.")
        presentations = parse_grls_presentations(record.get("releaseForms"))
        cards.append(_write_registry_card(workspace, record, presentations))
        selected.append((source, record, presentations))

    documents = load_workspace_documents(workspace)
    registry_documents = _document_by_registration(
        documents, source_type="official_registry_summary"
    )
    instruction_documents = _document_by_registration(
        documents, source_type="official_drug_instruction"
    )
    entities: dict[str, KnowledgeEntity] = {}
    relations: dict[str, KnowledgeRelation] = {}
    document_links: dict[str, KnowledgeDocumentLink] = {}
    review_tasks: dict[str, KnowledgeReviewTask] = {}

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

        brand_id = _stable_id("medication.brand", trade_name)
        _add_entity(
            entities,
            KnowledgeEntity(
                id=brand_id,
                entity_type="medication",
                canonical_name=trade_name,
                names=[KnowledgeName(name=trade_name, name_type="trade-name", weight=1.1)],
                medication=MedicationProfile(
                    concept_level="brand",
                    inn=inn,
                    metadata={"jurisdiction": "RU"},
                ),
            ),
        )
        registration_id = _stable_id("medication.registration", registration_number)
        _add_entity(
            entities,
            KnowledgeEntity(
                id=registration_id,
                entity_type="medication",
                canonical_name=f"{trade_name} — {registration_number}",
                external_ids={"ru-registration-number": registration_number},
                medication=MedicationProfile(
                    concept_level="registration",
                    inn=inn,
                    registration_number=registration_number,
                    registration_status=_clean(record.get("status")),
                    metadata={
                        "holder": record.get("holder"),
                        "manufacturer": record.get("manufacturer"),
                        "registrationDate": record.get("registrationDate"),
                        "sourceEdition": record.get("sourceEdition"),
                    },
                ),
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
                    external_ids={"ru-registration-number": registration_number},
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
                        },
                    ),
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
        "relations": len(knowledge.relations),
        "documentLinks": len(knowledge.document_links),
        "reviewTasks": len(knowledge.review_tasks),
    }
    if report_output is not None:
        report_output.parent.mkdir(parents=True, exist_ok=True)
        report_output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return report
