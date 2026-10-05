"""Build the same-substance instruction fallback asset and measure its coverage (ADR-0023).

Local-only and deterministic. Reads the released ЕСКЛП medication databases (the МНН cards with
their СМНН nodes, trade names, registrations and КЛП positions), the documents the released
instruction modules hold (GRLS: module reports + `grls-instruction-text-manifest.jsonl`; optional
manufacturer-site module report) and the ГРЛС registry export (holder country and registration
date, used only to rank donors). Writes the JSON asset the drug screen loads lazily and a coverage
report; nothing else.

    cd tools/ingest
    uv run python scripts/build_substance_fallback.py \\
        --modules-dir ../../data/build/grls-instruction-modules \\
        --manufacturer-report ../../data/build/manufacturer-instruction-module/reports/<module>.json \\
        --asset ../../apps/app/src/features/medications/substance-fallback.json \\
        --report ../../data/build/substance-fallback/report.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from localmed_ingest.grls_instruction_modules import (
    RELEASE_ESKLP_DIR,
    REPO_ROOT,
    load_registration_groups,
    plan_instructions,
    read_manifest_rows,
)
from localmed_ingest.substance_fallback import (
    DonorFacts,
    Registration,
    SourceClass,
    asset_payload,
    assign_fallbacks,
    best_kind,
    card_registrations,
    is_foreign_country,
    normalize_text,
    parse_registry_date,
)

REGISTRY = REPO_ROOT / "data" / "raw" / "official-grls-registry" / "catalog-02.10.2026.json"
DEFAULT_ASSET = REPO_ROOT / "apps/app/src/features/medications/substance-fallback.json"

Metadata = Mapping[str, Any]


def read_cards() -> list[tuple[str, Metadata]]:
    cards: list[tuple[str, Metadata]] = []
    for path in sorted(RELEASE_ESKLP_DIR.glob("*.db")):
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            for card_id, raw in connection.execute("SELECT id, metadata_json FROM documents"):
                metadata = cast(Metadata, json.loads(raw))
                if metadata.get("contentMode") == "esklp-mnn":
                    cards.append((str(card_id), metadata))
        finally:
            connection.close()
    return sorted(cards, key=lambda item: item[0])


def grls_documents(modules_dir: Path) -> dict[str, list[str]]:
    """Registration number -> kinds of the GRLS documents that really are in the released modules."""
    included: set[str] = set()
    for path in sorted((modules_dir / "reports").glob("*.ru.json")):
        included.update(json.loads(path.read_text(encoding="utf-8"))["documentIds"])
    plan, _skipped = plan_instructions(read_manifest_rows(), load_registration_groups())
    kinds: dict[str, list[str]] = defaultdict(list)
    for entry in plan:
        if entry.document_id in included:
            for number in entry.registration_numbers:
                kinds[number].append(entry.kind)
    return kinds


def manufacturer_documents(report: Path | None) -> dict[str, list[str]]:
    """Registration number -> kinds of the manufacturer-site documents of the released module."""
    kinds: dict[str, list[str]] = defaultdict(list)
    if report is None:
        return kinds
    payload = cast(Metadata, json.loads(report.read_text(encoding="utf-8")))
    summaries = cast(Mapping[str, Metadata], payload["documentSummaries"])
    for document in summaries.values():
        for number in cast(list[str], document["registrationNumbers"]):
            kinds[number].append(str(document.get("documentKind") or "unknown"))
    return kinds


def registry_facts() -> dict[str, tuple[bool, Any]]:
    facts: dict[str, tuple[bool, Any]] = {}
    for record in json.loads(REGISTRY.read_text(encoding="utf-8"))["records"]:
        number = record.get("registrationNumber")
        if isinstance(number, str) and number not in facts:
            facts[number] = (
                is_foreign_country(record.get("holderCountry")),
                parse_registry_date(record.get("registrationDate")),
            )
    return facts


def donor_facts(
    grls: Mapping[str, list[str]],
    manufacturer: Mapping[str, list[str]],
    registry: Mapping[str, tuple[bool, Any]],
) -> dict[str, DonorFacts]:
    facts: dict[str, DonorFacts] = {}
    for number in sorted(set(grls) | set(manufacturer)):
        source: SourceClass = "grls" if number in grls else "manufacturer-site"
        kinds = grls[number] if number in grls else manufacturer[number]
        foreign, registered = registry.get(number, (False, None))
        facts[number] = DonorFacts(source, best_kind(kinds), foreign, registered)
    return facts


def percent(part: int, whole: int) -> float:
    return round(100.0 * part / whole, 2) if whole else 0.0


def measure(
    cards: list[tuple[str, Metadata]],
    registrations: list[Registration],
    own: Mapping[str, DonorFacts],
    entries: Mapping[str, Any],
) -> dict[str, Any]:
    by_number = {registration.number: registration for registration in registrations}
    # MED2's comparison keys: the registry's СМНН node, and the МНН card x form class.
    node_text: dict[str, set[str]] = defaultdict(set)
    class_text: dict[tuple[str, str], set[str]] = defaultdict(set)
    for registration in registrations:
        if registration.number in own:
            for item in registration.presentations:
                node_text[item.node].add(registration.number)
                class_text[(registration.card_id, item.form_class)].add(registration.number)

    def category(number: str) -> str:
        if number in own:
            return "own"
        entry = entries.get(number)
        return f"level{entry.level}" if entry else "none"

    def node_level(number: str) -> bool:
        registration = by_number.get(number)
        return registration is not None and any(
            node_text.get(item.node, set()) - {number} for item in registration.presentations
        )

    def class_level(number: str) -> bool:
        registration = by_number.get(number)
        return registration is not None and any(
            class_text.get((registration.card_id, item.form_class), set()) - {number}
            for item in registration.presentations
        )

    positions: dict[str, set[str]] = {}
    essential: set[str] = set()
    units: dict[tuple[str, str], set[str]] = defaultdict(set)
    for card_id, metadata in cards:
        for node in cast(list[Metadata], metadata.get("smnnNodes") or []):
            for position in cast(list[Metadata], node.get("klpPositions") or []):
                number, code = position.get("registrationNumber"), position.get("klpCode")
                if not isinstance(number, str) or not isinstance(code, str):
                    continue
                positions.setdefault(code, set()).add(number)
                if position.get("essentialDrug") is True:
                    essential.add(code)
                units[(card_id, normalize_text(str(position.get("tradeName") or "")))].add(number)

    def position_counts(pool: set[str] | None) -> dict[str, Any]:
        counts: Counter[str] = Counter()
        node_extra = class_extra = 0
        for code, numbers in positions.items():
            if pool is not None and code not in pool:
                continue
            # A position keeps the best category of the registrations that list it.
            order = ["own", "level1", "level2", "none"]
            best = min((category(number) for number in numbers), key=order.index)
            counts[best] += 1
            if best != "own":
                node_extra += any(node_level(number) for number in numbers)
                class_extra += any(class_level(number) for number in numbers)
        total = sum(counts.values())
        return {
            "total": total,
            "own": counts["own"],
            "ownPercent": percent(counts["own"], total),
            "level1": counts["level1"],
            "level2": counts["level2"],
            "none": counts["none"],
            "ownPlusLevel1Percent": percent(counts["own"] + counts["level1"], total),
            "ownPlusLevel1And2Percent": percent(
                counts["own"] + counts["level1"] + counts["level2"], total
            ),
            "med2NodeEquivalentPercent": percent(counts["own"] + node_extra, total),
            "med2FormClassEquivalentPercent": percent(counts["own"] + class_extra, total),
        }

    order = ["own", "level1", "level2", "none"]
    unit_counts: Counter[str] = Counter(
        min((category(number) for number in numbers), key=order.index) for numbers in units.values()
    )
    mnn_counts: Counter[str] = Counter()
    registration_counts: Counter[str] = Counter(category(number) for number in by_number)
    cards_best: dict[str, list[str]] = defaultdict(list)
    for registration in registrations:
        cards_best[registration.card_id].append(category(registration.number))
    for categories in cards_best.values():
        mnn_counts[min(categories, key=order.index)] += 1
    donor_load = Counter(
        number for entry in entries.values() for number, _flags in entry.donors[:1]
    )
    return {
        "positions": position_counts(None),
        "positionsEssential": position_counts(essential),
        "tradeNameUnits": {
            "total": len(units),
            **{name: unit_counts[name] for name in order},
            "ownPercent": percent(unit_counts["own"], len(units)),
            "ownPlusLevel1Percent": percent(unit_counts["own"] + unit_counts["level1"], len(units)),
            "ownPlusLevel1And2Percent": percent(len(units) - unit_counts["none"], len(units)),
        },
        "registrations": {
            "total": len(by_number),
            **{name: registration_counts[name] for name in order},
            "ownPercent": percent(registration_counts["own"], len(by_number)),
        },
        "mnnCards": {"total": len(cards_best), **{name: mnn_counts[name] for name in order}},
        "level2Flags": dict(
            Counter(
                flags
                for entry in entries.values()
                if entry.level == 2
                for _number, flags in entry.donors[:1]
            )
        ),
        "mostUsedFirstDonors": donor_load.most_common(5),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--modules-dir", type=Path, required=True)
    parser.add_argument("--manufacturer-report", type=Path)
    parser.add_argument("--asset", type=Path, default=DEFAULT_ASSET)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    cards = read_cards()
    registrations = [
        registration
        for card_id, metadata in cards
        for registration in card_registrations(card_id, metadata)
    ]
    grls = grls_documents(args.modules_dir)
    manufacturer = manufacturer_documents(args.manufacturer_report)
    facts = donor_facts(grls, manufacturer, registry_facts())
    known = {registration.number for registration in registrations}
    own = {number: fact for number, fact in facts.items() if number in known}
    entries = assign_fallbacks(registrations, own)

    editions = sorted({str(metadata.get("sourceEdition")) for _id, metadata in cards})
    document_digest = hashlib.sha256(
        json.dumps(sorted(own), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    basis: dict[str, object] = {
        "esklpEdition": editions[-1] if editions else None,
        "grlsRegistryEdition": "02.10.2026",
        "registrationsWithText": len(own),
        "registrationsWithTextDigest": f"sha256:{document_digest}",
        "manufacturerSiteRegistrations": sum(
            1 for fact in own.values() if fact.source_class == "manufacturer-site"
        ),
        "rules": "docs/adr/0023-same-substance-instruction-fallback.md",
    }
    payload = asset_payload(entries, basis)
    args.asset.parent.mkdir(parents=True, exist_ok=True)
    args.asset.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    coverage = measure(cards, registrations, own, entries)
    coverage["asset"] = {
        "path": str(args.asset),
        "bytes": args.asset.stat().st_size,
        "registrations": len(cast(dict[str, int], payload["registrations"])),
        "groups": len(cast(list[object], payload["groups"])),
        "levelCounts": dict(Counter(entry.level for entry in entries.values())),
    }
    coverage["basis"] = basis
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(coverage, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
