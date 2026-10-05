"""Build the released GRLS instruction modules, one per ATC level-1 group (+ unclassified).

Local-only, deterministic; planning and staging live in `localmed_ingest.grls_instruction_modules`.

    cd tools/ingest
    uv run python scripts/build_grls_instruction_modules.py plan --out DIR
    uv run python scripts/build_grls_instruction_modules.py build --out DIR --module cardiovascular
    uv run python scripts/build_grls_instruction_modules.py build --out DIR  # every module

`build` writes `DIR/raw/<module id>.db` (lexical-only, search text kept: run
`medbase compact-module-search` afterwards) and `DIR/reports/<module id>.json`; the staged Markdown
copy is deleted as soon as the pack is built. Nothing outside `DIR` is written.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from localmed_ingest.grls_instruction_modules import (
    PlannedInstruction,
    build_group,
    load_registration_groups,
    plan_instructions,
    read_manifest_rows,
    summarize,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "build"])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--module", action="append", default=[])
    args = parser.parse_args()
    registration_groups = load_registration_groups()
    plan, skipped = plan_instructions(read_manifest_rows(), registration_groups)
    args.out.mkdir(parents=True, exist_ok=True)
    summary = {
        "documents": len(plan),
        "skipped": skipped,
        "groupBasis": dict(Counter(entry.group_basis for entry in plan)),
        "groups": summarize(plan),
    }
    if args.command == "plan":
        (args.out / "plan.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    by_group: dict[str, list[PlannedInstruction]] = defaultdict(list)
    for entry in plan:
        by_group[entry.group].append(entry)
    wanted = args.module or sorted(by_group)
    for group in wanted:
        if group not in by_group:
            raise SystemExit(f"No instructions for module {group}.")
        result = build_group(args.out, group, by_group[group])
        print(
            json.dumps({k: v for k, v in result.items() if k != "documentIds"}, ensure_ascii=False)
        )


if __name__ == "__main__":
    main()
