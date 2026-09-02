from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import AbstractContextManager
from email.message import Message
from pathlib import Path
from typing import Literal, Protocol, cast
from zipfile import ZIP_STORED, ZipFile, ZipInfo

from pydantic import Field

from .allmed_reference import (
    _relative_image_reference,  # pyright: ignore[reportPrivateUsage]
    _validate_schema,  # pyright: ignore[reportPrivateUsage]
)
from .builder import build_content_pack
from .edition_manifest import sha256_file
from .models import CamelModel

ALLMED_BASE_URL = "https://allmed.pro/"
ALLMED_SOURCE_URL = "https://allmed.pro"
IMAGE_PACK_ID = "minimed.medications.packaging-images.ru"
IMAGE_PACK_TITLE = "Фото упаковок препаратов"
IMAGE_PACK_BUILT_AT = "2026-09-01T00:00:00Z"
_CHECKPOINT_FILENAME = "download-checkpoint.json"
_MANIFEST_FILENAME = "manifest.json"
_ZIP_FILENAME = "source-assets.zip"
_INDEX_FILENAME = "index.db"
_EDITION_FILENAME = "edition-manifest.json"
_CATALOG_FILENAME = "catalog-fragment.json"
_BUILD_REPORT_FILENAME = "index-build-report.json"
_CACHE_DIRNAME = "cache"
_INDEX_WORKSPACE_DIRNAME = "index-authoring"
_CHUNK_SIZE = 1024 * 1024
_IMAGE_DOCUMENT_ID = "medications.packaging-images"
_MIN_APP_VERSION = "0.6.0"
_CORE_CATALOG_VERSION = "1"
_TRANSIENT_HTTP_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})
_IMAGE_CONTENT_TYPES: dict[str, frozenset[str]] = {
    ".bmp": frozenset({"image/bmp", "image/x-ms-bmp"}),
    ".gif": frozenset({"image/gif"}),
    ".jpeg": frozenset({"image/jpeg", "image/pjpeg"}),
    ".jpg": frozenset({"image/jpeg", "image/pjpeg"}),
    ".png": frozenset({"image/png"}),
    ".svg": frozenset({"image/svg+xml"}),
    ".tif": frozenset({"image/tiff"}),
    ".tiff": frozenset({"image/tiff"}),
    ".webp": frozenset({"image/webp"}),
}


class ImageResponse(Protocol):
    status: int
    headers: Mapping[str, str]

    def read(self, amount: int = -1) -> bytes: ...


ImageResponseContext = AbstractContextManager[ImageResponse]
ImageOpener = Callable[[str, float], ImageResponseContext]


class AllmedImageRecord(CamelModel):
    sha256: str
    size: int = Field(ge=1)
    content_type: str
    source_url: str
    allmed_ids: list[int]


class AllmedImageFailure(CamelModel):
    error: str
    allmed_ids: list[int]


class AllmedImageManifest(CamelModel):
    schema_version: Literal[1] = 1
    source_url: str
    raw_database_sha256: str
    raw_database_source_url: str
    total_references: int = Field(ge=0)
    distinct_references: int = Field(ge=0)
    successful_references: int = Field(ge=0)
    total_bytes: int = Field(ge=0)
    images: dict[str, AllmedImageRecord]
    failures: dict[str, AllmedImageFailure]


class AllmedImagePackReport(CamelModel):
    input: str
    output: str
    raw_database_sha256: str
    source_url: str
    version: str
    module_id: str
    source_set_digest: str | None = None
    total_references: int = Field(ge=0)
    distinct_references: int = Field(ge=0)
    safe_references: int = Field(ge=0)
    successful_references: int = Field(ge=0)
    failed_references: int = Field(ge=0)
    duplicate_references: int = Field(ge=0)
    downloaded_bytes: int = Field(ge=0)
    elapsed_seconds: float = Field(ge=0)
    throughput_bytes_per_second: float = Field(ge=0)
    workers: int = Field(ge=1)
    resumed: bool
    complete: bool
    failures: dict[str, AllmedImageFailure]
    manifest: str
    checkpoint: str
    zip: str | None = None
    zip_sha256: str | None = None
    zip_size_bytes: int | None = None
    index: str | None = None
    index_sha256: str | None = None
    index_size_bytes: int | None = None
    edition_manifest: str | None = None
    catalog_manifest: str | None = None
    index_build_report: str | None = None


