#!/usr/bin/env python3
"""Build a deterministic, read-only capability manifest for explicit SQLite packs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from localmed_ingest.capability_manifest import (  # noqa: E402
    build_capability_manifest,
    write_capability_manifest,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        action="append",
        required=True,
        help="SQLite database to inspect; repeat for multiple databases",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Atomic JSON manifest destination",
    )
    parser.add_argument("--generated-at", help="Timestamp override for deterministic manifests")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.output.suffix.lower() == ".db":
        print("build_capability_manifest: output must not use the .db extension", file=sys.stderr)
        return 2
    try:
        manifest = build_capability_manifest(args.database, generated_at=args.generated_at)
        write_capability_manifest(args.output, manifest)
    except (OSError, ValueError) as error:
        print(f"build_capability_manifest: {error}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {"output": str(args.output), "summary": manifest["summary"]},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
