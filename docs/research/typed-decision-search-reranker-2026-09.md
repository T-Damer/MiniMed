# Typed decision reranker study for MiniMed search

**Date:** 2026-09-20  
**Status:** research only; stacked on PR #174  
**Scope:** free-form Russian medical search -> bounded concept/document reranking. This does not change
the production search path, diagnostic behavior, source authority, or safety parsing.

## Question

Would a small local, non-generative JEV/Laya-like decision model improve MiniMed search enough to
justify Android/iOS/Web integration?

The hypothesis is narrower than "replace search with AI":

```text
original query
  -> deterministic parsing / polarity safeguards
  -> FTS5 + aliases + optional semantic retrieval
  -> high-recall top-K concepts/documents
  -> small typed decision scorer
  -> deterministic fusion
  -> the same source-linked MiniMed result
```

The model is allowed to reorder a bounded candidate set. It is not allowed to invent concepts,
rewrite the query, infer doses, erase negation, create clinical facts, or replace source navigation.

## Why test reranking instead of another first-pass retriever

MiniMed already has a strong generated-query baseline. The measured 500-query experiment recorded in
`docs/RAG_SEARCH_RESEARCH.md` reports:

| path | Recall@4 | Recall@1 | MRR@20 |
| --- | ---: | ---: | ---: |
| lexical | 0.998 | 0.924 | 0.9560 |
| E5 hybrid | 1.000 | 0.940 | 0.9675 |

That result leaves little room for a new model on clean/canonical queries. The plausible remaining
failure mode is different: a correct concept is already somewhere in a high-recall candidate set, but
messy clinical phrasing causes the wrong candidate to win.

PR #174 makes this experiment practical because search results can now preserve stable `conceptId`
identity and because compact discovery cards expose reviewed names, aliases, source links, and short
reviewed definitions.

## Preliminary proxy experiment

A small external probe was run against MiniMed's committed public-pilot material before proposing any
runtime integration. It is deliberately weaker than the production MiniMed engine and should not be
reported as a product benchmark.

### Data

Training:

- 42 existing `pilot-rf-queries.json` recommendation queries;
- seven public-pilot classes: pneumonia, UTI, bronchitis, bronchiolitis, measles, rotavirus, and
  meningococcal disease;
- canonical class/disease words were removed from each training query before feature extraction, so
  the classifier could not win merely by learning the label written in the query.

Held-out test:

- all 14 existing symptom-only cases from `src/verify-alias-batch.ts`;
- no test query was used for fitting;
- expected documents are the repository's retrieval regression labels, **not diagnostic ground
  truth**. Several cases are clinically non-exclusive or ambiguous, so the experiment tests retrieval
  separability only.

Proxy baseline:

- simplified BM25 over the seven committed Markdown recommendation summaries.

Proxy decision layer:

- 4,096 signed hashed dimensions;
- character 3-5 grams plus word unigram/bigram features;
- seven-way linear softmax classifier;
- no LLM, embeddings service, external API, or model weights.

### Result

| metric | result |
| --- | ---: |
| simplified BM25 Top-1 | 6/14 = **42.9%** |
| simplified BM25 candidate Recall@3 | 9/14 = **64.3%** |
| decision classifier Top-1 over all seven labels | 8/14 = **57.1%** |
| BM25 Top-3 -> decision rerank Top-1 | 8/14 = **57.1%** |

The classifier repaired some lexical ordering errors, including the chest-pain pneumonia and daytime
wetting UTI cases. It also failed on several ambiguous/weakly represented symptom descriptions.

More importantly, five Top-3 candidate sets omitted the expected label. A reranker cannot recover a
candidate that first-pass retrieval never supplied. This is direct support for the architectural
constraint:

> **Use the decision model after high-recall retrieval, never instead of it.**

The absolute percentages above are not evidence that this toy classifier should ship. Its purpose was
to test whether a bounded discriminative layer can learn useful ordering signal from MiniMed-style
queries after explicit diagnosis words are removed. It can. The production question remains whether
that signal adds anything on top of the actual MiniMed hybrid engine.

## Production-grade experiment

### 1. Freeze retrieval before training

For each evaluation query, export the current MiniMed result list before the decision model sees it.
Use the same source database, search mode, filters, parsing result, and candidate limit for every
compared scorer.

Record at least Top-1/5/20/40 document IDs and `conceptId`, lexical/vector scores or ranks, section
type, source metadata, and deterministic parser facts. Do not log private patient text in a release
build; this export is benchmark tooling only.

Run three candidate generators separately:

