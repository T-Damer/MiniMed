"""Compile terminology into ordinary schema-2 MiniMed packs, never a second runtime schema."""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import sqlite3
import tempfile
from pathlib import Path

import yaml

from .builder import build_content_pack
from .knowledge import (
    KnowledgeDocumentLink,
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeFact,
    KnowledgeName,
    KnowledgeWorkspace,
    validate_knowledge_workspace,
)
from .markdown_parser import parse_markdown_document
from .models import PackDocument, SourceMetadata
from .sqlite_composer import compose_sqlite_packs
from .terminology_models import MedicalTerm, TerminologySources
from .terminology_names import russian_search_spelling, terminology_search_aliases
from .terminology_prepare import (
    definition,
    display_name,
    json_bytes,
    module_id,
    read_terms,
    term_document_id,
    term_sections,
)
from .terminology_sources import NLM_ATTRIBUTION, NLM_TERMS, sha256_file
from .text_encoding import lint_english_dominant_russian_text, lint_garbled_russian_text


def concept_id(term: MedicalTerm) -> str:
    # Same identity convention as core_knowledge's projection of targetDocumentId.
    return "core.concept." + hashlib.sha256(term_document_id(term).encode()).hexdigest()[:24]


def _source_body(text: str) -> str:
    # Markdown is only a derived search projection. Original text remains verbatim in terms.jsonl
    # and sourceDefinitions metadata. Refuse control-like prose instead of executing author markers.
    result = " ".join(text.split())
    if result.startswith(("#", "<!--")):
        raise ValueError(
            "Source field resembles Markdown control syntax; editorial preparation required."
        )
    return result


def _write_document(
    root: Path,
    term: MedicalTerm,
    manifest: TerminologySources,
    version: str,
    built_at: str,
    *,
    discovery: bool,
) -> PackDocument:
    selected = display_name(term)
    chosen = definition(term)
    source_by_id = {s.id: s for s in manifest.sources}
    # The bibliographic title belongs to the original MeSH source, not a translated label.
    # A Russian display name does not turn an English scope note into Russian OCR output.
    original = min(
        (n for n in term.names if n.language == "en" and n.kind == "preferred"),
        key=lambda n: (n.text, n.evidence.locator),
    )
    source = source_by_id[original.evidence.source_id]
    definitions = ([chosen] if chosen else []) if discovery else term.definitions
    # Mixed-language reference cards are checked field by field. Never suppress the existing
    # Russian source guards: a definition declared Russian must itself remain Russian.
    for item in definitions:
        if item.language != "ru":
            continue
        context = f"{term.id}/{item.evidence.source_id}/{item.evidence.locator}"
        error = lint_garbled_russian_text(item.text, context=context)
        error = error or lint_english_dominant_russian_text(item.text, context=context)
        if error:
            raise ValueError(error)
    target_id = term_document_id(term)
    document_id = f"discovery.{target_id}" if discovery else target_id
    sections = term_sections(term)
    specialties = (
        ["psychiatry", "psychology"]
        if any(s.startswith("F") for s in sections)
        else ["medical-reference"]
    )
    metadata: dict[str, object] = {
        "catalogFamily": "reference",
        "entityType": "condition"
        if any(t in {"T047", "T048", "T046", "T184"} for t in term.semantic_types)
        else "term",
        "terminology": {
            "version": 1,
            "edition": version,
            "conceptId": term.id,
            "names": sorted(
                {v for n in term.names for v in (n.text, russian_search_spelling(n.text))}
            ),
            "relatedConceptIds": sorted({r.object_id for r in term.relations}),
            "definitionLanguages": sorted({item.language for item in definitions}),
            "discovery": discovery,
            "targetDocumentId": target_id,
        },
        "conceptId": concept_id(term),
        "terminologyId": term.id,
        "meshConceptId": term.mesh_concept_id,
        "meshDescriptorIds": term.descriptor_ids,
        "meshTreeNumbers": term.tree_numbers,
        "terminologySections": sections,
        "semanticTypes": term.semantic_types,
        "sourceTitleLanguage": original.language,
        "nameLanguage": selected.language,
        "definitionLanguages": sorted({item.language for item in definitions}),
        "nameStatus": selected.kind,
        "sourceNames": [n.model_dump(by_alias=True) for n in term.names],
        "sourceDefinitions": [d.model_dump(by_alias=True) for d in definitions],
        "sourceRelations": [r.model_dump(by_alias=True) for r in term.relations],
        "definitionStatus": "source-backed" if chosen else "missing-in-source",
        "authorityTier": "professional-reference",
        "reviewStatus": "proposed",
        "contentMode": "terminology-reference",
        "notClinicalGuidance": True,
        "provenance": source.provenance.model_dump(by_alias=True),
        "terminologySources": [s.provenance.model_dump(by_alias=True) for s in manifest.sources],
        "declaredAliases": sorted({n.text for n in term.names if n.kind in ("preferred", "alias")}),
        "attribution": NLM_ATTRIBUTION,
        "sourceTerms": NLM_TERMS,
    }
    if discovery:
        metadata.pop("sourceNames")
        metadata.pop("sourceRelations")
        metadata.update(
            {
                "contentMode": "module-pointer",
                "targetDocumentId": target_id,
                "primaryModuleId": module_id(sections[0]),
                "moduleIds": [module_id(sections[0])],
                "clinicalSourceType": "medical_terminology",
                "pointerKind": "terminology",
            }
        )
    raw_checksum = (
        "sha256:" + hashlib.sha256(json_bytes(term.model_dump(by_alias=True))).hexdigest()
    )
    source_metadata = SourceMetadata(
        id=document_id,
        title=original.text,
        short_title=selected.text,
        version_label=version,
        source_type="core_catalog_pointer" if discovery else "medical_terminology",
        status="active",
        specialties=specialties,
        source_file=f"terms.jsonl#{term.id}",
        source_checksum=raw_checksum,
        synthetic_fixture=False,
        metadata=metadata,
    )
    body = ["# Наименования", _source_body(selected.text)]
    names = [_source_body(n) for n in sorted({n.text for n in term.names}) if n != selected.text]
    if discovery and names:
        body.append("; ".join(names))
    else:
        body.extend(names)
    for index, item in enumerate(definitions):
        locator = item.evidence.model_dump(by_alias=True)
        body.extend(
            [
                f"# Определение {index + 1} ({item.language})",
                "<!-- localmed:source " + json.dumps(locator, ensure_ascii=False) + " -->",
                _source_body(item.text),
            ]
        )
    if not definitions:
        body.extend(["# Покрытие", "Определение отсутствует в исходном источнике."])
    path = root / f"{term.mesh_concept_id}.md"
    path.write_text(
        "---\n"
        + yaml.safe_dump(
            source_metadata.model_dump(by_alias=True), allow_unicode=True, sort_keys=False
        )
        + "---\n\n"
        + "\n\n".join(body)
        + "\n",
        "utf-8",
    )
    return parse_markdown_document(path, extracted_at=built_at)


