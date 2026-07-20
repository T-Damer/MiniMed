from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast

import yaml
from pydantic import Field, model_validator

from .markdown_parser import parse_markdown_document
from .models import CamelModel, PackChunk, PackDocument, PackSection
from .normalization import normalize_for_index, normalize_surface_text

ReviewStatus = Literal["proposed", "reviewed", "rejected"]
AuthorityTier = Literal[
    "official-registry",
    "official-label",
    "clinical-guideline",
    "formulary",
    "peer-reviewed",
    "professional-consensus",
    "third-party",
    "anecdotal",
    "synthetic-fixture",
]

AUTHORITY_DEFAULTS: dict[AuthorityTier, float] = {
    "official-registry": 0.95,
    "official-label": 1.0,
    "clinical-guideline": 0.95,
    "formulary": 0.88,
    "peer-reviewed": 0.82,
    "professional-consensus": 0.72,
    "third-party": 0.45,
    "anecdotal": 0.15,
    "synthetic-fixture": 0.10,
}


class KnowledgeEvidence(CamelModel):
    document_id: str
    document_version_id: str
    section_id: str
    chunk_id: str
    quote: str = Field(min_length=1)
    source_locator: dict[str, object] = Field(default_factory=dict)


class KnowledgeName(CamelModel):
    name: str = Field(min_length=1)
    language: str = "ru"
    name_type: str = "alias"
    weight: float = Field(default=1.0, gt=0, le=2)


class MedicationProfile(CamelModel):
    concept_level: str = "substance"
    inn: str | None = None
    atc_code: str | None = None
    dosage_form: str | None = None
    route: str | None = None
    strength: str | None = None
    registration_number: str | None = None
    registration_status: str | None = None
    pediatric_status: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class KnowledgeEntity(CamelModel):
    id: str
    entity_type: str = Field(min_length=1)
    canonical_name: str = Field(min_length=1)
    names: list[KnowledgeName] = Field(default_factory=list)
    external_ids: dict[str, str] = Field(default_factory=dict)
    medication: MedicationProfile | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class KnowledgeFact(CamelModel):
    id: str
    entity_id: str
    fact_type: str = Field(min_length=1)
    text: str = Field(min_length=1)
    structured: dict[str, object] = Field(default_factory=dict)
    population: dict[str, object] = Field(default_factory=dict)
    approval_status: str = "not-specified"
    authority_tier: AuthorityTier
    review_status: ReviewStatus = "proposed"
    jurisdiction: str = "RU"
    confidence: float = Field(default=0.5, ge=0, le=1)
    valid_from: str | None = None
    valid_to: str | None = None
    evidence: list[KnowledgeEvidence] = Field(min_length=1)
    metadata: dict[str, object] = Field(default_factory=dict)


class RelationWeightComponents(CamelModel):
    authority: float = Field(ge=0, le=1)
    evidence_quality: float = Field(default=0.5, ge=0, le=1)
    applicability: float = Field(default=0.5, ge=0, le=1)
    recency: float = Field(default=0.5, ge=0, le=1)
    editorial_review: float = Field(default=0.0, ge=0, le=1)

    def total(self) -> float:
        return round(
            self.authority * 0.30
            + self.evidence_quality * 0.25
            + self.applicability * 0.20
            + self.recency * 0.10
            + self.editorial_review * 0.15,
            6,
        )


class KnowledgeRelation(CamelModel):
    id: str
    subject_entity_id: str
    predicate: str = Field(min_length=1)
    object_entity_id: str
    relation_status: str = "reference-only"
    authority_tier: AuthorityTier
    review_status: ReviewStatus = "proposed"
    jurisdiction: str = "RU"
    weights: RelationWeightComponents
    final_weight: float | None = Field(default=None, ge=0, le=1)
    valid_from: str | None = None
    valid_to: str | None = None
    evidence: list[KnowledgeEvidence] = Field(min_length=1)
    metadata: dict[str, object] = Field(default_factory=dict)

    @model_validator(mode="after")
    def calculate_weight(self) -> KnowledgeRelation:
        calculated = self.weights.total()
        if self.final_weight is None:
            self.final_weight = calculated
        elif abs(self.final_weight - calculated) > 0.000001:
            raise ValueError(
                f"Relation {self.id} finalWeight must equal deterministic component "
                f"score {calculated}."
            )
        return self


class KnowledgeDocumentLink(CamelModel):
    id: str
    entity_id: str
    document_id: str
    document_version_id: str
    section_id: str | None = None
    chunk_id: str | None = None
    link_type: str = "described-by"
    weight: float = Field(default=1.0, ge=0, le=1)
    review_status: ReviewStatus = "proposed"
    metadata: dict[str, object] = Field(default_factory=dict)


class KnowledgeReviewTask(CamelModel):
    id: str
    task_type: str
    target_id: str | None = None
    question: str = Field(min_length=1)
    missing_fields: list[str] = Field(default_factory=list)
    priority: int = Field(default=50, ge=0, le=100)
    status: Literal["open", "resolved", "dismissed"] = "open"
    metadata: dict[str, object] = Field(default_factory=dict)


