from __future__ import annotations

import hashlib
import io
import json
import sqlite3
from collections.abc import Mapping
from pathlib import Path
from zipfile import ZipFile

from localmed_ingest.allmed_images import build_allmed_image_pack


class FakeImageResponse:
    status = 200

    def __init__(self, payload: bytes, content_type: str) -> None:
        self.headers: Mapping[str, str] = {"Content-Type": content_type}
        self._stream = io.BytesIO(payload)

    def read(self, amount: int = -1) -> bytes:
        return self._stream.read(amount)

    def __enter__(self) -> FakeImageResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def write_image_fixture(path: Path, *, invalid_reference: bool = False) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE drugs (id INTEGER PRIMARY KEY, name_ru TEXT, img TEXT);
            CREATE TABLE ingredients (id INTEGER PRIMARY KEY);
            CREATE TABLE categories (id INTEGER PRIMARY KEY);
            CREATE TABLE ingredients_relation (drug_id INTEGER, ingredient_id INTEGER);
            CREATE TABLE categories_relation (
                id INTEGER PRIMARY KEY, drug_id INTEGER, category_id INTEGER
            );
            INSERT INTO drugs VALUES
                (1, 'Препарат один', 'img/preparations/1.png'),
                (2, 'Препарат два', 'img/preparations/2.jpg'),
                (3, 'Препарат один — копия ссылки', 'img/preparations/1.png');
            """
        )
        if invalid_reference:
            connection.execute(
                "INSERT INTO drugs VALUES (?, ?, ?)",
                (4, "Плохая ссылка", "img/preparations/"),
            )
        connection.commit()
    finally:
        connection.close()


def test_builds_deterministic_image_zip_and_index(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    output = tmp_path / "image-pack"
    write_image_fixture(source)
    payloads = {
        "https://allmed.pro/img/preparations/1.png": (b"png-payload", "image/png"),
        "https://allmed.pro/img/preparations/2.jpg": (b"jpg-payload", "image/jpeg"),
    }
    calls: list[str] = []

    def opener(url: str, _timeout: float) -> FakeImageResponse:
        calls.append(url)
        payload, content_type = payloads[url]
        return FakeImageResponse(payload, content_type)

    report = build_allmed_image_pack(source, output, workers=2, retries=0, opener=opener)

    assert report.complete is True
    assert report.total_references == 3
    assert report.distinct_references == 2
    assert report.duplicate_references == 1
    assert report.successful_references == 2
    assert report.failed_references == 0
    assert report.zip is not None
    assert report.index is not None
    assert report.catalog_manifest is not None
    assert report.source_set_digest is not None
    assert len(calls) == 2

    with ZipFile(report.zip) as archive:
        names = archive.namelist()
        assert len(names) == 3
        assert all(".." not in name.split("/") for name in names)
        assert names == [
            "manifest.json",
            "img/preparations/1.png",
            "img/preparations/2.jpg",
        ]
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["rawDatabaseSha256"] == report.raw_database_sha256
    assert manifest["images"]["img/preparations/1.png"]["allmedIds"] == [1, 3]
    assert manifest["images"]["img/preparations/2.jpg"]["contentType"] == "image/jpeg"

    manifest_digest = f"sha256:{hashlib.sha256(Path(report.manifest).read_bytes()).hexdigest()}"
    document_version_id = "medications.packaging-images@allmed-images-"
    document_version_id += report.raw_database_sha256.removeprefix("sha256:")[:12]
    source_set_payload = [
        {
            "documentId": "medications.packaging-images",
            "documentVersionId": document_version_id,
            "sourceChecksum": manifest_digest,
        }
    ]
    source_set_digest = "sha256:"
    source_set_digest += hashlib.sha256(
        json.dumps(
            source_set_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    with sqlite3.connect(report.index) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        pack = connection.execute("SELECT id, checksum FROM content_packs").fetchone()
        assert pack[0] == ("minimed.medications.packaging-images.ru")
        assert pack[1] != manifest_digest
    edition = json.loads(Path(report.edition_manifest or "").read_text(encoding="utf-8"))
    assert edition["sources"][0]["sourceChecksum"] == manifest_digest
    catalog = json.loads(Path(report.catalog_manifest).read_text(encoding="utf-8"))
    module = catalog["modules"][0]
    assert module["id"] == "minimed.medications.packaging-images.ru"
    assert module["releaseState"] == "preview"
    assert "experimental" in module["tags"]
    assert module["sourceSetDigest"] == source_set_digest
    assert report.source_set_digest == source_set_digest
    assert module["documents"][0]["sourceChecksum"] == manifest_digest
    assert module["sourceSetDigest"] != module["documents"][0]["sourceChecksum"]
    index_artifact, source_asset_artifact = module["artifacts"]
    assert source_asset_artifact["required"] is True
    assert source_asset_artifact["compression"] == "zip"
    required_total = index_artifact["sizeBytes"] + source_asset_artifact["sizeBytes"]
    assert module["sizes"]["downloadBytes"] == required_total
    assert module["sizes"]["installedBytes"] == required_total
    assert module["sizes"]["sourceAssetsDownloadBytes"] == source_asset_artifact["sizeBytes"]
    assert {
        (dependency["moduleId"], dependency["versionRange"], dependency["required"])
        for dependency in module["dependencies"]
    } >= {
        ("minimed.core.ru", "^1.0.0", True),
        (
            "minimed.medications.ru",
            f"allmed-{report.raw_database_sha256.removeprefix('sha256:')[:12]}",
            True,
        ),
    }


def test_resume_skips_checksum_valid_cached_images(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    output = tmp_path / "image-pack"
    write_image_fixture(source)

    def opener(url: str, _timeout: float) -> FakeImageResponse:
        content_type = "image/png" if url.endswith(".png") else "image/jpeg"
        return FakeImageResponse(b"cached-payload", content_type)

    first = build_allmed_image_pack(source, output, workers=2, retries=0, opener=opener)
    unexpected_calls: list[str] = []

    def should_not_open(url: str, _timeout: float) -> FakeImageResponse:
        unexpected_calls.append(url)
        raise AssertionError("resume used the network for a valid cached image")

    resumed = build_allmed_image_pack(
        source,
        output,
        workers=2,
        retries=0,
        resume=True,
        opener=should_not_open,
    )

    assert unexpected_calls == []
    assert resumed.complete is True
    assert resumed.zip_sha256 == first.zip_sha256
    assert resumed.index_sha256 == first.index_sha256
    assert (
        Path(resumed.catalog_manifest or "").read_bytes()
        == Path(first.catalog_manifest or "").read_bytes()
    )


def test_packages_successes_and_reports_invalid_reference(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    output = tmp_path / "image-pack"
    write_image_fixture(source, invalid_reference=True)

    def opener(url: str, _timeout: float) -> FakeImageResponse:
        content_type = "image/png" if url.endswith(".png") else "image/jpeg"
        return FakeImageResponse(b"valid-payload", content_type)

    report = build_allmed_image_pack(
        source,
        output,
        workers=1,
        retries=0,
        opener=opener,
    )

    assert report.complete is False
    assert report.safe_references == 2
    assert report.failed_references == 1
    assert "img/preparations/" in report.failures
    assert report.zip is not None
    assert report.index is not None
    assert report.catalog_manifest is not None
    with ZipFile(report.zip) as archive:
        assert len(archive.namelist()) == 3
        assert archive.namelist()[0] == "manifest.json"
    manifest = json.loads(Path(report.manifest).read_text(encoding="utf-8"))
    assert manifest["failures"]["img/preparations/"]["allmedIds"] == [4]
    catalog = json.loads(Path(report.catalog_manifest).read_text(encoding="utf-8"))
    module = catalog["modules"][0]
    assert module["releaseState"] == "preview"
    assert module["documents"][0]["sourceAssetArtifactId"] == module["artifacts"][1]["id"]
