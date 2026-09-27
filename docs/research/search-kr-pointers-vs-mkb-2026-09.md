# Clinical-recommendation pointers lose to short ICD entries (2026-09-27)

Observation only; no ranking change made. Measured on the released `core.db` with the five
companion packs mounted as the app does (`benchmark:doctor-lookup`, lexical lookup,
`ScopedMedicalCore('all')`).

## Symptom

- «вирусный менингит» and «менингит у ребенка»: the clinical recommendation
  «Вирусные менингиты у детей» (`kr.rf.995_1`, catalog pointer
  `core.catalog.pointer.clinical.kr.rf.995_1-…`) is not in the top 20. The top is filled by ICD-10
  entries (A87, A87.8, A87.9, G00.x, G02.0) and a reference card «Вирусный менингит».
- The pointer is indexed and matches: `chunks_fts` returns it for «менингит*» and «менингиты»; its
  single summary chunk contains «вирусные менингиты детей … мкб 10 a87 b00 … g02 g03 …».

## Why

1. **Length normalization.** A pointer has one long summary chunk (title, declared aliases,
   keywords, ICD codes, specialties, age groups). FTS5 bm25 favors short documents, so a one-line
   ICD entry that repeats the query word scores higher than the pointer that matches the same
   words once in a long field list.
2. **Duplicated ICD entries.** Every ICD node exists twice: as a core catalog pointer
   (`core.catalog.pointer.reference.rls.mkb.node.*`) and as the full `mkb.db` record
   (`rls.mkb.node.*`). Both survive grouping (different document ids), so each ICD code takes two
   of the top slots.
3. **Per-pack rank fusion.** `MultiMedicalStore.search` fuses packs by reciprocal rank with
   pack weights (core 1.1, regulatory 1.12, medications 1.15, reference 1.08, mkb and ambulatory
   1.05). The best hit of each pack lands near the top regardless of how many query terms it
   covers.

## Options (for the core rebuild, with benchmarks before and after)

- Index the pointer title and the core identity fields (title, ICD codes) as a separate short
  chunk, keeping the long field list as a second chunk, so bm25 compares like with like.
- Collapse an ICD pointer and its `mkb.db` record into one group by `targetDocumentId`, as
  `run-runtime-retrieval.ts` already does for scoring.
- Review pack weights: regulatory at 1.12 outranks the core at 1.1.

Gate any change on `benchmark:doctor-lookup` (real corpus), `benchmark:lookup-quality`
(Top-1 must stay 1.0) and `benchmark:runtime`.

## Candidate window and targeted backfill (2026-09-28) — neither reaches the bar; no regression left active

Continuation after `fix(search): the diluted alias branch does not corroborate another branch`
(`7773051a`) closed most of the gap: released `benchmark:doctor-lookup` R@5/MRR@5/forbidden-free
0.70/0.60/1.0 (target met), candidate (`data/build/core.0.7.0-test7.no-pilot.db`) 0.60/0.45/0.9 (short
of the 0.70/0.60 bar). The one remaining query, «ангина или фарингит у ребенка» (expects
`kr.rf.306_3`), was root-caused to a retrieval-window exclusion, not a scoring-order issue: with
`--limit=100` (which also raised the window under the pre-existing `limit*5` formula) the document
appeared at position 6 with a competitive score; at the production `limit=20` (window floored at 100)
it was outside the window's own top-100 raw hits entirely, before `fuseBranchHits` or
`query-group-ranking.ts` ever see it.

Two candidate fixes were implemented and measured as experiments, then **not merged**, because
neither meets the bar without a new regression (the constant names below refer to that experiment):

### 1) `LOOKUP_PER_BRANCH_LIMIT` sweep (window size for a lookup query's own per-branch retrieval)

Measured on `apps/app/public/content/core.db` (released) with `run-search-latency.ts` (now sends
`analysisMode: 'lookup'` — the ordinary search box's real path, not the clinical-parsing path it
exercised before) and `run-doctor-lookup.ts`/`run-lookup-quality.ts` on both cores:

| window | released totalMs p50 / p95 | released R@5 / MRR@5 / forbidden-free | candidate R@5 / MRR@5 / forbidden-free | candidate discoveryAliasRecall@20 |
| ---: | --- | --- | --- | --- |
| 100 (current) | 123.4 / 208.7 | 0.70 / 0.60 / 1.0 | 0.60 / 0.45 / 0.9 | 0.943 |
| 200 | 209.2 / 364.6 (+70% / +75%) | 0.70 / **0.525** / 1.0 | 0.70 / 0.475 / **0.8** | 0.929 |
| 300 | 345–387 / 610–693 (+180% / +230%) | 0.70 / **0.475** / 1.0 | 0.70 / 0.55 / 0.9 | 0.915 |
| 500 | 560.8 / 1214.0 (+355% / +482%) | 0.70 / **0.50** / 1.0 | 0.70 / 0.50 / 0.9 | 0.915 |

