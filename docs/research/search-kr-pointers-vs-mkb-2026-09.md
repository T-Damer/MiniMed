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
