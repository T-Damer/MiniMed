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

## Implemented benchmark v2

The stacked research branch now has two separate executable gates.

### Corpus-derived exact lookup

`tools/benchmarks/src/run-lookup-quality.ts` derives its cases from the corpus being evaluated rather
than from a hand-picked list. It loads the same `MedicalCore` over `core.db` plus any repeatable
`--pack` arguments and enumerates:

- every active document title;
- editorial identity/navigation aliases from `metadata.navigationAliases`;
- broader search-expansion aliases from `metadata.declaredAliases`.

Identical normalized surfaces are grouped instead of assigning an arbitrary single gold document.
Titles and editorial navigation aliases form the strict identity Top-1 contract; an exact title wins
when the same surface is only an alias elsewhere. `declaredAliases` are deliberately **not** forced
to Top-1: MiniMed uses them as search expansions and they may be broad. They still participate in
exact-surface Recall@20 diagnostics. This avoids turning the benchmark into a new source of false
identity assumptions while directly measuring the reported UX failure where a named document is
buried by a body-text match.

The first strict gate deliberately excludes `short_title`. Unlike `title`, it is not currently a
uniform FTS/search surface in every adapter. Adding it to a failing ranking gate would conflate an
indexing/content-contract gap with ranking quality; it should become a separate gate after the runtime
contract is made uniform.

Default command:

```bash
bun run benchmark:lookup-quality
```

Run every eligible surface and include installed modules:

```bash
bun run --filter @localmed/benchmarks benchmark:lookup-quality -- \
  --max=0 \
  --core=/path/to/core.db \
  --pack=/path/to/module-a.db \
  --pack=/path/to/module-b.db
```

The report separates:

- strict exact Top-1;
- exact-surface Recall@20;
- body-only Top-1 intrusions;
- weaker alias hits that beat an exact title;
- engine p50/p95.

This gate is intentionally deterministic and model-independent.

### Diagnosis-free graded clinical challenge

`tools/benchmarks/search-quality-v2.json` is no longer a small one-label smoke list. It contains
natural Russian clinical formulations across respiratory, meningococcal, measles, gastroenteritis,
urinary and deliberately ambiguous scenarios. Direct answer names are absent by contract.

Every row declares `leakageTerms`. The fixture loader fails if an answer term is reintroduced into the
query, preventing the benchmark from silently drifting back toward target-name lookup.

Relevant documents have grades 1–3 rather than a forced single label. Ambiguous cases must contain at
least two relevant sources. The runner reports:

- maximum-grade Top-1;
- Hit@5;
- relevant and weighted Recall@20/@40;
- NDCG@5/@10;
- MRR@20;
- expected-section Hit@5;
- forbidden-result rate;
- p50/p95;
- corpus coverage separately from ranking quality.

The same fixture is run under lexical and hybrid profiles and publishes the delta between them:

```bash
bun run benchmark:clinical-quality
```

If a relevant document is not installed, that fact is recorded as a corpus-coverage gap. It is not
silently counted as a ranking failure.

### Exact-title runtime invariant

The experiment also fixed one concrete ranking weakness exposed by the new methodology. An exact
document title is now a hard ordering key before exact aliases, exact source phrases, symptom
coverage and numeric relevance score. It can no longer lose to a high-scoring document that merely
contains the same words in body text. A dedicated regression covers the same failure shape, including
a `Ясперс` title-versus-alias collision.

This does not make semantic ranking unnecessary. It keeps a problem with a deterministic answer out
of the model's responsibility.

### Natural-distribution queries

MiniMed already imports a deterministic sample of 120 questions from Real-POCQi, a dataset of
deidentified point-of-care questions submitted by practicing US physicians. These are valuable for
checking whether our hand-authored challenge set has realistic query length, intent mixture and
workflow shape.

They are **not** Russian MiniMed relevance gold:

- wording is English;
- jurisdiction is US;
- the imported questions intentionally have no MiniMed document labels;
- source model answers are not treated as ground truth.

Do not automatically translate and label them to inflate benchmark size. A Russian version becomes a
retrieval test only after source-backed relevance annotation and review; translation/reconstruction
must retain separate provenance.

### Qualification boundary

The checked-in challenge set remains visible to implementation agents. It is a regression/challenge
suite, not evidence of generalization. A production decision about a Laya/Jev-like reranker still
requires 200–300 private clinician-authored Russian queries that are held outside the tuning context,
with multi-relevance judgments and corpus-coverage annotation.

The order of work is therefore:

1. make exact lookup deterministic and keep its corpus-derived gate green;
2. raise oracle candidate Recall@20/@40 on the clinical challenge and private set;
3. freeze candidate sets and compare deterministic ranking, embeddings, a trivial discriminative
   baseline and the proposed local decision model;
4. only then measure mobile/web model cost and consider production integration.
