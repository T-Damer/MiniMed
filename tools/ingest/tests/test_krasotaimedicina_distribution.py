from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.builder import build_content_pack
from localmed_ingest.krasotaimedicina_distribution import package_krasotaimedicina_module
from localmed_ingest.krasotaimedicina_prepare import (
    PublicationDecision,
    prepare_krasotaimedicina,
)

URLS = {
    "Пневмония": "https://www.krasotaimedicina.ru/diseases/zabolevanija_pulmonology/pneumonia",
    "Синдром Жильбера": "https://www.krasotaimedicina.ru/diseases/a/gilbert",
}
DECISION = PublicationDecision(
    decided_at="2026-09-28", decided_by="project owner", basis="personal project"
)


def _document_id(url: str) -> str:
    return "krasotaimedicina.disease." + hashlib.sha256(url.encode()).hexdigest()[:16]


def _pack(root: Path, publication: PublicationDecision | None = DECISION) -> Path:
    raw = root / "raw"
    (raw / "records").mkdir(parents=True)
    (raw / "pages").mkdir()
    for index, (title, url) in enumerate(URLS.items()):
        html = f"""
        <div class="previewTextDis"><div itemprop="description">
        <p>{title}: описание.</p></div></div>
        <div class="detailTextDis"><h2>Общие сведения</h2><p>Текст {index}.</p></div>
        """.encode()
        (raw / "pages" / f"{index}.html").write_bytes(html)
        (raw / "records" / f"{index}.json").write_text(
            json.dumps(
                {
                    "entityType": "disease",
                    "fetchedAt": f"2026-09-0{index + 3}T10:00:00Z",
                    "rawPath": f"pages/{index}.html",
                    "rawSha256": hashlib.sha256(html).hexdigest(),
                    "title": title,
                    "url": url,
                    "rightsStatus": "unresolved",
                    "publicationState": "blocked",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    workspace = root / "workspace"
    prepare_krasotaimedicina(raw, workspace, publication)
    database = root / "pack.db"
    build_content_pack(workspace, database, include_embeddings=False)
    return database


def _pack_identity(database: Path) -> dict[str, tuple[str, str]]:
    """documentId -> (current version id, summary anchor)."""
    connection = sqlite3.connect(database)
    try:
        rows = connection.execute(
            "SELECT d.id, d.current_version_id, min(c.anchor) FROM documents d "
            "JOIN chunks c ON c.document_version_id = d.current_version_id GROUP BY d.id"
        ).fetchall()
        return {str(row[0]): (str(row[1]), str(row[2])) for row in rows}
    finally:
        connection.close()


def _core(path: Path, pointers: list[dict[str, object]]) -> Path:
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE documents (id TEXT PRIMARY KEY, metadata_json TEXT)")
        connection.executemany(
            "INSERT INTO documents VALUES (?, ?)",
            [
                (f"core.catalog.pointer.{index}", json.dumps(pointer))
                for index, pointer in enumerate(pointers)
            ],
        )
        connection.execute(
            "INSERT INTO documents VALUES ('core.other', ?)", (json.dumps({"contentMode": "x"}),)
        )
        connection.commit()
    finally:
        connection.close()
    return path


def _pointer(
    target: str, version: str | None = None, anchor: str | None = None
) -> dict[str, object]:
    pointer: dict[str, object] = {
        "contentMode": "module-pointer",
        "targetDocumentId": target,
        "primaryModuleId": "minimed.mkb.ru",
        "moduleIds": ["minimed.mkb.ru"],
    }
    if version is not None:
        pointer["sourceDocumentVersionId"] = version
    if anchor is not None:
        pointer["canonicalDefinition"] = {"sourceAnchor": anchor}
    return pointer


def test_package_writes_exact_gzip_membership_and_verifies_core_pointers(tmp_path: Path) -> None:
    database = _pack(tmp_path)
    identity = _pack_identity(database)
    core = _core(
        tmp_path / "core.db",
        [
            *[
                _pointer(document_id, version, anchor)
                for document_id, (version, anchor) in identity.items()
            ],
            _pointer("rls.mkb.J18"),
        ],
    )

    report = package_krasotaimedicina_module(
        database,
        tmp_path / "out",
        version="2026.9.28",
        min_app_version="0.6.44",
        core_database=core,
    )

    membership = report["pointerMembership"]
    assert isinstance(membership, dict)
    assert membership["pointers"] == 2
    assert membership["resolved"] == 2
    assert membership["missingTargets"] == []
    assert membership["pointerPrimaryModuleIds"] == {"minimed.mkb.ru": 2}
    archive = Path(str(report["archive"]))
    assert gzip.decompress(archive.read_bytes()) == database.read_bytes()
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.reference.krasotaimedicina.ru"
    assert entry["collection"] == "conditions"
    assert entry["releaseState"] == "preview"
    assert entry["compatibility"]["minAppVersion"] == "0.6.44"
    assert entry["compatibility"]["schemaVersion"] == 2
    [artifact] = entry["artifacts"]
    assert artifact["url"] == (
        "https://github.com/T-Damer/MiniMed/releases/download/reference-krasotaimedicina-2026.9.28/"
        "minimed.reference.krasotaimedicina.2026.9.28.db.gz"
    )
    assert artifact["sha256"] == "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest()
    assert artifact["sizeBytes"] == archive.stat().st_size
    assert (
        artifact["decodedSha256"] == "sha256:" + hashlib.sha256(database.read_bytes()).hexdigest()
    )
    assert artifact["decodedSizeBytes"] == database.stat().st_size
    assert artifact["sourceSetDigest"] == entry["sourceSetDigest"]
    assert sorted(document["documentId"] for document in entry["documents"]) == sorted(
        _document_id(url) for url in URLS.values()
    )
    assert {document["indexArtifactId"] for document in entry["documents"]} == {artifact["id"]}
    assert entry["previewDocumentCount"] == 2
    assert "1 заболевание и 1 синдром" in entry["description"]


def test_package_refuses_a_core_pointer_without_its_target(tmp_path: Path) -> None:
    database = _pack(tmp_path)
    missing = _document_id("https://www.krasotaimedicina.ru/diseases/missing")
    core = _core(tmp_path / "core.db", [_pointer(missing)])

    with pytest.raises(ValueError, match="do not resolve exactly"):
        package_krasotaimedicina_module(
            database,
            tmp_path / "out",
            version="2026.9.28",
            min_app_version="0.6.44",
            core_database=core,
        )

    gaps = json.loads(
        (
            tmp_path / "out" / "minimed.reference.krasotaimedicina.2026.9.28.pointer-gaps.json"
        ).read_text(encoding="utf-8")
    )
    assert gaps["missingTargets"] == [missing]
    assert not (tmp_path / "out" / "minimed.reference.krasotaimedicina.2026.9.28.db.gz").exists()


def test_package_refuses_a_changed_version_or_anchor(tmp_path: Path) -> None:
    database = _pack(tmp_path)
    document_id, (version, _) = next(iter(_pack_identity(database).items()))
    core = _core(
        tmp_path / "core.db",
        [_pointer(document_id, version + "-old", f"{version}/gone#chunk-0")],
    )

    with pytest.raises(ValueError, match="do not resolve exactly"):
        package_krasotaimedicina_module(
            database,
            tmp_path / "out",
            version="2026.9.28",
            min_app_version="0.6.44",
            core_database=core,
        )


def test_package_refuses_a_snapshot_prepared_without_a_publication_decision(
    tmp_path: Path,
) -> None:
    database = _pack(tmp_path, publication=None)

    with pytest.raises(ValueError, match="publication decision"):
        package_krasotaimedicina_module(
            database,
            tmp_path / "out",
            version="2026.9.28",
            min_app_version="0.6.44",
        )
