# Pilot research tools retired — 2026-09-27

User decision: the pilot corpus (`rf-public-pilot.db`, 15 documents) is not needed, and reranker work is
frozen. The tools below ran only against the pilot corpus and were removed. They remain in git history;
the last commit that contains all of them is `15e79dda`.

- `tools/benchmarks/src`: `run-hard-queries.ts`, `verify-alias-batch.ts`, `export-giga-base-candidates.ts`,
  `run-search-quality-v2.ts`, `search-quality-dataset.ts` (+ test), `export-search-quality-frozen-candidates.ts`,
  `legacy-training-mask.ts` (+ test), `linear-reranker-baseline.ts` (+ test),
  `frozen-embedding-baseline.ts` (+ test), `run-linear-reranker-baseline.ts`,
  `run-frozen-embedding-baseline.ts`, `summarize-reranker-ablation.ts`;
- `tools/benchmarks/giga_embeddings_poc.py`, `tools/benchmarks/cross_encoder_frozen_poc.py`;
- workflows `search-quality-v2-benchmark.yml`, `search-reranker-cross-encoder-poc.yml` and the
  `search-quality-v2` job in `ci.yml`;
- `packages/test-fixtures/data/rf-public-pilot.db`;
- scripts `giga:*`, `benchmark:hard`, `benchmark:clinical-quality`, `benchmark:freeze-*`,
  `benchmark:linear-reranker`, `benchmark:embedding-baseline`, `benchmark:reranker-summary`,
  `benchmark:reranker-ablation`; `benchmark:search-quality-v2` is now an alias of `benchmark:lookup-quality`.

Kept: `hard-query-dataset.ts`, `hard-query-scoring.ts` (used by `run-curated-clinician`),
`search-quality-v2.json` (queries for `run-search-latency`), the local reranker contract, and the pilot
content build (`content:*pilot*`, `run-pilot.ts`) until the core build no longer needs it.

Update 2026-10-02: the pilot content build, `run-pilot.ts` and the pilot query sets were retired too; see
[pilot-corpus-retired-2026-10-02.md](pilot-corpus-retired-2026-10-02.md).
