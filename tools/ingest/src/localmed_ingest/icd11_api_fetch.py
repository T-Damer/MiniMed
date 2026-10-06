"""Cache the Russian text of every ICD-11 MMS entity from WHO's local ICD-API container.

WHO's public Russian tabulation has titles, hierarchy and coding notes only. The entity text
(definition, inclusions, exclusions, index terms, fully specified name) is served by the ICD-API,
which WHO also ships as a local Docker image (`whoicd/icd-api`, started with `acceptLicense=true`,
`include=<release>_ru`). This module asks that container for every linearization entity the
tabulation lists and stores the raw JSON bytes exactly as served, in one zip archive, together
with a SHA-256 manifest (release, image digest, API version, language, per-entity checksums).

Only a loopback base URL is accepted: the module must never send a request to WHO's cloud API. No
text is translated or filled in here; an entity the container does not serve is recorded as missing.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .icd11_fetch import MANIFEST_NAME as RAW_MANIFEST_NAME
from .icd11_fetch import TABULATION_NAME

API_DIRECTORY = "api"
API_ARCHIVE_NAME = "mms-ru.zip"
API_MANIFEST_NAME = "MANIFEST.json"
API_LANGUAGE = "ru"
API_VERSION_HEADER = "v2"
_RELEASE = re.compile(r"\d{4}-\d{2}")
_LOOPBACK = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})
_TABULATION_MEMBER = "SimpleTabulation-ICD-11-MMS-ru.txt"
_LINEARIZATION = re.compile(r"\thttp://id\.who\.int/icd/release/11/mms/([^\t]+)\t")
_MAX_BODY_BYTES = 8 * 1024 * 1024


def entry_name(entity_id: str) -> str:
    """Archive member of an entity (`1435254666/other` -> `1435254666~other.json`)."""
    return entity_id.replace("/", "~") + ".json"


def entity_url(base_url: str, release: str, entity_id: str) -> str:
    return f"{base_url.rstrip('/')}/icd/release/11/{release}/mms/{entity_id}"


def entity_uri(release: str, entity_id: str) -> str:
    return f"http://id.who.int/icd/release/11/{release}/mms/{entity_id}"


def require_loopback(base_url: str) -> None:
    parsed = urlsplit(base_url)
    if parsed.scheme != "http" or (parsed.hostname or "") not in _LOOPBACK:
        raise ValueError("The ICD-API base URL must be a loopback http URL (local container only)")


def tabulation_entity_ids(raw_root: Path) -> list[str]:
    with zipfile.ZipFile(raw_root / TABULATION_NAME) as bundle:
        text = bundle.read(_TABULATION_MEMBER).decode("utf-8-sig")
    ids = _LINEARIZATION.findall(text)
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("The tabulation lists no, or repeated, linearization entities")
    return ids


@dataclass
class ApiFetchReport:
    release: str
    requested: int = 0
    stored: int = 0
    reused: int = 0
    missing: dict[str, int] = field(default_factory=dict)
    archive_sha256: str = ""
    archive_bytes: int = 0


def _request(url: str) -> tuple[int, bytes, str | None]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Language": API_LANGUAGE,
            "API-Version": API_VERSION_HEADER,
            "User-Agent": "MiniMed-ingest/0.3",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read(_MAX_BODY_BYTES + 1)
            return int(response.status), body, response.headers.get("API-Version")
    except urllib.error.HTTPError as error:
        return int(error.code), b"", None


def fetch_icd11_api(
    raw_root: Path,
    *,
    release: str,
    base_url: str,
    container_image: str,
    data_release: str,
    concurrency: int = 4,
) -> ApiFetchReport:
    """Fetch every tabulation entity from the local container; resume from an existing archive."""
    if not _RELEASE.fullmatch(release):
        raise ValueError("Release looks like 2026-01")
    require_loopback(base_url)
    if not 1 <= concurrency <= 8:
        raise ValueError("Concurrency stays between 1 and 8 (polite local use)")
    raw_manifest = json.loads((raw_root / RAW_MANIFEST_NAME).read_text(encoding="utf-8"))
    if raw_manifest.get("release") != release:
        raise ValueError("The raw tabulation manifest is for another release")
    ids = tabulation_entity_ids(raw_root)
    directory = raw_root / API_DIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    archive_path = directory / API_ARCHIVE_NAME
    manifest_path = directory / API_MANIFEST_NAME
    previous: dict[str, object] = {}
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries: dict[str, str] = dict(previous.get("entries", {}))  # type: ignore[arg-type]
    missing: dict[str, int] = {
        str(key): int(value)
        for key, value in dict(previous.get("missing", {})).items()  # type: ignore[arg-type]
    }
    report = ApiFetchReport(release=release, requested=len(ids))
    lock = threading.Lock()
    api_versions: set[str] = {str(item) for item in previous.get("apiVersions", [])}  # type: ignore[union-attr]

    def pending() -> list[str]:
        return [item for item in ids if item not in entries and item not in missing]

    todo = pending()
    report.reused = len(ids) - len(todo)
    mode = "a" if archive_path.exists() else "w"
    with zipfile.ZipFile(archive_path, mode, compression=zipfile.ZIP_DEFLATED) as archive:
        stored_names = set(archive.namelist())

        def work(entity_id: str) -> None:
            status, body, api_version = _request(entity_url(base_url, release, entity_id))
            if status == 200:
                if len(body) > _MAX_BODY_BYTES:
                    raise ValueError(f"{entity_id}: response is larger than {_MAX_BODY_BYTES}")
                payload = json.loads(body)
                if payload.get("@id") != entity_uri(release, entity_id):
                    raise ValueError(f"{entity_id}: the container answered for another entity")
                name = entry_name(entity_id)
                with lock:
                    if name not in stored_names:
                        archive.writestr(name, body)
                        stored_names.add(name)
                    entries[entity_id] = hashlib.sha256(body).hexdigest()
                    if api_version:
                        api_versions.add(api_version)
                    report.stored += 1
            elif status in (400, 404):
                with lock:
                    missing[entity_id] = status
            else:
                raise ValueError(f"{entity_id}: unexpected HTTP status {status}")

        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            list(pool.map(work, todo))
    report.missing = dict(missing)
    digest = hashlib.sha256(archive_path.read_bytes())
    report.archive_sha256 = digest.hexdigest()
    report.archive_bytes = archive_path.stat().st_size
    manifest: dict[str, object] = {
        "release": release,
        "source": "WHO ICD-API v2 served by the local container (loopback only)",
        "containerImage": container_image,
        "dataRelease": data_release,
        "acceptLanguage": API_LANGUAGE,
        "apiVersions": sorted(api_versions),
        "licence": "CC BY-ND 3.0 IGO (https://icd.who.int/en/docs/icd11-license.pdf)",
        "fetchedAt": previous.get("fetchedAt") or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "archive": {
            "name": API_ARCHIVE_NAME,
            "sha256": report.archive_sha256,
            "sizeBytes": report.archive_bytes,
        },
        "entityCount": len(ids),
        "stored": len(entries),
        "missing": dict(sorted(missing.items())),
        "entries": dict(sorted(entries.items())),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    return report
