#!/usr/bin/env python3
"""Fetches freely licensed skin photos from Wikimedia Commons: for every app class, the files of the
categories it lists under `commons` in skin-classes.json (and their direct subcategories), keeping
CC0, public-domain, CC BY and CC BY-SA photos. Writes data/raw/derm/commons/images/<class>/ and an
index.csv with the author, licence and file page of each photo, which the guide pack credits. One
request at a time, with a pause, as the Wikimedia API etiquette asks."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLASSES = ROOT / "apps/app/src/features/skin/skin-classes.json"
API = "https://commons.wikimedia.org/w/api.php"
AGENT = "MiniMed-research/1.0 (personal offline medical reference; github.com/T-Damer/MiniMed)"
LICENCE = re.compile(r"^(cc0|public domain|pd\b|cc by(-sa)? \d)", re.IGNORECASE)
# Not photos of the skin surface, or not of one patient's skin.
SKIP = re.compile(
    r"histolog|histopath|micrograph|microscop|\bh&e\b|stain|dermoscop|virus|bacteri|culture"
    r"|diagram|map\b|chart|stamp|poster|drawing|illustration|painting|lithograph|engraving"
    r"|\.svg|\.gif|\.tif",
    re.IGNORECASE,
)


def fetch(url: str) -> bytes:
    """GET with backoff: Commons answers bursts with 429 and a Retry-After."""
    for attempt in range(8):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if attempt == 7 or error.code not in (429, 500, 502, 503, 504):
                raise
            time.sleep(float(error.headers.get("Retry-After") or 10 * (attempt + 1)))
        except OSError:
            if attempt == 7:
                raise
            time.sleep(10 * (attempt + 1))
    return b""


def call(**params: str) -> dict:
    query = urllib.parse.urlencode({"format": "json", "formatversion": "2", **params})
    return json.loads(fetch(f"{API}?{query}"))


def members(category: str, kind: str) -> list[str]:
    titles: list[str] = []
    cont: dict[str, str] = {}
    while True:
        data = call(
            action="query",
            list="categorymembers",
            cmtitle=f"Category:{category}",
            cmtype=kind,
            cmlimit="500",
            **cont,
        )
        titles += [m["title"] for m in data.get("query", {}).get("categorymembers", [])]
        if "continue" not in data:
            return titles
        cont = {"cmcontinue": data["continue"]["cmcontinue"]}
        time.sleep(1)


def plain(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html or "").strip()


def file_infos(titles: list[str]) -> list[dict]:
    infos = []
    for start in range(0, len(titles), 40):
        data = call(
            action="query",
            titles="|".join(titles[start : start + 40]),
            prop="imageinfo",
            iiprop="url|extmetadata|mime",
            iiurlwidth="1280",
        )
        for page in data.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            infos.append(
                {
                    "title": page["title"],
                    "mime": info.get("mime", ""),
                    "url": info.get("thumburl") or info.get("url", ""),
                    "page": info.get("descriptionurl", ""),
                    "licence": plain(meta.get("LicenseShortName", {}).get("value", "")),
                    "author": plain(meta.get("Artist", {}).get("value", ""))[:200],
                    "description": plain(
                        meta.get("ImageDescription", {}).get("value", "")
                    )[:300],
                }
            )
        time.sleep(1)
    return infos


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "data/raw/derm/commons")
    args = parser.parse_args()
    classes = json.loads(CLASSES.read_text(encoding="utf-8"))["classes"]
    rows: list[dict[str, str]] = []
    for entry in classes:
        titles: set[str] = set()
        for category in entry.get("commons", []):
            titles.update(members(category, "file"))
            for sub in members(category, "subcat"):
                if not SKIP.search(sub):
                    titles.update(members(sub.removeprefix("Category:"), "file"))
        kept = 0
        for info in file_infos(sorted(titles)):
            if (
                info["mime"] not in ("image/jpeg", "image/png")
                or not LICENCE.match(info["licence"])
                or SKIP.search(info["title"] + " " + info["description"])
            ):
                continue
            key = hashlib.sha1(info["title"].encode()).hexdigest()[:16]
            target = args.out / "images" / entry["id"] / f"{key}.jpg"
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(fetch(info["url"]))
                time.sleep(2)
            rows.append(
                {
                    "class": entry["id"],
                    "file": str(target.relative_to(args.out)),
                    "title": info["title"],
                    "licence": info["licence"],
                    "author": info["author"],
                    "page": info["page"],
                }
            )
            kept += 1
        print(f"{entry['id']}: {kept} of {len(titles)} files", flush=True)
    with (args.out / "index.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["class", "file", "title", "licence", "author", "page"]
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"done {len(rows)} photos", flush=True)


if __name__ == "__main__":
    main()
