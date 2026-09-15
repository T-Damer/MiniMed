"""Literal, source-versioned term-label occurrence projection. Never a clinical assertion.

The complete text remains in its original pack. Core discovery stores one earliest occurrence per
concept/document, with its exact source locator, and no inferred synonym/equivalence relationship.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from .embedding import normalize_text
from .terminology_sources import sha256_file

PROJECTION = "terminology-literal-mentions-v1"
_WORDS = re.compile(r"[^\W_]+", re.UNICODE)
_SOURCE_TYPES = frozenset(
    {
        "clinical_recommendation",
        "clinical_recommendation_summary",
        "official_drug_instruction",
        "medical_reference",
        "allmed_reference",
        "rls_mkb_reference",
        "krasotaimedicina_reference",
        "official_registry_summary",
        "core_catalog_pointer",
        "regulatory_act",
        "regulatory_act_summary",
    }
)


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold().replace("ё", "е")


def _id(kind: str, value: str) -> str:
    return f"terminology.{kind}." + hashlib.sha256(value.encode()).hexdigest()[:24]


def _object(raw: str) -> dict[str, object]:
    value: object = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Expected an object in terminology/source metadata.")
    return cast(dict[str, object], value)


def _strings(value: object) -> list[str]:
    return (
        [v for v in cast(list[object], value) if isinstance(v, str)]
        if isinstance(value, list)
        else []
    )


@dataclass
class _Node:
    children: dict[str, _Node] = field(default_factory=lambda: dict[str, _Node]())
    concepts: set[str] = field(default_factory=lambda: set[str]())
    spellings: dict[str, set[str]] = field(default_factory=lambda: dict[str, set[str]]())


class TermLabelMatcher:
    def __init__(self, names: dict[str, list[str]]) -> None:
        self.names = names
        self.root = _Node()
        for identifier, labels in names.items():
            for label in labels:
                words = [_fold(m.group()) for m in _WORDS.finditer(label)]
                if not words:
                    continue
                node = self.root
                for word in words:
                    node = node.children.setdefault(word, _Node())
                node.concepts.add(identifier)
                node.spellings.setdefault(identifier, set()).add(label)

    def occurrences(self, text: str) -> Iterator[tuple[int, int, tuple[str, ...]]]:
        words = list(_WORDS.finditer(text))
        tokens = [_fold(word.group()) for word in words]
        start = 0
        while start < len(words):
            node = self.root
            last: tuple[int, tuple[str, ...]] | None = None
            end = start
            while end < len(words):
                child = node.children.get(tokens[end])
                if child is None:
                    break
                # Words must be separated by ordinary name punctuation, not another sentence.
                if end > start and re.search(
                    r"[.!?;\n]", text[words[end - 1].end() : words[end].start()]
                ):
                    break
                node = child
                if node.concepts:
                    literal = text[words[start].start() : words[end].end()]
                    concepts = tuple(
                        sorted(
                            identifier
                            for identifier in node.concepts
                            if any(
                                not (2 <= sum(c.isalpha() for c in label) <= 6 and label.isupper())
                                or literal == label
                                for label in node.spellings[identifier]
                            )
                        )
                    )
                    if concepts:
                        last = (end, concepts)
                end += 1
            if last is None:
                start += 1
                continue
            last_word, concepts = last
            yield words[start].start(), words[last_word].end(), concepts
            start = last_word + 1  # A longer explicit term wins over its embedded shorter name.


def matcher_from_database(connection: sqlite3.Connection) -> TermLabelMatcher:
    names: dict[str, list[str]] = {}
    for (raw,) in connection.execute(
        "SELECT json_extract(metadata_json, '$.terminology') FROM documents "
        "WHERE json_type(metadata_json, '$.terminology') = 'object' ORDER BY id"
    ):
        value = _object(raw)
        concept = value.get("conceptId")
        labels = _strings(value.get("names"))
        if (
            value.get("version") != 1
            or not isinstance(concept, str)
            or not re.fullmatch(r"mesh\.M\d+", concept)
            or not labels
        ):
            raise ValueError("Invalid terminology search projection.")
        names.setdefault(concept, []).extend(labels)
    if not names:
        raise ValueError("No terminology discovery/detail records in the selected corpus.")
    return TermLabelMatcher({key: sorted(set(values)) for key, values in names.items()})


def read_occurrences(path: Path, matcher: TermLabelMatcher) -> Iterator[dict[str, object]]:
    source_checksum = sha256_file(path)
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        connection.execute("BEGIN")
        if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Occurrence source failed SQLite integrity validation.")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Occurrence source has broken references.")
        seen: set[tuple[str, str]] = set()
        for row in connection.execute(
            "SELECT d.id, d.current_version_id, d.source_type, dv.source_checksum, "
            "dv.version_label, "
            "c.section_id, c.id, c.anchor, c.original_text, c.page_start, c.page_end "
            "FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id "
            "JOIN chunks c ON c.document_version_id=dv.id ORDER BY d.id, c.order_index, c.id"
        ):
            (
                document_id,
                version_id,
                kind,
                checksum,
                version,
                section_id,
                chunk_id,
                anchor,
                text,
                page_start,
                page_end,
            ) = row
            if kind not in _SOURCE_TYPES:
                # Personal notes/patients and generated term definitions are separate layers.
                continue
            for start, end, matched in matcher.occurrences(text):
                identifiers = [
                    identifier for identifier in matched if (document_id, identifier) not in seen
                ]
                if not identifiers:
                    continue
                seen.update((document_id, identifier) for identifier in identifiers)
                yield {
                    "schemaVersion": 1,
                    "conceptIds": identifiers,
                    "ambiguousLabel": len(matched) > 1,
                    "searchOnly": True,
                    "sourceDatabaseChecksum": source_checksum,
                    "sourceDocumentId": document_id,
                    "sourceDocumentVersionId": version_id,
                    "sourceVersionLabel": version,
                    "sourceChecksum": checksum,
                    "sourceSectionId": section_id,
                    "sourceChunkId": chunk_id,
                    "sourceAnchor": anchor,
                    "quote": text[start:end],
                    "charStart": start,
                    "charEnd": end,
                    "pageStart": page_start,
                    "pageEnd": page_end,
                }
        if sha256_file(path) != source_checksum:
            raise ValueError("Occurrence source changed while being indexed.")
    finally:
        connection.close()


def write_occurrence_index(
    terminology: Path, sources: list[Path], output: Path
) -> dict[str, object]:
    if not sources:
        raise ValueError("At least one explicit source database is required.")
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError("Occurrence index already exists; select a new edition path.")
    connection = sqlite3.connect(terminology.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        matcher = matcher_from_database(connection)
    finally:
        connection.close()
    temporary = output.with_suffix(output.suffix + ".partial")
    count = ambiguous = 0
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            for source in sources:
                for occurrence in read_occurrences(source, matcher):
                    stream.write(json.dumps(occurrence, ensure_ascii=False, sort_keys=True) + "\n")
                    count += 1
                    ambiguous += int(occurrence["ambiguousLabel"] is True)
        temporary.rename(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "records": count,
        "ambiguousLabels": ambiguous,
        "sha256": sha256_file(output),
        "searchOnly": True,
        "coverage": "first-literal-occurrence-per-concept-document",
    }


def project_terminology_mentions(
    target: sqlite3.Connection, sources: list[Path]
) -> dict[str, object]:
    """Runs only inside the composer's unpublished staging transaction, never on a released pack."""
    matcher = matcher_from_database(target)
    # Rebuild this projection, retaining every original section/chunk and unrelated editorial link.
    target.execute(
        "DELETE FROM knowledge_document_links WHERE json_extract(metadata_json, "
        "'$.projection') = ?",
        (PROJECTION,),
    )
    target.execute(
        "UPDATE chunks SET metadata_json=json_remove(metadata_json, "
        "'$.terminologyConceptIds', '$.terminologySearchNames') WHERE "
        "json_type(metadata_json, '$.terminologyConceptIds') IS NOT NULL"
    )
    target.execute(
        "UPDATE documents SET metadata_json=json_remove(metadata_json, "
        "'$.terminologyMentionAnchors') WHERE json_type(metadata_json, "
        "'$.terminologyMentionAnchors') IS NOT NULL"
    )
    target.execute(
        "DELETE FROM sections WHERE id IN (SELECT section_id FROM chunks WHERE "
        "json_extract(metadata_json, '$.projection') = ?)",
        (PROJECTION,),
    )
    pointers: dict[str, list[tuple[str, str, str, dict[str, object]]]] = {}
    originals: dict[str, tuple[str, str]] = {}
    for identifier, version_id, version_label, checksum, kind, raw in target.execute(
        "SELECT "
        "d.id,d.current_version_id,dv.version_label,dv.source_checksum,"
        "d.source_type,d.metadata_json "
        "FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id ORDER BY d.id"
    ):
        originals[identifier] = (version_id, checksum)
        metadata = _object(raw)
        to_id = metadata.get("targetDocumentId")
        if (
            kind == "core_catalog_pointer"
            and metadata.get("pointerKind") != "terminology"
            and isinstance(to_id, str)
        ):
            pointers.setdefault(to_id, []).append((identifier, version_id, version_label, metadata))
    entities = {row[0] for row in target.execute("SELECT id FROM knowledge_entities")}
    chunks_added = links_added = skipped_versions = 0
    touched: dict[str, dict[str, object]] = {}
    unmapped = 0
    for source in sorted(set(sources)):
        for occurrence in read_occurrences(source, matcher):
            source_id = str(occurrence["sourceDocumentId"])
            source_version = str(occurrence["sourceDocumentVersionId"])
            source_checksum = str(occurrence["sourceChecksum"])
            source_chunk = str(occurrence["sourceChunkId"])
            concept_ids = _strings(occurrence["conceptIds"])
            placements: list[tuple[str, str, str, str]] = []
            if originals.get(source_id) == (source_version, source_checksum):
                chunk = target.execute(
                    "SELECT section_id, original_text FROM chunks WHERE id=? AND "
                    "document_version_id=?",
                    (source_chunk, source_version),
                ).fetchone()
                if chunk is not None:
                    start, end = (
                        int(cast(int, occurrence["charStart"])),
                        int(cast(int, occurrence["charEnd"])),
                    )
                    if chunk[1][start:end] != occurrence["quote"]:
                        raise ValueError(
                            "Source occurrence does not match the composed original chunk."
                        )
                    placements.append((source_id, source_version, chunk[0], source_chunk))
                    previous = _object(
                        target.execute(
                            "SELECT metadata_json FROM chunks WHERE id=?", (source_chunk,)
                        ).fetchone()[0]
                    )
                    identifiers = sorted(
                        set(_strings(previous.get("terminologyConceptIds"))) | set(concept_ids)
                    )
                    previous["terminologyConceptIds"] = identifiers
                    previous["terminologySearchNames"] = sorted(
                        {
                            normalize_text(name)
                            for identifier in identifiers
                            for name in matcher.names[identifier]
                        }
                    )
                    target.execute(
                        "UPDATE chunks SET metadata_json=? WHERE id=?",
                        (json.dumps(previous, ensure_ascii=False), source_chunk),
                    )
            for pointer_id, pointer_version, pointer_label, metadata in pointers.get(source_id, []):
                definition = metadata.get("canonicalDefinition")
                definition_version = (
                    cast(dict[str, object], definition).get("sourceDocumentVersionId")
                    if isinstance(definition, dict)
                    else None
                )
                # An explicit source version is authoritative. A coincidentally equal display
                # edition must not override it; older core pointers may only provide the edition.
                if (
                    definition_version != source_version
                    if definition_version is not None
                    else pointer_label != occurrence["sourceVersionLabel"]
                ):
                    skipped_versions += 1
                    # Existence of a similarly named or differently versioned pack is not proof.
                    continue
                section_id = _id("section", pointer_id)
                chunk_id = _id(
                    "chunk",
                    f"{pointer_id}|{source_version}|{source_chunk}|{occurrence['charStart']}|{','.join(concept_ids)}",
                )
                local_anchor = f"{pointer_version}/term-occurrences#{chunk_id}"
                target.execute(
                    "INSERT OR IGNORE INTO "
                    "sections(id,document_version_id,title,normalized_title,"
                    "section_type,depth,order_index,anchor,path_json) "
                    "VALUES (?,?,?,?,'term-mention',1,(SELECT "
                    "COALESCE(MAX(order_index),-1)+1 FROM sections WHERE "
                    "document_version_id=?),?,?)",
                    (
                        section_id,
                        pointer_version,
                        "Вхождения терминов — указатель",
                        normalize_text("вхождения терминов указатель"),
                        pointer_version,
                        f"{pointer_version}/term-occurrences",
                        json.dumps(["Вхождения терминов — указатель"], ensure_ascii=False),
                    ),
                )
                derived = {
                    "projection": PROJECTION,
                    "terminologyConceptIds": concept_ids,
                    "sourceLocator": occurrence,
                    "notFullText": True,
                    "terminologySearchNames": sorted(
                        {
                            normalize_text(name)
                            for identifier in concept_ids
                            for name in matcher.names[identifier]
                        }
                    ),
                }
                target.execute(
                    "INSERT OR IGNORE INTO "
                    "chunks(id,document_version_id,section_id,order_index,"
                    "original_text,normalized_text,page_start,page_end,anchor,metadata_json) "
                    "VALUES (?,?,?,(SELECT COALESCE(MAX(order_index),-1)+1 FROM chunks "
                    "WHERE document_version_id=?),?,?,?,?,?,?)",
                    (
                        chunk_id,
                        pointer_version,
                        section_id,
                        pointer_version,
                        occurrence["quote"],
                        normalize_text(str(occurrence["quote"])),
                        occurrence["pageStart"],
                        occurrence["pageEnd"],
                        local_anchor,
                        json.dumps(derived, ensure_ascii=False),
                    ),
                )
                placements.append((pointer_id, pointer_version, section_id, chunk_id))
                chunk_map = metadata.setdefault("terminologyMentionAnchors", {})
                if not isinstance(chunk_map, dict):
                    raise ValueError("Invalid existing terminology anchor mapping.")
                cast(dict[str, object], chunk_map)[local_anchor] = occurrence["sourceAnchor"]
                touched[pointer_id] = metadata
                chunks_added += 1
            if not placements:
                unmapped += 1
            for document_id, version_id, section_id, chunk_id in placements:
                for concept in concept_ids:
                    entity_id = (
                        "core.concept."
                        + hashlib.sha256(f"medical.term.{concept}".encode()).hexdigest()[:24]
                    )
                    if entity_id not in entities:
                        raise ValueError(f"Term entity is missing for {concept}.")
                    metadata = {
                        "projection": PROJECTION,
                        "sourceLocator": occurrence,
                        "searchOnly": True,
                    }
                    target.execute(
                        "INSERT OR REPLACE INTO "
                        "knowledge_document_links(id,entity_id,document_id,"
                        "document_version_id,section_id,chunk_id,link_type,"
                        "weight,review_status,metadata_json) "
                        "VALUES (?,?,?,?,?,?,'term-label-mention',0.5,'proposed',?)",
                        (
                            _id("link", f"{concept}|{document_id}|{chunk_id}"),
                            entity_id,
                            document_id,
                            version_id,
                            section_id,
                            chunk_id,
                            json.dumps(metadata, ensure_ascii=False),
                        ),
                    )
                    links_added += 1
    for identifier, metadata in touched.items():
        target.execute(
            "UPDATE documents SET metadata_json=? WHERE id=?",
            (json.dumps(metadata, ensure_ascii=False, separators=(",", ":")), identifier),
        )
    report: dict[str, object] = {
        "projection": PROJECTION,
        "sourceChecksums": [sha256_file(p) for p in sources],
        "discoveryChunks": chunks_added,
        "links": links_added,
        "versionMismatches": skipped_versions,
        "unmappedOccurrences": unmapped,
        "searchOnly": True,
        "coverage": "first-literal-occurrence-per-concept-document",
    }
    target.execute(
        "INSERT OR REPLACE INTO app_metadata(key,value) VALUES (?,?)",
        (PROJECTION, json.dumps(report, sort_keys=True)),
    )
    return report
