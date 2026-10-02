# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "sentence-transformers>=3.4", "torch>=2.4"]
# ///
"""Offline comparison: the app's lexical search versus hybrid lexical + embeddings.

Scratch-only research tool (E1 in STATE.md). Lexical candidates come from the application itself
(`export-retrieval-candidates.ts`); this script embeds the same pack chunks with a candidate model,
retrieves by cosine, fuses with reciprocal-rank fusion and scores both with the rules of
`src/hard-query-scoring.ts` (required/acceptable/forbidden entities in the top-5 groups).

    uv run tools/benchmarks/embedding_eval.py corpus --packs data/build/release-clinical --work DIR
    uv run tools/benchmarks/embedding_eval.py embed --work DIR --model cointegrated/rubert-tiny2
    uv run tools/benchmarks/embedding_eval.py evaluate --work DIR --model cointegrated/rubert-tiny2

DIR must hold `queries.jsonl` and `lexical-candidates.jsonl`. Nothing here ships in the app.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import re
import sqlite3
import statistics
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

# Prefixes some models were trained with; anything else is encoded as is.
QUERY_PREFIX = {
    "intfloat/multilingual-e5-small": "query: ",
    "intfloat/multilingual-e5-base": "query: ",
    "deepvk/USER-base": "query: ",
}
PASSAGE_PREFIX = {
    "intfloat/multilingual-e5-small": "passage: ",
    "intfloat/multilingual-e5-base": "passage: ",
    "deepvk/USER-base": "passage: ",
}
# Models whose packaged sentence-transformers config the current library cannot read: built by hand
# from the transformer with the pooling their model cards prescribe.
MANUAL_MEAN_POOLING = {"deepvk/USER-base"}
PASSAGE_CHARS = 1200
TOP_CHUNKS = 400
TOP_GROUPS = 50
RRF_K = 60


def slug(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", model).strip("-").lower()


def normalize(value: str) -> str:
    value = value.lower().replace("ё", "е")
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).replace("_", " ").strip()


def corpus(packs: Path, work: Path) -> None:
    rows = []
    for path in sorted(glob.glob(str(packs / "*.db"))):
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        query = """
            SELECT c.id, d.id, d.title, s.path_json, s.section_type, c.original_text
              FROM chunks c
              JOIN document_versions v ON v.id = c.document_version_id
              JOIN documents d ON d.id = v.document_id
              JOIN sections s ON s.id = c.section_id
             ORDER BY c.rowid
        """
        for chunk_id, document_id, title, path_json, section_type, text in db.execute(
            query
        ):
            section_path = " / ".join(json.loads(path_json) or [])
            rows.append(
                {
                    "chunkId": chunk_id,
                    "documentId": document_id,
                    "title": title,
                    "sectionPath": section_path,
                    "sectionType": section_type,
                    "text": text,
                }
            )
        db.close()
    (work / "corpus.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n"
    )
    print(
        f"corpus: {len(rows)} chunks from {len(glob.glob(str(packs / '*.db')))} packs"
    )


def load_corpus(work: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (work / "corpus.jsonl").read_text().splitlines()
        if line
    ]


def passage(row: dict) -> str:
    return f"{row['title']}. {row['sectionPath']}. {row['text']}"[:PASSAGE_CHARS]


def load_model(model: str):
    import torch
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    if model in MANUAL_MEAN_POOLING:
        from sentence_transformers import models

        word = models.Transformer(model, max_seq_length=MAX_TOKENS)
        pooling = models.Pooling(
            word.get_word_embedding_dimension(), pooling_mode="mean"
        )
        return SentenceTransformer(modules=[word, pooling], device=device), device
    return SentenceTransformer(model, device=device), device


SHARD = 10_000
MAX_TOKENS = 256


def embed(work: Path, model_name: str, batch: int) -> None:
    """Encodes in shards saved as they finish, so a stopped run resumes where it left off."""
    rows = load_corpus(work)
    model, device = load_model(model_name)
    model.max_seq_length = min(model.max_seq_length or MAX_TOKENS, MAX_TOKENS)
    prefix = PASSAGE_PREFIX.get(model_name, "")
    shard_dir = work / f"emb-{slug(model_name)}.shards"
    shard_dir.mkdir(exist_ok=True)
    started = time.perf_counter()
    for start in range(0, len(rows), SHARD):
        path = shard_dir / f"{start:07d}.npy"
        if path.exists():
            continue
        part = model.encode(
            [prefix + passage(row) for row in rows[start : start + SHARD]],
            batch_size=batch,
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(np.float16)
        np.save(path, part)
        done = min(start + SHARD, len(rows))
        print(
            f"embed: {model_name} {done}/{len(rows)} on {device}, {time.perf_counter() - started:.0f}s",
            flush=True,
        )
    vectors = np.concatenate([np.load(p) for p in sorted(shard_dir.glob("*.npy"))])
    np.save(work / f"emb-{slug(model_name)}.npy", vectors)
    print(
        f"embed: {model_name}: {vectors.shape} in {time.perf_counter() - started:.0f}s",
        flush=True,
    )


def quantize(vectors: np.ndarray, mode: str) -> np.ndarray:
    if mode == "float":
        return vectors.astype(np.float32)
    if mode == "int8":
        scaled = np.clip(np.round(vectors.astype(np.float32) * 127), -127, 127).astype(
            np.int8
        )
        restored = scaled.astype(np.float32)
        return restored / np.linalg.norm(restored, axis=1, keepdims=True).clip(1e-6)
    raise ValueError(mode)


def semantic_groups(
    scores: np.ndarray, rows: list[dict], top_chunks: int = TOP_CHUNKS
) -> list[tuple[str, list[str]]]:
    order = np.argpartition(-scores, top_chunks)[:top_chunks]
    order = order[np.argsort(-scores[order])]
    groups: dict[str, list[str]] = {}
    for index in order:
        row = rows[index]
        groups.setdefault(row["documentId"], []).append(row["chunkId"])
    return list(groups.items())[:TOP_GROUPS]


def binary_then_rescore(
    query: np.ndarray, packed: np.ndarray, vectors: np.ndarray, shortlist: int = 2000
) -> np.ndarray:
    """Hamming prefilter over sign bits, exact int8 cosine on the shortlist."""
    query_bits = np.packbits(query > 0)
    distance = np.unpackbits(np.bitwise_xor(packed, query_bits), axis=1).sum(axis=1)
    candidates = np.argpartition(distance, shortlist)[:shortlist]
    scores = np.full(vectors.shape[0], -1.0, dtype=np.float32)
    scores[candidates] = vectors[candidates] @ query
    return scores


def fuse(
    lexical: list[tuple[str, list[str]]],
    semantic: list[tuple[str, list[str]]],
    semantic_weight: float,
) -> list[tuple[str, list[str]]]:
    score: dict[str, float] = defaultdict(float)
    chunks: dict[str, list[str]] = {}
    for rank, (document_id, chunk_ids) in enumerate(lexical):
        score[document_id] += 1 / (RRF_K + rank + 1)
        chunks[document_id] = list(chunk_ids)
    for rank, (document_id, chunk_ids) in enumerate(semantic):
        score[document_id] += semantic_weight / (RRF_K + rank + 1)
        chunks.setdefault(document_id, [])
        chunks[document_id] += [c for c in chunk_ids if c not in chunks[document_id]]
    ranked = sorted(score, key=lambda document_id: -score[document_id])
    return [(document_id, chunks[document_id]) for document_id in ranked[:TOP_GROUPS]]


def group_text(
    document_id: str,
    chunk_ids: list[str],
    by_chunk: dict[str, dict],
    titles: dict[str, str],
) -> str:
    parts = [titles.get(document_id, "")]
    for chunk_id in chunk_ids[:3]:
        row = by_chunk.get(chunk_id)
        if row:
            parts += [row["sectionPath"], row["text"][:300]]
    return normalize(" ".join(parts))


def includes_any(text: str, needles: list[str]) -> bool:
    return any(normalize(n) and normalize(n) in text for n in needles)


def score_query(
    query: dict, groups: list[tuple[str, list[str]]], by_chunk, titles
) -> dict:
    top = groups[:5]
    texts = [group_text(d, c, by_chunk, titles) for d, c in top]
    required_rank = next(
        (
            i + 1
            for i, t in enumerate(texts)
            if includes_any(t, query["required_entities"])
        ),
        None,
    )
    acceptable = any(includes_any(t, query["acceptable_entities"]) for t in texts)
    forbidden = any(includes_any(t, query["forbidden_or_dangerous"]) for t in texts)
    expected = {s.replace("_", "-") for s in query["expected_sections"]}
    section_hit = any(
        (by_chunk.get(c) or {}).get("sectionType") in expected
        for _, chunk_ids in top
        for c in chunk_ids[:3]
    )
    grading = query["grading"]
    gains = []
    for text in texts:
        if includes_any(text, query["forbidden_or_dangerous"]):
            gains.append(grading["forbidden_gain"])
        elif includes_any(text, query["required_entities"]):
            gains.append(grading["required_gain"])
        elif includes_any(text, query["acceptable_entities"]):
            gains.append(grading["acceptable_gain"])
        else:
            gains.append(grading["irrelevant_gain"])

    def dcg(values):
        return sum(
            (2 ** max(g, 0) - 1) / math.log2(i + 2) for i, g in enumerate(values)
        )

    ideal = dcg(sorted(gains, reverse=True))
    return {
        "at1": required_rank == 1,
        "at5": required_rank is not None,
        "mrr": 0 if required_rank is None else 1 / required_rank,
        "acceptableOrRequired": required_rank is not None or acceptable,
        "forbidden": forbidden,
        "section": section_hit,
        "ndcg": 0 if ideal == 0 else dcg(gains) / ideal,
    }


def aggregate(rows: list[dict]) -> dict:
    keys = ["at1", "at5", "mrr", "acceptableOrRequired", "section", "forbidden", "ndcg"]
    return {
        key: round(statistics.fmean(float(r[key]) for r in rows), 3) for key in keys
    } | {"n": len(rows)}


def evaluate(work: Path, model_name: str, weights: list[float]) -> None:
    rows = load_corpus(work)
    by_chunk = {row["chunkId"]: row for row in rows}
    titles = {row["documentId"]: row["title"] for row in rows}
    queries = {
        q["query_id"]: q
        for q in map(json.loads, (work / "queries.jsonl").read_text().splitlines())
        if q
    }
    lexical = {
        c["queryId"]: [(g["documentId"], g["chunkIds"]) for g in c["groups"]]
        for c in map(
            json.loads, (work / "lexical-candidates.jsonl").read_text().splitlines()
        )
        if c
    }
    vectors = np.load(work / f"emb-{slug(model_name)}.npy")
    model, device = load_model(model_name)
    prefix = QUERY_PREFIX.get(model_name, "")
    ids = [qid for qid in lexical if qid in queries]
    started = time.perf_counter()
    query_vectors = model.encode(
        [prefix + queries[q]["query"] for q in ids],
        normalize_embeddings=True,
        convert_to_numpy=True,
        batch_size=64,
    ).astype(np.float32)
    encode_ms = (time.perf_counter() - started) * 1000 / len(ids)
    # Single-query latency on CPU with one thread approximates a phone better than the batch above.
    import torch

    cpu_model, _ = model.to("cpu"), None
    torch.set_num_threads(1)
    single = []
    for q in ids[:50]:
        t = time.perf_counter()
        cpu_model.encode([prefix + queries[q]["query"]], normalize_embeddings=True)
        single.append((time.perf_counter() - t) * 1000)

    variants: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    stores = {"float": quantize(vectors, "float"), "int8": quantize(vectors, "int8")}
    packed = np.packbits(stores["int8"] > 0, axis=1)
    for qid, query_vector in zip(ids, query_vectors, strict=True):
        query = queries[qid]
        style = query.get("style", "curated") if query["set"] == "hard" else "curated"
        lex = lexical[qid]
        runs = {"lexical": lex}
        sem = semantic_groups(stores["float"] @ query_vector, rows)
        runs["semantic"] = sem
        for weight in weights:
            runs[f"hybrid w={weight}"] = fuse(lex, sem, weight)
        sem_int8 = semantic_groups(stores["int8"] @ query_vector, rows)
        runs["hybrid int8 w=1.0"] = fuse(lex, sem_int8, 1.0)
        sem_binary = semantic_groups(
            binary_then_rescore(query_vector, packed, stores["int8"]), rows
        )
        runs["hybrid binary→int8 w=1.0"] = fuse(lex, sem_binary, 1.0)
        for name, groups in runs.items():
            scored = score_query(query, groups, by_chunk, titles)
            variants[name][query["set"]].append(scored)
            if query["set"] == "hard":
                variants[name][f"style:{style}"].append(scored)
    report = {
        "model": model_name,
        "device": device,
        "dimensions": int(vectors.shape[1]),
        "chunks": int(vectors.shape[0]),
        "batchEncodeMsPerQuery": round(encode_ms, 1),
        "singleQueryCpu1ThreadMs": {
            "p50": round(statistics.median(single), 1),
            "p95": round(sorted(single)[int(len(single) * 0.95) - 1], 1),
        },
        "vectorBytes": {
            "int8": int(vectors.shape[0] * vectors.shape[1]),
            "binary": int(packed.nbytes),
        },
        "results": {
            name: {slice_: aggregate(r) for slice_, r in sorted(by.items())}
            for name, by in variants.items()
        },
    }
    out = work / f"report-{slug(model_name)}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(
        json.dumps(
            {k: v for k, v in report.items() if k != "results"}, ensure_ascii=False
        )
    )
    for name, by in report["results"].items():
        hard, curated = by.get("hard", {}), by.get("curated", {})
        print(
            f"{name:28} hard@1 {hard.get('at1')} @5 {hard.get('at5')} mrr {hard.get('mrr')} "
            f"forb {hard.get('forbidden')} | curated@5 {curated.get('at5')}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("corpus")
    c.add_argument("--packs", type=Path, required=True)
    c.add_argument("--work", type=Path, required=True)
    e = sub.add_parser("embed")
    e.add_argument("--work", type=Path, required=True)
    e.add_argument("--model", required=True)
    e.add_argument("--batch", type=int, default=64)
    v = sub.add_parser("evaluate")
    v.add_argument("--work", type=Path, required=True)
    v.add_argument("--model", required=True)
    v.add_argument("--weights", type=float, nargs="+", default=[0.5, 1.0, 1.5])
    args = parser.parse_args()
    if args.command == "corpus":
        corpus(args.packs, args.work)
    elif args.command == "embed":
        embed(args.work, args.model, args.batch)
    else:
        evaluate(args.work, args.model, args.weights)


if __name__ == "__main__":
    main()
