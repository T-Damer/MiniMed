"""Prepare exact gzip download descriptors, not guessed or unchecked release entries."""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

from .models import SourceProvenance
from .russian_dictionary import LICENSE_URL
from .terminology_sources import sha256_file


def _path(root: Path, name: str) -> Path:
    path = root / name
    if path.is_symlink() or path.resolve().parent != root.resolve() or not path.is_file():
        raise ValueError("Invalid distribution artifact path")
    return path


def russian_distribution_catalog(packs: Path, asset_base_url: str) -> list[dict[str, object]]:
    """Candidate descriptors; publisher must upload/verify assets before committing these to UI."""
    url = urlparse(asset_base_url)
    if (
        url.scheme != "https"
        or url.hostname != "github.com"
        or url.query
        or url.fragment
        or not url.path.startswith("/T-Damer/MiniMed/releases/download/")
    ):
        raise ValueError("Expected the MiniMed HTTPS dataset release path")
    report = json.loads((packs / "pack-size-report.json").read_text())
    if report.get("license") != "CC-BY-SA-4.0":
        raise ValueError("Not a rights-qualified Russian dictionary build")
    modules: list[dict[str, object]] = []
    for pack in report["packs"]:
        db = _path(packs, pack["database"])
        compressed = _path(packs, pack["database"] + ".gz")
        if (
            sha256_file(db) != pack["sha256"]
            or db.stat().st_size != pack["bytes"]
            or sha256_file(compressed) != pack["gzipSha256"]
            or compressed.stat().st_size != pack["gzipBytes"]
        ):
            raise ValueError("Distribution checksum/size mismatch")
        decoded_size = 0
        digest = hashlib.sha256()
        with gzip.open(compressed, "rb") as stream:
            while block := stream.read(1024 * 1024):
                decoded_size += len(block)
                if decoded_size > pack["bytes"]:
                    raise ValueError("Decoded artifact exceeds its declared size")
                digest.update(block)
        if decoded_size != pack["bytes"] or "sha256:" + digest.hexdigest() != pack["sha256"]:
            raise ValueError("Gzip does not reconstruct the exact validated SQLite")
        artifact_id = f"{pack['moduleId']}-index-{pack['version']}"
        documents = []
        specialties: set[str] = set()
        with sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True) as connection:
            if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("SQLite integrity check failed")
            if connection.execute("PRAGMA foreign_key_check").fetchone():
                raise ValueError("SQLite foreign-key check failed")
            identity = connection.execute("SELECT id, version FROM content_packs").fetchall()
            if identity != [(pack["moduleId"], pack["version"])]:
                raise ValueError("Pack identity mismatch")
            rows = connection.execute(
                "SELECT d.id, dv.id, dv.source_checksum, d.status, d.title, "
                "d.metadata_json, d.specialty_json FROM documents d "
                "JOIN document_versions dv ON dv.id=d.current_version_id ORDER BY d.id"
            )
            for doc_id, version_id, checksum, status, title, raw, subjects in rows:
                metadata = json.loads(raw)
                provenance = SourceProvenance.model_validate(metadata["provenance"])
                if (
                    provenance.raw_checksum != checksum
                    or provenance.rights_status != "verified"
                    or not provenance.rights.allows_redistribution
                    or not provenance.rights.allows_derivative_processing
                    or provenance.rights.expires_at
                    or provenance.rights.license_id != "CC-BY-SA-4.0"
                    or metadata.get("clinicalApproval") is not False
                ):
                    raise ValueError(
                        "Unqualified source rights/identity/authority in published data"
                    )
                specialties.update(json.loads(subjects))
                documents.append(
                    {
                        "documentId": doc_id,
                        "documentVersionId": version_id,
                        "sourceChecksum": checksum,
                        "status": status,
                        "title": title,
                        "indexArtifactId": artifact_id,
                        "sourceAssetArtifactId": None,
                    }
                )
            chunks = connection.execute("SELECT count(*) FROM chunks").fetchone()[0]
            if chunks != connection.execute("SELECT count(*) FROM chunks_fts").fetchone()[0]:
                raise ValueError("Incomplete full-text index")
        if len(documents) != pack["documents"] or not documents:
            raise ValueError("Exact document membership mismatch")
        # Match the existing runtime source-set digest convention, excluding titles and transport.
        canonical = json.dumps(
            [
                {
                    key: d[key]
                    for key in ("documentId", "documentVersionId", "sourceChecksum", "status")
                }
                for d in documents
            ],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        source_digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
        modules.append(
            {
                "id": pack["moduleId"],
                "version": pack["version"],
                "kind": "reference",
                "collection": "medical-terminology",
                "title": pack["title"],
                "description": "Русский Викисловарь: исходные словарные определения, "
                "не клинические "
                "рекомендации. Индекс содержит все определения; разделы — статьи их "
                "основной тематической группы. CC-BY-SA-4.0: " + LICENSE_URL,
                "required": False,
                "releaseState": "published",
                "specialties": sorted(specialties),
                "populations": [],
                "tags": ["термины", "русские определения", "Викисловарь"],
                "compatibility": {
                    "minAppVersion": "0.6.38",
                    "maxAppVersion": None,
                    "schemaVersion": 2,
                    "coreCatalogVersion": "1",
                },
                "sourceSetDigest": source_digest,
                "dependencies": [],
                "sizes": {
                    "downloadBytes": pack["gzipBytes"],
                    "installedBytes": pack["bytes"],
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
                        "url": asset_base_url.rstrip("/") + "/" + compressed.name,
                        "sha256": pack["gzipSha256"],
                        "sizeBytes": pack["gzipBytes"],
                        "decodedSha256": pack["sha256"],
                        "decodedSizeBytes": pack["bytes"],
                        "compression": "gzip",
                        "sourceSetDigest": source_digest,
                    }
                ],
                "documents": documents,
                "previewDocumentCount": len(documents),
            }
        )
    return modules
