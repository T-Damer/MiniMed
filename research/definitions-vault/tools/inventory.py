"""Inventory of the curated definitions/aliases layer (measure only). Writes ../out/inventory.json."""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

import load_layer as L

OUT = Path(__file__).resolve().parents[1] / "out"


def shingles(t: str, k: int = 5) -> set[str]:
    w = t.split()
    return {" ".join(w[i : i + k]) for i in range(max(1, len(w) - k + 1))}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


ABBREV = {"abbreviation", "abbreviation-section"}
EXCERPT = {"section-excerpt", "source-description", "tool-description"}


def tier(d: L.Definition) -> str:
    cov = d.term.get("coverage") or d.term.get("recordType") or ""
    if cov in ABBREV:
        return "abbreviation"
    if cov in EXCERPT:
        return "section-excerpt"
    return "definition"


def tier_stats(defs: list[L.Definition]) -> dict:
    by: dict[str, list[L.Definition]] = collections.defaultdict(list)
    for d in defs:
        by[L.norm(d.title)].append(d)
    per = collections.Counter(len(g) for g in by.values())
    dt = collections.Counter(len({L.text_norm(d.text) for d in g}) for g in by.values())
    buckets = {"1": 0, "2": 0, "3-5": 0, "6-10": 0, "11-50": 0, ">50": 0}
    for k, v in per.items():
        b = (
            "1"
            if k == 1
            else "2"
            if k == 2
            else "3-5"
            if k <= 5
            else "6-10"
            if k <= 10
            else "11-50"
            if k <= 50
            else ">50"
        )
        buckets[b] += v
    dbk = {"1": 0, "2": 0, "3-5": 0, "6-10": 0, ">10": 0}
    for k, v in dt.items():
        b = (
            "1"
            if k == 1
            else "2"
            if k == 2
            else "3-5"
            if k <= 5
            else "6-10"
            if k <= 10
            else ">10"
        )
        dbk[b] += v
    return {
        "rows": len(defs),
        "concepts": len(by),
        "rows_per_concept_buckets": buckets,
        "distinct_texts_per_concept_buckets": dbk,
        "concepts_2plus_rows": sum(v for k, v in per.items() if k >= 2),
        "concepts_2plus_distinct_texts": sum(v for k, v in dt.items() if k >= 2),
        "distinct_texts": len({L.text_norm(d.text) for d in defs}),
        "top": sorted(((len(g), k) for k, g in by.items()), reverse=True)[:8],
    }


