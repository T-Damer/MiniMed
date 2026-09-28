# Core coverage: does a fresh install know every concept? (2026-09-28)

User requirement: the small downloadable core must make every concept the app knows about
findable on a fresh install. Any ICD-10 code (J18.9, J18), medicine (INN or trade name),
clinical recommendation, normative act, term or definition, scale or questionnaire, or
calculator should give a result that says «this exists, download the set», never an empty list.

This note is **measurement plus proposal only**. `core.db`, `core.db.gz` and `apps/app/src` were
not changed, and no core was rebuilt.

## Method

- Script: `tools/benchmarks/src/run-core-coverage.ts` (`bun run --filter @localmed/benchmarks
  benchmark:core-coverage`). It is read-only. It writes
  `data/build/core-coverage-<mount>-report.json`, which holds the per-query rows, the top 5
  results for each query, and the inventory.
- Search path: the app's ordinary lookup. `ScopedMedicalCore(core, 'all')`, `mode: 'lexical'`,
  `analysisMode: 'lookup'`, `limit: 20`, no embedder. This is the same path as
  `benchmark:doctor-lookup`.
- Mounts:
  - `--mount=core`: `core.db` alone. This is a fresh install before any download.
  - `--mount=shipped`: core plus `regulatory.db` (weight 1.12) and `reference.db` (weight 1.08).
    These two companions ship inside the web and Android bundles. `vite.config.ts` drops only
    mkb, medications and ambulatory, and `check-native-bridge.mjs` keeps regulatory and reference.
  - A third run used `--core=data/build/core.0.7.0-test7.no-pilot.db`, the latest rebuild
    candidate, with the core-only mount.
- Sample: stratified, 200 per stratum, seed `20260928`. Each stratum gets its own Fisher–Yates
  stream (mulberry32 over seed × stratum id). Queries are de-duplicated after normalization.
  Strata smaller than 200 are taken whole. In total there are 3,850 queries per run, about 5 minutes
  each on this machine.
- Metrics:
  - `any`: at least one result.
  - `correct@5`: the right thing is in the top 5. That means the target id matches (pointer
    `targetDocumentId` or document id), a result carries the queried ICD code in
    `mkbCode`/`icd10Codes`, or, for strata with no target in any pack (terms, trade names, tools),
    a result's own identity equals the normalized query. Identity covers title, short title,
    `declaredAliases`, `navigationAliases`, `standardizedInn` and alias-table rows whose
    `canonical_term` equals the document title.
  - `actionable@5`: that correct result is not a dead end.
  - `dead-end`: a `module-pointer` whose target is in no catalog module in `moduleIds ∪
    primaryModuleId`. The module must have a downloadable required index artifact and release state
    `published` or `preview`. This mirrors `selectModuleForPointer`/`isModuleReleased` with
    experimental modules on (the default).
  - `client@5`: tools only. The bundled tool catalog is ranked by the app's own
    `fuzzyQueryScore` over title, description, short title and aliases, as
    `matchingCatalogTools` does without the section label. It needs no core.
- Full sources used:
  - Local companions: `apps/app/public/content/{mkb,medications,regulatory,reference,ambulatory}.db`.
  - `catalog.preview.json` and `catalog.shell.json`.
  - `data/raw/official-clinical-registry/catalog.json`: 744 active KR, the complete registry snapshot.
  - `data/build/release-esklp/*.db`: the 15 ESKLP modules, for INN and trade names.
  - `data/build/official-grls-coverage-ledger.json`.
  - Definition reference `2026.9.30`.
  - The `data/build/*` inputs are local and gitignored. When one is missing, the script records it
    under `notMeasured` instead of shrinking the population. None was missing in this run.

## Inventory: full source versus identities in the released core

`in core` means a core pointer targets the source id or carries the code, or, where no pointer
track exists, the name is a core identity surface.

