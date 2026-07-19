#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

CARDS = [
    ("demo.pneumonia", "Внебольничная пневмония у детей", "Клиническая картина",
     "Лихорадка, кашель, тахипноэ, локальные аускультативные изменения и снижение сатурации направляют поиск к поражению нижних дыхательных путей.",
     "пневмония кашель температура лихорадка тахипноэ часто дышит сатурация одышка дыхание ребенок", 90),
    ("demo.bronchiolitis", "Острый бронхиолит", "Оценка тяжести",
     "У ребёнка раннего возраста свистящее дыхание, тахипноэ, втяжения грудной клетки и затруднение кормления требуют оценки дыхательной недостаточности и гидратации.",
     "бронхиолит свистящее дыхание хрипы тахипноэ втяжения младенец кормление сатурация", 80),
    ("demo.appendicitis", "Острый аппендицит", "Диагностический поиск",
     "Миграция боли от околопупочной области в правую подвздошную, усиление при движении или кашле, рвота и снижение аппетита требуют срочной очной оценки хирургом.",
     "аппендицит боль живот около пупка справа внизу правая подвздошная миграция рвота аппетит хирург", 100),
    ("demo.uti", "Инфекция мочевых путей у детей", "Исследование мочи",
     "Лихорадка без очевидного очага, дизурия, учащённое мочеиспускание, боль над лоном или в пояснице могут быть поводом для исследования мочи.",
     "инфекция мочевых путей имвп температура без очага дизурия больно мочиться часто мочится моча поясница", 90),
    ("demo.measles", "Корь", "Клинические ориентиры",
     "Высокая лихорадка, кашель, ринит, конъюнктивит и сыпь с началом на лице требуют уточнения вакцинации, контактов и эпидемиологического анамнеза.",
     "корь высокая температура кашель насморк ринит конъюнктивит сыпь лицо вакцинация контакт", 85),
    ("demo.meningococcal", "Менингококковая инфекция", "Красные флаги",
     "Быстрое ухудшение, лихорадка, нарушение сознания, ригидность шеи или геморрагическая сыпь требуют немедленной экстренной оценки.",
     "менингококк менингит геморрагическая сыпь не бледнеет сознание ригидность шеи экстренно", 110),
    ("demo.gastroenteritis", "Острый гастроэнтерит", "Оценка обезвоживания",
     "Рвота и диарея требуют оценки частоты стула, способности пить, диуреза, массы тела, слизистых и общего состояния.",
     "гастроэнтерит кишечная инфекция рвота диарея жидкий стул обезвоживание пить диурез масса", 75),
    ("demo.urticaria", "Крапивница", "Кожные и системные симптомы",
     "Быстро возникающие зудящие волдыри могут соответствовать крапивнице. Отёк языка, осиплость или затруднение дыхания требуют экстренной оценки.",
     "крапивница волдыри зуд сыпь отек язык осиплость аллергия анафилаксия дыхание", 80),
    ("demo.atopic", "Атопический дерматит", "Хроническое воспаление кожи",
     "Хронический зуд, сухость кожи и типичная возрастная локализация направляют поиск к атопическому дерматиту и оценке ухода за кожей.",
     "атопический дерматит экзема зуд сухость кожа складки щеки хронический", 70),
]


def build(output: Path, report: Path | None) -> dict[str, object]:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    db = sqlite3.connect(output)
    db.executescript(
        """
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        PRAGMA user_version = 3;
        CREATE TABLE app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE knowledge_cards(
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            section TEXT NOT NULL,
            body TEXT NOT NULL,
            keywords TEXT NOT NULL,
            priority INTEGER NOT NULL
        );
        CREATE INDEX knowledge_cards_priority_idx
            ON knowledge_cards(priority DESC, title ASC);
        """
    )
    db.executemany("INSERT INTO knowledge_cards VALUES (?, ?, ?, ?, ?, ?)", CARDS)
    db.executemany(
        "INSERT INTO app_meta VALUES (?, ?)",
        [
            ("pack_id", "minimed.synthetic-core"),
            ("pack_version", "0.3.0-alpha.3"),
            ("schema_version", "3"),
            ("document_count", str(len(CARDS))),
            ("generated_at", "2026-07-19T00:00:00Z"),
            ("disclaimer", "SYNTHETIC DEMO - NOT CLINICAL GUIDANCE"),
        ],
    )
    quick_check = db.execute("PRAGMA quick_check").fetchone()[0]
    assert quick_check == "ok"
    db.commit()
    db.close()
    result = {
        "packId": "minimed.synthetic-core",
        "version": "0.3.0-alpha.3",
        "schemaVersion": 3,
        "cardCount": len(CARDS),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "quickCheck": quick_check,
        "synthetic": True,
    }
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.report), ensure_ascii=False))


if __name__ == "__main__":
    main()
