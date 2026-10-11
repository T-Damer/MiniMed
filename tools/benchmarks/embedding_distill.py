# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy>=2", "onnx>=1.17", "onnxruntime>=1.20", "pillow>=11", "pyyaml>=6",
#   "sentence-transformers>=6.1", "torch>=2.4", "torchvision", "transformers>=5.19",
# ]
# ///
"""Strong build-time teacher, small on-device query encoder (STATE KD1, search roadmap item 8).

A large embedding model (the teacher) encodes the КР passages once, on the build machine. The phone
keeps a query encoder the size of the shipped e5-small (the student), trained to place a query where
the teacher would place it, so its vectors are compared with the teacher's passage vectors. The
student learns the teacher's *query function*, not relevance labels: any Russian medical text works
as training input, and no benchmark query or its source record is used.

    W=<scratch work dir of embedding_eval.py: corpus.jsonl, icd-queries.jsonl, emb-<teacher>.npy>
    uv run tools/benchmarks/embedding_distill.py texts --work $W
    uv run tools/benchmarks/embedding_distill.py targets --work $W --teacher ai-sage/Giga-Embeddings-instruct-480M-0826
    uv run tools/benchmarks/embedding_distill.py project --work $W --teacher … --dims 384
    uv run tools/benchmarks/embedding_distill.py train --work $W --teacher … --dims 384 --out $W/student-…
    uv run tools/benchmarks/embedding_distill.py evaluate --work $W --teacher … --dims 384 --student $W/student-…
    uv run tools/benchmarks/embedding_distill.py export --student $W/student-… --out $W/onnx/<name>

Nothing here ships in the app; private sources stay local and the forum set (licence unknown) is
never used, because the student's weights would ship.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import embedding_eval as ee

REPO = Path(__file__).resolve().parents[2]
RAW = REPO / "data/raw/query-datasets"
STUDENT_BASE = "intfloat/multilingual-e5-small"
STUDENT_PREFIX = "query: "
MAX_TOKENS = 128
SEED = 20261009
CORPUS_SPANS = 160_000
NEIGHBOURS = 16


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def key(value: str) -> str:
    return ee.normalize(value)


def benchmark_texts(work: Path) -> set[str]:
    """Every `query` string of every benchmark file, plus the working query set."""

    def queries(value: object) -> list[str]:
        if isinstance(value, dict):
            found = [value["query"]] if isinstance(value.get("query"), str) else []
            return found + [q for item in value.values() for q in queries(item)]
        if isinstance(value, list):
            return [q for item in value for q in queries(item)]
        return []

    blocked = {
        key(json.loads(line)["query"])
        for line in (work / "icd-queries.jsonl").read_text().splitlines()
        if line
    }
    for path in sorted((REPO / "tools/benchmarks").rglob("*.json")):
        if "node_modules" in path.parts:
            continue
        blocked |= {key(q) for q in queries(json.loads(path.read_text()))}
    return blocked


def rumedprime_texts() -> list[str]:
    """Complaints and histories of events outside the RuMedTop3 dev/test ids Q1 samples from."""
    held_out = {
        json.loads(line)["idx"]
        for name in ("top3-dev_v1.jsonl", "top3-test_v1.jsonl")
        for line in (RAW / "rumedprime" / name).read_text().splitlines()
        if line.strip()
    }
    texts = []
    lines = (RAW / "rumedprime/RuMedPrimeData.tsv").read_text().splitlines()[1:]
    for line in lines:
        symptoms, anamnesis, _icd, _patient, event, *_ = line.split("\t") + [""] * 6
        if event in held_out:
            continue
        for value in (symptoms, anamnesis[:400]):
            value = clean(value)
            if len(value) >= 12 and "*" not in value:
                texts.append(value)
    return texts


def ruccod_texts() -> list[str]:
    """Train-split conclusions and their annotated phrases (Q1 test is the test split)."""
    texts = []
    base = RAW / "ruccod/data/ruccod_train"
    for path in sorted(base.glob("*.txt")):
        for sentence in re.split(r"(?<=[.;])\s+", path.read_text()):
            sentence = clean(sentence)
            if len(sentence) >= 8:
                texts.append(sentence[:400])
    for path in sorted(base.glob("*.ann")):
        for line in path.read_text().splitlines():
            parts = line.split("\t")
            if line.startswith("T") and len(parts) >= 3 and len(parts[2]) >= 5:
                texts.append(clean(parts[2]))
    return texts


def icd_names() -> list[str]:
    import yaml

    names = yaml.safe_load((RAW / "ruccod/data/mkb2descr.yaml").read_text())
    return [
        clean(re.sub(r"\([A-Z]\d\d(?:\.\d)?-[A-Z]\d\d(?:\.\d)?\)", "", str(v)))
        for v in names.values()
        if v and len(str(v)) >= 4
    ]


def corpus_texts(rows: list[dict], rng: random.Random) -> list[str]:
    """Titles, section names, leading sentences and short word spans of the КР chunks."""
    texts = {row["title"] for row in rows}
    for row in rows:
        for part in row["sectionPath"].split(" / "):
            if len(part) >= 4:
                texts.add(part)
    sample = rng.sample(rows, min(CORPUS_SPANS, len(rows)))
    for index, row in enumerate(sample):
        words = row["text"].split()
        if len(words) < 4:
            continue
        if index % 2 == 0:
            texts.add(
                clean(re.split(r"(?<=[.!?])\s", row["text"], maxsplit=1)[0])[:300]
            )
        length = rng.randint(3, 14)
        start = rng.randint(0, max(0, len(words) - length))
        texts.add(clean(" ".join(words[start : start + length])))
    return sorted(texts)


INDICATION_SECTIONS = """
    WHERE s.section_type = 'indications'
       OR s.title IN ('Показания', 'Показания к применению', 'ПОКАЗАНИЯ К ПРИМЕНЕНИЮ')"""


def indication_texts(packs: Path, rng: random.Random) -> list[str]:
    """Drug names and indication fragments of the drug modules the medications scope embeds."""
    import sqlite3

    found: set[str] = set()
    for path in sorted(packs.glob("*.db")):
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        query = f"""SELECT d.title, c.original_text
                      FROM chunks c
                      JOIN document_versions v ON v.id = c.document_version_id
                      JOIN documents d ON d.id = v.document_id
                      JOIN sections s ON s.id = c.section_id {INDICATION_SECTIONS}"""
        for title, text in db.execute(query):
            found.add(clean(title))
            sentences = [
                clean(part)
                for part in re.split(r"(?<=[.;:])\s+", text)
                if len(part) >= 8
            ]
            if sentences:
                found.add(rng.choice(sentences)[:300])
            words = text.split()
            if len(words) >= 4:
                length = rng.randint(3, 10)
                start = rng.randint(0, max(0, len(words) - length))
                found.add(clean(" ".join(words[start : start + length])))
        db.close()
    return sorted(found)


def indication_sentences(packs: Path) -> list[str]:
    """Every sentence of the indication sections (lay words such as «молочница» live there)."""
    import sqlite3

    found: set[str] = set()
    for path in sorted(packs.glob("*.db")):
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        query = f"""SELECT c.original_text
                      FROM chunks c JOIN sections s ON s.id = c.section_id {INDICATION_SECTIONS}"""
        for (text,) in db.execute(query):
            for part in re.split(r"(?<=[.;:])\s+", text):
                if 8 <= len(part.strip()) <= 300:
                    found.add(clean(part))
        db.close()
    return sorted(found)


def alias_terms(core: Path) -> list[str]:
    """Names and the colloquial or alternative names the core's sources give for them."""
    import sqlite3

    db = sqlite3.connect(f"file:{core}?mode=ro", uri=True)
    found = {
        clean(value)
        for row in db.execute("SELECT canonical_term, alias FROM aliases")
        for value in row
        if isinstance(value, str) and 3 <= len(value.strip()) <= 120
    }
    db.close()
    return sorted(found)


