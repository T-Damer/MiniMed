"""OCR1: a Tesseract reading of the scan pages where the Vision text looks wrong.

    cd tools/ingest
    MINIMED_DATA_ROOT=<main checkout> uv run python scripts/grls_ocr_second_opinion.py --jobs 5

A page is read again when it is in a document graded `low` or has a low-confidence Vision line with two or more
words the native-text lexicon does not know. The page is rendered at 300 dpi (grayscale PNG, deleted at once) and
recognised by `scripts/ocr-tesseract-worker.mjs` (`tesseract.js`, `rus`+`eng`); the result is one JSON per page in
`data/build/grls-ocr-tesseract/<pdf sha256>/<page>.json`. `grls_ocr_requality.py run` merges it
(`localmed_ingest.ocr_second_opinion`). Resumable; nothing is written next to the PDFs. The directory is
intermediate data and is deleted once the modules are verified.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pymupdf

from localmed_ingest.grls_ocr_requality import read_jsonl
from localmed_ingest.ocr_text_cleanup import Lexicon
from localmed_ingest.sqlite_builder import repository_root

REPO = Path(os.environ.get("MINIMED_DATA_ROOT", repository_root()))
BUILD = REPO / "data" / "build"
WORD = re.compile(r"[а-яёА-ЯЁ]{5,}")
SUSPECT_CONFIDENCE = 0.55
SUSPECT_UNKNOWN_WORDS = 2
SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def suspect_page(page: dict[str, Any], lexicon: Lexicon) -> bool:
    for line in page.get("lines", []):
        text = str(line.get("text", ""))
        if float(line.get("confidence", 1.0)) > SUSPECT_CONFIDENCE or len(text) < 12:
            continue
        unknown = [w for w in WORD.findall(text) if lexicon.cyrillic.get(w.casefold(), 0) < 3]
        if len(unknown) >= SUSPECT_UNKNOWN_WORDS:
            return True
    return False


def plan_jobs(args: argparse.Namespace, lexicon: Lexicon) -> list[tuple[str, Path, int]]:
    manifest = {
        str(r["pdfSha256"]).removeprefix("sha256:"): args.raw_root / str(r["target"])
        for r in read_jsonl(args.manifest)
        if r.get("target")
    }
    overlay = {str(r["pdfSha256"]).removeprefix("sha256:"): r for r in read_jsonl(args.overlay)}
    low_first: list[tuple[str, Path, int]] = []
    rest: list[tuple[str, Path, int]] = []
    for checksum, row in overlay.items():
        payload_path = args.vision_dir / f"{checksum}.json"
        pdf = manifest.get(checksum)
        if not row.get("ocrPages") or pdf is None or not payload_path.is_file():
            continue
        wanted = set(row["ocrPages"])
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        low = row.get("ocrQuality") == "low"
        for page in payload["pages"]:
            number = int(page["page"])
            if number in wanted and (low or suspect_page(page, lexicon)):
                (low_first if low else rest).append((checksum, pdf, number))
    return low_first + rest


def worker_loop(
    jobs: queue.Queue[tuple[str, Path, int]],
    out: Path,
    scratch: Path,
    tessdata: Path,
    counters: dict[str, int],
    lock: threading.Lock,
) -> None:
    process = subprocess.Popen(
        ["node", str(SCRIPTS / "ocr-tesseract-worker.mjs"), str(tessdata)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        cwd=SCRIPTS.parent,
    )
    assert process.stdin is not None and process.stdout is not None
    documents: dict[str, Any] = {}
    try:
        while True:
            try:
                checksum, pdf, number = jobs.get_nowait()
            except queue.Empty:
                return
            target = out / checksum / f"{number}.json"
            if target.is_file():
                continue
            image = scratch / f"{threading.get_ident()}.png"
            try:
                document = documents.setdefault(checksum, pymupdf.open(pdf))
                document[number - 1].get_pixmap(dpi=300, colorspace=pymupdf.csGRAY).save(image)
                process.stdin.write(f"{image}\t{target}\n")
                process.stdin.flush()
                answer = process.stdout.readline().strip()
            except Exception as error:  # noqa: BLE001 - a page that cannot be rendered is counted, not fatal
                answer = f"error\t{image}\t{error}"
            finally:
                image.unlink(missing_ok=True)
            with lock:
                counters["done" if answer.startswith("done") else "failed"] += 1
                if len(documents) > 4:
                    for key in list(documents)[:-1]:
                        documents.pop(key).close()
    finally:
        process.stdin.close()
        process.wait(timeout=60)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=BUILD / "grls-instruction-text-manifest.jsonl"
    )
    parser.add_argument("--overlay", type=Path, default=BUILD / "grls-ocr-quality.jsonl")
    parser.add_argument("--lexicon", type=Path, default=BUILD / "grls-ocr-lexicon.json")
    parser.add_argument("--vision-dir", type=Path, default=BUILD / "grls-ocr-vision")
    parser.add_argument(
        "--raw-root", type=Path, default=REPO / "data" / "raw" / "grls-instructions-active"
    )
    parser.add_argument("--out", type=Path, default=BUILD / "grls-ocr-tesseract")
    parser.add_argument("--scratch", type=Path, default=BUILD / "grls-ocr-tesseract-scratch")
    parser.add_argument(
        "--tessdata", type=Path, default=REPO / "apps" / "app" / "public" / "tessdata"
    )
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    lexicon = Lexicon.from_json(json.loads(args.lexicon.read_text(encoding="utf-8")))
    planned = plan_jobs(args, lexicon)
    if args.limit:
        planned = planned[: args.limit]
    print(f"pages to read again: {len(planned)}", file=sys.stderr, flush=True)
    args.out.mkdir(parents=True, exist_ok=True)
    args.scratch.mkdir(parents=True, exist_ok=True)
    jobs: queue.Queue[tuple[str, Path, int]] = queue.Queue()
    for item in planned:
        jobs.put(item)
    counters = {"done": 0, "failed": 0}
    lock = threading.Lock()
    started = time.monotonic()
    threads = [
        threading.Thread(
            target=worker_loop, args=(jobs, args.out, args.scratch, args.tessdata, counters, lock)
        )
        for _ in range(args.jobs)
    ]
    for thread in threads:
        thread.start()
    while any(thread.is_alive() for thread in threads):
        time.sleep(30)
        print(
            f"{counters['done']}/{len(planned)} done, {counters['failed']} failed, "
            f"{time.monotonic() - started:.0f}s",
            file=sys.stderr,
            flush=True,
        )
    for thread in threads:
        thread.join()
    print(
        json.dumps(
            {"pages": len(planned), **counters, "seconds": round(time.monotonic() - started)}
        )
    )
    if args.scratch.exists():
        for leftover in args.scratch.glob("*.png"):
            leftover.unlink()


if __name__ == "__main__":
    main()
