"""Partition a prepared GRLS instruction workspace into ATC-anatomical modules.

Local-only build step: reads an already-prepared workspace (instruction
markdown + registry cards, the latter carrying `esklpMnnDocumentId` once
`medbase-regulated-catalog grls-products` has run with `--esklp-pack`
pointing at the 15 built `data/build/release-esklp/*.db` identity modules),
assigns each registration with a downloaded+prepared instruction to the same
WHO-ATC anatomical group as its ESKLP MNN identity (falling back to
'unclassified' when there is no ESKLP match or no ATC code), and builds one
loadable SQLite pack per module plus a membership manifest shaped like
`data/build/catalog-esklp-membership.json`.

Writes only under `data/build/`; never touches `apps/` and never publishes.
Also reports how many prepared Allmed medication records (by ESKLP MNN link,
falling back to normalized trade-name match) now resolve to a real
instruction, for the Allmed-UI "Кратко <-> Инструкция" toggle.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
RELEASE_ESKLP_DIR = REPO_ROOT / "data" / "build" / "release-esklp"


def _module_id_from_db_path(path: Path) -> str:
    return path.stem.removeprefix("minimed.medications.").removesuffix(".ru")


_MODULE_TITLES = {
    "alimentary-metabolism": "Пищеварительный тракт и обмен веществ",
    "antiinfectives": "Противоинфекционные препараты системного действия",
    "antineoplastic-immunomodulating": "Противоопухолевые и иммуномодулирующие средства",
    "antiparasitic": "Противопаразитарные препараты, инсектициды и репелленты",
    "blood": "Средства, влияющие на кроветворение и кровь",
    "cardiovascular": "Сердечно-сосудистая система",
    "dermatological": "Дерматологические препараты",
    "genitourinary-hormones": "Мочеполовая система и половые гормоны",
    "musculoskeletal": "Костно-мышечная система",
    "nervous-system": "Нервная система",
    "respiratory": "Дыхательная система",
    "sensory-organs": "Органы чувств",
    "systemic-hormones": "Гормональные препараты системного действия (исключая половые гормоны)",
    "unclassified": "Без установленного кода АТХ (в т.ч. гомеопатические/комбинированные)",
    "various": "Прочие препараты",
}


def load_mnn_to_module(release_esklp_dir: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for db_path in sorted(release_esklp_dir.glob("*.db")):
        module_id = _module_id_from_db_path(db_path)
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            for (document_id,) in connection.execute("SELECT id FROM documents"):
                mapping[document_id] = module_id
        finally:
            connection.close()
    return mapping


def _read_front_matter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    payload = yaml.safe_load(text[4:end])
    return payload if isinstance(payload, dict) else {}


def _normalize_trade_name(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.casefold().replace("ё", "е")
    normalized = re.sub(r"[®™©]", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


Member = tuple[str, str, str, str]
"""(instruction_doc_id, registry_card_id, trade_name, esklp_mnn_document_id)."""


def partition_workspace(
    workspace: Path,
    mnn_to_module: dict[str, str],
) -> dict[str, list[Member]]:
    """Group instruction+card members by ATC module id.

    Only registrations that have BOTH a registry card and a prepared
    instruction document are included — a registry card alone (no
    instruction downloaded/prepared yet) is not module material here.
    """
    modules: dict[str, list[Member]] = {}
    instruction_files = {path.stem: path for path in workspace.glob("drug.rf.*.instruction.md")}
    for card_path in workspace.glob("drug.registry.ru.*.md"):
        front_matter = _read_front_matter(card_path)
        metadata = front_matter.get("metadata", {})
        if not isinstance(metadata, dict):
            continue
        instruction_document_id = metadata.get("instructionDocumentId")
        if not isinstance(instruction_document_id, str):
            continue
        if instruction_document_id not in instruction_files:
            continue
        mnn_document_id = metadata.get("esklpMnnDocumentId")
        mnn_document_id = mnn_document_id if isinstance(mnn_document_id, str) else ""
        module_id = mnn_to_module.get(mnn_document_id) or "unclassified"
        trade_name = metadata.get("tradeName")
        modules.setdefault(module_id, []).append(
            (
                instruction_document_id,
                card_path.stem,
                trade_name if isinstance(trade_name, str) else "",
                mnn_document_id,
            )
        )
    return modules


def build_module_packs(
    workspace: Path,
    modules: dict[str, list[Member]],
    output_dir: Path,
    *,
    dry_run: bool,
) -> list[dict[str, object]]:
    # Imported lazily: this script runs as `uv run python
    # tools/ingest/scripts/build_grls_atc_modules.py`, with the package on
    # sys.path via the project's own src layout.
    import sys

    sys.path.insert(0, str(REPO_ROOT / "tools" / "ingest" / "src"))
    from localmed_ingest.builder import build_content_pack

    results: list[dict[str, object]] = []
    for module_id, members in sorted(modules.items()):
        module_dir = output_dir / f".module-workspace-{module_id}"
        if module_dir.exists():
            for child in module_dir.iterdir():
                if child.is_symlink() or child.is_file():
                    child.unlink()
                else:
                    for grandchild in child.rglob("*"):
                        if grandchild.is_file():
                            grandchild.unlink()
        module_dir.mkdir(parents=True, exist_ok=True)
        (module_dir / "manifest.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": f"minimed.medications.instructions.{module_id}.ru",
                    "version": "grls-24-07-2026",
                    "schemaVersion": 2,
                    "title": f"Инструкции ГРЛС — {_MODULE_TITLES.get(module_id, module_id)}",
                    "builtAt": "2026-09-27T00:00:00Z",
                    "publicationState": "local-dev",
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        (module_dir / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
        for instruction_id, card_id, _trade_name, _mnn in members:
            for stem in (instruction_id, card_id):
                source = workspace / f"{stem}.md"
                if source.is_file():
                    (module_dir / f"{stem}.md").write_bytes(source.read_bytes())
        output_db = output_dir / f"grls-instructions-atc-{module_id}.db"
        report_path = output_dir / f"grls-instructions-atc-{module_id}-build-report.json"
        if dry_run:
            results.append(
                {"moduleId": module_id, "instructions": len(members), "output": str(output_db)}
            )
            continue
        _pack, build_report = build_content_pack(module_dir, output_db, report_path=report_path)
        results.append(
            {
                "moduleId": module_id,
                "instructions": len(members),
                "documents": build_report.documents,
                "sections": build_report.sections,
                "chunks": build_report.chunks,
                "sqliteIntegrity": build_report.sqlite_integrity,
                "output": str(output_db),
                "sizeBytes": output_db.stat().st_size if output_db.is_file() else None,
            }
        )
    return results


def compute_allmed_coverage(
    allmed_dir: Path,
    modules: dict[str, list[Member]],
) -> dict[str, object]:
    instruction_mnn_ids: set[str] = set()
    instruction_trade_names: set[str] = set()
    for members in modules.values():
        for _instruction_id, _card_id, trade_name, mnn_document_id in members:
            normalized = _normalize_trade_name(trade_name)
            if normalized:
                instruction_trade_names.add(normalized)
            if mnn_document_id:
                instruction_mnn_ids.add(mnn_document_id)

    allmed_total = 0
    linked_by_mnn = 0
    linked_by_trade_name = 0
    matched_titles: list[str] = []
    for path in sorted(allmed_dir.glob("drug.allmed.*.md")):
        allmed_total += 1
        front_matter = _read_front_matter(path)
        metadata = front_matter.get("metadata", {})
        title = front_matter.get("title")
        normalized_title = _normalize_trade_name(title if isinstance(title, str) else None)
        linked_mnn = metadata.get("linkedMnnDocumentId") if isinstance(metadata, dict) else None
        matched = False
        if isinstance(linked_mnn, str) and linked_mnn in instruction_mnn_ids:
            linked_by_mnn += 1
            matched = True
        if normalized_title and normalized_title in instruction_trade_names:
            linked_by_trade_name += 1
            matched = True
        if matched and len(matched_titles) < 40:
            matched_titles.append(title if isinstance(title, str) else path.stem)

    return {
        "allmedTotal": allmed_total,
        "linkedByEsklpMnn": linked_by_mnn,
        "linkedByTradeName": linked_by_trade_name,
        "sampleMatchedTitles": matched_titles,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--allmed-workspace", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=REPO_ROOT / "data" / "build")
    parser.add_argument(
        "--membership-output",
        type=Path,
        default=REPO_ROOT / "data" / "build" / "grls-instructions-atc-membership.json",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    mnn_to_module = load_mnn_to_module(RELEASE_ESKLP_DIR)
    modules = partition_workspace(args.workspace, mnn_to_module)
    build_results = build_module_packs(
        args.workspace, modules, args.output_dir, dry_run=args.dry_run
    )

    membership = {
        "schemaVersion": 1,
        "basis": "data/build/release-esklp (WHO ATC anatomical level 1, via ESKLP MNN crosswalk)",
        "modules": [
            {
                "moduleId": f"minimed.medications.instructions.{module_id}.ru",
                "title": _MODULE_TITLES.get(module_id, module_id),
                "instructionCount": len(members),
                "documentIds": sorted(
                    instruction_id for instruction_id, _card, _tn, _mnn in members
                ),
            }
            for module_id, members in sorted(modules.items())
        ],
    }
    args.membership_output.parent.mkdir(parents=True, exist_ok=True)
    args.membership_output.write_text(
        json.dumps(membership, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    coverage = None
    if args.allmed_workspace is not None and args.allmed_workspace.is_dir():
        coverage = compute_allmed_coverage(args.allmed_workspace, modules)

    print(
        json.dumps(
            {
                "modules": build_results,
                "totalInstructionsPartitioned": sum(len(m) for m in modules.values()),
                "membershipOutput": str(args.membership_output),
                "allmedCoverage": coverage,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
