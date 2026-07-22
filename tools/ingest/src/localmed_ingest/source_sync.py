from __future__ import annotations

import hashlib
import json
import os
import shutil
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

SyncStatus = Literal[
    "downloaded",
    "not-modified",
    "cache-fallback",
    "local",
    "unchanged",
]
ContentType = Literal["auto", "pdf", "text", "markdown"]


class SyncSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    location: str
    target: str
    content_type: ContentType = "auto"
    sha256: str | None = None
    max_bytes: int = Field(default=100 * 1024 * 1024, gt=0)


class SourceSyncManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(default=1, ge=1)
    sources: list[SyncSource]

    @model_validator(mode="after")
    def validate_sources(self) -> SourceSyncManifest:
        if not self.sources:
            raise ValueError("Source sync manifest must contain at least one source.")
        ids = [source.id for source in self.sources]
        targets = [source.target for source in self.sources]
        if len(ids) != len(set(ids)):
            raise ValueError("Source sync manifest contains duplicate source ids.")
        if len(targets) != len(set(targets)):
            raise ValueError("Source sync manifest contains duplicate target paths.")
        return self


class SyncedSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    location: str
    target: str
    status: SyncStatus
    sha256: str
    bytes: int = Field(ge=0)
    cache_hit: bool
    materialized: bool
    etag: str | None = None
    last_modified: str | None = None
    final_url: str | None = None
    warning: str | None = None


class SourceSyncReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest_version: int
    generated_at: str
    force_refresh: bool
    offline: bool
    downloaded: int
    cache_hits: int
    unchanged: int
    materialized: int
    sources: list[SyncedSource]


class CachedRemoteMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location: str
    final_url: str
    sha256: str
    bytes: int = Field(ge=0)
    etag: str | None = None
    last_modified: str | None = None
    fetched_at: str
    content_type: ContentType


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_yaml(path: Path) -> object:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_sync_manifest(path: Path) -> SourceSyncManifest:
    payload = _load_yaml(path)
    if not isinstance(payload, dict):
        raise ValueError("Source sync manifest must be a YAML mapping.")
    return SourceSyncManifest.model_validate(payload)


def _safe_relative_target(output_root: Path, target: str) -> Path:
    root = output_root.resolve()
    candidate = (root / target).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Source target escapes output root: {target}") from error
    if candidate == root:
        raise ValueError("Source target cannot be the output root itself.")
    return candidate


def _local_source_path(manifest_path: Path, input_root: Path | None, location: str) -> Path:
    base = input_root.resolve() if input_root is not None else manifest_path.parent.resolve()
    candidate = (base / location).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as error:
        raise ValueError(f"Local source escapes input root: {location}") from error
    if not candidate.is_file():
        raise FileNotFoundError(f"Local source does not exist: {candidate}")
    return candidate


def _is_remote(location: str) -> bool:
    scheme = urllib.parse.urlparse(location).scheme.lower()
    return scheme in {"http", "https"}


def _validate_remote_url(location: str) -> None:
    parsed = urllib.parse.urlparse(location)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}:
        return
    raise ValueError(f"Remote source must use HTTPS: {location}")


def _resolved_content_type(source: SyncSource) -> ContentType:
    if source.content_type != "auto":
        return source.content_type
    suffix = Path(source.target).suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix in {".txt", ".text", ".yaml", ".yml", ".json"}:
        return "text"
    raise ValueError(
        f"Cannot infer content type for {source.id} from target extension: {source.target}"
    )


def _validate_payload(payload: bytes, content_type: ContentType, source_id: str) -> None:
    if not payload:
        raise ValueError(f"Source {source_id} returned an empty payload.")
    if content_type == "pdf":
        if not payload.startswith(b"%PDF-"):
            raise ValueError(f"Source {source_id} is not a valid PDF payload.")
        return
    try:
        payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"Source {source_id} is not valid UTF-8 text.") from error


