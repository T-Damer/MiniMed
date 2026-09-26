"""Build the source-linked dictionary edition; never uploads models, releases or owner sources.

`--publication-state local-dev` (default) writes the DEV edition and its ignored local descriptor.
`experimental-preview` writes a publishable draft edition plus a catalog entry for the release
owner to upload; the app offers it only while experimental modules are enabled.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

from localmed_ingest.definition_name_completions import read_completion_manifest
from localmed_ingest.definition_name_inventory import read_name_manifest
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
    parser.add_argument("--supplied-root", type=Path)
    parser.add_argument("--supplied-manifest", type=Path)
    parser.add_argument(
        "--publication-state",
        choices=("local-dev", "experimental-preview"),
        default="local-dev",
    )
    parser.add_argument(
        "--artifact-url",
        help="Final download URL of the .db.gz (required for experimental-preview).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Destination for experimental-preview output (default data/build/definition-reference/<version>).",
    )
    args = parser.parse_args()
    experimental = args.publication_state == "experimental-preview"
    if experimental and not args.artifact_url:
        parser.error("experimental-preview needs --artifact-url of the uploaded .db.gz")
    if not experimental and (args.artifact_url or args.output_dir):
        parser.error("--artifact-url/--output-dir apply only to experimental-preview")
    if (args.supplied_root is None) != (args.supplied_manifest is None):
        parser.error("Supply both --supplied-root and --supplied-manifest")
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", args.version):
        parser.error("Use a lowercase version separated by dots or hyphens.")
    root = Path(__file__).resolve().parent.parent
    source_manifest = root / "content/definition-drafts/source-inputs.json"
    inputs, expected_entries = read_source_manifest(root, source_manifest)
    for source_input in inputs:
        require_active_definition_source(obj(json.loads(source_input.read_bytes())))
    destination = (
        (args.output_dir or root / "data/build/definition-reference" / args.version)
        if experimental
        else root / "apps/app/public/content/definition-reference"
    )
    file_name = f"minimed.definition.reference.{args.version}.db"
    if experimental and not str(args.artifact_url).startswith("https://"):
        parser.error("--artifact-url must be an https URL")
    if experimental and not str(args.artifact_url).endswith("/" + file_name + ".gz"):
        parser.error(f"--artifact-url must end with /{file_name}.gz")
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
        discovery_inputs=read_name_manifest(root),
        completion_inputs=read_completion_manifest(root),
        supplied_root=args.supplied_root,
        supplied_manifest=args.supplied_manifest,
        publication_state=args.publication_state,
    )
    if args.scope == "definitions":
        selection = obj(report["selection"])
        if number(selection["sourceRecordsBefore"]) != expected_entries:
            raise ValueError(
                "Definition scope differs from the complete source manifest"
            )
        expected_entries = number(selection["definitionRecordsAfter"])
    supplied = obj(report["suppliedSources"])
    supplied_counts: dict[str, int] = {}
    for key in ("entries", "definitions", "abbreviations", "otherReferences"):
        value = supplied[key]
        if type(value) is not int or value < 0:
            raise ValueError("Invalid supplied-source count")
        supplied_counts[key] = value
    if supplied_counts["entries"] != sum(
        supplied_counts[key]
        for key in ("definitions", "abbreviations", "otherReferences")
    ):
        raise ValueError("Supplied source counters disagree")
    definition_entries = (
        expected_entries
        + supplied_counts["definitions" if args.scope == "definitions" else "entries"]
    )
    expected_entries += supplied_counts["entries"]
    raw_names = report.get("discoveredNames", 0)
    discovered_names = 0 if raw_names == 0 else number(raw_names)
    raw_completed = report.get("completedNames", 0)
    completed_names = 0 if raw_completed == 0 else number(raw_completed)
    if completed_names > discovered_names:
        raise ValueError("Completion count exceeds discovered names")
    if args.scope == "definitions":
        definition_entries += completed_names
    pending_names = discovered_names - completed_names
    expected_entries += discovered_names
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
            definition_entries, definitions_only=args.scope == "definitions"
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
        "tags": ["definitions", "requires-review"]
        + (["experimental"] if experimental else []),
        "compatibility": {
            # Readers before 0.6.41 accept only local-dev reference manifests.
            "minAppVersion": "0.6.41" if experimental else "0.6.39",
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
                "url": args.artifact_url if experimental else None,
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
    if pending_names:
        module["description"] = str(
            module["description"]
        ) + f" Названий для дополнения: {pending_names:,}.".replace(",", " ")
    if supplied_counts["entries"]:
        module["description"] = str(module["description"]) + (
            f" Дополнительных справочных записей: {supplied_counts['otherReferences']};"
            f" расшифровок сокращений: {supplied_counts['abbreviations']}."
        )
    if experimental:
        # A catalog entry for the ordinary module catalog; the release owner uploads the archive.
        descriptor = destination / (file_name + ".catalog-entry.json")
        descriptor.write_text(json.dumps(module, ensure_ascii=False, indent=2) + "\n")
    else:
        descriptor = (
            root
            / "apps/app/src/features/modules/catalog.definition-reference.local.json"
        )
        descriptor.parent.mkdir(parents=True, exist_ok=True)
        descriptor.write_text(
            json.dumps(
                {"module": module, "fileName": archive.name},
                ensure_ascii=False,
                indent=2,
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
                "publicationState": args.publication_state,
                "archive": str(archive),
                "archiveSha256": sha256(archive),
                "catalogEntry": str(descriptor),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