class _RawImageReferences(CamelModel):
    raw_database_sha256: str
    allmed_ids_by_reference: dict[str, list[int]]
    total_references: int
    duplicate_references: int
    invalid_references: dict[str, list[int]]


def _write_json_atomic(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(encoded)
    temporary.replace(path)


def _image_extension(reference: str) -> str:
    name = reference.rsplit("/", 1)[-1].casefold()
    if name in _IMAGE_CONTENT_TYPES:
        return name
    suffix = Path(name).suffix
    if suffix in _IMAGE_CONTENT_TYPES:
        return suffix
    raise ValueError(f"Unsupported image extension: {reference}")


def _validate_content_type(reference: str, content_type: str) -> str:
    normalized = content_type.split(";", 1)[0].strip().casefold()
    if not normalized.startswith("image/"):
        raise ValueError(f"Image response has non-image Content-Type: {content_type}")
    extension = _image_extension(reference)
    if normalized not in _IMAGE_CONTENT_TYPES[extension]:
        raise ValueError(
            f"Image extension/content type mismatch for {reference}: {extension} vs {normalized}"
        )
    return normalized


def _default_opener(url: str, timeout_seconds: float) -> ImageResponseContext:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "User-Agent": "MiniMed/0.6",
        },
    )
    response = urllib.request.urlopen(request, timeout=timeout_seconds)
    return cast(ImageResponseContext, response)


def _image_url(reference: str) -> str:
    return urllib.parse.urljoin(ALLMED_BASE_URL, urllib.parse.quote(reference, safe="/-._~"))


