# System-One / decision-layer search benchmark

**Date:** 2026-09-20  
**Status:** research-only, stacked on PR #174 (`agent/concept-first-knowledge-search`)  
**Scope:** search quality and the case for a local discriminative decision layer. This does not add a
model to production search.

## Why this benchmark exists

The current MiniMed retrieval numbers are useful regression checks, but they are too optimistic to
answer the product question: “does search feel reliably useful when a doctor types an exact term or a
free-form clinical problem?”

Three issues matter:

1. **Target-name leakage.** In the current 42-case public clinical pilot, 28/42 queries (66.7%) contain
   the target disease name or a close target marker such as `пневмония`, `бронхит`, `корь`,
   `ИМП`/urinary infection, etc. Those cases are valid navigation regressions, but they do not test
   diagnosis-free paraphrase retrieval.
2. **Single-gold ambiguity.** `verify-alias-batch.ts` forces one expected document for symptom-only
   narratives. Several such inputs are naturally compatible with more than one source in the corpus.
   A single mandatory label can reward overfitting instead of useful retrieval.
3. **Benchmark/runtime mismatch.** The product documentation now separates ordinary lookup from
   explicit clinical analysis. Ordinary lookup is intentionally lexical-first, while older benchmark
   results often exercise hybrid/clinical-style retrieval. A green hybrid metric therefore does not
   prove that the search surface the user actually used ranks an exact term correctly.

The user's observed failure mode — typing a term and seeing a different document above the document
that directly represents that term — must be measured separately from free-form clinical retrieval.

## Controlled proxy experiment

A small in-memory experiment was run against the seven public pilot disease documents. It is not the
MiniMed runtime and it is not evidence for Laya/Jev specifically.

Method:

- source documents: the seven public pilot disease summaries;
- training set: the 42 existing pilot clinical queries;
- direct disease-name strings were masked from training text;
- evaluation set: the 14 independent symptom-only cases already present in
  `verify-alias-batch.ts`;
- baseline candidate generator: simple BM25 over the seven documents;
- decision proxy: a tiny hashed character/word n-gram linear softmax classifier;
- bounded rerank: the same classifier was allowed to reorder only the BM25 top 3.

Observed:

| Measure | Result |
| --- | ---: |
| BM25 Top-1 | 5/14 = 35.7% |
| BM25 candidate recall@3 | 9/14 = 64.3% |
| Decision proxy Top-1 | 8/14 = 57.1% |
| BM25 top-3 → decision rerank Top-1 | 8/14 = 57.1% |

Interpretation:

- a discriminative layer can plausibly improve ranking on symptom-only language;
- the candidate generator is a hard ceiling: in 5/14 cases the expected label was outside top 3, so
  no reranker limited to those candidates could recover it;
- the experiment also exposed benchmark-label problems, so the 57.1% number is only directional;
- this is enough to justify a **real controlled reranking experiment**, not enough to ship a model.

## Product split: lookup and clinical search are different problems

### A. Ordinary lookup

Examples:

- `бронхиолит`
- `пятна Бельского-Филатова-Коплика`
- `MMSE`
- `Ясперс`

For reviewed canonical concepts and aliases, this path should not need a neural decision model.

Required ordering:

```text
exact canonical concept / reviewed alias
  > exact document title / short title
  > exact source-term occurrence
  > partial lexical matches
  > semantic-only similarity
```

An unrelated document that merely mentions the term repeatedly must not outrank the exact concept card
or exact-title source. A decision model must never be required to restore this invariant.

PR #174 makes this testable because search results can preserve `conceptId`.

### B. Free-form clinical search

Example:

```text
грудничок после насморка свистит, хуже ест и втягивает межреберья
```

This should use a **high-recall candidate stage** and may benefit from a local discriminative
decision layer:

```text
query
  → deterministic facts / negation / hard safety context
  → lexical + aliases + optional embedding / concept retrieval
  → broad candidate pool (for example 20–40)
  → local decision model scores each candidate
  → ranked source/concept groups
```

The model is a reranker/selector, not a source of truth and not an autonomous diagnosis engine.

## Benchmark v2 methodology

### Track 1 — exact concept lookup

Generate cases from every source-backed reviewed knowledge entity:

- canonical name;
- each reviewed alias;
- common normalized spelling variants already accepted by MiniMed.

Metrics:

- exact canonical Top-1;
- exact alias Top-1;
- exact concept `conceptId` preservation;
- pairwise exact-vs-body-mention ordering;
- zero-result rate.

This is a strict regression suite. It should be independent of any model.

### Track 2 — source term lookup

Use terms that occur in source text but are not necessarily document titles. The gold annotation is a
set of source documents/chunks containing the requested concept, not a guessed diagnosis.

Measure:

- source-document recall@5;
- source-section recall@5;
- MRR;
- exact-anchor/context correctness.

### Track 3 — free-form clinical retrieval

Build clinician-authored cases that deliberately avoid the answer term. Each case must allow
**multiple relevant concepts/documents** when appropriate.

For every query record:

- positive clinical facts;
- explicit negative facts;
- age/population;
- intent;
- relevant concept/document set;
- forbidden or misleading results;
- whether a single preferred source actually exists.

Primary metrics:

- candidate oracle recall@20 and @40;
- MRR/NDCG over graded relevance;
- forbidden-result rate;
- section hit rate;
- no-answer/abstention behavior.

Do not optimize a model until candidate oracle recall is high enough; otherwise model work is hiding a
retrieval problem.

### Track 4 — reranking ablation

Freeze the same candidate set for every system and compare:

1. deterministic rank only;
2. trivial linear classifier baseline;
3. embedding similarity only;
4. small local cross-encoder / Laya-like typed decision model;
5. any later MiniMed-specific trained decision encoder.

A candidate model is useful only if it improves held-out free-form ranking without changing exact
lookup invariants or increasing forbidden-result rate.

### Track 5 — adversarial and ambiguity cases

Include:

- negated symptoms;
- “treatment already failed” wording;
- child vs adult source collisions;
- overlapping respiratory syndromes;
- medication name appearing in the history but not being the requested answer;
- incomplete/no-answer cases;
- typos, abbreviations and colloquial Russian;
- multiple simultaneously relevant concepts.

These cases must not use a forced single gold label unless the source contract really establishes one.

### Track 6 — device cost

Only after retrieval quality is demonstrated:

- model bytes after quantization;
- cold load;
- p50/p95 inference;
- peak RSS;
- Android/iOS thermal and battery behavior;
- WebGPU/WASM fallback;
- deterministic fallback when the model is absent or fails.

## Decision rule

The current evidence supports **continuing the experiment**, with two constraints:

1. fix exact lookup deterministically first;
2. evaluate a decision model only on free-form clinical retrieval with a broad candidate pool and
   multi-relevance ground truth.

Do **not** integrate Laya/Jev-like inference into the production search path merely because it improves
the existing single-label benchmark. A production spike becomes justified when a held-out
clinician-authored set shows:

- near-complete relevant candidate coverage before reranking;
- a material Top-1/MRR/NDCG gain from the decision layer;
- no exact lookup regression;
- no increase in forbidden-result rate;
- acceptable device cost.

## Checked-in smoke suite

`tools/benchmarks/search-quality-v2.json` and
`tools/benchmarks/src/run-search-quality-v2.ts` provide a small visible smoke suite. It intentionally
separates strict lookup cases from multi-relevance clinical cases. Because it is checked into the
repository, it is **not** a blind qualification set and must not be used as evidence that a trained
model generalizes.

The next meaningful dataset is 200–300 private clinician-authored queries kept outside the repository
and outside the context used to tune ranking.
