"""Deterministic navigation projection over source-preserving core pointers.

Names never establish equivalence across source documents. Classification links and definitions
retain their evidence; neither is a treatment recommendation or automatic clinical approval.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from typing import cast

from pydantic import ConfigDict, Field

from .embedding import normalize_text
from .knowledge import (
    KnowledgeDocumentLink,
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeFact,
    KnowledgeName,
    KnowledgeRelation,
    KnowledgeWorkspace,
    RelationWeightComponents,
    write_knowledge_sqlite,
)
from .models import CamelModel

PROJECTION = "core-pointer-knowledge-v1"

# Editorial navigation shorthand; other entities using the same abbreviation remain distinct.
NAVIGATION_ALIASES = {"rls.mkb.classification": ("МКБ", "МКБ-10", "МКБ 10")}


class PointerDefinition(CamelModel):
    model_config = ConfigDict(extra="allow")
    definition_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    source_document_id: str = Field(min_length=1)
    source_document_version_id: str = Field(min_length=1)
    source_section_id: str = Field(min_length=1)
    source_chunk_id: str = Field(min_length=1)
    source_anchor: str = Field(min_length=1)
    source_section_title: str | None = None


def _locator(definition: PointerDefinition) -> dict[str, object]:
    # Full spans/checksums remain in canonicalDefinition on the source pointer. Evidence references
    # that immutable record instead of copying its quote and layout tree into every graph row.
    return {
        key: value
        for key, value in definition.model_dump(by_alias=True).items()
        if key
        in {
            "definitionId",
            "sourceDocumentId",
            "sourceDocumentVersionId",
            "sourceSectionId",
            "sourceChunkId",
            "sourceAnchor",
            "sourceSectionTitle",
        }
    }


def _id(kind: str, value: str) -> str:
    return f"core.{kind}." + hashlib.sha256(value.encode()).hexdigest()[:24]


def _strings(value: object) -> list[str]:
    return (
        sorted({item.strip() for item in value if isinstance(item, str) and item.strip()})
        if isinstance(value, list)
        else []
    )


def _project_definition_chunk(
    connection: sqlite3.Connection,
    document_id: str,
    version_id: str,
    definition: PointerDefinition,
) -> tuple[str, str, str]:
    """Verbatim discovery excerpt; its source locator remains distinct from this local anchor."""
    section_id = _id("definition-section", document_id)
    chunk_id = _id("definition-chunk", document_id)
    anchor = f"{version_id}/definition/{chunk_id}"
    title = definition.source_section_title or "Определение из источника"
    connection.execute(
        "INSERT INTO sections(id, document_version_id, title, normalized_title, section_type, "
        "depth, order_index, anchor, path_json) VALUES (?, ?, ?, ?, 'definition', 1, "
        "(SELECT COALESCE(MAX(order_index), -1) + 1 FROM sections "
        "WHERE document_version_id = ?), ?, ?)",
        (
            section_id,
            version_id,
            title,
            normalize_text(title),
            version_id,
            f"{version_id}/definition",
            json.dumps([title], ensure_ascii=False),
        ),
    )
    connection.execute(
        "INSERT INTO chunks(id, document_version_id, section_id, order_index, original_text, "
        "normalized_text, anchor, metadata_json) VALUES (?, ?, ?, 0, ?, ?, ?, ?)",
        (
            chunk_id,
            version_id,
            section_id,
            definition.text,
            normalize_text(definition.text),
            anchor,
            json.dumps(
                {"projection": PROJECTION, "sourceLocator": _locator(definition)},
                ensure_ascii=False,
            ),
        ),
    )
    return section_id, chunk_id, anchor


def project_core_knowledge(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        "SELECT id, title, current_version_id, metadata_json FROM documents "
        "WHERE source_type = 'core_catalog_pointer' ORDER BY id"
    ).fetchall()
    if not rows:
        return
    connection.execute("DELETE FROM aliases WHERE id LIKE 'core.navigation-alias.%'")
    # Recomposition replaces only this deterministic projection, preserving editorial knowledge.
    connection.execute(
        "DELETE FROM knowledge_entities WHERE json_extract(metadata_json, '$.projection') = ?",
        (PROJECTION,),
    )
    connection.execute(
        "DELETE FROM sections WHERE id IN (SELECT section_id FROM chunks "
        "WHERE json_extract(metadata_json, '$.projection') = ?)",
        (PROJECTION,),
    )
    entities: dict[str, KnowledgeEntity] = {}
    facts: list[KnowledgeFact] = []
    relations: list[KnowledgeRelation] = []
    links: list[KnowledgeDocumentLink] = []
    for document_id, title, version_id, raw_metadata in rows:
        metadata_value: object = json.loads(raw_metadata)
        if not isinstance(metadata_value, dict):
            raise ValueError(f"Pointer {document_id} metadata must be an object.")
        metadata = cast(dict[str, object], metadata_value)
        target_id = metadata.get("targetDocumentId")
        if not isinstance(target_id, str) or not target_id.strip():
            raise ValueError(f"Pointer {document_id} requires targetDocumentId.")
        navigation_aliases = NAVIGATION_ALIASES.get(target_id, ())
        if navigation_aliases:
            metadata["navigationAliases"] = list(navigation_aliases)
            for name in navigation_aliases:
                connection.execute(
                    "INSERT INTO aliases(id, canonical_term, alias, category, weight) "
                    "VALUES (?, ?, ?, 'classification', 1)",
                    (_id("navigation-alias", f"{target_id}|{name}"), title, name),
                )
        entity_id = _id("concept", target_id)
        metadata["conceptId"] = entity_id
        provenance = {
            "projection": PROJECTION,
            **{
                key: metadata[key]
                for key in (
                    "catalogFamily",
                    "entityType",
                    "keywords",
                    "icd10Codes",
                    "specialties",
                    "ageCategories",
                )
                if key in metadata
            },
        }
        entity = entities.get(entity_id)
        if entity is None:
            entity = KnowledgeEntity(
                id=entity_id,
                entity_type=str(metadata.get("entityType", "reference")),
                canonical_name=title,
                external_ids={"sourceDocumentId": target_id},
                metadata=provenance,
            )
            entities[entity_id] = entity
        names = {name.name for name in entity.names} | {entity.canonical_name}
        for name in [title, *_strings(metadata.get("declaredAliases")), *navigation_aliases]:
            if name not in names:
                entity.names.append(KnowledgeName(name=name))
                names.add(name)
        first = connection.execute(
            "SELECT section_id, id, anchor FROM chunks WHERE document_version_id = ? "
            "ORDER BY order_index, id LIMIT 1",
            (version_id,),
        ).fetchone()
        if first is None:
            raise ValueError(f"Pointer {document_id} has no source chunks.")
        authority = (
            "clinical-guideline"
            if metadata.get("catalogFamily") == "clinical"
            else "professional-reference"
        )
        definition_value = metadata.get("canonicalDefinition")
        if definition_value is not None:
            definition = PointerDefinition.model_validate(definition_value)
            if definition.source_document_id != target_id:
                raise ValueError(
                    f"Definition {definition.definition_id} does not belong "
                    f"to pointer target {target_id}."
                )
            local_excerpt = connection.execute(
                "SELECT section_id, id, anchor FROM chunks WHERE document_version_id = ? "
                "AND instr(original_text, ?) > 0 ORDER BY order_index, id LIMIT 1",
                (version_id, definition.text),
            ).fetchone()
            locator = _locator(definition)
            # Original excerpts keep their existing evidence facts. Missing excerpts gain a
            # source-attributed discovery chunk so normal MedicalCore FTS can retrieve the text.
            if local_excerpt:
                facts.append(
                    KnowledgeFact(
                        id=_id("definition-fact", f"{document_id}|{definition.definition_id}"),
                        entity_id=entity_id,
                        fact_type="definition",
                        text=definition.text,
                        authority_tier=authority,
                        structured={"definitionId": definition.definition_id},
                        metadata={"projection": PROJECTION},
                        evidence=[
                            KnowledgeEvidence(
                                document_id=document_id,
                                document_version_id=version_id,
                                section_id=local_excerpt[0],
                                chunk_id=local_excerpt[1],
                                quote=definition.text,
                                source_locator=locator,
                            )
                        ],
                    )
                )
            if local_excerpt is None:
                local_excerpt = _project_definition_chunk(
                    connection, document_id, version_id, definition
                )
            metadata["definitionPreviewAnchor"] = local_excerpt[2]
            links.append(
                KnowledgeDocumentLink(
                    id=_id("definition-link", f"{document_id}|{definition.definition_id}"),
                    entity_id=entity_id,
                    document_id=document_id,
                    document_version_id=version_id,
                    section_id=local_excerpt[0] if local_excerpt else None,
                    chunk_id=local_excerpt[1] if local_excerpt else None,
                    link_type="definition",
                    metadata={
                        "projection": PROJECTION,
                        "anchor": local_excerpt[2] if local_excerpt else None,
                        **locator,
                    },
                )
            )
        links.append(
            KnowledgeDocumentLink(
                id=_id("document-link", document_id),
                entity_id=entity_id,
                document_id=document_id,
                document_version_id=version_id,
                section_id=first[0],
                chunk_id=first[1],
                link_type="discovery-pointer",
                metadata={
                    "projection": PROJECTION,
                    "anchor": first[2],
                    "targetDocumentId": target_id,
                    "moduleIds": metadata.get("moduleIds", []),
                    "primaryModuleId": metadata.get("primaryModuleId"),
                },
            )
        )
        chunks = connection.execute(
            "SELECT section_id, id, anchor, original_text FROM chunks "
            "WHERE document_version_id = ? ORDER BY order_index, id",
            (version_id,),
        ).fetchall()
        for code in _strings(metadata.get("icd10Codes")):
            if re.fullmatch(r"[A-Z][0-9]{2}(?:\.[0-9]{1,4})?", code) is None:
                continue  # Ranges stay explicit metadata; never invent their members.
            evidence_chunk = next(
                (
                    chunk
                    for chunk in chunks
                    if re.search(
                        r"(?<![A-Z0-9.])" + re.escape(code) + r"(?![A-Z0-9]|\.[0-9])", chunk[3]
                    )
                ),
                None,
            )
            if evidence_chunk is None:
                continue
            classification_id = f"core.icd10.{code}"
            entities.setdefault(
                classification_id,
                KnowledgeEntity(
                    id=classification_id,
                    entity_type="classification",
                    canonical_name=f"МКБ-10 {code}",
                    external_ids={"icd10": code},
                    metadata={"projection": PROJECTION},
                ),
            )
            relations.append(
                KnowledgeRelation(
                    id=_id("classification-link", f"{document_id}|{code}"),
                    subject_entity_id=entity_id,
                    object_entity_id=classification_id,
                    predicate="classified-as",
                    relation_status="classification-only",
                    authority_tier=authority,
                    weights=RelationWeightComponents(authority=0.88, evidence_quality=1),
                    evidence=[
                        KnowledgeEvidence(
                            document_id=document_id,
                            document_version_id=version_id,
                            section_id=evidence_chunk[0],
                            chunk_id=evidence_chunk[1],
                            quote=code,
                            source_locator={
                                "anchor": evidence_chunk[2],
                                "field": "icd10Codes",
                                "targetDocumentId": target_id,
                            },
                        )
                    ],
                    metadata={"projection": PROJECTION},
                )
            )
        connection.execute(
            "UPDATE documents SET metadata_json = ? WHERE id = ?",
            (json.dumps(metadata, ensure_ascii=False, separators=(",", ":")), document_id),
        )
    workspace = KnowledgeWorkspace(
        entities=list(entities.values()), facts=facts, relations=relations, document_links=links
    )
    write_knowledge_sqlite(connection, workspace)
