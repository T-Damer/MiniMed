"""Automatic linking measurement over the whole layer. Writes ../out/links.json.

Dictionary: every concept (normalized title) with its titles + aliases, plus discovered names and
colloquial canonical terms. A link to a concept that has no definition is a gap link.
"""

from __future__ import annotations

import collections
import json
import statistics
import sys
import time
from pathlib import Path

import inventory as I
import linker as LK
import load_layer as L

OUT = Path(__file__).resolve().parents[1] / "out"


def main() -> None:
    defs = L.load_all()
    names = L.discovered_names()
    coll = L.load_colloquial()
    has_def: set[str] = set()
    tier_of: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    forms: dict[str, str] = {}
    for d in defs:
        k = L.norm(d.title)
        has_def.add(k)
        tier_of[k][I.tier(d)] += 1
        forms.setdefault(d.title, k)
        for a in d.aliases:
            forms.setdefault(a, k)
    for n in names:
        forms.setdefault(n["title"], L.norm(n["title"]))
    for r in coll:
        forms.setdefault(r["canonicalTerm"], L.norm(r["canonicalTerm"]))
        forms.setdefault(r["alias"], L.norm(r["canonicalTerm"]))

    def main_tier(k: str) -> str:
        return tier_of[k].most_common(1)[0][0] if k in tier_of else "name-only"

    res = {}
    for mode in ("exact", "stem"):
        t0 = time.time()
        lk = LK.Linker(forms, mode)
        per_tier = collections.defaultdict(collections.Counter)
        backlinks: dict[str, set[str]] = collections.defaultdict(set)
        gap_targets = collections.Counter()
        target_tiers = collections.Counter()
        links_total = 0
        targets_of: list[tuple[str, set[str]]] = []
        for d in defs:
            src = L.norm(d.title)
            t = I.tier(d)
            spans = [s for s in lk.find(d.text) if s[2] != src]
            c = per_tier[t]
            c["definitions"] += 1
            if not spans:
                continue
            resolved = [s for s in spans if s[2] in has_def]
            gaps = [s for s in spans if s[2] not in has_def]
            # links to concepts that are only abbreviations / section headings
            to_def_tier = [s for s in resolved if main_tier(s[2]) == "definition"]
            c["with_any_link"] += 1
            c["with_resolved_link"] += bool(resolved)
            c["with_link_to_definition_concept"] += bool(to_def_tier)
            c["with_gap_link"] += bool(gaps)
            c["links"] += len(spans)
            targets_of.append((t, {s[2] for s in resolved}))
            links_total += len(spans)
            for s in spans:
                backlinks[s[2]].add(src)
                target_tiers[main_tier(s[2])] += 1
            for s in gaps:
                gap_targets[s[2]] += 1
        hubs_set = {k for k, v in backlinks.items() if len(v) >= 100}
        for t, tg in targets_of:
            per_tier[t]["with_resolved_link_excluding_hubs100"] += bool(tg - hubs_set)
        bl = [len(backlinks.get(k, ())) for k in has_def]
        bl_def = [
            len(backlinks.get(k, ())) for k in has_def if main_tier(k) == "definition"
        ]
        hubs = sorted(((len(v), k) for k, v in backlinks.items()), reverse=True)[:15]
        names_wo_def = {L.norm(n["title"]) for n in names} - has_def
        res[mode] = {
            "seconds": round(time.time() - t0, 1),
            "per_tier": {k: dict(v) for k, v in per_tier.items()},
            "links_total": links_total,
            "link_target_tiers": dict(target_tiers),
            "gap_link_targets_distinct": len(gap_targets),
            "gap_link_occurrences": sum(gap_targets.values()),
            "discovered_names_without_definition": len(names_wo_def),
            "discovered_names_without_definition_linked": len(
                names_wo_def & set(gap_targets)
            ),
            "top_gap_targets": gap_targets.most_common(15),
            "backlinks_all_concepts": {
                "concepts": len(bl),
                "with_0": sum(1 for x in bl if x == 0),
                "with_1plus": sum(1 for x in bl if x >= 1),
                "with_5plus": sum(1 for x in bl if x >= 5),
                "median": statistics.median(bl),
                "mean": round(statistics.mean(bl), 2),
                "max": max(bl),
            },
            "backlinks_definition_concepts": {
                "concepts": len(bl_def),
                "with_0": sum(1 for x in bl_def if x == 0),
                "with_1plus": sum(1 for x in bl_def if x >= 1),
                "with_5plus": sum(1 for x in bl_def if x >= 5),
                "median": statistics.median(bl_def),
                "mean": round(statistics.mean(bl_def), 2),
            },
            "hubs": hubs,
            "hub_concepts_100plus_backlinks": len(hubs_set),
        }
    OUT.mkdir(exist_ok=True)
    (OUT / "links.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
