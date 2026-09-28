"""Exact, gzip-transported module artifacts and their catalog descriptors.

A packaged module is one SQLite index (the app contract allows exactly one per module), its
deterministic gzip transport, exact document membership and, when a discovery core is supplied,
a check that every core pointer to this source resolves to that membership with the same
document version and the anchors it cites.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sqlite3
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

RELEASE_BASE_URL = "https://github.com/T-Damer/MiniMed/releases/download"
PUBLICATION_STATE = "experimental-preview"
_VERSION = re.compile(r"\d{4}\.\d{1,2}\.\d{1,2}(?:-[a-z0-9]+)*")
_APP_VERSION = re.compile(r"\d+\.\d+\.\d+")

DocumentValidator = Callable[[str, str, dict[str, object]], None]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def plural_ru(count: int, one: str, few: str, many: str) -> str:
    tail = count % 100
    if 11 <= tail <= 14:
        word = many
    elif count % 10 == 1:
        word = one
    elif 2 <= count % 10 <= 4:
        word = few
    else:
        word = many
    return f"{count:,}".replace(",", " ") + f" {word}"


def json_object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, object], value)


def required_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def require_publication_decision(document_id: str, metadata: dict[str, object]) -> None:
    if metadata.get("publicationState") != PUBLICATION_STATE:
        raise ValueError(f"{document_id}: prepared without a publication decision")
    decision = json_object(metadata.get("publicationDecision"), f"{document_id} decision")
    for key in ("decidedAt", "decidedBy", "basis"):
        required_text(decision.get(key), f"{document_id} publicationDecision.{key}")
    if metadata.get("requiresReview") is not True:
        raise ValueError(f"{document_id}: reference content must stay requiresReview")


@dataclass(frozen=True)
class PackMembership:
    documents: list[dict[str, object]]
    anchors: frozenset[str]
    chunk_ids: frozenset[str]
    schema_version: int


def read_pack_membership(
    database: Path,
    *,
    document_prefixes: tuple[str, ...],
    validate: DocumentValidator,
) -> PackMembership:
    documents: list[dict[str, object]] = []
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("SQLite integrity check failed")
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("SQLite foreign-key check failed")
        schema = connection.execute(
            "SELECT value FROM app_metadata WHERE key = 'schema_version'"
        ).fetchone()
        if schema is None:
            raise ValueError("Pack has no schema_version")
        if len(connection.execute("SELECT id FROM content_packs").fetchall()) != 1:
            raise ValueError("Expected exactly one content pack")
        rows = connection.execute(
            "SELECT d.id, dv.id, dv.source_checksum, d.status, d.title, d.metadata_json "
            "FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id "
            "ORDER BY d.id"
        ).fetchall()
        for document_id, version_id, checksum, status, title, raw_metadata in rows:
            if not str(document_id).startswith(document_prefixes):
                raise ValueError(f"Unexpected document in pack: {document_id}")
            metadata = json_object(json.loads(raw_metadata), f"{document_id} metadata")
            validate(str(document_id), str(checksum), metadata)
            documents.append(
                {
                    "documentId": document_id,
                    "documentVersionId": version_id,
                    "sourceChecksum": checksum,
                    "status": status,
                    "title": title,
                }
            )
        if not documents:
            raise ValueError("Pack contains no documents")
        chunks = connection.execute("SELECT count(*) FROM chunks").fetchone()[0]
        if chunks != connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0]:
            raise ValueError("Incomplete full-text index")
        anchors: set[str] = set()
        chunk_ids: set[str] = set()
        for chunk_id, anchor in connection.execute("SELECT id, anchor FROM chunks"):
            chunk_ids.add(str(chunk_id))
            anchors.add(str(anchor))
    return PackMembership(documents, frozenset(anchors), frozenset(chunk_ids), int(str(schema[0])))


def _cited_locations(value: object) -> Iterator[dict[str, object]]:
    """Every nested object in pointer metadata that cites a source anchor or chunk."""
    if isinstance(value, dict):
        item = cast(dict[str, object], value)
        if "sourceAnchor" in item or "sourceChunkId" in item:
            yield item
        for child in item.values():
            yield from _cited_locations(child)
    elif isinstance(value, list):
        for child in cast(list[object], value):
            yield from _cited_locations(child)


def verify_pointer_membership(
    core_database: Path,
    membership: PackMembership,
    *,
    target_prefixes: tuple[str, ...],
) -> dict[str, object]:
    """Check every core pointer to this source against the exact pack membership.

    Pointers may name another module id; the app resolves them by exact membership instead.
    Anchors and chunks a pointer cites inside this pack must exist unchanged.
    """
    versions = {
        str(item["documentId"]): str(item["documentVersionId"]) for item in membership.documents
    }
    missing: list[str] = []
    version_mismatches: list[str] = []
    missing_anchors: set[str] = set()
    missing_chunks: set[str] = set()
    named_modules: dict[str, int] = {}
    pointers = 0
    cited_anchors = 0
    with sqlite3.connect(core_database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "SELECT id, metadata_json FROM documents "
            "WHERE json_extract(metadata_json, '$.contentMode') = 'module-pointer' ORDER BY id"
        )
        for pointer_id, raw_metadata in rows:
            metadata = json_object(json.loads(raw_metadata), f"{pointer_id} metadata")
            target = required_text(
                metadata.get("targetDocumentId"), f"{pointer_id} targetDocumentId"
            )
            if not target.startswith(target_prefixes):
                continue
            pointers += 1
            primary = str(metadata.get("primaryModuleId"))
            named_modules[primary] = named_modules.get(primary, 0) + 1
            if target not in versions:
                missing.append(target)
                continue
            expected_version = metadata.get("sourceDocumentVersionId")
            if expected_version is not None and expected_version != versions[target]:
                version_mismatches.append(target)
            for location in _cited_locations(metadata):
                source_document = location.get("sourceDocumentId", target)
                if source_document not in versions:
                    continue
                anchor = location.get("sourceAnchor")
                if isinstance(anchor, str):
                    cited_anchors += 1
                    if anchor not in membership.anchors:
                        missing_anchors.add(anchor)
                chunk = location.get("sourceChunkId")
                if isinstance(chunk, str) and chunk not in membership.chunk_ids:
                    missing_chunks.add(chunk)
    return {
        "coreDatabase": str(core_database),
        "coreSha256": sha256_file(core_database),
        "pointers": pointers,
        "resolved": pointers - len(missing),
        "citedAnchors": cited_anchors,
        "missingTargets": sorted(missing),
        "versionMismatches": sorted(version_mismatches),
        "missingAnchors": sorted(missing_anchors),
        "missingChunks": sorted(missing_chunks),
        "pointerPrimaryModuleIds": dict(sorted(named_modules.items())),
    }


def pointer_gaps(report: dict[str, object]) -> bool:
    return any(
        report[key]
        for key in ("missingTargets", "versionMismatches", "missingAnchors", "missingChunks")
    )


def write_gzip_artifact(database: Path, archive: Path) -> tuple[str, int, str, int]:
    """Deterministic gzip (no name, mtime 0), verified by a full round trip."""
    decoded_sha256 = sha256_file(database)
    decoded_size = database.stat().st_size
    with (
        database.open("rb") as source,
        archive.open("xb") as target,
        gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0) as compressed,
    ):
        while block := source.read(1024 * 1024):
            compressed.write(block)
    round_trip = hashlib.sha256()
    round_trip_size = 0
    with gzip.open(archive, "rb") as decoded:
        while block := decoded.read(1024 * 1024):
            round_trip_size += len(block)
            round_trip.update(block)
    if round_trip_size != decoded_size or "sha256:" + round_trip.hexdigest() != decoded_sha256:
        raise ValueError("Gzip does not reconstruct the exact validated SQLite")
    return sha256_file(archive), archive.stat().st_size, decoded_sha256, decoded_size


def source_set_digest(documents: list[dict[str, object]]) -> str:
    # Same digest convention as other membership modules: identity fields only, no titles.
    canonical = json.dumps(
        [
            {
                key: item[key]
                for key in ("documentId", "documentVersionId", "sourceChecksum", "status")
            }
            for item in documents
        ],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


@dataclass(frozen=True)
class ModuleDescriptor:
    module_id: str
    release_tag: str
    file_stem: str
    title: str
    tags: tuple[str, ...]
    structured_knowledge: bool = False
    structured_tables: bool = False


def package_module(
    database: Path,
    output_dir: Path,
    *,
    descriptor: ModuleDescriptor,
    version: str,
    min_app_version: str,
    membership: PackMembership,
    description: str,
    core_database: Path | None = None,
    pointer_prefixes: tuple[str, ...] = (),
    report_extra: dict[str, object] | None = None,
) -> dict[str, object]:
    if not _VERSION.fullmatch(version):
        raise ValueError("Use a dated version such as 2026.9.28")
    if not _APP_VERSION.fullmatch(min_app_version):
        raise ValueError("minAppVersion must look like 0.6.44")
    if core_database is not None and not pointer_prefixes:
        raise ValueError("Pointer verification needs the target document prefixes")
    file_name = f"{descriptor.file_stem}.{version}.db.gz"
    stem = file_name.removesuffix(".db.gz")
    artifact_id = f"{descriptor.module_id}-index-{version}"
    pointer_report = (
        verify_pointer_membership(core_database, membership, target_prefixes=pointer_prefixes)
        if core_database is not None
        else None
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    if pointer_report is not None and pointer_gaps(pointer_report):
        failure = output_dir / f"{stem}.pointer-gaps.json"
        failure.write_text(
            json.dumps(pointer_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        raise ValueError(f"Core pointers do not resolve exactly; see {failure}")

    archive = output_dir / file_name
    archive_sha256, archive_size, decoded_sha256, decoded_size = write_gzip_artifact(
        database, archive
    )
    documents = membership.documents
    source_set = source_set_digest(documents)
    entry: dict[str, object] = {
        "id": descriptor.module_id,
        "version": version,
        "kind": "reference",
        "collection": "shared",
        "title": descriptor.title,
        "description": description,
        "required": False,
        "releaseState": "preview",
        "specialties": [],
        "populations": [],
        "tags": list(descriptor.tags),
        "compatibility": {
            "minAppVersion": min_app_version,
            "maxAppVersion": None,
            "schemaVersion": membership.schema_version,
            "coreCatalogVersion": "1",
        },
        "sourceSetDigest": source_set,
        "dependencies": [],
        "sizes": {
            "downloadBytes": archive_size,
            "installedBytes": decoded_size,
            "sourceAssetsDownloadBytes": None,
            "precision": "exact",
        },
        "capabilities": {
            "search": True,
            "fullText": True,
            "structuredTables": descriptor.structured_tables,
            "images": False,
            "originalPdf": False,
            "structuredKnowledge": descriptor.structured_knowledge,
            "calculations": False,
        },
        "artifacts": [
            {
                "id": artifact_id,
                "kind": "index",
                "required": True,
                "url": f"{RELEASE_BASE_URL}/{descriptor.release_tag}/{file_name}",
                "sha256": archive_sha256,
                "sizeBytes": archive_size,
                "compression": "gzip",
                "decodedSha256": decoded_sha256,
                "decodedSizeBytes": decoded_size,
                "sourceSetDigest": source_set,
            }
        ],
        "documents": [
            {**item, "indexArtifactId": artifact_id, "sourceAssetArtifactId": None}
            for item in documents
        ],
        "previewDocumentCount": len(documents),
    }
    entry_path = output_dir / f"{stem}.catalog-entry.json"
    entry_path.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report: dict[str, object] = {
        "moduleId": descriptor.module_id,
        "version": version,
        "releaseTag": descriptor.release_tag,
        "archive": str(archive),
        "archiveSha256": archive_sha256,
        "archiveBytes": archive_size,
        "sqlite": str(database),
        "sqliteSha256": decoded_sha256,
        "sqliteBytes": decoded_size,
        "documents": len(documents),
        "chunks": len(membership.chunk_ids),
        "sourceSetDigest": source_set,
        "catalogEntry": str(entry_path),
        **(report_extra or {}),
        "pointerMembership": pointer_report,
    }
    report_path = output_dir / f"{stem}.package-report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report
