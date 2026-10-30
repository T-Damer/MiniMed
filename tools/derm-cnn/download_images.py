#!/usr/bin/env python3
"""Downloads the images an index CSV points at (Fitzpatrick17k: `md5hash`, `url`) into one folder,
named `<id>.jpg`. Resumable (existing files are skipped), a few connections at a time, failures
listed in `failed.txt` next to the images. Images are data only: nothing downloaded is executed."""

from __future__ import annotations

import argparse
import csv
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MiniMed-research/1.0"


def fetch(job: tuple[str, str, Path]) -> str | None:
    key, url, target = job
    if target.exists() and target.stat().st_size > 0:
        return None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
            if (
                len(data) < 1000
                or data[:3] != b"\xff\xd8\xff"
                and data[:4] != b"\x89PNG"
            ):
                return f"{key}\t{url}\tnot an image"
            partial = target.with_suffix(".part")
            partial.write_bytes(data)
            partial.rename(target)
            return None
        except Exception as error:  # noqa: BLE001 — every failure is reported in failed.txt
            if attempt == 2:
                return f"{key}\t{url}\t{type(error).__name__}"
            time.sleep(2 * (attempt + 1))
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--id-column", default="md5hash")
    parser.add_argument("--url-column", default="url")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument(
        "--url-contains", default="", help="only rows whose URL contains this"
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with args.index.open(encoding="utf-8") as handle:
        rows = [
            r
            for r in csv.DictReader(handle)
            if r[args.url_column].startswith("http")
            and args.url_contains in r[args.url_column]
        ]
    jobs = [
        (r[args.id_column], r[args.url_column], args.out / f"{r[args.id_column]}.jpg")
        for r in rows
    ]
    failures: list[str] = []
    done = 0
    with ThreadPoolExecutor(args.workers) as pool:
        for result in pool.map(fetch, jobs):
            done += 1
            if result:
                failures.append(result)
            if done % 500 == 0:
                print(f"{done}/{len(jobs)} failed {len(failures)}", flush=True)
    (args.out / "failed.txt").write_text("\n".join(failures) + "\n", encoding="utf-8")
    print(f"done {done}/{len(jobs)} failed {len(failures)}", flush=True)


if __name__ == "__main__":
    main()