def short_spans(rows: list[dict], rng: random.Random) -> list[str]:
    """One 2–6-word span of every КР chunk: the length of a hurried query."""
    found: set[str] = set()
    for row in rows:
        words = row["text"].split()
        if len(words) < 3:
            continue
        length = rng.randint(2, 6)
        start = rng.randint(0, max(0, len(words) - length))
        found.add(clean(" ".join(words[start : start + length])))
    return sorted(found)


def texts(
    work: Path, drug_packs: Path | None, core: Path | None = None, spans: bool = False
) -> None:
    rng = random.Random(SEED)
    blocked = benchmark_texts(work)
    rows = ee.load_corpus(work)
    pools = {
        "rumedprime": rumedprime_texts(),
        "ruccod": ruccod_texts(),
        "icd": icd_names(),
        "corpus": corpus_texts(rows, rng),
    }
    if drug_packs is not None:
        pools["indications"] = indication_texts(drug_packs, rng)
    # Later additions draw from their own generator, so the earlier pools stay text-identical and
    # their teacher targets are reused.
    extra = random.Random(SEED + 2)
    if drug_packs is not None and core is not None:
        pools["indication-sentences"] = indication_sentences(drug_packs)
    if core is not None:
        pools["aliases"] = alias_terms(core)
    if spans:
        pools["short-spans"] = short_spans(rows, extra)
    seen: set[str] = set()
    out = []
    for source, values in pools.items():
        kept = 0
        for value in values:
            k = key(value)
            if len(k) < 4 or k in seen or k in blocked:
                continue
            seen.add(k)
            out.append({"text": value, "source": source})
            kept += 1
        print(f"texts: {source} {kept} of {len(values)}")
    rng.shuffle(out)
    (work / "distill-texts.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in out) + "\n"
    )
    print(f"texts: {len(out)} in total, {len(blocked)} benchmark texts excluded")