| Category | Entity (source) | Total | In core | Missing | Missing examples |
| --- | --- | ---: | ---: | ---: | --- |
| ICD-10 | 3-char categories (mkb.db) | 2,035 | 2,035 | 0 | — |
| ICD-10 | 4-char codes (mkb.db) | 7,514 | 7,514 | 0 | — |
| ICD-10 | blocks J09-J18 (mkb.db) | 286 | 286 | 0 | — |
| Clinical recs | active KR (registry snapshot) | 744 | 744 | 0 | — (744 downloadable; but see dead ends) |
| Medications | INN (ESKLP MNN) | 3,324 | 3,324 | 0 | — |
| Medications | trade names (ESKLP) | 12,248 | 12,248 | 0 | — |
| Medications | Allmed card titles (medications.db) | 4,708 | 3,902 | 806 | Эрготал; Дигитоксин; Бигумаль |
| Medications | GRLS trade names, active | 11,208 | 9,884 | 1,324 | Натрия тиосульфат пентагидрат; Доксазозина мезилат |
| Normative acts | regulatory.db acts | 35 | 0 | 35 | приказ № 514н; приказ № 192н (only 3/35 downloadable in the catalog) |
| Terms | glossary/definition terms (def. ref.) | 8,515 | 1,736 | 6,779 | Элементная смесь; Липидный профиль |
| Terms | abbreviations (def. ref.) | 8,369 | 727 | 7,642 | Гамма-ГТ; ТААА; ПОАК |
| Terms | Wiktionary glosses | 6,939 | 1,018 | 5,921 | деполяризация; йододефицит |
| Terms | archived Wikipedia names (needs-definition) | 7,637 | 1,485 | 6,152 | Ядро одиночного пути |
| Scales | scale/tool names in def. ref. | 138 | 0 | 138 | Шкала Гамильтона для оценки депрессии |
| Scales | assessments (tool catalog) | 19 | 2 | 17 | Whooley; Ферримана–Голлвея (client-side: 19/19) |
| Calculators | calculators (tool catalog) | 50 | 2 | 48 | New Ballard; Robinson–Fleming (client-side: 50/50) |
| Reference | reference.db (ships in bundle) | 18 | 0 | 18 | стол №7; CKiD U25 |
| Reference | ambulatory.db (not shipped) | 21 | 0 | 21 | textbook chapters |

The definition reference's 11 `law` entities are physiological laws (Закон Хая, Белла — Мажанди),
not normative acts. They are listed for completeness only. None of the missing terms is present in
core `knowledge_names` either (0–1 per family).

### Pointer reachability in the released core

| Family | Pointers | Downloadable | Dead end |
| --- | ---: | ---: | ---: |
| clinical (KR) | 744 | 723 published | **21**: `moduleIds` lacks the per-KR module id (e.g. `kr.rf.1003_1`, `205_2`, `270_2`); fixed in candidate test7 (0) |
| medication (ESKLP) | 3,324 | 3,324 preview (needs experimental modules) | 0 |
| reference: RLS MKB | 9,835 | 0 | **9,835**: `primaryModuleId minimed.mkb.ru` is not in the catalog (mkb.db is a local-dev companion) |
| reference: krasotaimedicina | 6,068 | 0 | **6,068**: same (the article module is being built separately) |

In candidate test7, the 15,904 reference pointers target `minimed.core.reference.ru`, which is also
not in the catalog, so they remain dead ends.

## Empirical search results

Rates are in %. The released core is the primary result; candidate differences are noted.

| Category (strata) | n | any | correct@5 | actionable@5 | queries with a dead end in top 5 | top-1 dead end | client@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ICD-10 (6) | 1,200 | 98.1 | 70.7 | 12.0 | 97.7 | 85.2 | — |
| Clinical recs (2) | 400 | 100 | 80.0 | 78.3 | 95.8 | 49.3 | — |
| Medications (4) | 800 | 91.5 | 87.8 | 87.8 | 19.8 | 2.3 | — |
| Normative acts (3 + 10 def.-ref. law names) | 113 | 72.6 | **0** | 0 | 69.9 | 48.7 | — |
| Terms (4) | 800 | 69.8 | 15.9 | 6.4 | 67.1 | 56.6 | — |
| Scales: def.-ref. names + tool catalog (3) | 248 | 89.5 | 1.2 | 0 | 87.5 | 82.3 | **100** |
| Calculators (2) | 250 | 79.6 | 0.4 | 0 | 74.4 | 66.0 | **100** |
| Reference material (2) | 39 | 100 | 0 | 0 | 100 | 76.9 | — |

Per stratum, released core with the core-only mount:

