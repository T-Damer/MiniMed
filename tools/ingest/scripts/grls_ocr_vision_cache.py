"""Run the macOS Vision OCR helper over the OCR-derived instruction PDFs once and cache the raw result.

OCR1 (docs/CURRENT_STATE.md): the OCR text of the released GRLS instruction modules was extracted before
the extraction diagnostics recorded a recognition confidence. Re-running the same engine with the same
settings (`macos_vision_ocr.swift`, 1800 px page width, ru-RU + en-US, accurate level) over every PDF
whose text came from OCR gives the per-line confidence back and a raw payload the cleanup stage can
work from without OCR-ing a page twice.

    cd tools/ingest
    uv run python scripts/grls_ocr_vision_cache.py \
        --manifest ../../data/build/grls-instruction-text-manifest.jsonl \
        --raw-root ../../data/raw/grls-instructions-active \
        --out ../../data/build/grls-ocr-vision --jobs 6

Resumable (an existing payload is skipped), never touches the PDFs, writes one
`<sha256 of the PDF>.json` per document plus `failures.jsonl` for the PDFs the helper refused.
The compiled helper lives next to the payloads (`macos_vision_ocr`, built with `swiftc -O`).
The payloads are intermediate data: the cleaned workspace keeps what is needed (blocks, bbox,
confidence), so the directory is deleted when the OCR1 modules are verified.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

HELPER_SOURCE = Path(__file__).resolve().parents[1] / "macos_vision_ocr.swift"
TIMEOUT_SECONDS = 900


def build_helper(out: Path) -> Path:
    binary = out / "macos_vision_ocr"
    if not binary.is_file() or binary.stat().st_mtime < HELPER_SOURCE.stat().st_mtime:
        subprocess.run(
            ["swiftc", "-O", str(HELPER_SOURCE), "-o", str(binary)],
            check=True,
            capture_output=True,
            text=True,
        )
    return binary


def read_jobs(
    manifest: Path, raw_root: Path, only_ocr: bool, checksums: frozenset[str] = frozenset()
) -> list[tuple[str, Path]]:
    jobs: dict[str, Path] = {}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        row: dict[str, Any] = json.loads(line)
        checksum = row.get("pdfSha256")
        if checksums:
            if str(checksum) not in checksums:
                continue
        elif only_ocr and not row.get("ocr"):
            continue
        target = row.get("target")
        if isinstance(checksum, str) and isinstance(target, str):
            jobs.setdefault(checksum.removeprefix("sha256:"), raw_root / target)
    return sorted(jobs.items())


def run_one(binary: Path, checksum: str, pdf: Path, out: Path) -> dict[str, Any]:
    target = out / f"{checksum}.json"
    if target.is_file():
        return {"sha": checksum, "state": "cached"}
    started = time.monotonic()
    try:
        completed = subprocess.run(
            [str(binary), str(pdf)],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=True,
        )
        payload = json.loads(completed.stdout)
    except subprocess.TimeoutExpired:
        return {"sha": checksum, "state": "failed", "error": f"timeout {TIMEOUT_SECONDS}s"}
    except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        return {"sha": checksum, "state": "failed", "error": detail.strip()[-300:]}
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    temporary.replace(target)
    return {
        "sha": checksum,
        "state": "done",
        "pages": len(payload.get("pages", [])),
        "seconds": round(time.monotonic() - started, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=6)
    parser.add_argument("--all-pdfs", action="store_true", help="not only rows flagged OCR")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--checksums",
        type=Path,
        help="only these PDFs (one `sha256:…` per line): native text layers a lexicon check rejected",
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    binary = build_helper(args.out)
    wanted = (
        frozenset(line.strip() for line in args.checksums.read_text().splitlines() if line.strip())
        if args.checksums
        else frozenset()
    )
    jobs = read_jobs(args.manifest, args.raw_root, only_ocr=not args.all_pdfs, checksums=wanted)
    if args.limit:
        jobs = jobs[: args.limit]
    done = failed = cached = pages = 0
    started = time.monotonic()
    with (
        ThreadPoolExecutor(max_workers=args.jobs) as pool,
        (args.out / "failures.jsonl").open("a", encoding="utf-8") as failures,
    ):
        futures = [pool.submit(run_one, binary, sha, pdf, args.out) for sha, pdf in jobs]
        for future in as_completed(futures):
            result = future.result()
            if result["state"] == "cached":
                cached += 1
            elif result["state"] == "done":
                done += 1
                pages += int(result["pages"])
            else:
                failed += 1
                failures.write(json.dumps(result, ensure_ascii=False) + "\n")
                failures.flush()
            total = done + failed + cached
            if total % 25 == 0:
                print(
                    f"{total}/{len(jobs)} done={done} cached={cached} failed={failed} "
                    f"pages={pages} elapsed={time.monotonic() - started:.0f}s",
                    file=sys.stderr,
                    flush=True,
                )
    print(json.dumps({"jobs": len(jobs), "done": done, "cached": cached, "failed": failed}))


if __name__ == "__main__":
    main()