class KnowledgeWorkspace(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    entities: list[KnowledgeEntity] = Field(default_factory=list)
    facts: list[KnowledgeFact] = Field(default_factory=list)
    relations: list[KnowledgeRelation] = Field(default_factory=list)
    document_links: list[KnowledgeDocumentLink] = Field(default_factory=list)
    review_tasks: list[KnowledgeReviewTask] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_ids_and_references(self) -> KnowledgeWorkspace:
        groups = {
            "entity": [item.id for item in self.entities],
            "fact": [item.id for item in self.facts],
            "relation": [item.id for item in self.relations],
            "document link": [item.id for item in self.document_links],
            "review task": [item.id for item in self.review_tasks],
        }
        for label, identifiers in groups.items():
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"Knowledge workspace contains duplicate {label} ids.")
        entity_ids = set(groups["entity"])
        for fact in self.facts:
            if fact.entity_id not in entity_ids:
                raise ValueError(f"Fact {fact.id} references unknown entity {fact.entity_id}.")
        for relation in self.relations:
            if relation.subject_entity_id not in entity_ids:
                raise ValueError(
                    f"Relation {relation.id} references unknown subject "
                    f"{relation.subject_entity_id}."
                )
            if relation.object_entity_id not in entity_ids:
                raise ValueError(
                    f"Relation {relation.id} references unknown object {relation.object_entity_id}."
                )
        for link in self.document_links:
            if link.entity_id not in entity_ids:
                raise ValueError(
                    f"Document link {link.id} references unknown entity {link.entity_id}."
                )
        review_target_ids = (
            entity_ids
            | set(groups["fact"])
            | set(groups["relation"])
            | set(groups["document link"])
        )
        for task in self.review_tasks:
            if task.target_id is not None and task.target_id not in review_target_ids:
                raise ValueError(
                    f"Review task {task.id} references unknown target {task.target_id}."
                )
        return self


class AiEntityProposal(CamelModel):
    key: str
    entity_type: str
    canonical_name: str
    aliases: list[str] = Field(default_factory=list)
    external_ids: dict[str, str] = Field(default_factory=dict)
    medication: MedicationProfile | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class AiFactProposal(CamelModel):
    entity_key: str
    fact_type: str
    text: str
    evidence_quote: str
    structured: dict[str, object] = Field(default_factory=dict)
    population: dict[str, object] = Field(default_factory=dict)
    approval_status: str = "not-specified"
    authority_tier: AuthorityTier
    confidence: float = Field(default=0.5, ge=0, le=1)
    missing_fields: list[str] = Field(default_factory=list)


class AiRelationProposal(CamelModel):
    subject_key: str
    predicate: str
    object_key: str
    relation_status: str = "reference-only"
    evidence_quote: str
    authority_tier: AuthorityTier
    evidence_quality: float = Field(default=0.5, ge=0, le=1)
    applicability: float = Field(default=0.5, ge=0, le=1)
    recency: float = Field(default=0.5, ge=0, le=1)
    confidence: float = Field(default=0.5, ge=0, le=1)


class AiReviewTaskProposal(CamelModel):
    task_type: str
    target_key: str | None = None
    question: str
    missing_fields: list[str] = Field(default_factory=list)
    priority: int = Field(default=50, ge=0, le=100)


class AiChunkResponse(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    task_id: str
    entities: list[AiEntityProposal] = Field(default_factory=list)
    facts: list[AiFactProposal] = Field(default_factory=list)
    relations: list[AiRelationProposal] = Field(default_factory=list)
    review_tasks: list[AiReviewTaskProposal] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_entity_keys(self) -> AiChunkResponse:
        keys = [entity.key for entity in self.entities]
        if len(keys) != len(set(keys)):
            raise ValueError(f"Task {self.task_id} contains duplicate entity keys.")
        return self


class KnowledgeSummary(CamelModel):
    entities: int
    facts: int
    relations: int
    document_links: int
    review_tasks: int
    reviewed_facts: int
    reviewed_relations: int


class AiImportReport(CamelModel):
    tasks: int
    entities: int
    facts: int
    relations: int
    review_tasks: int
    output: str


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}.{hashlib.sha256(value.encode('utf-8')).hexdigest()[:20]}"


def authority_tier_for_document(document: PackDocument) -> AuthorityTier:
    explicit = document.metadata.get("authorityTier")
    if isinstance(explicit, str) and explicit in AUTHORITY_DEFAULTS:
        return cast(AuthorityTier, explicit)

    source_type = normalize_surface_text(document.source_type).replace("-", "_").replace(" ", "_")
    if "synthetic" in source_type:
        return "synthetic-fixture"
    if "official_registry" in source_type or "state_registry" in source_type:
        return "official-registry"
    if any(
        value in source_type for value in ("official_label", "official_instruction", "drug_label")
    ):
        return "official-label"
    if any(value in source_type for value in ("clinical_recommendation", "clinical_guideline")):
        return "clinical-guideline"
    if "formulary" in source_type:
        return "formulary"
    if any(value in source_type for value in ("peer_reviewed", "journal", "systematic_review")):
        return "peer-reviewed"
    if any(value in source_type for value in ("consensus", "professional_guidance")):
        return "professional-consensus"
    if "anecdotal" in source_type:
        return "anecdotal"
    return "third-party"