| Stratum | Population | any | correct@5 | actionable@5 | dead-end queries | top-1 dead end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| icd.code-dotted «J18.9» | 7,514 | 98.5 | **46.0** | 13.5 | 98.0 | 76.5 |
| icd.code-no-dot «J189» | 7,514 | 94.0 | **46.0** | 17.0 | 93.5 | 70.0 |
| icd.code-lowercase «j18.9» | 7,514 | 96.0 | 44.0 | 18.5 | 94.5 | 73.0 |
| icd.category «J18» | 2,035 | 100 | 92.0 | 15.0 | 100 | 97.0 |
| icd.block «J09-J18» | 286 | 100 | 96.5 | 0.5 | 100 | 98.5 |
| icd.title | 9,747 | 100 | 99.5 | 7.5 | 100 | 96.0 |
| kr.title | 724 | 100 | 100 | 98.5 | 93.0 | 14.5 |
| kr.by-icd-code (first KR code) | 659 | 100 | 60.0 | 58.0 | 98.5 | 84.0 |
| med.inn | 3,324 | 100 | 100 | 100 | 11.0 | 0 |
| med.trade-esklp | 11,841 | 97.0 | 94.5 | 94.5 | 24.0 | 1.5 |
| med.allmed-title | 4,706 | 75.0 | 67.5 | 67.5 | 22.0 | 5.0 |
| med.trade-grls (active) | 11,208 | 94.0 | 89.0 | 89.0 | 22.0 | 2.5 |
| reg.title / short / number | 35/35/33 | 100 / 97.1 / **9.1** | 0 / 0 / 0 | 0 | 100 / 88.6 / 9.1 | 80 / 46 / 6 |
| term.glossary | 5,458 | 92.5 | 18.0 | 8.5 | 89.5 | 66.0 |
| term.abbreviation | 5,233 | **43.0** | 6.5 | 6.0 | 42.0 | 34.5 |
| term.wiktionary | 6,657 | 64.5 | 21.0 | 6.0 | 63.0 | 57.0 |
| term.wikipedia-name | 7,636 | 79.0 | 18.0 | 5.0 | 74.0 | 69.0 |
| scale.definition-name | 132 | 99.2 | 0 | 0 | 99.2 | 95.5 |
| tool.assessment title / alias | 19 / 97 | 100 / 74.2 | 0 / 3.1 (client 100 / 100) | 0 | 89.5 / 71.1 | 79 / 65 |
| tool.calculator title / alias | 50 / 220 | 100 / 74.5 | 0 / 0.5 (client 100 / 100) | 0 | 94 / 69.5 | 80 / 62.5 |
| ref.reference / ambulatory titles | 18 / 21 | 100 | 0 | 0 | 100 | 72 / 81 |

Four stopword-only queries («НА» and similar) are rejected by the core with "no searchable terms".
They are counted as zero results.

With the shipped mount (`regulatory.db` + `reference.db`), normative acts rise to 90.3% correct@5
(title 100, short title 100, number 97.0) and reference.db titles to 100%. Everything else is
unchanged within ±3 points.

Candidate test7 (core-only):

- ICD codes: dotted **97.5**, no-dot **99.5**, lowercase **99.5** correct@5.
- Actionable stays 9–19%, and top-1 dead ends reach 98–99.5%.
- kr.title actionable@5 is **100** (the 21 missing module ids are fixed).
- kr.by-icd-code is 58.5, with top-1 dead ends at 95.0.
- The other categories are unchanged.

## Root causes

1. **Reference pointers are dead ends (15,904 = 80% of core).**
   - Every RLS MKB and krasotaimedicina pointer names a module that the catalog does not offer:
     `minimed.mkb.ru` in the released core, `minimed.core.reference.ru` in the candidate.
   - ICD queries therefore find the concept (correct@5 of 70.7%, rising to 97.5% in the candidate),
     but only 12% have a downloadable correct result. Those are KR pointers that happen to carry
     the code.
   - 85–98% of ICD queries show a dead end first. The UI then says «Набор с полным документом не
     найден в каталоге загрузок». This is the largest gap against the requirement, and a core
     rebuild alone cannot fix it: it needs a catalog/module decision.
