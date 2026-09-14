"""Compile terminology into ordinary schema-2 MiniMed packs, never a second runtime schema."""

from __future__ import annotations

import gzip
import hashlib
import json
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
from .terminology_models import MedicalTerm, TerminologySources
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
                "targetDocumentId": target_id,
                "primaryModuleId": module_id(sections[0]),
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
    body.extend(_source_body(n) for n in sorted({n.text for n in term.names}) if n != selected.text)
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
    # Per-document names are indexed in names sections. Avoid global name-based concept merges.
    (workspace / "aliases.yaml").write_text("aliases: []\n", "utf-8")
    documents = [
        _write_document(workspace, t, manifest, version, built_at, discovery=discovery)
        for t in terms
    ]
    knowledge = _knowledge(terms, documents)
    (workspace / "knowledge.json").write_text(
        knowledge.model_dump_json(by_alias=True, indent=2) + "\n", "utf-8"
    )
    db = root / f"{pack_id}.db"
    pack, report = build_content_pack(workspace, db, report_path=root / f"{pack_id}.report.json")
    compressed = db.with_suffix(".db.gz")
    compressed.write_bytes(gzip.compress(db.read_bytes(), mtime=0))
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