def require_ai_processing_license(document: PackDocument) -> str:
    """Fail closed before source text is sent to a third-party model workflow."""
    if authority_tier_for_document(document) == "synthetic-fixture":
        return "synthetic-fixture"

    rights = document.metadata.get("rights")
    if not isinstance(rights, dict):
        raise ValueError(
            f"Document {document.id} cannot be exported to ChatGPT without explicit "
            "derivative-processing rights metadata."
        )
    allowed = rights.get("allowsDerivativeProcessing", rights.get("allows_derivative_processing"))
    if allowed is not True:
        raise ValueError(
            f"Document {document.id} cannot be exported to ChatGPT because "
            "derivative processing is not allowed."
        )
    license_id = rights.get("licenseId", rights.get("license_id"))
    if not isinstance(license_id, str) or not license_id.strip():
        raise ValueError(
            f"Document {document.id} cannot be exported to ChatGPT without a licenseId."
        )
    return license_id.strip()


def _external_id_key(namespace: str, value: str) -> tuple[str, str]:
    return namespace.strip().casefold(), value.strip().casefold()


def _entity_identity_key(
    entity_type: str,
    canonical_name: str,
    medication: MedicationProfile | None,
) -> tuple[str, ...] | None:
    normalized_type = normalize_surface_text(entity_type)
    normalized_name = normalize_surface_text(canonical_name)
    if medication is None:
        # Medication names alone are not safe cross-document identifiers: the same display name can
        # refer to a substance, clinical drug, brand, package, or registration.
        return (
            None
            if normalized_type == "medication"
            else ("entity", normalized_type, normalized_name)
        )

    strong_values = (
        medication.inn,
        medication.dosage_form,
        medication.route,
        medication.strength,
        medication.registration_number,
    )
    if not any(isinstance(value, str) and value.strip() for value in strong_values):
        return None
    return (
        "medication",
        normalize_surface_text(medication.concept_level),
        normalized_name,
        normalize_surface_text(medication.inn or ""),
        normalize_surface_text(medication.atc_code or ""),
        normalize_surface_text(medication.dosage_form or ""),
        normalize_surface_text(medication.route or ""),
        normalize_surface_text(medication.strength or ""),
        normalize_surface_text(medication.registration_number or ""),
    )


def _merge_entity(existing: KnowledgeEntity, candidate: KnowledgeEntity) -> None:
    if normalize_surface_text(existing.entity_type) != normalize_surface_text(
        candidate.entity_type
    ):
        raise ValueError(
            f"Entity {existing.id} received conflicting types: "
            f"{existing.entity_type} and {candidate.entity_type}."
        )

    existing_names = {
        ("ru", normalize_surface_text(existing.canonical_name)),
        *((name.language, normalize_surface_text(name.name)) for name in existing.names),
    }
    candidate_names = [
        KnowledgeName(name=candidate.canonical_name, name_type="alternate-canonical"),
        *candidate.names,
    ]
    for name in candidate_names:
        key = (name.language, normalize_surface_text(name.name))
        if key in existing_names:
            continue
        existing.names.append(name)
        existing_names.add(key)

    for namespace, value in candidate.external_ids.items():
        previous = existing.external_ids.get(namespace)
        if previous is not None and previous.casefold() != value.casefold():
            raise ValueError(
                f"Conflicting external id {namespace} for entity {existing.canonical_name}."
            )
        existing.external_ids[namespace] = value

    if existing.medication is None:
        existing.medication = candidate.medication
        return
    if candidate.medication is None:
        return

    for field_name in (
        "concept_level",
        "inn",
        "atc_code",
        "dosage_form",
        "route",
        "strength",
        "registration_number",
        "registration_status",
        "pediatric_status",
    ):
        current = getattr(existing.medication, field_name)
        incoming = getattr(candidate.medication, field_name)
        if incoming is None or (isinstance(incoming, str) and not incoming.strip()):
            continue
        if current is None or (isinstance(current, str) and not current.strip()):
            setattr(existing.medication, field_name, incoming)
            continue
        if normalize_surface_text(current) != normalize_surface_text(incoming):
            raise ValueError(
                f"Conflicting medication field {field_name} for entity "
                f"{existing.canonical_name}: {current!r} versus {incoming!r}."
            )


def _document_maps(
    documents: list[PackDocument],
) -> tuple[
    dict[str, PackDocument],
    dict[str, tuple[PackDocument, PackSection]],
    dict[str, tuple[PackDocument, PackSection, PackChunk]],
]:
    document_map = {document.id: document for document in documents}
    section_map: dict[str, tuple[PackDocument, PackSection]] = {}
    chunk_map: dict[str, tuple[PackDocument, PackSection, PackChunk]] = {}
    for document in documents:
        for section in document.sections:
            section_map[section.id] = (document, section)
            for chunk in section.chunks:
                chunk_map[chunk.id] = (document, section, chunk)
    return document_map, section_map, chunk_map


def validate_knowledge_workspace(
    workspace: KnowledgeWorkspace, documents: list[PackDocument]
) -> None:
    document_map, section_map, chunk_map = _document_maps(documents)

    def validate_evidence(owner_id: str, evidence: KnowledgeEvidence) -> None:
        resolved = chunk_map.get(evidence.chunk_id)
        if resolved is None:
            raise ValueError(f"{owner_id} references unknown evidence chunk {evidence.chunk_id}.")
        document, section, chunk = resolved
        if evidence.document_id != document.id:
            raise ValueError(f"{owner_id} evidence document does not match its chunk.")
        if evidence.document_version_id != document.version.id:
            raise ValueError(f"{owner_id} evidence document version does not match its chunk.")
        if evidence.section_id != section.id:
            raise ValueError(f"{owner_id} evidence section does not match its chunk.")
        if evidence.quote not in chunk.original_text:
            raise ValueError(
                f"{owner_id} evidence quote is not an exact substring of chunk {chunk.id}."
            )

    for fact in workspace.facts:
        for evidence in fact.evidence:
            validate_evidence(fact.id, evidence)
    for relation in workspace.relations:
        for evidence in relation.evidence:
            validate_evidence(relation.id, evidence)
    for link in workspace.document_links:
        document = document_map.get(link.document_id)
        if document is None or document.version.id != link.document_version_id:
            raise ValueError(f"Document link {link.id} references an unknown document version.")
        if link.section_id is not None:
            resolved_section = section_map.get(link.section_id)
            if resolved_section is None or resolved_section[0].id != link.document_id:
                raise ValueError(f"Document link {link.id} references an invalid section.")
        if link.chunk_id is not None:
            resolved_chunk = chunk_map.get(link.chunk_id)
            if resolved_chunk is None or resolved_chunk[0].id != link.document_id:
                raise ValueError(f"Document link {link.id} references an invalid chunk.")


def _read_yaml_mapping(path: Path) -> dict[str, object]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected YAML mapping: {path}")
    return {str(key): value for key, value in payload.items()}


def load_workspace_documents(input_dir: Path) -> list[PackDocument]:
    manifest = _read_yaml_mapping(input_dir / "manifest.yaml")
    built_at = manifest.get("builtAt") or manifest.get("built_at")
    if not isinstance(built_at, str):
        raise ValueError("manifest.yaml must contain builtAt.")
    documents = [
        parse_markdown_document(path, extracted_at=built_at)
        for path in sorted(input_dir.glob("*.md"))
    ]
    if not documents:
        raise ValueError("No Markdown documents found.")
    return documents


def load_knowledge_workspace(input_dir: Path, documents: list[PackDocument]) -> KnowledgeWorkspace:
    path = input_dir / "knowledge.yaml"
    if not path.is_file():
        return KnowledgeWorkspace()
    workspace = KnowledgeWorkspace.model_validate(_read_yaml_mapping(path))
    validate_knowledge_workspace(workspace, documents)
    return workspace


def knowledge_summary(workspace: KnowledgeWorkspace) -> KnowledgeSummary:
    return KnowledgeSummary(
        entities=len(workspace.entities),
        facts=len(workspace.facts),
        relations=len(workspace.relations),
        document_links=len(workspace.document_links),
        review_tasks=len(workspace.review_tasks),
        reviewed_facts=sum(item.review_status == "reviewed" for item in workspace.facts),
        reviewed_relations=sum(item.review_status == "reviewed" for item in workspace.relations),
    )


