#!/usr/bin/env python3
"""Assemble ambulatory-v1 Markdown workspace and build SQLite pack."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "intermediate" / "ambulatory-v1"
WORK = ROOT / "data" / "intermediate" / "ambulatory-pack"
OUT_DB = ROOT / "data" / "build" / "ambulatory.db"
OUT_REPORT = ROOT / "data" / "build" / "ambulatory-report.json"
PUBLISH = ROOT / "apps" / "app" / "public" / "content" / "ambulatory.db"

META: dict[str, dict[str, object]] = {
    "fp.posobie": {
        "title": "Клиническая педиатрия (пособие ФП)",
        "short_title": "Педиатрия ФП",
        "specialties": ["pediatrics"],
        "age_groups": ["children"],
    },
    "pdb.metodichka": {
        "title": "Клиническое исследование ребенка (ПДБ методичка)",
        "short_title": "ПДБ методичка",
        "specialties": ["pediatrics"],
        "age_groups": ["children"],
    },
    "pdb.pochivalov": {
        "title": "Детские болезни (Почивалов)",
        "short_title": "ДБ Почивалов",
        "specialties": ["pediatrics"],
        "age_groups": ["children"],
    },
    "inf.elizarik_tables": {
        "title": "Инфекции в таблицах (Елизарик)",
        "short_title": "Инфекции таблицы",
        "specialties": ["infectious-diseases", "pediatrics"],
        "age_groups": ["children", "adults"],
    },
    "inf.dd_tables": {
        "title": "Дифференциальная диагностика инфекционных болезней (таблицы)",
        "short_title": "ДД инфекций",
        "specialties": ["infectious-diseases"],
        "age_groups": ["children", "adults"],
    },
    "inf.constants": {
        "title": "Физиологические константы у детей",
        "short_title": "Константы детей",
        "specialties": ["pediatrics", "neonatology"],
        "age_groups": ["children", "neonates"],
    },
    "inf.chernov": {
        "title": "Инфекционные болезни (Чернов, Батищева)",
        "short_title": "Инфекции Чернов",
        "specialties": ["infectious-diseases"],
        "age_groups": ["children", "adults"],
    },
    "kf.sr_pedfak": {
        "title": "Клиническая фармакология (СР педфак)",
        "short_title": "Клинфарма СР",
        "specialties": ["clinical-pharmacology", "pediatrics"],
        "age_groups": ["children"],
    },
    "lor.bogomilsky": {
        "title": "Детская оториноларингология (Богомильский, Чистякова)",
        "short_title": "Детская оториноларингология",
        "specialties": ["otolaryngology", "pediatrics"],
        "age_groups": ["children"],
    },
    "neuro.uchebnoe": {
        "title": "Неврология (учебное пособие)",
        "short_title": "Неврология",
        "specialties": ["neurology"],
        "age_groups": ["children", "adults"],
    },
    "uro.urologiya": {
        "title": "Урология",
        "short_title": "Урология",
        "specialties": ["urology"],
        "age_groups": ["children", "adults"],
    },
    "ft.moiseev_t1": {
        "title": "Внутренние болезни (под ред. Моисеева, Мартынова, Мухина), том 1",
        "short_title": "Внутренние болезни, том 1",
        "specialties": ["internal-medicine"],
        "age_groups": ["adults"],
    },
    "ft.moiseev_t2": {
        "title": "Внутренние болезни (под ред. Моисеева, Мартынова, Мухина), том 2",
        "short_title": "Внутренние болезни, том 2",
        "specialties": ["internal-medicine"],
        "age_groups": ["adults"],
    },
    "ftiz.table": {
        "title": "Фтизиатрия (таблица форм)",
        "short_title": "Фтиза таблица",
        "specialties": ["phthisiology", "infectious-diseases"],
        "age_groups": ["children", "adults"],
    },
    "ftiz.lozovskaya": {
        "title": "Фтизиатрия детского возраста (под ред. Лозовской, Яровой)",
        "short_title": "Фтизиатрия детского возраста",
        "specialties": ["phthisiology", "pediatrics"],
        "age_groups": ["children"],
    },
    "psych.chastnaya": {
        "title": "Частная психиатрия (кафедральная методичка)",
        "short_title": "Психиатрия частная",
        "specialties": ["psychiatry"],
        "age_groups": ["children", "adults"],
    },
    "psych.obschaya": {
        "title": "Общая психопатология",
        "short_title": "Психопатология",
        "specialties": ["psychiatry"],
        "age_groups": ["children", "adults"],
    },
    "trauma.kotelnikov": {
        "title": "Травматология и ортопедия (Котельников, Ларцев, Рыжов), 2-е издание",
        "short_title": "Травматология и ортопедия",
        "specialties": ["traumatology", "orthopedics"],
        "age_groups": ["children", "adults"],
    },
    "neo.volodin_nr": {
        "title": "Неонатология — национальное руководство (Володин)",
        "short_title": "Неонатология (Володин)",
        "specialties": ["neonatology", "pediatrics"],
        "age_groups": ["neonates", "children"],
    },
    "neo.neuro_exam": {
        "title": "Неврологический осмотр новорожденного",
        "short_title": "Нео невроосмотр",
        "specialties": ["neonatology", "neurology"],
        "age_groups": ["neonates"],
    },
    "neo.shabalov": {
        "title": "Неонатология, том 1 (Шабалов), 6-е издание",
        "short_title": "Неонатология (Шабалов), том 1",
        "specialties": ["neonatology"],
        "age_groups": ["neonates"],
    },
}


def yaml_list(values: object) -> str:
    items = values if isinstance(values, list) else []
    return "\n".join(f"  - {item}" for item in items)


def frontmatter(doc_id: str, meta: dict[str, object], extractor: str) -> str:
    return (
        f"---\n"
        f"id: lit.ambulatory.{doc_id}\n"
        f"title: {meta['title']}\n"
        f"short_title: {meta['short_title']}\n"
        f"version_label: ambulatory-v1\n"
        f"source_type: medical_reference\n"
        f"status: draft\n"
        f"specialties:\n{yaml_list(meta['specialties'])}\n"
        f"age_groups:\n{yaml_list(meta['age_groups'])}\n"
        f"synthetic_fixture: false\n"
        f"metadata:\n"
        f"  collection: ambulatory-v1\n"
        f"  extractor: {extractor}\n"
        f"  rights:\n"
        f"    licenseId: private-educational-unreviewed\n"
        f"    allowsDerivativeProcessing: false\n"
        f"---\n\n"
    )


def normalize_body(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse extreme blank runs; keep structure.
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    if not text.startswith("#"):
        # Ensure at least one heading for sectioner.
        first = text.strip().split("\n", 1)[0][:80] or "Документ"
        text = f"# {first}\n\n{text}"
    return text.strip() + "\n"


def assemble() -> list[str]:
    if WORK.exists():
        for path in WORK.iterdir():
            if path.is_file():
                path.unlink()
    WORK.mkdir(parents=True, exist_ok=True)

    included: list[str] = []
    for md in sorted(SRC.glob("*.md")):
        doc_id = md.stem
        meta = META.get(doc_id)
        if not meta:
            print(f"skip unknown {doc_id}", file=sys.stderr)
            continue
        meta_path = SRC / f"{doc_id}.meta.json"
        extractor = "anydoc"
        if meta_path.exists():
            extractor = json.loads(meta_path.read_text(encoding="utf-8")).get(
                "extractor", extractor
            )
        body = normalize_body(md.read_text(encoding="utf-8"))
        out = WORK / f"lit.ambulatory.{doc_id}.md"
        out.write_text(frontmatter(doc_id, meta, extractor) + body, encoding="utf-8")
        included.append(doc_id)
        print(f"pack {doc_id} ({out.stat().st_size // 1024}KB)")

    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (WORK / "manifest.yaml").write_text(
        (
            "id: minimed.ambulatory.v1\n"
            "version: 0.1.0\n"
            "schemaVersion: 2\n"
            "title: MiniMed ambulatory literature v1\n"
            f"builtAt: \"{built}\"\n"
        ),
        encoding="utf-8",
    )
    (WORK / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
    return included


def build_and_publish() -> None:
    OUT_DB.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "uv",
        "run",
        "--project",
        "tools/ingest",
        "medbase",
        "build",
        "--input",
        str(WORK),
        "--output",
        str(OUT_DB),
        "--report",
        str(OUT_REPORT),
    ]
    print(" ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)
    PUBLISH.parent.mkdir(parents=True, exist_ok=True)
    PUBLISH.write_bytes(OUT_DB.read_bytes())
    print(f"published {PUBLISH} ({PUBLISH.stat().st_size // 1024}KB)")


def main() -> int:
    included = assemble()
    if not included:
        print("no sources", file=sys.stderr)
        return 1
    if "--assemble-only" in sys.argv:
        return 0
    build_and_publish()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
