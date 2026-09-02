#!/usr/bin/env python3
"""Inventory SQLite artifacts below an explicitly supplied root."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from localmed_ingest.database_inventory import (  # noqa: E402
    inventory_databases,
    write_inventory_report,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Root directory to scan")
    parser.add_argument("--output", type=Path, required=True, help="Atomic JSON report destination")
    parser.add_argument("--generated-at", help="Timestamp override for deterministic reports")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.output.suffix.lower() == ".db":
        print("inventory_databases: output must not use the .db extension", file=sys.stderr)
        return 2
    try:
        report = inventory_databases(args.root, generated_at=args.generated_at)
        write_inventory_report(report, args.output)
    except (OSError, ValueError) as error:
        print(f"inventory_databases: {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {"output": str(args.output), "totals": report["totals"]},
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
