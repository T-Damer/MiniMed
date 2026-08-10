#!/usr/bin/env python3
"""Shrink embedded base64 images in ambulatory-v1 markdown to ease WASM SQLite load time.

The app loads every content pack's full bytes into WASM memory at boot (via
sqlite3_deserialize), so a much larger ambulatory.db means a much slower boot on every route.
Re-OCR isn't needed here: the images are already extracted, this just recompresses them in place
(downscale + lower JPEG quality) before the next `ambulatory_pack.py` build.
"""

from __future__ import annotations

import base64
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/ingest/.venv/lib/python3.14/site-packages"))
import fitz  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "intermediate" / "ambulatory-v1"
DATA_URL = re.compile(r"data:image/(\w+);base64,([A-Za-z0-9+/=]+)")
MAX_DIMENSION = 900
JPEG_QUALITY = 55


def recompress(raw: bytes) -> bytes | None:
    try:
        pix = fitz.Pixmap(raw)
    except Exception:
        return None
    if pix.alpha:
        pix = fitz.Pixmap(pix, 0)
    if max(pix.width, pix.height) > MAX_DIMENSION:
        scale = MAX_DIMENSION / max(pix.width, pix.height)
        matrix = fitz.Matrix(scale, scale)
        doc = fitz.open()
        page = doc.new_page(width=pix.width * scale, height=pix.height * scale)
        page.insert_image(page.rect, pixmap=pix)
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1))
    return pix.tobytes("jpeg", jpg_quality=JPEG_QUALITY)


def process_file(path: Path) -> tuple[int, int, int]:
    text = path.read_text(encoding="utf-8")
    before_total = 0
    after_total = 0
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal before_total, after_total, count
        encoded = match.group(2)
        before_total += len(encoded)
        raw = base64.b64decode(encoded)
        recompressed = recompress(raw)
        if recompressed is None or len(recompressed) >= len(raw):
            after_total += len(encoded)
            return match.group(0)
        count += 1
        new_encoded = base64.b64encode(recompressed).decode("ascii")
        after_total += len(new_encoded)
        return f"data:image/jpeg;base64,{new_encoded}"

    new_text = DATA_URL.sub(replace, text)
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
    return count, before_total, after_total


def main() -> int:
    grand_before = 0
    grand_after = 0
    for path in sorted(SRC.glob("*.md")):
        count, before, after = process_file(path)
        if count == 0:
            continue
        grand_before += before
        grand_after += after
        print(
            f"{path.stem}: recompressed {count} images, "
            f"{before / 1024 / 1024:.1f}MB -> {after / 1024 / 1024:.1f}MB base64"
        )
    print(
        f"\nTotal: {grand_before / 1024 / 1024:.1f}MB -> {grand_after / 1024 / 1024:.1f}MB "
        f"({(1 - grand_after / max(grand_before, 1)) * 100:.0f}% smaller)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
