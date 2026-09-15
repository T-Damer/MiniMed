"""Streaming, source-preserving MeSH Descriptor -> Concept -> Term ingestion.

External DTDs are not fetched. Entity declarations/internal DTD subsets are rejected before
ElementTree sees the file. A descriptor's non-preferred concepts remain separate concepts.
"""

from __future__ import annotations

import gzip
import re
import tempfile
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

from .terminology_models import (
    MedicalTerm,
    TermDefinition,
    TermEvidence,
    TerminologySource,
    TermName,
    TermRelation,
)

MAX_XML_BYTES = 768 * 1024 * 1024
MAX_DESCRIPTORS = 100000
TREE_NUMBER = re.compile(r"^[A-Z][0-9]{2}(?:\.[0-9]+)*$")


def evidence(source: TerminologySource, locator: str) -> TermEvidence:
    return TermEvidence(
        source_id=source.id,
        source_checksum=source.sha256,
        source_url=source.provenance.official_locator,
        locator=locator,
    )


@contextmanager
def checked_xml(path: Path, max_bytes: int = MAX_XML_BYTES) -> Iterator[BinaryIO]:
    # Copy to a bounded temporary stream so a late declaration cannot follow already-emitted terms.
    # Check across block boundaries; reject UTF-16/32 to prevent null-byte declaration disguises.
    with path.open("rb") as probe:
        compressed = probe.read(2) == b"\x1f\x8b"
    opener = gzip.open if compressed else open
    with opener(path, "rb") as raw, tempfile.TemporaryFile() as safe:
        size = 0
        tail = b""
        prefix = b""
        while block := raw.read(65536):
            size += len(block)
            if size > max_bytes:
                raise ValueError("MeSH XML exceeds its decompressed byte limit.")
            checked = tail + block
            if b"\x00" in checked or b"<!ENTITY" in checked.upper():
                raise ValueError("MeSH XML entity declarations and non-UTF-8 input are forbidden.")
            if len(prefix) < 65536:
                prefix = (prefix + block)[:65536]
            tail = checked[-16:]
            safe.write(block)
        if re.search(rb"<!DOCTYPE[^>]*\[", prefix, re.IGNORECASE):
            raise ValueError("MeSH XML internal DTD subsets are forbidden.")
        encoding = re.search(rb"encoding\s*=\s*[\'\"]([^\'\"]+)", prefix[:512])
        if encoding and encoding.group(1).lower() not in (b"utf-8", b"us-ascii"):
            raise ValueError("Only UTF-8 MeSH XML is supported.")
        safe.seek(0)
        yield safe


def _required(element: ET.Element, path: str, pattern: str | None = None) -> str:
    text = element.findtext(path)
    if text is None or not text.strip() or (pattern and re.fullmatch(pattern, text) is None):
        raise ValueError(f"Invalid or absent MeSH field: {path}.")
    return text