def _read_limited(response: object, maximum: int) -> bytes:
    read = getattr(response, "read", None)
    if not callable(read):
        raise TypeError("HTTP response does not expose a readable body.")
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = read(min(1024 * 1024, maximum - total + 1))
        if not isinstance(chunk, bytes):
            raise TypeError("HTTP response returned a non-bytes body chunk.")
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum:
            raise ValueError(f"Remote payload exceeds configured limit of {maximum} bytes.")
    return b"".join(chunks)


def _cache_paths(cache_root: Path, location: str, target: str) -> tuple[Path, Path]:
    key = hashlib.sha256(location.encode("utf-8")).hexdigest()
    suffix = Path(target).suffix.lower()
    return cache_root / f"{key}{suffix}", cache_root / f"{key}.json"


def _load_cached_metadata(path: Path) -> CachedRemoteMetadata | None:
    if not path.is_file():
        return None
    try:
        payload: object = json.loads(path.read_text(encoding="utf-8"))
        return CachedRemoteMetadata.model_validate(payload)
    except (json.JSONDecodeError, ValueError):
        return None


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _write_json_atomic(path: Path, payload: object) -> None:
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    _write_atomic(path, encoded)


def _materialize(payload_path: Path, target_path: Path, expected_sha256: str) -> tuple[bool, int]:
    if target_path.is_file() and _sha256_file(target_path) == expected_sha256:
        return False, target_path.stat().st_size
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = target_path.with_name(f".{target_path.name}.tmp-{os.getpid()}")
    shutil.copyfile(payload_path, temporary)
    temporary.replace(target_path)
    return True, target_path.stat().st_size


def _sync_local(
    source: SyncSource,
    manifest_path: Path,
    input_root: Path | None,
    output_root: Path,
    cache_root: Path,
) -> SyncedSource:
    source_path = _local_source_path(manifest_path, input_root, source.location)
    content_type = _resolved_content_type(source)
    payload = source_path.read_bytes()
    if len(payload) > source.max_bytes:
        raise ValueError(f"Local source {source.id} exceeds {source.max_bytes} bytes.")
    _validate_payload(payload, content_type, source.id)
    checksum = _sha256_bytes(payload)
    if source.sha256 is not None and checksum.lower() != source.sha256.lower():
        raise ValueError(f"Checksum mismatch for local source {source.id}.")

    suffix = Path(source.target).suffix.lower()
    cache_path = cache_root / f"local-{checksum}{suffix}"
    cache_hit = cache_path.is_file()
    if not cache_hit:
        _write_atomic(cache_path, payload)
    target_path = _safe_relative_target(output_root, source.target)
    materialized, size = _materialize(cache_path, target_path, checksum)
    return SyncedSource(
        id=source.id,
        location=source.location,
        target=source.target,
        status="local" if materialized else "unchanged",
        sha256=checksum,
        bytes=size,
        cache_hit=cache_hit,
        materialized=materialized,
    )


