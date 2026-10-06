"""Build the optional DDInter 2.0 severity-label module (INT2, owner decision 2026-10-06).

Local-only, deterministic; the logic is `localmed_ingest.ddinter_severity`.

    cd tools/ingest
    # after downloading the 14 CSV files into data/raw/ddinter (see docs/research):
    S=scripts/build_ddinter_severity_module.py
    uv run --frozen python $S manifest --retrieved-on 2026-10-06
    uv run --frozen python $S report
    uv run --frozen python $S build --out ../../data/build/ddinter-severity

`manifest` writes `data/raw/ddinter/MANIFEST.json` (SHA-256 of every raw file); `report` joins and
prints the match rates without writing a pack; `build` writes `OUT/raw/<module id>.db` and
`OUT/report.json`. The pack is not search-compacted (it has no searchable text). Package it with
`bun scripts/package-instruction-modules.ts --family ddinter`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from localmed_ingest.ddinter_severity import (
    ESKLP_DIRECTORY,
    NSI_ATC_ROWS,
    RAW_ROOT,
    build_atc_index,
    build_module,
    join_table,
    read_atc_substances,
    read_cards,
    read_table,
    resolve_aliases,
    summarize,
    verify_raw_manifest,
    write_raw_manifest,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["manifest", "report", "build"])
    parser.add_argument("--retrieved-on")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.command == "manifest":
        if not args.retrieved_on:
            raise SystemExit("--retrieved-on YYYY-MM-DD is required.")
        manifest = write_raw_manifest(RAW_ROOT, retrieved_on=args.retrieved_on)
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return
    if args.command == "report":
        manifest = verify_raw_manifest(RAW_ROOT)
        table = read_table(RAW_ROOT)
        index = build_atc_index(read_atc_substances(NSI_ATC_ROWS))
        cards = read_cards(ESKLP_DIRECTORY)
        join = join_table(table, cards, index, resolve_aliases(index))
        print(
            json.dumps(
                summarize(table, cards, join, index, str(manifest["retrievedOn"])),
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    if args.out is None:
        raise SystemExit("--out is required.")
    report = build_module(args.out)
    print(
        json.dumps(
            {key: value for key, value in report.items() if key != "unmatchedDrugsByPairCount"},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
