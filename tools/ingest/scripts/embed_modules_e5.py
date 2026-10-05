# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "sentence-transformers>=3.4", "torch>=2.4"]
# ///
"""Give released modules e5-small passage vectors (STATE E2/E3, ADR 0008).

Local-only build stage. `--family clinical`: every chunk of the single-recommendation modules
(`minimed.clinical.recommendation.*`), replacing the feature-hash scaffold. `--family medications`:
only the indication sections («Показания», «Показания к применению», section type `indications`)
of the ГРЛС instruction modules and the Allmed module, which is what a query such as «таблетки от
головы» needs. Input is the published framed-zstd index of each module, found by the file name of
its catalog URL in one of `--source` directories and checked against the catalog `sha256`. Each
index is decoded into `--out`; inside that copy only `embedding_profiles` and `chunk_embeddings`
change. Documents, sections, chunks, FTS and `content_packs` keep their content. Run
`scripts/reframe-modules-e5.ts` afterwards.

Passage text matches the measured E1 setup (docs/research/embeddings-kr-2026-10-02.md):
`"passage: " + title + ". " + section path + ". " + chunk text`, cut to 1 200 characters and
256 tokens, mean-pooled, L2-normalised, then the ADR 0008 int8 quantisation (times 127, round half
away from zero). The app embeds queries as `"query: " + text` with the ONNX export of the same
model (`apps/app/src/features/semantic/e5-model.ts`).

    uv run tools/ingest/scripts/embed_modules_e5.py --family clinical \\
      --source output/module-zstd-2026-10-01/clinical-compacted \\
      --source data/build/official-clinical-2026-10-02/zst \\
      --out data/build/clinical-e5/decoded

    uv run tools/ingest/scripts/embed_modules_e5.py --family medications \\
      --source data/build/grls-instruction-modules/zst --source data/build/allmed-module/zst \\
      --out data/build/drug-e5/decoded

Encoding runs in shards saved as they finish (`--out/../shards-<family>`), so a stopped run resumes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sqlite3
import subprocess
import time
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG = REPO_ROOT / "apps/app/src/features/modules/catalog.preview.json"
FAMILIES = {
    "clinical": {"ids": ("minimed.clinical.recommendation.",), "chunks": ""},
    "medications": {
        "ids": ("minimed.medications.instructions.", "minimed.medications.ru"),
        "chunks": """WHERE s.section_type = 'indications'
               OR s.title IN ('Показания', 'Показания к применению', 'ПОКАЗАНИЯ К ПРИМЕНЕНИЮ')""",
    },
}

MODEL = "intfloat/multilingual-e5-small"
MODEL_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
PASSAGE_PREFIX = "passage: "
PASSAGE_CHARS = 1200
MAX_TOKENS = 256
SHARD = 10_000
# Must equal E5_SMALL_PROFILE in packages/search-semantic/src/profile.ts.
PROFILE = {
    "id": "localmed.e5-small.384.int8.v1",
    "dimensions": 384,
    "vector_format": "int8",
    "normalization": "l2",
    "generator": MODEL,
    "generator_version": MODEL_REVISION,
    "fingerprint": "e5-small:614241f6:passage-title-section-1200c-256t:mean:l2:int8x127",
    "metadata": {
        "intendedUse": "clinical-recommendation-semantic-search",
        "neuralModel": True,
        "queryPrefix": "query: ",
        "passagePrefix": PASSAGE_PREFIX,
        "passageText": "title. section path. chunk text, first 1200 characters, 256 tokens",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def released_modules(family: str, sources: list[Path]) -> list[tuple[str, Path, str]]:
    """(module id, local archive, catalog sha256) of every released index of the family."""
    catalog = json.loads(CATALOG.read_text())
    found: list[tuple[str, Path, str]] = []
    for module in catalog["modules"]:
        if not any(
            module["id"] == prefix or module["id"].startswith(prefix)
            for prefix in FAMILIES[family]["ids"]
        ):
            continue
        artifact = next((a for a in module.get("artifacts", []) if a["kind"] == "index"), None)
        if not artifact or artifact.get("compression") != "zstd":
            continue
        name = artifact["url"].rsplit("/", 1)[-1]
        path = next((s / name for s in sources if (s / name).exists()), None)
        if path is None:
            raise SystemExit(f"Missing local archive {name} for {module['id']}")
        found.append((module["id"], path, artifact["sha256"]))
    return sorted(found)


def decode(modules: list[tuple[str, Path, str]], out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    decoded: list[Path] = []
    for module_id, archive, expected in modules:
        target = out / archive.name.removesuffix(".zst")
        decoded.append(target)
        if target.exists():
            continue
        if sha256(archive) != expected:
            raise SystemExit(f"{archive} differs from the catalog checksum of {module_id}")
        temporary = target.with_suffix(".db.tmp")
        subprocess.run(
            ["zstd", "-dqf", "--long=27", str(archive), "-o", str(temporary)], check=True
        )
        temporary.rename(target)
    return decoded


def passages(path: Path, chunk_filter: str) -> list[tuple[str, str]]:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    rows = db.execute(
        f"""SELECT c.id, d.title, s.path_json, c.original_text
             FROM chunks c
             JOIN document_versions v ON v.id = c.document_version_id
             JOIN documents d ON d.id = v.document_id
             JOIN sections s ON s.id = c.section_id
             {chunk_filter}
            ORDER BY c.id"""
    ).fetchall()
    db.close()
    return [
        (
            chunk_id,
            PASSAGE_PREFIX
            + f"{title}. {' / '.join(json.loads(path_json) or [])}. {text}"[:PASSAGE_CHARS],
        )
        for chunk_id, title, path_json, text in rows
    ]


def quantize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    scaled = np.where(norms > 0, vectors / np.maximum(norms, 1e-12), 0) * 127
    rounded = np.sign(scaled) * np.floor(np.abs(scaled) + 0.5)
    return np.clip(rounded, -127, 127).astype(np.int8)


def encode(texts: list[str], shards: Path) -> np.ndarray:
    import torch
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = SentenceTransformer(MODEL, revision=MODEL_REVISION, device=device)
    model.max_seq_length = MAX_TOKENS
    shards.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    for start in range(0, len(texts), SHARD):
        path = shards / f"{start:07d}.npy"
        if path.exists():
            continue
        part = model.encode(
            texts[start : start + SHARD],
            batch_size=64,
            normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(np.float32)
        np.save(path, part)
        done = min(start + SHARD, len(texts))
        print(
            f"encode: {done}/{len(texts)} on {device}, {time.perf_counter() - started:.0f}s",
            flush=True,
        )
    return np.concatenate([np.load(p) for p in sorted(shards.glob("*.npy"))])


def write_vectors(path: Path, chunk_ids: list[str], vectors: np.ndarray) -> None:
    db = sqlite3.connect(path)
    db.execute("PRAGMA foreign_keys = ON")
    with db:
        db.execute("DELETE FROM chunk_embeddings")
        db.execute("DELETE FROM embedding_profiles")
        db.execute(
            """INSERT INTO embedding_profiles(id, dimensions, vector_format, normalization,
                 generator, generator_version, fingerprint, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                PROFILE["id"],
                PROFILE["dimensions"],
                PROFILE["vector_format"],
                PROFILE["normalization"],
                PROFILE["generator"],
                PROFILE["generator_version"],
                PROFILE["fingerprint"],
                json.dumps(
                    PROFILE["metadata"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ),
            ),
        )
        db.executemany(
            "INSERT INTO chunk_embeddings(profile_id, chunk_id, vector, vector_norm)"
            " VALUES (?, ?, ?, ?)",
            (
                (
                    PROFILE["id"],
                    chunk_id,
                    vector.tobytes(),
                    math.sqrt(float(np.dot(vector.astype(np.int32), vector.astype(np.int32)))),
                )
                for chunk_id, vector in zip(chunk_ids, vectors, strict=True)
            ),
        )
    db.execute("VACUUM")
    integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    db.close()
    if integrity != "ok":
        raise SystemExit(f"{path}: integrity_check {integrity}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--family", choices=sorted(FAMILIES), required=True)
    parser.add_argument("--source", type=Path, action="append", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    family = FAMILIES[args.family]
    modules = released_modules(args.family, args.source)
    databases = decode(modules, args.out)
    print(f"decoded: {len(databases)} modules → {args.out}", flush=True)

    per_module = [passages(path, family["chunks"]) for path in databases]
    texts = [text for rows in per_module for _, text in rows]
    vectors = quantize(encode(texts, args.out.parent / f"shards-{args.family}"))
    if len(vectors) != len(texts):
        raise SystemExit(f"{len(vectors)} vectors for {len(texts)} passages: remove stale shards")

    offset = 0
    report = []
    for path, rows in zip(databases, per_module, strict=True):
        write_vectors(
            path, [chunk_id for chunk_id, _ in rows], vectors[offset : offset + len(rows)]
        )
        offset += len(rows)
        report.append({"file": path.name, "chunks": len(rows), "bytes": path.stat().st_size})
    (args.out.parent / f"embed-report-{args.family}.json").write_text(
        json.dumps(
            {"profile": PROFILE, "modules": len(report), "chunks": offset, "files": report},
            ensure_ascii=False,
            indent=1,
        )
    )
    print(f"embedded: {offset} chunks in {len(report)} modules", flush=True)


if __name__ == "__main__":
    main()
