"""Rank `ready-for-source-research` gap-inventory titles by external-source acquisition priority.

Read-only analysis over already-committed artifacts: docs/research/definition-gap-inventory-2026-09-28.json,
the clinical-source-excerpts drafts, apps/app/public/content/core.db (aliases), apps/app/public/content/mkb.db
(rubric titles) and tools/benchmarks/*.json. No network. No writes to any pack or draft; only a report.

Methodology mirrors docs/research/definition-gaps-2026-09.md (2026-09-27 one-off, not previously saved in-repo):
- clinicalMentions: occurrences of the normalized title in clinical-source-excerpts block text, with light
  Russian case-ending stripping (an estimate: polysemous short words are over-counted, rare inflections
  under-counted).
- alias: normalized title matches a core.db alias or canonical_term.
- benchmark: normalized title appears in a tools/benchmarks/*.json query string.
- mkb: normalized title exact-matches an MKB-10 rubric name (RLS module), after stripping the leading code.

Priority: high = clinicalMentions >= 20, or benchmark match, or (alias and clinicalMentions >= 5).
          medium = any clinicalMentions, alias, clinical kind (symptom/syndrome/scale/classification/tool),
                   or mkb match.
          low = everything else.
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLINICAL_KINDS = {"symptom", "syndrome", "scale", "classification", "tool"}

# Light Russian case/number ending stripper -- an approximation, not a real lemmatizer.
_SUFFIXES = (
    "иями", "иях", "ями", "ями", "ого", "его", "ому", "ему", "ыми", "ими",
    "ах", "ях", "ов", "ев", "ей", "ий", "ия", "ие", "ие", "ые", "ых", "ий",
    "ом", "ем", "ам", "ям", "у", "ю", "а", "я", "ы", "и", "е", "й",
)


def stem(word: str) -> str:
    lowered = word.lower()
    if len(lowered) <= 4:
        return lowered
    for suffix in _SUFFIXES:
        if lowered.endswith(suffix) and len(lowered) - len(suffix) >= 4:
            return lowered[: -len(suffix)]
    return lowered


def normalized_name(value: str) -> str:
    value = re.sub(r"\([^)]*\)", " ", value)
    value = value.replace("ё", "е")
    value = re.sub(r"[^0-9a-zа-я]+", " ", value.lower())
    return " ".join(value.split())


def title_stem_key(title: str) -> tuple[str, ...]:
    words = [w for w in normalized_name(title).split() if len(w) > 2]
    return tuple(stem(w) for w in words)


def load_clinical_stem_counts() -> Counter:
    counts: Counter = Counter()
    for path in sorted(glob.glob(str(ROOT / "content/definition-drafts/clinical-source-excerpts-2026.09.21.part-0*.json"))):
        data = json.loads(Path(path).read_bytes())
        for block in data["blocks"]:
            text = block.get("text", "")
            for word in re.findall(r"[A-Za-zА-Яа-яЁё]{4,}", text):
                counts[stem(word)] += 1
    return counts


def load_aliases() -> set[str]:
    names: set[str] = set()
    with sqlite3.connect(f"file:{ROOT}/apps/app/public/content/core.db?mode=ro", uri=True) as c:
        c.row_factory = sqlite3.Row
        for row in c.execute("SELECT canonical_term, alias FROM aliases"):
            names.add(normalized_name(row["canonical_term"]))
            names.add(normalized_name(row["alias"]))
    return names


def load_mkb_titles() -> set[str]:
    names: set[str] = set()
    with sqlite3.connect(f"file:{ROOT}/apps/app/public/content/mkb.db?mode=ro", uri=True) as c:
        c.row_factory = sqlite3.Row
        for row in c.execute("SELECT title FROM documents"):
            title = re.sub(r"^[A-Za-zА-Я0-9.\-]+(?:-[A-Za-zА-Я0-9.\-]+)?\s+", "", row["title"])
            title = re.sub(r",?\s*МКБ-10\s*$", "", title).strip()
            if title:
                names.add(normalized_name(title))
    return names


def _walk_queries(value: object, into: list[str]) -> None:
    if isinstance(value, dict):
        for key, sub in value.items():
            if key == "query" and isinstance(sub, str):
                into.append(sub)
            else:
                _walk_queries(sub, into)
    elif isinstance(value, list):
        for item in value:
            _walk_queries(item, into)


def load_benchmark_queries() -> list[str]:
    queries: list[str] = []
    for path in sorted(glob.glob(str(ROOT / "tools/benchmarks/*.json"))):
        if Path(path).name in {"package.json", "tsconfig.json"}:
            continue
        try:
            data = json.loads(Path(path).read_bytes())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        _walk_queries(data, queries)
    return [normalized_name(q) for q in queries]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a new output path")

    inventory = json.loads((ROOT / "docs/research/definition-gap-inventory-2026-09-28.json").read_bytes())
    rows = [r for r in inventory["rows"] if r["status"] == "ready-for-source-research"]

    clinical_stems = load_clinical_stem_counts()
    aliases = load_aliases()
    mkb_titles = load_mkb_titles()
    benchmark_queries = load_benchmark_queries()
    query_stem_sets = [{stem(w) for w in q.split() if len(w) > 2} for q in benchmark_queries]

    scored = []
    for row in rows:
        title = row["pendingIdentities"][0]["title"]
        kind = row["pendingIdentities"][0]["kind"]
        stems = title_stem_key(title)
        mentions = min((clinical_stems.get(s, 0) for s in stems), default=0) if stems else 0
        is_alias = normalized_name(title) in aliases
        is_mkb = normalized_name(title) in mkb_titles
        is_benchmark = bool(stems) and any(set(stems) <= qstems for qstems in query_stem_sets)
        if mentions >= 20 or is_benchmark or (is_alias and mentions >= 5):
            priority = "high"
        elif mentions >= 1 or is_alias or kind in CLINICAL_KINDS or is_mkb:
            priority = "medium"
        else:
            priority = "low"
        scored.append({
            "normalizedTitle": row["normalizedTitle"],
            "title": title,
            "kind": kind,
            "pendingIdentities": row["pendingIdentities"],
            "clinicalMentions": mentions,
            "alias": is_alias,
            "benchmark": is_benchmark,
            "mkb": is_mkb,
            "priority": priority,
        })

    scored.sort(key=lambda r: (-{"high": 2, "medium": 1, "low": 0}[r["priority"]], -r["clinicalMentions"], r["normalizedTitle"]))
    by_priority = Counter(r["priority"] for r in scored)
    report = {
        "schemaVersion": 1,
        "date": "2026-09-27",
        "methodology": __doc__,
        "totalReadyForSourceResearch": len(scored),
        "byPriority": dict(by_priority),
        "rows": scored,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"total": len(scored), "byPriority": dict(by_priority)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
