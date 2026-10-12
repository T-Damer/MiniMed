"""Personal-use module bundles: one ``.minimed-module.zip`` the app installs from a file.

A packaged module (``package_module`` writes ``<stem>.catalog-entry.json`` next to its artifact
files) normally ships through the public catalog. Reference data that must never be published
(personal licences, local-only compilations) is wrapped instead into a single STORED ZIP:

* ``module.json``: the catalog entry, artifact URLs rewritten to ``minimed-local:<path-in-zip>``;
* each artifact file at the path its URL names (``artifacts/<file name>``), bytes untouched.

The ZIP is deterministic (fixed timestamps, sorted entries, no compression) and every artifact is
verified against the entry's size and SHA-256 before and after it is written. Build bundles into
the gitignored ``output/local-modules/``; they are never committed or uploaded.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import zipfile
from pathlib import Path, PurePosixPath
from typing import Protocol, cast
from urllib.parse import urlsplit

LOCAL_URL_SCHEME = "minimed-local:"
MODULE_JSON = "module.json"
BUNDLE_SUFFIX = ".minimed-module.zip"
ARTIFACT_DIRECTORY = "artifacts"
_FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
_BLOCK = 1024 * 1024
_SUPPORTED_COMPRESSION = {
    "index": {"none", "gzip", "zstd"},
    "source-assets": {"zip"},
}
_INSTALLABLE_STATES = {"published", "preview"}


class _Readable(Protocol):
    def read(self, size: int = -1, /) -> bytes: ...


def _sha256_stream(stream: _Readable) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while block := stream.read(_BLOCK):
        digest.update(block)
        size += len(block)
    return "sha256:" + digest.hexdigest(), size


def _sha256_file(path: Path) -> tuple[str, int]:
    with path.open("rb") as stream:
        return _sha256_stream(stream)


def _artifact_file_name(url: object, artifact_id: str) -> str:
    if not isinstance(url, str) or not url:
        raise ValueError(f"Artifact {artifact_id} has no url")
    path = (
        urlsplit(url).path if not url.startswith(LOCAL_URL_SCHEME) else url[len(LOCAL_URL_SCHEME) :]
    )
    name = PurePosixPath(path).name
    if not name or name in {".", ".."}:
        raise ValueError(f"Artifact {artifact_id} url does not name a file: {url}")
    return name


def _verify_artifact(artifact: dict[str, object], path: Path) -> None:
    artifact_id = str(artifact["id"])
    expected_sha = artifact.get("sha256")
    expected_size = artifact.get("sizeBytes")
    if not isinstance(expected_sha, str) or not isinstance(expected_size, int):
        raise ValueError(f"Artifact {artifact_id} needs sha256 and sizeBytes")
    sha, size = _sha256_file(path)
    if size != expected_size:
        raise ValueError(f"Artifact {artifact_id} size {size} != catalog entry {expected_size}")
    if sha != expected_sha:
        raise ValueError(f"Artifact {artifact_id} sha256 does not match the catalog entry")
    if artifact.get("compression") == "gzip":
        decoded_sha = artifact.get("decodedSha256")
        decoded_size = artifact.get("decodedSizeBytes")
        with gzip.open(path, "rb") as decoded:
            actual_sha, actual_size = _sha256_stream(decoded)
        if actual_sha != decoded_sha or actual_size != decoded_size:
            raise ValueError(f"Artifact {artifact_id} gzip does not decode to the recorded SQLite")


def _entry_artifacts(entry: dict[str, object]) -> list[dict[str, object]]:
    raw = entry.get("artifacts")
    if not isinstance(raw, list) or not raw:
        raise ValueError("Catalog entry has no artifacts")
    artifacts: list[dict[str, object]] = []
    for item in cast("list[object]", raw):
        if not isinstance(item, dict):
            raise ValueError("Catalog entry artifact must be an object")
        artifact = cast("dict[str, object]", item)
        if not isinstance(artifact.get("id"), str):
            raise ValueError("Catalog entry artifact has no id")
        kind = artifact.get("kind")
        compression = artifact.get("compression")
        if not isinstance(kind, str) or compression not in _SUPPORTED_COMPRESSION.get(kind, set()):
            raise ValueError(f"Artifact {artifact['id']}: unsupported {kind}/{compression}")
        artifacts.append(artifact)
    return artifacts


def bundle_local_module(
    entry_path: Path,
    output: Path,
    *,
    artifacts_dir: Path | None = None,
) -> dict[str, object]:
    """Write ``output`` (``*.minimed-module.zip``) for the packaged module at ``entry_path``."""
    if not output.name.endswith(BUNDLE_SUFFIX):
        raise ValueError(f"Bundle file name must end with {BUNDLE_SUFFIX}")
    loaded: object = json.loads(entry_path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("Catalog entry must be a JSON object")
    entry = cast("dict[str, object]", loaded)
    module_id = entry.get("id")
    version = entry.get("version")
    if not isinstance(module_id, str) or not isinstance(version, str):
        raise ValueError("Catalog entry needs id and version")
    if entry.get("releaseState") not in _INSTALLABLE_STATES:
        raise ValueError("Catalog entry releaseState must be published or preview")
    artifacts = _entry_artifacts(entry)
    if not any(artifact["kind"] == "index" for artifact in artifacts):
        raise ValueError("Catalog entry has no index artifact")

    source_dir = artifacts_dir if artifacts_dir is not None else entry_path.parent
    files: dict[str, Path] = {}
    for artifact in artifacts:
        name = _artifact_file_name(artifact.get("url"), str(artifact["id"]))
        zip_path = f"{ARTIFACT_DIRECTORY}/{name}"
        if zip_path in files:
            raise ValueError(f"Two artifacts share the file name {name}")
        path = source_dir / name
        if not path.is_file():
            raise FileNotFoundError(f"Artifact file {path} not found")
        _verify_artifact(artifact, path)
        files[zip_path] = path
        artifact["url"] = LOCAL_URL_SCHEME + zip_path

    module_json = (json.dumps(entry, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.name + ".partial")
    try:
        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
            _write_bytes(zf, MODULE_JSON, module_json)
            for zip_path in sorted(files):
                _write_file(zf, zip_path, files[zip_path])
        _verify_bundle(partial, artifacts, files)
        partial.replace(output)
    finally:
        partial.unlink(missing_ok=True)

    bundle_sha, bundle_size = _sha256_file(output)
    return {
        "moduleId": module_id,
        "version": version,
        "bundle": str(output),
        "bundleSha256": bundle_sha,
        "bundleBytes": bundle_size,
        "artifacts": [
            {"id": artifact["id"], "url": artifact["url"], "sizeBytes": artifact["sizeBytes"]}
            for artifact in artifacts
        ],
    }


def _zip_info(name: str, size: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=_FIXED_TIMESTAMP)
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = 0o644 << 16
    info.file_size = size
    return info


def _write_bytes(zf: zipfile.ZipFile, name: str, data: bytes) -> None:
    zf.writestr(_zip_info(name, len(data)), data, compress_type=zipfile.ZIP_STORED)


def _write_file(zf: zipfile.ZipFile, name: str, path: Path) -> None:
    size = path.stat().st_size
    with (
        path.open("rb") as source,
        zf.open(_zip_info(name, size), "w", force_zip64=size >= 2**31) as target,
    ):
        while block := source.read(_BLOCK):
            target.write(block)


def _verify_bundle(
    bundle: Path, artifacts: list[dict[str, object]], files: dict[str, Path]
) -> None:
    by_path = {
        str(artifact["url"]).removeprefix(LOCAL_URL_SCHEME): artifact for artifact in artifacts
    }
    with zipfile.ZipFile(bundle) as zf:
        names = zf.namelist()
        if names != [MODULE_JSON, *sorted(files)]:
            raise ValueError("Bundle entries are not in the expected order")
        for info in zf.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                raise ValueError(f"{info.filename} was compressed; bundles must be STORED")
        for zip_path, artifact in by_path.items():
            with zf.open(zip_path) as stream:
                sha, size = _sha256_stream(stream)
            if sha != artifact["sha256"] or size != artifact["sizeBytes"]:
                raise ValueError(f"{zip_path} does not round-trip through the bundle")
