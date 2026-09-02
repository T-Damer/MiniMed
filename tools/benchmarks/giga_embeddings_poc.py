# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "numpy==2.5.2",
#   "sentence-transformers==6.0.0",
#   "torch==2.13.0",
#   "transformers==5.15.1",
# ]
# ///
"""Evaluate the pinned GigaEmbeddings 480M model on the public MiniMed pilot."""

from __future__ import annotations

import argparse
import json
import math
import resource
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MODEL_ID = "ai-sage/Giga-Embeddings-instruct-480M-0826"
MODEL_REVISION = "2d0c1a92716eef0e5b6972df85b5883eb5b4f57a"
QUERY_INSTRUCTION = "Given a query, retrieve relevant passages"
LATENCY_SAMPLE_COUNT = 10
RESULT_LIMIT = 20

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE = REPO_ROOT / "data/build/rf-public-pilot.db"
DEFAULT_BASE_CANDIDATES = REPO_ROOT / "data/build/giga-base-candidates.json"
DEFAULT_QUERY_PATHS = (
    REPO_ROOT / "tools/benchmarks/pilot-rf-queries.json",
    REPO_ROOT / "tools/benchmarks/pilot-rf-drug-queries.json",
    REPO_ROOT / "tools/benchmarks/doctor-workflow-queries.json",
)


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    document_version_id: str
    section_type: str | None
    anchor: str
    embedding_text: str


@dataclass(frozen=True)
class Fixture:
    fixture_id: str
    query: str
    expected_document_ids: tuple[str, ...]
    expected_version_id: str
    expected_section_types: tuple[str, ...]
    expected_anchor_prefixes: tuple[str, ...]


@dataclass(frozen=True)
class Evaluation:
    document_hit: bool
    reciprocal_rank: float
    section_hit: bool
    top_section_hit: bool
    top_document_ids: tuple[str, ...]


@dataclass(frozen=True)
class BaseCandidates:
    scores: dict[str, float]
    section_priorities: dict[str, int]


def _required_string(record: dict[str, Any], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _required_strings(record: dict[str, Any], key: str) -> tuple[str, ...]:
    value = record.get(key)
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, str) and item for item in value)
    ):
        raise ValueError(f"{key} must be a non-empty string array")
    return tuple(value)


def load_fixtures(paths: tuple[Path, ...] | list[Path]) -> list[Fixture]:
    fixtures: list[Fixture] = []
    for path in paths:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list) or not raw:
            raise ValueError(f"{path} must be a non-empty JSON array")
        for item in raw:
            if not isinstance(item, dict):
                raise TypeError(f"each fixture in {path} must be an object")
            fixtures.append(
                Fixture(
                    fixture_id=_required_string(item, "id"),
                    query=_required_string(item, "query"),
                    expected_document_ids=_required_strings(
                        item, "expectedDocumentIds"
                    ),
                    expected_version_id=_required_string(item, "expectedVersionId"),
                    expected_section_types=_required_strings(
                        item, "expectedSectionTypes"
                    ),
                    expected_anchor_prefixes=_required_strings(
                        item, "expectedAnchorPrefixes"
                    ),
                )
            )
    fixture_ids = [fixture.fixture_id for fixture in fixtures]
    if len(fixture_ids) != len(set(fixture_ids)):
        raise ValueError("query fixtures contain duplicate ids")
    return fixtures


