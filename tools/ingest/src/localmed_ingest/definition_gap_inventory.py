"""Audit source-local definition gaps without fetching pages or merging identities."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from .definition_reference_pack import Entry, Projection, normalized_name


def build_gap_inventory(projection: Projection) -> dict[str, object]:
    """Title overlap is a review signal, never proof that two concepts are the same."""
    pending: dict[str, list[Entry]] = {}
    definitions: dict[str, list[Entry]] = {}
    for entry in projection.entries.values():
        key = normalized_name(entry.title)
        if entry.coverage == "needs-definition":
            pending.setdefault(key, []).append(entry)
        elif (
            entry.coverage in {"definition", "explicit-definition"}
            and entry.text_kind != "source-gloss"
        ):
            definitions.setdefault(key, []).append(entry)

    rows: list[dict[str, object]] = []
    title_counts: Counter[str] = Counter()
    identity_counts: Counter[str] = Counter()
    for key, entries in sorted(pending.items()):
        related = definitions.get(key, [])
        if related:
            status = "same-title-definition-needs-sense-review"
        elif len(entries) > 1:
            status = "ambiguous-discovered-title"
        else:
            status = "ready-for-source-research"
        title_counts[status] += 1
        identity_counts[status] += len(entries)
        rows.append(
            {
                "normalizedTitle": key,
                "status": status,
                "pendingIdentities": [
                    {
                        "id": entry.id,
                        "title": entry.title,
                        "kind": entry.kind,
                        "discoveryReceipt": entry.receipt,
                    }
                    for entry in sorted(entries, key=lambda item: item.id)
                ],
                "sameTitleDefinitionIds": sorted(entry.id for entry in related),
            }
        )
    return {
        "format": "minimed-definition-gap-inventory-v1",
        "sourceRecords": len(projection.entries),
        "definitionRecords": sum(len(entries) for entries in definitions.values()),
        "pendingRecords": sum(identity_counts.values()),
        "pendingNormalizedTitles": len(rows),
        "byStatusTitles": dict(sorted(title_counts.items())),
        "byStatusRecords": dict(sorted(identity_counts.items())),
        "rows": rows,
        "boundary": (
            "Research queue only: a normalized title match is not a same-as relation, "
            "clinical approval or automatic completion. Source identities and names remain "
            "unchanged. Counts describe source-local records, not unique medical concepts. "
            "No page bodies, patient data, embeddings or model downloads are required."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a new output path; existing research receipts are not overwritten")
    # Reuse the acquisition loader, including accepted completion manifests, but perform no HTTP.
    from .clinic_definition_completions import load_projection

    report = build_gap_inventory(load_projection(args.root.resolve(strict=True)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({key: value for key, value in report.items() if key != "rows"}))


if __name__ == "__main__":
    main()
