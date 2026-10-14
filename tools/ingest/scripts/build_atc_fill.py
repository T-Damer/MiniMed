"""Complete the ATC codes of the ЕСКЛП medication modules (ATC2, ATC3), with provenance per code.

Local-only and deterministic; the rules live in `localmed_ingest.atc_fill`.

    cd tools/ingest
    uv run python scripts/build_atc_fill.py derive --out DIR     # ledger + coverage report
    uv run python scripts/build_atc_fill.py apply  --out DIR     # patched copies of the module DBs

Inputs (all under the main checkout's git-ignored `data/`, pass `--data-root` from a worktree):

* `data/build/atc-fill/base/*.db`: the decoded ЕСКЛП modules as ЕСКЛП published them, before any
  fill (`data/build/release-esklp` of the main checkout, or the decoded `esklp-2026-08-28` set);
* `data/raw/nsi/atc/v*/rows.json`: the НСИ «АТХ» dictionary (`scripts/fetch-nsi-dictionary.sh`);
* `data/build/grls-instruction-text-manifest.jsonl` and the prepared instruction Markdown it names;
* optionally the decoded published Allmed module (`--allmed-db`) for its coverage figures.

`derive` writes `DIR/ledger.jsonl` (every node filled, refined, flagged or left open),
`DIR/coverage.json` (before/after by record type, sources, conflicts) and `DIR/decisions.json`.
`apply` copies every module DB to `DIR/patched/` and rewrites only `documents.metadata_json` of the
cards that gained a code or a flag; nothing else in the database changes.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from localmed_ingest.atc_fill import (
    FILL_VERSION,
    AtcNode,
    Decision,
    InstructionCodes,
    atc_level,
    coverage_row,
    decide_all,
    final_code,
    flatten_nsi_rows,
    nodes_of_document,
    normalize_atc,
    nsi_substance_index,
    parse_instruction_atc,
    patch_metadata,
)
from localmed_ingest.grls_instruction_modules import plan_instructions, read_manifest_rows


def module_name(path: Path) -> str:
    return path.name.removeprefix("minimed.medications.").removesuffix(".ru.db")


def load_cards(base: Path) -> list[tuple[str, str, dict[str, Any]]]:
    """(module, document id, metadata) of every ЕСКЛП МНН card."""
    cards: list[tuple[str, str, dict[str, Any]]] = []
    for path in sorted(base.glob("minimed.medications.*.ru.db")):
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            for document_id, raw in connection.execute("SELECT id, metadata_json FROM documents"):
                cards.append((module_name(path), str(document_id), json.loads(raw)))
        finally:
            connection.close()
    return cards


def load_instruction_codes(data_root: Path) -> tuple[list[InstructionCodes], dict[str, Any]]:
    manifest = data_root / "data" / "build" / "grls-instruction-text-manifest.jsonl"
    plan, skipped = plan_instructions(read_manifest_rows(manifest), {}, repo_root=data_root)
    documents: list[InstructionCodes] = []
    for entry in plan:
        text = entry.path.read_text(encoding="utf-8")
        documents.append(
            InstructionCodes(
                document_id=entry.document_id,
                registrations=entry.registration_numbers,
                codes=tuple(parse_instruction_atc(text)),
                ocr=bool(entry.newest.get("ocr")),
            )
        )
    return documents, {"planned": len(plan), "skipped": len(skipped)}


def newest_nsi_rows(data_root: Path) -> tuple[list[dict[str, Any]], str]:
    versions = sorted((data_root / "data" / "raw" / "nsi" / "atc").glob("v*/rows.json"))
    if not versions:
        raise SystemExit("No НСИ «АТХ» rows: run scripts/fetch-nsi-dictionary.sh first.")
    path = versions[-1]
    rows = cast(list[list[dict[str, Any]]], json.loads(path.read_text(encoding="utf-8")))
    return flatten_nsi_rows(rows), path.parent.name


def level_of(code: str | None) -> int:
    return atc_level(normalize_atc(code))


def registration_levels(
    nodes: Sequence[AtcNode], codes: Mapping[tuple[str, str], str | None]
) -> dict[str, int]:
    levels: dict[str, int] = {}
    for node in nodes:
        level = atc_level(codes[node.key])
        for registration in node.registrations:
            levels[registration] = max(levels.get(registration, 0), level)
    return levels


def document_levels(
    nodes: Sequence[AtcNode], codes: Mapping[tuple[str, str], str | None]
) -> dict[str, int]:
    levels: dict[str, int] = defaultdict(int)
    for node in nodes:
        levels[node.document_id] = max(levels[node.document_id], atc_level(codes[node.key]))
    return dict(levels)


def allmed_links(path: Path | None) -> dict[str, str | None]:
    if path is None:
        return {}
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        links: dict[str, str | None] = {}
        for document_id, raw in connection.execute("SELECT id, metadata_json FROM documents"):
            target = json.loads(raw).get("linkedMnnDocumentId")
            links[str(document_id)] = target if isinstance(target, str) else None
        return links
    finally:
        connection.close()


def validation(decisions: Sequence[Decision]) -> dict[str, Any]:
    """How often each source agrees with the registry where the registry has a full code."""
    agree: Counter[str] = Counter()
    disagree: Counter[str] = Counter()
    for decision in decisions:
        original = decision.node.original
        if atc_level(original) != 5:
            continue
        seen: dict[str, bool] = {}
        for candidate in decision.candidates:
            if candidate.source == "esklp":
                continue
            seen[candidate.source] = seen.get(candidate.source, False) or candidate.code == original
        if decision.nsi_options:
            seen["registry-nsi"] = original in decision.nsi_options
        for source, ok in seen.items():
            (agree if ok else disagree)[source] += 1
    return {
        source: {"agree": agree[source], "disagree": disagree[source]}
        for source in sorted(set(agree) | set(disagree))
    }


def consensus_report(decisions: Sequence[Decision]) -> dict[str, Any]:
    """Stub conflicts where independent source kinds agree on one full code (ATC3, "show both")."""
    nodes = [d for d in decisions if d.consensus is not None]
    return {
        "nodes": len(nodes),
        "cards": len({d.node.document_id for d in nodes}),
        "byCode": dict(
            sorted(Counter(d.consensus.code for d in nodes if d.consensus is not None).items())
        ),
        "byModule": dict(sorted(Counter(d.node.module for d in nodes).items())),
    }


def derive(args: argparse.Namespace) -> None:
    data_root: Path = args.data_root
    base = args.base or data_root / "data" / "build" / "atc-fill" / "base"
    cards = load_cards(base)
    nodes = [
        node
        for module, document_id, metadata in cards
        for node in nodes_of_document(document_id, module, metadata)
    ]
    nsi_rows, nsi_version = newest_nsi_rows(data_root)
    nsi_index = nsi_substance_index(nsi_rows)
    instructions, plan_info = load_instruction_codes(data_root)
    decisions = decide_all(nodes, instructions, nsi_index)
    args.out.mkdir(parents=True, exist_ok=True)

    before = {d.node.key: d.node.original for d in decisions}
    after = {d.node.key: final_code(d) for d in decisions}
    status = Counter(d.status for d in decisions)
    by_original = Counter(
        (("none" if not d.node.original else f"level{atc_level(d.node.original)}"), d.status)
        for d in decisions
    )
    sources = Counter(d.sources[0] for d in decisions if d.changed)
    all_sources = Counter(s for d in decisions if d.changed for s in d.sources)
    conflict_kinds: Counter[str] = Counter()
    for d in decisions:
        if d.status == "conflict":
            kinds: set[str] = {c.source for c in d.candidates}
            if d.nsi_options:
                kinds.add("registry-nsi")
            conflict_kinds["+".join(sorted(kinds))] += 1

    doc_before = document_levels(nodes, before)
    doc_after = document_levels(nodes, after)
    reg_before = registration_levels(nodes, before)
    reg_after = registration_levels(nodes, after)

    text_levels = {
        i.document_id: max((atc_level(c) for c in i.codes), default=0) for i in instructions
    }
    instruction_before: list[int] = []
    instruction_after: list[int] = []
    instruction_text: list[int] = []
    instruction_union: list[int] = []
    for instruction in instructions:
        b = max((reg_before.get(r, 0) for r in instruction.registrations), default=0)
        a = max((reg_after.get(r, 0) for r in instruction.registrations), default=0)
        t = text_levels[instruction.document_id]
        instruction_before.append(b)
        instruction_after.append(a)
        instruction_text.append(t)
        instruction_union.append(max(a, t))
    no_card = [i for i in instructions if not any(r in reg_before for r in i.registrations)]
    no_card_text = [text_levels[i.document_id] for i in no_card]

    links = allmed_links(args.allmed_db)
    allmed: dict[str, Any] = {}
    if links:
        allmed_before = [doc_before.get(t or "", 0) for t in links.values()]
        allmed_after = [doc_after.get(t or "", 0) for t in links.values()]
        allmed = {
            "linked": sum(1 for t in links.values() if t),
            "before": coverage_row(allmed_before),
            "after": coverage_row(allmed_after),
        }

    report: dict[str, Any] = {
        "version": FILL_VERSION,
        "nsiVersion": nsi_version,
        "nsiLevel5Names": len(nsi_index),
        "instructions": {**plan_info, "withCode": sum(1 for i in instructions if i.codes)},
        "statuses": dict(status),
        "statusesByOriginalLevel": {f"{k[0]}/{k[1]}": v for k, v in sorted(by_original.items())},
        "firstSourceOfApplied": dict(sources),
        "anySourceOfApplied": dict(all_sources),
        "conflictKinds": dict(conflict_kinds),
        "consensus": consensus_report(decisions),
        "validation": validation(decisions),
        "coverage": {
            "esklpNodes": {
                "before": coverage_row([atc_level(v) for v in before.values()]),
                "after": coverage_row([atc_level(v) for v in after.values()]),
            },
            "esklpMnnCards": {
                "before": coverage_row(list(doc_before.values())),
                "after": coverage_row(list(doc_after.values())),
            },
            "esklpRegistrations": {
                "before": coverage_row(list(reg_before.values())),
                "after": coverage_row(list(reg_after.values())),
            },
            "grlsInstructionDocuments": {
                "viaEsklpBefore": coverage_row(instruction_before),
                "viaEsklpAfter": coverage_row(instruction_after),
                "ownTextCode": coverage_row(instruction_text),
                "esklpAfterOrOwnText": coverage_row(instruction_union),
                "withoutEsklpCard": {
                    "documents": len(no_card),
                    "ownTextCode": coverage_row(no_card_text),
                },
            },
            "allmedDocuments": allmed,
        },
    }
    (args.out / "coverage.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (args.out / "ledger.jsonl").open("w", encoding="utf-8") as ledger:
        for d in decisions:
            if d.status in {"unchanged", "confirmed"}:
                continue
            ledger.write(
                json.dumps(
                    {
                        "document": d.node.document_id,
                        "smnn": d.node.smnn_code,
                        "inn": d.node.inn,
                        "form": d.node.form,
                        "formClass": d.node.form_class,
                        "original": d.node.original_raw,
                        "status": d.status,
                        "code": d.code,
                        "sources": d.sources,
                        "candidates": [
                            {"code": c.code, "source": c.source, **c.detail} for c in d.candidates
                        ],
                        "nsiOptions": d.nsi_options,
                        **(
                            {
                                "consensus": {
                                    "code": d.consensus.code,
                                    "sources": list(d.consensus.sources),
                                }
                            }
                            if d.consensus is not None
                            else {}
                        ),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    print(
        json.dumps(
            {k: report[k] for k in ("statuses", "firstSourceOfApplied", "validation", "consensus")},
            ensure_ascii=False,
            indent=1,
        )
    )
    print(json.dumps(report["coverage"], ensure_ascii=False, indent=1))
    (args.out / "decisions.json").write_text(
        json.dumps(
            {f"{d.node.document_id}\t{d.node.smnn_code}": d.status for d in decisions},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def apply(args: argparse.Namespace) -> None:
    data_root: Path = args.data_root
    base = args.base or data_root / "data" / "build" / "atc-fill" / "base"
    cards = load_cards(base)
    nodes = [
        node
        for module, document_id, metadata in cards
        for node in nodes_of_document(document_id, module, metadata)
    ]
    nsi_rows, _version = newest_nsi_rows(data_root)
    instructions, _info = load_instruction_codes(data_root)
    decisions = {
        d.node.key: d for d in decide_all(nodes, instructions, nsi_substance_index(nsi_rows))
    }
    out = args.out / "patched"
    out.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {}
    for path in sorted(base.glob("minimed.medications.*.ru.db")):
        target = out / path.name
        shutil.copy2(path, target)
        connection = sqlite3.connect(target)
        changed_cards = 0
        changed_nodes = 0
        try:
            rows = connection.execute("SELECT id, metadata_json FROM documents").fetchall()
            for document_id, raw in rows:
                metadata = json.loads(raw)
                patched, nodes_changed = patch_metadata(metadata, decisions, str(document_id))
                if patched == metadata:
                    continue
                connection.execute(
                    "UPDATE documents SET metadata_json = ? WHERE id = ?",
                    (json.dumps(patched, ensure_ascii=False, separators=(",", ":")), document_id),
                )
                changed_cards += 1
                changed_nodes += nodes_changed
            connection.commit()
            connection.execute("VACUUM")
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            connection.close()
        summary[module_name(path)] = {
            "changedCards": changed_cards,
            "filledNodes": changed_nodes,
            "integrity": integrity,
        }
        print(path.name, summary[module_name(path)])
    (args.out / "apply-report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["derive", "apply"])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="checkout that holds the git-ignored data/ directory (the main checkout)",
    )
    parser.add_argument("--base", type=Path, default=None)
    parser.add_argument("--allmed-db", type=Path, default=None)
    args = parser.parse_args()
    {"derive": derive, "apply": apply}[args.command](args)


if __name__ == "__main__":
    main()
