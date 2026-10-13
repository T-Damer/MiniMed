"""Re-read the pages of the cached Vision payloads that came out as noise, turned by 90/180/270 degrees.

A scan stored sideways or upside down is recognised as nonsense by the macOS Vision helper. For every cached
page whose recognised Cyrillic words are mostly unknown to the native-text lexicon, the page is recognised
again in each turn (`macos_vision_ocr --pages N --rotate R`, the helper option the form scans already use) and
the turn with the most known words replaces the page when it is clearly better. The payload then records
`rotation` on the page; nothing else changes.

    cd tools/ingest
    MINIMED_DATA_ROOT=<main checkout> uv run python scripts/grls_ocr_vision_rescue.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, cast

from localmed_ingest.grls_ocr_requality import read_jsonl
from localmed_ingest.ocr_text_cleanup import Lexicon
from localmed_ingest.sqlite_builder import repository_root

REPO = Path(os.environ.get("MINIMED_DATA_ROOT", repository_root()))
BUILD = REPO / "data" / "build"
WORD = re.compile(r"[а-яёА-ЯЁ]{4,}")
MIN_WORDS = 15
MAX_KNOWN_RATIO = 0.5
MIN_GAIN = 1.5


def page_score(page: dict[str, Any], lexicon: Lexicon) -> tuple[int, int]:
    """(known Cyrillic words, all Cyrillic words of 4+ letters) of a recognised page."""
    words = WORD.findall(" ".join(str(line.get("text", "")) for line in page.get("lines", [])))
    known = sum(1 for word in words if lexicon.cyrillic.get(word.casefold(), 0) >= 3)
    return known, len(words)


def recognise(binary: Path, pdf: Path, page_number: int, rotation: int) -> dict[str, Any] | None:
    completed = subprocess.run(
        [str(binary), str(pdf), "--pages", str(page_number), "--rotate", str(rotation)],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if completed.returncode != 0:
        return None
    pages = cast(list[dict[str, Any]], json.loads(completed.stdout).get("pages", []))
    return pages[0] if pages else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=BUILD / "grls-instruction-text-manifest.jsonl"
    )
    parser.add_argument(
        "--raw-root", type=Path, default=REPO / "data" / "raw" / "grls-instructions-active"
    )
    parser.add_argument("--vision-dir", type=Path, default=BUILD / "grls-ocr-vision")
    parser.add_argument("--lexicon", type=Path, default=BUILD / "grls-ocr-lexicon.json")
    parser.add_argument("--report", type=Path, default=BUILD / "grls-ocr-rescue-report.json")
    args = parser.parse_args()
    lexicon = Lexicon.from_json(json.loads(args.lexicon.read_text(encoding="utf-8")))
    binary = args.vision_dir / "macos_vision_ocr"
    targets = {
        str(row["pdfSha256"]).removeprefix("sha256:"): args.raw_root / str(row["target"])
        for row in read_jsonl(args.manifest)
        if row.get("target")
    }
    report: list[dict[str, Any]] = []
    for payload_path in sorted(args.vision_dir.glob("*.json")):
        if payload_path.name == "failures.json":
            continue
        checksum = payload_path.stem
        pdf = targets.get(checksum)
        if pdf is None:
            continue
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        changed = False
        for index, page in enumerate(payload.get("pages", [])):
            if "rotation" in page:
                continue
            known, total = page_score(page, lexicon)
            if total < MIN_WORDS or known / total >= MAX_KNOWN_RATIO:
                continue
            best: tuple[int, int, dict[str, Any], int] | None = None
            for rotation in (180, 90, 270):
                candidate = recognise(binary, pdf, int(page["page"]), rotation)
                if candidate is None:
                    continue
                score = page_score(candidate, lexicon)
                if best is None or score[0] > best[0]:
                    best = (score[0], score[1], candidate, rotation)
            accepted = best is not None and best[0] >= max(MIN_GAIN * known, 8)
            report.append(
                {
                    "pdfSha256": checksum,
                    "page": page["page"],
                    "before": [known, total],
                    "after": [best[0], best[1]] if best else None,
                    "accepted": accepted,
                }
            )
            if accepted and best is not None:
                rotated = best[2]
                rotated["rotation"] = best[3]
                payload["pages"][index] = rotated
                changed = True
        if changed:
            payload_path.write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8"
            )
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {"pagesTried": len(report), "pagesFixed": sum(1 for r in report if r["accepted"])}
        )
    )


if __name__ == "__main__":
    main()
