"""Refresh the DEV dictionary manifest after a new encyclopedic source collection."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from localmed_ingest.definition_reference_pack import normalized_name, obj, seq, text
from localmed_ingest.definition_source_manifest import (
    describe_input,
    write_source_manifest,
)


def checked_parts(directory: Path, manifest: dict[str, object]) -> list[Path]:
    result: list[Path] = []
    for value in seq(manifest.get("parts"), 32):
        part = obj(value)
        path = (directory / text(part.get("path"))).resolve(strict=True)
        if path.parent != directory.resolve() or path.suffix != ".json":
            raise ValueError("Invalid source collection shard path")
        raw = path.read_bytes()
        if len(raw) != part.get("bytes") or hashlib.sha256(raw).hexdigest() != part.get(
            "sha256"
        ):
            raise ValueError("Source collection shard receipt mismatch")
        result.append(path)
    return result


def names(paths: list[Path]) -> tuple[set[str], int]:
    found: set[str] = set()
    count = 0
    for path in paths:
        payload = obj(json.loads(path.read_bytes()))
        for value in seq(payload.get("terms"), 50000):
            term = obj(value)
            count += 1
            for name in [term.get("title"), *seq(term.get("aliases", []), 128)]:
                found.add(normalized_name(text(name)))
    return found, count


def refresh(root: Path, collection: Path) -> dict[str, object]:
    source = root / "content/definition-drafts"
    if collection.resolve().parent != source.resolve():
        raise ValueError(
            "Collection must be a direct child of the public definition-source folder"
        )
    old_paths = [
        source / name
        for name in (
            "catalog.json",
            "ruwiktionary-2026.9.16.json",
            "prepared-source-excerpts-2026.09.21.json",
        )
    ]
    old_paths.extend(
        checked_parts(
            source,
            obj(
                json.loads(
                    (source / "clinical-source-excerpts-2026.09.21.json").read_bytes()
                )
            ),
        )
    )
    collection_manifest = obj(json.loads((collection / "manifest.json").read_bytes()))
    if collection_manifest.get("sourceFamily") != "ruwiki-medical-introductions":
        raise ValueError("Unexpected source family; admit each family explicitly")
    new_paths = checked_parts(collection, collection_manifest)
    old_names, old_count = names(old_paths)
    new_names, new_count = names(new_paths)
    if new_count != collection_manifest.get("entries"):
        raise ValueError("Collection count differs from actual source records")
    manifest = write_source_manifest(
        root, tuple(old_paths + new_paths), source / "source-inputs.json"
    )
    # Categories and same-title overlap describe source coverage, not clinical concept equivalence.
    report = {
        "schemaVersion": 1,
        "previousBaseRecords": old_count,
        "newSourceRecords": new_count,
        "combinedRecords": manifest["entries"],
        "baseNormalizedNames": len(old_names),
        "newSourceNormalizedNames": len(new_names),
        "newNameSurfaces": len(new_names - old_names),
        "existingNameSurfacesWithAdditionalSource": len(new_names & old_names),
        "combinedNormalizedNames": len(old_names | new_names),
        "sourceFiles": [describe_input(root, path) for path in new_paths],
        "previousProbeCoverage": {
            query: {
                "before": normalized_name(query) in old_names,
                "after": normalized_name(query) in old_names | new_names,
            }
            for query in ("Атаксия", "Дисметрия", "Ортопноэ", "Брадипноэ")
        },
        "boundaries": (
            "New normalized name surfaces are not proven disjoint canonic"
            "al concepts. Source text is not rewritten or reviewed. Old s"
            "ource-specific meanings remain separate. The owner textbook "
            "is not included in public counts. This operation replaces th"
            "e previous encyclopedic source snapshot in the DEV manifest "
            "rather than accumulating duplicate page IDs."
        ),
    }
    destination = root / "docs/research/definition-expansion-2026-09-22.json"
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    report = refresh(root, args.collection)
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "previousBaseRecords",
                    "newSourceRecords",
                    "combinedRecords",
                    "newNameSurfaces",
                    "existingNameSurfacesWithAdditionalSource",
                )
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