def load_texts(work: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in (work / "distill-texts.jsonl").read_text().splitlines()
        if line
    ]


def targets(work: Path, teacher: str, batch: int) -> None:
    """The teacher's own query vectors of every training text (instruction prefix included).

    `targets-<teacher>.npy` is stored with the texts it encodes (`.texts.json`); a later text set
    reuses every vector whose text it already has and encodes only the new ones.
    """
    rows = load_texts(work)
    wanted = [r["text"] for r in rows]
    out = work / f"targets-{ee.slug(teacher)}.npy"
    known_path = out.with_suffix(".texts.json")
    known: dict[str, np.ndarray] = {}
    if out.exists() and known_path.exists():
        previous = np.load(out)
        known = dict(zip(json.loads(known_path.read_text()), previous, strict=True))
    missing = sorted({t for t in wanted if t not in known})
    print(
        f"targets: {len(wanted) - len(missing)} reused, {len(missing)} to encode",
        flush=True,
    )
    started = time.perf_counter()
    if missing:
        model, device = ee.load_model(teacher)
        model.max_seq_length = MAX_TOKENS
        prefix = ee.QUERY_PREFIX.get(teacher, "")
        for start in range(0, len(missing), ee.SHARD):
            part = missing[start : start + ee.SHARD]
            vectors = model.encode(
                [prefix + t for t in part],
                batch_size=batch,
                normalize_embeddings=True,
                convert_to_numpy=True,
            ).astype(np.float16)
            known.update(zip(part, vectors, strict=True))
            print(
                f"targets: {min(start + ee.SHARD, len(missing))}/{len(missing)} on {device}, "
                f"{time.perf_counter() - started:.0f}s",
                flush=True,
            )
    np.save(out, np.stack([known[t] for t in wanted]))
    known_path.write_text(json.dumps(wanted, ensure_ascii=False))
    print(f"targets: {len(wanted)} in {time.perf_counter() - started:.0f}s")


def unit(vectors: np.ndarray) -> np.ndarray:
    vectors = vectors.astype(np.float32)
    return vectors / np.linalg.norm(vectors, axis=-1, keepdims=True).clip(1e-6)


def projection_path(work: Path, teacher: str, dims: int) -> Path:
    return work / f"projection-{ee.slug(teacher)}-{dims}.npy"


def project(work: Path, teacher: str, dims: int) -> None:
    """Uncentred principal directions of the teacher's passage vectors (keeps dot products)."""
    passages = unit(np.load(work / f"emb-{ee.slug(teacher)}.npy"))
    if dims >= passages.shape[1]:
        basis = np.eye(passages.shape[1], dtype=np.float32)
    else:
        values, vectors = np.linalg.eigh(passages.T @ passages)
        basis = vectors[:, np.argsort(-values)[:dims]].astype(np.float32)
        kept = values[np.argsort(-values)[:dims]].sum() / values.sum()
        print(f"project: {teacher} → {dims} dims keeps {kept:.3f} of the energy")
    np.save(projection_path(work, teacher, dims), basis)


