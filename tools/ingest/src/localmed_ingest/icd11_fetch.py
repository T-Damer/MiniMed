"""Fetch the public WHO ICD-11 MMS Russian tabulation and the ICD-10/ICD-11 mapping tables.

Both files are public downloads on icd.who.int (linked from the Russian browser page); no account,
API client or licence click-through is involved. The manifest records the exact URLs, SHA-256 sums
and the CDN's own `Content-MD5` / `Last-Modified`, so the preparer can refuse bytes that differ from
what was reviewed.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

CDN_BASE_URL = "https://icdcdn.who.int/static/releasefiles"
MANIFEST_NAME = "MANIFEST.json"
TABULATION_NAME = "SimpleTabulation-ICD-11-MMS-ru.zip"
MAPPING_NAME = "mapping.zip"
_RELEASE = re.compile(r"\d{4}-\d{2}")
_MAX_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class Icd11Download:
    name: str
    url: str
    sha256: str
    size_bytes: int
    content_md5: str | None
    last_modified: str | None


def release_file_url(release: str, name: str) -> str:
    if not _RELEASE.fullmatch(release):
        raise ValueError("Release looks like 2026-01")
    return f"{CDN_BASE_URL}/{release}/{name}"


def _download(url: str) -> tuple[bytes, str | None, str | None]:
    request = urllib.request.Request(url, headers={"User-Agent": "MiniMed-ingest/0.3"})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read(_MAX_BYTES + 1)
        md5 = response.headers.get("Content-MD5")
        modified = response.headers.get("Last-Modified")
    if len(payload) > _MAX_BYTES:
        raise ValueError(f"{url} is larger than {_MAX_BYTES} bytes")
    return payload, md5, modified


def fetch_icd11_release(release: str, output: Path) -> dict[str, object]:
    """Download both files, verify the CDN checksum and write the manifest next to them."""
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / MANIFEST_NAME
    previous: dict[str, object] = {}
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
    downloads: list[Icd11Download] = []
    for name in (TABULATION_NAME, MAPPING_NAME):
        url = release_file_url(release, name)
        payload, md5, modified = _download(url)
        sha256 = hashlib.sha256(payload).hexdigest()
        if md5 is not None and base64.b64decode(md5) != hashlib.md5(payload).digest():
            raise ValueError(f"{name}: Content-MD5 from the CDN does not match the download")
        recorded = previous.get("files")
        if isinstance(recorded, list):
            for item in recorded:
                if isinstance(item, dict) and item.get("name") == name and item["sha256"] != sha256:
                    raise ValueError(
                        f"{name}: the CDN now serves different bytes than the reviewed copy"
                    )
        target = output / name
        temporary = target.with_suffix(target.suffix + ".part")
        temporary.write_bytes(payload)
        temporary.replace(target)
        downloads.append(Icd11Download(name, url, sha256, len(payload), md5, modified))
    manifest: dict[str, object] = {
        "release": release,
        "source": "WHO ICD-11 MMS linearization downloads, https://icd.who.int/browse/latest-release/mms/ru",
        "licence": "CC BY-ND 3.0 IGO (https://icd.who.int/en/docs/icd11-license.pdf)",
        "fetchedAt": previous.get("fetchedAt") or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": [
            {
                "name": item.name,
                "url": item.url,
                "sha256": item.sha256,
                "sizeBytes": item.size_bytes,
                "contentMd5": item.content_md5,
                "lastModified": item.last_modified,
            }
            for item in downloads
        ],
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest
