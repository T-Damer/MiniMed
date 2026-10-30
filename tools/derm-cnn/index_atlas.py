#!/usr/bin/env python3
"""Indexes Atlas Dermatológico (atlasdermatologico.com.br): every disease on the browse page, the
English name in its page title and the ids of its pictures, as a CSV `image_id,disease_id,disease,url`
that download_images.py then fetches. One request at a time, with a pause; pages are only parsed."""

from __future__ import annotations

import argparse
import csv
import re
import time
import urllib.request
from pathlib import Path

SITE = "http://atlasdermatologico.com.br"
AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) MiniMed-research/1.0"


def get(url: str) -> str:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read().decode("utf-8", "replace")
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3)
    return ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path, help="index CSV to write")
    args = parser.parse_args()
    browse = get(f"{SITE}/browse.jsf")
    diseases = sorted({int(m) for m in re.findall(r"diseaseId=(\d+)", browse)})
    rows: list[dict[str, str]] = []
    for number, disease_id in enumerate(diseases, 1):
        page = get(f"{SITE}/disease.jsf?diseaseId={disease_id}")
        title = re.search(r"<title>(.*?) - Pictures", page)
        name = title.group(1).strip().lower() if title else ""
        for image_id in sorted({int(m) for m in re.findall(r"imageId=(\d+)", page)}):
            rows.append(
                {
                    "image_id": f"atlas{image_id}",
                    "disease_id": str(disease_id),
                    "disease": name,
                    "url": f"{SITE}/img?imageId={image_id}",
                }
            )
        if number % 50 == 0:
            print(f"{number}/{len(diseases)} diseases, {len(rows)} images", flush=True)
        time.sleep(0.3)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["image_id", "disease_id", "disease", "url"]
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"done {len(diseases)} diseases, {len(rows)} images", flush=True)


if __name__ == "__main__":
    main()