def projected(work: Path, teacher: str, dims: int, vectors: np.ndarray) -> np.ndarray:
    return unit(unit(vectors) @ np.load(projection_path(work, teacher, dims)))


def neighbours(passages: np.ndarray, queries: np.ndarray, k: int) -> np.ndarray:
    import torch

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    store = torch.from_numpy(passages).to(device, torch.float16)
    out = []
    for start in range(0, len(queries), 4096):
        q = torch.from_numpy(queries[start : start + 4096]).to(device, torch.float16)
        out.append((q @ store.T).topk(k, dim=1).indices.cpu().numpy())
    return np.concatenate(out)


def build_student(dims: int, device: str):
    from sentence_transformers import SentenceTransformer, models

    base = SentenceTransformer(STUDENT_BASE, device=device)
    base.max_seq_length = MAX_TOKENS
    width = base.encode(["x"]).shape[1]
    head = models.Dense(width, dims, bias=False, activation_function=None)
    student = SentenceTransformer(modules=[base[0], base[1], head], device=device)
    student.max_seq_length = MAX_TOKENS
    return student, base


def encode_raw(model, texts: list[str], device: str):
    features = model.preprocess(texts)
    features = {k: v.to(device) if hasattr(v, "to") else v for k, v in features.items()}
    return model(features)["sentence_embedding"]