1. lexical/aliases;
2. current hybrid;
3. concept-first discovery projection from PR #174 plus the normal source results.

If expected candidate Recall@20/40 is poor, stop the reranker experiment and fix retrieval/aliases
first.

### 2. Evaluate on query sets that can expose a reranking gain

Use different sets for development and final comparison:

- `doctor-workflow-queries.json` for messy workflow phrasing;
- `verify-alias-batch.ts` for symptom-only regression cases;
- `curated-clinician-queries.json` for human-written validation;
- `hard-medical-queries-1500` for style/intent/specialty slices and forbidden-result regressions;
- an eventual private 200-300 query clinician-authored test set that was never visible during model,
  prompt, threshold, or fusion tuning.

The generated 500-query RAG suite remains a regression set, but it must not dominate model selection
because current retrieval is already near-saturated there.

### 3. Train relevance decisions, not one diagnosis softmax

The intended local model should score each bounded candidate independently:

```text
query
+ candidate canonical name
+ reviewed aliases
+ short source-backed definition / card summary
+ small typed metadata
    -> relevant / not relevant logit
```

This permits several candidates to be relevant simultaneously and avoids the large-choice degradation
seen in choice-style decision systems. Training rows should be query-candidate pairs:

- positives from expected document/concept identities;
- hard negatives from the current MiniMed Top-K, especially high-ranked false positives;
- multi-positive rows where several concepts/sources are acceptable;
- no synthetic negative created by changing a dose, polarity, age, or other safety-critical fact unless
  that transformation has an explicit reviewed label.

Prefer a small bidirectional encoder with a binary/score head. The Laya/JEV idea is useful as an
architecture pattern, but MiniMed does not need Laya's exact weights or runtime.

### 4. Keep deterministic fusion and fallback

Compare at least:

- baseline MiniMed order;
- model-only ordering inside the frozen Top-K;
- bounded model + baseline fusion.

Exact identifiers, reviewed aliases, source identity, and hard applicability exclusions remain
deterministic. Low-confidence, missing-model, timeout, OOM, or incompatible-model states must return
the unchanged MiniMed baseline.

The decision score is search relevance/compatibility. It must not be displayed as a probability of a
patient having a disease.

### 5. Metrics

Report both retrieval ceiling and reranking quality:

- candidate Recall@5/20/40 before reranking;
- Top-1 and Recall@5 after reranking;
- MRR@5 and, where useful, nDCG@5;
- section hit/recall and exact source/context preservation;
- forbidden/dangerous result rate from existing hard/clinician fixtures;
- no-answer behavior;
- calibration (Brier score and ECE) only if probabilities are exposed internally;
- cold load, warm p50/p95 inference latency, incremental peak RAM, model bytes, and battery/thermal
  impact on representative Android/iOS devices and Web/WASM/WebGPU paths.

### 6. Go / no-go gates

Do not integrate a decision model into product search unless all of these are true on a held-out
clinician-oriented set:

1. the frozen MiniMed candidate generator reaches **>= 0.98 Recall@20** (or the failure is fixed before
   reranker work continues);
2. the decision layer improves either Top-1 by at least **5 absolute percentage points** or MRR@5 by
   at least **0.03**, with a paired bootstrap confidence interval excluding zero;
3. exact/navigational query quality does not regress materially;
4. forbidden/dangerous result rate does not increase;
5. section/source/context identity remains exact;
6. missing/failed model behavior is byte-for-byte equivalent in ordering to the normal fallback path;
7. device measurements justify the model size and latency instead of merely showing that inference can
   run.

The numerical gain thresholds are research gates, not clinical-validation claims.

## Recommended implementation order

1. Add a benchmark-only exporter for frozen Top-K MiniMed candidates.
2. Train/evaluate a very small pairwise relevance classifier outside the app.
3. Compare it against current MiniMed and a conventional small cross-encoder using the exact same
   candidate snapshots.
4. Only if the go/no-go gates pass, export the winning scorer to a portable local format (preferably
   ONNX first) and add a replaceable `SearchDecisionScorer` port behind unchanged fallback.
5. Quantize and test Android/iOS/Web only after retrieval value is proven.

## Decision from the preliminary test

**Proceed with the benchmark/training spike; do not integrate a JEV/Laya-like model into production
search yet.**

The proxy supports the existence of useful discriminative ordering signal, but it also demonstrates
that reranking is bounded by candidate recall. MiniMed's current clean-query retrieval is already too
strong to justify a model by itself. The model earns a place only if the production candidate
snapshots show a reproducible gain on messy, paraphrased, clinician-style queries while preserving all
existing source and safety contracts.
