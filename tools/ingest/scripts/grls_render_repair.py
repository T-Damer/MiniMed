"""FIX-BATCH2: re-render the prepared ГРЛС instructions with the block repairs.

Local-only, deterministic. Needs the main checkout's `data/` (MINIMED_DATA_ROOT from a worktree).

    cd tools/ingest
    uv run python scripts/grls_render_repair.py plan
    uv run python scripts/grls_render_repair.py apply \\
        --out ../../data/intermediate/grls-render-repair \\
        --overlay ../../data/build/grls-render-repair.jsonl

`plan` counts what would change. `apply` writes the re-rendered Markdown of the changed documents
into a new workspace and the overlay the module builder joins last onto the manifest
(`read_manifest_rows`); the old workspaces, the manifest and the PDFs are not touched. The rules and
why they are safe: `localmed_ingest/grls_render_repair.py`.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from localmed_ingest.grls_contents_lists import BodyNotReproducedError
from localmed_ingest.grls_instruction_modules import (
    REPO_ROOT,
    load_registration_groups,
    plan_instructions,
    read_manifest_rows,
)
from localmed_ingest.grls_render_repair import (
    Repaired,
    overlay_row,
    rerender_repaired,
    summarize,
)
from localmed_ingest.models import ExtractedSource

WORKSPACE_LABEL = "../../data/intermediate/grls-render-repair"
INGEST_ROOT = REPO_ROOT / "tools" / "ingest"


def _workspace(label: str) -> Path:
    """A manifest workspace label (relative to tools/ingest) as a directory."""
    return (INGEST_ROOT / label).resolve()


def rerender_all() -> tuple[list[tuple[Repaired, str]], list[dict[str, str]], int]:
    """(repaired documents with the workspace their extraction lives in, failures, documents)."""
    rows = read_manifest_rows(repair_overlay=None)
    plan, _skipped = plan_instructions(rows, load_registration_groups())
    results: list[tuple[Repaired, str]] = []
    failures: list[dict[str, str]] = []
    for entry in plan:
        contents = cast(Mapping[str, Any] | None, entry.newest.get("contentsOverlay"))
        extraction_label = (
            str(contents["extractionWorkspace"])
            if contents is not None and contents.get("extractionWorkspace")
            else str(entry.newest.get("workspace"))
        )
        extraction_path = (
            _workspace(extraction_label) / ".localmed" / "extractions" / f"{entry.document_id}.json"
        )
        if not extraction_path.is_file():
            failures.append({"documentId": entry.document_id, "reason": "no stored extraction"})
            continue
        try:
            result = rerender_repaired(
                entry.document_id,
                entry.path.read_text(encoding="utf-8"),
                ExtractedSource.model_validate_json(extraction_path.read_text(encoding="utf-8")),
            )
        except BodyNotReproducedError as error:
            failures.append({"documentId": entry.document_id, "reason": str(error)})
            continue
        if result is not None:
            results.append((result, extraction_label))
    return results, failures, len(plan)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "apply"])
    parser.add_argument("--out", type=Path)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--examples", type=Path, help="write the changed documents, one per line")
    args = parser.parse_args()
    results, failures, total = rerender_all()
    summary = summarize([result for result, _ in results], failures, total)
    if args.examples is not None:
        args.examples.write_text(
            "\n".join(
                json.dumps(
                    {
                        "documentId": result.document_id,
                        "headingsDemoted": result.headings_demoted,
                        "flattenedTableBlocks": result.flattened_table_blocks,
                    },
                    ensure_ascii=False,
                )
                for result, _ in results
            )
            + "\n",
            encoding="utf-8",
        )
    if args.command == "plan":
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    if args.out is None or args.overlay is None:
        raise SystemExit("--out and --overlay are required.")
    if args.out.exists():
        raise SystemExit(f"{args.out} exists: remove it first (a re-render replaces it whole).")
    args.out.mkdir(parents=True)
    rows: list[str] = []
    for result, source_workspace in sorted(results, key=lambda item: item[0].document_id):
        (args.out / f"{result.document_id}.md").write_text(result.markdown, encoding="utf-8")
        rows.append(
            json.dumps(overlay_row(result, WORKSPACE_LABEL, source_workspace), ensure_ascii=False)
        )
    args.overlay.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