def train(
    work: Path,
    teacher: str,
    dims: int,
    out: Path,
    epochs: float,
    batch: int,
    rank_weight: float,
    temperature: float,
    encoder_lr: float,
    init: Path | None = None,
    steps_override: int | None = None,
    pairs_path: Path | None = None,
    pair_weight: float = 1.0,
    pair_batch: int = 64,
    extra_passages: Path | None = None,
    hard_mining: bool = False,
) -> None:
    """Distillation (cosine + ranking KL); with `pairs_path` also a supervised InfoNCE term.

    A pair is a train-split complaint or diagnosis phrase and its relevant recommendations
    (`build-distill-pairs.ts`). Its positive is the teacher's best-scoring chunk among those
    documents; negatives are the other positives of the batch and the teacher's own nearest
    chunks of other documents. The passage vectors stay the teacher's: only queries move.
    """
    import torch
    import torch.nn.functional as F
    from sentence_transformers import SentenceTransformer

    torch.manual_seed(SEED)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    rows = load_texts(work)
    goal = projected(
        work, teacher, dims, np.load(work / f"targets-{ee.slug(teacher)}.npy")
    )
    passages = projected(
        work, teacher, dims, np.load(work / f"emb-{ee.slug(teacher)}.npy")
    )
    chunk_docs = np.array([row["documentId"] for row in ee.load_corpus(work)])
    if extra_passages is not None:
        # Already projected vectors of other families (the drug indication sections), so the
        # ranking term also teaches how queries order those passages.
        extra = unit(np.load(extra_passages))
        extra_docs = json.loads(extra_passages.with_suffix(".docs.json").read_text())
        passages = np.concatenate([passages, extra])
        chunk_docs = np.concatenate([chunk_docs, np.array(extra_docs)])
        print(f"passages: {len(passages)} ({len(extra)} extra)", flush=True)
    near = neighbours(passages, goal, NEIGHBOURS)
    if init is not None:
        student = SentenceTransformer(str(init), device=device)
        student.max_seq_length = MAX_TOKENS
    else:
        student, base = build_student(dims, device)
        # Least-squares start for the head: e5-small's pooled vectors onto the teacher targets.
        sample = list(range(min(20_000, len(rows))))
        with torch.no_grad():
            pooled = base.encode(
                [STUDENT_PREFIX + rows[i]["text"] for i in sample],
                batch_size=256,
                convert_to_numpy=True,
            )
        solution, *_ = np.linalg.lstsq(pooled, goal[sample], rcond=None)
        student[2].linear.weight.data = torch.from_numpy(solution.T.copy()).to(device)

    pair_rows: list[dict] = []
    if pairs_path is not None:
        doc_chunks: dict[str, np.ndarray] = {
            doc: np.flatnonzero(chunk_docs == doc) for doc in np.unique(chunk_docs)
        }
        text_index = {r["text"]: i for i, r in enumerate(rows)}
        for line in pairs_path.read_text().splitlines():
            pair = json.loads(line)
            i = text_index.get(pair["text"])
            docs = [d for d in pair["positives"] if d in doc_chunks]
            if i is None or not docs:
                continue
            chunks = np.concatenate([doc_chunks[d] for d in docs])
            best = int(chunks[np.argmax(passages[chunks] @ goal[i])])
            negatives = [int(c) for c in near[i] if chunk_docs[c] not in docs][:4]
            pair_rows.append(
                {"row": i, "docs": set(docs), "chunks": [best, *negatives]}
            )
        print(f"pairs: {len(pair_rows)} usable", flush=True)

    encoder_params = list(student[0].parameters())
    head_params = list(student[2].parameters())
    optimizer = torch.optim.AdamW(
        [
            {"params": encoder_params, "lr": encoder_lr},
            {"params": head_params, "lr": 5e-4},
        ],
        weight_decay=0.01,
    )
    steps = steps_override or math.ceil(len(rows) / batch * epochs)
    warmup = max(1, steps // 20)
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer,
        lambda s: (
            min(1.0, (s + 1) / warmup) * max(0.0, (steps - s) / max(1, steps - warmup))
        ),
    )
    store = torch.from_numpy(passages).to(device)
    targets_t = torch.from_numpy(goal).to(device)
    order = np.random.default_rng(SEED).permutation(len(rows))
    if hard_mining:
        # Half of every batch uniform, half in proportion to how far the starting student is from
        # the teacher on that text: rare words and false friends get seen far more often.
        with torch.no_grad():
            start = unit(
                student.encode(
                    [STUDENT_PREFIX + r["text"] for r in rows],
                    batch_size=256,
                    convert_to_numpy=True,
                )
            )
        gap = np.clip(1 - (start * goal).sum(-1), 1e-4, None)
        weights = 0.5 / len(rows) + 0.5 * gap / gap.sum()
        order = np.random.default_rng(SEED).choice(
            len(rows), size=max(len(rows), steps * batch), p=weights / weights.sum()
        )
        print(
            f"hard mining: mean gap {gap.mean():.3f}, p90 {np.percentile(gap, 90):.3f}",
            flush=True,
        )
    pair_order = np.random.default_rng(SEED + 1).permutation(max(1, len(pair_rows)))
    student.train()
    started = time.perf_counter()
    log = []
    for step in range(steps):
        index = order[(step * batch) % len(order) : (step * batch) % len(order) + batch]
        if len(index) < 2:
            continue
        s = F.normalize(
            encode_raw(
                student, [STUDENT_PREFIX + rows[i]["text"] for i in index], device
            ),
            dim=-1,
        )
        t = targets_t[index]
        loss_cos = (1 - (s * t).sum(-1)).mean()
        loss = loss_cos
        if rank_weight > 0:
            pool = store[
                torch.from_numpy(np.unique(near[index].reshape(-1))).to(device)
            ]
            teacher_logits = (t @ pool.T) / temperature
            student_logits = (s @ pool.T) / temperature
            loss_rank = F.kl_div(
                F.log_softmax(student_logits, -1),
                F.log_softmax(teacher_logits, -1),
                log_target=True,
                reduction="batchmean",
            )
            loss = loss + rank_weight * loss_rank
        loss_pair = torch.zeros((), device=device)
        if pair_rows:
            start = (step * pair_batch) % len(pair_rows)
            chosen = [pair_rows[j] for j in pair_order[start : start + pair_batch]]
            pool_ids = np.unique([c for pair in chosen for c in pair["chunks"]])
            pool = store[torch.from_numpy(pool_ids).to(device)]
            pool_docs = chunk_docs[pool_ids]
            positive = torch.tensor(
                np.array([[d in pair["docs"] for d in pool_docs] for pair in chosen]),
                device=device,
            )
            q = F.normalize(
                encode_raw(
                    student,
                    [STUDENT_PREFIX + rows[pair["row"]]["text"] for pair in chosen],
                    device,
                ),
                dim=-1,
            )
            logits = (q @ pool.T) / temperature
            loss_pair = (
                torch.logsumexp(logits, -1)
                - torch.logsumexp(logits.masked_fill(~positive, float("-inf")), -1)
            ).mean()
            loss = loss + pair_weight * loss_pair
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(student.parameters(), 1.0)
        optimizer.step()
        scheduler.step()
        if step % 100 == 0 or step == steps - 1:
            entry = {
                "step": step,
                "of": steps,
                "loss": round(float(loss), 4),
                "cos": round(1 - float(loss_cos), 4),
                "pair": round(float(loss_pair), 4),
                "seconds": round(time.perf_counter() - started),
            }
            log.append(entry)
            print(json.dumps(entry), flush=True)
    student.eval()
    out.mkdir(parents=True, exist_ok=True)
    student.save(str(out))
    (out / "distill-train.json").write_text(
        json.dumps(
            {
                "teacher": teacher,
                "dims": dims,
                "base": STUDENT_BASE,
                "texts": len(rows),
                "epochs": epochs,
                "batch": batch,
                "rankWeight": rank_weight,
                "temperature": temperature,
                "encoderLr": encoder_lr,
                "init": str(init) if init else None,
                "steps": steps,
                "pairs": len(pair_rows),
                "pairWeight": pair_weight,
                "pairBatch": pair_batch,
                "log": log,
            },
            indent=1,
        )
    )


