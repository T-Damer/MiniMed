#!/usr/bin/env python3
"""Batch anydoc extract for ambulatory-v1 text-layer sources."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "intermediate" / "ambulatory-v1"

# id → relative path under Med/ (text-layer / office only)
SOURCES: list[tuple[str, str]] = [
    ("fp.posobie", "ФП/posobie_po_FP.pdf"),
    ("pdb.metodichka", "ПДБ/ПДБМетодичка_less.pdf"),
    ("pdb.pochivalov", "ПДБ/pochivalov-_db_uchebnik.pdf"),
    ("inf.elizarik_tables", "Инфекции/Infektsii_v_tablitsakh_ot_dr_Elizarik.pdf"),
    ("inf.dd_tables", "Инфекции/Differentsialnaya_diagnostika_infektsionnykh_bolezney_TABLITsA.pdf"),
    ("inf.constants", "Инфекции/Fiziologicheskie_konstanty_u_detei_774.pdf"),
    ("inf.chernov", "Инфекции/Инфекции-Чернов-Батищева.pdf"),
    ("kf.sr_pedfak", "КлинФарма/okonchatelny_SR_pedfak_KF.pdf"),
    ("lor.bogomilsky", "ЛОР/ЛОР_Богомильский.pdf"),
    ("neuro.uchebnoe", "Неврология(НЕРВЫ)/Литература/Nevrologia_Uchebnoe_posobie_dlya_studentov.pdf"),
    ("uro.urologiya", "Урология/urologiya.pdf"),
    ("ft.moiseev_t2", "ФТ(ТФ)(ГТ)(ТГ)/Книги/ВнутренниеБолезниМоисеевТ2.pdf"),
    ("ftiz.table", "Фтиза/Фтиз_Таблица.xlsx"),
    ("ftiz.lozovskaya", "Фтиза/ФтизаЛозовская.pdf"),
    ("psych.chastnaya", "Психиатрия/metodichka_kafedralnaya_po_chastnoy_psikhe.docx"),
    ("neo.volodin_nr", "Нео/Литература/Володин-НЕОНАТОЛОГИЯ-Национальное-руководство.pdf"),
    ("neo.neuro_exam", "Нео/К занятиям/Неврологический_осмотр_новорожденного.docx"),
]


def main() -> int:
    only = sys.argv[1:] if len(sys.argv) > 1 else None
    OUT.mkdir(parents=True, exist_ok=True)
    report: list[dict] = []
    for doc_id, rel in SOURCES:
        if only and doc_id not in only and not any(o in rel for o in only):
            continue
        src = ROOT / "Med" / rel
        dest = OUT / f"{doc_id}.md"
        meta = OUT / f"{doc_id}.meta.json"
        row: dict = {"id": doc_id, "path": str(src.relative_to(ROOT))}
        if not src.exists():
            row["status"] = "missing"
            report.append(row)
            print(f"MISSING {doc_id}", file=sys.stderr)
            continue
        if dest.exists() and dest.stat().st_size > 0 and "--force" not in sys.argv:
            row["status"] = "skip-exists"
            row["bytes"] = dest.stat().st_size
            report.append(row)
            print(f"SKIP {doc_id}")
            continue
        print(f"EXTRACT {doc_id} …", flush=True)
        proc = subprocess.run(
            ["npx", "--yes", "@firecrawl/anydoc", str(src), "-o", str(dest)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            row["status"] = "failed"
            row["stderr"] = (proc.stderr or proc.stdout or "")[-500:]
            report.append(row)
            print(f"FAIL {doc_id}: {row['stderr']}", file=sys.stderr)
            continue
        size = dest.stat().st_size if dest.exists() else 0
        meta.write_text(
            json.dumps(
                {
                    "id": doc_id,
                    "source": str(src.relative_to(ROOT)),
                    "extractor": "anydoc",
                    "bytes": size,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        row["status"] = "ok"
        row["bytes"] = size
        report.append(row)
        print(f"OK {doc_id} {size // 1024}KB")

    (OUT / "extract-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(OUT / "extract-report.json")
    failed = sum(1 for r in report if r["status"] == "failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