2. **ICD sub-codes are not indexed in the released core, and the search falls back to chapter I.**
   - Released pointer `normalized_text` keeps only `f23` for F23.3. The single digit `3` is dropped
     and there is no compact `f233`.
   - `search-lexical`'s `icd10LegacyFtsQueries` then queries `("23"* AND "3"*) OR ("i23"* AND "3"*)`,
     with a hardcoded `i` prefix. As a result «F23.3» returns I23.3, «L11.0» returns I11.0, and
     «Q45.8» returns I45.8.
   - Measured by chapter: I-codes are 6/6 dotted and 15/15 no-dot; other chapters succeed only by
     chance.
   - The candidate build already appends compact tokens (`f233 233`), which fixes this (97.5–99.5%)
     with no size cost. The hardcoded `i` fallback is still a latent search-lexical bug, owned by
     the ranking layer.
3. **ICD code → KR loses to short MKB cards.** Querying a KR's own ICD code puts that KR in the top
   5 only 58–61% of the time. This is the same bm25 short-document tension documented in
   `search-kr-pointers-vs-mkb-2026-09.md`. It is not a coverage gap.
4. **No pointer track at all** for:
   - normative acts: the `legal` family exists in `catalog_module_builder.py`, but no ledger feeds it;
   - definition-reference terms and abbreviations (26.5k names missing);
   - the 138 scale names in the definition reference;
   - reference.db and ambulatory.db titles.
   For these, core-only lookup either returns unrelated dead-end pointers (terms 67%, tools 70–90%)
   or nothing (abbreviations 57% empty). Short abbreviations often have no lexical hit at all, and
   stopword abbreviations are rejected.
5. **Medication aliases missing.**
   - Allmed: 806 of 4,708 titles have no identity in core. Another 788 are not identities but link
     (`linkedMnnDocumentId`) to an ESKLP pointer that is in core, so they can be aliased.
   - GRLS: 1,324 of 11,208 active trade names are missing, and 890 of those map by INN to an
     existing ESKLP pointer.
   - The remainder (806 Allmed, about 434 GRLS) has no ESKLP INN mapping.
6. **Tools are not in core, but that is acceptable.** The bundled tool catalog finds 100% of
   assessment and calculator titles and aliases client-side in the top 5, before the core loads.
   Core results for the same queries are unrelated dead-end pointers (top-1 dead end 62–84%). The
   UI should keep the tool section above core results.
7. **Catalog membership gaps.**
   - Only 3 of 35 regulatory acts are downloadable from the catalog.
   - The definition-reference module lists no `documents`, so a pointer to it cannot resolve under
     the current `selectModuleForPointer` membership rule.
   - ESKLP modules are `preview`, so they are dead ends if experimental modules are turned off.

## Proposal

The cost of each option was measured in the candidate layout (16 KiB pages, external-content FTS),
by copying one family into an empty core schema and running `VACUUM` and `gzip -9`. Knowledge
tables are excluded.

| Row shape | Installed / row | gzip / row |
| --- | ---: | ---: |
| ESKLP medication pointer (with trade-name aliases) | 18.6 KB | 2.5 KB |
| Clinical pointer | 15.0 KB | 2.6 KB |
| RLS MKB pointer | 13.2 KB | 1.6 KB |
| Lightweight identity pointer (1 doc/version/section, one short chunk; 31,488 synthetic) | 2.0 KB | 0.37 KB |
| Identity table row, no FTS (`core_identities(normalized_name, name, kind, target_id, module_id)`, WITHOUT ROWID; 31,488 rows) | 0.14 KB | 0.03 KB |
| Alias-table row (released core, dbstat) | ~0.47 KB | — |

Baseline: released core 422,838,272 B (403.3 MiB), with `core.db.gz` 78,079,240 B (74.5 MiB).
Candidate test7: 451,837,952 B.

Proposals, in order:

1. **Rebuild with the current normalizer (already in `scripts/build-core.mjs`).** This fixes ICD
   code lookup (46% → 97.5–99.5%) and the 21 KR module ids. It adds 0 bytes for this purpose.
   The candidate is still blocked by the doctor-lookup gate for other reasons (see
   `core-build-reconstruction-2026-09-27.md`).
2. **Give reference pointers a reachable target (catalog decision, no core size).**
   - Either publish an MKB/reference module that `minimed.core.reference.ru` resolves to, or let
     the krasotaimedicina article module (in progress elsewhere) own its 6,068 targets.
   - Or emit a local `contentMode` (for example `core-reference`) for pointers whose full record is
     the pointer itself, so the UI shows «есть в ядре» instead of «набор не найден».
   - Without one of these, about 98% of ICD queries lead to a dead end.
