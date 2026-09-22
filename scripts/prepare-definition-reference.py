"""Build the current source-linked DEV dictionary; no model, release or owner-source upload."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

from localmed_ingest.definition_reference_compact_pack import (
    build_compact_definition_reference,
)
from localmed_ingest.definition_reference_pack import number, obj
from localmed_ingest.definition_source_manifest import read_source_manifest
from localmed_ingest.definition_source_policy import require_active_definition_source


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def record_label(count: int, *, definitions_only: bool = False) -> str:
    if 11 <= count % 100 <= 14:
        noun = "исходных определений" if definitions_only else "исходных записей"
    elif count % 10 == 1:
        noun = "исходное определение" if definitions_only else "исходная запись"
    elif 2 <= count % 10 <= 4:
        noun = "исходных определения" if definitions_only else "исходные записи"
    else:
        noun = "исходных определений" if definitions_only else "исходных записей"
    return f"{count:,}".replace(",", " ") + " " + noun


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--built-at", required=True)
    parser.add_argument(
        "--scope", choices=("definitions", "reference"), default="definitions"
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", args.version):
        parser.error("Use a lowercase version separated by dots or hyphens.")
    root = Path(__file__).resolve().parent.parent
    source_manifest = root / "content/definition-drafts/source-inputs.json"
    inputs, expected_entries = read_source_manifest(root, source_manifest)
    for source_input in inputs:
        require_active_definition_source(obj(json.loads(source_input.read_bytes())))
    destination = root / "apps/app/public/content/definition-reference"
    file_name = f"minimed.definition.reference.{args.version}.db"
    database = destination / file_name
    archive = destination / (file_name + ".gz")
    report_path = destination / (file_name + ".report.json")
    if database.exists() or archive.exists() or report_path.exists():
        raise ValueError(
            "Use a new version or explicitly remove your obsolete DEV output first."
        )
    edition = "minimed.definition.reference." + args.version
    report = build_compact_definition_reference(
        inputs,
        database,
        input_root=root,
        edition_id=edition,
        version=args.version,
        built_at=args.built_at,
        compact_metadata=False,
        definitions_only=args.scope == "definitions",
    )
    if args.scope == "definitions":
        selection = obj(report["selection"])
        if number(selection["sourceRecordsBefore"]) != expected_entries:
            raise ValueError(
                "Definition scope differs from the complete source manifest"
            )
        expected_entries = number(selection["definitionRecordsAfter"])
    if (
        report["schemaVersion"] != 7
        or report["entries"] != expected_entries
        or report["logicalRoundTripEqual"] is not True
    ):
        raise ValueError("Reference build differs from its verified input manifest.")
    with (
        database.open("rb") as source_bytes,
        archive.open("xb") as out,
        gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as compressed,
    ):
        while block := source_bytes.read(1024 * 1024):
            compressed.write(block)
    with gzip.open(archive, "rb") as decoded:
        decoded_hash = "sha256:" + hashlib.file_digest(decoded, "sha256").hexdigest()
    checksum = sha256(database)
    if decoded_hash != checksum:
        raise ValueError("Reference transport round-trip failed.")
    receipts = json.dumps(
        report["receipts"], sort_keys=True, separators=(",", ":")
    ).encode()
    source_set = "sha256:" + hashlib.sha256(receipts).hexdigest()
    module = {
        "id": "minimed.definition.reference.ru",
        "version": args.version,
        "kind": "reference",
        "collection": "definition-reference",
        "title": "Словарь терминов, симптомов и синдромов",
        "description": record_label(
            expected_entries, definitions_only=args.scope == "definitions"
        )
        + (
            ": определения с исходными формулировками и ссылками. "
            "Предварительная редакция, требующая проверки."
            if args.scope == "definitions"
            else ": справочные записи и контекст. Предварительная редакция, требующая проверки."
        ),
        "required": False,
        "releaseState": "preview",
        "specialties": [],
        "populations": [],
        "tags": ["definitions", "requires-review"],
        "compatibility": {
            "minAppVersion": "0.6.39",
            "maxAppVersion": None,
            "schemaVersion": 7,
            "coreCatalogVersion": "1",
        },
        "sourceSetDigest": source_set,
        "dependencies": [],
        "sizes": {
            "downloadBytes": archive.stat().st_size,
            "installedBytes": database.stat().st_size,
            "sourceAssetsDownloadBytes": None,
            "precision": "exact",
        },
        "capabilities": {
            "search": True,
            "fullText": True,
            "structuredTables": False,
            "images": False,
            "originalPdf": False,
            "structuredKnowledge": False,
            "calculations": False,
        },
        "artifacts": [
            {
                "id": "reference-index",
                "kind": "index",
                "required": True,
                "url": None,
                "sha256": sha256(archive),
                "sizeBytes": archive.stat().st_size,
                "compression": "gzip",
                "decodedSha256": checksum,
                "decodedSizeBytes": database.stat().st_size,
                "sourceSetDigest": source_set,
            }
        ],
        "documents": [],
        "previewDocumentCount": report["sources"],
        "definitionReference": {
            "contract": 1,
            "editionId": edition,
            "entries": expected_entries,
        },
    }
    descriptor = (
        root / "apps/app/src/features/modules/catalog.definition-reference.local.json"
    )
    descriptor.write_text(
        json.dumps(
            {"module": module, "fileName": archive.name}, ensure_ascii=False, indent=2
        )
        + "\n"
    )
    report["scope"] = args.scope
    report["sourceManifestSha256"] = sha256(source_manifest)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "entries": expected_entries,
                "installedBytes": database.stat().st_size,
                "downloadBytes": archive.stat().st_size,
                "sqliteSha256": checksum,
                "publicationState": "local-dev",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
