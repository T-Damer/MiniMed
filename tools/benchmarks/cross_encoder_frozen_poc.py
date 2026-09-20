#!/usr/bin/env python3
"""Zero-shot cross-encoder reranker PoC over MiniMed frozen search candidates.

This benchmark deliberately keeps retrieval frozen. The external model sees only
(query, candidate display/evidence text) pairs. Internal MiniMed document/concept
IDs are used for bookkeeping in the report but are never part of model input.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import resource
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

DEFAULT_MODEL = "ARGA100/ru-reranker-modernbert-small"
DEFAULT_REVISION = "8d4ea05d7c793bc812879ca18e7e310ac4cb228f"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def candidate_text(row: dict[str, Any]) -> str:
    candidate = row["candidate"]
    values: list[str] = [candidate["canonicalName"]]
    short_title = candidate.get("shortTitle")
    if short_title:
        values.append(short_title)
    values.extend(candidate.get("navigationAliases") or [])
    values.extend(candidate.get("declaredAliases") or [])
    evidence = candidate.get("evidence")
    if evidence:
        values.append(evidence)

    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        clean = " ".join(str(value).split()).strip()
        key = clean.casefold()
        if not clean or key in seen:
            continue
        seen.add(key)
        result.append(clean)
    return "\n".join(result)


def load_frozen(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        value = json.loads(raw)
        if value.get("schemaVersion") != 2:
            raise ValueError(f"{path}:{line_no}: expected schemaVersion=2")
        if value.get("origin") == "legacy-pilot-training":
            raise ValueError(f"{path}:{line_no}: qualification input must not be legacy training")
        rank = value.get("retrieval", {}).get("originalRank")
        if not isinstance(rank, int) or rank < 1:
            raise ValueError(f"{path}:{line_no}: invalid originalRank")
        grade = value.get("label", {}).get("relevanceGrade")
        if not isinstance(grade, int) or not 0 <= grade <= 3:
            raise ValueError(f"{path}:{line_no}: invalid relevanceGrade")
        rows.append(value)
    if not rows:
        raise ValueError(f"Frozen candidate input is empty: {path}")
    validate_groups(rows)
    return rows


def grouped(rows: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[row["fixtureId"]].append(row)
    for fixture_rows in groups.values():
        fixture_rows.sort(key=lambda row: row["retrieval"]["originalRank"])
    return dict(groups)


def validate_groups(rows: list[dict[str, Any]]) -> None:
    for fixture_id, fixture_rows in grouped(rows).items():
        first = fixture_rows[0]
        seen_docs: set[str] = set()
        expected_rank = 1
        for row in fixture_rows:
            if row["query"] != first["query"] or row.get("origin") != first.get("origin"):
                raise ValueError(f"{fixture_id}: mixed query/origin inside frozen candidate group")
            rank = row["retrieval"]["originalRank"]
            if rank != expected_rank:
                raise ValueError(
                    f"{fixture_id}: ranks must be contiguous from 1; expected {expected_rank}, got {rank}"
                )
            expected_rank += 1
            doc_id = row["candidate"]["documentId"]
            if doc_id in seen_docs:
                raise ValueError(f"{fixture_id}: duplicate documentId {doc_id}")
            seen_docs.add(doc_id)


def dcg(grades: list[int]) -> float:
    return sum((2**grade - 1) / math.log2(index + 2) for index, grade in enumerate(grades))


def fixture_metrics(rows: list[dict[str, Any]]) -> dict[str, float]:
    grades = [int(row["label"]["relevanceGrade"]) for row in rows]
    max_grade = max(grades, default=0)
    relevant = [row for row in rows if row["label"]["relevanceGrade"] > 0]
    relevant_ids = {row["candidate"]["documentId"] for row in relevant}
    relevant_weight = sum(row["label"]["relevanceGrade"] for row in relevant)

    def recall(limit: int, weighted: bool) -> float:
        selected = {row["candidate"]["documentId"] for row in rows[:limit]}
        if weighted:
            denominator = relevant_weight
            numerator = sum(
                row["label"]["relevanceGrade"]
                for row in relevant
                if row["candidate"]["documentId"] in selected
            )
        else:
            denominator = len(relevant_ids)
            numerator = len(relevant_ids & selected)
        return 0.0 if denominator == 0 else numerator / denominator

    ideal = sorted((int(row["label"]["relevanceGrade"]) for row in relevant), reverse=True)

    def ndcg(limit: int) -> float:
        ideal_score = dcg(ideal[:limit])
        if ideal_score == 0:
            return 0.0
        return dcg(grades[:limit]) / ideal_score

    first_relevant = next((i for i, grade in enumerate(grades) if grade > 0), -1)
    return {
        "top1MaxGrade": float(bool(max_grade > 0 and grades and grades[0] == max_grade)),
        "relevantRecallAt20": recall(20, False),
        "relevantRecallAt40": recall(40, False),
        "weightedRecallAt20": recall(20, True),
        "weightedRecallAt40": recall(40, True),
        "ndcgAt5": ndcg(5),
        "ndcgAt10": ndcg(10),
        "mrrAt20": 1.0 / (first_relevant + 1) if 0 <= first_relevant < 20 else 0.0,
        "forbiddenRateAt5": float(any(row["label"].get("forbidden") for row in rows[:5])),
    }


def evaluate(groups: dict[str, list[dict[str, Any]]]) -> dict[str, float | int]:
    fixture_values = [fixture_metrics(rows) for rows in groups.values()]
    if not fixture_values:
        return {"fixtureCount": 0}
    keys = list(fixture_values[0])
    return {
        "fixtureCount": len(fixture_values),
        **{
            key: sum(float(item[key]) for item in fixture_values) / len(fixture_values)
            for key in keys
        },
    }


def slices(groups: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, dict[str, float | int]]]:
    result: dict[str, dict[str, dict[str, float | int]]] = {}
    for key in ("family", "goal"):
        values = sorted({str(rows[0].get(key, "")) for rows in groups.values()})
        result[key] = {
            value: evaluate(
                {
                    fixture_id: rows
                    for fixture_id, rows in groups.items()
                    if str(rows[0].get(key, "")) == value
                }
            )
            for value in values
        }
    return result


def score_rows(
    rows: list[dict[str, Any]],
    *,
    model_name: str,
    revision: str,
    batch_size: int,
    max_length: int,
) -> tuple[list[float], dict[str, Any]]:
    try:
        import numpy as np
        import torch
        from sentence_transformers import CrossEncoder
    except ImportError as exc:
        raise RuntimeError(
            "Cross-encoder PoC requires sentence-transformers, numpy, and CPU torch."
        ) from exc

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    load_started = time.perf_counter()
    model = CrossEncoder(
        model_name,
        revision=revision,
        max_length=max_length,
        device="cpu",
        trust_remote_code=False,
    )
    load_seconds = time.perf_counter() - load_started

    pairs = [(row["query"], candidate_text(row)) for row in rows]
    input_digest = hashlib.sha256()
    for query, evidence in pairs:
        input_digest.update(query.encode("utf-8"))
        input_digest.update(b"\0")
        input_digest.update(evidence.encode("utf-8"))
        input_digest.update(b"\n")

    score_started = time.perf_counter()
    raw_scores = model.predict(
        pairs,
        batch_size=batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    scoring_seconds = time.perf_counter() - score_started
    values = np.asarray(raw_scores, dtype=np.float64).reshape(-1)
    if len(values) != len(rows):
        raise RuntimeError(f"Model returned {len(values)} scores for {len(rows)} candidates")
    if not np.all(np.isfinite(values)):
        raise RuntimeError("Model returned non-finite relevance scores")

    parameters = sum(parameter.numel() for parameter in model.model.parameters())
    parameter_bytes = sum(
        parameter.numel() * parameter.element_size() for parameter in model.model.parameters()
    )
    rss_kib = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_bytes = rss_kib * 1024 if sys.platform.startswith("linux") else rss_kib
    metadata = {
        "modelId": model_name,
        "revision": revision,
        "declaredLicense": "mit",
        "parameterCount": int(parameters),
        "parameterBytesLoaded": int(parameter_bytes),
        "maxLength": max_length,
        "batchSize": batch_size,
        "modelLoadSeconds": load_seconds,
        "scoringSeconds": scoring_seconds,
        "millisecondsPerCandidate": 1000.0 * scoring_seconds / len(rows),
        "processPeakRssBytes": int(rss_bytes),
        "torchVersion": torch.__version__,
        "modelInputSha256": input_digest.hexdigest(),
        "modelInput": (
            "query + canonicalName + shortTitle + navigationAliases + declaredAliases + evidence; "
            "documentId/conceptId excluded"
        ),
        "scoreMeaning": "relevance ordering score only; not a disease probability",
    }
    return [float(value) for value in values], metadata


def apply_scores(
    rows: list[dict[str, Any]], scores: list[float]
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    if len(rows) != len(scores):
        raise ValueError("Score count does not match candidate count")
    decorated: list[dict[str, Any]] = []
    for row, score in zip(rows, scores, strict=True):
        copied = dict(row)
        copied["_crossEncoderScore"] = float(score)
        decorated.append(copied)

    result: dict[str, list[dict[str, Any]]] = {}
    for fixture_id, fixture_rows in grouped(decorated).items():
        result[fixture_id] = sorted(
            fixture_rows,
            key=lambda row: (
                -float(row["_crossEncoderScore"]),
                int(row["retrieval"]["originalRank"]),
            ),
        )
    return result, decorated


def changed_rows(
    original: dict[str, list[dict[str, Any]]],
    reranked: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for fixture_id, source in original.items():
        ranked = reranked[fixture_id]
        original_top = source[0]
        reranked_top = ranked[0]
        original_grade = int(original_top["label"]["relevanceGrade"])
        reranked_grade = int(reranked_top["label"]["relevanceGrade"])
        max_grade = max(int(row["label"]["relevanceGrade"]) for row in source)
        if original_grade == reranked_grade and (
            original_top["candidate"]["documentId"] == reranked_top["candidate"]["documentId"]
        ):
            status = "unchanged"
        elif reranked_grade == max_grade and original_grade < max_grade:
            status = "fixed"
        elif original_grade == max_grade and reranked_grade < max_grade:
            status = "regressed"
        elif reranked_grade > original_grade:
            status = "improved"
        elif reranked_grade < original_grade:
            status = "worsened"
        else:
            status = "changed-same-grade"
        changes.append(
            {
                "fixtureId": fixture_id,
                "family": source[0].get("family"),
                "goal": source[0].get("goal"),
                "query": source[0]["query"],
                "maximumAvailableGrade": max_grade,
                "originalTop1DocumentId": original_top["candidate"]["documentId"],
                "originalTop1Grade": original_grade,
                "rerankedTop1DocumentId": reranked_top["candidate"]["documentId"],
                "rerankedTop1Grade": reranked_grade,
                "rerankedTop1Score": float(reranked_top["_crossEncoderScore"]),
                "status": status,
            }
        )
    return changes


def metric_deltas(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float]:
    keys = [
        "top1MaxGrade",
        "relevantRecallAt20",
        "relevantRecallAt40",
        "weightedRecallAt20",
        "weightedRecallAt40",
        "ndcgAt5",
        "ndcgAt10",
        "mrrAt20",
        "forbiddenRateAt5",
    ]
    return {key: float(candidate[key]) - float(baseline[key]) for key in keys}


def self_test() -> None:
    base = {
        "schemaVersion": 2,
        "fixtureId": "f",
        "query": "кашель у ребенка",
        "origin": "challenge",
        "family": "respiratory",
        "goal": "diagnosis",
        "retrieval": {"originalRank": 1},
        "candidate": {
            "documentId": "SECRET-DOC-ID",
            "conceptId": "SECRET-CONCEPT-ID",
            "canonicalName": "Пневмония",
            "shortTitle": None,
            "navigationAliases": ["Внебольничная пневмония"],
            "declaredAliases": [],
            "ageGroups": [],
            "evidence": "Кашель и лихорадка.",
        },
        "label": {"relevanceGrade": 3, "forbidden": False},
    }
    text = candidate_text(base)
    assert "SECRET-DOC-ID" not in text and "SECRET-CONCEPT-ID" not in text
    weaker = json.loads(json.dumps(base))
    weaker["candidate"]["documentId"] = "other"
    weaker["candidate"]["canonicalName"] = "Другое"
    weaker["retrieval"]["originalRank"] = 2
    weaker["label"]["relevanceGrade"] = 0
    rows = [base, weaker]
    validate_groups(rows)
    original = grouped(rows)
    assert evaluate(original)["top1MaxGrade"] == 1.0
    reranked, _ = apply_scores(rows, [0.1, 0.9])
    assert evaluate(reranked)["top1MaxGrade"] == 0.0
    assert changed_rows(original, reranked)[0]["status"] == "regressed"
    print("cross_encoder_frozen_poc self-test: ok")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/build/search-quality-v2-frozen-candidates.jsonl"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("data/build/search-quality-cross-encoder-report.json"),
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if args.batch_size < 1 or args.batch_size > 256:
        parser.error("--batch-size must be in 1..256")
    if args.max_length < 64 or args.max_length > 2048:
        parser.error("--max-length must be in 64..2048")

    rows = load_frozen(args.input)
    original_groups = grouped(rows)
    original_metrics = evaluate(original_groups)
    scores, model_metadata = score_rows(
        rows,
        model_name=args.model,
        revision=args.revision,
        batch_size=args.batch_size,
        max_length=args.max_length,
    )
    reranked_groups, _ = apply_scores(rows, scores)
    reranked_metrics = evaluate(reranked_groups)
    changes = changed_rows(original_groups, reranked_groups)

    report = {
        "schemaVersion": 1,
        "experiment": "minimed-frozen-candidate-zero-shot-cross-encoder",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "caveat": (
            "The 33-case checked-in challenge is visible to developers and has already informed "
            "deterministic ranking repairs. This is an engineering ablation, not final clinical qualification."
        ),
        "frozenCandidates": {
            "path": str(args.input),
            "sha256": sha256_file(args.input),
            "fixtureCount": len(original_groups),
            "candidatePairCount": len(rows),
        },
        "model": model_metadata,
        "original": original_metrics,
        "crossEncoder": reranked_metrics,
        "deltas": metric_deltas(reranked_metrics, original_metrics),
        "slices": {
            "original": slices(original_groups),
            "crossEncoder": slices(reranked_groups),
        },
        "top1Changes": {
            "fixed": sum(change["status"] == "fixed" for change in changes),
            "regressed": sum(change["status"] == "regressed" for change in changes),
            "improved": sum(change["status"] == "improved" for change in changes),
            "worsened": sum(change["status"] == "worsened" for change in changes),
            "changedSameGrade": sum(
                change["status"] == "changed-same-grade" for change in changes
            ),
            "changed": [change for change in changes if change["status"] != "unchanged"],
        },
        "abstention": {
            "status": "not-qualified",
            "reason": "No private negative/out-of-scope clinician holdout is available in this PR.",
        },
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "report": str(args.report),
                "frozenSha256": report["frozenCandidates"]["sha256"],
                "model": args.model,
                "revision": args.revision,
                "parameters": model_metadata["parameterCount"],
                "originalTop1MaxGrade": original_metrics["top1MaxGrade"],
                "crossEncoderTop1MaxGrade": reranked_metrics["top1MaxGrade"],
                "top1Delta": report["deltas"]["top1MaxGrade"],
                "originalNdcgAt5": original_metrics["ndcgAt5"],
                "crossEncoderNdcgAt5": reranked_metrics["ndcgAt5"],
                "ndcgAt5Delta": report["deltas"]["ndcgAt5"],
                "fixed": report["top1Changes"]["fixed"],
                "regressed": report["top1Changes"]["regressed"],
                "millisecondsPerCandidate": model_metadata["millisecondsPerCandidate"],
                "processPeakRssBytes": model_metadata["processPeakRssBytes"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
