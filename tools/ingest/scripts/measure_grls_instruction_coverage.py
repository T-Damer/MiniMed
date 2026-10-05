"""Coverage of the released ГРЛС instruction modules, measured against the registries.

Reads the per-module reports written by `build_grls_instruction_modules.py build` (the documents
that really are in each pack), the planned registration numbers of those documents, the ГРЛС
registry export and the ЕСКЛП identity modules. Read-only; writes one JSON report.

    uv run python tools/ingest/scripts/measure_grls_instruction_coverage.py --out DIR
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from localmed_ingest.grls_groups import build_groups, dosage_form_class, is_active_record
from localmed_ingest.grls_instruction_modules import (
    RELEASE_ESKLP_DIR,
    REPO_ROOT,
    load_registration_groups,
    plan_instructions,
    read_manifest_rows,
)

REGISTRY = REPO_ROOT / "data" / "raw" / "official-grls-registry" / "catalog-02.10.2026.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    reports = {
        path.stem.removeprefix("minimed.medications.instructions.").removesuffix(".ru"): json.loads(
            path.read_text(encoding="utf-8")
        )
        for path in sorted((args.out / "reports").glob("*.ru.json"))
    }
    included = {doc_id for report in reports.values() for doc_id in report["documentIds"]}
    plan, skipped = plan_instructions(read_manifest_rows(), load_registration_groups())
    covered_numbers: set[str] = set()
    registrations_by_group: dict[str, set[str]] = defaultdict(set)
    kinds: Counter[str] = Counter()
    ocr = 0
    for entry in plan:
        if entry.document_id not in included:
            continue
        covered_numbers.update(entry.registration_numbers)
        registrations_by_group[entry.group].update(entry.registration_numbers)
        kinds[entry.kind] += 1
        ocr += 1 if entry.newest.get("ocr") else 0

    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))["records"]
    active = [
        r
        for r in registry
        if is_active_record(r)
        and isinstance(r.get("registrationNumber"), str)
        and not str(r["registrationNumber"]).startswith("ФС-")
    ]
    active_numbers = {str(r["registrationNumber"]) for r in active}
    groups = build_groups(registry)
    groups_covered = [g for g in groups.values() if any(m in covered_numbers for m in g.members)]
    essential = [g for g in groups.values() if g.essential]
    essential_covered = [g for g in essential if any(m in covered_numbers for m in g.members)]

    esklp_registrations: set[str] = set()
    mnn_total = mnn_covered = smnn_total = smnn_covered = 0
    mnn_form_total = mnn_form_covered = 0
    for db_path in sorted(RELEASE_ESKLP_DIR.glob("*.db")):
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            for (raw,) in connection.execute("SELECT metadata_json FROM documents"):
                metadata = json.loads(raw)
                mnn_total += 1
                mnn_has = False
                classes: dict[str, bool] = {}
                for node in metadata.get("smnnNodes") or []:
                    numbers = {
                        item.get("registrationNumber")
                        for item in node.get("tradeNames") or []
                        if item.get("registrationNumber")
                    }
                    esklp_registrations.update(numbers)
                    smnn_total += 1
                    node_has = bool(numbers & covered_numbers)
                    smnn_covered += 1 if node_has else 0
                    mnn_has = mnn_has or node_has
                    form_class = dosage_form_class(node.get("dosageForm"))
                    classes[form_class] = classes.get(form_class, False) or node_has
                mnn_covered += 1 if mnn_has else 0
                mnn_form_total += len(classes)
                mnn_form_covered += sum(1 for has in classes.values() if has)
        finally:
            connection.close()

    result = {
        "documentsInModules": len(included),
        "documentsPlanned": len(plan),
        "notPrepared": len(skipped),
        "kinds": dict(kinds),
        "ocrDocuments": ocr,
        "registrationsServed": len(covered_numbers),
        "activeRegistrations": len(active_numbers),
        "activeRegistrationsWithText": len(active_numbers & covered_numbers),
        "esklpRegistrations": len(esklp_registrations),
        "esklpRegistrationsWithText": len(esklp_registrations & covered_numbers),
        "esklpMnnDocuments": mnn_total,
        "esklpMnnDocumentsWithText": mnn_covered,
        "esklpSmnnNodes": smnn_total,
        "esklpSmnnNodesWithText": smnn_covered,
        "esklpMnnFormClassGroups": mnn_form_total,
        "esklpMnnFormClassGroupsWithText": mnn_form_covered,
        "grlsInnFormGroups": len(groups),
        "grlsInnFormGroupsWithText": len(groups_covered),
        "grlsEssentialGroups": len(essential),
        "grlsEssentialGroupsWithText": len(essential_covered),
        "perModule": {
            group: {
                "documents": len(report["documentIds"]),
                "registrations": len(registrations_by_group.get(group, set())),
                "sizeBytes": report["sizeBytes"],
                "excluded": report["excluded"],
            }
            for group, report in sorted(reports.items())
        },
    }
    target = args.out / "coverage.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {k: v for k, v in result.items() if k != "perModule"}, ensure_ascii=False, indent=2
        )
    )


if __name__ == "__main__":
    main()