def _knowledge(terms: list[MedicalTerm], documents: list[PackDocument]) -> KnowledgeWorkspace:
    entities: list[KnowledgeEntity] = []
    facts: list[KnowledgeFact] = []
    links: list[KnowledgeDocumentLink] = []
    for term, document in zip(terms, documents, strict=True):
        entity_id = concept_id(term)
        names = {(n.text, n.language, n.kind) for n in term.names}
        entities.append(
            KnowledgeEntity(
                id=entity_id,
                entity_type="medical-concept",
                canonical_name=display_name(term).text,
                names=[
                    KnowledgeName(
                        name=text,
                        language=lang,
                        name_type=kind,
                        weight=0.5 if kind.startswith("candidate-") else 1,
                    )
                    for text, lang, kind in sorted(names)
                ],
                external_ids={"mesh-concept": term.mesh_concept_id},
                metadata={
                    "terminologyId": term.id,
                    "descriptorIds": term.descriptor_ids,
                    "treeNumbers": term.tree_numbers,
                    "reviewStatus": "proposed",
                },
            )
        )
        links.append(
            KnowledgeDocumentLink(
                id=f"terminology-link.{document.id}",
                entity_id=entity_id,
                document_id=document.id,
                document_version_id=document.version.id,
            )
        )
        for section in document.sections:
            if not section.title.startswith("Определение "):
                continue
            for chunk in section.chunks:
                locator = {
                    "sourceSpans": chunk.metadata.get("sourceSpans", []),
                    "anchor": chunk.anchor,
                    "transformation": "whitespace-normalized",
                }
                facts.append(
                    KnowledgeFact(
                        id=f"terminology-definition.{chunk.id}",
                        entity_id=entity_id,
                        fact_type="definition",
                        text=chunk.original_text,
                        authority_tier="professional-reference",
                        jurisdiction="international",
                        evidence=[
                            KnowledgeEvidence(
                                document_id=document.id,
                                document_version_id=document.version.id,
                                section_id=section.id,
                                chunk_id=chunk.id,
                                quote=chunk.original_text,
                                source_locator=locator,
                            )
                        ],
                        metadata={"clinicalApproval": False, "sourceBacked": True},
                    )
                )
    result = KnowledgeWorkspace(entities=entities, facts=facts, document_links=links)
    validate_knowledge_workspace(result, documents)
    return result