def apply_search_projection(documents: list[PackDocument], workspace: KnowledgeWorkspace) -> None:
    if not workspace.entities:
        return
    _, _, chunk_map = _document_maps(documents)
    entities = {entity.id: entity for entity in workspace.entities}
    projections: dict[str, set[str]] = defaultdict(set)

    def add_entity(chunk_id: str, entity_id: str) -> None:
        entity = entities[entity_id]
        projections[chunk_id].add(entity.canonical_name)
        projections[chunk_id].update(name.name for name in entity.names)
        projections[chunk_id].update(entity.external_ids.values())
        if entity.medication is not None:
            medication_values = [
                entity.medication.inn,
                entity.medication.atc_code,
                entity.medication.dosage_form,
                entity.medication.route,
                entity.medication.strength,
                entity.medication.registration_number,
                entity.medication.pediatric_status,
            ]
            projections[chunk_id].update(value for value in medication_values if value)

    for fact in workspace.facts:
        if fact.review_status != "reviewed":
            continue
        for evidence in fact.evidence:
            add_entity(evidence.chunk_id, fact.entity_id)
            projections[evidence.chunk_id].update([fact.fact_type, fact.text, fact.approval_status])
            projections[evidence.chunk_id].update(str(value) for value in fact.structured.values())
            projections[evidence.chunk_id].update(str(value) for value in fact.population.values())

    for relation in workspace.relations:
        if relation.review_status != "reviewed":
            continue
        for evidence in relation.evidence:
            add_entity(evidence.chunk_id, relation.subject_entity_id)
            add_entity(evidence.chunk_id, relation.object_entity_id)
            projections[evidence.chunk_id].update(
                [relation.predicate, relation.relation_status, relation.authority_tier]
            )

    for link in workspace.document_links:
        if link.review_status != "reviewed" or link.chunk_id is None:
            continue
        add_entity(link.chunk_id, link.entity_id)
        projections[link.chunk_id].add(link.link_type)

    for chunk_id, values in projections.items():
        resolved = chunk_map.get(chunk_id)
        if resolved is None:
            continue
        chunk = resolved[2]
        projection_text = " ".join(sorted(value for value in values if value.strip()))
        if not projection_text:
            continue
        chunk.normalized_text = " ".join(
            value
            for value in [chunk.normalized_text, normalize_for_index(projection_text)]
            if value
        )
        chunk.metadata["knowledgeProjectionVersion"] = 1
        chunk.metadata["knowledgeProjectionText"] = projection_text


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def write_knowledge_sqlite(path: Path, workspace: KnowledgeWorkspace) -> None:
    connection = sqlite3.connect(path)
    try:
        with connection:
            entity_map = {entity.id: entity for entity in workspace.entities}
            for entity in sorted(workspace.entities, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO knowledge_entities(
                        id, entity_type, canonical_name, normalized_name,
                        external_ids_json, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        entity.id,
                        entity.entity_type,
                        entity.canonical_name,
                        normalize_surface_text(entity.canonical_name),
                        _json(entity.external_ids),
                        _json(entity.metadata),
                    ),
                )
                all_names = [
                    KnowledgeName(name=entity.canonical_name, name_type="canonical", weight=1.2),
                    *entity.names,
                ]
                for index, name in enumerate(all_names):
                    name_id = _stable_id(
                        "knowledge-name",
                        f"{entity.id}|{name.language}|{name.name_type}|{name.name}|{index}",
                    )
                    connection.execute(
                        """INSERT INTO knowledge_names(
                            id, entity_id, name, normalized_name, language, name_type, weight
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            name_id,
                            entity.id,
                            name.name,
                            normalize_surface_text(name.name),
                            name.language,
                            name.name_type,
                            name.weight,
                        ),
                    )
                if entity.medication is not None:
                    medication = entity.medication
                    connection.execute(
                        """INSERT INTO medication_profiles(
                            entity_id, concept_level, inn, atc_code, dosage_form, route, strength,
                            registration_number, registration_status, pediatric_status,
                            metadata_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            entity.id,
                            medication.concept_level,
                            medication.inn,
                            medication.atc_code,
                            medication.dosage_form,
                            medication.route,
                            medication.strength,
                            medication.registration_number,
                            medication.registration_status,
                            medication.pediatric_status,
                            _json(medication.metadata),
                        ),
                    )

            for fact in sorted(workspace.facts, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO knowledge_facts(
                        id, entity_id, fact_type, original_text, structured_json, population_json,
                        approval_status, authority_tier, review_status, jurisdiction, confidence,
                        valid_from, valid_to, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        fact.id,
                        fact.entity_id,
                        fact.fact_type,
                        fact.text,
                        _json(fact.structured),
                        _json(fact.population),
                        fact.approval_status,
                        fact.authority_tier,
                        fact.review_status,
                        fact.jurisdiction,
                        fact.confidence,
                        fact.valid_from,
                        fact.valid_to,
                        _json(fact.metadata),
                    ),
                )
                _write_evidence(connection, fact.id, None, fact.evidence)

            for relation in sorted(workspace.relations, key=lambda item: item.id):
                if relation.final_weight is None:
                    raise ValueError(f"Relation {relation.id} has no deterministic final weight.")
                connection.execute(
                    """INSERT INTO knowledge_relations(
                        id, subject_entity_id, predicate, object_entity_id, relation_status,
                        authority_tier, review_status, jurisdiction, final_weight,
                        weight_components_json, valid_from, valid_to, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        relation.id,
                        relation.subject_entity_id,
                        relation.predicate,
                        relation.object_entity_id,
                        relation.relation_status,
                        relation.authority_tier,
                        relation.review_status,
                        relation.jurisdiction,
                        relation.final_weight,
                        _json(relation.weights.model_dump(by_alias=True, mode="json")),
                        relation.valid_from,
                        relation.valid_to,
                        _json(relation.metadata),
                    ),
                )
                _write_evidence(connection, None, relation.id, relation.evidence)

            for link in sorted(workspace.document_links, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO knowledge_document_links(
                        id, entity_id, document_id, document_version_id, section_id, chunk_id,
                        link_type, weight, review_status, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        link.id,
                        link.entity_id,
                        link.document_id,
                        link.document_version_id,
                        link.section_id,
                        link.chunk_id,
                        link.link_type,
                        link.weight,
                        link.review_status,
                        _json(link.metadata),
                    ),
                )

            for task in sorted(workspace.review_tasks, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO knowledge_review_tasks(
                        id, task_type, target_id, question, missing_fields_json,
                        priority, status, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        task.id,
                        task.task_type,
                        task.target_id,
                        task.question,
                        _json(task.missing_fields),
                        task.priority,
                        task.status,
                        _json(task.metadata),
                    ),
                )

            reviewed_facts: dict[str, list[str]] = defaultdict(list)
            reviewed_relations: dict[str, list[str]] = defaultdict(list)
            for fact in workspace.facts:
                if fact.review_status == "reviewed":
                    reviewed_facts[fact.entity_id].extend([fact.fact_type, fact.text])
            for relation in workspace.relations:
                if relation.review_status != "reviewed":
                    continue
                subject = entity_map[relation.subject_entity_id]
                obj = entity_map[relation.object_entity_id]
                text = (
                    f"{subject.canonical_name} {relation.predicate} "
                    f"{obj.canonical_name} {relation.relation_status}"
                )
                reviewed_relations[relation.subject_entity_id].append(text)
                reviewed_relations[relation.object_entity_id].append(text)
            for entity in workspace.entities:
                names = " ".join([entity.canonical_name, *(name.name for name in entity.names)])
                facts = " ".join(reviewed_facts[entity.id])
                relations = " ".join(reviewed_relations[entity.id])
                if not facts and not relations:
                    continue
                connection.execute(
                    """INSERT INTO knowledge_fts(
                        entity_id, canonical_name, aliases, facts, relations
                    ) VALUES (?, ?, ?, ?, ?)""",
                    (entity.id, entity.canonical_name, names, facts, relations),
                )
        if (
            workspace.entities
            or workspace.facts
            or workspace.relations
            or workspace.document_links
            or workspace.review_tasks
        ):
            connection.execute("VACUUM")
    finally:
        connection.close()


def _write_evidence(
    connection: sqlite3.Connection,
    fact_id: str | None,
    relation_id: str | None,
    evidence_items: list[KnowledgeEvidence],
) -> None:
    target = fact_id or relation_id
    if target is None:
        raise ValueError("Knowledge evidence requires either a fact or relation target.")
    for index, evidence in enumerate(evidence_items):
        evidence_id = _stable_id(
            "knowledge-evidence",
            f"{target}|{evidence.chunk_id}|{evidence.quote}|{index}",
        )
        connection.execute(
            """INSERT INTO knowledge_evidence(
                id, fact_id, relation_id, document_id, document_version_id,
                section_id, chunk_id, evidence_quote, source_locator_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                evidence_id,
                fact_id,
                relation_id,
                evidence.document_id,
                evidence.document_version_id,
                evidence.section_id,
                evidence.chunk_id,
                evidence.quote,
                _json(evidence.source_locator),
            ),
        )


