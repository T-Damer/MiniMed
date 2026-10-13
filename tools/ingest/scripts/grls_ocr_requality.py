"""OCR1: re-prepare the OCR-derived GRLS instructions with the cleanup stage.

    cd tools/ingest
    uv run python scripts/grls_ocr_requality.py lexicon
    uv run python scripts/grls_ocr_requality.py run [--limit N] [--only ID ...]

Paths default to the main checkout's private data (`data/build`, `data/raw`, `data/intermediate`);
nothing private is committed. Needs the Vision cache from `scripts/grls_ocr_vision_cache.py`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from localmed_ingest.grls_ocr_requality import (
    build_lexicon,
    read_jsonl,
    reprepare_document,
    select_rows,
    write_document,
)
from localmed_ingest.ocr_text_cleanup import Lexicon
from localmed_ingest.sqlite_builder import repository_root

# Private data lives only in the main checkout: point MINIMED_DATA_ROOT at it from a worktree.
REPO = Path(os.environ.get("MINIMED_DATA_ROOT", repository_root()))
BUILD = REPO / "data" / "build"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["lexicon", "run"])
    parser.add_argument("--manifest", type=Path, default=BUILD / "grls-instruction-text-manifest.jsonl")
    parser.add_argument("--raw-root", type=Path, default=REPO / "data" / "raw" / "grls-instructions-active")
    parser.add_argument("--vision-dir", type=Path, default=BUILD / "grls-ocr-vision")
    parser.add_argument("--lexicon", type=Path, default=BUILD / "grls-ocr-lexicon.json")
    parser.add_argument("--workspace", type=Path, default=REPO / "data" / "intermediate" / "grls-ocr-cleaned")
    parser.add_argument("--overlay", type=Path, default=BUILD / "grls-ocr-quality.jsonl")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--only", nargs="*", default=[])
    parser.add_argument("--extra-checksums", type=Path, help="file with one extra pdfSha256 per line")
    args = parser.parse_args()
    rows = read_jsonl(args.manifest)
    if args.command == "lexicon":
        lexicon = build_lexicon(rows, REPO)
        args.lexicon.write_text(json.dumps(lexicon.to_json(), ensure_ascii=False), encoding="utf-8")
        print(f"lexicon: {len(lexicon.cyrillic)} cyrillic, {len(lexicon.latin)} latin words -> {args.lexicon}")
        return
    lexicon = Lexicon.from_json(json.loads(args.lexicon.read_text(encoding="utf-8")))
    extra = frozenset(
        line.strip() for line in args.extra_checksums.read_text().splitlines() if line.strip()
    ) if args.extra_checksums else frozenset()
    selected = select_rows(rows, extra)
    if args.only:
        selected = [row for row in selected if any(key in str(row["sourceId"]) for key in args.only)]
    done_ids: set[str] = set()
    if args.overlay.is_file() and not args.only and not args.limit:
        args.overlay.unlink()
    existing = {r["sourceId"]: r for r in read_jsonl(args.overlay)} if args.overlay.is_file() else {}
    workspace_label = str(args.workspace.resolve().relative_to((REPO / "tools" / "ingest").resolve(), walk_up=True))
    started = time.monotonic()
    produced = skipped = 0
    for row in selected:
        if args.limit and produced >= args.limit:
            break
        checksum = str(row["pdfSha256"]).removeprefix("sha256:")
        vision = args.vision_dir / f"{checksum}.json"
        if not vision.is_file():
            skipped += 1
            continue
        workspace = (REPO / "tools" / "ingest" / str(row["workspace"])).resolve()
        result = reprepare_document(
            row=row,
            pdf_path=args.raw_root / str(row["target"]),
            old_markdown=workspace / f"{row['sourceId']}.md",
            payload=json.loads(vision.read_text(encoding="utf-8")),
            lexicon=lexicon,
            workspace_label=workspace_label,
        )
        write_document(args.workspace, str(row["sourceId"]), result)
        existing[str(row["sourceId"])] = result.overlay
        done_ids.add(str(row["sourceId"]))
        produced += 1
        if produced % 100 == 0:
            print(f"{produced} documents, {time.monotonic() - started:.0f}s", file=sys.stderr, flush=True)
    with args.overlay.open("w", encoding="utf-8") as handle:
        for key in sorted(existing):
            handle.write(json.dumps(existing[key], ensure_ascii=False, sort_keys=True) + "\n")
    print(json.dumps({"produced": produced, "skippedNoVision": skipped, "overlayRows": len(existing)}))


if __name__ == "__main__":
    main()
