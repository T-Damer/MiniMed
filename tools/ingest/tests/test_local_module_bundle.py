from __future__ import annotations

import gzip
import hashlib
import json
import zipfile
from pathlib import Path

import pytest
from typer.testing import CliRunner

from localmed_ingest.cli import app
from localmed_ingest.local_module_bundle import (
    BUNDLE_SUFFIX,
    LOCAL_URL_SCHEME,
    MODULE_JSON,
    bundle_local_module,
)


def _sha(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _packaged_module(directory: Path) -> Path:
    database = b"SQLite format 3\x00" + bytes(range(256)) * 8
    archive = gzip.compress(database, mtime=0)
    (directory / "demo.2026.10.12.db.gz").write_bytes(archive)
    entry = {
        "id": "minimed.reference.demo",
        "version": "2026.10.12",
        "kind": "reference",
        "releaseState": "preview",
        "title": "Демо",
        "artifacts": [
            {
                "id": "minimed.reference.demo-index-2026.10.12",
                "kind": "index",
                "required": True,
                "url": "https://github.com/T-Damer/MiniMed/releases/download/x/demo.2026.10.12.db.gz",
                "sha256": _sha(archive),
                "sizeBytes": len(archive),
                "compression": "gzip",
                "decodedSha256": _sha(database),
                "decodedSizeBytes": len(database),
                "sourceSetDigest": _sha(b"set"),
            }
        ],
    }
    path = directory / "demo.2026.10.12.catalog-entry.json"
    path.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
    return path


def test_bundle_rewrites_urls_and_stores_artifacts(tmp_path: Path) -> None:
    entry_path = _packaged_module(tmp_path)
    output = tmp_path / "out" / f"demo{BUNDLE_SUFFIX}"

    report = bundle_local_module(entry_path, output)

    assert report["moduleId"] == "minimed.reference.demo"
    with zipfile.ZipFile(output) as zf:
        assert zf.namelist() == [MODULE_JSON, "artifacts/demo.2026.10.12.db.gz"]
        assert {info.compress_type for info in zf.infolist()} == {zipfile.ZIP_STORED}
        assert {info.date_time for info in zf.infolist()} == {(1980, 1, 1, 0, 0, 0)}
        module = json.loads(zf.read(MODULE_JSON))
        artifact = module["artifacts"][0]
        assert artifact["url"] == f"{LOCAL_URL_SCHEME}artifacts/demo.2026.10.12.db.gz"
        stored = zf.read("artifacts/demo.2026.10.12.db.gz")
        assert _sha(stored) == artifact["sha256"]
    original = json.loads(entry_path.read_text(encoding="utf-8"))
    assert original["artifacts"][0]["url"].startswith("https://")


def test_bundle_is_deterministic(tmp_path: Path) -> None:
    entry_path = _packaged_module(tmp_path)
    first = tmp_path / f"a{BUNDLE_SUFFIX}"
    second = tmp_path / f"b{BUNDLE_SUFFIX}"
    bundle_local_module(entry_path, first)
    bundle_local_module(entry_path, second)
    assert first.read_bytes() == second.read_bytes()


def test_bundle_rejects_checksum_mismatch(tmp_path: Path) -> None:
    entry_path = _packaged_module(tmp_path)
    artifact = tmp_path / "demo.2026.10.12.db.gz"
    damaged = bytearray(artifact.read_bytes())
    damaged[-1] ^= 0xFF
    artifact.write_bytes(bytes(damaged))
    with pytest.raises(ValueError, match="sha256 does not match"):
        bundle_local_module(entry_path, tmp_path / f"demo{BUNDLE_SUFFIX}")
    assert not (tmp_path / f"demo{BUNDLE_SUFFIX}").exists()


def test_bundle_rejects_missing_artifact_and_bad_name(tmp_path: Path) -> None:
    entry_path = _packaged_module(tmp_path)
    (tmp_path / "demo.2026.10.12.db.gz").unlink()
    with pytest.raises(FileNotFoundError):
        bundle_local_module(entry_path, tmp_path / f"demo{BUNDLE_SUFFIX}")
    with pytest.raises(ValueError, match="must end with"):
        bundle_local_module(entry_path, tmp_path / "demo.zip")


def test_bundle_rejects_unsupported_compression(tmp_path: Path) -> None:
    entry_path = _packaged_module(tmp_path)
    entry = json.loads(entry_path.read_text(encoding="utf-8"))
    entry["artifacts"][0]["compression"] = "zip"
    entry_path.write_text(json.dumps(entry), encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported"):
        bundle_local_module(entry_path, tmp_path / f"demo{BUNDLE_SUFFIX}")


def test_cli_writes_bundle(tmp_path: Path) -> None:
    entry_path = _packaged_module(tmp_path)
    output = tmp_path / f"cli{BUNDLE_SUFFIX}"
    result = CliRunner().invoke(
        app, ["bundle-local-module", "--entry", str(entry_path), "--output", str(output)]
    )
    assert result.exit_code == 0, result.output
    assert output.is_file()
