#!/usr/bin/env python3
"""Isolated RapidFuzz OSA experiment for medication-name candidate generation."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import statistics
import time
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

PREFIX = re.compile(r"^(?:(?:инструкция(?:\s+(?:к|по))?|препарат|лекарство|описание)\s+)")
SUFFIX = re.compile(
    r"\s+(?=\d|(?:мг|мл|mg|ml|таблетки|капсулы|раствор|инструкция|дозировка|"
    r"противопоказания|побочные\s+эффекты)(?:\s|$))"
)
NAME = re.compile(r"^(?:[а-я]+(?:[ -][а-я]+){0,3}|[a-z]+(?:[ -][a-z]+){0,3})$")
MARKED = re.compile(r"^(?:([а-я]{7,48})[ -]([а-я])|([a-z]{7,48})[ -]([a-z]))$")
CONFUSIONS = [
    ("и", "е"), ("е", "о"), ("а", "о"), ("д", "т"), ("з", "с"), ("ж", "ш"),
    ("б", "п"), ("в", "ф"), ("г", "к"), ("ш", "щ"), ("и", "й"), ("е", "э"),
]
NEGATIVE_CONTROLS = [
    "АД", "F20", "500 мг", "пневмония", "гипертензия", "шизофрения",
    "головокружение", "космический мармелад", "анализ крови", "рентгенография",
]


def norm(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    value = re.sub(r"[‐‑‒–—−]", "-", value)
    value = re.sub(r"[^0-9a-zа-я\s.,:+/%-]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def subject(query: str) -> str:
    value = norm(query)
    match = PREFIX.match(value)
    if match:
        value = value[match.end():]
    tail = SUFFIX.search(value)
    return value[: tail.start() if tail else len(value)].strip()


def sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def medication_rows(db_path: Path) -> list[tuple[str, str]]:
    with sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True) as db:
        return [
            (str(alias), str(canonical))
            for alias, canonical in db.execute(
                "SELECT alias, canonical_term FROM aliases WHERE category='medication'"
            )
        ]


def all_names(rows: list[tuple[str, str]]) -> list[str]:
    values: dict[str, str] = {}
    for alias, canonical in rows:
        for value in (alias, canonical):
            normalized = norm(value)
            if 1 <= len(normalized) <= 96 and NAME.fullmatch(normalized):
                values.setdefault(normalized, value)
    return [values[key] for key in sorted(values)]


def mutate(name: str, family: str, seed: str) -> str | None:
    marker = MARKED.fullmatch(name)
    stem = (marker.group(1) or marker.group(3)) if marker else name
    if not stem or len(stem) < 7:
        return None
    chars = list(stem)
    at = int(seed[:8], 16) % max(1, len(chars) - 1)
    if family == "rf-internal-swap":
        if at == 0:
            at = min(1, len(chars) - 2)
        chars[at], chars[at + 1] = chars[at + 1], chars[at]
    elif family == "rf-final-delete":
        chars.pop()
    elif family == "rf-final-double":
        chars.append(chars[-1])
    elif family == "rf-first-swap":
        chars[0], chars[1] = chars[1], chars[0]
    elif family == "rf-confusion":
        positions: list[tuple[int, str]] = []
        for index, char in enumerate(chars):
            for left, right in CONFUSIONS:
                if char == left:
                    positions.append((index, right))
                elif char == right:
                    positions.append((index, left))
        if not positions:
            return None
        pos, replacement = positions[int(seed[8:16], 16) % len(positions)]
        chars[pos] = replacement
    elif family == "rf-two-edits":
        chars[at], chars[at + 1] = chars[at + 1], chars[at]
        positions = [i for i, char in enumerate(chars) if any(char in pair for pair in CONFUSIONS)]
        if not positions:
            chars[-1] = "а" if chars[-1] != "а" else "о"
        else:
            pos = positions[int(seed[16:24], 16) % len(positions)]
            original = chars[pos]
            for left, right in CONFUSIONS:
                if original == left:
                    chars[pos] = right
                    break
                if original == right:
                    chars[pos] = left
                    break
    elif family == "rf-marker-omitted":
        if not marker:
            return None
    else:
        raise ValueError(f"unknown family: {family}")
    return "".join(chars)


def generate(args: argparse.Namespace) -> None:
    rows = medication_rows(args.db)
    names = all_names(rows)
    known = {norm(name) for name in names}
    previous = json.loads(args.previous.read_text(encoding="utf-8"))
    cases: list[dict[str, Any]] = [
        {
            "id": f"existing.{i}",
            "family": str(row["family"]),
            "query": str(row["query"]),
            "target": norm(str(row["sourceName"])),
            "origin": "existing-end-to-end-regression",
        }
        for i, row in enumerate(previous["cases"])
    ]
    families = [
        "rf-internal-swap", "rf-final-delete", "rf-final-double", "rf-first-swap",
        "rf-confusion", "rf-two-edits", "rf-marker-omitted",
    ]
    ordered = sorted(
        (name for name in names if re.fullmatch(r"[а-я]{7,30}(?:[ -][а-я])?", norm(name))),
        key=lambda name: sha("rapidfuzz-v1\0" + norm(name)),
    )
    used = {norm(row["query"]) for row in cases}
    for family in families:
        count = 0
        for original in ordered:
            source = norm(original)
            query = mutate(source, family, sha(f"{family}\0{source}"))
            if not query or query == source or query in known or query in used:
                continue
            cases.append(
                {
                    "id": f"{family}.{count}",
                    "family": family,
                    "query": query,
                    "target": source,
                    "origin": "deterministic-corpus-mutation",
                }
            )
            used.add(query)
            count += 1
            if count == args.per_family:
                break
        if count != args.per_family:
            raise RuntimeError(f"only {count} eligible cases for {family}")
    exact = sorted(known, key=lambda value: sha("rapidfuzz-exact-v1\0" + value))[:300]
    payload = {
        "format": "minimed-rapidfuzz-medication-cases-v1",
        "databaseSha256": hashlib.sha256(args.db.read_bytes()).hexdigest(),
        "previousReportSha256": hashlib.sha256(args.previous.read_bytes()).hexdigest(),
        "cases": cases,
        "exactControls": exact,
        "negativeControls": NEGATIVE_CONTROLS,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"cases": len(cases), "families": len(set(row["family"] for row in cases)), "exact": len(exact)}))


def candidate_index(
    rows: list[tuple[str, str]], projected: bool
) -> tuple[list[str], dict[str, list[str]], set[str]]:
    lookup_to_full: dict[str, set[str]] = defaultdict(set)
    known: set[str] = set()
    for alias, canonical in rows:
        for value in (alias, canonical):
            full = norm(value)
            known.add(full)
            if not NAME.fullmatch(full) or len(full) > 96:
                continue
            lookup_to_full[full].add(full)
            if projected:
                marked = MARKED.fullmatch(full)
                if marked:
                    stem = marked.group(1) or marked.group(3)
                    if stem:
                        lookup_to_full[stem].add(full)
    lookups = sorted(lookup_to_full)
    return lookups, {key: sorted(values) for key, values in lookup_to_full.items()}, known


def score_config(
    cases: list[dict[str, Any]],
    lookups: list[str],
    expanded: dict[str, list[str]],
    known: set[str],
    cutoff: float,
) -> tuple[list[dict[str, Any]], float]:
    from rapidfuzz import process
    from rapidfuzz.distance import OSA

    outcomes: list[dict[str, Any]] = []
    started = time.perf_counter()
    for row in cases:
        query = subject(str(row["query"]))
        if not query or query in known or not NAME.fullmatch(query):
            candidates: list[str] = []
        else:
            raw = process.extract(
                query,
                lookups,
                scorer=OSA.normalized_similarity,
                score_cutoff=cutoff,
                limit=12,
            )
            scored: dict[str, float] = {}
            for lookup, similarity, _ in raw:
                for full in expanded[str(lookup)]:
                    scored[full] = max(float(similarity), scored.get(full, -1.0))
            candidates = [
                name
                for name, _ in sorted(scored.items(), key=lambda item: (-item[1], item[0]))[:8]
            ]
        target = str(row["target"])
        rank = candidates.index(target) + 1 if target in candidates else None
        outcomes.append({**row, "rank": rank, "candidates": candidates})
    return outcomes, (time.perf_counter() - started) * 1000


def summarize_outcomes(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_family: dict[str, Any] = {}
    for family in sorted({str(row["family"]) for row in rows}):
        selected = [row for row in rows if row["family"] == family]
        by_family[family] = {
            "total": len(selected),
            "top1": sum(row["rank"] == 1 for row in selected),
            "top5": sum(row["rank"] is not None and row["rank"] <= 5 for row in selected),
            "top8": sum(row["rank"] is not None for row in selected),
        }
    return {
        "total": len(rows),
        "top1": sum(row["rank"] == 1 for row in rows),
        "top5": sum(row["rank"] is not None and row["rank"] <= 5 for row in rows),
        "top8": sum(row["rank"] is not None for row in rows),
        "byFamily": by_family,
    }


def score(args: argparse.Namespace) -> None:
    from rapidfuzz import __version__ as rapidfuzz_version

    payload = json.loads(args.cases.read_text(encoding="utf-8"))
    rows = medication_rows(args.db)
    cases = list(payload["cases"])
    cutoffs = [float(value) for value in args.cutoffs.split(",")]
    configurations: dict[str, Any] = {}
    misses: dict[str, Any] = {}
    for projected in (False, True):
        mode = "osa-full-names" if not projected else "osa-with-source-marker-projection"
        lookups, expanded, known = candidate_index(rows, projected)
        sweep: dict[str, Any] = {}
        for cutoff in cutoffs:
            outcomes, elapsed = score_config(cases, lookups, expanded, known, cutoff)
            summary = summarize_outcomes(outcomes)
            negatives, _ = score_config(
                [
                    {"id": f"negative.{i}", "family": "negative", "query": query, "target": "__none__"}
                    for i, query in enumerate(payload["negativeControls"])
                ],
                lookups,
                expanded,
                known,
                cutoff,
            )
            summary.update(
                {
                    "cutoff": cutoff,
                    "elapsedMs": elapsed,
                    "microsecondsPerCase": elapsed * 1000 / max(1, len(outcomes)),
                    "negativeControlsWithCandidates": sum(bool(row["candidates"]) for row in negatives),
                    "meanCandidateCount": statistics.fmean(len(row["candidates"]) for row in outcomes),
                }
            )
            sweep[f"{cutoff:.2f}"] = summary
            misses[f"{mode}@{cutoff:.2f}"] = [
                {"id": row["id"], "query": row["query"], "target": row["target"], "candidates": row["candidates"]}
                for row in outcomes
                if row["rank"] is None
            ][:50]
        configurations[mode] = {"lookupSurfaces": len(lookups), "sweep": sweep}
    current = json.loads(args.current.read_text(encoding="utf-8"))
    report = {
        "format": "minimed-rapidfuzz-medication-experiment-v1",
        "rapidfuzzVersion": rapidfuzz_version,
        "scorer": "rapidfuzz.distance.OSA.normalized_similarity",
        "databaseSha256": payload["databaseSha256"],
        "caseSha256": hashlib.sha256(args.cases.read_bytes()).hexdigest(),
        "cases": len(cases),
        "exactControls": len(payload["exactControls"]),
        "negativeControls": payload["negativeControls"],
        "currentMatcher": current,
        "rapidfuzz": configurations,
        "missSamples": misses,
        "boundary": (
            "Experimental candidate-generation benchmark only. RapidFuzz is not an application "
            "dependency and does not alter MedicalCore, medication identity, dosing, clinical parsing "
            "or released content. Mechanical cases are not independent clinician typo logs."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "missSamples"}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("generate")
    make.add_argument("--db", type=Path, required=True)
    make.add_argument("--previous", type=Path, required=True)
    make.add_argument("--output", type=Path, required=True)
    make.add_argument("--per-family", type=int, default=100)
    run = sub.add_parser("score")
    run.add_argument("--db", type=Path, required=True)
    run.add_argument("--cases", type=Path, required=True)
    run.add_argument("--current", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    run.add_argument("--cutoffs", default="0.65,0.70,0.75,0.80,0.85,0.90")
    args = parser.parse_args()
    if args.command == "generate":
        generate(args)
    else:
        score(args)


if __name__ == "__main__":
    main()
