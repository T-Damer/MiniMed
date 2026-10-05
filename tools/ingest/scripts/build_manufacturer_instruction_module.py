"""Build the manufacturer-site instruction module (M1 documents, decision D2 of 2026-10-05).

Local-only, deterministic; planning and staging live in
`localmed_ingest.manufacturer_instruction_modules`.

    cd tools/ingest
    uv run --frozen python scripts/build_manufacturer_instruction_module.py plan
    uv run --frozen python scripts/build_manufacturer_instruction_module.py registry \
        --workspace ../../data/intermediate/manufacturer-instructions-m1
    # then the two `medbase prepare` commands the previous step prints (PDF: normal preparer with
    # the OCR fallback; DOCX: the collector's extracted text as a `text` source), then
    uv run --frozen python scripts/build_manufacturer_instruction_module.py build \
        --workspace ../../data/intermediate/manufacturer-instructions-m1 \
        --out ../../data/build/manufacturer-instruction-module

`build` writes `OUT/raw/<module id>.db` (lexical-only, search text kept: run
`medbase compact-module-search` afterwards) and `OUT/reports/<module id>.json`; the staged Markdown
copy is deleted as soon as the pack is built. Nothing outside the workspace and OUT is written.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from localmed_ingest.manufacturer_instruction_modules import (
    MODULE_ID,
    RAW_ROOT,
    build_module,
    plan_documents,
    read_manifest_rows,
    summarize,
    write_registries,
)

PREPARED_DIRS = ("prepared-pdf", "prepared-text")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "registry", "build"])
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    plan = plan_documents(read_manifest_rows())
    summary = summarize(plan)
    if args.command == "plan":
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    if args.workspace is None:
        raise SystemExit("--workspace is required.")
    workspace: Path = args.workspace
    if args.command == "registry":
        counts = write_registries(plan, workspace)
        print(json.dumps({**counts, "summary": summary}, ensure_ascii=False, indent=2))
        print("\nNext (sanitized environment, no credentials):")
        print(
            f"  uv run --frozen medbase prepare --registry {workspace}/registry-pdf.yaml "
            f"--source-root {RAW_ROOT} --output {workspace}/prepared-pdf --workers 4"
        )
        if counts["text"]:
            print(
                f"  uv run --frozen medbase prepare --registry {workspace}/registry-text.yaml "
                f"--source-root {workspace} --output {workspace}/prepared-text"
            )
        return
    if args.out is None:
        raise SystemExit("--out is required.")
    prepared = [workspace / name for name in PREPARED_DIRS if (workspace / name).is_dir()]
    if not prepared:
        raise SystemExit(f"No prepared workspaces ({', '.join(PREPARED_DIRS)}) in {workspace}.")
    result = build_module(args.out, plan, prepared)
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key not in {"documentIds", "documentSummaries"}
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"{MODULE_ID}: report written.")


if __name__ == "__main__":
    main()
