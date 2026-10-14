"""LEAF1: re-render the prepared patient leaflets so their table of contents stays one list.

Local-only, deterministic. Needs the main checkout's `data/` (set MINIMED_DATA_ROOT from a worktree).

    cd tools/ingest
    uv run python scripts/grls_contents_lists.py plan
    uv run python scripts/grls_contents_lists.py apply \\
        --out ../../data/intermediate/grls-contents-lists --overlay ../../data/build/grls-contents-lists.jsonl
    uv run python scripts/grls_contents_lists.py manufacturer \\
        --workspace ../../data/intermediate/manufacturer-instructions-m1

`plan` counts the documents whose extraction holds a leaflet contents list. `apply` writes the
re-rendered Markdown of those documents into a new workspace and the overlay the module builder
joins onto the manifest; the old workspaces, the manifest and the PDFs are not touched.
`manufacturer` does the same for the manufacturer-site workspace (`prepared-contents`, which the
builder prefers over `prepared-pdf-ocr1`, `prepared-pdf` and `prepared-text`).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from localmed_ingest.grls_contents_lists import (
    BodyNotReproducedError,
    Rerendered,
    overlay_row,
    rerender_contents,
)
from localmed_ingest.grls_instruction_modules import (
    load_registration_groups,
    plan_instructions,
    read_manifest_rows,
)
from localmed_ingest.models import ExtractedSource

WORKSPACE_LABEL = "../../data/intermediate/grls-contents-lists"


def _extraction(workspace: Path, document_id: str) -> ExtractedSource:
    path = workspace / ".localmed" / "extractions" / f"{document_id}.json"
    return ExtractedSource.model_validate_json(path.read_text(encoding="utf-8"))


def rerender_all() -> tuple[list[tuple[Rerendered, str]], list[dict[str, str]], int]:
    """(re-rendered documents with the workspace their extraction lives in, failures, documents)."""
    rows = read_manifest_rows(contents_overlay=None)
    plan, _skipped = plan_instructions(rows, load_registration_groups())
    results: list[tuple[Rerendered, str]] = []
    failures: list[dict[str, str]] = []
    for entry in plan:
        workspace = entry.path.parent
        try:
            result = rerender_contents(
                entry.document_id,
                entry.path.read_text(encoding="utf-8"),
                _extraction(workspace, entry.document_id),
            )
        except BodyNotReproducedError as error:
            failures.append({"documentId": entry.document_id, "reason": str(error)})
            continue
        if result is not None:
            results.append((result, str(entry.newest.get("workspace"))))
    return results, failures, len(plan)


def summarize(results: list[tuple[Rerendered, str]], failures: list[dict[str, str]], total: int):
    sizes = Counter(len(entry.entries) for result, _ in results for entry in result.runs)
    return {
        "documents": total,
        "withContentsList": len(results),
        "lists": sum(len(result.runs) for result, _ in results),
        "entriesPerList": dict(sorted(sizes.items())),
        "withoutHeader": sum(
            1
            for result, _ in results
            for run in result.runs
            if run.header_id is None and run.lead is None
        ),
        "headerInsideABlock": sum(
            1 for result, _ in results for run in result.runs if run.lead is not None
        ),
        "cutInsideABlock": sum(1 for result, _ in results for run in result.runs if run.split),
        "notReproduced": failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "apply", "manufacturer"])
    parser.add_argument("--out", type=Path)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--workspace", type=Path)
    args = parser.parse_args()
    if args.command == "manufacturer":
        from localmed_ingest.manufacturer_contents import rerender_manufacturer

        print(json.dumps(rerender_manufacturer(args.workspace), ensure_ascii=False, indent=2))
        return
    results, failures, total = rerender_all()
    summary = summarize(results, failures, total)
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
