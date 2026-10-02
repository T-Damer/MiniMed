# Embeddings on clinical-recommendation search — offline comparison (2026-10-02)

Research only (STATE E1). Nothing here ships in the app yet. Scripts:
`tools/benchmarks/src/export-retrieval-candidates.ts` (the app's own lexical candidates through
`MedicalCore` + `MultiMedicalStore`) and `tools/benchmarks/embedding_eval.py` (corpus, embeddings,
reciprocal-rank fusion, scoring with the rules of the former `hard-query-scoring.ts`).

## Setup

- **Corpus:** the 723 clinical-recommendation packs of `data/build/release-clinical` (before the
  2026-10-02 refresh), 174 198 chunks, ≈101 MB text. Passage = title + section path + chunk text,
  first 1 200 characters, at most 256 tokens.
- **Queries:** 929 rows of the synthetic pediatric hard set (dev 699 + validation 230; hidden_test
  unused) decoded from the corrupt fixture before P1 removed it, plus the 17 curated clinician
  queries. Weak labels: a top-5 document counts when its title/section/chunk text contains a
  required entity. Synthetic and pediatric only — not a physician-authored benchmark.
- **Lexical:** the app's real search over the same packs, top 50 document groups per query.
- **Semantic:** cosine over all chunk vectors (float, int8, or 1-bit prefilter → int8 rescoring
  of 2 000 candidates), grouped by document. **Hybrid:** RRF (k = 60), semantic weight 0.5–1.5.
- Host: Apple Silicon, MPS for corpus encoding; query latency measured on CPU with one thread.

## Results (hard set, n = 929)

| Variant | R@1 | R@5 | MRR@5 | forbidden@5 | curated R@5 |
|---|---:|---:|---:|---:|---:|
| Lexical (app) | 0.235 | 0.302 | 0.260 | 0.006 | 0.118 |
| rubert-tiny2, semantic | 0.046 | 0.096 | 0.064 | 0.005 | 0.059 |
| rubert-tiny2, hybrid w=0.5 | 0.125 | 0.268 | 0.172 | 0.006 | 0.118 |
| USER-base, semantic | 0.320 | 0.433 | 0.361 | 0.003 | 0.353 |
| USER-base, hybrid w=1.5 | 0.272 | 0.399 | 0.313 | 0.001 | 0.353 |
| **e5-small, semantic** | **0.390** | **0.505** | **0.434** | 0.006 | **0.412** |
| e5-small, hybrid w=1.5 | 0.294 | 0.425 | 0.338 | 0.002 | 0.353 |
| e5-small, hybrid int8 w=1.0 | 0.292 | 0.409 | 0.331 | 0.003 | 0.353 |
| e5-small, hybrid binary→int8 w=1.0 | 0.265 | 0.355 | 0.297 | 0.004 | 0.294 |

R@5 by query style (lexical → e5-small semantic): professional 0.32 → 0.55, colloquial
0.32 → 0.52, keywords 0.31 → 0.60, noisy 0.39 → 0.61, case narrative 0.17 → 0.24.

| Model | Dims | Query CPU 1 thread p50 | int8 vectors | 1-bit vectors |
|---|---:|---:|---:|---:|
| cointegrated/rubert-tiny2 | 312 | 1.6 ms | 54 MB | 7 MB |
| intfloat/multilingual-e5-small | 384 | 8.4 ms | 67 MB | 8 MB |
| deepvk/USER-base | 768 | 24.3 ms | 134 MB | 17 MB |

## Reading

- On clinical recommendations, meaning-based retrieval clearly beats the current lexical search on
  these queries: e5-small alone finds the needed document in the top 5 for 50.5% vs 30.2%, on every
  query style. rubert-tiny2 is not usable here.
- Plain RRF fusion is **worse than semantic alone**: the lexical list is weak on this corpus and
  drags the fused ranking down. Fusion needs a different design (semantic-first with lexical as a
  boost for exact codes/terms, or score-normalised fusion tuned on held-out data).
- int8 storage costs nothing measurable; the 1-bit prefilter with a 2 000 shortlist loses ~5 points
  of R@5 — keep int8 for КР-sized corpora or widen the shortlist.
- Caveats: synthetic pediatric queries, entity-substring labels, КР packs only (no core, drugs or
  МКБ), host latency (a phone will be several times slower). Before product work this needs the
  200–300 physician-written queries with real relevance judgements.

## Proposed next steps

1. Physician query set (the owner's real phrasing) with document-level judgements over the full
   databases.
2. e5-small (MIT) as an optional download: ONNX int8 query encoder in a Web Worker via the
   `@huggingface/transformers` dependency the app already has; per-chunk int8 vectors shipped as
   a separate file next to each КР module (≈90 B/chunk + id), only for КР first.
3. Fusion redesign measured on that set; lexical stays the complete offline fallback (ADR 0008).
