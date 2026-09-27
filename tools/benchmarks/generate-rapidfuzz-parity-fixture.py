#!/usr/bin/env python3
"""Generates the RapidFuzz OSA/Levenshtein parity fixture for packages/search-lexical.

Not a project dependency: run with an ephemeral environment, e.g.

    uv run --with rapidfuzz==3.14.6 python tools/benchmarks/generate-rapidfuzz-parity-fixture.py \
        --cases /tmp/rf-cases.json \
        --output packages/search-lexical/src/rapidfuzz-parity.fixture.json

`--cases` is the output of `rapidfuzz-medication-experiment.py generate` (929 medication-name
cases: existing 162-case regression set plus deterministic corpus mutations). This script adds
the exact-control self-pairs, plus a deterministic set of random Cyrillic/Latin pairs (including
pairs that straddle the 64-code-unit bit-parallel/DP boundary), and records RapidFuzz's own
OSA/Levenshtein distance and normalized_similarity for every pair so packages/search-lexical's
parity test can assert exact equality against the ported TypeScript implementation.
"""

from __future__ import annotations

import argparse
import json
import random
import unicodedata
import re
from pathlib import Path
from typing import Any

CYRILLIC = "абвгдежзийклмнопрстуфхцчшщъыьэюяё"
LATIN = "abcdefghijklmnopqrstuvwxyz"


def norm(value: str) -> str:
    """Mirrors packages/search-lexical/src/normalize.ts normalizeSurfaceText."""
    value = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    value = re.sub(r"[‐‑‒–—−]", "-", value)
    value = re.sub(r"[^0-9a-zа-я\s.,:+/%-]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def random_pairs(rng: random.Random, count: int) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for _ in range(count):
        alphabet = CYRILLIC if rng.random() < 0.6 else LATIN
        len1 = rng.randint(0, 48)
        len2 = rng.randint(0, 48)
        a = "".join(rng.choice(alphabet) for _ in range(len1))
        b = "".join(rng.choice(alphabet) for _ in range(len2))
        pairs.append((a, b))
    return pairs


def boundary_pairs() -> list[tuple[str, str]]:
    pairs = [
        ("", ""),
        ("", "а"),
        ("а", ""),
        ("а", "а"),
        ("парацетамол", "парацетомол"),
        ("а" * 64, "а" * 64),
        ("а" * 64, "б" * 64),
        ("а" * 63, "а" * 64),
        ("а" * 64, "а" * 65),
        ("а" * 65, "а" * 65),
        ("а" * 65, "б" * 65),
        ("а" * 100, "б" * 100),
    ]
    return pairs


def build_cases(cases_path: Path, seed: int, random_count: int) -> list[dict[str, Any]]:
    payload = json.loads(cases_path.read_text(encoding="utf-8"))
    rng = random.Random(seed)
    pairs: list[tuple[str, str, str]] = []
    for row in payload["cases"]:
        pairs.append((f"medication.{row['id']}", str(row["query"]), str(row["target"])))
    for i, value in enumerate(payload["exactControls"]):
        pairs.append((f"exact-control.{i}", value, value))
    for i, (a, b) in enumerate(boundary_pairs()):
        pairs.append((f"boundary.{i}", a, b))
    for i, (a, b) in enumerate(random_pairs(rng, random_count)):
        pairs.append((f"random.{i}", norm(a), norm(b)))
    return [{"id": pid, "a": a, "b": b} for pid, a, b in pairs]


def score(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from rapidfuzz.distance import OSA, Levenshtein

    out = []
    for case in cases:
        a, b = case["a"], case["b"]
        out.append(
            {
                "id": case["id"],
                "a": a,
                "b": b,
                "osaDistance": OSA.distance(a, b),
                "osaNormalizedSimilarity": OSA.normalized_similarity(a, b),
                "levenshteinDistance": Levenshtein.distance(a, b),
                "levenshteinNormalizedSimilarity": Levenshtein.normalized_similarity(a, b),
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260927)
    parser.add_argument("--random-count", type=int, default=2000)
    args = parser.parse_args()

    from rapidfuzz import __version__ as rapidfuzz_version

    cases = build_cases(args.cases, args.seed, args.random_count)
    scored = score(cases)
    payload = {
        "format": "minimed-search-lexical-rapidfuzz-parity-v1",
        "rapidfuzzVersion": rapidfuzz_version,
        "seed": args.seed,
        "count": len(scored),
        "cases": scored,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"count": len(scored), "rapidfuzzVersion": rapidfuzz_version}))


if __name__ == "__main__":
    main()
