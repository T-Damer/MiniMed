# EmbeddingGemma 2 on clinical-recommendation search, 2026-10-07

Verdict: **not adopted**. On the Q1 real-language queries over the released КР modules it finds a
relevant recommendation in the top 5 slightly more often than e5-small (R@5 0.452 → 0.497), but the
gain is not significant on 330 queries (95 % CI −0.003…+0.094), the first hit is not better (R@1
0.288 → 0.270), and the query model is 66× slower on one CPU thread (4.3 → 284 ms) and 2.7× larger
(118 → 314 MB). Research only (STATE EG2, search roadmap item 8: «a larger embedding model for КР only
if a phone measurement allows»); nothing in the app changed.

## Model

| Item | Finding |
|---|---|
| Release | `google/embeddinggemma-2`, revision `914f7f89`, 2026-10-06; Apache 2.0, not gated. |
| Size | 740M total = 270M text (130M transformer + 140M per-layer embeddings) + vision 170M + audio 300M. Text-only loading: `config_kwargs={"vision_config": None, "audio_config": None}`. |
| Output | 768 dimensions, Matryoshka truncation to 512 / 256 / 128 (renormalise). Context 8 192 tokens. bf16/fp32 only (fp16 gives NaN). |
| Prompts | query `task: search result \| query: {q}`, document `title: {title} \| text: {content}`. |
| Russian | no per-language result in the model card (MTEB Multilingual v2 mean 61.36). |
| On-device exports | `onnx-community/embeddinggemma-2-ONNX`: text model int8 314 MB, q4 175 MB, fp16 542 MB (the vision/audio encoders are separate files). The graph has extra `image/video/audio_features` inputs, fed as empty `[0, 512]` tensors, and returns `sentence_embedding` directly. Not yet checked under the app's transformers.js 4.2 pipeline (model type `embedding_gemma2`); the probe below drives onnxruntime-node directly with the transformers.js tokenizer. |
| Python stack | needs `sentence-transformers>=6.1`, `transformers>=5.19`, Pillow and torchvision even for text. |

## Setup

- **Corpus:** the 774 released single-КР modules (`output/module-zstd-e5-2026-10-05`, tag
  `clinical-e5-2026.10.05`), 95 827 chunks. Passage text as in E1/E2 (title, section path, chunk,
  1 200 characters, 256 tokens); for EmbeddingGemma in its documented `title: … | text: …` form.
  Both models int8-quantised as in ADR 0008, exact cosine scan, grouped by document.
- **Queries:** Q1 (`tools/benchmarks/retrieval-icd-queries.json`), the 330 queries with at least one
  relevant КР in the corpus: 165 RuMedPrime complaints, 165 RuCCoD diagnosis phrases, dev + test.
  Relevance = ICD code of the recommendation (grade 3 same/parent/child, 1 same block).
- **Lexical:** the app's own `MedicalCore` search over the same modules
  (`export-retrieval-candidates.ts`). Hybrid = plain RRF, as in E1.
- Commands (`tools/benchmarks/embedding_eval.py`, scratch work directory):
  `corpus --packs <decoded modules>`, `embed --model <id>`, `evaluate-docs --model <id> --dims …`;
  latency and ONNX parity: `tools/benchmarks/src/query-encoder-latency.ts`.
- Host: Apple M2 Max. Corpus encoding on MPS: e5-small ≈ 4 min, EmbeddingGemma 2 38 min.

## Results (n = 330)

| Variant | R@1 | R@5 | strict R@5 | MRR@10 | R@5 complaints | R@5 diagnoses |
|---|---:|---:|---:|---:|---:|---:|
| Lexical (app) | 0.133 | 0.206 | 0.176 | 0.171 | 0.121 | 0.291 |
| **e5-small (shipped)** | **0.288** | 0.452 | 0.409 | 0.362 | 0.255 | 0.648 |
| e5-small, query through the app's ONNX int8 | 0.282 | 0.452 | — | — | 0.261 | 0.642 |
| EmbeddingGemma 2, 768 | 0.270 | **0.497** | **0.430** | **0.364** | **0.303** | **0.691** |
| EmbeddingGemma 2, 512 | 0.270 | 0.497 | 0.433 | 0.369 | 0.303 | 0.691 |
| EmbeddingGemma 2, 256 | 0.264 | 0.485 | 0.406 | 0.357 | 0.297 | 0.673 |
| EmbeddingGemma 2, 128 | 0.245 | 0.418 | 0.382 | 0.324 | 0.255 | 0.582 |
| EmbeddingGemma 2, ONNX int8 query | 0.270 | 0.497 | — | — | 0.303 | 0.691 |
| EmbeddingGemma 2, ONNX q4 query | 0.242 | 0.476 | — | — | 0.297 | 0.655 |
| EmbeddingGemma 2, hybrid RRF w=2, 768 | 0.191 | 0.409 | 0.352 | 0.286 | 0.279 | 0.539 |

Paired against e5-small (bootstrap, 10 000 resamples):

| Variant | ΔR@5 (95 % CI) | ΔR@1 (95 % CI) | queries better / worse at 5 |
|---|---|---|---|
| EmbeddingGemma 2, 768 | +0.045 (−0.003…+0.094) | −0.018 (−0.070…+0.033) | 41 / 26 |
| EmbeddingGemma 2, 256 | +0.030 (−0.015…+0.076) | −0.027 (−0.079…+0.021) | 37 / 27 |
| EmbeddingGemma 2, ONNX q4 | +0.024 (−0.024…+0.073) | −0.045 (−0.094…+0.003) | 36 / 28 |

By split, R@5 e5 → EmbeddingGemma 768: dev 0.419 → 0.479, test 0.485 → 0.515.

## Cost

| | e5-small (shipped) | EmbeddingGemma 2 int8 | EmbeddingGemma 2 q4 |
|---|---:|---:|---:|
| Query model download | 118 MB | 314 MB | 175 MB |
| Query, 1 CPU thread, p50 / p90 (idle M2 Max, onnxruntime-node) | 4.3 / 14.1 ms | 284 / 437 ms | 150 / 315 ms |
| Query vector vs PyTorch, cosine min | 0.993 | 0.998 | 0.911 |
| КР vectors, int8 | 36.8 MB (384 d) | 73.6 MB (768 d), 24.5 MB (256 d) | same |
| Rebuild | — | re-embed all 774 modules, new profile | same |

A phone is several times slower than this host, and the app's WebView runs onnxruntime-web (WASM),
slower than the native runtime: a query would take on the order of a second on the int8 model against
tens of milliseconds today.

## Reading

- The direction matches the model card: more found in the top 5, most on complaints (0.255 → 0.303),
  which stay the weakest kind of query; but not separable from noise at n = 330, and the first result,
  which the search screen shows first, is not better.
- 256 dimensions keep most of the gain at a third of the vector size; 128 loses it.
- int8 ONNX reproduces the reference exactly; q4 costs half the gain.
- Plain RRF hurts EmbeddingGemma as it hurt e5 (E1): semantic-first stays the only usable shape.
- Not enough to justify a 66× slower, 2.7× larger query model and a full re-embedding.

## Revisit when

- the owner query set or a physician-judged КР set (roadmap item 7) is large enough to separate a
  +0.05 R@5 gain; or
- a phone measurement through the app's WebView (WASM or WebGPU) puts the int8 query under ~300 ms
  (roadmap item 10's bound); or
- a smaller text-only EmbeddingGemma 2 export appears (the LiteRT `text-270m` build targets Android
  natively, which the frozen native port would need).