3. **Medication aliases (tools/ingest, catalog-pointer medication track).**
   - Add the 788 Allmed and 890 GRLS trade names that map to an existing ESKLP pointer as alias rows
     (`canonical_term` = INN title).
   - Size: about 1,678 × 0.47 KB ≈ **+0.8 MB** installed, well under 0.2 MB gzip.
   - Ranking risk: low. They only add surfaces to existing INN pointers, which are 0% top-1 dead end
     already.
   - Implementation: the medication track is pinned (`pin_medication_pointers.py`), so this needs
     an additional alias-only input to `finalize` (similar to `build_pilot_vocabulary_pack.py`),
     rather than unpinning.
4. **Identity index for names that have no pointer track.** Scope: definition-reference glossary
   terms, abbreviations and scale names, reference.db and ambulatory.db titles, and normative acts.
   Two options:
   - **(a) Preferred: an identity table with no FTS**, consulted only by the exact-identity tier
     (`QueryDocumentIndex` already has exact title/alias tiers), and rendered as an «есть в наборе X»
     card.
     - Size for all 26,494 missing definition names + 138 scales + 74 reference/legal titles:
       about **+3.8 MB installed / +0.9 MB gzip** (+0.9% / +1.2%).
     - Ranking risk: none for bm25, because these rows are never FTS candidates, so doctor-lookup
       cannot be diluted. `lookup-quality` gains new strict identities; its gate must be re-baselined.
     - Needs: a numbered migration (new table), a `packages/core` + storage change (ranking/search
       owner), and a pointer kind that resolves through the definition-reference module
       (`definitionReference.editionId`) rather than `documents` membership.
   - **(b) Lightweight FTS pointer documents** through the existing pointer pipeline
     (`build-core-catalog-pointers`: `--family legal` for acts; a new `definition` family).
     - Size: glossary + abbreviations (14,421) cost +29 MB / +5.1 MB gzip; all four term families
       (26,494) cost +51 MB / +9.4 MB gzip (+12.6%).
     - Ranking risk: **high and unmeasured.** Thousands of one-line documents are exactly the
       short-bm25 shape that already crowds KR pointers out of doctor-lookup (0.70/0.60 gate).
     - Only acceptable with title-only indexing and a gate run of doctor-lookup, lookup-quality and
       runtime.
   - For normative acts specifically, core-only coverage is 0%, but the shipped bundle already
     gives 90% through `regulatory.db`. A `legal` pointer track (35 × ~15 KB ≈ 0.5 MB) only helps
     once the regulatory corpus outgrows the bundled pilot. It also needs catalog membership for the
     32 acts that are not downloadable today.
5. **Search-lexical fixes (ranking owner, no core size).**
   - Drop or restrict the hardcoded `i` chapter prefix in `icd10LegacyFtsQueries`.
   - Let an exact identity hit bypass the "no searchable terms" rejection for stopword-shaped
     abbreviations («НА»).
6. **Tools: no core rows.** Keep the client-side tool catalog as the source. Where a definition-
   reference scale name matches a catalog tool, link it to the tool id (for example
   «Бристольская шкала формы кала» → Bristol). Do not duplicate the tool.

## Not measured / limits

- The metrics measure retrieval, not UI rendering. The dead-end label follows
  `selectModuleForPointer`'s rule, re-implemented in the script (not imported, to avoid browser
  state); installed-module state is not modelled. The client-side tool check omits the section
  label that `matchingCatalogTools` also matches, and the UI's own tool ordering was not verified.
- Proposals 3–4 were not built into a candidate core and not run through doctor-lookup,
  lookup-quality or runtime. The ranking risk figures are reasoning plus the measured bm25 history,
  not measurements.
- Size figures come from family copies and synthetic rows in the candidate layout. Knowledge
  tables (`knowledge_*`, about 50 MiB in the released core) are excluded, and a real build adds
  per-pointer knowledge links.
- Query shapes are canonical names and codes. Typos, colloquial phrasing, Cyrillic look-alike ICD
  letters («Ј18») and mixed-case trade names were not sampled. Allmed and GRLS "correct" for
  unmapped names is identity-only.
- The GRLS ledger and ESKLP modules are local `data/build` artifacts from 2026-07-24 and
  2026-09-05. The definition reference is edition 2026.9.30.
- Android native SQLite and physical devices were not exercised. Runs used Bun SQLite on macOS.
