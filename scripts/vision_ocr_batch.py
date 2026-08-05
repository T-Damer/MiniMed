#!/usr/bin/env python3
"""OCR scanned ambulatory PDFs via macOS Vision → Markdown."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "intermediate" / "ambulatory-v1"
SWIFT = ROOT / "tools" / "ingest" / "macos_vision_ocr.swift"

# id → path under Med/
OCR_SOURCES: list[tuple[str, str]] = [
    ("psych.obschaya", "Психиатрия/obschaya_psikhopatologia_2.pdf"),
    ("lor.bogomilsky", "ЛОР/ЛОР_Богомильский.pdf"),
    ("neo.volodin_nr", "Нео/Литература/Володин-НЕОНАТОЛОГИЯ-Национальное-руководство.pdf"),
    ("neo.shabalov", "Нео/Литература/Шабалов_Нео_2016.pdf"),
    (
        "trauma.kotelnikov",
        "Травма/Литература/Травматология и ортопедия-Г-П-Котельников-Москва 2021_compressed.pdf",
    ),
    ("ft.moiseev_t1", "ФТ(ТФ)(ГТ)(ТГ)/Книги/ВнутренниеБолезниМоисеевТ1.pdf"),
]


def pages_to_markdown(payload: dict) -> str:
    chunks: list[str] = []
    for page in payload.get("pages", []):
        page_no = page.get("page", "?")
        lines = page.get("lines") or []
        text = "\n".join(str(line.get("text", "")).strip() for line in lines if line.get("text"))
        text = text.strip()
        if not text:
            continue
        chunks.append(f"## Страница {page_no}\n\n{text}\n")
    return "\n".join(chunks).strip() + ("\n" if chunks else "")


def ocr_one(doc_id: str, rel: str, force: bool) -> dict:
    src = ROOT / "Med" / rel
    dest = OUT / f"{doc_id}.md"
    meta = OUT / f"{doc_id}.meta.json"
    row: dict = {"id": doc_id, "path": str(src.relative_to(ROOT))}
    if not src.exists():
        row["status"] = "missing"
        return row
    if dest.exists() and dest.stat().st_size > 1000 and not force:
        row["status"] = "skip-exists"
        row["bytes"] = dest.stat().st_size
        return row

    print(f"OCR {doc_id} ← {rel}", flush=True)
    t0 = time.time()
    proc = subprocess.run(
        ["swift", str(SWIFT), str(src)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    elapsed = round(time.time() - t0, 1)
    if proc.returncode != 0:
        row["status"] = "failed"
        row["stderr"] = (proc.stderr or proc.stdout or "")[-800:]
        row["seconds"] = elapsed
        print(f"FAIL {doc_id} {elapsed}s: {row['stderr']}", file=sys.stderr)
        return row

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        row["status"] = "bad-json"
        row["error"] = str(exc)
        return row

    md = pages_to_markdown(payload)
    if len(md) < 200:
        row["status"] = "empty"
        row["seconds"] = elapsed
        return row

    OUT.mkdir(parents=True, exist_ok=True)
    dest.write_text(md, encoding="utf-8")
    meta.write_text(
        json.dumps(
            {
                "id": doc_id,
                "source": str(src.relative_to(ROOT)),
                "extractor": "macos-vision-ocr",
                "pages": len(payload.get("pages", [])),
                "bytes": dest.stat().st_size,
                "seconds": elapsed,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    row["status"] = "ok"
    row["bytes"] = dest.stat().st_size
    row["pages"] = len(payload.get("pages", []))
    row["seconds"] = elapsed
    print(f"OK {doc_id} pages={row['pages']} {row['bytes'] // 1024}KB {elapsed}s")
    return row


def main() -> int:
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    report: list[dict] = []
    for doc_id, rel in OCR_SOURCES:
        if only and doc_id not in only:
            continue
        report.append(ocr_one(doc_id, rel, force))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ocr-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(OUT / "ocr-report.json")
    return 0 if all(r["status"] in {"ok", "skip-exists"} for r in report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
