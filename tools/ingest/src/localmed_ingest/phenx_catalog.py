"""Collect public PhenX metadata, never infer a runnable or Russian clinical instrument.

Run with ``python -m localmed_ingest.phenx_catalog --help``. No provider or account is used.
The database export requires a login; this adapter only reads declared public protocol pages.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE_URL = "https://www.phenxtoolkit.org/protocols/view/"
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_PROTOCOLS = 128
MAX_FIELD_CHARS = 64000
DEFAULT_PROTOCOLS = ("121704", "860801", "130501", "140601", "091301", "181102", "820401")
FIELDS = frozenset(
    {
        "Description",
        "Availability",
        "Language",
        "Lifestage",
        "Participants",
        "Protocol Name from Source",
        "Source",
        "Protocol ID",
        "Release Date",
        "Definition",
        "Keywords",
    }
)
HEADING = re.compile(r"h[1-6]")
IGNORED_TAGS = frozenset({"script", "style"})


def canonical_protocol_id(value: str) -> str:
    if re.fullmatch(r"[0-9]{5,8}", value) is None or int(value) == 0:
        raise ValueError("Expected a numeric PhenX protocol identifier, not a URL or path.")
    return str(int(value)).zfill(6)


def _text(parts: list[str]) -> str:
    return " ".join(" ".join(parts).split())


class _MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.fields: dict[str, str] = {}
        self._heading: str | None = None
        self._heading_parts: list[str] = []
        self._active: str | None = None
        self._parts: list[str] = []
        self._ignored = 0

    def _flush(self) -> None:
        value = _text(self._parts)
        active = self._active
        if active is not None and active in FIELDS and value:
            if len(value) > MAX_FIELD_CHARS:
                raise ValueError("PhenX metadata field exceeds the size limit.")
            previous = self.fields.get(active)
            if previous is not None and previous != value:
                raise ValueError("Conflicting repeated PhenX metadata heading.")
            self.fields[active] = value
        self._parts = []
        self._active = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in IGNORED_TAGS:
            self._ignored += 1
        if self._ignored:
            return
        if HEADING.fullmatch(tag):
            self._flush()
            self._heading = tag
            self._heading_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag in IGNORED_TAGS:
            self._ignored = max(0, self._ignored - 1)
            return
        if self._ignored or tag != self._heading:
            return
        heading = _text(self._heading_parts)
        if tag == "h1" and heading.startswith("Protocol - "):
            self.title = heading.removeprefix("Protocol - ").strip()
        self._active = heading if heading in FIELDS else None
        self._heading = None
        self._heading_parts = []

    def handle_data(self, data: str) -> None:
        if self._ignored:
            return
        if self._heading:
            self._heading_parts.append(data)
        elif self._active:
            self._parts.append(data)

    def finish(self) -> None:
        self.close()
        self._flush()


def prepare_protocol(protocol_id: str, raw: bytes) -> dict[str, object]:
    identity = canonical_protocol_id(protocol_id)
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("PhenX source exceeds size limit or is empty.")
    parser = _MetadataParser()
    parser.feed(raw.decode("utf-8-sig"))
    parser.finish()
    required = {"Description", "Language", "Availability", "Protocol ID"}
    if not parser.title or not required.issubset(parser.fields):
        raise ValueError("Not a complete PhenX protocol page; login/error/layout change rejected.")
    if canonical_protocol_id(parser.fields["Protocol ID"]) != identity:
        raise ValueError("PhenX protocol identity differs from the requested source.")
    return {
        "schemaVersion": 1,
        "id": f"phenx.protocol.{identity}",
        "kind": "instrument-catalog-entry",
        "title": parser.title,
        "sourceFields": parser.fields,
        "source": {
            "registry": "PhenX",
            "url": f"{BASE_URL}{int(identity)}",
            "sha256": f"sha256:{hashlib.sha256(raw).hexdigest()}",
            "bytes": len(raw),
            "snapshot": f"sources/{identity}.html",
            "locators": {field: f"heading:{field}" for field in sorted(parser.fields)},
        },
        "rights": {
            "catalogLicense": "CC-BY-4.0",
            "catalogLicenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "declarationUrl": "https://www.phenxtoolkit.org/resources/download",
            "instrumentAvailabilityText": parser.fields["Availability"],
            "instrumentRedistribution": "review-required",
        },
        "russianForm": "not-verified",
        "rfClinicalApplicability": "not-verified",
        "interactiveDefinition": None,
        "reviewStatus": "proposed",
    }


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        raise ValueError("PhenX redirect rejected; no login or external destination is followed.")


def fetch_protocol(protocol_id: str) -> bytes:
    identity = canonical_protocol_id(protocol_id)
    request = Request(
        f"{BASE_URL}{int(identity)}",
        headers={"User-Agent": "MiniMed-SourceCatalog/1.0", "Accept": "text/html"},
    )
    with build_opener(_NoRedirect()).open(request, timeout=30) as response:
        if response.status != 200 or response.headers.get_content_type() != "text/html":
            raise ValueError("Unexpected PhenX response status or content type.")
        raw = response.read(MAX_SOURCE_BYTES + 1)
    if len(raw) > MAX_SOURCE_BYTES:
        raise ValueError("PhenX download exceeds size limit.")
    return raw


def collect_catalog(
    output: Path,
    *,
    protocol_ids: tuple[str, ...] = DEFAULT_PROTOCOLS,
    network: bool = False,
    input_dir: Path | None = None,
) -> int:
    if not network and input_dir is None:
        raise ValueError("Choose explicit --network or an offline --input-dir.")
    if network and input_dir is not None:
        raise ValueError("Network and offline input are mutually exclusive.")
    if output.exists():
        raise ValueError("Output is immutable; choose a new directory.")
    ids = sorted({canonical_protocol_id(value) for value in protocol_ids})
    if not ids or len(ids) > MAX_PROTOCOLS:
        raise ValueError("Protocol batch must contain 1–128 unique identifiers.")
    records: list[dict[str, object]] = []
    sources: dict[str, bytes] = {}
    for index, identity in enumerate(ids):
        if input_dir is None:
            if index:
                time.sleep(1)
            raw = fetch_protocol(identity)
        else:
            root = input_dir.resolve(strict=True)
            path = root / f"{identity}.html"
            if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SOURCE_BYTES:
                raise ValueError("Offline source is missing, symbolic or exceeds the size limit.")
            raw = path.read_bytes()
        records.append(prepare_protocol(identity, raw))
        sources[identity] = raw
    # No partial catalog is published on retrieval or parsing failure. Output is authoring material,
    # not a runtime pack. Exclusive creation never overwrites a previous source edition.
    output.mkdir(parents=True, exist_ok=False)
    source_dir = output / "sources"
    source_dir.mkdir()
    for identity, raw in sources.items():
        (source_dir / f"{identity}.html").write_bytes(raw)
    payload = "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in records)
    (output / "catalog.jsonl").write_text(payload, encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "complete": True,
        "recordCount": len(records),
        "catalogSha256": f"sha256:{hashlib.sha256(payload.encode()).hexdigest()}",
        "sources": [record["source"] for record in records],
        "changes": "Selected metadata headings; whitespace normalized. No questionnaire imported.",
        "attribution": "PhenX Toolkit, maintained by RTI International; NIH-funded resource.",
        "sourceUrl": "https://www.phenxtoolkit.org/resources/download",
        "catalogLicense": "CC-BY-4.0",
        "instrumentRights": "Separate per-instrument and per-translation review required.",
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return len(records)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--network", action="store_true", help="Fetch declared public pages only")
    source.add_argument("--input-dir", type=Path, help="Offline directory of six-digit-ID.html files")
    parser.add_argument("--protocol", action="append", dest="protocols", help="Repeat numeric ID")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    count = collect_catalog(
        args.output,
        protocol_ids=tuple(args.protocols) if args.protocols else DEFAULT_PROTOCOLS,
        network=args.network,
        input_dir=args.input_dir,
    )
    print(f"Prepared {count} source-catalog records; no clinical forms activated.")


if __name__ == "__main__":
    main()
