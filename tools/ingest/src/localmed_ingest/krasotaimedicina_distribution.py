"""Package the Krasota i Meditsina disease snapshot as one exact, gzip-transported module.

The discovery core's pointers name the unpublished `minimed.mkb.ru`; since app 0.6.44 a pointer
falls back to any released module whose verified index lists the exact target document, so this
pack keeps its own id and every pointer is checked against its exact membership, never titles.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

MODULE_ID = "minimed.reference.krasotaimedicina.ru"
DOCUMENT_PREFIX = "krasotaimedicina.disease."
SOURCE_HOST = "www.krasotaimedicina.ru"
RELEASE_BASE_URL = "https://github.com/T-Damer/MiniMed/releases/download"
PUBLICATION_STATE = "experimental-preview"
_VERSION = re.compile(r"\d{4}\.\d{1,2}\.\d{1,2}(?:-[a-z0-9]+)*")
_APP_VERSION = re.compile(r"\d+\.\d+\.\d+")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return "sha256:" + digest.hexdigest()


def _plural_ru(count: int, one: str, few: str, many: str) -> str:
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


def _object(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return cast(dict[str, object], value)


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _validate_document(
    document_id: str, source_checksum: str, metadata: dict[str, object]
) -> tuple[str, str]:
    """Return entity type and crawl time after checking one prepared article's provenance."""
    url = _text(metadata.get("officialSourceUrl"), f"{document_id} officialSourceUrl")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != SOURCE_HOST:
        raise ValueError(f"{document_id}: source URL is outside {SOURCE_HOST}")
    expected_id = DOCUMENT_PREFIX + hashlib.sha256(url.encode()).hexdigest()[:16]
    if document_id != expected_id:
        raise ValueError(f"{document_id}: identity does not match its source URL")
    if metadata.get("sourceChecksum", source_checksum) != source_checksum:
        raise ValueError(f"{document_id}: document and version checksums differ")
    fetched_at = _text(metadata.get("fetchedAt"), f"{document_id} fetchedAt")
    _text(metadata.get("rawPath"), f"{document_id} rawPath")
    _text(metadata.get("rightsStatus"), f"{document_id} rightsStatus")
    if metadata.get("publicationState") != PUBLICATION_STATE:
        raise ValueError(f"{document_id}: prepared without a publication decision")
    decision = _object(metadata.get("publicationDecision"), f"{document_id} publicationDecision")
    for key in ("decidedAt", "decidedBy", "basis"):
        _text(decision.get(key), f"{document_id} publicationDecision.{key}")
    if metadata.get("requiresReview") is not True:
        raise ValueError(f"{document_id}: reference articles must stay requiresReview")
    return _text(metadata.get("entityType"), f"{document_id} entityType"), fetched_at


def _read_pack(
    database: Path,
) -> tuple[list[dict[str, object]], dict[str, int], set[str], int, str]:
    documents: list[dict[str, object]] = []
    entity_types: dict[str, int] = {}
    fetched: list[str] = []
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
        schema_version = int(str(schema[0]))
        if len(connection.execute("SELECT id FROM content_packs").fetchall()) != 1:
            raise ValueError("Expected exactly one content pack")
        rows = connection.execute(
            "SELECT d.id, dv.id, dv.source_checksum, d.status, d.title, d.metadata_json "
            "FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id "
            "ORDER BY d.id"
        ).fetchall()
        for document_id, version_id, checksum, status, title, raw_metadata in rows:
            if not str(document_id).startswith(DOCUMENT_PREFIX):
                raise ValueError(f"Unexpected document in pack: {document_id}")
            metadata = _object(json.loads(raw_metadata), f"{document_id} metadata")
            entity_type, fetched_at = _validate_document(str(document_id), str(checksum), metadata)
            fetched.append(fetched_at)
            entity_types[entity_type] = entity_types.get(entity_type, 0) + 1
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
        anchors = {str(row[0]) for row in connection.execute("SELECT anchor FROM chunks")}
    return documents, entity_types, anchors, schema_version, max(fetched)


def verify_pointer_membership(
    core_database: Path,
    documents: list[dict[str, object]],
    anchors: set[str],
) -> dict[str, object]:
    """Check every core pointer to a source article against the exact pack membership.

    Pointers may name another module id; the app resolves them by exact membership instead.
    """
    versions = {str(item["documentId"]): str(item["documentVersionId"]) for item in documents}
    missing: list[str] = []
    version_mismatches: list[str] = []
    missing_anchors: list[str] = []
    named_modules: dict[str, int] = {}
    pointers = 0
    with sqlite3.connect(core_database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "SELECT id, metadata_json FROM documents "
            "WHERE json_extract(metadata_json, '$.contentMode') = 'module-pointer' ORDER BY id"
        )
        for pointer_id, raw_metadata in rows:
            metadata = _object(json.loads(raw_metadata), f"{pointer_id} metadata")
            target = _text(metadata.get("targetDocumentId"), f"{pointer_id} targetDocumentId")
            if not target.startswith(DOCUMENT_PREFIX):
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
            definition = metadata.get("canonicalDefinition")
            if isinstance(definition, dict):
                anchor = cast(dict[str, object], definition).get("sourceAnchor")
                if isinstance(anchor, str) and anchor not in anchors:
                    missing_anchors.append(target)
    return {
        "coreDatabase": str(core_database),
        "coreSha256": _sha256_file(core_database),
        "pointers": pointers,
        "resolved": pointers - len(missing),
        "missingTargets": sorted(missing),
        "versionMismatches": sorted(version_mismatches),
        "missingDefinitionAnchors": sorted(missing_anchors),
        "pointerPrimaryModuleIds": dict(sorted(named_modules.items())),
    }


def package_krasotaimedicina_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
    core_database: Path | None = None,
) -> dict[str, object]:
    if not _VERSION.fullmatch(version):
        raise ValueError("Use a dated version such as 2026.9.28")
    if not _APP_VERSION.fullmatch(min_app_version):
        raise ValueError("minAppVersion must look like 0.6.44")
    module_id = MODULE_ID
    release_tag = f"reference-krasotaimedicina-{version}"
    file_name = f"minimed.reference.krasotaimedicina.{version}.db.gz"
    artifact_id = f"{module_id}-index-{version}"

    documents, entity_types, anchors, schema_version, last_fetched = _read_pack(database)
    snapshot_date = last_fetched[:10]
    pointer_report = (
        verify_pointer_membership(core_database, documents, anchors)
        if core_database is not None
        else None
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = file_name.removesuffix(".db.gz")
    if pointer_report is not None and (
        pointer_report["missingTargets"]
        or pointer_report["versionMismatches"]
        or pointer_report["missingDefinitionAnchors"]
    ):
        failure = output_dir / f"{stem}.pointer-gaps.json"
        failure.write_text(
            json.dumps(pointer_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        raise ValueError(f"Core pointers do not resolve exactly; see {failure}")

    archive = output_dir / file_name
    decoded_sha256 = _sha256_file(database)
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
    archive_sha256 = _sha256_file(archive)
    archive_size = archive.stat().st_size

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
    source_set = "sha256:" + hashlib.sha256(canonical).hexdigest()
    diseases = entity_types.get("disease", 0)
    syndromes = entity_types.get("syndrome", 0)
    description = (
        f"{_plural_ru(len(documents), 'статья', 'статьи', 'статей')} справочника "
        f"«Красота и медицина» (krasotaimedicina.ru): "
        f"{_plural_ru(diseases, 'заболевание', 'заболевания', 'заболеваний')} и "
        f"{_plural_ru(syndromes, 'синдром', 'синдрома', 'синдромов')}. Снимок сайта по "
        f"{snapshot_date}, только текст, со ссылкой на исходную страницу. Справочные статьи "
        "сайта, не клинические рекомендации; клинически не проверены."
    )
    entry: dict[str, object] = {
        "id": module_id,
        "version": version,
        "kind": "reference",
        "collection": "shared",
        "title": "Справочник заболеваний «Красота и медицина»",
        "description": description,
        "required": False,
        "releaseState": "preview",
        "specialties": [],
        "populations": [],
        "tags": ["diseases", "krasotaimedicina", "requires-review", "experimental"],
        "compatibility": {
            "minAppVersion": min_app_version,
            "maxAppVersion": None,
            "schemaVersion": schema_version,
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
            "structuredTables": False,
            "images": False,
            "originalPdf": False,
            "structuredKnowledge": False,
            "calculations": False,
        },
        "artifacts": [
            {
                "id": artifact_id,
                "kind": "index",
                "required": True,
                "url": f"{RELEASE_BASE_URL}/{release_tag}/{file_name}",
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
        "moduleId": module_id,
        "version": version,
        "releaseTag": release_tag,
        "archive": str(archive),
        "archiveSha256": archive_sha256,
        "archiveBytes": archive_size,
        "sqlite": str(database),
        "sqliteSha256": decoded_sha256,
        "sqliteBytes": decoded_size,
        "documents": len(documents),
        "entityTypes": dict(sorted(entity_types.items())),
        "lastFetchedAt": last_fetched,
        "chunks": len(anchors),
        "sourceSetDigest": source_set,
        "catalogEntry": str(entry_path),
        "pointerMembership": pointer_report,
    }
    report_path = output_dir / f"{stem}.package-report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report
