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

## Validation boundary

Before publication, an isolated local Node/TypeScript harness executed the actual extracted production
hydration/retention functions: 14 assertions passed and both old failure shapes were reproduced.
Three changed TypeScript files passed syntax transpilation. The reconstructed original files were
checked against their Git blob SHA before patching. Node was used only because the local environment
has no repository-pinned Bun and cannot resolve GitHub/npm; this is not a full dependency/type/build
or MedicalCore integration qualification.

The repository-pinned Actions regression run and corpus measurements must be read from the commit's
checks before marking this work validated. Existing research notes and CURRENT_STATE benchmark
figures describe earlier revisions; they must not be used as measurements of this change. In
particular, an exhaustive identity-index audit is not the same as exhaustive end-to-end lookup.

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