def _parse_descriptor(element: ET.Element, source: TerminologySource) -> list[MedicalTerm]:
    descriptor_id = _required(element, "DescriptorUI", r"D[0-9]+")
    _required(element, "DescriptorName/String")
    base = f"/DescriptorRecordSet/DescriptorRecord[DescriptorUI='{descriptor_id}']"
    tree_numbers = sorted(
        {node.text or "" for node in element.findall("TreeNumberList/TreeNumber")}
    )
    if any(TREE_NUMBER.fullmatch(value) is None for value in tree_numbers):
        raise ValueError(f"Invalid MeSH tree number in {descriptor_id}.")
    concepts = element.findall("ConceptList/Concept")
    if not concepts or sum(c.get("PreferredConceptYN") == "Y" for c in concepts) != 1:
        raise ValueError(f"{descriptor_id} must have exactly one preferred concept.")
    concept_ids = [_required(c, "ConceptUI", r"M[0-9]+") for c in concepts]
    if len(concept_ids) != len(set(concept_ids)):
        raise ValueError(f"Duplicate MeSH concept inside {descriptor_id}.")
    relations: list[TermRelation] = []
    for owner, owner_id in zip(concepts, concept_ids, strict=True):
        for index, relation in enumerate(owner.findall("ConceptRelationList/ConceptRelation")):
            subject = _required(relation, "Concept1UI", r"M[0-9]+")
            target = _required(relation, "Concept2UI", r"M[0-9]+")
            name = relation.get("RelationName")
            if (
                name not in ("BRD", "NRW", "REL")
                or subject not in concept_ids
                or target not in concept_ids
            ):
                raise ValueError(f"Invalid MeSH concept relation in {descriptor_id}.")
            relations.append(
                TermRelation(
                    subject_id=f"mesh.{subject}",
                    predicate=name,
                    object_id=f"mesh.{target}",
                    evidence=evidence(
                        source,
                        f"{base}/ConceptList/Concept[ConceptUI='{owner_id}']"
                        f"/ConceptRelationList/ConceptRelation[{index + 1}]",
                    ),
                )
            )
    result: list[MedicalTerm] = []
    for concept, concept_id in zip(concepts, concept_ids, strict=True):
        locator = f"{base}/ConceptList/Concept[ConceptUI='{concept_id}']"
        label = _required(concept, "ConceptName/String")
        names = [
            TermName(
                text=label,
                language="en",
                kind="preferred",
                evidence=evidence(source, f"{locator}/ConceptName/String"),
            )
        ]
        terms = concept.findall("TermList/Term")
        if not terms:
            raise ValueError(f"MeSH concept {concept_id} has no terms.")
        seen: set[tuple[str, str]] = set()
        for term_index, term in enumerate(terms):
            term_id = _required(term, "TermUI", r"T[0-9]+")
            text = _required(term, "String")
            if (term_id, text) in seen:
                raise ValueError(f"Duplicate MeSH term spelling {term_id}.")
            # Permuted spellings legitimately share a TermUI in production MeSH.
            seen.add((term_id, text))
            names.append(
                TermName(
                    text=text,
                    language="en",
                    kind="preferred" if term.get("ConceptPreferredTermYN") == "Y" else "alias",
                    external_id=term_id,
                    evidence=evidence(source, f"{locator}/TermList/Term[{term_index + 1}]/String"),
                )
            )
        scope_note = concept.findtext("ScopeNote")
        definitions = (
            []
            if not scope_note or not scope_note.strip()
            else [
                TermDefinition(
                    text=scope_note,
                    language="en",
                    kind="scope-note",
                    evidence=evidence(source, f"{locator}/ScopeNote"),
                )
            ]
        )
        result.append(
            MedicalTerm(
                id=f"mesh.{concept_id}",
                mesh_concept_id=concept_id,
                descriptor_ids=[descriptor_id],
                preferred_for=[descriptor_id] if concept.get("PreferredConceptYN") == "Y" else [],
                names=names,
                definitions=definitions,
                tree_numbers=tree_numbers,
                semantic_types=sorted(
                    {
                        n.text or ""
                        for n in concept.findall("SemanticTypeList/SemanticType/SemanticTypeUI")
                    }
                ),
                relations=[r for r in relations if r.subject_id == f"mesh.{concept_id}"],
            )
        )
    return result


def parse_mesh(path: Path, source: TerminologySource) -> list[MedicalTerm]:
    terms: dict[str, MedicalTerm] = {}
    descriptor_ids: set[str] = set()
    with checked_xml(path) as stream:
        iterator = ET.iterparse(stream, events=("start", "end"))
        _, root = next(iterator)
        if root.tag != "DescriptorRecordSet" or root.get("LanguageCode", "eng") != "eng":
            raise ValueError("Expected an English MeSH DescriptorRecordSet.")
        if root.get("DescriptorSetYear") not in (None, source.edition):
            raise ValueError("MeSH production year differs from the declared edition.")
        depth = 1
        for event, element in iterator:
            depth += 1 if event == "start" else -1
            if depth > 64:
                raise ValueError("MeSH XML nesting limit exceeded.")
            if event != "end" or element.tag != "DescriptorRecord":
                continue
            descriptor_id = _required(element, "DescriptorUI", r"D[0-9]+")
            if descriptor_id in descriptor_ids or len(descriptor_ids) >= MAX_DESCRIPTORS:
                raise ValueError("Duplicate MeSH descriptor or descriptor limit exceeded.")
            descriptor_ids.add(descriptor_id)
            for term in _parse_descriptor(element, source):
                previous = terms.get(term.id)
                if previous is None:
                    terms[term.id] = term
                else:
                    # Only an exact upstream ConceptUI establishes identity across descriptors.
                    previous.descriptor_ids = sorted(
                        set(previous.descriptor_ids + term.descriptor_ids)
                    )
                    previous.preferred_for = sorted(
                        set(previous.preferred_for + term.preferred_for)
                    )
                    previous.tree_numbers = sorted(set(previous.tree_numbers + term.tree_numbers))
                    previous.semantic_types = sorted(
                        set(previous.semantic_types + term.semantic_types)
                    )
                    previous.names.extend(term.names)
                    previous.definitions.extend(term.definitions)
                    previous.relations.extend(term.relations)
            element.clear()
            root.clear()
    if not terms:
        raise ValueError("The MeSH descriptor snapshot contains no concepts.")
    return [terms[key] for key in sorted(terms)]