def _read_raw_references(input_path: Path) -> _RawImageReferences:
    if not input_path.is_file():
        raise ValueError(f"Allmed input is not a file: {input_path}")
    raw_database_sha256 = sha256_file(input_path)
    try:
        connection = sqlite3.connect(f"file:{input_path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        drug_columns = _validate_schema(connection, input_path)
    except sqlite3.DatabaseError as error:
        raise ValueError(f"Allmed input is not a valid SQLite database: {input_path}") from error
    try:
        if "img" not in drug_columns:
            raise ValueError("Allmed input lacks drugs.img.")
        allmed_ids_by_reference: dict[str, list[int]] = {}
        invalid_references: dict[str, list[int]] = {}
        total_references = 0
        for row in connection.execute("SELECT id, img FROM drugs ORDER BY id"):
            raw_value = row["img"]
            if not isinstance(raw_value, str) or not raw_value.strip():
                continue
            total_references += 1
            normalized = raw_value.strip().replace("\\", "/")
            reference = _relative_image_reference(normalized)
            target = allmed_ids_by_reference if reference is not None else invalid_references
            target.setdefault(reference or normalized, []).append(int(row["id"]))
        duplicate_references = (
            total_references - len(allmed_ids_by_reference) - len(invalid_references)
        )
        return _RawImageReferences(
            raw_database_sha256=raw_database_sha256,
            allmed_ids_by_reference={
                reference: sorted(ids) for reference, ids in sorted(allmed_ids_by_reference.items())
            },
            total_references=total_references,
            duplicate_references=duplicate_references,
            invalid_references={
                reference: sorted(ids) for reference, ids in sorted(invalid_references.items())
            },
        )
    finally:
        connection.close()


def _cached_record(
    cache_root: Path,
    reference: str,
    expected: AllmedImageRecord,
) -> bool:
    path = cache_root / reference
    if not path.is_file() or path.stat().st_size != expected.size:
        return False
    try:
        return sha256_file(path) == expected.sha256
    except OSError:
        return False


def _download_image(
    reference: str,
    allmed_ids: list[int],
    cache_root: Path,
    *,
    timeout_seconds: float,
    retries: int,
    opener: ImageOpener,
) -> AllmedImageRecord:
    url = _image_url(reference)
    last_error: BaseException | None = None
    for attempt in range(retries + 1):
        temporary_name: str | None = None
        try:
            with opener(url, timeout_seconds) as response:
                if response.status != 200:
                    raise urllib.error.HTTPError(
                        url,
                        response.status,
                        f"HTTP {response.status}",
                        Message(),
                        None,
                    )
                raw_content_type = response.headers.get("Content-Type", "")
                content_type = _validate_content_type(reference, raw_content_type)
                destination = cache_root / reference
                destination.parent.mkdir(parents=True, exist_ok=True)
                file_descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f".{destination.name}.",
                    suffix=".part",
                    dir=destination.parent,
                )
                digest = hashlib.sha256()
                total = 0
                with os.fdopen(file_descriptor, "wb") as target:
                    while chunk := response.read(_CHUNK_SIZE):
                        target.write(chunk)
                        digest.update(chunk)
                        total += len(chunk)
                if total == 0:
                    raise ValueError(f"Image response is empty: {reference}")
                os.replace(temporary_name, destination)
                temporary_name = None
                return AllmedImageRecord(
                    sha256=f"sha256:{digest.hexdigest()}",
                    size=total,
                    content_type=content_type,
                    source_url=url,
                    allmed_ids=allmed_ids,
                )
        except BaseException as error:
            last_error = error
            if temporary_name is not None:
                Path(temporary_name).unlink(missing_ok=True)
            retryable = isinstance(error, (urllib.error.URLError, TimeoutError, OSError)) or (
                isinstance(error, urllib.error.HTTPError)
                and error.code in _TRANSIENT_HTTP_STATUS_CODES
            )
            if not retryable or attempt >= retries:
                raise
            time.sleep(0.5 * (2**attempt))
    assert last_error is not None
    raise last_error


def _checkpoint_payload(
    raw: _RawImageReferences,
    completed: Mapping[str, AllmedImageRecord],
    failures: Mapping[str, AllmedImageFailure],
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "sourceUrl": ALLMED_SOURCE_URL,
        "rawDatabaseSha256": raw.raw_database_sha256,
        "references": sorted([*raw.allmed_ids_by_reference, *raw.invalid_references]),
        "completed": {
            reference: record.model_dump(by_alias=True, mode="json")
            for reference, record in sorted(completed.items())
        },
        "failures": {
            reference: failure.model_dump(by_alias=True, mode="json")
            for reference, failure in sorted(failures.items())
        },
    }


def _load_checkpoint(
    path: Path,
    raw: _RawImageReferences,
) -> tuple[dict[str, AllmedImageRecord], dict[str, AllmedImageFailure]]:
    try:
        raw_payload: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid image download checkpoint: {path}") from error
    if not isinstance(raw_payload, dict):
        raise ValueError("Image download checkpoint must be an object.")
    payload = cast(dict[str, object], raw_payload)
    if payload.get("rawDatabaseSha256") != raw.raw_database_sha256:
        raise ValueError("Image download checkpoint belongs to a different Allmed snapshot.")
    if payload.get("sourceUrl") != ALLMED_SOURCE_URL:
        raise ValueError("Image download checkpoint belongs to a different source URL.")
    expected_references = sorted([*raw.allmed_ids_by_reference, *raw.invalid_references])
    if payload.get("references") != expected_references:
        raise ValueError("Image download checkpoint references do not match the Allmed snapshot.")
    raw_completed: object = payload.get("completed", {})
    raw_failures: object = payload.get("failures", {})
    if not isinstance(raw_completed, dict) or not isinstance(raw_failures, dict):
        raise ValueError("Image download checkpoint has invalid result maps.")
    completed: dict[str, AllmedImageRecord] = {}
    for raw_reference, raw_record in cast(dict[object, object], raw_completed).items():
        if not isinstance(raw_reference, str) or not raw_reference:
            raise ValueError("Image download checkpoint has an invalid completed reference.")
        completed[raw_reference] = AllmedImageRecord.model_validate(raw_record)
    failures: dict[str, AllmedImageFailure] = {}
    for raw_reference, raw_failure in cast(dict[object, object], raw_failures).items():
        if not isinstance(raw_reference, str) or not raw_reference:
            raise ValueError("Image download checkpoint has an invalid failure reference.")
        failures[raw_reference] = AllmedImageFailure.model_validate(raw_failure)
    return completed, failures


