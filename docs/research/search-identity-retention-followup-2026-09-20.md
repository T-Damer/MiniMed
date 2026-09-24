# Search identity retention follow-up — 2026-09-20

This follow-up remains in stacked draft PR #180, based on #174. Starting revision:
`83d2f171cf5be690f5cf8fa61ba7573e084a9854`.

## Runtime repairs

Two gaps remained after the initial exact-identity path described in the search benchmark handoff:

1. Direct identity hydration selected the first eligible section and returned nothing if that section
   had no chunks. Outline/parent sections can be empty even though a later section contains source text.
   Hydration now scans eligible sections in store order, skips whitespace-only chunks, and stops at the
   first readable chunk. It checks document/specialty/age filters before reading sections and never
   falls back outside section filters. An empty document still produces no fabricated result.
2. The missing-identity check ran before semantic fusion. An exact short-title candidate could be
   present in lexical results and subsequently disappear in semantic-only retrieval or the hybrid
   cutoff, so neither the original injection nor final identity ordering could restore it.
   The final candidate pool now first retains exact lexical hits, preserving their source anchor,
   and only then hydrates genuinely missing identities. A vector-provided identity is not read twice.

The existing superseded-source filter, document grouping, exact title > short/navigation identity
ordering, and discovery-only status of broad declared aliases remain unchanged. No source text,
clinical gold labels, model weights, clinical relevance heuristics, or database schema changed.

## Test-discovery repair

The root `vitest.config.ts` included packages and application tests but not
`tools/benchmarks/src/**/*.test.ts`. Listing those files on the Vitest command line did not override
that include filter. The root config now includes the benchmark tests so leakage, graded metrics,
frozen-pool integrity and reranker tests are actually discovered by existing commands.

`query-document-index.test.ts` now exercises the public MedicalCore path in addition to the index:
empty outlines, all three strict identity surfaces, source-context resolution, section filtering,
document/specialty/age filtering, whitespace-only chunks, empty documents, propagated storage errors,
post-semantic/post-hybrid retention, vector-only identities and broad discovery aliases.

## Local validation boundary

Before publication, an isolated local Node/TypeScript harness executed the actual extracted production
hydration/retention functions: 14 assertions passed and both old failure shapes were reproduced.
Three changed TypeScript files passed syntax transpilation. The reconstructed original files were
checked against their Git blob SHA before patching. Node was used only because the local environment
has no repository-pinned Bun and cannot resolve GitHub/npm; this isolated check was not full
 dependency/type/build or MedicalCore integration qualification.

## Repository-pinned verification

Code revision: `8818287eb77193edd3b2003ea4852007fe9da403`.
The following figures are taken specifically from CI run
[35520814275, search-quality-v2 job 106104452986](https://github.com/T-Damer/MiniMed/actions/runs/35520814275/job/106104452986).
The job checked the PR merge tree `ce27daaa2bb4f508c06ef74db9e1893a161905c1`, including base revision
`6a256067de960321605736f00f3cbc0991f42a61`.

### Regression tests

Eight selected test files, **159 tests passed**. This includes all 16 identity-index/retention tests
and all 10 legacy-training-mask tests. The mask test suite passed; no additional functional masking
fix was needed in this follow-up. Benchmark tests were included by the corrected root configuration.

### Corpus-derived lookup

The corpus exposes **39,270 eligible surfaces**. This run evaluated **500 end-to-end searches**:
359 strict-identity cases and 141 discovery-only alias cases.

| Measure | Result |
| --- | ---: |
| Strict identity Top-1 | 100% |
| Strict identity Recall@20 | 100% |
| Strict body-only Top-1 intrusion | 0% |
| Weaker exact surface beating a full title | 0% |
| Discovery-only alias Recall@20 | 77.30% |
| Overall surface Recall@20 | 93.60% |

The separate exhaustive identity-index audit covered **28,929 strict surfaces** and **29,121 document
identity associations**, with complete identity recall and set/tier agreement. This is an **index
audit**, not an exhaustive end-to-end search measurement. Full lookup with `--max=0` remains unrun in
this follow-up. Broad alias misses remain visible in the report rather than being relabeled as strict
identity successes.

### Frozen clinical reranker comparison

The job froze 495 candidate pairs for 33 public challenge queries, using a Top-40 cap. A cap of 40 does
not imply that each query had 40 candidates. The training export contains 630 pairs for 42 legacy
queries. All systems below used the same frozen test file within this job.

| Ranking | Maximum-grade Top-1 |
| --- | ---: |
| Existing deterministic/hybrid ordering | 27/33 = 81.82% |
| Pairwise linear baseline | 23/33 = 69.70% |
| Linear baseline with its margin gate | 27/33 = 81.82% |
| Portable hash-embedding-only ordering | 11/33 = 33.33% |

Relevant candidate Recall@20/@40 was 100% on this small set. The gated linear baseline retained the
baseline result; it did not establish an improvement. These numbers do not validate a general clinical
model or justify shipping the experimental rerankers. The identity-retention repair is not credited
with the clinical Top-1 difference relative to older revisions: earlier ranking changes and the full
checked-out revision must be controlled in any causal comparison.

### Remaining checks

The separate search job passed, but **the overall CI is not green**: the JavaScript job stopped at
Biome formatting/import-order checks, including diagnostics in touched search files as well as
existing unrelated files. Subsequent whole-repository typecheck, unit and build stages in that job
were skipped. This follow-up is therefore not a merge-readiness or release qualification. No APK was
built or published, and no model was integrated into the application.

Earlier CURRENT_STATE and PR-description metrics describe earlier revisions and must not be used as
measurements of this change. Reports from distinct jobs/revisions should not be combined as one
measurement.

Reproduce in a normal checkout:

```bash
bunx vitest run packages/core/src/query-document-index.test.ts \
  packages/core/src/query-group-ranking.test.ts packages/core/tests/core.test.ts \
  tools/benchmarks/src
bun run benchmark:lookup-quality
bun run benchmark:clinical-quality
```

Neural rerankers remain research-only. Better execution coverage does not establish better clinical
ranking, and neither passing tests nor relevance scores establish clinical diagnosis probabilities.