def export_chatgpt_tasks(input_dir: Path, output: Path) -> int:
    documents = load_workspace_documents(input_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    rows: list[str] = []
    for document in documents:
        processing_license_id = require_ai_processing_license(document)
        for section in document.sections:
            for chunk in section.chunks:
                payload = {
                    "schemaVersion": 1,
                    "taskId": chunk.id,
                    "source": {
                        "documentId": document.id,
                        "documentVersionId": document.version.id,
                        "title": document.title,
                        "sourceType": document.source_type,
                        "authorityTier": authority_tier_for_document(document),
                        "rights": {
                            "licenseId": processing_license_id,
                            "allowsDerivativeProcessing": True,
                        },
                        "status": document.status,
                        "sectionId": section.id,
                        "sectionPath": section.section_path,
                        "chunkId": chunk.id,
                        "anchor": chunk.anchor,
                        "pageStart": chunk.page_start,
                        "pageEnd": chunk.page_end,
                        "sourceSpans": chunk.metadata.get("sourceSpans", []),
                    },
                    "text": chunk.original_text,
                    "rules": [
                        "Extract only claims supported by an exact quote from text.",
                        (
                            "Do not infer or invent doses, pediatric use, contraindications, "
                            "or prescription rules."
                        ),
                        "Represent absent information as a reviewTask with missingFields.",
                        "Keep official, off-label, third-party, and anecdotal claims distinct.",
                        (
                            "Return one JSON object using the AiChunkResponse schema; "
                            "never mark output reviewed."
                        ),
                    ],
                }
                rows.append(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    output.write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
    return len(rows)


def _load_jsonl(path: Path) -> list[object]:
    values: list[object] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            values.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSONL at {path}:{line_number}: {error}") from error
    return values


def import_chatgpt_responses(
    input_dir: Path,
    responses_path: Path,
    output_path: Path,
    *,
    base_path: Path | None = None,
) -> AiImportReport:
    documents = load_workspace_documents(input_dir)
    _, _, chunk_map = _document_maps(documents)
    responses = [AiChunkResponse.model_validate(item) for item in _load_jsonl(responses_path)]
    task_ids = [response.task_id for response in responses]
    if len(task_ids) != len(set(task_ids)):
        raise ValueError("ChatGPT response JSONL contains duplicate taskId values.")
    for task_id in task_ids:
        if task_id not in chunk_map:
            raise ValueError(f"ChatGPT response references unknown task/chunk {task_id}.")

    base = KnowledgeWorkspace()
    existing_path = base_path or (input_dir / "knowledge.yaml")
    if existing_path.is_file():
        base = KnowledgeWorkspace.model_validate(_read_yaml_mapping(existing_path))
        validate_knowledge_workspace(base, documents)

    entities_by_id = {item.id: item for item in base.entities}
    entity_id_by_identity: dict[tuple[str, ...], str] = {}
    external_entity_id_by_key: dict[tuple[str, str], str] = {}
    for item in base.entities:
        identity = _entity_identity_key(item.entity_type, item.canonical_name, item.medication)
        if identity is not None:
            previous = entity_id_by_identity.get(identity)
            if previous is not None and previous != item.id:
                raise ValueError(f"Duplicate safe entity identity for {item.canonical_name}.")
            entity_id_by_identity[identity] = item.id
        for namespace, value in item.external_ids.items():
            if not namespace.strip() or not value.strip():
                continue
            external_key = _external_id_key(namespace, value)
            previous = external_entity_id_by_key.get(external_key)
            if previous is not None and previous != item.id:
                raise ValueError(f"External id {namespace}:{value} maps to multiple entities.")
            external_entity_id_by_key[external_key] = item.id

    facts_by_id = {item.id: item for item in base.facts}
    relations_by_id = {item.id: item for item in base.relations}
    tasks_by_id = {item.id: item for item in base.review_tasks}

    for response in responses:
        document, section, chunk = chunk_map[response.task_id]
        source_authority = authority_tier_for_document(document)
        local_entities: dict[str, str] = {}
        for proposal in response.entities:
            normalized = normalize_surface_text(proposal.canonical_name)
            identity = _entity_identity_key(
                proposal.entity_type,
                proposal.canonical_name,
                proposal.medication,
            )
            matches: set[str] = set()
            if identity is not None:
                identity_match = entity_id_by_identity.get(identity)
                if identity_match is not None:
                    matches.add(identity_match)
            for namespace, value in proposal.external_ids.items():
                if not namespace.strip() or not value.strip():
                    continue
                external_match = external_entity_id_by_key.get(_external_id_key(namespace, value))
                if external_match is not None:
                    matches.add(external_match)
            if len(matches) > 1:
                raise ValueError(
                    f"Task {response.task_id} entity {proposal.key} has conflicting "
                    "identity mappings."
                )
            if matches:
                entity_id = next(iter(matches))
            elif identity is not None:
                entity_id = _stable_id("entity", "|".join(identity))
            else:
                entity_id = _stable_id(
                    "entity",
                    f"unresolved|{proposal.entity_type}|{normalized}|"
                    f"{response.task_id}|{proposal.key}",
                )
            local_entities[proposal.key] = entity_id
            aliases = [KnowledgeName(name=value) for value in proposal.aliases]
            candidate = KnowledgeEntity(
                id=entity_id,
                entity_type=proposal.entity_type,
                canonical_name=proposal.canonical_name,
                names=aliases,
                external_ids=proposal.external_ids,
                medication=proposal.medication,
                metadata={
                    **proposal.metadata,
                    "generatedBy": "chatgpt-manual",
                    "firstTaskId": response.task_id,
                },
            )
            existing = entities_by_id.get(entity_id)
            if existing is None:
                entities_by_id[entity_id] = candidate
            else:
                _merge_entity(existing, candidate)

            if identity is not None:
                previous = entity_id_by_identity.get(identity)
                if previous is not None and previous != entity_id:
                    raise ValueError(
                        f"Task {response.task_id} identity maps to multiple entity ids."
                    )
                entity_id_by_identity[identity] = entity_id
            for namespace, value in proposal.external_ids.items():
                if not namespace.strip() or not value.strip():
                    continue
                external_key = _external_id_key(namespace, value)
                previous = external_entity_id_by_key.get(external_key)
                if previous is not None and previous != entity_id:
                    raise ValueError(f"External id {namespace}:{value} maps to multiple entities.")
                external_entity_id_by_key[external_key] = entity_id

        for proposal in response.facts:
            entity_id = local_entities.get(proposal.entity_key)
            if entity_id is None:
                raise ValueError(
                    f"Task {response.task_id} fact references unknown entity key "
                    f"{proposal.entity_key}."
                )
            if proposal.evidence_quote not in chunk.original_text:
                raise ValueError(
                    f"Task {response.task_id} fact quote is not an exact source substring."
                )
            evidence = KnowledgeEvidence(
                document_id=document.id,
                document_version_id=document.version.id,
                section_id=section.id,
                chunk_id=chunk.id,
                quote=proposal.evidence_quote,
                source_locator={
                    "anchor": chunk.anchor,
                    "pageStart": chunk.page_start,
                    "pageEnd": chunk.page_end,
                    "sourceSpans": chunk.metadata.get("sourceSpans", []),
                },
            )
            fact_id = _stable_id(
                "fact",
                f"{entity_id}|{proposal.fact_type}|{proposal.text}|{response.task_id}",
            )
            facts_by_id[fact_id] = KnowledgeFact(
                id=fact_id,
                entity_id=entity_id,
                fact_type=proposal.fact_type,
                text=proposal.text,
                structured=proposal.structured,
                population=proposal.population,
                approval_status=proposal.approval_status,
                authority_tier=source_authority,
                review_status="proposed",
                confidence=proposal.confidence,
                evidence=[evidence],
                metadata={
                    "generatedBy": "chatgpt-manual",
                    "taskId": response.task_id,
                    "requestedAuthorityTier": proposal.authority_tier,
                },
            )
            if proposal.missing_fields:
                review_id = _stable_id(
                    "review",
                    f"missing|{fact_id}|{'|'.join(sorted(proposal.missing_fields))}",
                )
                tasks_by_id[review_id] = KnowledgeReviewTask(
                    id=review_id,
                    task_type="missing-source-data",
                    target_id=fact_id,
                    question=(
                        "Найдите источник, который прямо заполняет отсутствующие поля; "
                        "не выводите их из контекста."
                    ),
                    missing_fields=proposal.missing_fields,
                    priority=80,
                    metadata={
                        "generatedBy": "chatgpt-manual",
                        "taskId": response.task_id,
                    },
                )

        for proposal in response.relations:
            subject_id = local_entities.get(proposal.subject_key)
            object_id = local_entities.get(proposal.object_key)
            if subject_id is None or object_id is None:
                raise ValueError(
                    f"Task {response.task_id} relation references an unknown local entity key."
                )
            if proposal.evidence_quote not in chunk.original_text:
                raise ValueError(
                    f"Task {response.task_id} relation quote is not an exact source substring."
                )
            evidence = KnowledgeEvidence(
                document_id=document.id,
                document_version_id=document.version.id,
                section_id=section.id,
                chunk_id=chunk.id,
                quote=proposal.evidence_quote,
                source_locator={"anchor": chunk.anchor},
            )
            relation_id = _stable_id(
                "relation",
                f"{subject_id}|{proposal.predicate}|{object_id}|{response.task_id}",
            )
            relations_by_id[relation_id] = KnowledgeRelation(
                id=relation_id,
                subject_entity_id=subject_id,
                predicate=proposal.predicate,
                object_entity_id=object_id,
                relation_status=proposal.relation_status,
                authority_tier=source_authority,
                review_status="proposed",
                weights=RelationWeightComponents(
                    authority=AUTHORITY_DEFAULTS[source_authority],
                    evidence_quality=proposal.evidence_quality,
                    applicability=proposal.applicability,
                    recency=proposal.recency,
                    editorial_review=0.0,
                ),
                evidence=[evidence],
                metadata={
                    "generatedBy": "chatgpt-manual",
                    "taskId": response.task_id,
                    "modelConfidence": proposal.confidence,
                    "requestedAuthorityTier": proposal.authority_tier,
                },
            )

        for proposal in response.review_tasks:
            target_id = local_entities.get(proposal.target_key) if proposal.target_key else None
            review_id = _stable_id(
                "review",
                f"{response.task_id}|{proposal.task_type}|{target_id}|{proposal.question}",
            )
            tasks_by_id[review_id] = KnowledgeReviewTask(
                id=review_id,
                task_type=proposal.task_type,
                target_id=target_id,
                question=proposal.question,
                missing_fields=proposal.missing_fields,
                priority=proposal.priority,
                metadata={"generatedBy": "chatgpt-manual", "taskId": response.task_id},
            )

    workspace = KnowledgeWorkspace(
        schema_version=1,
        entities=sorted(entities_by_id.values(), key=lambda item: item.id),
        facts=sorted(facts_by_id.values(), key=lambda item: item.id),
        relations=sorted(relations_by_id.values(), key=lambda item: item.id),
        document_links=base.document_links,
        review_tasks=sorted(tasks_by_id.values(), key=lambda item: item.id),
    )
    validate_knowledge_workspace(workspace, documents)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        yaml.safe_dump(
            workspace.model_dump(by_alias=True, mode="json"),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return AiImportReport(
        tasks=len(responses),
        entities=len(workspace.entities),
        facts=len(workspace.facts),
        relations=len(workspace.relations),
        review_tasks=len(workspace.review_tasks),
        output=str(output_path),
    )


def approve_knowledge(
    input_path: Path,
    output_path: Path,
    identifiers: set[str],
    reviewer: str,
) -> KnowledgeSummary:
    if not reviewer.strip():
        raise ValueError("Reviewer identity is required.")
    workspace = KnowledgeWorkspace.model_validate(_read_yaml_mapping(input_path))
    known_ids = (
        {item.id for item in workspace.facts}
        | {item.id for item in workspace.relations}
        | {item.id for item in workspace.document_links}
    )
    unknown = identifiers - known_ids
    if unknown:
        raise ValueError(f"Cannot approve unknown knowledge ids: {', '.join(sorted(unknown))}")
    reviewed_at = _utc_now()
    for fact in workspace.facts:
        if fact.id not in identifiers:
            continue
        fact.review_status = "reviewed"
        fact.metadata["reviewedBy"] = reviewer
        fact.metadata["reviewedAt"] = reviewed_at
    for relation in workspace.relations:
        if relation.id not in identifiers:
            continue
        relation.review_status = "reviewed"
        relation.metadata["reviewedBy"] = reviewer
        relation.metadata["reviewedAt"] = reviewed_at
        relation.weights.editorial_review = 1.0
        relation.final_weight = relation.weights.total()
    for link in workspace.document_links:
        if link.id not in identifiers:
            continue
        link.review_status = "reviewed"
        link.metadata["reviewedBy"] = reviewer
        link.metadata["reviewedAt"] = reviewed_at
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        yaml.safe_dump(
            workspace.model_dump(by_alias=True, mode="json"),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return knowledge_summary(workspace)