def main() -> None:
    defs = L.load_all()
    tiers = collections.defaultdict(list)
    for d in defs:
        tiers[tier(d)].append(d)
    abbr = collections.defaultdict(set)
    for d in tiers["abbreviation"]:
        abbr[d.title.strip()].add(L.text_norm(d.text))
    abbr_multi = {a: e for a, e in abbr.items() if len(e) > 1}
    abbr_res = {
        "abbreviation_forms": len(abbr),
        "abbreviations_with_2plus_expansions": len(abbr_multi),
        "max_expansions": max((len(e) for e in abbr.values()), default=0),
        "examples": sorted(((len(e), a) for a, e in abbr_multi.items()), reverse=True)[
            :10
        ],
        "distinct_expansions": len({e for es in abbr.values() for e in es}),
    }
    names = L.discovered_names()
    coll = L.load_colloquial()

    # --- concepts by normalized title
    by_title: dict[str, list[L.Definition]] = collections.defaultdict(list)
    for d in defs:
        by_title[L.norm(d.title)].append(d)
    term_entries = {(d.file, d.term_id) for d in defs}
    name_keys = {L.norm(n["title"]) for n in names}

    # --- union-find over title + aliases (concepts that share a surface form)
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    for key, group in by_title.items():
        find(key)
        for d in group:
            for a in d.aliases:
                if L.norm(a):
                    union(key, "alias:" + L.norm(a))
    clusters = collections.Counter(find(k) for k in by_title)

    # --- definitions per concept
    per = collections.Counter(len(g) for g in by_title.values())
    distinct_text_per = collections.Counter(
        len({L.text_norm(d.text) for d in g}) for g in by_title.values()
    )
    multi_sources = sum(
        1
        for g in by_title.values()
        if len(
            {
                (
                    d.family,
                    d.source.get("id"),
                    d.block.get("documentId") or d.block.get("path"),
                )
                for d in g
            }
        )
        >= 2
    )

    # --- aliases
    alias_targets: dict[str, set[str]] = collections.defaultdict(set)
    alias_count = 0
    for d in defs:
        for a in d.aliases:
            alias_count += 1
            alias_targets[L.norm(a)].add(L.norm(d.title))
    for r in coll:
        alias_targets[L.norm(r["alias"])].add(L.norm(r["canonicalTerm"]))
    collisions = {a: sorted(t) for a, t in alias_targets.items() if len(t) > 1}
    # alias equal to another concept's title
    alias_is_title = {
        a: sorted(t) for a, t in alias_targets.items() if a in by_title and a not in t
    }
    coll_targets = collections.Counter(L.norm(r["canonicalTerm"]) for r in coll)
    coll_alias = collections.defaultdict(set)
    for r in coll:
        coll_alias[L.norm(r["alias"])].add(L.norm(r["canonicalTerm"]))
    coll_canon_known = sum(1 for t in coll_targets if t in by_title)

    # --- duplicates
    exact = collections.defaultdict(list)
    for i, d in enumerate(defs):
        exact[L.text_norm(d.text)].append(i)
    exact_groups = [g for g in exact.values() if len(g) > 1]
    exact_cross_file = [g for g in exact_groups if len({defs[i].file for i in g}) > 1]
    exact_cross_concept = [
        g for g in exact_groups if len({L.norm(defs[i].title) for i in g}) > 1
    ]
    exact_same_concept_rows = sum(
        len(g) - len({L.norm(defs[i].title) for i in g}) for g in exact_groups
    )

    # near-duplicates within a concept: different normalized text, shingle Jaccard >= 0.8
    near_pairs = 0
    near_concepts = 0
    near_examples = []
    for key, g in by_title.items():
        texts = list({L.text_norm(d.text): d for d in g}.items())
        if len(texts) < 2 or len(texts) > 60:
            continue
        sh = [shingles(t) for t, _ in texts]
        hit = False
        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                if jaccard(sh[i], sh[j]) >= 0.8:
                    near_pairs += 1
                    hit = True
                    if len(near_examples) < 5:
                        near_examples.append([key, texts[i][1].file, texts[j][1].file])
        near_concepts += hit

    # dated batches only (files whose name carries 2026.09.*)
    dated = [d for d in defs if "2026.09" in d.file or "2026.9" in d.file]

    fam_terms = collections.Counter()
    fam_defs = collections.Counter(d.family for d in defs)
    for f, tid in term_entries:
        fam_terms[L.family_of(f)] += 1

    long_titles = sum(1 for k in by_title if len(k) > 120)
    unsafe = sum(
        1 for g in by_title.values() if any(c in g[0].title for c in '/\\:*?"<>|#^[]')
    )

    res = {
        "tiers": {t: tier_stats(v) for t, v in tiers.items()},
        "abbreviations_as_aliases": abbr_res,
        "definition_rows": len(defs),
        "dated_batch_rows": len(dated),
        "term_entries": len(term_entries),
        "files_loaded": len({d.file for d in defs}),
        "families": {
            f: {"terms": fam_terms[f], "definitions": fam_defs[f]} for f in fam_defs
        },
        "distinct_concepts_by_title": len(by_title),
        "concept_clusters_title_plus_alias": len(clusters),
        "discovered_names": len(names),
        "discovered_names_without_definition": len(name_keys - set(by_title)),
        "definitions_per_concept": {str(k): v for k, v in sorted(per.items())},
        "distinct_texts_per_concept": {
            str(k): v for k, v in sorted(distinct_text_per.items())
        },
        "concepts_with_2plus_definitions": sum(v for k, v in per.items() if k >= 2),
        "concepts_with_2plus_distinct_texts": sum(
            v for k, v in distinct_text_per.items() if k >= 2
        ),
        "concepts_with_2plus_sources": multi_sources,
        "max_definitions_one_concept": max(per),
        "top_concepts": sorted(
            ((len(g), k) for k, g in by_title.items()), reverse=True
        )[:12],
        "aliases_on_terms": alias_count,
        "distinct_alias_forms": len(alias_targets),
        "colloquial_aliases": len(coll),
        "colloquial_canonical_terms": len(coll_targets),
        "colloquial_canonical_with_definition": coll_canon_known,
        "colloquial_alias_collisions": {
            a: sorted(t) for a, t in coll_alias.items() if len(t) > 1
        },
        "alias_collisions": len(collisions),
        "alias_collision_examples": list(collisions.items())[:15],
        "alias_equals_other_concept_title": len(alias_is_title),
        "exact_duplicate_groups": len(exact_groups),
        "exact_duplicate_rows_redundant": sum(len(g) - 1 for g in exact_groups),
        "exact_duplicate_groups_cross_file": len(exact_cross_file),
        "exact_duplicate_groups_cross_concept": len(exact_cross_concept),
        "exact_duplicate_rows_same_concept": exact_same_concept_rows,
        "near_duplicate_pairs_within_concept_j08": near_pairs,
        "near_duplicate_concepts_j08": near_concepts,
        "near_examples": near_examples,
        "titles_over_120_chars": long_titles,
        "titles_with_filename_unsafe_chars": unsafe,
        "definition_chars_total": sum(len(d.text) for d in defs),
    }
    OUT.mkdir(exist_ok=True)
    L.write_report_json(OUT / "inventory.json", res)
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
