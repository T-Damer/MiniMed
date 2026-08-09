#!/usr/bin/env python3
"""Convert a Replicate marker OCR draft into ambulatory-v1 Markdown.

Reads data/intermediate/replicate-ocr/<doc_id>.ocr-draft.json (written by
scripts/replicate-ocr-pilot.mjs) and writes data/intermediate/ambulatory-v1/<doc_id>.md,
converting GFM tables and image references into the <!--localmed:source {"renderBlock":...}-->
markers that tools/ingest/src/localmed_ingest/markdown_parser.py already understands.
"""

from __future__ import annotations

import base64
import json
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DRAFT_DIR = ROOT / "data" / "intermediate" / "replicate-ocr"
OUT_DIR = ROOT / "data" / "intermediate" / "ambulatory-v1"

TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")
TABLE_SEPARATOR = re.compile(r"^\s*\|[\s:|-]+\|\s*$")
IMAGE_REF = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
BOLD_ITALIC = re.compile(r"\*{1,2}([^*]+)\*{1,2}")
HEADING_LINE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
IMAGE_EXTENSION_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def split_cells(row_line: str) -> list[str]:
    inner = row_line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    return [strip_markdown_emphasis(cell) for cell in inner.split("|")]


def strip_markdown_emphasis(value: str) -> str:
    return BOLD_ITALIC.sub(r"\1", value.strip())


def render_marker(payload: dict) -> str:
    return f"<!--localmed:source {json.dumps({'renderBlock': payload}, ensure_ascii=False)}-->"


def image_urls_by_filename(image_urls: list[str]) -> dict[str, str]:
    return {Path(urlparse(url).path).name: url for url in image_urls}


def fetch_image_data_url(url: str) -> str | None:
    mime = IMAGE_EXTENSION_MIME.get(Path(urlparse(url).path).suffix.lower())
    if mime is None:
        return None
    with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 (Replicate CDN only)
        payload = response.read()
    return f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"


def find_caption(lines: list[str], start: int) -> tuple[str, int]:
    index = start
    blanks_seen = 0
    while index < len(lines) and blanks_seen < 2:
        if not lines[index].strip():
            index += 1
            blanks_seen += 1
            continue
        match = re.match(r"^\*\*(.+)\*\*$", lines[index].strip())
        if match:
            return match.group(1), index + 1
        break
    return "", start


def convert_markdown(markdown: str, image_urls_by_name: dict[str, str]) -> tuple[str, int, int]:
    lines = markdown.splitlines()
    out: list[str] = []
    tables_converted = 0
    images_converted = 0
    data_url_cache: dict[str, str | None] = {}
    index = 0
    while index < len(lines):
        line = lines[index]

        if TABLE_ROW.match(line) and index + 1 < len(lines) and TABLE_SEPARATOR.match(lines[index + 1]):
            header_cells = split_cells(line)
            index += 2
            body_rows: list[list[str]] = []
            while index < len(lines) and TABLE_ROW.match(lines[index]):
                body_rows.append(split_cells(lines[index]))
                index += 1
            caption, index = find_caption(lines, index)
            rows = [
                {
                    "cells": [
                        {"text": text, "header": True, "rowSpan": 1, "colSpan": 1, "images": []}
                        for text in header_cells
                    ]
                },
                *(
                    {
                        "cells": [
                            {"text": text, "header": False, "rowSpan": 1, "colSpan": 1, "images": []}
                            for text in row
                        ]
                    }
                    for row in body_rows
                ),
            ]
            out.append(render_marker({"kind": "table", "caption": caption, "rows": rows}))
            out.append("")
            tables_converted += 1
            continue

        image_match = IMAGE_REF.search(line)
        image_name = image_match.group(2) if image_match else None
        if image_name and image_name in image_urls_by_name:
            if image_name not in data_url_cache:
                try:
                    data_url_cache[image_name] = fetch_image_data_url(image_urls_by_name[image_name])
                except OSError as cause:
                    print(f"warning: failed to fetch image {image_name}: {cause}", file=sys.stderr)
                    data_url_cache[image_name] = None
            data_url = data_url_cache[image_name]
            if data_url is not None:
                alt = image_match.group(1)
                out.append(render_marker({"kind": "image", "dataUrl": data_url, "alt": alt, "title": alt}))
                out.append("")
                images_converted += 1
                index += 1
                continue

        heading_match = HEADING_LINE.match(line)
        if heading_match:
            out.append(f"{heading_match.group(1)} {strip_markdown_emphasis(heading_match.group(2))}")
        else:
            out.append(line)
        index += 1

    return "\n".join(out).strip() + "\n", tables_converted, images_converted


def convert_one(doc_id: str) -> None:
    draft_path = DRAFT_DIR / f"{doc_id}.ocr-draft.json"
    if not draft_path.exists():
        print(f"no draft for {doc_id}: {draft_path}", file=sys.stderr)
        raise SystemExit(1)
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    markdown = draft["markdown"]
    image_urls_by_name = image_urls_by_filename(draft.get("imageUrls") or [])
    body, tables, images_used = convert_markdown(markdown, image_urls_by_name)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_md = OUT_DIR / f"{doc_id}.md"
    out_meta = OUT_DIR / f"{doc_id}.meta.json"
    out_md.write_text(body, encoding="utf-8")
    out_meta.write_text(
        json.dumps(
            {
                "id": doc_id,
                "source": draft["source"]["path"],
                "extractor": f"replicate-marker ({draft['model']})",
                "pages": draft.get("pageCount"),
                "bytes": len(body.encode("utf-8")),
                "tablesConverted": tables,
                "imagesConverted": images_used,
                "imagesAvailable": len(image_urls_by_name),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"OK {doc_id}: {len(body)} chars, {tables} tables, "
        f"{images_used}/{len(image_urls_by_name)} images converted -> {out_md}"
    )


def main() -> int:
    doc_ids = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
    if not doc_ids:
        print("Usage: replicate_ocr_import.py <doc_id> [doc_id ...]", file=sys.stderr)
        return 1
    for doc_id in doc_ids:
        convert_one(doc_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