def _manifest(
    raw: _RawImageReferences,
    completed: Mapping[str, AllmedImageRecord],
    failures: Mapping[str, AllmedImageFailure],
) -> AllmedImageManifest:
    return AllmedImageManifest(
        source_url=ALLMED_SOURCE_URL,
        raw_database_sha256=raw.raw_database_sha256,
        raw_database_source_url=ALLMED_SOURCE_URL,
        total_references=raw.total_references,
        distinct_references=len(raw.allmed_ids_by_reference) + len(raw.invalid_references),
        successful_references=len(completed),
        total_bytes=sum(record.size for record in completed.values()),
        images=dict(sorted(completed.items())),
        failures=dict(sorted(failures.items())),
    )


def _source_set_digest(
    *,
    document_id: str,
    document_version_id: str,
    source_checksum: str,
) -> str:
    payload = [
        {
            "documentId": document_id,
            "documentVersionId": document_version_id,
            "sourceChecksum": source_checksum,
        }
    ]
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _fixed_zip_info(name: str) -> ZipInfo:
    info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_STORED
    info.create_system = 3
    info.external_attr = 0o644 << 16
    return info


def _build_zip(
    output: Path,
    manifest_bytes: bytes,
    references: list[str],
    cache_root: Path,
) -> None:
    temporary = output.with_name(f".{output.name}.tmp-{os.getpid()}")
    with ZipFile(temporary, "w", compression=ZIP_STORED, allowZip64=True) as archive:
        archive.writestr(_fixed_zip_info(_MANIFEST_FILENAME), manifest_bytes)
        for reference in references:
            info = _fixed_zip_info(reference)
            with (
                archive.open(info, "w") as destination,
                (cache_root / reference).open("rb") as source,
            ):
                shutil.copyfileobj(source, destination, length=_CHUNK_SIZE)
    temporary.replace(output)