def ranking_metrics(ranked: list[str], relevant: dict[str, int]) -> dict[str, float]:
    first = next((i + 1 for i, d in enumerate(ranked[:10]) if d in relevant), None)
    strict = next(
        (i + 1 for i, d in enumerate(ranked[:5]) if relevant.get(d) == 3), None
    )
    return {
        "at1": float(first == 1),
        "at5": float(first is not None and first <= 5),
        "strictAt5": float(strict is not None),
        "mrr10": 0.0 if first is None else 1 / first,
    }


def paired(
    a: list[float], b: list[float], rng: np.random.Generator
) -> tuple[float, float, float]:
    diff = np.array(b) - np.array(a)
    boot = [diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(10_000)]
    return (
        float(diff.mean()),
        float(np.percentile(boot, 2.5)),
        float(np.percentile(boot, 97.5)),
    )


def evaluate(work: Path, teacher: str, dims: int, students: list[Path]) -> None:
    import torch
    from sentence_transformers import SentenceTransformer

    rows = ee.load_corpus(work)
    queries = [
        json.loads(line)
        for line in (work / "icd-queries.jsonl").read_text().splitlines()
        if line
    ]
    texts_ = [q["query"] for q in queries]
    runs: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    e5 = SentenceTransformer(STUDENT_BASE, device="cpu")
    runs["e5-small (shipped)"] = (
        ee.quantize(unit(np.load(work / f"emb-{ee.slug(STUDENT_BASE)}.npy")), "int8"),
        e5.encode([STUDENT_PREFIX + t for t in texts_], normalize_embeddings=True),
    )
    teacher_passages = ee.quantize(
        projected(work, teacher, dims, np.load(work / f"emb-{ee.slug(teacher)}.npy")),
        "int8",
    )
    teacher_model, _ = ee.load_model(teacher)
    teacher_queries = teacher_model.encode(
        [ee.QUERY_PREFIX.get(teacher, "") + t for t in texts_],
        normalize_embeddings=True,
    )
    runs[f"teacher@{dims}"] = (
        teacher_passages,
        projected(work, teacher, dims, teacher_queries),
    )
    del teacher_model
    latency: dict[str, float] = {}
    for path in students:
        student = SentenceTransformer(str(path), device="cpu")
        runs[f"student {path.name}"] = (
            teacher_passages,
            unit(student.encode([STUDENT_PREFIX + t for t in texts_])),
        )
        torch.set_num_threads(1)
        timings = []
        for t in texts_[:50]:
            started = time.perf_counter()
            student.encode([STUDENT_PREFIX + t])
            timings.append((time.perf_counter() - started) * 1000)
        latency[path.name] = round(statistics.median(timings), 1)
        torch.set_num_threads(8)

    per_query: dict[str, list[dict[str, float]]] = {}
    for name, (store, query_vectors) in runs.items():
        scored = []
        for index, q in enumerate(queries):
            groups = ee.semantic_groups(store @ unit(query_vectors[index]), rows)
            scored.append(ranking_metrics([d for d, _ in groups], q["relevantKr"]))
        per_query[name] = scored

    rng = np.random.default_rng(SEED)
    baseline = per_query["e5-small (shipped)"]
    report = {}
    for name, scored in per_query.items():
        slices = defaultdict(list)
        for q, s in zip(queries, scored):
            for slice_ in ("all", f"source:{q['source']}", f"split:{q['split']}"):
                slices[slice_].append(s)
        entry = {
            slice_: {k: round(statistics.fmean(r[k] for r in rs), 3) for k in rs[0]}
            | {"n": len(rs)}
            for slice_, rs in sorted(slices.items())
        }
        if name != "e5-small (shipped)":
            for metric in ("at1", "at5"):
                mean, low, high = paired(
                    [r[metric] for r in baseline], [r[metric] for r in scored], rng
                )
                entry[f"delta_{metric}_vs_e5"] = [
                    round(mean, 3),
                    round(low, 3),
                    round(high, 3),
                ]
        entry["perQuery"] = {
            q["query_id"]: {"at1": r["at1"], "at5": r["at5"]}
            for q, r in zip(queries, scored)
        }
        report[name] = entry
        a = entry["all"]
        print(
            f"{name:40} @1 {a['at1']:.3f} @5 {a['at5']:.3f} strict@5 {a['strictAt5']:.3f} "
            f"mrr {a['mrr10']:.3f} | complaints @5 {entry['source:rumedprime']['at5']:.3f} "
            f"diagnoses @5 {entry['source:ruccod']['at5']:.3f}"
            + (
                f" | Δ@5 {entry['delta_at5_vs_e5']} Δ@1 {entry['delta_at1_vs_e5']}"
                if "delta_at5_vs_e5" in entry
                else ""
            )
        )
    report["studentQueryCpu1ThreadMs"] = latency
    print("student query, 1 CPU thread p50 ms:", latency)
    (work / f"report-distill-{ee.slug(teacher)}-{dims}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1)
    )