DISCOVERY_BATCH_SIZE = 384


def _compress_database(db: Path) -> Path:
    compressed = db.with_suffix(".db.gz")
    with (
        db.open("rb") as source,
        compressed.open("wb") as destination,
        gzip.GzipFile(fileobj=destination, mode="wb", filename="", mtime=0) as stream,
    ):
        shutil.copyfileobj(source, stream, 1024 * 1024)
    return compressed


def _build_discovery_batches(
    terms: list[MedicalTerm],
    manifest: TerminologySources,
    root: Path,
    pack_id: str,
    version: str,
    built_at: str,
) -> dict[str, object]:
    """Bound authoring/knowledge validation memory, then use the existing atomic composer."""
    intermediate = root / "discovery-build-parts"
    databases: list[Path] = []
    for offset in range(0, len(terms), DISCOVERY_BATCH_SIZE):
        batch_root = intermediate / f"{offset // DISCOVERY_BATCH_SIZE:04d}"
        part_id = f"{pack_id}.build.{offset // DISCOVERY_BATCH_SIZE:04d}"
        _build_pack(
            terms[offset : offset + DISCOVERY_BATCH_SIZE],
            manifest,
            batch_root,
            part_id,
            version,
            built_at,
            discovery=True,
        )
        databases.append(batch_root / f"{part_id}.db")
    db = root / f"{pack_id}.db"
    result = compose_sqlite_packs(
        databases,
        db,
        root / f"{pack_id}.edition.json",
        edition_id=pack_id,
        edition_version=version,
        title="Медицинские термины — индекс с определениями",
        built_at=built_at,
        compact=True,
    )
    compressed = _compress_database(db)
    membership_path = root / f"{pack_id}.membership.json"
    connection = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        membership = [
            {"documentId": row[0], "documentVersionId": row[1], "sourceChecksum": row[2]}
            for row in connection.execute(
                "SELECT d.id, d.current_version_id, dv.source_checksum FROM documents d "
                "JOIN document_versions dv ON dv.id=d.current_version_id ORDER BY d.id"
            )
        ]
        chunks = connection.execute("SELECT count(*) FROM chunks").fetchone()[0]
    finally:
        connection.close()
    membership_path.write_bytes(json_bytes(membership))
    (root / f"{pack_id}.report.json").write_text(result.model_dump_json(by_alias=True, indent=2))
    # Original authoring workspaces remain reviewable; redundant internal SQLite copies do not ship.
    for part in databases:
        part.unlink()
        part.with_suffix(".db.gz").unlink()
    return {
        "moduleId": pack_id,
        "version": version,
        "database": db.name,
        "documents": len(membership),
        "chunks": chunks,
        "bytes": db.stat().st_size,
        "sha256": sha256_file(db),
        "gzipBytes": compressed.stat().st_size,
        "gzipSha256": sha256_file(compressed),
        "membership": membership_path.name,
        "membershipSha256": sha256_file(membership_path),
        "publicationState": "local-dev",
        "downloadUrl": None,
        "authoringBatchSize": DISCOVERY_BATCH_SIZE,
    }