Every window above 100 blows the ~20% latency tolerance almost immediately (200 is already +70–75%)
and, on the *released* core specifically, regresses MRR@5 (0.60 → 0.525/0.475/0.50) — a plain wider
window pulls in more generic reference cards for released queries too, not just the ones it was meant
to help; it also cost `discoveryAliasRecallAt20` a little (0.943 → 0.915–0.929) without ever getting
candidate MRR@5 back to 0.60. No window value satisfies "no regression on released" and "candidate
≥ 0.70/0.60" and "latency +20%" simultaneously; the trend is monotonically worse in both quality and
latency past 100, so 500 was the last point swept.

### 2) Targeted identity backfill (declared alias / ICD-10 code, ≤10 documents)

Implemented as `QueryDocumentIndex.identityTermDocumentIds` (packages/core/src/query-document-index.ts)
plus wiring in `createMedicalCore.search()`: for a lookup query only, up to
`LOOKUP_IDENTITY_BACKFILL_LIMIT` documents whose own `declaredAliases`/`icd10Codes` exactly match one
of the primary branch's own terms are looked up (not the diluted branch's terms — those stay
untouched) and re-queried with the same `ftsQuery`/`filters`, then merged into the *same* branch's hit
list before `fuseBranchHits` runs — so they compete through the ordinary scoring formula, not a forced
ranking override. This needed `icd10Codes` added to the lean search-metadata projection
(`packages/storage-sqlite/src/sqlite-medical-store.ts`, `packages/storage-capacitor/src/capacitor-medical-store.ts`)
— like `targetDocumentId` before it, this field existed on documents but was invisible to `search()`'s
own document index until now.

First cut had a real bug: a scoped re-query's own bm25 rank is computed over a tiny (≤10-document)
candidate set and is not comparable to the ordinary window's rank scale, so a backfilled hit could
become the new `strongestLexicalScore` for the whole branch and dominate fusion. Fixed by capping
each backfilled hit's rank to the window's own weakest ordinary rank before merging (a backfilled hit
can now never outscore a hit the ordinary window already confirmed).

Measured at the released core.db (candidate window left at 100, `LOOKUP_IDENTITY_BACKFILL_LIMIT=10`),
before vs. after the rank cap:

| | released R@5 / MRR@5 / forbidden-free | candidate R@5 / MRR@5 / forbidden-free | released totalMs p50 / p95 |
| --- | --- | --- | --- |
| baseline (backfill disabled) | 0.70 / 0.60 / 1.0 | 0.60 / 0.45 / 0.9 | 123.4 / 208.7 |
| backfill, uncapped rank (bug) | 0.70 / **0.475** / 1.0 | **0.60 / 0.40** / 0.9 | 146.6 / 326.6 (+19% / +57%) |
| backfill, capped rank | 0.70 / **0.475** / 1.0 | **0.60 / 0.40** / 0.9 | (not re-measured; cap changes score magnitude only, not candidate set) |

The rank cap did not change the outcome, because the actual cause is different and the cap did not
touch it: capping only bounds the backfilled hit's contribution to `fuseBranchHits`'s own score — it
does not touch the *separate*, pre-existing title-match boost in `packages/core/src/query-group-ranking.ts`
(`exactTitleMatchBoost`/`titleTermBoost`), which runs downstream of `fuseBranchHits` and boosts a
document whose *title* is a near-exact match to the query subject, independent of its fused lexical
score. Once backfill makes a title-matching but previously-invisible document reachable at all — e.g.
querying «ОРВИ или бронхит у взрослого» now backfills `kr.rf.381_3` («Бронхит», found via its own
`icd10Codes` containing `J40`, one of the query's own strong-branch terms) — that downstream boost
correctly promotes a document titled literally «Бронхит» for a query containing «бронхит», pushing the
fixture-expected `kr.rf.724_2` out of the reciprocal-rank-1 spot. Root cause confirmed directly:
setting `LOOKUP_IDENTITY_BACKFILL_LIMIT=0` on the otherwise-identical tree restores released
0.70/0.60/1.0 exactly; re-enabling it reproduces the regression every time. This is not a scoring bug
to patch further inside `fuseBranchHits` — it is backfill legitimately surfacing another real,
title-matching clinical recommendation that the fixture does not happen to credit, at the cost of the
one it does. And on the candidate corpus specifically, backfill still did **not** recover
`kr.rf.306_3` for the original target query at all — R@5 for that query stayed 0/5 in every backfill
variant measured.

### Conclusion: neither lever cleared "candidate ≥ 0.70/0.60, released unregressed, latency +20%"

Neither is merged; `main` keeps the behavior of `7773051a` (window `max(limit*5, 50)`, no backfill).
With both disabled the experiment reproduced released 0.70/0.60/1.0 and candidate 0.60/0.45/0.9, so
the regression figures above are attributable to the change alone. The experiment code (including
`icd10Codes` in the lightweight search metadata projection) was set aside locally as the git stash
«ranking-experiment-2026-09-28». Real fixes worth trying next, out of scope for this pass: (a) a corroboration-scale-independent
downstream title-boost that already accounts for a document being "backfilled only, not independently
window-confirmed" so it can't win purely on title match; (b) restricting the backfill's own re-query
to the exact matched code/alias term rather than the full branch `ftsQuery`, so a backfilled candidate
can only win on the identity match itself, not on incidental extra term overlap with the rest of the
query.
