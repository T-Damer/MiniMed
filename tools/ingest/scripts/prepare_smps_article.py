"""Deterministic page → Markdown for the СМПС article (markers as in krasotaimedicina_prepare).

Usage (from the repository root):
  uv run --project tools/ingest python -I tools/ingest/scripts/prepare_smps_article.py \
    "$PWD" content/reference-rf-pilot/sensomotor-psychosynthesis.md
then `medbase lint` and `medbase build --input content/reference-rf-pilot` into the bundled
reference.db.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

import yaml
from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag

RAW_DIR = "web-articles/psihosintez-sensomotorniy-psihosintez"
RAW_FILE = "psihosintez_sensomotorniy-psihosintez.html"
URL = "https://psihosintez.ru/sensomotorniy-psihosintez/"
FETCHED_AT = "2026-10-25T09:00:23Z"
# Owner's wording, verbatim (2026-10-25). It equals block 2 of the page after whitespace folding.
OWNER_ETYMOLOGY = (
    "Сенсомоторный психосинтез (СМПС) происходит от латинского sensus — «ощущение», motor — "
    "«приводящий в движение», от греческого душа ψυχή — «душа» и σύνθεσις — «совмещение»."
)
SPACE = re.compile(r"\s+")


def fold(value: str) -> str:
    return SPACE.sub(" ", unicodedata.normalize("NFC", value).replace("\xa0", " ")).strip()


def inline(node: Tag) -> str:
    parts: list[str] = []
    for child in node.children:
        if isinstance(child, NavigableString):
            parts.append(str(child))
        elif isinstance(child, Tag):
            text = inline(child)
            if child.name in {"strong", "b"} and text.strip():
                parts.append(f"**{text.strip()}**")
            elif child.name in {"em", "i"} and text.strip():
                parts.append(f"*{text.strip()}*")
            elif child.name == "br":
                parts.append(" ")
            else:
                # The page's links are empty Wikipedia anchors around a space; keep text only.
                parts.append(text)
    return fold("".join(parts))


def plain(node: Tag) -> str:
    return fold(node.get_text(" "))


def marker(raw_path: str, sha: str, selector: str, **extra: str) -> str:
    payload = {
        "sourceUrl": URL,
        "rawPath": raw_path,
        "rawSha256": sha,
        "selector": selector,
        **extra,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def main(repo: Path, output: Path) -> None:
    raw_path = f"{RAW_DIR}/{RAW_FILE}"
    payload = (repo / "data/raw" / raw_path).read_bytes()
    sha = hashlib.sha256(payload).hexdigest()
    source = json.loads((repo / "data/raw" / RAW_DIR / "SOURCE.json").read_text(encoding="utf-8"))
    if source["files"][0]["sha256"] != sha:
        raise SystemExit("raw checksum mismatch")
    soup = BeautifulSoup(payload, "html.parser")
    content = soup.select_one("article .entry-content")
    if not isinstance(content, Tag):
        raise SystemExit("no .entry-content")

    lines: list[str] = []
    pending_heading: str | None = None
    etymology_seen = False
    for index, block in enumerate(
        content.find_all(["h2", "h3", "h4", "p", "ol", "ul", "figure"], recursive=False), 1
    ):
        selector = f".entry-content:block-{index}"
        if block.name in {"h2", "h3", "h4"}:
            heading = f"{'#' * (int(block.name[1]) - 1)} {plain(block)}"
            if index == 1:
                pending_heading = heading  # «Метод СМПС» follows the etymology paragraph
            else:
                lines.extend([heading, ""])
            continue
        if block.name == "p":
            text = inline(block)
            if not text:
                continue
            if not etymology_seen:
                if plain(block) != OWNER_ETYMOLOGY:
                    raise SystemExit("owner etymology differs from the page's first paragraph")
                etymology_seen = True
                lines.extend(
                    [
                        "# Происхождение термина",
                        "",
                        marker(raw_path, sha, selector, wording="owner-2026-10-25"),
                        OWNER_ETYMOLOGY,
                        "",
                    ]
                )
                if pending_heading:
                    lines.extend([pending_heading, ""])
                continue
            lines.extend([marker(raw_path, sha, selector), text, ""])
            continue
        if block.name in {"ol", "ul"}:
            items = [inline(item) for item in block.find_all("li", recursive=False)]
            prefix = "1." if block.name == "ol" else "-"
            lines.extend(
                [
                    marker(raw_path, sha, selector),
                    *[f"{prefix} {item}" for item in items if item],
                    "",
                ]
            )
            continue
        if block.name == "figure":
            rows = [
                [plain(cell) for cell in row.find_all(["td", "th"])] for row in block.find_all("tr")
            ]
            lines.append(marker(raw_path, sha, selector))
            lines.append("")
            lines.append("| " + " | ".join(rows[0]) + " |")
            lines.append("| " + " | ".join("---" for _ in rows[0]) + " |")
            lines.extend("| " + " | ".join(row) + " |" for row in rows[1:])
            lines.append("")
            caption = block.find("figcaption")
            if isinstance(caption, Tag) and inline(caption):
                lines.extend([marker(raw_path, sha, f"{selector}:figcaption"), inline(caption), ""])
    if not etymology_seen:
        raise SystemExit("etymology paragraph not found")

    front = {
        "id": "reference.psihosintez.sensomotor-psychosynthesis",
        "title": "Сенсомоторный психосинтез (СМПС)",
        "short_title": "Сенсомоторный психосинтез",
        "version_label": f"site-{sha[:12]}",
        "source_type": "medical_reference",
        "status": "active",
        "specialties": ["psychology", "psychotherapy"],
        "age_groups": [],
        "source_file": URL,
        "source_checksum": f"sha256:{sha}",
        "synthetic_fixture": False,
        "metadata": {
            "authorityTier": "practitioner-site",
            "publisher": "psihosintez.ru",
            "jurisdiction": "ru",
            "officialSourceUrl": URL,
            "rawPath": raw_path,
            "fetchedAt": FETCHED_AT,
            "sourcePublishedAt": "2021-06-06",
            "sourceModifiedAt": "2023-06-10",
            "contentMode": "verbatim",
            "navigationAliases": ["СМПС", "Сенсомоторный психосинтез"],
            "etymology": [OWNER_ETYMOLOGY],
            "requiresReview": True,
            "rightsStatus": "unresolved",
        },
    }
    header = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, default_flow_style=False, width=1000
    ).rstrip()
    output.write_text(
        f"---\n{header}\n---\n\n" + "\n".join(lines).rstrip() + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