def _sync_remote(
    source: SyncSource,
    output_root: Path,
    cache_root: Path,
    *,
    force_refresh: bool,
    offline: bool,
    timeout_seconds: float,
) -> SyncedSource:
    _validate_remote_url(source.location)
    content_type = _resolved_content_type(source)
    cache_path, metadata_path = _cache_paths(cache_root, source.location, source.target)
    cached_metadata = _load_cached_metadata(metadata_path)
    cached_valid = (
        cache_path.is_file()
        and cached_metadata is not None
        and cached_metadata.location == source.location
        and _sha256_file(cache_path) == cached_metadata.sha256
    )

    status: SyncStatus
    warning: str | None = None
    metadata = cached_metadata

    if offline:
        if not cached_valid or metadata is None:
            raise FileNotFoundError(
                f"No cached payload is available for remote source {source.id}."
            )
        status = "cache-fallback"
    else:
        headers = {
            "Accept": "text/html,application/xhtml+xml,application/pdf,text/plain,text/markdown,application/octet-stream;q=0.8",
            "User-Agent": "MiniMed-Medbase/1.0 (+https://github.com/T-Damer/MiniMed)",
        }
        if cached_valid and metadata is not None and not force_refresh:
            if metadata.etag:
                headers["If-None-Match"] = metadata.etag
            if metadata.last_modified:
                headers["If-Modified-Since"] = metadata.last_modified
        request = urllib.request.Request(source.location, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                payload = _read_limited(response, source.max_bytes)
                _validate_payload(payload, content_type, source.id)
                checksum = _sha256_bytes(payload)
                if source.sha256 is not None and checksum.lower() != source.sha256.lower():
                    raise ValueError(f"Checksum mismatch for remote source {source.id}.")
                final_url = str(response.geturl())
                _validate_remote_url(final_url)
                _write_atomic(cache_path, payload)
                metadata = CachedRemoteMetadata(
                    location=source.location,
                    final_url=final_url,
                    sha256=checksum,
                    bytes=len(payload),
                    etag=response.headers.get("ETag"),
                    last_modified=response.headers.get("Last-Modified"),
                    fetched_at=_utc_now(),
                    content_type=content_type,
                )
                _write_json_atomic(metadata_path, metadata.model_dump(mode="json"))
                status = "downloaded"
        except urllib.error.HTTPError as error:
            if error.code == 304 and cached_valid and metadata is not None:
                status = "not-modified"
            elif cached_valid and metadata is not None:
                status = "cache-fallback"
                warning = f"HTTP {error.code}; reused the last validated cache entry."
            else:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if cached_valid and metadata is not None:
                status = "cache-fallback"
                warning = f"Remote refresh failed; reused cache: {error}"
            else:
                raise

    if metadata is None or not cache_path.is_file():
        raise RuntimeError(f"Remote source {source.id} did not produce a validated cache entry.")
    if source.sha256 is not None and metadata.sha256.lower() != source.sha256.lower():
        raise ValueError(f"Checksum mismatch for cached source {source.id}.")

    target_path = _safe_relative_target(output_root, source.target)
    materialized, size = _materialize(cache_path, target_path, metadata.sha256)
    return SyncedSource(
        id=source.id,
        location=source.location,
        target=source.target,
        status=status if materialized or status != "downloaded" else "unchanged",
        sha256=metadata.sha256,
        bytes=size,
        cache_hit=status in {"not-modified", "cache-fallback"},
        materialized=materialized,
        etag=metadata.etag,
        last_modified=metadata.last_modified,
        final_url=metadata.final_url,
        warning=warning,
    )


def sync_source_manifest(
    manifest_path: Path,
    output_root: Path,
    cache_root: Path,
    *,
    input_root: Path | None = None,
    force_refresh: bool = False,
    offline: bool = False,
    timeout_seconds: float = 60.0,
) -> SourceSyncReport:
    manifest = load_sync_manifest(manifest_path)
    output_root.mkdir(parents=True, exist_ok=True)
    cache_root.mkdir(parents=True, exist_ok=True)

    synced: list[SyncedSource] = []
    for source in manifest.sources:
        if _is_remote(source.location):
            result = _sync_remote(
                source,
                output_root,
                cache_root,
                force_refresh=force_refresh,
                offline=offline,
                timeout_seconds=timeout_seconds,
            )
        else:
            result = _sync_local(source, manifest_path, input_root, output_root, cache_root)
        synced.append(result)

    return SourceSyncReport(
        manifest_version=manifest.version,
        generated_at=_utc_now(),
        force_refresh=force_refresh,
        offline=offline,
        downloaded=sum(item.status == "downloaded" for item in synced),
        cache_hits=sum(item.cache_hit for item in synced),
        unchanged=sum(item.status in {"not-modified", "unchanged"} for item in synced),
        materialized=sum(item.materialized for item in synced),
        sources=synced,
    )