def load_chunks(path: Path) -> list[Chunk]:
    if not path.is_file():
        raise FileNotFoundError(
            f"missing pilot database: {path}; run `bun run content:build:pilot`"
        )

    database_uri = f"{path.resolve().as_uri()}?mode=ro"
    with sqlite3.connect(database_uri, uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT
              c.id AS chunk_id,
              dv.document_id,
              c.document_version_id,
              s.section_type,
              c.anchor,
              d.title AS document_title,
              s.path_json,
              c.original_text
            FROM chunks AS c
            JOIN document_versions AS dv ON dv.id = c.document_version_id
            JOIN documents AS d ON d.id = dv.document_id
            JOIN sections AS s ON s.id = c.section_id
            ORDER BY d.id, s.order_index, c.order_index
            """
        ).fetchall()

    chunks: list[Chunk] = []
    for row in rows:
        path_items = json.loads(row["path_json"])
        if not isinstance(path_items, list) or not all(
            isinstance(item, str) for item in path_items
        ):
            raise ValueError(f"invalid section path for chunk {row['chunk_id']}")
        chunks.append(
            Chunk(
                chunk_id=row["chunk_id"],
                document_id=row["document_id"],
                document_version_id=row["document_version_id"],
                section_type=row["section_type"],
                anchor=row["anchor"],
                embedding_text="\n".join(
                    (
                        row["document_title"],
                        " > ".join(path_items),
                        row["original_text"],
                    )
                ),
            )
        )

    if not chunks:
        raise ValueError("pilot database contains no searchable chunks")
    return chunks


def load_base_candidates(
    path: Path, fixtures: list[Fixture], chunks: list[Chunk]
) -> dict[str, BaseCandidates]:
    if not path.is_file():
        raise FileNotFoundError(
            f"missing base candidates: {path}; run `bun run giga:candidates`"
        )
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schemaVersion") != 2:
        raise ValueError(f"{path} must use base candidate schema version 2")
    rows = raw.get("rows")
    if not isinstance(rows, list):
        raise TypeError(f"{path} rows must be an array")

    known_chunk_ids = {chunk.chunk_id for chunk in chunks}
    by_fixture: dict[str, BaseCandidates] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise TypeError(f"each row in {path} must be an object")
        fixture_id = _required_string(row, "fixtureId")
        candidates = row.get("candidates")
        if not isinstance(candidates, list):
            raise TypeError(f"{fixture_id} candidates must be an array")
        if fixture_id in by_fixture:
            raise ValueError(f"duplicate base candidate row: {fixture_id}")

        scores: dict[str, float] = {}
        section_priorities: dict[str, int] = {}
        for candidate in candidates:
            if not isinstance(candidate, dict):
                raise TypeError(f"{fixture_id} contains an invalid candidate")
            chunk_id = _required_string(candidate, "chunkId")
            score = candidate.get("score")
            section_priority = candidate.get("sectionPriority")
            if (
                isinstance(score, bool)
                or not isinstance(score, (int, float))
                or not math.isfinite(score)
            ):
                raise ValueError(f"{fixture_id}/{chunk_id} has an invalid score")
            if (
                isinstance(section_priority, bool)
                or not isinstance(section_priority, int)
                or section_priority < 0
                or section_priority > 2
            ):
                raise ValueError(
                    f"{fixture_id}/{chunk_id} has an invalid section priority"
                )
            if chunk_id not in known_chunk_ids:
                raise ValueError(
                    f"{fixture_id} references an unknown chunk: {chunk_id}"
                )
            if chunk_id in scores:
                raise ValueError(f"{fixture_id} contains duplicate chunk: {chunk_id}")
            scores[chunk_id] = float(score)
            section_priorities[chunk_id] = section_priority
        by_fixture[fixture_id] = BaseCandidates(scores, section_priorities)

    expected_fixture_ids = {fixture.fixture_id for fixture in fixtures}
    if set(by_fixture) != expected_fixture_ids:
        raise ValueError("base candidates do not match the selected query fixtures")
    return by_fixture


def evaluate(
    fixture: Fixture,
    chunks: list[Chunk],
    scores: list[float],
    top_k: int,
    candidate_chunk_ids: set[str] | None = None,
    section_priorities: dict[str, int] | None = None,
) -> Evaluation:
    if len(chunks) != len(scores):
        raise ValueError("score count does not match chunk count")

    ranked_indexes = sorted(
        (
            index
            for index, chunk in enumerate(chunks)
            if candidate_chunk_ids is None or chunk.chunk_id in candidate_chunk_ids
        ),
        key=scores.__getitem__,
        reverse=True,
    )[:RESULT_LIMIT]
    by_document: dict[str, list[int]] = {}
    for index in ranked_indexes:
        by_document.setdefault(chunks[index].document_id, []).append(index)

    groups: list[tuple[str, list[int], float, bool]] = []
    for document_id, indexes in by_document.items():
        sorted_indexes = sorted(
            indexes,
            key=lambda index: (
                (section_priorities or {}).get(chunks[index].chunk_id, 1),
                scores[index],
            ),
            reverse=True,
        )
        groups.append(
            (
                document_id,
                sorted_indexes,
                max(scores[index] for index in indexes),
                any(
                    (section_priorities or {}).get(chunks[index].chunk_id, 1) == 2
                    for index in indexes
                ),
            )
        )
    groups.sort(key=lambda group: (group[3], group[2]), reverse=True)
    top_document_ids = [group[0] for group in groups[:top_k]]

    expected_documents = set(fixture.expected_document_ids)
    document_rank = next(
        (
            rank
            for rank, document_id in enumerate(top_document_ids, start=1)
            if document_id in expected_documents
        ),
        None,
    )

    def matches_expected_section(chunk: Chunk) -> bool:
        return (
            chunk.document_id in expected_documents
            and chunk.document_version_id == fixture.expected_version_id
            and chunk.section_type in fixture.expected_section_types
            and any(
                chunk.anchor.startswith(prefix)
                for prefix in fixture.expected_anchor_prefixes
            )
        )

    expected_result_indexes = next(
        (group[1] for group in groups if group[0] in expected_documents), []
    )
    section_hit = any(
        matches_expected_section(chunks[index]) for index in expected_result_indexes
    )

    return Evaluation(
        document_hit=document_rank is not None,
        reciprocal_rank=0.0 if document_rank is None else 1.0 / document_rank,
        section_hit=section_hit,
        top_section_hit=bool(expected_result_indexes)
        and matches_expected_section(chunks[expected_result_indexes[0]]),
        top_document_ids=tuple(top_document_ids),
    )


def fuse_hybrid_scores(
    chunks: list[Chunk],
    semantic_scores: list[float],
    base_scores: dict[str, float],
) -> list[float]:
    if len(chunks) != len(semantic_scores):
        raise ValueError("semantic score count does not match chunk count")
    maximum_base = max(0.000_001, *base_scores.values())
    fused: list[float] = []
    for chunk, raw_semantic_score in zip(chunks, semantic_scores, strict=True):
        semantic_score = max(0.0, raw_semantic_score)
        base_score = base_scores.get(chunk.chunk_id)
        if base_score is None:
            fused.append(semantic_score * 0.62)
            continue
        corroboration = 0.04 if semantic_score > 0 else 0.0
        fused.append(
            (base_score / maximum_base) * 0.78 + semantic_score * 0.22 + corroboration
        )
    return fused


def summarize(
    fixtures: list[Fixture], evaluations: list[Evaluation], top_k: int
) -> dict[str, Any]:
    count = len(evaluations)
    return {
        "document_recall_at_1": sum(
            bool(result.top_document_ids)
            and result.top_document_ids[0] in fixture.expected_document_ids
            for fixture, result in zip(fixtures, evaluations, strict=True)
        )
        / count,
        f"document_recall_at_{top_k}": sum(
            result.document_hit for result in evaluations
        )
        / count,
        f"mrr_at_{top_k}": sum(result.reciprocal_rank for result in evaluations)
        / count,
        "section_recall": sum(result.section_hit for result in evaluations) / count,
        "top_section_accuracy": sum(result.top_section_hit for result in evaluations)
        / count,
        "failures": [
            {
                "fixture_id": fixture.fixture_id,
                "document_hit": result.document_hit,
                "section_hit": result.section_hit,
                "top_section_hit": result.top_section_hit,
                "top_document_ids": result.top_document_ids,
            }
            for fixture, result in zip(fixtures, evaluations, strict=True)
            if not result.document_hit or not result.section_hit
        ],
        "top_section_misses": [
            fixture.fixture_id
            for fixture, result in zip(fixtures, evaluations, strict=True)
            if not result.top_section_hit
        ],
    }


def run_self_test() -> None:
    fixture = Fixture(
        fixture_id="self-test",
        query="test",
        expected_document_ids=("document.expected",),
        expected_version_id="document.expected@v1",
        expected_section_types=("diagnostics",),
        expected_anchor_prefixes=("document.expected@v1/diagnostics",),
    )
    chunks = [
        Chunk(
            "wrong", "document.wrong", "document.wrong@v1", "other", "wrong", "wrong"
        ),
        Chunk(
            "expected",
            "document.expected",
            "document.expected@v1",
            "diagnostics",
            "document.expected@v1/diagnostics#expected",
            "expected",
        ),
    ]
    result = evaluate(fixture, chunks, [0.9, 0.8], top_k=2)
    assert result.document_hit
    assert result.reciprocal_rank == 0.5
    assert result.section_hit
    assert result.top_section_hit
    assert result.top_document_ids == ("document.wrong", "document.expected")
    fused = fuse_hybrid_scores(chunks, [0.5, 0.9], {"wrong": 2.0})
    assert math.isclose(fused[0], 0.93)
    assert math.isclose(fused[1], 0.558)
    print("giga embeddings POC self-test: ok")


def peak_rss_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
    return peak / divisor


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        raise ValueError("cannot calculate a percentile of an empty sequence")
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1)
    return ordered[index]


def run_evaluation(args: argparse.Namespace) -> None:
    import numpy as np
    import sentence_transformers
    import torch
    from sentence_transformers import SentenceTransformer

    fixtures = load_fixtures(args.queries or DEFAULT_QUERY_PATHS)
    chunks = load_chunks(args.database)
    base_candidates = load_base_candidates(args.base_candidates, fixtures, chunks)

    load_started = time.perf_counter()
    model = SentenceTransformer(
        MODEL_ID,
        revision=MODEL_REVISION,
        trust_remote_code=True,
        local_files_only=args.offline,
        device=None if args.device == "auto" else args.device,
    )
    load_seconds = time.perf_counter() - load_started

    document_started = time.perf_counter()
    document_embeddings = model.encode(
        [chunk.embedding_text for chunk in chunks],
        batch_size=args.batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    document_seconds = time.perf_counter() - document_started

    query_started = time.perf_counter()
    query_embeddings = model.encode(
        [
            f"Instruct: {QUERY_INSTRUCTION}\nQuery: {fixture.query}"
            for fixture in fixtures
        ],
        batch_size=args.batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    query_seconds = time.perf_counter() - query_started

    document_embeddings = np.asarray(document_embeddings, dtype=np.float32)
    query_embeddings = np.asarray(query_embeddings, dtype=np.float32)
    quantized_documents = np.sign(document_embeddings) * np.floor(
        np.abs(document_embeddings) * 127 + 0.5
    )
    quantized_queries = np.sign(query_embeddings) * np.floor(
        np.abs(query_embeddings) * 127 + 0.5
    )
    document_norms = np.linalg.vector_norm(quantized_documents, axis=1)
    query_norms = np.linalg.vector_norm(quantized_queries, axis=1)
    score_matrix = (quantized_queries @ quantized_documents.T) / np.outer(
        query_norms, document_norms
    )
    if not np.isfinite(score_matrix).all():
        raise RuntimeError("model produced a non-finite similarity score")

    single_query_latencies_ms: list[float] = []
    for fixture in fixtures[:LATENCY_SAMPLE_COUNT]:
        started = time.perf_counter()
        model.encode(
            [f"Instruct: {QUERY_INSTRUCTION}\nQuery: {fixture.query}"],
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        single_query_latencies_ms.append((time.perf_counter() - started) * 1000)

    semantic_evaluations = [
        evaluate(
            fixture,
            chunks,
            score_matrix[index].tolist(),
            args.top_k,
            section_priorities=base_candidates[fixture.fixture_id].section_priorities,
        )
        for index, fixture in enumerate(fixtures)
    ]
    base_evaluations = [
        evaluate(
            fixture,
            chunks,
            [
                base_candidates[fixture.fixture_id].scores.get(chunk.chunk_id, 0.0)
                for chunk in chunks
            ],
            args.top_k,
            set(base_candidates[fixture.fixture_id].scores),
            base_candidates[fixture.fixture_id].section_priorities,
        )
        for fixture in fixtures
    ]
    hybrid_evaluations = [
        evaluate(
            fixture,
            chunks,
            fuse_hybrid_scores(
                chunks,
                score_matrix[index].tolist(),
                base_candidates[fixture.fixture_id].scores,
            ),
            args.top_k,
            section_priorities=base_candidates[fixture.fixture_id].section_priorities,
        )
        for index, fixture in enumerate(fixtures)
    ]
    count = len(semantic_evaluations)

    print(
        json.dumps(
            {
                "model": MODEL_ID,
                "revision": MODEL_REVISION,
                "device": str(model.device),
                "offline": args.offline,
                "sentence_transformers": sentence_transformers.__version__,
                "torch": torch.__version__,
                "queries": count,
                "chunks": len(chunks),
                "vector_format": "int8",
                "retrieval": {
                    "deterministic_hash_hybrid": summarize(
                        fixtures, base_evaluations, args.top_k
                    ),
                    "semantic_only": summarize(
                        fixtures, semantic_evaluations, args.top_k
                    ),
                    "deterministic_hash_giga_hybrid": summarize(
                        fixtures, hybrid_evaluations, args.top_k
                    ),
                },
                "model_load_seconds": round(load_seconds, 3),
                "document_embedding_seconds": round(document_seconds, 3),
                "query_embedding_seconds": round(query_seconds, 3),
                "warm_single_query_latency_ms": {
                    "p50": round(percentile(single_query_latencies_ms, 0.5), 1),
                    "p95": round(percentile(single_query_latencies_ms, 0.95), 1),
                    "max": round(max(single_query_latencies_ms), 1),
                    "samples": len(single_query_latencies_ms),
                },
                "peak_rss_mb": round(peak_rss_mb(), 1),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--base-candidates", type=Path, default=DEFAULT_BASE_CANDIDATES)
    parser.add_argument(
        "--queries",
        type=Path,
        action="append",
        help=(
            "query fixture JSON; repeat to combine files "
            "(defaults to all public-pilot suites)"
        ),
    )
    parser.add_argument(
        "--device", choices=("auto", "cpu", "mps", "cuda"), default="auto"
    )
    parser.add_argument(
        "--offline", action="store_true", help="use only the local model cache"
    )
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.batch_size <= 0 or args.top_k <= 0:
        parser.error("--batch-size and --top-k must be positive")
    return args


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    run_evaluation(args)


if __name__ == "__main__":
    main()