def export(student_dir: Path, out: Path) -> None:
    """transformers.js layout: fp32 graph plus the int8 `onnx/model_quantized.onnx` the app loads.

    The head is applied to every token before the app's mean pooling (pooling is linear), so the graph
    keeps e5's interface and returns `last_hidden_state` already in the teacher space. The head's
    MatMul stays fp32: it reads the final LayerNorm output, whose outlier channels do not survive 8-bit
    dynamic activations (cosine to PyTorch fell to −0.02); weights are quantised per channel.
    """
    import shutil

    import onnx
    import onnxruntime as ort
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from sentence_transformers import SentenceTransformer

    student = SentenceTransformer(str(student_dir), device="cpu")
    student.eval()
    weight = student[2].linear.weight.detach().clone()

    class Projected(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.model = student[0].auto_model
            self.register_buffer("w", weight.T.contiguous())

        def forward(self, input_ids, attention_mask, token_type_ids):
            hidden = self.model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                token_type_ids=token_type_ids,
            ).last_hidden_state
            return hidden @ self.w

    (out / "onnx").mkdir(parents=True, exist_ok=True)
    full, quantized = out / "onnx/model.onnx", out / "onnx/model_quantized.onnx"
    sample = student.tokenizer([STUDENT_PREFIX + "боль в груди"], return_tensors="pt")
    axes = {0: "batch", 1: "sequence"}
    torch.onnx.export(
        Projected().eval(),
        (
            sample["input_ids"],
            sample["attention_mask"],
            torch.zeros_like(sample["input_ids"]),
        ),
        str(full),
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            name: axes
            for name in (
                "input_ids",
                "attention_mask",
                "token_type_ids",
                "last_hidden_state",
            )
        },
        opset_version=14,
        dynamo=False,
    )
    graph = onnx.load(str(full), load_external_data=False).graph
    head = [
        n.name
        for n in graph.node
        if n.op_type == "MatMul" and "last_hidden_state" in n.output
    ]
    quantize_dynamic(
        str(full),
        str(quantized),
        weight_type=QuantType.QUInt8,
        per_channel=True,
        nodes_to_exclude=head,
    )
    for name in (
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
    ):
        if (student_dir / name).exists():
            shutil.copy(student_dir / name, out / name)

    texts = [
        STUDENT_PREFIX + t
        for t in (
            "болит желудок после еды",
            "кашель с мокротой и температура 38 третий день",
            "Хроническая сердечная недостаточность",
            "сыпь у ребенка после антибиотика",
        )
    ]
    reference = student.encode(texts, normalize_embeddings=True)
    for path in (full, quantized):
        session = ort.InferenceSession(str(path))
        cosines = []
        for text, ref in zip(texts, reference):
            enc = student.tokenizer([text], return_tensors="np")
            ids = enc["input_ids"].astype(np.int64)
            hidden = session.run(
                None,
                {
                    "input_ids": ids,
                    "attention_mask": enc["attention_mask"].astype(np.int64),
                    "token_type_ids": np.zeros_like(ids),
                },
            )[0][0].mean(0)
            cosines.append(float(hidden / np.linalg.norm(hidden) @ ref))
        print(
            f"export: {path.name} {path.stat().st_size / 1e6:.1f} MB, "
            f"cosine to PyTorch min {min(cosines):.4f}"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    t = sub.add_parser("texts")
    t.add_argument("--work", type=Path, required=True)
    t.add_argument(
        "--drug-packs", type=Path, help="decoded drug modules: indication texts"
    )
    t.add_argument(
        "--core", type=Path, help="core.db: alias terms (and every indication sentence)"
    )
    t.add_argument(
        "--short-spans", action="store_true", help="a 2-6-word span of every КР chunk"
    )
    g = sub.add_parser("targets")
    g.add_argument("--work", type=Path, required=True)
    g.add_argument("--teacher", required=True)
    g.add_argument("--batch", type=int, default=64)
    p = sub.add_parser("project")
    p.add_argument("--work", type=Path, required=True)
    p.add_argument("--teacher", required=True)
    p.add_argument("--dims", type=int, required=True)
    r = sub.add_parser("train")
    r.add_argument("--work", type=Path, required=True)
    r.add_argument("--teacher", required=True)
    r.add_argument("--dims", type=int, required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--epochs", type=float, default=2.0)
    r.add_argument("--batch", type=int, default=128)
    r.add_argument("--rank-weight", type=float, default=1.0)
    r.add_argument("--temperature", type=float, default=0.05)
    r.add_argument("--encoder-lr", type=float, default=4e-5)
    r.add_argument("--init", type=Path, help="continue from a trained student")
    r.add_argument("--steps", type=int, help="override the step count of --epochs")
    r.add_argument(
        "--pairs", type=Path, help="supervised pairs (build-distill-pairs.ts)"
    )
    r.add_argument("--pair-weight", type=float, default=1.0)
    r.add_argument("--pair-batch", type=int, default=64)
    r.add_argument(
        "--extra-passages",
        type=Path,
        help="projected vectors (+ .docs.json) of other families",
    )
    r.add_argument(
        "--hard-mining",
        action="store_true",
        help="oversample texts far from the teacher",
    )
    v = sub.add_parser("evaluate")
    v.add_argument("--work", type=Path, required=True)
    v.add_argument("--teacher", required=True)
    v.add_argument("--dims", type=int, required=True)
    v.add_argument("--student", type=Path, action="append", default=[])
    x = sub.add_parser("export")
    x.add_argument("--student", type=Path, required=True)
    x.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "export":
        export(args.student, args.out)
    elif args.command == "texts":
        texts(args.work, args.drug_packs, args.core, args.short_spans)
    elif args.command == "targets":
        targets(args.work, args.teacher, args.batch)
    elif args.command == "project":
        project(args.work, args.teacher, args.dims)
    elif args.command == "train":
        train(
            args.work,
            args.teacher,
            args.dims,
            args.out,
            args.epochs,
            args.batch,
            args.rank_weight,
            args.temperature,
            args.encoder_lr,
            args.init,
            args.steps,
            args.pairs,
            args.pair_weight,
            args.pair_batch,
            args.extra_passages,
            args.hard_mining,
        )
    else:
        evaluate(args.work, args.teacher, args.dims, args.student)


if __name__ == "__main__":
    main()