def _write_index_workspace(
    workspace: Path,
    *,
    manifest_digest: str,
    raw_database_sha256: str,
    version: str,
    image_count: int,
    image_bytes: int,
    failure_count: int,
) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "manifest.yaml").write_text(
        "\n".join(
            [
                f"id: {IMAGE_PACK_ID}",
                f"version: {version}",
                "schemaVersion: 2",
                f"title: {IMAGE_PACK_TITLE}",
                f"builtAt: '{IMAGE_PACK_BUILT_AT}'",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (workspace / "aliases.yaml").write_text(
        "aliases:\n"
        "  - id: alias.packaging-images.title\n"
        f"    canonicalTerm: {IMAGE_PACK_TITLE}\n"
        "    alias: упаковка препарата\n"
        "    category: medication\n"
        "    weight: 1.0\n",
        encoding="utf-8",
    )
    metadata = {
        "contentMode": "packaging-images",
        "sourceManifest": _MANIFEST_FILENAME,
        "sourceManifestSha256": manifest_digest,
        "rawDatabaseSha256": raw_database_sha256,
        "sourceUrl": ALLMED_SOURCE_URL,
        "imageCount": image_count,
        "imageBytes": image_bytes,
        "failureCount": failure_count,
        "sourceAssetsArtifact": _ZIP_FILENAME,
    }
    document = [
        "---",
        "id: medications.packaging-images",
        f"title: {IMAGE_PACK_TITLE}",
        "short_title: Фото упаковок",
        f"version_label: {version}",
        "source_type: medication_packaging_images",
        "status: active",
        f"source_file: {ALLMED_SOURCE_URL}",
        f"source_checksum: {manifest_digest}",
        "metadata:",
        f"  contentMode: {metadata['contentMode']}",
        f"  sourceManifest: {metadata['sourceManifest']}",
        f"  sourceManifestSha256: {manifest_digest}",
        f"  rawDatabaseSha256: {raw_database_sha256}",
        f"  sourceUrl: {ALLMED_SOURCE_URL}",
        f"  imageCount: {image_count}",
        f"  imageBytes: {image_bytes}",
        f"  failureCount: {failure_count}",
        f"  sourceAssetsArtifact: {_ZIP_FILENAME}",
        "---",
        "",
        "# Фото упаковок препаратов",
        "",
        f"Индекс содержит {image_count} изображений упаковок из снимка Allmed. "
        "Файлы изображений поставляются отдельным source-assets архивом.",
        "",
        f"Не загружено ссылок источника: {failure_count}.",
        "",
        f"Источник: {ALLMED_SOURCE_URL}",
        "",
    ]
    (workspace / "medications.packaging-images.md").write_text(
        "\n".join(document), encoding="utf-8"
    )


def _write_catalog_fragment(
    output: Path,
    *,
    version: str,
    medications_version: str,
    source_checksum: str,
    source_set_digest: str,
    index_path: Path,
    zip_path: Path,
    image_count: int,
    image_bytes: int,
    failure_count: int,
) -> Path:
    index_artifact_id = f"{IMAGE_PACK_ID}-index-{version}"
    source_asset_artifact_id = f"{IMAGE_PACK_ID}-source-assets-{version}"
    module = {
        "id": IMAGE_PACK_ID,
        "version": version,
        "kind": "medication",
        "collection": "shared",
        "title": IMAGE_PACK_TITLE,
        "description": (
            "Экспериментальный отдельный пакет фотографий упаковок препаратов Allmed. "
            f"Успешно загружено: {image_count}; ошибок источника: {failure_count}."
        ),
        "required": False,
        "releaseState": "preview",
        "specialties": [],
        "populations": ["all"],
        "tags": ["experimental", "packaging-images", "allmed"],
        "compatibility": {
            "minAppVersion": _MIN_APP_VERSION,
            "maxAppVersion": None,
            "schemaVersion": 2,
            "coreCatalogVersion": _CORE_CATALOG_VERSION,
        },
        "sourceSetDigest": source_set_digest,
        "dependencies": [
            {
                "moduleId": "minimed.core.ru",
                "versionRange": "^1.0.0",
                "required": True,
            },
            {
                "moduleId": "minimed.medications.ru",
                "versionRange": medications_version,
                "required": True,
            },
        ],
        "sizes": {
            "downloadBytes": index_path.stat().st_size + zip_path.stat().st_size,
            "installedBytes": index_path.stat().st_size + zip_path.stat().st_size,
            "sourceAssetsDownloadBytes": zip_path.stat().st_size,
            "precision": "exact",
        },
        "capabilities": {
            "search": True,
            "fullText": True,
            "structuredTables": False,
            "images": True,
            "originalPdf": False,
            "structuredKnowledge": False,
            "calculations": False,
        },
        "artifacts": [
            {
                "id": index_artifact_id,
                "kind": "index",
                "required": True,
                "url": None,
                "sha256": sha256_file(index_path),
                "sizeBytes": index_path.stat().st_size,
                "compression": "none",
                "sourceSetDigest": source_set_digest,
            },
            {
                "id": source_asset_artifact_id,
                "kind": "source-assets",
                "required": True,
                "url": None,
                "sha256": sha256_file(zip_path),
                "sizeBytes": zip_path.stat().st_size,
                "compression": "zip",
                "sourceSetDigest": source_set_digest,
            },
        ],
        "documents": [
            {
                "documentId": _IMAGE_DOCUMENT_ID,
                "documentVersionId": f"{_IMAGE_DOCUMENT_ID}@{version}",
                "sourceChecksum": source_checksum,
                "status": "active",
                "indexArtifactId": index_artifact_id,
                "sourceAssetArtifactId": source_asset_artifact_id,
                "title": IMAGE_PACK_TITLE,
            }
        ],
        "previewDocumentCount": 1,
    }
    path = output / _CATALOG_FILENAME
    _write_json_atomic(
        path,
        {
            "schemaVersion": 1,
            "catalogVersion": _CORE_CATALOG_VERSION,
            "channel": "preview",
            "publishedAt": IMAGE_PACK_BUILT_AT,
            "categories": [],
            "modules": [module],
        },
    )
    return path


def build_allmed_image_pack(
    input_path: Path,
    output: Path,
    *,
    workers: int = 16,
    retries: int = 3,
    timeout_seconds: float = 30.0,
    resume: bool = False,
    opener: ImageOpener | None = None,
) -> AllmedImagePackReport:
    """Download Allmed packaging images and build a deterministic index/ZIP pair."""
    if workers < 1 or workers > 64:
        raise ValueError("workers must be between 1 and 64.")
    if retries < 0 or retries > 8:
        raise ValueError("retries must be between 0 and 8.")
    if timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive.")
    raw = _read_raw_references(input_path)
    output.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output / _CHECKPOINT_FILENAME
    if checkpoint_path.exists() and not resume:
        raise FileExistsError(f"Image output already contains a checkpoint: {checkpoint_path}")
    completed: dict[str, AllmedImageRecord] = {}
    failures: dict[str, AllmedImageFailure] = {}
    if resume and checkpoint_path.exists():
        completed, failures = _load_checkpoint(checkpoint_path, raw)

    cache_root = output / _CACHE_DIRNAME
    for reference, record in list(completed.items()):
        expected_ids = raw.allmed_ids_by_reference.get(reference)
        if (
            expected_ids is None
            or record.allmed_ids != expected_ids
            or record.source_url != _image_url(reference)
            or not _cached_record(cache_root, reference, record)
        ):
            completed.pop(reference)
    failures = {
        reference: failure
        for reference, failure in failures.items()
        if reference in raw.allmed_ids_by_reference or reference in raw.invalid_references
    }
    for reference, ids in raw.invalid_references.items():
        failures[reference] = AllmedImageFailure(
            error="Invalid relative image reference.",
            allmed_ids=ids,
        )
    for reference in raw.allmed_ids_by_reference:
        failures.pop(reference, None)

    fetch = opener or _default_opener
    pending = [reference for reference in raw.allmed_ids_by_reference if reference not in completed]
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                _download_image,
                reference,
                raw.allmed_ids_by_reference[reference],
                cache_root,
                timeout_seconds=timeout_seconds,
                retries=retries,
                opener=fetch,
            ): reference
            for reference in pending
        }
        for future in as_completed(futures):
            reference = futures[future]
            try:
                completed[reference] = future.result()
                failures.pop(reference, None)
            except Exception as error:
                failures[reference] = AllmedImageFailure(
                    error=f"{type(error).__name__}: {error}",
                    allmed_ids=raw.allmed_ids_by_reference[reference],
                )
            _write_json_atomic(
                checkpoint_path,
                _checkpoint_payload(raw, completed, failures),
            )
    elapsed_seconds = max(time.perf_counter() - started, 0.0)

    image_manifest = _manifest(raw, completed, failures)
    manifest_path = output / _MANIFEST_FILENAME
    _write_json_atomic(manifest_path, image_manifest.model_dump(by_alias=True, mode="json"))
    manifest_digest = sha256_file(manifest_path)
    downloaded_bytes = image_manifest.total_bytes
    complete = not failures and len(completed) == len(raw.allmed_ids_by_reference)
    if not completed:
        return AllmedImagePackReport(
            input=str(input_path),
            output=str(output),
            raw_database_sha256=raw.raw_database_sha256,
            source_url=ALLMED_SOURCE_URL,
            version=f"allmed-images-{raw.raw_database_sha256.removeprefix('sha256:')[:12]}",
            module_id=IMAGE_PACK_ID,
            total_references=raw.total_references,
            distinct_references=image_manifest.distinct_references,
            safe_references=len(raw.allmed_ids_by_reference),
            successful_references=len(completed),
            failed_references=len(failures),
            duplicate_references=raw.duplicate_references,
            downloaded_bytes=downloaded_bytes,
            elapsed_seconds=elapsed_seconds,
            throughput_bytes_per_second=(
                downloaded_bytes / elapsed_seconds if elapsed_seconds else 0
            ),
            workers=workers,
            resumed=resume,
            complete=False,
            failures=failures,
            manifest=str(manifest_path),
            checkpoint=str(checkpoint_path),
        )

    version = f"allmed-images-{raw.raw_database_sha256.removeprefix('sha256:')[:12]}"
    manifest_bytes = manifest_path.read_bytes()
    document_version_id = f"{_IMAGE_DOCUMENT_ID}@{version}"
    source_set_digest = _source_set_digest(
        document_id=_IMAGE_DOCUMENT_ID,
        document_version_id=document_version_id,
        source_checksum=manifest_digest,
    )
    zip_path = output / _ZIP_FILENAME
    _build_zip(zip_path, manifest_bytes, sorted(completed), cache_root)
    index_workspace = output / _INDEX_WORKSPACE_DIRNAME
    _write_index_workspace(
        index_workspace,
        manifest_digest=manifest_digest,
        raw_database_sha256=raw.raw_database_sha256,
        version=version,
        image_count=len(completed),
        image_bytes=downloaded_bytes,
        failure_count=len(failures),
    )
    index_path = output / _INDEX_FILENAME
    edition_manifest_path = output / _EDITION_FILENAME
    build_report_path = output / _BUILD_REPORT_FILENAME
    _, _build_report = build_content_pack(
        index_workspace,
        index_path,
        report_path=build_report_path,
        edition_manifest_output=edition_manifest_path,
        include_embeddings=False,
    )
    catalog_manifest_path = _write_catalog_fragment(
        output,
        version=version,
        medications_version=f"allmed-{raw.raw_database_sha256.removeprefix('sha256:')[:12]}",
        source_checksum=manifest_digest,
        source_set_digest=source_set_digest,
        index_path=index_path,
        zip_path=zip_path,
        image_count=len(completed),
        image_bytes=downloaded_bytes,
        failure_count=len(failures),
    )
    return AllmedImagePackReport(
        input=str(input_path),
        output=str(output),
        raw_database_sha256=raw.raw_database_sha256,
        source_url=ALLMED_SOURCE_URL,
        version=version,
        module_id=IMAGE_PACK_ID,
        source_set_digest=source_set_digest,
        total_references=raw.total_references,
        distinct_references=image_manifest.distinct_references,
        safe_references=len(raw.allmed_ids_by_reference),
        successful_references=len(completed),
        failed_references=len(failures),
        duplicate_references=raw.duplicate_references,
        downloaded_bytes=downloaded_bytes,
        elapsed_seconds=elapsed_seconds,
        throughput_bytes_per_second=(downloaded_bytes / elapsed_seconds if elapsed_seconds else 0),
        workers=workers,
        resumed=resume,
        complete=complete,
        failures=failures,
        manifest=str(manifest_path),
        checkpoint=str(checkpoint_path),
        zip=str(zip_path),
        zip_sha256=sha256_file(zip_path),
        zip_size_bytes=zip_path.stat().st_size,
        index=str(index_path),
        index_sha256=sha256_file(index_path),
        index_size_bytes=index_path.stat().st_size,
        edition_manifest=str(edition_manifest_path),
        catalog_manifest=str(catalog_manifest_path),
        index_build_report=str(build_report_path),
    )