def _build_pack(
    terms: list[MedicalTerm],
    manifest: TerminologySources,
    root: Path,
    pack_id: str,
    version: str,
    built_at: str,
    *,
    discovery: bool,
) -> dict[str, object]:
    if discovery and len(terms) > DISCOVERY_BATCH_SIZE:
        return _build_discovery_batches(terms, manifest, root, pack_id, version, built_at)
    workspace = root / "workspaces" / pack_id
    workspace.mkdir(parents=True)
    (workspace / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": pack_id,
                "version": version,
                "schemaVersion": 2,
                "title": "Медицинские термины — "
                + ("индекс с определениями" if discovery else pack_id.rsplit(".", 1)[-1]),
                "builtAt": built_at,
                "publicationState": "local-dev",
            },
            allow_unicode=True,
        ),
        "utf-8",
    )
    # Source names stay in their own sections. Derived mixed-script spellings expand lookup only;
    # they never establish concept identity, clinical synonymy, or a navigation link.
    aliases = terminology_search_aliases(terms)
    (workspace / "aliases.yaml").write_text(
        yaml.safe_dump(
            {"aliases": [a.model_dump(by_alias=True) for a in aliases]}, allow_unicode=True
        ),
        "utf-8",
    )
    documents = [
        _write_document(workspace, t, manifest, version, built_at, discovery=discovery)
        for t in terms
    ]
    knowledge = _knowledge(terms, documents)
    (workspace / "knowledge.json").write_text(
        knowledge.model_dump_json(by_alias=True, indent=2) + "\n", "utf-8"
    )
    db = root / f"{pack_id}.db"
    pack, report = build_content_pack(
        workspace, db, report_path=root / f"{pack_id}.report.json", include_embeddings=not discovery
    )
    compressed = _compress_database(db)
    membership = [
        {
            "documentId": d.id,
            "documentVersionId": d.version.id,
            "sourceChecksum": d.version.source_checksum,
        }
        for d in pack.documents
    ]
    membership_path = root / f"{pack_id}.membership.json"
    membership_path.write_bytes(json_bytes(membership))
    return {
        "moduleId": pack_id,
        "version": version,
        "database": db.name,
        "documents": report.documents,
        "chunks": report.chunks,
        "bytes": db.stat().st_size,
        "sha256": sha256_file(db),
        "gzipBytes": compressed.stat().st_size,
        "gzipSha256": sha256_file(compressed),
        "membership": membership_path.name,
        "membershipSha256": sha256_file(membership_path),
        "publicationState": "local-dev",
        "downloadUrl": None,
    }


def build_terminology_packs(
    prepared: Path,
    output: Path,
    *,
    version: str,
    built_at: str,
    sections: list[str] | None = None,
    include_core: bool = True,
    for_redistribution: bool = False,
) -> dict[str, object]:
    """Stage immutable packs for measurement; current core and runtime catalog are untouched."""
    if output.exists():
        raise ValueError("Pack output exists; use a new immutable edition directory.")
    if not version.strip() or not built_at.strip():
        raise ValueError("An explicit version and build timestamp are required.")
    terms, sources, plan = read_terms(prepared)
    if for_redistribution:
        for source in sources.sources:
            p = source.provenance
            if (
                p.rights_status != "verified"
                or not p.rights.allows_redistribution
                or p.rights.expires_at
            ):
                raise ValueError(f"Redistribution review required for {source.id}.")
    by_id = {t.id: t for t in terms}
    by_section = {s.id: s for s in plan}
    requested = set(sections) if sections is not None else set(by_section)
    if requested - set(by_section):
        raise ValueError(
            "Unknown terminology section: " + ", ".join(sorted(requested - set(by_section)))
        )
    if not requested and not include_core:
        raise ValueError("Select at least one section or the core discovery index.")
    # Multi-specialty entries have one storage owner. Include all owners needed by a section.
    owners = {
        term_sections(by_id[identifier])[0]
        for s in requested
        for identifier in by_section[s].member_term_ids
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="terminology-build-", dir=output.parent) as temporary:
        staging = Path(temporary) / "packs"
        staging.mkdir()
        packs = [
            _build_pack(
                [by_id[i] for i in by_section[owner].owned_term_ids],
                sources,
                staging,
                module_id(owner),
                version,
                built_at,
                discovery=False,
            )
            for owner in sorted(owners)
        ]
        if include_core:
            packs.insert(
                0,
                _build_pack(
                    terms,
                    sources,
                    staging,
                    "minimed.terminology.discovery",
                    version,
                    built_at,
                    discovery=True,
                ),
            )
        report: dict[str, object] = {
            "schemaVersion": 1,
            "version": version,
            "runtimeChanged": False,
            "redistributionPreflight": for_redistribution,
            "publicationState": "local-dev",
            "requestedSections": sorted(requested),
            "includedOwnerSections": sorted(owners),
            "packs": packs,
            "sections": [s.model_dump(by_alias=True) for s in plan],
        }
        (staging / "pack-size-report.json").write_bytes(json_bytes(report))
        (staging / "ATTRIBUTION.txt").write_text(
            NLM_ATTRIBUTION
            + "\n"
            + NLM_TERMS
            + "\nNo NLM endorsement. Snapshot editions: "
            + ", ".join(f"{s.id}: {s.edition}" for s in sources.sources)
            + "\nNot necessarily the latest data. "
            "These are terminology references, not clinical guidance.\n",
            "utf-8",
        )
        staging.rename(output)
    return report
