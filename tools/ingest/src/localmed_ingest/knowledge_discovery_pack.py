"""Build a compact source-backed discovery pack from structured MiniMed knowledge.

The output is an ordinary schema-compatible SQLite content pack. It is a search/navigation
projection only: knowledge_* rows in the source databases remain the canonical structured records.
No definition, synonym or relation is invented here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from .edition_manifest import sha256_file
from .embedding import PORTABLE_HASH_PROFILE, build_chunk_embedding, normalize_text
from .models import (
    Alias,
    ChunkEmbedding,
    ContentPack,
    PackChunk,
    PackDocument,
    PackManifest,
    PackSection,
    PackVersion,
)
from .sqlite_builder import inspect_integrity, write_sqlite_pack

_REQUIRED_TABLES = {
    "documents",
    "document_versions",
    "sections",
    "chunks",
    "knowledge_entities",
    "knowledge_names",
    "knowledge_facts",
    "knowledge_evidence",
    "knowledge_document_links",
}
_DEFINITION_FACT_TYPES = ("definition", "description", "summary")
_AUTHORITY_PRIORITY = {
    "clinical-guideline": 0,
    "official-registry": 1,
    "professional-reference": 2,
    "official-reference": 2,
    "third-party": 3,
}


@dataclass(frozen=True)
class DiscoverySource:
    document_id: str
    document_version_id: str
    title: str
    section_id: str | None
    chunk_id: str | None
    anchor: str | None
    link_type: str
    weight: float


@dataclass(frozen=True)
class DiscoveryDefinition:
    fact_id: str
    text: str
    authority_tier: str
    confidence: float
    source: DiscoverySource


@dataclass
class DiscoveryEntity:
    id: str
    entity_type: str
    canonical_name: str
    metadata: dict[str, object]
    names: dict[str, float] = field(default_factory=dict)
    definitions: list[DiscoveryDefinition] = field(default_factory=list)
    sources: dict[tuple[str, str | None, str | None], DiscoverySource] = field(
        default_factory=dict
    )


def _json_object(raw: object, context: str) -> dict[str, object]:
    if not isinstance(raw, str):
        raise ValueError(f"{context} must be JSON text.")
    value: object = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"{context} must be a JSON object.")
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({item.strip() for item in value if isinstance(item, str) and item.strip()})


def _open_source(path: Path) -> sqlite3.Connection:
    source = path.resolve(strict=True)
    connection = sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    integrity = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
    if integrity != ["ok"]:
        connection.close()
        raise ValueError(f"Knowledge source failed integrity check: {source}: {integrity[:5]}")
    if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
        connection.close()
        raise ValueError(f"Knowledge source failed foreign-key check: {source}")
    tables = {
        str(row[0])
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    missing = sorted(_REQUIRED_TABLES - tables)
    if missing:
        connection.close()
        raise ValueError(f"Knowledge source lacks required tables {missing}: {source}")
    return connection


def _source_from_row(row: sqlite3.Row, *, link_type: str, weight: float) -> DiscoverySource:
    return DiscoverySource(
        document_id=str(row["document_id"]),
        document_version_id=str(row["document_version_id"]),
        title=str(row["document_title"]),
        section_id=str(row["section_id"]) if row["section_id"] is not None else None,
        chunk_id=str(row["chunk_id"]) if row["chunk_id"] is not None else None,
        anchor=str(row["anchor"]) if row["anchor"] is not None else None,
        link_type=link_type,
        weight=weight,
    )


def _definition_priority(item: DiscoveryDefinition) -> tuple[int, float, str, str]:
    return (
        _AUTHORITY_PRIORITY.get(item.authority_tier, 10),
        -item.confidence,
        item.fact_id,
        item.source.document_id,
    )


def _merge_entity(target: DiscoveryEntity, incoming: DiscoveryEntity) -> None:
    if (
        target.entity_type != incoming.entity_type
        or normalize_text(target.canonical_name) != normalize_text(incoming.canonical_name)
    ):
        raise ValueError(f"Conflicting knowledge identity for {target.id}.")
    for name, weight in incoming.names.items():
        target.names[name] = max(target.names.get(name, 0), weight)
    target.definitions.extend(incoming.definitions)
    for key, source in incoming.sources.items():
        previous = target.sources.get(key)
        if previous is None or source.weight > previous.weight:
            target.sources[key] = source
    for key in ("tags", "specialties", "ageGroups", "moduleIds"):
        merged = sorted(set(_strings(target.metadata.get(key))) | set(_strings(incoming.metadata.get(key))))
        if merged:
            target.metadata[key] = merged
    for key in (
        "primaryModuleId",
        "jurisdiction",
        "interactiveAssessmentId",
        "interactiveCalculatorId",
    ):
        current = target.metadata.get(key)
        candidate = incoming.metadata.get(key)
        if current is None and candidate is not None:
            target.metadata[key] = candidate
        elif current is not None and candidate is not None and current != candidate:
            raise ValueError(f"Conflicting {key} for knowledge entity {target.id}.")


def _read_entity(connection: sqlite3.Connection, row: sqlite3.Row) -> DiscoveryEntity:
    entity_id = str(row["id"])
    entity = DiscoveryEntity(
        id=entity_id,
        entity_type=str(row["entity_type"]),
        canonical_name=str(row["canonical_name"]),
        metadata=_json_object(row["metadata_json"], f"knowledge entity {entity_id} metadata"),
    )
    entity.names[entity.canonical_name] = 2.0
    for name_row in connection.execute(
        """SELECT name, weight FROM knowledge_names
        WHERE entity_id = ? ORDER BY weight DESC, id""",
        (entity_id,),
    ):
        name = str(name_row["name"]).strip()
        if name:
            entity.names[name] = max(entity.names.get(name, 0), float(name_row["weight"]))

    for source_row in connection.execute(
        """SELECT l.document_id, l.document_version_id, l.section_id, l.chunk_id,
                  l.link_type, l.weight, d.title AS document_title, c.anchor
        FROM knowledge_document_links l
        JOIN documents d ON d.id = l.document_id
        LEFT JOIN chunks c ON c.id = l.chunk_id
        WHERE l.entity_id = ? AND l.review_status = 'reviewed'
        ORDER BY l.weight DESC, l.id""",
        (entity_id,),
    ):
        source = _source_from_row(
            source_row, link_type=str(source_row["link_type"]), weight=float(source_row["weight"])
        )
        entity.sources[(source.document_id, source.section_id, source.chunk_id)] = source

    placeholders = ",".join("?" for _ in _DEFINITION_FACT_TYPES)
    for definition_row in connection.execute(
        f"""SELECT f.id AS fact_id, f.original_text, f.authority_tier, f.confidence,
                   e.document_id, e.document_version_id, e.section_id, e.chunk_id,
                   d.title AS document_title, c.anchor
        FROM knowledge_facts f
        JOIN knowledge_evidence e ON e.fact_id = f.id
        JOIN documents d ON d.id = e.document_id
        JOIN chunks c ON c.id = e.chunk_id
        WHERE f.entity_id = ? AND f.review_status = 'reviewed'
          AND f.fact_type IN ({placeholders})
        ORDER BY f.id, e.id""",
        (entity_id, *_DEFINITION_FACT_TYPES),
    ):
        source = _source_from_row(definition_row, link_type="definition", weight=1.0)
        entity.sources.setdefault(
            (source.document_id, source.section_id, source.chunk_id), source
        )
        entity.definitions.append(
            DiscoveryDefinition(
                fact_id=str(definition_row["fact_id"]),
                text=str(definition_row["original_text"]),
                authority_tier=str(definition_row["authority_tier"]),
                confidence=float(definition_row["confidence"]),
                source=source,
            )
        )
    return entity


def load_discovery_entities(
    inputs: tuple[Path, ...], *, entity_types: frozenset[str] | None = None
) -> tuple[DiscoveryEntity, ...]:
    if not inputs:
        raise ValueError("At least one knowledge SQLite source is required.")
    entities: dict[str, DiscoveryEntity] = {}
    for path in inputs:
        connection = _open_source(path)
        try:
            rows = connection.execute(
                """SELECT id, entity_type, canonical_name, metadata_json
                FROM knowledge_entities ORDER BY id"""
            ).fetchall()
            for row in rows:
                entity_type = str(row["entity_type"])
                if entity_types is not None and entity_type not in entity_types:
                    continue
                incoming = _read_entity(connection, row)
                # Discovery cards must be traceable to at least one concrete source document.
                if not incoming.sources:
                    continue
                existing = entities.get(incoming.id)
                if existing is None:
                    entities[incoming.id] = incoming
                else:
                    _merge_entity(existing, incoming)
        finally:
            connection.close()
    return tuple(entities[key] for key in sorted(entities))


def _stable_id(kind: str, value: str) -> str:
    return f"knowledge.discovery.{kind}." + hashlib.sha256(value.encode()).hexdigest()[:24]


def _concept_embedding_text(entity: DiscoveryEntity) -> str:
    definition = min(entity.definitions, key=_definition_priority) if entity.definitions else None
    aliases = sorted(
        name
        for name in entity.names
        if normalize_text(name) != normalize_text(entity.canonical_name)
    )
    return "\n".join(
        [
            entity.canonical_name,
            *aliases,
            *([definition.text] if definition is not None else []),
        ]
    )


def _entity_digest(entity: DiscoveryEntity) -> str:
    payload = {
        "id": entity.id,
        "type": entity.entity_type,
        "name": entity.canonical_name,
        "names": sorted(entity.names.items()),
        "definitions": [
            {
                "id": item.fact_id,
                "text": item.text,
                "authority": item.authority_tier,
                "confidence": item.confidence,
                "document": item.source.document_id,
                "chunk": item.source.chunk_id,
            }
            for item in sorted(entity.definitions, key=_definition_priority)
        ],
        "sources": [
            {
                "document": item.document_id,
                "version": item.document_version_id,
                "section": item.section_id,
                "chunk": item.chunk_id,
                "anchor": item.anchor,
                "linkType": item.link_type,
                "weight": item.weight,
            }
            for item in sorted(
                entity.sources.values(),
                key=lambda item: (-item.weight, item.document_id, item.section_id or "", item.chunk_id or ""),
            )
        ],
        "metadata": entity.metadata,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _document_for_entity(
    entity: DiscoveryEntity, *, version: str, built_at: str
) -> tuple[PackDocument, list[Alias]]:
    document_id = _stable_id("entity", entity.id)
    version_id = f"{document_id}@{version}"
    ordered_sources = sorted(
        entity.sources.values(),
        key=lambda item: (-item.weight, item.document_id, item.section_id or "", item.chunk_id or ""),
    )
    definition = min(entity.definitions, key=_definition_priority) if entity.definitions else None
    aliases = sorted(
        (name, weight)
        for name, weight in entity.names.items()
        if normalize_text(name) != normalize_text(entity.canonical_name)
    )
    specialties = _strings(entity.metadata.get("specialties"))
    tags = _strings(entity.metadata.get("tags"))
    age_groups = _strings(entity.metadata.get("ageGroups"))
    module_ids = _strings(entity.metadata.get("moduleIds"))
    metadata: dict[str, object] = {
        "contentMode": "knowledge-discovery",
        "catalogFamily": "knowledge",
        "conceptId": entity.id,
        "entityType": entity.entity_type,
        "declaredAliases": [name for name, _ in aliases],
        "sourceDocumentIds": [source.document_id for source in ordered_sources],
        "tags": tags,
        "ageGroups": age_groups,
        "moduleIds": module_ids,
        "discoveryProjection": 1,
    }
    primary_module_id = entity.metadata.get("primaryModuleId")
    if isinstance(primary_module_id, str) and primary_module_id.strip():
        metadata["primaryModuleId"] = primary_module_id.strip()
    for key in ("interactiveAssessmentId", "interactiveCalculatorId"):
        value = entity.metadata.get(key)
        if isinstance(value, str) and value.strip():
            metadata[key] = value.strip()
    calculation_required = entity.metadata.get("calculationRequired")
    if isinstance(calculation_required, bool):
        metadata["calculationRequired"] = calculation_required
    if definition is not None:
        metadata["canonicalDefinition"] = {
            "definitionId": definition.fact_id,
            "text": definition.text,
            "sourceDocumentId": definition.source.document_id,
            "sourceDocumentVersionId": definition.source.document_version_id,
            "sourceSectionId": definition.source.section_id,
            "sourceChunkId": definition.source.chunk_id,
            "sourceAnchor": definition.source.anchor,
        }
    description_title = "Краткое описание" if definition is not None else "Справочная карточка"
    description_text = (
        definition.text
        if definition is not None
        else f"Справочная карточка «{entity.canonical_name}». Подробные сведения находятся в связанном источнике."
    )
    description_section_id = _stable_id("section", f"{entity.id}|description")
    description_chunk_id = _stable_id("chunk", f"{entity.id}|description")
    sections = [
        PackSection(
            id=description_section_id,
            title=description_title,
            normalized_title=normalize_text(description_title),
            section_type="definition" if definition is not None else "routing",
            depth=1,
            order_index=0,
            anchor=f"{version_id}/description",
            section_path=[description_title],
            chunks=[
                PackChunk(
                    id=description_chunk_id,
                    order_index=0,
                    original_text=description_text,
                    normalized_text=normalize_text(
                        " ".join([entity.canonical_name, *[name for name, _ in aliases], description_text])
                    ),
                    anchor=f"{version_id}/description/{description_chunk_id}",
                    metadata={
                        "knowledgeEntityId": entity.id,
                        "sourceDocumentIds": metadata["sourceDocumentIds"],
                        **(
                            {"sourceLocator": metadata["canonicalDefinition"]}
                            if "canonicalDefinition" in metadata
                            else {}
                        ),
                    },
                )
            ],
        )
    ]
    if ordered_sources:
        source_section_id = _stable_id("section", f"{entity.id}|sources")
        source_chunk_id = _stable_id("chunk", f"{entity.id}|sources")
        source_text = "\n".join(
            f"- {source.title} [{source.link_type}]" for source in ordered_sources
        )
        sections.append(
            PackSection(
                id=source_section_id,
                title="Связанные материалы",
                normalized_title=normalize_text("Связанные материалы"),
                section_type="routing",
                depth=1,
                order_index=1,
                anchor=f"{version_id}/sources",
                section_path=["Связанные материалы"],
                chunks=[
                    PackChunk(
                        id=source_chunk_id,
                        order_index=1,
                        original_text=source_text,
                        normalized_text=normalize_text(source_text),
                        anchor=f"{version_id}/sources/{source_chunk_id}",
                        metadata={
                            "knowledgeEntityId": entity.id,
                            "sourceDocumentIds": [source.document_id for source in ordered_sources],
                        },
                    )
                ],
            )
        )
    document = PackDocument(
        id=document_id,
        title=entity.canonical_name,
        short_title=entity.canonical_name,
        source_type="medical_reference",
        status="active",
        specialties=specialties,
        metadata=metadata,
        version=PackVersion(
            id=version_id,
            label=version,
            source_checksum=_entity_digest(entity),
            extracted_at=built_at,
        ),
        sections=sections,
    )
    alias_rows = [
        Alias(
            id=_stable_id("alias", f"{entity.id}|{name}"),
            canonical_term=entity.canonical_name,
            alias=name,
            category=f"knowledge:{entity.entity_type}",
            weight=min(2.0, max(0.01, weight)),
        )
        for name, weight in aliases
    ]
    return document, alias_rows


def build_knowledge_discovery_pack(
    inputs: tuple[Path, ...],
    output: Path,
    *,
    edition_id: str,
    version: str,
    built_at: str,
    entity_types: frozenset[str] | None = None,
    include_portable_vectors: bool = False,
) -> int:
    if output.exists():
        raise ValueError("Output is immutable; choose a new discovery-pack path.")
    resolved_output = output.resolve()
    if any(path.resolve(strict=True) == resolved_output for path in inputs):
        raise ValueError("Discovery output must not overwrite a source database.")
    entities = load_discovery_entities(inputs, entity_types=entity_types)
    documents: list[PackDocument] = []
    aliases: list[Alias] = []
    embeddings: list[ChunkEmbedding] = []
    for entity in entities:
        document, entity_aliases = _document_for_entity(entity, version=version, built_at=built_at)
        documents.append(document)
        aliases.extend(entity_aliases)
        if include_portable_vectors:
            description_chunk = document.sections[0].chunks[0]
            embeddings.append(
                build_chunk_embedding(
                    description_chunk.id,
                    _concept_embedding_text(entity),
                    PORTABLE_HASH_PROFILE,
                )
            )
    source_fingerprints = [
        {"path": str(path.resolve()), "sha256": sha256_file(path.resolve(strict=True))}
        for path in inputs
    ]
    manifest_payload = json.dumps(
        {
            "editionId": edition_id,
            "version": version,
            "entityTypes": sorted(entity_types) if entity_types is not None else None,
            "sources": source_fingerprints,
            "entityIds": [entity.id for entity in entities],
            "embeddingProfile": (
                PORTABLE_HASH_PROFILE.id if include_portable_vectors else None
            ),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    pack = ContentPack(
        manifest=PackManifest(
            id=edition_id,
            version=version,
            schema_version=5,
            title="MiniMed knowledge discovery projection",
            built_at=built_at,
            checksum="sha256:" + hashlib.sha256(manifest_payload).hexdigest(),
            publication_state="local-dev",
        ),
        documents=documents,
        aliases=aliases,
        embedding_profiles=[PORTABLE_HASH_PROFILE] if include_portable_vectors else [],
        embeddings=embeddings,
    )
    write_sqlite_pack(pack, output)
    integrity, foreign_keys, chunks, fts_rows, embedding_profiles, embedding_count = (
        inspect_integrity(output)
    )
    expected_profiles = 1 if include_portable_vectors else 0
    expected_embeddings = len(documents) if include_portable_vectors else 0
    if (
        integrity != "ok"
        or foreign_keys != 0
        or chunks != fts_rows
        or embedding_profiles != expected_profiles
        or embedding_count != expected_embeddings
    ):
        output.unlink(missing_ok=True)
        raise ValueError("Built knowledge discovery pack failed SQLite/FTS validation.")
    return len(documents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--built-at", required=True)
    parser.add_argument(
        "--entity-type",
        action="append",
        dest="entity_types",
        help="Repeat to project only selected entity types; omit to project every source-backed entity.",
    )
    parser.add_argument(
        "--include-portable-vectors",
        action="store_true",
        help=(
            "Embed one compact concept card with the existing development int8 profile. "
            "This exercises hybrid retrieval; it is not a neural medical model."
        ),
    )
    args = parser.parse_args()
    count = build_knowledge_discovery_pack(
        tuple(args.input),
        args.output,
        edition_id=args.edition_id,
        version=args.version,
        built_at=args.built_at,
        entity_types=frozenset(args.entity_types) if args.entity_types else None,
        include_portable_vectors=args.include_portable_vectors,
    )
    print(f"Built {count} source-backed knowledge discovery cards: {args.output}")


if __name__ == "__main__":
    main()
