# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "sentence-transformers>=6.1", "torch>=2.4", "transformers>=5.19"]
# ///
"""Give released modules the KD1 passage vectors (STATE KD1, E2/E3, ADR 0008).

Passages are encoded by Giga-Embeddings-instruct 480M on the build machine and projected to 384
dimensions with the fixed matrix `--projection` (its SHA-256 is part of the profile fingerprint);
the phone embeds queries with the distilled e5-small-sized student
(docs/research/embedding-distillation-2026-10-09.md).

Local-only build stage. `--family clinical`: every chunk of the single-recommendation modules
(`minimed.clinical.recommendation.*`). `--family medications`: only the indication sections
(«Показания», «Показания к применению», section type `indications`) of the ГРЛС instruction
modules and the Allmed module, which is what a query such as «таблетки от головы» needs.
`--family reference`: the code/name and synonym rows of the МКБ cards and the short description,
overview and symptom sections of the disease articles (description → term). Input is the published
framed-zstd index of each module, found by the file name of its catalog URL in one of `--source`
directories and checked against the catalog `sha256`. Each index is decoded into `--out`; inside
that copy only `embedding_profiles` and `chunk_embeddings` change. Documents, sections, chunks, FTS
and `content_packs` keep their content. Run `scripts/reframe-modules.ts` afterwards.

Passage text matches the measured setup: `title + ". " + section path + ". " + chunk text`, cut to
1 200 characters and 256 tokens, no prefix (Giga encodes documents without an instruction),
mean-pooled, L2-normalised, projected, L2-normalised again, then the ADR 0008 int8 quantisation
(times 127, round half away from zero). The app embeds queries as `"query: " + text` with the
student's ONNX export (`apps/app/src/features/semantic/e5-model.ts`).

    P=data/build/kd1/giga480m-projection-384.npy
    uv run tools/ingest/scripts/embed_modules.py --projection $P --family clinical \\
      --source output/module-zstd-json-2026-10-09 --source output/module-zstd-json-2026-10-08 \\
      --out data/build/clinical-kd1/decoded
    uv run tools/ingest/scripts/embed_modules.py --projection $P --family medications \\
      --source output/module-zstd-drug-e5-2026-10-05 --out data/build/drug-kd1/decoded

    # Freshly rebuilt, already compacted modules: no catalog, nothing to decode; the databases of
    # --from-dir are copied to --out and embedded there.
    uv run tools/ingest/scripts/embed_modules.py --projection $P --family clinical \\
      --from-dir data/build/<build>/compacted --out data/build/<build>/kd1/decoded

Encoding runs in shards saved as they finish (`--out/../shards-<family>`), so a stopped run resumes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG = REPO_ROOT / "apps/app/src/features/modules/catalog.preview.json"
FAMILIES = {
    "clinical": {"ids": ("minimed.clinical.recommendation.",), "chunks": ""},
    "reference": {
        "ids": ("minimed.mkb.ru", "minimed.reference.krasotaimedicina.ru"),
        "chunks": """WHERE s.title IN ('Код и название', 'Синонимы', 'Краткое описание',
                                  'Общие сведения', 'Симптомы')
               AND c.original_text NOT LIKE 'Синонимы на странице не указаны%'""",
    },
    "medications": {
        "ids": ("minimed.medications.instructions.", "minimed.medications.ru"),
        # Published after E3 and never embedded; indication search covers the ГРЛС + Allmed modules.
        "exclude": ("minimed.medications.instructions.manufacturer-site.ru",),
        "chunks": """WHERE s.section_type = 'indications'
               OR s.title IN ('Показания', 'Показания к применению', 'ПОКАЗАНИЯ К ПРИМЕНЕНИЮ')""",
    },
}

# Giga ships its own modelling file (Qwen3 with bidirectional attention, 116 lines, no I/O); it
# is loaded only at the revision whose code was read
# (docs/research/embedding-distillation-2026-10-09.md).
MODEL = "ai-sage/Giga-Embeddings-instruct-480M-0826"
MODEL_REVISION = "1763d603adac8057bd6482a708001b0ed2e0a903"
PROJECTION_SHA256 = "097ec0357f7c8fde2535189a0a7172faf3fcc4b509cb4ba0662631281931174d"
PASSAGE_CHARS = 1200
MAX_TOKENS = 256
# Small batches keep each Metal command buffer short: longer ones were aborted by macOS
# («Impacting Interactivity») and can leave vectors unwritten.
BATCH = 16
SHARD = 10_000
# Must equal KD1_PROFILE in packages/search-semantic/src/profile.ts.
PROFILE = {
    "id": "localmed.kd1-giga480m.384.int8.v1",
    "dimensions": 384,
    "vector_format": "int8",
    "normalization": "l2",
    "generator": MODEL,
    "generator_version": MODEL_REVISION,
    "fingerprint": (
        "giga480m:1763d603:passage-title-section-1200c-256t:mean:l2:pca384-097ec035:l2:int8x127"
    ),
    "metadata": {
        "intendedUse": "clinical-recommendation-semantic-search",
        "neuralModel": True,
        "queryEncoder": "kd1-student-v3 (multilingual-e5-small distilled from the passage model)",
        "queryPrefix": "query: ",
        "passagePrefix": "",
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
        if module["id"] in FAMILIES[family].get("exclude", ()):
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
            f"{title}. {' / '.join(json.loads(path_json) or [])}. {text}"[:PASSAGE_CHARS],
        )
        for chunk_id, title, path_json, text in rows
    ]


def quantize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    scaled = np.where(norms > 0, vectors / np.maximum(norms, 1e-12), 0) * 127
    rounded = np.sign(scaled) * np.floor(np.abs(scaled) + 0.5)
    return np.clip(rounded, -127, 127).astype(np.int8)


def load_projection(path: Path) -> np.ndarray:
    if sha256(path) != f"sha256:{PROJECTION_SHA256}":
        raise SystemExit(f"{path} is not the projection of {PROFILE['id']}")
    return np.load(path).astype(np.float32)


def project(vectors: np.ndarray, projection: np.ndarray) -> np.ndarray:
    unit = vectors / np.linalg.norm(vectors, axis=1, keepdims=True).clip(1e-12)
    return unit @ projection


def encode(texts: list[str], shards: Path) -> np.ndarray:
    import torch
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = SentenceTransformer(
        MODEL,
        revision=MODEL_REVISION,
        device=device,
        trust_remote_code=True,
        model_kwargs={"torch_dtype": torch.bfloat16},
    )
    model.max_seq_length = MAX_TOKENS
    shards.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    for start in range(0, len(texts), SHARD):
        path = shards / f"{start:07d}.npy"
        if path.exists():
            continue
        part = model.encode(
            texts[start : start + SHARD],
            batch_size=BATCH,
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
    parser.add_argument("--source", type=Path, action="append", default=[])
    parser.add_argument(
        "--from-dir",
        type=Path,
        help="embed the databases of this directory (copied to --out) instead of released archives",
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--projection", type=Path, required=True)
    args = parser.parse_args()
    projection = load_projection(args.projection)
    if args.from_dir is None and not args.source:
        parser.error("give --source (released archives) or --from-dir (rebuilt databases)")

    family = FAMILIES[args.family]
    if args.from_dir is not None:
        args.out.mkdir(parents=True, exist_ok=True)
        databases = []
        for source in sorted(args.from_dir.glob("*.db")):
            target = args.out / source.name
            if not target.exists():
                shutil.copyfile(source, target)
            databases.append(target)
        print(f"copied: {len(databases)} modules → {args.out}", flush=True)
    else:
        modules = released_modules(args.family, args.source)
        databases = decode(modules, args.out)
        print(f"decoded: {len(databases)} modules → {args.out}", flush=True)

    per_module = [passages(path, family["chunks"]) for path in databases]
    texts = [text for rows in per_module for _, text in rows]
    vectors = quantize(
        project(encode(texts, args.out.parent / f"shards-{args.family}"), projection)
    )
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
