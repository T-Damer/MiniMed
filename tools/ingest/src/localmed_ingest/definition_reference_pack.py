"""Project source-local definition drafts into the existing content/knowledge tables.

This is an immutable, local-dev navigation projection. It deliberately creates no
knowledge facts or relations and never marks a source-local identity as reviewed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import tempfile
import unicodedata
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast
from urllib.parse import unquote, urljoin, urlsplit

from .models import ContentPack, PackChunk, PackDocument, PackManifest, PackSection, PackVersion
from .sqlite_builder import inspect_integrity, write_sqlite_pack

MAX_INPUT_BYTES = 16 * 1024 * 1024
MAX_TEXT = 262144
KINDS = frozenset(
    {
        "term",
        "symptom",
        "syndrome",
        "criterion_set",
        "scale",
        "classification",
        "law",
        "tool",
        "history_note",
    }
)
COVERAGE = frozenset(
    {
        "definition",
        "explicit-definition",
        "definition-section",
        "contextual-definition",
        "criterion-list",
        "classification",
        "section-overview",
        "section-excerpt",
        "tool-description",
        "source-description",
        "cross-reference",
        "mention-only",
        "gloss",
    }
)
TEXT_KINDS = {1: "editorial-paraphrase", 2: "source-gloss", 3: "source-excerpt"}


def encoded(value: object) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalized_name(value: str) -> str:
    # Also implemented in the storage reader. Never changes displayed/source text.
    return " ".join(unicodedata.normalize("NFKC", value).lower().replace("ё", "е").split())


def obj(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    if any(not isinstance(key, str) for key in cast(dict[object, object], value)):
        raise ValueError("Expected a JSON object")
    return cast(dict[str, object], value)


def seq(value: object, limit: int) -> list[object]:
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError("Invalid or oversized collection")
    return cast(list[object], value)


def text(value: object, limit: int = 2048, *, empty: bool = False) -> str:
    if (
        not isinstance(value, str)
        or len(value) > limit
        or (not empty and not value.strip())
        or "\0" in value
    ):
        raise ValueError("Invalid definition/reference text")
    return value


def number(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value < 2**53:
        raise ValueError("Invalid numeric reference")
    return value


def strings(value: object, limit: int = 128) -> list[str]:
    return [text(item) for item in seq(value, limit)]


def contained(root: Path, path: Path) -> Path:
    resolved = (root / path).resolve(strict=True)
    if not resolved.is_relative_to(root.resolve(strict=True)) or not resolved.is_file():
        raise ValueError("Definition input escapes the configured root")
    return resolved


def source_path(source: dict[str, object], value: object) -> str:
    path = text(value, 2048, empty=True)
    base = text(source.get("baseUrl"), 2048, empty=source.get("sourceType") == "owner-pdf")
    if source.get("sourceType") == "owner-pdf":
        if base or path:
            raise ValueError("Owner source must stay local")
        return path
    parsed = urlsplit(base)
    resolved = urlsplit(urljoin(base, path))
    decoded = unquote(path)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not parsed.path.endswith("/")
        or resolved.netloc != parsed.netloc
        or resolved.scheme != parsed.scheme
        or not resolved.path.startswith(parsed.path)
        or decoded.startswith("/")
        or "\\" in decoded
        or ".." in decoded.split("/")
    ):
        raise ValueError("Unsafe definition source locator")
    return path


@dataclass
class Source:
    id: str
    descriptor: dict[str, object]
    chunks: dict[str, PackChunk] = field(default_factory=dict)


@dataclass
class Entry:
    id: str
    title: str
    kind: str
    names: list[str]
    coverage: str
    text_kind: str
    links: list[tuple[str, str]]
    receipt: str


class Projection:
    def __init__(self) -> None:
        self.sources: dict[str, Source] = {}
        self.entries: dict[str, Entry] = {}
        self.chunks: dict[str, tuple[Source, PackChunk]] = {}
        self.receipts: list[dict[str, object]] = []
        self.annotations: dict[str, object] = {}

    def block(self, source: Source, body: str, provenance: dict[str, object]) -> str:
        identity = digest(encoded([source.id, body, provenance]))
        chunk_id = f"reference.block.{identity}"
        if chunk_id not in self.chunks:
            chunk = PackChunk(
                id=chunk_id,
                order_index=len(source.chunks),
                original_text=body,
                normalized_text="",
                anchor=f"reference/{identity}",
                metadata={"definitionReference": 1, **provenance},
            )
            source.chunks[chunk_id] = chunk
            self.chunks[chunk_id] = (source, chunk)
        return chunk_id

    def add(self, payload: object, receipt: str) -> None:
        root = obj(payload)
        version = root.get("version")
        if isinstance(version, bool) or not isinstance(version, int) or version not in TEXT_KINDS:
            raise ValueError("Unsupported definition input version")
        if (
            root.get("reviewStatus") != "requires-review"
            or root.get("publicationState") != "local-dev"
            or root.get("textKind") != TEXT_KINDS[version]
        ):
            raise ValueError("Definition input must preserve its draft/source state")
        local_sources: dict[int, Source] = {}
        for value in seq(root.get("sources"), 1000):
            descriptor = obj(value).copy()
            local_id = number(descriptor.get("id"))
            if local_id in local_sources:
                raise ValueError("Duplicate module-local source ID")
            text(descriptor.get("title"))
            if descriptor.get("releaseEligible") not in (None, False):
                raise ValueError("This builder cannot publish source excerpts")
            if version == 3 and descriptor.get("releaseEligible") is not False:
                raise ValueError("Missing excerpt release boundary")
            source_path(descriptor, descriptor.get("path", ""))
            if descriptor.get("sourceType") == "owner-pdf":
                file_name = text(descriptor.get("fileName"), 255)
                if (
                    "/" in file_name
                    or "\\" in file_name
                    or not re.fullmatch(r"[a-f0-9]{64}", text(descriptor.get("sourceSha256"), 64))
                ):
                    raise ValueError("Invalid owner source provenance")
            # Module-local numbers are not global identity.
            # Exact source descriptors can be shared across shards.
            descriptor.pop("id")
            key = digest(encoded(descriptor))
            source = self.sources.setdefault(key, Source(f"reference.source.{key}", descriptor))
            local_sources[local_id] = source
        if not local_sources:
            raise ValueError("Missing definition sources")
        blocks: dict[int, str] = {}
        if version == 3:
            for value in seq(root.get("blocks"), 100000):
                row = obj(value)
                local_id = number(row.get("id"))
                source = local_sources.get(number(row.get("source")))
                if local_id in blocks or source is None:
                    raise ValueError("Duplicate block or unresolved source")
                body = text(row.get("text"), MAX_TEXT)
                if row.get("textSha256") != digest(body):
                    raise ValueError("Source block text checksum mismatch")
                path = source_path(
                    source.descriptor, row.get("path", source.descriptor.get("path", ""))
                )
                locator = text(row.get("locator"), 4096)
                provenance = {
                    key: val for key, val in row.items() if key not in {"id", "source", "text"}
                }
                provenance.update({"path": path, "locator": locator})
                blocks[local_id] = self.block(source, body, provenance)
        for value in seq(root.get("terms"), 50000):
            row = obj(value)
            entry_id = text(row.get("id"), 256)
            if (
                not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", entry_id)
                or entry_id in self.entries
            ):
                raise ValueError("Invalid or conflicting source-local term identity")
            title = text(row.get("title"))
            kind = text(row.get("kind"), 40)
            if kind not in KINDS:
                raise ValueError("Unsupported reference kind")
            names = list(dict.fromkeys([title, *strings(row.get("aliases", []))]))
            links: list[tuple[str, str]] = []
            if version == 3:
                coverage = text(row.get("coverage"), 80)
                for key, role in (
                    ("blockIds", "definition"),
                    ("itemBlocks", "item"),
                    ("detailBlocks", "context"),
                ):
                    selected = seq(row.get(key, []), 1000)
                    if key == "blockIds" and not selected:
                        raise ValueError("Definition has no blocks")
                    for item in selected:
                        chunk_id = blocks.get(number(item))
                        if chunk_id is None:
                            raise ValueError("Dangling definition/context block reference")
                        links.append((role, chunk_id))
            else:
                references: list[dict[str, object]] = []
                for item in seq(row.get("references"), 8):
                    ref = obj(item)
                    source = local_sources.get(number(ref.get("source")))
                    if source is None:
                        raise ValueError("Dangling definition source reference")
                    references.append(
                        {
                            **ref,
                            "source": source.id,
                            "path": source_path(source.descriptor, ref.get("path", "")),
                            "locator": text(ref.get("locator"), 4096),
                        }
                    )
                if not references:
                    raise ValueError("Definition has no citation")
                primary_id = references[0]["source"]
                primary = next(
                    source for source in local_sources.values() if source.id == primary_id
                )
                body = text(row.get("definition"), MAX_TEXT)
                links.append(
                    (
                        "definition",
                        self.block(
                            primary, body, {"citations": references, "textSha256": digest(body)}
                        ),
                    )
                )
                for item in seq(row.get("items", []), 1000):
                    body = text(item, MAX_TEXT)
                    links.append(
                        (
                            "item",
                            self.block(
                                primary, body, {"citations": references, "textSha256": digest(body)}
                            ),
                        )
                    )
                coverage = text(row.get("definitionKind", "definition"), 80)
            if coverage not in COVERAGE:
                raise ValueError("Unsupported reference coverage")
            # Preserve extra source annotations lazily; never include them in clinical retrieval.
            extra = {
                key: val
                for key, val in row.items()
                if key
                not in {
                    "id",
                    "title",
                    "kind",
                    "aliases",
                    "definition",
                    "items",
                    "blockIds",
                    "itemBlocks",
                    "detailBlocks",
                    "references",
                    "coverage",
                    "definitionKind",
                }
            }
            if extra:
                source, _ = self.chunks[links[0][1]]
                annotation = encoded(extra)
                text(annotation, MAX_TEXT)
                links.append(
                    (
                        "annotation",
                        self.block(
                            source,
                            annotation,
                            {"format": "source-metadata-json", "inputSha256": receipt},
                        ),
                    )
                )
            self.entries[entry_id] = Entry(
                entry_id, title, kind, names, coverage, TEXT_KINDS[version], links, receipt
            )
        annotations = {
            key: val
            for key, val in root.items()
            if key
            not in {
                "sources",
                "blocks",
                "terms",
                "version",
                "id",
                "textKind",
                "publicationState",
                "reviewStatus",
            }
        }
        self.annotations[receipt] = annotations
        if len(self.entries) > 100000:
            raise ValueError("Reference build entry budget exceeded")

    def build(
        self, output: Path, *, edition_id: str, version: str, built_at: str
    ) -> dict[str, object]:
        if not self.entries or output.exists():
            raise ValueError("Need nonempty inputs and a new immutable output path")
        manifest = {
            "contract": 1,
            "editionId": edition_id,
            "version": version,
            "reviewStatus": "requires-review",
            "publicationState": "local-dev",
            "identityStatus": "source-local-proposed",
            "receipts": self.receipts,
            "entries": len(self.entries),
            "sources": len(self.sources),
            "blocks": len(self.chunks),
        }
        documents: list[PackDocument] = []
        for source in sorted(self.sources.values(), key=lambda item: item.id):
            documents.append(
                PackDocument(
                    id=source.id,
                    title=text(source.descriptor["title"]),
                    source_type="medical_reference",
                    status="draft",
                    specialties=[],
                    metadata={
                        "definitionReference": 1,
                        "source": source.descriptor,
                        "releaseEligible": False,
                        "reviewStatus": "requires-review",
                    },
                    version=PackVersion(
                        id=source.id + "@" + version,
                        label=version,
                        source_checksum="sha256:" + digest(encoded(source.descriptor)),
                        extracted_at=built_at,
                    ),
                    sections=[
                        PackSection(
                            id=source.id + ".blocks",
                            title="Исходные фрагменты",
                            normalized_title="исходные фрагменты",
                            section_type="reference-source",
                            depth=1,
                            order_index=0,
                            anchor=source.id + "/blocks",
                            section_path=["Исходные фрагменты"],
                            chunks=list(source.chunks.values()),
                        )
                    ],
                )
            )
        pack = ContentPack(
            manifest=PackManifest(
                id=edition_id,
                version=version,
                schema_version=6,
                title="MiniMed definition reference (requires review)",
                built_at=built_at,
                checksum="sha256:" + digest(encoded(manifest)),
                publication_state="local-dev",
            ),
            documents=documents,
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix="definition-build-", dir=output.parent
        ) as directory:
            staged = Path(directory) / "reference.db"
            write_sqlite_pack(pack, staged, vacuum=False)
            with closing(sqlite3.connect(staged)) as database, database:
                database.execute("PRAGMA foreign_keys = ON")
                database.execute(
                    "INSERT INTO app_metadata VALUES (?, ?)",
                    ("definition_reference", encoded(manifest)),
                )
                for receipt, annotations in self.annotations.items():
                    database.execute(
                        "INSERT INTO app_metadata VALUES (?, ?)",
                        ("definition_reference_annotations:" + receipt, encoded(annotations)),
                    )
                for entry in sorted(self.entries.values(), key=lambda item: item.id):
                    metadata = {
                        "definitionReference": 1,
                        "sourceEntryId": entry.id,
                        "coverage": entry.coverage,
                        "textKind": entry.text_kind,
                        "reviewStatus": "requires-review",
                        "identityStatus": "source-local-proposed",
                        "inputSha256": entry.receipt,
                        "blockCount": len(entry.links),
                        "editionId": edition_id,
                    }
                    database.execute(
                        "INSERT INTO knowledge_entities VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            entry.id,
                            entry.kind,
                            entry.title,
                            normalized_name(entry.title),
                            "{}",
                            encoded(metadata),
                        ),
                    )
                    for index, name in enumerate(entry.names):
                        database.execute(
                            "INSERT INTO knowledge_names VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (
                                f"{entry.id}.name.{index}",
                                entry.id,
                                name,
                                normalized_name(name),
                                "ru",
                                "primary" if index == 0 else "source-alias",
                                2.0 if index == 0 else 1.0,
                            ),
                        )
                    database.execute(
                        "INSERT INTO knowledge_fts("
                        "entity_id, canonical_name, aliases, facts, relations) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (entry.id, entry.title, " ".join(entry.names[1:]), "", ""),
                    )
                    for index, (role, chunk_id) in enumerate(entry.links):
                        source, chunk = self.chunks[chunk_id]
                        database.execute(
                            "INSERT INTO knowledge_document_links "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (
                                f"{entry.id}.reference.{index:06d}",
                                entry.id,
                                source.id,
                                source.id + "@" + version,
                                source.id + ".blocks",
                                chunk.id,
                                "reference:" + role,
                                1.0,
                                "proposed",
                                encoded({"ordinal": index, "role": role}),
                            ),
                        )
                # The dedicated external-content index reads original blocks; no FTS body copy.
                # Source metadata and annotation/context-only blocks do not enter retrieval.
                database.execute("DELETE FROM chunks_fts")
                database.execute(
                    "INSERT INTO definition_reference_fts(definition_reference_fts) "
                    "VALUES ('rebuild')"
                )
                database.execute(
                    "INSERT INTO definition_reference_fts(definition_reference_fts, rank) "
                    "VALUES ('integrity-check', 1)"
                )
            with closing(sqlite3.connect(staged)) as compact_database:
                compact_database.execute("VACUUM")
            integrity, foreign_keys, *_ = inspect_integrity(staged)
            if integrity != "ok" or foreign_keys:
                raise ValueError("Definition pack failed integrity/foreign-key validation")
            os.link(staged, output)
        return {
            **manifest,
            "sqliteBytes": output.stat().st_size,
            "sqliteSha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "integrity": integrity,
            "foreignKeyViolations": foreign_keys,
            "boundaries": (
                "Source-local draft navigation only. "
                "No approved facts/relations, app lifecycle or Android qualification."
            ),
        }


def build_definition_reference(
    inputs: tuple[Path, ...],
    output: Path,
    *,
    input_root: Path,
    edition_id: str,
    version: str,
    built_at: str,
) -> dict[str, object]:
    projection = Projection()
    if not inputs or len(inputs) > 32:
        raise ValueError("Expected 1..32 explicitly selected definition inputs")
    seen: set[str] = set()
    for path in inputs:
        actual = contained(input_root, path)
        if actual.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("Definition input exceeds its byte budget")
        payload = actual.read_bytes()
        receipt = hashlib.sha256(payload).hexdigest()
        if receipt in seen:
            raise ValueError("Duplicate input snapshot")
        seen.add(receipt)
        projection.add(json.loads(payload), receipt)
        projection.receipts.append({"sha256": receipt, "bytes": len(payload)})
    return projection.build(output, edition_id=edition_id, version=version, built_at=built_at)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--input", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--built-at", required=True)
    args = parser.parse_args()
    if args.report.exists() or args.report.resolve() == args.output.resolve():
        parser.error("Choose distinct new report and output paths")
    report = build_definition_reference(
        tuple(args.input),
        args.output,
        input_root=args.input_root,
        edition_id=args.edition_id,
        version=args.version,
        built_at=args.built_at,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(encoded(report))


if __name__ == "__main__":
    main()
