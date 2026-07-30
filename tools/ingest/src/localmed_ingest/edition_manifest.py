from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from .models import CamelModel, ContentPack, SourceProvenance


class EditionManifestSource(CamelModel):
    document_id: str
    document_version_id: str
    source_checksum: str
    provenance: SourceProvenance | None = None


class EditionManifest(CamelModel):
    schema_version: int = 1
    edition_id: str
    edition_version: str
    database_sha256: str
    publishability: str
    sources: list[EditionManifestSource]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _provenance_for_document(pack: ContentPack, document_id: str) -> SourceProvenance | None:
    document = next(document for document in pack.documents if document.id == document_id)
    raw_provenance = document.metadata.get("provenance")
    if raw_provenance is None:
        return None
    if not isinstance(raw_provenance, dict):
        raise ValueError(f"Document {document_id} has invalid provenance metadata.")
    return SourceProvenance.model_validate(raw_provenance)


def build_edition_manifest(pack: ContentPack, database: Path) -> EditionManifest:
    if not database.is_file():
        raise FileNotFoundError(f"Edition database does not exist: {database}")
    sources = [
        EditionManifestSource(
            document_id=document.id,
            document_version_id=document.version.id,
            source_checksum=document.version.source_checksum,
            provenance=_provenance_for_document(pack, document.id),
        )
        for document in sorted(pack.documents, key=lambda item: item.id)
    ]
    manifest = EditionManifest(
        edition_id=pack.manifest.id,
        edition_version=pack.manifest.version,
        database_sha256=sha256_file(database),
        publishability=pack.manifest.publication_state,
        sources=sources,
    )
    validate_edition_manifest(manifest, pack, database)
    return manifest


def validate_pack_publication(pack: ContentPack) -> None:
    if pack.manifest.publication_state != "published":
        return
    for document in pack.documents:
        provenance = _provenance_for_document(pack, document.id)
        if provenance is None:
            raise ValueError(f"Published document {document.id} has no typed provenance.")
        if provenance.raw_checksum != document.version.source_checksum:
            raise ValueError(
                f"Published document {document.id} provenance checksum does not match."
            )
        if provenance.rights_status != "verified":
            raise ValueError(f"Published document {document.id} rights are not verified.")
        if not provenance.rights.allows_offline_storage:
            raise ValueError(f"Published document {document.id} lacks offline-storage rights.")
        if not provenance.rights.allows_redistribution:
            raise ValueError(f"Published document {document.id} lacks redistribution rights.")


def validate_edition_manifest(
    manifest: EditionManifest,
    pack: ContentPack,
    database: Path,
    *,
    require_published: bool = False,
) -> None:
    if manifest.edition_id != pack.manifest.id or manifest.edition_version != pack.manifest.version:
        raise ValueError("Edition manifest does not match the pack identity.")
    if manifest.database_sha256 != sha256_file(database):
        raise ValueError("Edition manifest does not match the database checksum.")
    if manifest.publishability != pack.manifest.publication_state:
        raise ValueError("Edition manifest does not match the pack publishability.")
    if require_published and manifest.publishability != "published":
        raise ValueError("Local-development editions cannot activate as published editions.")

    expected = {
        document.id: (document.version.id, document.version.source_checksum)
        for document in pack.documents
    }
    actual = {
        source.document_id: (source.document_version_id, source.source_checksum)
        for source in manifest.sources
    }
    if len(actual) != len(manifest.sources) or actual != expected:
        raise ValueError("Edition manifest source set does not match the pack.")

    validate_pack_publication(pack)


def validate_local_edition_manifest(manifest: EditionManifest, database: Path) -> None:
    """Validate a local-development manifest without loading authoring artifacts."""
    if manifest.publishability != "local-dev":
        raise ValueError("Composer can only produce local-development editions.")
    if manifest.database_sha256 != sha256_file(database):
        raise ValueError("Edition manifest does not match the database checksum.")

    connection = sqlite3.connect(database)
    try:
        packs = connection.execute("SELECT id, version FROM content_packs").fetchall()
        if packs != [(manifest.edition_id, manifest.edition_version)]:
            raise ValueError("Edition manifest does not match the database pack identity.")
        expected = {
            str(document_id): (str(version_id), str(checksum))
            for document_id, version_id, checksum in connection.execute(
                """SELECT d.id, dv.id, dv.source_checksum
                FROM documents d
                JOIN document_versions dv ON dv.id = d.current_version_id
                ORDER BY d.id"""
            )
        }
    finally:
        connection.close()
    actual = {
        source.document_id: (source.document_version_id, source.source_checksum)
        for source in manifest.sources
    }
    if len(actual) != len(manifest.sources) or actual != expected:
        raise ValueError("Edition manifest source set does not match the composed database.")


def write_edition_manifest(path: Path, manifest: EditionManifest) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
