# Current state

> Updated: 6 September 2026
> Repository version: `0.6.34`
> Active target: `0.6.34` public prerelease toward `1.0`

This file records what exists now and the next ordered work. The target architecture and acceptance
gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

## Implemented

### Download and reader fixes — 6 September 2026

- Android excludes the core, full medication companion, and reference illustrations from the APK.
  First launch asks the user to download the core, shows byte progress, and opens it after SHA-256
  verification and atomic installation. Matching installed cores are reused; failed downloads can be
  retried. Android systems without native FTS5 keep the WASM fallback, reading the verified local
  file. OPFS core identities include its checksum so equal-sized updates cannot reuse stale text.
  This foreground download requires the app to remain open. iOS keeps its bundled core.
- The verified core and 9,084 previously released reference illustrations have a separate public
  mirror on `datasets/content-2026-09-06`. Illustration settings provide download/cancel/delete;
  checked files survive cancellation, are reused offline, and are checksum-verified when read.
- ECG recognition has one download action for both existing components, expandable source/model
  details, and Open/Delete after installation. PTB-XL uses a verified CORS-safe mirror instead of
  the missing Pages artifact. Clinical module URLs on Android use the published artifact resolver.
- Download-all includes failed items in retries, and displays transferring/queued states on its
  action and section cards. An unavailable document card offers its exact package download.
- Inline document previews stay above bottom navigation and below visible headers, keep the source
  action with a sticky title, offer a selector for more than two meanings, and close on outside
  scrolling. Their primary source action uses theme contrast colors. Navigation, previews, and
  download controls receive feedback even when a control stops event propagation; shared chrome
  uses a stronger backdrop blur.
- Numbered migration 007 clarifies eight registry summaries as «В ГРЛС, в разделе предельных
  отпускных цен…», preserving their source anchors, evidence links, and review states. The core
  schema and original clinical claims are unchanged; the compact-FTS experiment was discarded.

Validation: lint, strict TypeScript, build, 2,722 JavaScript tests, 233 Python tests, Python
format/lint/type checks, benchmarks, and native source checks passed. Android assembled and its
unit tests passed; the signed debug APK is 85,449,773 bytes (81.49 MiB), with no core, large
companions, illustration files, or source maps. Browser checks covered preview bounds/sticky actions,
module install/search/remove, offline retry, a fresh ECG download, and cancellation with 88 retained
illustrations. Physical Android and iOS devices were not tested; the new APK is a local test build,
not a published application release.

Release qualification: the full local browser sweep passed 64 scenarios, skipped 7, and failed 3.
The EPUB scenario passed on a serial retry; the illustration cache scenario passed after its request
observer was updated for the public mirror. The local-only full medication companion still exceeds
the 10-second search assertion; this remains an open latency limitation. The published Pages smoke
passed in GitHub CI. Live smoke skips the unused local preview server and allows time to download
the full discovery core on a fresh browser.

### 0.6.33 release preparation — 5 September 2026

- PR cleanup found that fresh CI runners lacked the two released pointer-test databases.
  Web E2E now downloads both from the catalog and verifies size/SHA-256 before testing; the suite
  runs in three isolated shards. Module lifecycle checks identify the installed order-192н result
  explicitly instead of assuming that the first free-search result is the installed legal source.
  Five affected local scenarios passed, but fresh Linux runners still show core-reload and search
  timeouts, including in the Typer-only comparison. The failing CI runs were cancelled after diagnosis;
  complete browser qualification remains open in PR #163, whose JavaScript updates remain unmerged.
- This release includes all 770 existing catalog artifacts, including preview packages, without
  changing their review status. Planned modules without built artifacts remain unavailable.
- Git stores the compressed discovery core in `content/bundled/core.db.gz`; dev, build and verify
  restore `apps/app/public/content/core.db` and verify its checksum against `core-report.json`.
  Restoration validates a temporary file before replacing the existing database. The uncompressed
  core exceeds GitHub's per-file limit; its content and schema are unchanged by compression.
- The drug-pilot CI gate compares persisted review states with the source JSON and checks that
  proposed facts stay out of its default search index. Its obsolete zero-reviewed assertion
  contradicted the five already-reviewed source facts; source statuses are unchanged.
- ESKLP medication downloads use the checksum-preserving Git LFS media mirror on
  `datasets/esklp-2026-08-28`; ordinary release links previously resolved to missing main-branch
  files. The media endpoint supplies browser CORS and supports databases above Git’s file limit.
- Release validation found a retrieval limitation on the expanded core: the broad query
  «Какие дети подлежат диспансерному наблюдению после заболевания, травмы или отравления»
  ranks ICD reference entries ahead of the installed regulatory source. Module lifecycle E2E uses
  the explicit order-192н query to verify mounting; that does not qualify broad-query ranking.
  Cold-core startup and search also exceed the former 3–5 second pilot-test waits; functional
  browser checks now allow 25 seconds. Full-corpus latency/ranking remain qualification work.
- Native APK retry/failure transitions respect cancellation and interruption under the manager lock.
  A regression reproduces cancellation followed by an in-flight network read failure.


Release checks: full `verify` passed; 770 SQLite packages passed quick-check and foreign-key
validation. Browser scenarios passed after updating stale UI assertions and cold-core waits;
physical devices and optional external-model/full-private-companion scenarios were not tested.
The APK reports version 0.6.33 / code 46 and includes the exact core checksum plus 9,084 images.
The standalone web archive includes illustrations; the smaller GitHub Pages deployment omits them.

### Clinical definitions and source links — 5 September 2026

- Condition details show all linked definitions, each with its source title and the correct
  recommendation/reference label. An exact ICD entry retains its own code even when a linked
  recommendation covers several codes. Excerpt links open the local preview anchor; installed
  full texts retain the original source anchor through the existing pointer resolver.
- Definition extraction also reads «1.1 Определение заболевания…», accepts exact single-word
  disease titles and preserves dashes inside parenthetical labels. It retains source text rather
  than generating a replacement description.
- Numbered migration `006-clinical-definition-enrichment` added 194 verified definitions from
  locally prepared official clinical recommendations and preserved the existing 79. Validation
  matches document/version, section, chunk, anchor, quote, pages, character offsets and source
  spans against read-only source databases. All earlier chunks, anchors, aliases and knowledge
  tables remain unchanged. `output/clinical-definitions-added.csv` lists the additions and sources.
- The exact-code coverage audit now finds linked definitions for 3,322 of 9,835 ICD nodes;
  6,513 remain without one, and none are absent from the core. The updated gap list is
  `output/ux-icd-missing-descriptions.csv`; full results are `output/clinical-icd-coverage.csv`.
  These counts describe linked source definitions, not complete diagnostic or treatment guidance.
- Reference readers render source illustrations from verified local assets, including the first
  image in a compact disease pointer. The deterministic `localmed_ingest.reference_images` builder
  produced 9,123 image references for 5,932 documents (9,084 unique files; one failed source
  download is recorded). The 4.5 MB manifest is pinned by checksum; each requested image is checked
  for document/source membership, size and checksum before rendering. No remote image hotlinks or
  whole-archive reads are used. Locally generated files live in the Git-ignored
  `apps/app/public/content/reference-images/`; rebuilding uses `data/raw/krasotaimedicina`.
  The existing service worker caches viewed files on web; unseen web images need a first fetch.
  This is a local corpus integration, not a published image-pack release.

Validation: 2,707 TypeScript tests and 232 Python tests pass, along with TypeScript/Python type
checks, Biome, builds, benchmarks and the native packaged-source checksum check. Browser checks
cover attributed definitions, preview-anchor navigation, rendering a verified illustration and
reopening it offline in the same session. Persistent offline reload of images and native devices
were not tested. Two existing long test strings were wrapped without changing their values, so
the earlier Python lint blockers are resolved.

### First-use UX feedback — 5 September 2026

- Search home exposes one «Свободный поиск» scope. Old saved scopes and history replay cannot switch
  it to an invisible filter; the obsolete remember-mode control is hidden. Search results distinguish
  summaries, source pointers and full texts using source metadata rather than a shared generic label.
  Personal matches remain a separate collapsible section and do not wait for medical retrieval.
- Condition catalog controls sit above their masked blur/grain backdrop. The wider КР shortcut sits
  at the bottom right of its card and uses a book icon; the card retains its own navigation arrow. The clinical-recommendation
  shortcut uses a wider themed button with a book icon. Single-source entries open the reader directly;
  existing detail URLs replace the redundant selection step so Back returns to the catalog.
- Calculator collections describe offline availability, optional downloads and updates separately,
  including available download sizes. A completed transfer awaiting installation no longer says 100%
  indefinitely: full-text downloads show «Подготавливаем документ…» while preparation finishes.
- Knowledge graphs above 500 nodes use a deterministic layout linear in nodes plus edges; all nodes
  remain present. Small graphs retain force layout. Large graphs auto-fit, cull offscreen drawing,
  batch edges, and show document labels on zoom/hover, without a continuous quadratic simulation.
  Browser verification on 20,040 documents measured 227 ms from opening to the first painted frame.

- Numbered content migration `005-mkb-pointer-enrichment-v2` applies regenerated source-backed
  classification context to all 9,835 MKB pointers. Pointer reader titles combine the exact code,
  parent category and subject; bodies omit internal IDs and unavailable-download promises.
  The staged artifact was checked for unchanged existing IDs, anchors, evidence quotes, definitions,
  knowledge relations, unrelated documents and aliases before installation into `core.db`.
- MKB coverage audit (`tools/ingest/scripts/audit_mkb_coverage.py`) joins exact normalized codes
  against source-backed definitions in the application core; it does not inherit clinical claims
  from parent codes. Of 9,835 nodes (7,514 exact subcodes, 2,035 categories, 286 ranges), 2,988 have
  a definition and 6,847 remain classification-only. `output/ux-icd-missing-descriptions.csv`
  lists the remaining gaps with source URLs and node types. Classification context clarifies a
  code but does not fill the clinical-description gap or supply treatment recommendations.

Validation for the UX/data slice: 2,701 TypeScript unit tests and 227 Python tests passed;
TypeScript/Python type checks, Biome, app/landing builds, schema checks, both benchmark suites,
and the native packaged-source checksum check passed. Browser checks cover sticky chrome,
single-source navigation, free search/history/personal matches and the full core graph.
`python:check` remains blocked by three existing Ruff findings in `clinical_aliases.py:606`,
`test_catalog_module_builder.py:864` and `test_clinical_aliases.py:354`; the remaining Python
checks were run independently. Native SDK builds and physical devices were not tested.

### 0.6.32 release preparation

- Vite prebundles the complete Cornerstone runtime together for lazy DICOM viewers and thumbnails.
  This prevents duplicate rendering-engine registries after dependency discovery in development;
  the bundled 139-frame CT example opens and advances slices instead of reporting
  `No rendering engines found`.
  A fresh browser download and activation of Whisper Base q8 also completed successfully;
  the reported speech-download failure was not reproduced.
- Knowledge-base overview cards keep their metadata on one bottom baseline regardless of whether a
  download action is present. Completed collections show an installed check, while collections with
  no installable published artifact retain a disabled download affordance that explains why the pack
  is unavailable instead of silently omitting the action.
- Transparent sticky page chrome now uses one `safe-area-inset-top + 0.5rem` offset across search,
  nested catalogs and patient lists without applying the native safe inset twice. Opaque document
  readers start at the viewport edge, paint behind the status bar, and include the inset in their
  internal control padding.
- Android and Pages workflows now use the canonical tracked `core.db`; pilot rebuild jobs no longer
  replace it or commit a smaller demonstration corpus over the discovery index.
- Secret scanning covers Git-tracked and new publishable source, excluding ignored caches and build
  outputs. A regression check also covers deleted files, symlinks and filename-only error reporting.
- Browser E2E uses a loopback HTTP preview server for real pack downloads: embedding the 93 MiB core
  in a base64 Playwright route response exceeded Chromium's 100 MiB DevTools message limit.
- Calculator patient selection now binds the result to an explicit protected patient and optional
  open episode, prefills schema inputs from the patient snapshot, records longitudinal observations,
  and removes the protected result from the mounted calculator when the vault is locked.
- Medication title-term boosts no longer apply to legal acts or legal crosswalks. The 61-query
  regulatory release benchmark passes its existing ranking, section and metadata gates.
- Qualification cards mark 206n superseded and 436n active from 1 September 2026. The transition was
  checked against pages 1–2 of the [official Ministry of Health PDF](https://edu.rosminzdrav.ru/fileadmin/user_upload/documents/mz/2026/436n_14.05.2026_kvalifikacionnye_trebovanija__2_.pdf)
  on 2 September; document IDs are preserved and changed cards receive a new edition label.

### Search and package fixes — 5 September 2026

- Informational medication requests constrain candidate retrieval to the named medication before
  generic instruction/document matches can exhaust the result window. A repeated 70-query run
  recovered 70/70 targets in both core-only and installed modes (previous installed result 47/70).
  This run uses UI settings (`auto`, limit 20, suggestions enabled), so it is not a latency comparison
  with the previous lexical/limit-5 run. `runtime-medication-final-report.json` records MRR@5
  0.9726 core-only and 0.9190 installed, with zero context-budget violations on the final core edition.
- Exact source phrases have a separate lexical branch and rank ahead of partial word matches;
  broad alias retrieval remains available. Definition snippets remain original source text.
- Pointer package selection requires exact document membership plus a required index artifact with
  URL and checksum. It prefers an installed matching edition, then the released primary/alternative;
  experimental preview eligibility is preserved. A pack's installed state alone cannot redirect the
  reader: the target must be readable. Download completion preserves the requested source anchor.
- `scripts/hydrate-catalog-membership.ts CATALOG OUTPUT PACK.db ...` derives membership from actual
  SQLite rows only when the file SHA-256 matches an existing catalog artifact. All 15 published ESKLP
  release files were downloaded and verified; their 3,324 actual documents now populate the catalog,
  covering all 3,324 medication pointers. URLs, checksums and preview release states are unchanged.
  Experimental modules remain controlled by the existing preference (currently enabled by default).
  Local MKB, regulatory and GRLS files with different checksums were not substituted for releases.
- Initial source-anchor scrolling waits for the asynchronous document and its rendered section.
  Loading another document resets the one-time scroll guard, including reopening the same source
  through a discovery pointer; later section batches do not reset the reading position.
- Runtime reports now include expected/retrieved targets, corpus coverage (`local`, `discovery`,
  `absent`) and found/missed outcomes. Recall@5 still measures the first five of the UI's 20 groups;
  covered recall excludes absent targets, and absence alone is not a retrieval failure gate.
- The final 12-case contract run (`runtime-contracts-hydrated-report.json`) uses the exact clinical
  and antiparasitic release files and explicitly enables preview downloads. Both modes retrieve
  all seven expected targets at rank 1; form/strength, negation, Cyrillic ICD and context checks pass.
  Five cases per mode still flag unavailable reference downloads: their `minimed.mkb.ru` module
  has no catalog release. This is an unresolved content-release gap, not a passing download gate.
- Validation: 2,681 TypeScript and 224 Python tests pass, along with typecheck, application build,
  lint (existing warnings), and `benchmark:all`. Chromium verifies package install/reopen anchors,
  experimental medication availability, repeated core reload and reader lookups; reader native-chrome
  emulation also passes. No physical native device or private-corpus rebuild was used. The aggregate
  `python:check` remains blocked by pre-existing formatting in `test_core_reference_pointers.py`;
  changed Python files and the project's Pyright command pass.

### Ambiguous abbreviations and inline navigation — 5 September 2026

- Shared document links retain every distinct target for the same phrase instead of dropping the
  link. Search and structured source readers show a keyboard-accessible choice preview, with
  source definitions and exact anchors where present. A longer phrase wins at each occurrence.
  Current-document families remain excluded from self-links. Personal Markdown/EPUB/PDF readers
  do not yet receive this matcher; extending them needs a separate rendering integration.
- Deterministic core projection adds editorial `navigationAliases` for the existing RLS classifier:
  «МКБ», «МКБ-10», «МКБ 10». The source-declared «МКБ → Мочекаменная болезнь» remains intact.
  Alias facts preserve different canonical meanings with uncertain polarity and distinct ids.
  Exact longer names suppress embedded aliases, but a later standalone occurrence remains valid.
- Exact declared/navigation aliases preserve every matching document through lexical/hybrid chunk
  cutoffs and outrank incidental mentions. Real core-only checks put the classifier/disease at
  ranks 1/2 for «МКБ» and the classifier first for «МКБ-10»
  (`runtime-abbreviations-report.json`): 3/3 retrieval/context checks, download gate still false.
- Core preview.8 was generated through `content:core:knowledge` and atomically published locally:
  377,896,960 bytes, 44,214 aliases (+3), unchanged 19,987 document ids and 33,861 chunk ids;
  SQLite integrity/FKs pass. SHA-256:
  `b222441a936aa7993155c30cc60b40be25051ac470eb0f7acbed067e0746c911`.
  Source-set digest, original source text and source anchors remain unchanged.
- Installed medication contract regression (`runtime-contracts-ambiguity-report.json`): all 13
  expected targets found across 20 cases, MRR@5 0.8718, zero context errors; form/strength, negation,
  Cyrillic ICD and plant-avoidance checks pass. Thirteen queries still have unverified download
  targets (including the unpublished MKB module), so the aggregate report is correctly false.
- Chromium verifies both «МКБ» search choices, navigation to the selected disease/classifier,
  and a multi-target preview inside the structured source reader. At 390×844 the definitions are
  visually clamped to four lines so alternatives remain visible; full source text is preserved.
  Escape closes the preview with unchanged reading position; its source action opens the selected
  pointer with the original paragraph anchor. Screenshot:
  `output/playwright/ambiguity-reader-mobile.png`.
- Verification: 2,702 TypeScript and 227 Python tests pass; check, typecheck, build, benchmark:all
  and Pyright pass. Aggregate python:check stops at pre-existing formatting in
  `mkb_pointer_migration_005.py`. No native or private-corpus rebuild was needed.

### Search precision follow-up — 5 September 2026

- Lexical and hybrid chunk fusion now preserve exact subject-title candidates until document
  ranking. This fixes the reproduced case where the store returned the exact «Сепсис» pointer but
  fusion discarded it before title ranking. Other candidates keep their existing bound.
- The positive-symptom branch also runs for plain descriptions with unknown intent. Inflected
  component aliases are excluded from medication expansion: «инфекции» no longer means an entire
  combination vaccine. Explicit medication/treatment intents keep their existing behavior.
- Clinical results containing a literal/canonical positive finding in their title or displayed
  snippets precede incidental background-word matches. Alias matched-term lists alone do not count
  as source evidence; negated query findings remain excluded. No symptom-to-diagnosis rules were added.
- An experiment retaining every branch candidate regressed respiratory retrieval to 48/60
  (`runtime-symptoms-unbounded-report.json`) and was rejected. A subsequent intermediate 52/60
  result (`runtime-symptoms-precise-report.json`) exposed one apnea wording regression, motivating
  the source-evidence priority. These intermediate reports are not the final acceptance result.
- Final named-condition retrieval: 60/60, MRR@5 0.8144 (previously 59/60, 0.8061), with MKB
  installed (`runtime-diseases-accepted-report.json`). Final symptoms: 56/60, MRR@5 0.7028
  (previously 51/60, 0.6417), using the three legacy full respiratory documents
  (`runtime-symptoms-accepted-report.json`). Both have zero context errors. Four symptom misses
  remain: plain/navigation variants of «лихорадка больше трех дней и дыхательная недостаточность»
  and «острый кашель после инфекции без признаков пневмонии». Disease/symptom download gates
  remain false (48/59 unverified queries respectively). These cohort snapshots use core preview.7,
  before the abbreviation follow-up below; the legacy respiratory files are not a catalog release.
- Medication regression: 70/70, MRR@5 0.9167, unchanged, with all 70 download-target checks verified
  (`runtime-medications-precise-report.json`, core plus `medications-unified.db`). Syndromes: 40/40,
  MRR@5 0.875 (`runtime-syndromes-precise-report.json`, core plus MKB). Both have zero context errors;
  27 syndrome queries still have an unverified download target, so that report remains overall false.
- Verification: 2,693 TypeScript and 224 Python tests, check, typecheck, build and the compact/long
  benchmark suites pass. Check retains 18 pre-existing warnings and 229 infos. No UI/native code or
  generated database was changed by this follow-up; browser/native/private-corpus rebuilds were not run.

### Disease and symptom retrieval audit — 5 September 2026

- Named-condition queries discard navigation preambles before FTS and title ranking, preserving
  original text and fact offsets. Exact subject phrases keep virus-type letters in title matching;
  short terms such as «рак» count, while «боль» does not title-match «большой».
- MedicalCore filters one-letter source aliases before analysis, expansion and presentation lookup.
  A real vaccine alias «С» previously misclassified «острый гепатит С» as a medication query.
  Source-type medication bonuses now require a named medicine and do not apply to symptom narratives.
- Symptom narratives score multiple positive clues in one source snippet. Seven literal respiratory
  findings were added to the existing expression dictionary with source trace in `SEARCH.md`.
  Negated findings are excluded from title bonuses and from alias/intent/clause branch expansion,
  including inflected canonical forms; no symptom-to-diagnosis inference rules were added.
- The frozen 60 symptom fixtures target three legacy full-document IDs. None exists in the old
  core/medication/ambulatory/MKB/reference/regulatory benchmark composition. They do exist in
  `data/build/full-respiratory-rf.db`, now explicitly mounted for this cohort. Queries and expected IDs
  are unchanged; old 0/60 and the new covered-corpus result are not a like-for-like ranking comparison.
- The same-input disease comparison improved from 51/60 in both modes to 59/60 core-only and 58/60
  with MKB (`runtime-diseases-before-report.json`, `runtime-diseases-after-report.json`), before the
  subsequent one-letter-alias/virus-title fixes. The first covered symptom run found 41/60; vocabulary
  and alias corrections raised it to 51/60 (`runtime-symptoms-final-report.json`). Final reruns below
  retain their exact pack composition rather than claiming a complete clinical corpus.
- Final installed/MKB disease rerun: 59/60 (98.33%), MRR@5 0.8061, zero context errors
  (`runtime-diseases-final-report.json`), compared with 51/60 and MRR@5 0.7194 on the same inputs.
  «Острый гепатит С» is rank 1. `disease-42` (the specific expected sepsis document) remains a miss;
  other sepsis sources are retrieved, which does not satisfy this fixture's exact target.
- Final respiratory rerun: 51/60 (85%), MRR@5 0.6417, zero context errors
  (`runtime-symptoms-final2-report.json`, core plus the legacy full respiratory pack). Nine present-
  corpus misses remain: scenarios 2, 3 and 12 each miss two wording variants; scenario 18 misses all
  three variants. These concern poor feeding/difficult breathing with rales, apnea with viral illness,
  fever with respiratory insufficiency, and cough without pneumonia signs. They are unresolved
  retrieval misses, not absent-corpus cases. The negative-branch/title fixes pass mechanism tests but
  do not by themselves retrieve scenario 18's expected bronchitis source.
- Medication regression with core plus `medications-unified.db` remains 70/70, MRR@5 0.9167,
  with zero context errors and all 70 download checks verified
  (`runtime-medications-regression-report.json`). This run is limited to that named medication pack,
  not every optional package combination.
- The expanded 16-case contract run (`runtime-diagnosis-contracts-report.json`) passes all nine
  expected-target checks in each mode, form/strength checks, negative findings and Cyrillic ICD,
  including `м16.1`; context errors are zero. Unavailable reference download targets remain a separate
  failing gate. A virus-letter case was subsequently added to the permanent contract set.
- Validation: 2,689 TypeScript tests and 224 Python tests pass, along with lint (existing warnings),
  typecheck, app/landing build and `benchmark:all`. No UI, native or database-format changes were made;
  browser/native/device checks and private-corpus rebuilds were not run for this slice.

### Data + search snapshot (measured)

- Production `apps/app/public/content/core.db` is `minimed.core.ru@1.0.0-preview.7`,
  `377,892,864` bytes, SHA-256
  `9bdb140bd5bec6c9533a7a39f4fdb44281cefcfd0a678df6cb07fd756dbcb273`, source-set digest
  `sha256:8e68982002d4fe01efe765ba06969cd13d72a94ce6ff6fce46c51cf2479e1993`; it contains 19,987
  documents, 33,849 sections, 33,861 chunks, and 44,211 aliases. FTS coverage is `33,861/33,861`,
  SQLite integrity is `ok`, and foreign-key violations are `0`.
- The composer now projects source-backed navigation into the existing knowledge tables: 30,220
  entities, 43,106 names, 17,994 relations, 87 facts and 26,128 document links. Stable concept IDs
  derive from source document IDs, not names; identical names do not silently merge sources.
  The projection links all 6,147 existing definition previews to their original document/version,
  section, chunk and anchor. Only 79 definitions with an exact local chunk quote become additional
  facts. Another 6,068 definitions now have verbatim discovery chunks and FTS rows, bringing
  searchable definition links to 6,147. Existing version/section/chunk/alias rows are unchanged;
  generated excerpt anchors map to the original source anchors when opening the full document.
  Explicit synonyms become names; keywords, specialties, age categories and ICD codes stay tags.
  ICD membership is proposed `classification-only` evidence, never automatic clinical approval.
  Recomposition replaces only generated projection rows and preserves editorial knowledge.
  `bun run content:core:knowledge` writes a staging edition for validation before publication.
- The runtime file is now canonically named `core.db`; the former `core-demo.db` name is retired in
  application loading, service-worker caching, native bridge checks, tests, and publish scripts.
  Per ADR 0017, this database is the lightweight discovery index: medication names, aliases,
  clinical disease synonyms/keywords, provenance, and module pointers stay in core, while complete
  ESKLP/GRLS/Allmed reader data belongs in the separate `medications.db` pack.
- The bundled-core registry now derives version, source-set digest, and installed size from the
  validated module catalog entry. The catalog and runtime therefore both advertise preview.7 and
  cannot silently retain older metadata after a core replacement.
- The core contains lightweight ESKLP medication pointers: 3,324 documents, 10,996 sections,
  11,008 chunks, and 21,610 aliases. It also contains 744 clinical-recommendation disease pointers,
  744 exact recommendation-module IDs, 580 audited disease aliases/synonyms, 79 strict source-backed
  definitions, and 1,235 explicit keyword
  values across 163 recommendations. Keyword provenance retains the source section, chunk, and source
  text. Those values improve recall; they are not treated as exact diagnoses, inline-link aliases, or
  clinical assertions. TOC leakage and abbreviation entries from malformed keyword blocks are excluded
  automatically.
- A further 15,904 compact MKB/RLS and disease-reference pointers add 12,432 diagnostic aliases while
  leaving full article text and images in the separate companion database. Their raw declared types are
  12,232 diseases, 2,548 conditions, 784 syndromes, 339 symptoms, and one classification entry. After
  title/ICD grouping and runtime fixture filtering, the visible catalog contains 9,030 diseases, 2,547
  conditions, 402 syndromes, and 339 symptoms (12,318 cards total).
- The compact pointers carry 6,068 exact `Краткое описание` excerpts from the local disease-reference
  corpus with source document/version/section/chunk anchors. Together with 79 strict KR definitions,
  `core.db` exposes 6,147 source-backed definition previews without copying complete articles or images.
- The 500-query full `mkb-diseases.db` retrieval gate passes with Recall@5 `0.938`, MRR@5 `0.9424`,
  and top-1 `0.898`. Section recall is not measured by that fixture (`0` section-labelled queries).
- Document readers include `core_catalog_pointer` titles and declared aliases in the prefix-bucket
  inline-link matcher. Broad recommendation keywords remain searchable but are not link targets: for
  example, `Магнитно-резонансная томография` cannot route to a disease merely because its recommendation
  lists that method as a keyword. Three-letter abbreviations are supported; when the corresponding
  full document is installed it replaces the pointer as the link target. This reuses the 4,068 bundled
  catalog pointers instead of creating a second glossary or a catalog-sized regex.
- Clinical pointers can now carry one exact canonical definition copied from the recommendation's
  `Термины и определения` section. The definition retains a stable ID plus source
  document/version/section/chunk/anchor, appears before technical pointer metadata in the reader, and is
  shown directly on the unified condition card with a deep link back to the source recommendation. The
  audited deterministic 2026-09-04 pass found 99 complete, title-specific definitions across 744
  clinical records while preserving 800 aliases, 1,235 keywords, and all 1,049 existing proposed
  medication links. Incomplete line fragments and matches through a generic one-word alias are rejected;
  unmatched terms remain visibly definition-free rather than receiving generated text.
- Reader links with a canonical definition open a compact in-place preview first and offer an explicit
  card/document action. Reader Back traverses linked documents in reverse order before returning to the
  originating search or catalog page.
- The bundled `reference.db` and downloadable reference artifact now contain 18 documents, 94 sections,
  94 chunks, and 29 aliases. The new sourced laboratory card covers selected age-specific CBC,
  biochemistry, and CSF intervals plus explicitly adult-only urine orientation; its UI copy directs the
  clinician to prefer the performing laboratory's method-specific interval. Both SQLite copies have
  integrity `ok`, zero foreign-key violations, and SHA-256
  `1822dede2898f6781236cc638cd8bf1c0885d821e864746940e271bcbada7213`.
- A deterministic clinical-recommendation/MNN candidate extractor links exact ESKLP MNN
  identities to source-exact positive recommendation passages without rebuilding the source
  databases. On the 723 locally available clinical modules it produced 1,049 `proposed` relations
  across 271 recommendations and 455 unique MNN identities; all retain document-level age groups,
  exact chunk evidence, and whether the source section was under a parsed treatment branch. The
  audit found zero negative-recommendation passages and zero residual generic `ЙОД` matches. Eight
  workers completed the pass in 45.421 seconds after reusing one compiled 3,324-MNN index, versus
  119.111 seconds when each module rebuilt that index. Candidate checkpoints retain the clinical
  version/source checksum and MNN-index digest; a verified `--resume` pass reused all 723 JSON files
  in 0.217 seconds, while stale inputs are rebuilt. The core stores all 1,049 links in clinical
  pointer metadata without indexing their MNN names as disease aliases. A medication card can show
  related recommendations, population, and the exact source anchor; every link remains visibly
  `proposed` and outside treatment-capable search until reviewed. No clinical SQLite module was
  modified or rebuilt.
- Core-only search can surface a missing full document or medicine from its pointer and offer the
  exact module download. Fifteen ESKLP preview modules are published in the
  [GitHub pre-release](https://github.com/T-Damer/MiniMed/releases/tag/esklp-2026-08-28) behind the
  Experimental setting. ESKLP is trusted for identity and registration facts, not for doses or
  indications.
- Required core and downloaded SQLite modules larger than 32 MiB use OPFS; small SQLite packs remain
  on the WASM path. The medication presentation branch joins brand with form, route, and strength;
  `сироп`/`спироп` and suspension are search-equivalent without rewriting source labels. Measured
  smoke cases put the correct ESKLP suspension section first for `нурофен суспензия` and
  `100 мг/5 мл`, return no result for `нурофен мазь`, and keep ceftriaxone intravenous lookup
  correct. These are identity-retrieval checks, not dose support.
- The SQLite composer uses `ATTACH` and set-based bulk copies, creates secondary indexes and FTS
  after loading, checkpoints after each module, and reuses validated manifests/checksums. The final
  core was rebuilt from the existing pointer databases; the fifteen ESKLP source databases were
  reused and were not rebuilt.
- Composer FTS consistency checks now group expected/actual identity streams instead of joining
  each expected row to an unindexed FTS identity column. The 212,758-chunk medication-stage
  identity check completed in 0.41 seconds; this is not a timing for the whole integrity suite.
  Missing, extra, duplicate, and null identities still fail validation for both FTS tables.
  Resume recognizes an already committed finalization, verifies input fingerprints and the stored
  source-set digest, and skips rebuilding its FTS/indexes while retaining every final integrity
  and manifest check. The composer/builder/edition-manifest suites pass 44 tests, including bounded
  SQLite-operation regression tests and finalized-stage recovery without rewriting the database.
- Local `data/build/medications-unified.db` now composes existing Allmed, 189 GRLS instructions
  plus their 189 registry cards, and full ESKLP: 8,410 documents, 84,445 sections, 212,758 chunks,
  and 45,649 aliases. Finalized-stage resume finished in 35.214 seconds with SQLite integrity `ok`
  and zero foreign-key violations. Size: 3,028,381,696 bytes; SHA-256:
  `75b23c797bad9421eb8a79e70cc1de4a5e54e2314482c4c22e90ccfdbd3bc564`.
  The edition manifest is beside it. This is a local build artifact, not a replacement of the
  bundled `medications.db` and not a published download. The pre-fix stage/checkpoint backup is
  retained locally; source databases were reused without changes.

### Product and retrieval

- SolidJS browser app behind the UI-independent `MedicalCore` contract.
- SQLite/FTS5 retrieval with SQLite WASM fallback and compatible native read-only storage adapters.
  Native database leases stay open across core replacement, so reconnecting installed packs cannot
  close the replacement store underneath document reading.
- ICD-10 search normalizes Cyrillic lookalikes in code-shaped tokens (`А09`, `С50`, `М16`) through
  the shared lexical normalizer and the condition catalog. Russian prose and spaced concentration
  phrases retain their original meaning, and normalized highlight offsets stay aligned with source text.
  Medication form/route/strength filtering now also applies to canonical MNN queries, requiring those
  facts in the same result instead of bypassing the check when no trade-name alias was used.
- Deterministic portable embeddings and hybrid lexical/vector fusion. Browser WASM vector search
  runs as a two-phase top-K scan (light embedding rows first, heavy hydration only for candidates,
  mirroring the native adapter), and lexical search widens its SQL pre-limit while specialty or
  age-group filters are active so filtered result lists no longer come back short.
- Search is retrieval-only: `Свободный поиск` is the default scope, returns at most 20 document
  groups with exact source fragments, and does not run a generative model. The result count is a
  display cap; retrieval quality is evaluated at the first four positions. Diagnosis scope preserves
  deterministic clinical ordering by putting clinical recommendations before reference material.
  Personal notes and unlocked patient cards remain a separate local result surface.
- The throwaway E5 CLI prototype now canonicalizes pointer/summary/full recommendation families and
  uses query-aware lexical/semantic interleaving. On the generated 500-query suite this raised
  Recall@4 from `0.998` to `1.00`, Recall@1 from `0.924` to `0.940`, and MRR@20 from `0.9560` to
  `0.9675`, with 13 improved ranks and one worsened rank. The 113 MiB model remains outside the app
  until clinician-written blind queries and physical Android checks confirm the gain.
- Russian patient-case parsing, negative findings, bounded query branches, medical abbreviations, and
  missing-field prompts; the symptom lexicon recognizes nosebleed phrases such as `кровотечение из
  носа`, rhinitis phrases such as `насморк`, and sore-throat phrases such as `боль в горле`, with
  searchable canonical terms. Medication intent includes nasal drops and antipyretic requests.
  Blood-pressure readings such as `200/120` remain atomic patient facts: their numbers are excluded
  from lexical branches so they cannot collide with medicine strengths, while an unlabelled medicine
  strength such as `1 г` remains searchable.
- The Phase 2 deterministic parser benchmark now freezes 29 fixed/held-out queries, including
  regressions found by generated surfaces for `спироп`, inflected sex terms, degree-less temperature
  spans before spaced punctuation,
  spaced negation punctuation, and allergy boundaries. A structured seeded generator renders nine
  semantic scenarios into 72 unique cases (36 fixed, 36 held-out) with word-order, spacing,
  punctuation, case, `е/ё`, decimal, abbreviation, inflection, common-typo, polite-filler, irrelevant
  number, and irrelevant-measurement mutations. CI seed `20260831` and exploratory seed `20260832`
  both pass intent/entity F1, critical-context exactness, and negation polarity at `1.00` on both
  splits. The corpus remains synthetic and bounded; rotating-seed scheduling and model-assisted
  paraphrase mining are not yet release evidence.
- Search analysis now distinguishes medication-dose and infusion-volume calculation intent. An
  explicit dose phrase, or a recognized medicine plus patient age/weight, can offer an installed,
  source-backed calculator before the unchanged document results; unsafe/already-administered and
  informational wording abstains. Ambiguous or fuzzy medicine matches require selection. The card
  prefills only schema-bound age, weight, formulation, route, and indication fields, preserving the
  option order declared by the calculator. With no matching installed schema it is omitted. A
  deterministic `proposed` benchmark generates 500 unique Russian routing cases: 225 medication
  dose, 75 infusion volume, 50 other calculator, and 150 ordinary-search cases; all medication and
  infusion cases are exercised against the current deterministic gating. No dose facts are inferred
  from ESKLP metadata or published by this feature. The search field also has an offline `@`
  calculator picker: it inserts
  `@Калькулятор:<stable-slug>`, removes that control token before ordinary retrieval, and shows the
  explicitly selected installed calculator as the first card even when the remaining query is
  empty. Its viewport-aware list opens outside the search sheet's clipping boundary and keeps the
  keyboard-active option visible. Selected and suggested calculators now run inline in search with
  the same schema-driven inputs, guidance, results, charts, and actions as the calculator page;
  opening that page remains an explicit secondary action. Free text may prefill only the same
  unambiguous schema-bound fields; calculation starts after the user presses `Рассчитать`.
- The installed pilot corpus does not yet contain reviewed, evidence-backed relations for general
  allergy, rhinitis, sore-throat, antipyretic, or hypertensive-crisis treatment queries. Search does
  not infer these treatment edges from ESKLP metadata; adding them requires applicable clinical or
  regulatory source passages and explicit graph relations.
- Search after 500 ms of inactivity with stale-response cancellation. A transient search-worker
  boot failure retries on the next query instead of silently falling back to main-thread search for
  the whole session.
- Short name lookups promote a document or medication whose title/trade name *is* the query
  (for example `Парацетамол`) above combinations and sources that only mention the term. The
  medications catalog sorts those hits by the same name-first rule instead of alphabetically.
- Search starts in the all-source `Свободный поиск` scope; narrower scopes with no installed
  documents are disabled.
- Query analysis and deterministic retrieval run in a Web Worker, and long result sets are window
  virtualized.
- MedicalCore loads aliases once per initialized core lifetime and executes independent bounded
  lexical query branches concurrently while preserving deterministic branch order.
- Results are grouped by document and window-virtualized; compact result cards show numbered matches,
  source/category metadata, up to four snippet lines, and open the exact fragment without expanding
  the result group. Group headers watermark the source family (medication, recommendation, legal act,
  calculator, assessment, or reference) with a matching icon, and medication groups render at most
  three fragment actions. The document group header opens the full document. Retrieval stats and search mode
  sit inside the expandable query-analysis details panel, whose collapsed row is a hoverable card
  with a details badge and centered summary text. The source preview is a body-level overlay above navigation chrome, vertically
  centered in the viewport, with the shared primary button to open the full document; opening the full
  document closes the preview overlay first.
- Official and personal full documents open as hash-router pages under `#/modules/documents/…`
  inside `<main>` with Kobalte breadcrumbs (origin → nested documents). Official: `#/modules/documents/d/<token>`;
  personal: `#/modules/documents/user/<id>` (optional `/p/<page>`). On tablet and desktop the outline
  is a full-viewport left column; sticky chrome and paper sit in the right column so the page header
  cannot overlap the TOC. Mobile TOC is a full-height drawer above the bottom nav.   Nested headings in the document body keep a full-width sticky bar for in-text
  `h1`–`h6`; the paper document title is not pinned. Sticky heading fill matches the paper
  and extends through the page padding so scrolling content cannot show gaps beside the title.
  Print and clinical full-text sit in one paper-title
  row; full-text is a primary button with in-button loading instead of a page overlay. Outline
  desktop changes are animated, mobile outline changes are immediate, and scrolling pins the
  current section heading, marks its outline entry, and keeps that entry centered.
  Section headings copy
  a deep link to `#/modules/documents/d/<token>`; legacy `?o=` / `dialog`+`section` and `#/read/…` migrate
  to that hash on load. Opening a large official document no longer freezes the main thread:
  inline cross-links use a prefix-bucket matcher compiled once per document, assessment/calculator
  links reuse a singleton matcher, paper sections mount in idle batches whose tree nodes stay
  referentially stable so already-mounted sections are not rebuilt while later batches append, the
  reader outline collapses through a FLIP animation (text reflows once, then slides) with a
  drag-resizable outline width on desktop, and offscreen pages/sections use content-visibility so
  width changes stay cheap on huge books.
  referentially stable so already-mounted sections are not rebuilt while later batches append.   Outline sections are paper blocks in default, hover, and active states. Initial open keeps the
  same page chrome with a full page surface and centered spinner; clinical full-text loading stays
  inside the primary button. Nested document links navigate to another documents hash page and append a breadcrumb
  instead of stacking reader dialogs. Supported text/Markdown documents can switch to a paper-free book mode
  from the reader menu; pinch-zoom scales the whole document in place without opening preview, and a horizontal
  swipe opens or hides the outline. Reader actions are capability-driven: standard document readers use
  the auto-hiding app chrome instead of a separate fullscreen mode, reading mode is limited to
  text/Markdown, and the PDF two-page spread
  stays PDF-only; PDF zoom controls and pinch zoom keep the horizontal scroll locked; safe-area chrome stays sticky until
  downward scrolling hides it and upward scrolling shows it again, while reader content reserves
  the bottom-navigation band; sticky document headings follow the hidden chrome to the safe-area edge
  and keep an opaque paper fill. PPTX slide clicks still open the zoomable media viewer; PDF pages
  zoom in place, rerender at the enlarged surface width after layout changes, and keep their
  selectable text layer.
  Find is disabled when an upload has no extractable text.
- Search-result context remaps stale pilot-summary chunks to installed full-text siblings and falls back
  to the readable document when an exact chunk cannot be resolved.
- Поиск по полному документу работает как поиск на странице: он точно сопоставляет введённую фразу
  без учёта регистра, включая название и заголовки разделов, подсвечивает только эти диапазоны и
  прокручивает совпадения кнопками «предыдущее/следующее»; диапазоны сохраняются через списки,
  markdown-ссылки, ссылки на инструменты, таблицы и подписи к изображениям.
- В режиме поиска по полному документу и длинному источнику кнопка «Назад» превращается в «×» и
  закрывает поиск; обычные поиски по карточкам сохраняют навигацию назад.
- В каталогах активный поиск также заменяет доступную кнопку «Назад» на «×» для очистки запроса;
  если навигации назад нет, крестик показывается внутри поля поиска.
- Within-document ranking uses query intent to prefer the relevant diagnostic, routing, or treatment
  section; the public benchmark currently has perfect section retrieval and top-section accuracy.
- Document-group ranking also gives concrete query terms in titles priority over frequent body
  mentions, while suppressing title priority for a failed prior treatment; snippets strip known HTML
  markup before computing highlights; personal search cards use source/file-type glyphs for notes,
  books, medical images, and other local files.
- Search scopes cover diagnosis support, clinical recommendations, medications, legal documents,
  deterministic search across all installed sources, and a personal overlay («Ваши данные») for local
  notes and uploaded personal files.
- Only diagnosis scope may call the optional grounded local-model wrapper; the other scopes constrain
  deterministic retrieval by installed source type.
- A realistic pediatric workflow query — `Цефтриаксон ребенку 3 лет вес 20 кг при пневмонии как
  второй антибиотик` — is part of the retrieval benchmark.

### Browser workspace

- Медицинские файлы DICOM/NIfTI открываются на весь экран без прокрутки; печать снимков доступна
  через адаптивное модальное окно с сохранением настроек, кнопками направлений с иконками,
  двухточечными диапазонами срезов, постоянной галереей с drag-select и переключателем пометок.
  Печатный кадр содержит крупное изображение и компактные подписи пациента, серии и среза;
  сеточный режим собирает монтажи 4×4 и ограничивает их четырьмя на листе, а предпросмотр A4
  открывается отдельной выдвижной панелью.
- Pointer clicks do not show the system blue tap flash or leftover focus rings; keyboard Tab/arrow
  focus rings stay. Overlay dialogs trap Tab inside the panel, restore focus to the invoking
  element on close, and Escape is suppressed only by a media viewer layered over the same dialog.
- Six primary sections — search, knowledge base, assessments, calculators, notes, and settings — use
  a compact bottom navigation with a floating glass bubble that follows the
  selected item and horizontal pointer/touch swipes. `App.tsx` only wires shell hooks and root
  view sections; routing, session bootstrap, find shortcut, native back, and nav gestures live beside it.
  selected item and horizontal pointer/touch swipes. The bubble deforms from travel speed on both
  drag and ordinary tab clicks, then settles back to a circle, and compresses into the bar edge when
  the pointer is pulled outside it. In dark mode the bar stays a warm dark surface; only the active
  icon uses a darker accent green on a subdued cream bubble. Hover changes only the icon color, not
  the button fill. Root navigation commits immediately; the incoming
  view overlays the stationary outgoing view with a strictly horizontal CSS slide and temporary page
  shadow, without an opacity transition, while the status-bar blur remains between the old and new views.
  The bottom navigation remains fixed and interactive, and hides with the reader header while scrolling
  down before returning on upward scroll. Root tab slide animation is not suppressed by
  leftover overlay history in the URL. Stale overlay query params (`o`, legacy `dialog`/`section`) are
  stripped on root hash changes when no document page (`#/modules/documents/d/…` or
  `#/modules/documents/user/<id>`) is open. Rapid tab changes
  do not wait on View Transition snapshots; document read routes, note, and local-model subroutes remain instant. The
  scroll-to-top control
  reserves the bottom-navigation band on long pages, and the notes add control and questionnaire
  next control mount only while their root is active. All remaining floating page controls (mini-window
  toggle, scroll-to-top, notes add, questionnaire next) share one fixed vertical stack at
  the right edge with one uniform control size; only their z-index and visibility vary by context.
- Root navigation snapshots the route that was left, not the already-updated hash, so returning from a
  questionnaire or nested tool restores the same Documents subroute. Root panes are keep-alive: a view
  constructs its component on first visit and stays mounted (hidden) afterwards, so tab switches
  preserve composer drafts and per-view state without re-running bootstrap, while never-visited tabs
  cost nothing at boot. Incoming-view scroll is painted
  immediately via a Y overlay shift while `window.scrollY` stays on the outgoing page, then committed
  when the enter animation ends so neither page jumps; sticky chrome (catalog search, search tools,
  medication headings) stays in its header slot during the slide because the enter animation uses
  `top`/`margin-left` rather than `transform`, and the overlay keeps the centered page measure on
  wide screens. Intra-route hash listeners skip `scrollTo(0)` while a root-tab transition is active so
  the bottom nav does not ride up from a scrolled destination page. Page grain and stuck-chrome blur
  fill the content column rather than a narrower centered strip. Route surfaces extend below the navigation band
  instead of exposing the desk background at the end of the page. The enter motion ends on
  `animationend` (with a timeout fallback) rather than a fixed 60fps timer.
- The bottom navigation is mounted only after the asynchronous MedicalCore bootstrap completes;
  loading and error states therefore do not expose a menu whose routes are not ready yet. Tests and
  calculators remain directly renderable while the search core loads.
- Search mode is an explicit compact choice inside the query composer; the disabled field prompts for
  a mode first, and the horizontally scrollable mode strip above the query remains available for
  direct switching.
  The idle composer is vertically centered, then moves smoothly to the top when a query begins.
  Search modes and scope-specific examples use scrollbar-free horizontal strips whose overlaid edge
  controls appear only when more content exists in that direction; the submit button expands into the
  composer only after a mode is selected. The strips accept horizontal touch input and vertical
  mouse-wheel input. Search text expands to a bounded height before scrolling internally, while note
  editors expand with their content. Search text controls stay at least `1rem` on compact layouts,
  preventing iOS WebView focus from zooming the page while preserving pinch zoom.
- Recent device-local search history opens from its floating control or a rightward swipe from the
  search page's left edge, preserves the selected source scope, and can show the current-session
  result cache immediately while refreshing in the background. The detected request type is presented
  beside extracted facts as a compact category inside the analysis details, together with result
  counts, document count, elapsed time, and search mode. Clicking a result-group header opens the
  full document; opening the full document from the source preview closes the preview first.
- The paper/archive design uses one top-level semantic color palette in light and dark modes, a
  65-character reading measure (`--page-measure`) for questionnaires and document text, and a wider
  board (`--page-board-width`) for card catalogs. Phone keeps one card column except the personal-file
  tile grid, which keeps at least two; the personal-file grid uses five columns from tablet (760px)
  and six on wide desktop, while `--layout-cols` remains two for other tablet layouts and the board
  caps at 72rem so ultrawide screens stay centered
  instead of stretching. Virtualized grids measure their containing block with `ResizeObserver` and chunk
  rows in JS so WindowVirtualizer can still measure height; incomplete final rows use only their
  occupied CSS tracks. Compact cards, controls, result rows,
  responsive spacing, and consistent hover/focus feedback stay shared. Non-reader page headers use the
  shared two-row `Page` layout: navigation and breadcrumbs above the icon/title row and description;
  document readers keep their own chrome. Warm page surfaces share a reusable low-opacity fine
  fractal-grain layer constrained to the page content measure; sticky search/medication
  blurs use the same centered content width. Dark mode swaps those tokens for black-alpha noise with
  multiply blending so the film stays a dark speckle instead of a light wash. Cards and
  text remain untextured. The document uses one
  native page scrollbar without a second application-owned scroller.
- Reusable view components now own confirmation dialogs, horizontal search examples, module cards,
  and module task states; their parent pages retain routing, persistence, and orchestration.
  Shared `Button` and `Switch` primitives use BEM classes with colocated CSS; root theming loads
  `theme.css`, `theme-dark.css`, and `animations.css` before feature styles. Official full documents
  open in `OfficialDocumentReader` with shared `document-reader-chrome.tsx` and
  `document-reader-outline.ts`; user PDFs/OCR stay in `UserDocumentReader`. Opening large official
  documents no longer freezes the main thread on per-chunk regex compilation or full synchronous mount.
- Personal-library previews use the shared `previewExtractor`: supported thumbnails are generated after
  upload/replacement and stored beside the original blob under a stable IndexedDB thumbnail key; old
  documents are backfilled lazily when their cards appear. PDF previews use the configured PDF.js worker.
- The personal library exposes only its maintained virtualized grid and list layouts; the unreachable
  free-position layout and its unused persistence/CSS path have been removed.
- В списочном виде папки используют ту же двухколоночную строку, что и файлы: иконка слева, название
  и метаданные вертикально; различается только тип иконки.
- Файлам и папкам в личной библиотеке можно назначить цвет из общей macOS-подобной палитры;
  выбор сохраняется в IndexedDB и меняет только цвет поверхности файла или иконки папки. Карточки
  папок показывают единый счётчик вложений, включая вложенные папки.
- Personal cards use a responsive three-column sticker board and a focused creation dialog opened
  from a floating add button. Card timelines and dated-record editors use nested note routes; card
  edit/delete actions are compact icon controls. Timeline records render sanitized Markdown previews
  instead of raw markup. Markdown reading and previews use a unified AST renderer with GFM, math,
  and highlight marks; large documents parse in a reusable Worker and offscreen blocks use native
  content-visibility. The note editor is a Milkdown-based WYSIWYG surface (bundled offline in a
  lazy chunk with KaTeX): typing Markdown converts to styled HTML immediately, a Raw Markdown mode
  was removed in favour of a single editable preview, and the formatting toolbar (Phosphor icons:
  headings, bold, italic, bullet/numbered lists, `==highlight==` marks, inline LaTeX `$…$` via
  KaTeX, document mentions, images, voice recording, reminders) reflects the caret state; compact
  editors keep the toolbar on the right in a vertical rail with horizontal group dividers, while
  fullscreen keeps a horizontal toolbar that scrolls on narrow viewports. It opens a selection menu
  for bold/italic/strike/highlight. Enter in
  an empty blockquote lifts the cursor out. Typing `/` opens a keyboard-navigable insert menu for
  reminders, voice notes, attachments, and files. Its fullscreen state is kept as `fullscreen=1` on
  the note hash, so document-reader navigation returns to the same editing mode. The fullscreen editor
  reuses the document-reader chrome and paper, fills the viewport with the lined-paper background down
  to a real bottom margin, shows
  a live reader-styled table of contents (open/close toggle, empty-state hint) that updates as
  headings are inserted and scrolls to them on click, offers in-note search via CSS Custom
  Highlights, and prints the rendered note through the shared print pipeline with its optional record
  title, creation date, 14px Arial body text, and serif headings. Record editors guard
  unsaved drafts, accept attachments of any file type (stored as blobs in IndexedDB with generated
  thumbnails: images, video frames, PDF first pages, HEIC embedded previews; unreadable types offer
  a save-to-device prompt; Markdown attachments open in a sanitized reading view with a raw-source
  toggle; voice recordings capture through MediaRecorder and play back as
  waveforms), and keep editable tags, reminders (edited in a dialog through native-picker trigger fields),
  images, and related sources in distinct blocks. Tags are committed on spaces, commas, and semicolons,
  shown as removable chips, and kept in the note's categories array; record titles are edited from the final breadcrumb or its trailing pencil action. The previous-revision control is enabled only when the stored revision
  differs from the current draft; its review mode is shown inside the editor card with dashed borders,
  disabled text/image inputs, hidden reminders/related sources, and disabled back/delete actions. On
  first launch, an editable colleague card and record introduce the local notes workflow; once removed,
  they stay removed.
- Local-model detection is user-initiated; its CPU probe runs in a Worker and model choices stay
  collapsed until requested.
- The knowledge-base tab opens the document catalog immediately (`#/modules/documents`); there is no
  intermediate overview card screen.
- The document overview exposes five entry cards: medications, norms and calculations, laws and
  regulations, clinical recommendations, and the built-in core. Each card and document row shows
  catalog download weight and, when installed, on-device size. Overview counters name their actual
  entity: clinical collection packs are sections, while reference and regulatory counts come from
  concrete documents listed in the catalog manifest. The bundled medications companion reports its
  on-device size even though the remote catalog entry has no byte estimate. The legacy clinical-pediatrics
  collection is represented by the recommendation sections instead of a duplicate top-level card.
  Drilldown exposes two-column module collections with user-facing release states and inspectable
  document lists, all 21 recommendation sections without an extra reveal step, full-document opening,
  bulk download beside catalog search with a storage-size confirmation, knowledge-pack auto-updates in Settings (preserving the former pause preference), rollback to retained older versions, and nested URLs for
  opened collections and sections. Downloadable overview sections have their own download action;
  bulk and section installs mark every affected card as queued or active, with animation reserved for
  active work. A completed install swaps the mounted search core immediately and refreshes any active
  search query in the background. Leaf catalog download controls are icon-only and use primary accent
  when published; only unpublished rows stay muted.
  Regulatory packs open as a documents sub-route (`#/modules/documents/laws/pediatrics`, alias
  `paediatrics`) with in-page search and the same transparent stuck-chrome blur as other knowledge
  drilldowns, not a catalog dialog. The catalog sticky toolbar hides on that route.
  Single-module collections open directly into the shared responsive document-card list; recommendation
  category cards use the same medication-style grid and opaque removal controls. Official outline clicks
  mount the requested lazy section before scrolling, and pending section batches use a paper-backed spinner.
  PDF text rendering also recovers colon-led, punctuation-terminated item runs as bullet lists without
  changing the stored source text.
- The medications catalog reads medication metadata from document summaries in bounded batches and
  coalesces concurrent summary reads, so direct and navigated catalog routes avoid materializing
  every document's sections/chunks on the main thread. Search defers ranking behind text input,
  caches normalized product fields, and gives trade-name prefixes priority over fuzzy matches in
  other fields.
- Document catalog routes share one route-bounded search field: single-module document collections
  keep back, search, and bulk download in one sticky toolbar, and unavailable document cards can
  install their containing offline pack and open the selected document. The query filters only the
  currently opened collection, category, or catalog page, and the recommendations search remains in
  its sticky route header.
- Medication catalog cards use a responsive two-column layout and live rendering so progressive
  batches populate both columns; its route header uses the shared compact catalog search field.
  Catalog cards open the official document reader (`#/modules/documents/d/<token>`); legacy
  `medications/<registration>` hashes redirect there after catalog lookup. The selected product
  context now renders one compact card with `ТН · МНН`, exact form/strength, and links to its ESKLP
  MNN card, GRLS registration card, and instruction. ESKLP and GRLS rows compose only on exact MNN,
  registration number, normalized trade name, and compatible SMNN; unmatched or multiply matched
  rows remain separate. Allmed text/photo is applied after that merge and filtered to the selected
  normalized trade name.
- The personal notes index has local full-text filtering, and Ctrl/Cmd+F focuses the visible
  search field with the highest stacking order (the field inside the topmost dialog when one is open).
  A second Ctrl/Cmd+F within 700ms does not intercept, so the browser find bar can open.
- Search history and diagnostic help controls share one sticky top toolbar on the search home, with
  the menu on the left, an optional `Доступно обновление` pill of the same 2.5rem height immediately
  to its right, and `?` on the far right. Tapping the pill opens Settings and stores the offered
  version in `localStorage` (`ignoreUpdate`); the pill returns only for a newer version. A green
  dot on the top-left of the Settings tab also marks a waiting application update, and Settings
  contains an update-checker card (current version, check, and apply).
- Search, module-catalog, medication-catalog, and laws-document sticky headers use transparent,
  page-width masked backdrop blur with a subtle grain layer that stays hidden until the header is
  actually stuck. Document reader chrome stays opaque; in-text `h1`–`h6` sticky offsets are measured
  from the real chrome (the paper title is not pinned). On native Android the page itself draws under a
  translucent status bar (`.app-shell--native` has no top desk padding). Page surfaces keep a negative
  `--safe-top` margin so the folder paint sits under the bar, and double `--safe-top` padding so text
  starts below it. Transparent catalog/search chrome stays below the status bar without adding a
  second inset when stuck. Its per-surface blur/grain begins at the viewport top, covers the full
  sticky element, and fades below it through a mask. Official and user document readers use an opaque
  header from `top: 0`, include the inset inside their control padding, and extend
  the folder surface under the floating bottom nav with the same negative bottom margin as other
  full-height page surfaces. The bottom nav is portaled to
  `document.body` and uses only the locked `--nav-safe-bottom` inset (never a flickering
  `--safe-bottom`), so route transitions cannot move it vertically. Page surfaces pin their extra
  bottom clearance to that same locked inset.
  Outgoing root views isolate their fixed overlays below the incoming navigation surface. Hover styles
  use `@media (hover: hover)`.
- Search actions expose only source retrieval and installed tools; generative-model controls are not
  part of the search surface.
- GitHub release links use a rolling `android-latest` APK asset, and the search history drawer shows
  text links to the repository and current Android build at its bottom.
- The document library uses a virtualized full-width list. The embedded core library reuses the
  sticky catalog search (this page only) and a primary «Карта связей» control; the list/map toggle is
  gone there. Catalog collection cards show live document counts and size at the bottom and omit
  empty meta; they do not use pack fractions such as `0/1`. The bundled core card still prefers size
  and adds a count when documents are mounted. «Скачать всё» is scoped to the open page and hides when that page is complete.
  Module cards keep a stable outer size after install (one version, one size chip). In-app and native
  back climb the documents/assessments/calculators tree instead of `history.back()`; an open user
  document returns to `#/modules/documents/user`. Cross-section jumps
  (search → model, document → test) remember an origin and expose a second return control. Document
  outline close animates like open; in-document find lives in the reader header as a surface search
  button on the right, not an accent-filled control. Opening it turns Back into × and replaces the
  rest of chrome with the shared catalog search field plus previous/next, then `1/N` or `0/0` after those
  buttons; × or Escape closes find before leaving the document. Matching is exact by default and
  always runs in a worker when Worker is available; the outline column is table of contents only.
  Find is debounced, stops the spinner when the current query finishes, and does not keep
  scrolling the page after that result is shown. Searching does not hide the rest of the document.
  Catalog search fields use fuzzy matching; hover and focus paint the control wrapper in accent
  green rather than the inner input.
- Allmed reference preparation converts known HTML fragments in medication sections and production
  metadata to readable Markdown while preserving the source SQLite snapshot unchanged.
- Core discovery includes metadata for all 50 schema calculators and 19 assessments from all eight
  tool packs, alongside the two built-in calculators. The mandatory bundled module catalog lists
  each tool before any pack download, including its exact owning pack; `bun run content:catalog:tools`
  regenerates these entries from `content/tool-modules/*.json`. Executable steps and questionnaire
  questions remain in the downloadable packs. Catalog cards and search stay visible without those
  packs; saved install flags alone never mark a missing payload ready. A tool download targets its
  own pack, including tools sharing a section across packs, and loaded definitions replace catalog
  metadata without duplicates. Preview-pack visibility does not change the experimental-install gate.
  Browser QA with tool downloads blocked confirmed both catalogs remain visible; installing a
  psychology card unlocked its pack, and downloading Child–Pugh from the gastroenterology section
  fetched the core-clinical pack while leaving the separate gastroenterology tools uninstalled.
- Assessment tests and medical calculators are grouped into downloadable sections. The assessments
  home search filters specialty cards (hiding empty or unavailable sections while searching) instead of
  replacing the grid with a flat test list; catalog, calculator, and assessment empty queries share
  the binoculars empty state.   Catalog cards show
  what is on the device, calculator catalog search uses the shared icon field and Ctrl/Cmd+F focus
  target, calculator result save-to-note uses the primary button theme, and catalog rows stay content-sized instead of stretching to fill the viewport when only
  one section is present. Section cards show an explicit disabled state for unavailable tools and allow individual
  calculator downloads that install immediately with toast feedback, direct tool routes explain which section
  is missing, in-app back from an open calculator returns to its section catalog, open tests and
  calculators use Kobalte breadcrumbs (`Тесты` / specialty / section, `Калькуляторы` / section) instead
  of the old “скачан на устройство” kicker, and
  installed tools keep specialty section cards open dedicated sub-routes containing the full grid, and
  every assessment category shipped in the tool modules has a matching routable section. Assessment
  and calculator section headers share the `Page` component, including theme-aware descriptions.
  Printed
  assessments and calculator results link only to the public MiniMed app; assessment printouts omit
  internal limitation/version lines, and note-linked results place the note card title beside the date.
  The temperament result uses the same four-quadrant target on screen and in print, with the
  respondent marked by extraversion and emotional-stability scores. Completed assessment results can
  print either alone or together with every question and selected answer.
  Pasted document links with `?o=` (or legacy `dialog` + `section`) migrate to
  `#/modules/documents/d/<token>` on load. Legacy `#/read/…` hashes migrate the same way.
  Schema calculators support staged inputs via `step`/`stepRequired`; the fluids section includes a
  two-stage paediatric ORS calculator that adds measured vomiting and stool episodes to the base plan.
  Installed tools keep their offline-use state across reloads. Incomplete assessment attempts are
  also stored in the existing device-local results store, restored by their history entry with an
  `incomplete` tag and answered-count, and replaced by the completed result when submitted. Leaving
  a questionnaire and opening the same test again restores the latest incomplete draft. The
  questionnaire next control stacks under scroll-to-top on long forms, keeps its progress ring
  anchored to itself when other floating controls appear, scrolls to the next unanswered question
  with a brief highlight, and the remaining-count badge
  animates on change. Response cards hide the radio; the score sits as a bold background numeral,
  the answer is centered in body text, and long labels scroll inside the card. When a saved return destination exists, questionnaire and missing-test screens
  show one back control that opens a destination chooser (catalog vs saved route). On mobile the
  chooser sheet can be full-screen; the two destination cards stay about 2.5–3rem tall and do not
  stretch with the sheet. Questionnaire URLs
  are `#/assessments/{specialty}/{slug}` so Back returns to the
  owning section rather than the assessments root; a test may later appear in several sections via tags.
  Runtime TypeScript keeps two dependency-free tools in `CALCULATOR_REGISTRY`: `unit-conversion` and
  the adult-alpha `ecg-photo-caliper`. `minimed.calculator.pediatric-feeding-plan` is a declarative schema in the bundled
  pediatrics tool pack and covers birth to 35.9 months. It calculates daily and per-feed energy/volume,
  derives mixed-feeding supplement from measured breast-milk intake, supports explicit food exclusions
  and allergy alternatives, and can add a seven-day complementary-food introduction calendar. Its
  primary section is `pediatrics`; declarative section tags also list the same schema in `fluids`
  without duplicating the calculator definition. Tool-pack section membership uses the primary
  category plus these tags. Published local tool packs are reconciled by module id and version, so
  an installed older pack is upgraded instead of hiding newly added schemas.
  result surface is the same compact ration that prints as one A4 page; formula/source panels are hidden
  for this patient handout, and the caregiver emoji stays inside the bottom-right page boundary. The
  calculation-history list resolves saved ids and legacy slugs through the currently loaded registry,
  so downloaded schema tools are labelled by calculator title after their pack becomes ready.
  The
  ECG tool imports an image without uploading it, uses a fixed
  50 мм/с and 10 мм/мВ profile (1 мм = 20 мс), calibrates five large grid cells (25 мм) from two
  points, and converts manual RR/P/PR/QRS/QT calipers into milliseconds, heart rate, and
  Bazett/Fridericia/Framingham QTc. After explicit confirmation of age 18+, the 50 мм/с and 10 мм/мВ profile with all 12 leads,
  a suitable horizontal image, and calibration, its
  dependency-free rule layer reports measured rate/interval features with threshold evidence and,
  when the clinician explicitly marks every required lead-level morphology criterion, an
  AHA/ACCF/HRS-compatible hypothesis of a complete right or left bundle-branch-block pattern;
  missing measurements are listed explicitly and cannot produce a normal verdict. Its manual view supports
  button/two-finger zoom plus draggable interval boundaries and ranges; file drag-and-drop is disabled.
  It warns on sub-1200×600 or portrait images. Before patient input, the upload workspace shows a
  public-domain 12-lead ECG photo as a framing example; its printed 25 мм/с profile is explicitly
  distinguished from the tool's required 50 мм/с profile.
  Settings presents trusted ECG modules instead of a ZIP picker. The tool offers one install-all
  action with an expandable module breakdown and installs the Open ECG
  Digitizer segmentation model from the `models-preview-1` release. The 19.1 MB q8 bundle is
  downloaded through the CORS-safe Pages/DEV
  mirror and resumable retry layer, verified by exact size and SHA-256, validated, and activated in
  an atomic device-local cache. The ECG tool can then run local ONNX/WASM segmentation, distinguish
  the supported 12×1 layout from the legacy 3×4+1R review path, and report coverage plus RR/heart
  rate. The browser postprocessor mirrors the upstream sparse-probability normalization, crops page
  margins from the model's own grid mask, and adds a narrowly gated blue-ink trace channel when a
  coloured ECG curve is clearly separable from the paper grid. Selecting a photo starts this
  extraction automatically when the digitizer is installed; installing it while a photo is retained
  starts the pending extraction after returning. Upload opens the local extraction progress dialog
  automatically. A usable result offers one action to accept the RR/heart-rate draft and continue,
  but keeps that action disabled unless the extractor identified 12×1 and the user confirms that the
  source itself states 50 mm/s and 10 mm/mV; clearing the confirmation removes the automatic draft
  from the numeric form;
  `review`, `failed`, and runtime-error outcomes open the numbered manual calibration/interval
  workflow with measurement instructions. Closing that workflow exposes the numeric calculation and
  diagnostic-hypothesis step. The manual viewer can toggle between the source and locally rectified
  preview after the four paper corners are marked; switching views rescales the existing calibration
  and interval coordinates instead of erasing the clinician's work. A repeatable browser regression
  installs both published packs, sends the strongly blurred non-patient fixture through the rejected
  automatic path, opens the manual workflow, draws calibration and RR, verifies that RR/heart rate and
  completion marks survive both view switches, and confirms no page-level horizontal overflow at
  390×844. After that first run it disables the browser context network and repeats extraction from
  the installed local pack successfully. Automatic extraction also returns the normalized
  grid region; the app creates a device-local cropped preview from it and makes that image the primary
  workspace without changing the source file. A separate top notice states the supported
  12-lead 12×1, 50 мм/с, 10 мм/мВ profile before upload. The untouched source and extracted curves open
  from separate actions in overlay dialogs.
  Links from both ECG model notices remember the tool route, and Settings exposes a working return
  control. Automatic RR/heart rate stay a
  visible draft until the clinician explicitly accepts them; review/failed results never enter the
  rule layer, and manual calipers remain authoritative.
  A `usable` extraction also renders all 12 waveforms in mV with heuristic Q/R/S/T markers.
  A separate explicit action copies the resulting 24 amplitude drafts into the editable numeric
  form; `review`/`failed` results offer no amplitude transfer, and selecting another photo clears
  age, measurements and prior estimates before the next extraction. These one-complex markers are a
  review aid rather than validated delineation and cannot start a diagnostic estimate by themselves.
  A separate optional 0.26 MB adult numeric pack is selected and downloaded from the same settings
  section. It uses 30 clinician-confirmed intervals/amplitudes in ms/mV, blocks incomplete input and
  ages below 18, and reports calibrated `NORM`, `MI`, `STTC`, `CD`, and `HYP` hypotheses with a
  per-class abstention zone. The numeric form works without a photo, starts with collapsed sections,
  and can explicitly copy the six values available from manual calipers; the framing example prefills
  only values printed or directly derivable from its header. Every manual field has a compact help
  dialog with a marked ECG fragment, the target feature, measurement method and input example. The
  form never fills missing amplitudes with medians. An exact TypeScript replay of the published
  `2026.2` pack on 2,130 complete in-range adult PTB-XL fold-10 records measured macro-AUC 0.913,
  Brier 0.090, ECE 0.025 and 93.7% class-record coverage, but also 403/1,740 (23.2%) confident
  false-negative pathology labels. A local, unpublished `2026.3` candidate therefore keeps the same
  calibrated HGB probabilities and positive cutoffs but uses per-class negative cutoffs selected only
  on validation fold 9. On untouched fold 10 it reduced confident pathology false negatives to
  92/1,740 (5.3%), with 65.6% pathology coverage and 71.2% overall coverage. Its format-version-2
  parser and compatibility with the published version-1 format have focused tests. The candidate ZIP
  is 263,321 bytes with SHA-256
  `814f7ed2ff6acb1af3c44edbca11b8f29cd8b358bcb72d6c7c14a5acd8429010`; selection and runtime
  share the same inclusive negative boundary. It is not in the catalog
  because release access and external end-to-end validation are still absent. Diagnostic
  image CNNs remain absent from the runtime and in research documentation only. Model weights remain
  outside Git and the APK. Automatic extraction now also runs a local document-image quality gate
  before a result can enter the Solver. It detects and localizes blocking blur, glare, and missing
  calibration plus an informational cropped-paper warning; blocking findings downgrade an otherwise
  `usable` extraction to `review` and are drawn over the rectified primary image. The same findings
  appear as accessible text in the extraction dialog and route the user to manual review. Focused
  deterministic tests cover a sharp calibrated sheet and each defect class. Browser QA on a
  localized-glare case passed at 1440×1000 and 390×844; screenshots are stored as
  `output/playwright/ecg-qc-glare-desktop.png` and
  `output/playwright/ecg-qc-glare-mobile.png` with SHA-256
  `71ab16c4c05f9103faed46570cd5593c903f4523372bae5c7c2b09a0aa787b15` and
  `2f063989ea62f85180f6d4122c6dd290c3cf1ad286bed11ce3141d8306d9ed0c`.
  These are conservative image heuristics, not evidence that a source is a clinically valid ECG;
  format confirmation and lead/coverage gates remain independent. The separate ECG
  waveform review now delineates optional P/PR/QRS/ST/QT ranges per lead at 100 Hz, but only QRS is
  exported as an editable automatic interval: it requires a `usable` 12×1 result and agreement from
  at least eight distinct standard leads. The preliminary 20-record check has been superseded by
  disjoint 100-record adult PTB-XL fold-9 validation and fold-10 test cohorts with complete PTB-XL+
  12SL global measurements. Median local QRS durations systematically underestimated the global
  interval; selecting the upper quartile on validation reduced QRS MAE from 13.25 to 11.79 ms. The
  same fixed choice reduced test MAE from 16.50 to 11.96 ms at unchanged 48% coverage; 87.5% of the
  48 returned test values were within 20 ms and 97.9% within 40 ms. QT improved from 35.89 to
  27.33 ms MAE but reached only 36% test coverage, while P/PR remained too sparse and inaccurate.
  Therefore P, PR, QT and QTc remain visual review aids and are not copied into the Solver. On the
  same ideal digital test signals, the 24 amplitude drafts had macro MAE 0.123 mV, median absolute
  error 0.055 mV, macro Pearson r 0.713, and 73.4% were within 0.1 mV; weak Q/S and inverted-lead
  features prevent treating them as confirmed measurements. They still require explicit clinician
  review and the final all-measurement confirmation. The external validation and test reports have
  SHA-256 `0a4ad4a7f7675cf80b3ee97ee2dcb0df5051baa4a2bb6c7fc3ce81c6e8d04eae` and
  `57134dcef0362df06b507f539e1bd3891e1bfe42ae42f9f2eeedd351ef8c1584`. Loading a patient photo
  now remounts the numeric form rather than retaining the framing example: browser regression
  confirmed blank age/axis and `0/6` intervals after upload, while the example remains prefilled
  before upload. Patient routing now uses one calendar source of truth: date of birth plus ECG date,
  calculated without local-time conversion into exact age in days, full years, and one of the eleven
  pediatric groups or the adult `18+` group. The former independent `18+` checkbox has been removed.
  Adult interval rules, numeric rules, HGB estimates, and cross-checks are hard-gated to the adult
  route. For patients under 18 the same photo QC, digitization, and editable measurements remain
  available, but the adult Solver is not called; after clinician confirmation the UI can show only
  the sourced AHA/ACCF/HRS QRS reference boundary (`90 ms` below age four, `100 ms` from age four
  through fifteen), explicitly abstaining from inventing a threshold for the 16–17 transition group.
  Five focused calendar tests cover leap day, invalid/reversed/over-120 dates, every group boundary,
  the 18th birthday, both QRS boundaries, and transitional abstention. Browser QA confirmed the adult
  and pediatric states, absence of adult findings in the pediatric route, a disabled adult estimate
  action, and no horizontal overflow at 1280 px or 390 px. The separate ECG
  training-manifest preflight now validates the fixed
  12-lead 12×1, 50 mm/s, 10 mm/mV profile, source revision/license/rights, diagnostic ground truth,
  exact pediatric age, patient/base-ECG-disjoint splits, and test-only placement of real-phone records;
  it also reports deterministic coverage by split, source, cohort, input kind, and pediatric age group.
  When `age_days` is available, a conservative `6575`-day boundary prevents a day-only record from
  being promoted to adult before adulthood is unambiguous. A separate strict adult GPU gate requires
  non-empty train/calibration/validation/test splits, signal training data, a
  synthetic render outside test, an immutable real-phone test holdout, pinned source revisions,
  lowercase SHA-256 for every render/phone artifact, and phone coverage of every adult target label.
  Current source-only manifests intentionally fail this gate, so H200 rental remains unauthorized.
  The existing 49-case ECG image dataset
  remains a smoke fixture and is not promoted to training or clinical-validation evidence. Its fixed
  final browser regression completed all 49 cases in four clean-browser chunks: 11 were internally
  `usable`, 33 required review, and five failed, versus 12/32/5 before the 12×1 safety gate. RR was
  available in 37 cases, mean rhythm coverage was 79.1%, and mean lead coverage was 9.24 of 12. All
  49 were correctly kept in the legacy 3×4+1R layout, so even the 11 internally usable extractions
  could not enter the fixed-profile Solver. A continuous 49-case browser session stalled at case 36,
  while the same case and all bounded chunks completed in clean browsers; long-session worker-memory
  accumulation remains a benchmark/runtime stress issue rather than a reason to increase the timeout.
  Most classification images use an unsupported 25 mm/s profile, so their doubled heart
  rates are a format-gating regression rather than accuracy evidence. On two external synthetic 50 mm/s
  renders from PTB-XL records, RR differed from an independent waveform oracle by 20 and 10 ms, while
  only 6 and 8 of 12 leads were extracted; both therefore remained safely in `review`. An immutable
  standard-layout 12×1 render of PTB-XL record 00003 initially reproduced the same failure mode as the
  previous 3×4-only path: 7/12 leads, 6% lead-II coverage, and no RR. After 12-row detection plus the
  blue-ink fallback it produced 12/12 leads, 97% lead-II coverage, RR 940 ms, and heart rate 64/min,
  exactly matching the independent waveform oracle; the browser result is stored outside the repo as
  `/tmp/minimed-ecg-12x1-50mm-blue-ink-result-20260901.json` with SHA-256
  `a33abc6a8758818014cd76f89a5c28d01a279fc41210c816157e504cce114e40`. The official full Python
  Open ECG Digitizer pipeline produced no finite lead samples on that same coloured render, so the
  successful result is specific to MiniMed's explicit colour fallback rather than evidence of broad
  pretrained-model coverage. The first three deterministic phone-like variants added perspective,
  illumination gradients, blur, and JPEG compression but contained no calibration pulse. The quality
  gate therefore correctly changed all three from the previously reported `usable` state to `review`;
  the corrected output has SHA-256
  `2202970c36ff7506a531d81a9dc93d3e3ae104c5bee665841344fc62d2479778`.
  A replacement synthetic set adds a visible pulse to every row before applying the phone-like
  transformations. Its mild and medium variants remained 12/12 `usable`, with 96–97% lead-II coverage,
  RR 980/960 ms, and heart rate 61/63 per minute; the harder blur/JPEG variant retained 12/12 and 98%
  coverage but safely fell to `review` because calibration was no longer reliable. The output has
  SHA-256 `d7824dccdf285d9ccaa0f2a47a97c40d53466be017c36e9cad5a20296ba28ad4`.
  A separate negative set produced `failed` plus localized blur for a strongly blurred sheet, and
  `review` plus localized glare for an otherwise readable sheet; neither could feed the Solver. Its
  output has SHA-256 `ffe407dd6c576a9f91110c99dce501dc3e84f85b3e2d216833afbceb6da909ef`.
  The browser benchmark now records stable issue codes rather than relying on Russian display text,
  validates its untrusted local manifest/result JSON, and has a CLI evaluator that fails on an exact
  quality mismatch, a missing expected defect, a missing expected case, or any forbidden promotion to
  `usable`. New runs also record layout, detected-lead count, rhythm coverage, duration, RR and heart
  rate as validated numeric fields. The evaluator reports quality/defect distributions, mean lead and
  rhythm coverage, RR/heart-rate availability, and MAE wherever the immutable manifest declares an
  independent RR or heart-rate reference; omitting a declared reference measurement is a hard failure.
  Setting `ECG_BENCHMARK_STRICT_REAL_PHONE=1` now turns the same browser runner into a holdout gate:
  the manifest must be test-only, fixed to 12×1/50 mm/s/10 mm/mV, carry pinned revision and
  license/rights metadata, and identify every photo as a real-phone capture with base-ECG ID,
  device/condition, explicit patient-data status, unique image/reference-signal SHA-256, and an
  independent RR or heart-rate reference. Relative-path checks prevent fixtures escaping the holdout
  directory, and both image and reference bytes are hashed before browser execution. This gate can
  validate a no-patient printed-synthetic digitization set; the separate clinical gate additionally
  requires classification labels, patient-data provenance, and patient IDs and therefore remains
  unavailable without a consented or suitably licensed clinical source.
  A deterministic stdlib-only capture-pack generator now creates physically printable A4-landscape
  pages and reference signals without patient data. The first external pack contains 60 five-second
  12×1 pages at 50 mm/s and 10 mm/mV, split 30 dev/30 immutable-test before rendering, with a 250 mm
  time axis, 1 mV calibration pulses, per-page/reference SHA-256, and planned filenames for two phone
  devices. It is stored at `/tmp/minimed-ecg-phone-capture-pack-v1-20260901` (44 MB); the capture-plan
  SHA-256 is `f52e2e344524496a50f505a0e4ef9e6497e4b302b04212e8e9fc9b302ff2c9da` and the printable HTML
  SHA-256 is `fb0772edf9a98be7ffd4c1ccafca288380a40ab1851e75f524f61d97f1584775`.
  Browser rendering was visually checked on `synthetic-001`; its screenshot SHA-256 is
  `e834e3414207a8dec19c845685e02a90f1bccff7862e590c67b0b7eda50267ed`. These pages are not phone
  captures until they are printed at 100% and photographed, and they can validate only capture/QC and
  digitization—not diagnostic sensitivity, specificity, or CNN integration.
  The immutable-test half was also rasterized outside the repository into 30 clean 1782×1260 PNG
  controls and run through the production browser/WASM path. The first run accepted 24/30; the other
  six all inferred an impossible 17.8–18.1 second duration because waveform energy contaminated the
  grid-period estimate. The shared digitizer now independently estimates pixels/mm from the repeated
  1 mV calibration pulses in at least eight 12×1 rows and uses that scale only when the primary grid
  estimate implies a duration outside 4–12 seconds. The final run accepted 30/30 with all 12 leads,
  mean rhythm coverage 99.3%, RR MAE 15.73 ms, heart-rate MAE 1.37/min, 24/30 RR values within 20 ms,
  and a 44 ms maximum error. The external manifest SHA-256 is
  `2119b60dc9b5c8894cfe33c7828bea80221eeac992a553c144c23f4a00972240`; the final result SHA-256 is
  `77720cc77fff3c21564aae2e5f57dd07a051fde1fd97c55a99f78c27e12b5b54`. This is a clean synthetic
  digital baseline, not phone-camera evidence, and does not authorize a CNN or H200 run.
  A focused browser success-path regression now takes `synthetic-031` through local installation,
  12/12 `usable` extraction, explicit profile confirmation, and draft acceptance. It verifies that RR,
  QRS, and all 24 amplitude drafts appear in the editable numeric form while the all-measurement
  confirmation remains clear and the Solver action remains disabled. The same installed pack reruns
  successfully with the browser offline, and the accepted/manual-review state has no page-level
  horizontal overflow at 390×844. The same complete online/offline test also passed the calibrated
  medium phone-like JPEG with perspective and blur (SHA-256
  `d942cbd62cb3962d697b5de4400187c825f464fec1780d3012bec56058861fdb`). This is end-to-end
  workflow evidence on generated sources, not a substitute for the required physical real-phone
  holdout.
  Both the three-case calibrated set and the two-case blur/glare set passed their declared
  expectations; their external manifest SHA-256 values are
  `1e5db76b4713c0e91404776c8a5fc6232a153cc209c035a139b149847328a6c6` and
  `c3dcd9d199a6c35053cb8b14397cbbb89fff6003255eb4d3e59126c4f3513ac6`.
  These outputs remain synthetic, not a real-phone holdout. The three existing PM-ECG-ID phone captures stayed in the legacy 3×4+1R
  `review` path at 9/12 leads and 81–83% rhythm coverage, demonstrating that the blue fallback did not
  silently promote those unrelated photos; that regression output has SHA-256
  `4b0e9d2639da979d6a5dff4c2037fe7aad725eaf82a9538afc9a4a2f890c9194`. Three additional
  CRC-verified PM-ECG-ID iPhone, Samsung, and Doogee photos use a true 12-row layout but explicitly
  state the unsupported 25 mm/s speed. After calibration-pulse layout detection independent of trace
  colour, all three still stayed in `review` and none could feed the Solver; the newest negative-control
  output is stored outside the repo with SHA-256
  `1edb5336813e60f06d4c355e393ccaeb3ea41fe598d5ce46484d0b3008c54a30`.
  A range-only inventory of the same 33.9 GB ZIP found 27 such 12×1 phone photos derived from only
  nine PTB-XL ECGs, all at 25 mm/s. The separate Ahus ECG Image Database has real iPhone/OnePlus
  captures at 50 mm/s and 10 mm/mV for 266 ECGs, but each 12-lead recording is split across two
  pages rather than the supported single 12×1 page. PM-ECG-ID therefore remains a speed-negative
  control and Ahus a future paired-page benchmark, not a positive fixed-profile holdout.
  A third public negative source is the CC BY 4.0 Figshare `Real world ECG image dataset` v3. Its
  published `2_photo` folder contains complete 12×1 paper photographs, but every inspected header
  explicitly states 25.0 mm/s, masks gain as `XX mm/mV`, and does not report the capture device. Six
  diagnosis-diverse cases (AF, AV block, LBBB, sinus rhythm, RBBB, and sinus bradycardia) were run
  through the browser/WASM path: all six remained `review`, none was `usable`, mean accepted-lead
  count was 5.67/12, and mean rhythm coverage was 74.9%. The first run falsely joined independent
  white header/margin blocks into glare regions. Glare detection now keeps only connected internal
  bright components surrounded by ECG-grid tint or dense structure; the focused synthetic regression
  and all six photographs now report no glare, while every photograph still stays in `review` for
  incomplete leads or rhythm-strip evidence. The three RR drafts illustrate the expected approximately
  doubled-rate failure if a 25 mm/s source were falsely treated as 50 mm/s, so explicit profile
  confirmation remains a safety gate. The external manifest and final result SHA-256 values are
  `adbf80385af009767981d25156012bc7edff8f56a7c762527ee16d46864379c2` and
  `882ce62cecc774a787f1f40b67820e820abbeceebc85dfa519abceb68ded6811`; the source archive SHA-256
  is `34b02f3d29ec8182c599e15e24d868382f43f97d33ae65a49a240890ef2da0ba`. Because speed, gain, and
  device provenance fail the fixed-profile contract, this set is not the required positive holdout.
  The Apache-2.0 Open ECG Digitizer visual-abstract asset at revision
  `97a15087d4abcda843da8c58ee74b1d8f47e6f9a` provides the complementary real-phone control: its
  paper explicitly states 50 mm/s and 10 mm/mV, but it is page 2/2 with only V1-V6. MiniMed recovered
  the printed 55/min as 55/min but kept the image in `review` and out of the Solver because the
  12-lead layout was incomplete; the newest calibration-aware output SHA-256 is
  `626b92b10ca2d367e6bb3bddf81315e5e1393d1bb0379ff3351f2dd9bd47f3bc`. An immutable
  50 mm/s real-phone holdout is still absent, so neither image-CNN training nor GPU rental is
  authorized yet. A range-only preflight avoided downloading all 33.9 GB of PM-ECG-ID and extracted
  one CRC-verified 3×4+1R paper photo of the same base ECG from iPhone, Samsung, and Doogee captures.
  Grid-ROI cropping raised all three to 9/12 leads and 81–83% rhythm coverage, versus 9/12 and 75% on
  iPhone and 6/12 and 72% on Samsung/Doogee. It also produced RR drafts, but every case still safely
  required review because repeated lead II disagreed and the recording speed is not printed; these
  remain layout/QC evidence rather than the required fixed-profile holdout. A
  metadata-only builder now reproduces the official PhysioNet Challenge 2024 PTB-XL/PTB-XL+ label
  mapping, filters the initial branch to adults, and emits a validated external manifest atomically.
  On checksum-matched PTB-XL 1.0.3 and PTB-XL+ 1.0.1 metadata it retained 21,382 labelled adult ECGs
  with patient-disjoint folds 1–8/9/10 mapped to 17,075 train, 2,148 validation, and 2,159 test
  records; its per-class counts match an independent standard-library oracle. The current fixed-profile
  rebuild is `/tmp/minimed-ptb-xl-adult-training-manifest-v2-20260901.json`, SHA-256
  `23e95d1e1e94ba832679ffcd6c09bb3bb46975116e841da48e5d951d49fd4360`. The strict GPU gate rejects
  it at the first missing requirement (`calibration`); its summary also contains zero renders and zero
  real-phone records. It is therefore not evidence for image-CNN training or integration. A second metadata-only builder now covers
  the checksum-matched ZZU-pECG v1 pediatric source without translating its AHA/CHN/ICD-10 codes into
  adult labels. It retained all 12,334 twelve-lead records from 10,355 children/patients as 9,809
  train, 1,270 validation, and 1,255 test records, excluded 1,856 nine-lead records, and reproduced
  the patient split with an independent standard-library oracle with zero patient leakage. All
  pediatric diagnostic ground truth remains empty; exact age in days and source-native codes are
  preserved only for a future age-specific reference branch. The raw 4 GB waveforms were not
  downloaded, and ZZU-pECG contains neither phone photos nor ages 15–17, so this manifest is not
  evidence for pediatric diagnosis, image-CNN training, or full under-18 coverage. Every other calculator
  schema and all assessments live in `content/tool-modules/*.json`, build to
  `apps/app/public/content/modules/minimed-tools-*.db`, and are auto-installed from those bundled
  artifacts in local/Android builds (`VITE_USE_LOCAL_MODULE_ARTIFACTS`, on by default); Pages resolves
  release artifacts through the CORS-safe remote mirror. Once a tool pack is on the device, every
  questionnaire and calculator in it is available immediately — there is no second per-item
  download/remove toggle. Remote-artifact QA can explicitly disable the local URL rewrite and still
  install a pack through `ContentModuleRuntime.install`. Section-to-module mapping is in
  `CALCULATOR_SECTION_MODULE_IDS` and `ASSESSMENT_SECTION_MODULE_IDS`. Published packs:
  `minimed.tools.core-clinical.ru` preview.2 (the original 17 renal/emergency/cardiology/hepatology/
  hematology calculators plus BSA, CKD-EPI 2021, Schwartz 2009, maintenance fluids, and paediatric
  ORS); `minimed.tools.obstetrics-gynecology.ru` preview.3 (full ObCalc set plus Apgar, EPDS, Ferriman–Gallwey,
  and Whooley); `minimed.tools.psychology.ru` preview.2 (Braverman, egogram, PAEI, team roles,
  temperament, and SHAS);
  plus gastroenterology preview.2, neonatology, pediatrics, and emergency, plus the separate preview
  `minimed.tools.pediatrics-growth.ru` 0.3.0 pack. Its ВОЗ calculator calculates filled growth, mass, BMI, head and
  mid-upper-arm circumference indicators from embedded ВОЗ 0–5 and 5–19 LMS tables, emits z-scores,
  percentiles and charts, prints through the shared calculator result path, and records both source
  measurements and derived indicators into the selected patient's longitudinal observations using
  the entered measurement date. Schema inputs may expose compact label tooltips and may remain
  disabled until an earlier prerequisite input is filled; anthropometry uses this to gate all fields
  after date of birth and to explain method and indicator-specific size ranges. Required inputs and
  schema-declared `atLeastOne` groups are marked in the form, and Calculate remains disabled until
  those constraints are satisfied. The form accepts
  body mass in whole grams, converts it to kilograms for ВОЗ calculations and longitudinal storage,
  and converts stored patient kilograms back to grams when prefilling the field. Age boundaries in
  visible help use years/months rather than implementation day offsets, and tooltips dismiss on an
  outside pointer action. Generic schema
  visuals support bounded XY sampling, labelled axes, semantic line/point styles, and preserved chart
  titles; the growth pack uses these for percentile curves with a separate child point. Its aliases cover
  «z-score для детей», «перцентили детей»,
  «детский рост» and «детский вес». Official WHO standards, WHO Anthro/AnthroPlus tools, and raw-table
  provenance links are visible from the calculator page before data entry as well as from the saved
  result. While Experimental modules are enabled, the calculator catalog and the anthropometry
  section name this optional pack and install it directly without routing through the knowledge-base
  catalog. The same pack now contains a separate AAP 2017 office-BP calculator for ages 1–17: it uses
  completed calendar age, both mean SBP/DBP values and the nearest published height column below age
  13, switches to fixed adolescent thresholds on the 13th birthday, and records height and BP in the
  patient timeline. Its transcribed tables remain preview/experimental and require an AAP permissions
  decision before a public release. Fenton 2025 remains blocked because the current LMS dataset is
  distributed by University of Calgary on request without a public redistribution license.
  EPDS `1.1.0` uses V. V. Golubovich's 2003 Russian adaptation: all ten prompts and answers match
  [instruction 158–1203](https://med.by/methods/pdf/full/158-1203.pdf), appendix 2, pp. 7–8;
  item order, IDs and the 0–30 key are preserved. Interpretation now cites the source's 8–9-point
  screening guide (pp. 3–4), flags scores from its lower bound of 8 for clinical assessment,
  and does not invent an individual probability or a diagnostic verdict from that guide.
  Any positive answer to item 10 still prompts immediate safety assessment regardless of total.
  Provenance distinguishes the original Cox scale, Golubovich text, Psytests listing and COPE
  safety guidance; the bundled SQLite module and catalog checksums are rebuilt from authored JSON.
  SHAS `1.0.0` is available under «Психиатрия → Астенические состояния» from the shared psychology
  pack. Its 30 original prompts and four response options come from Shabrov et al. (2022),
  appendix 1, p. 60, published under CC BY 4.0; the supplied Markdown paraphrases are not the form.
  The direct 30–120 sum and all four inclusive bands (30–50, 51–75, 76–100, 101–120) use existing
  declarative scoring and persist source-backed scale grades, not diagnoses. The authored JSON,
  rebuilt SQLite artifact and catalog checksums agree; boundary and browser checks cover the new form.
  Assessment catalog counters use i18n plural messages selected by the active locale's
  `Intl.PluralRules` (Russian «тест / теста / тестов»), including counts shown on section cards.
  Assessment score bands for
  downloaded questionnaires come from JSON `interpretations` (score bands or declarative `when`
  expressions), not hardcoded engine branches. Questionnaire and calculator graphs share the JSON
  `visuals` contract and the Chart.js renderer; the temperament profile declares its scatter point,
  axes, endpoint labels, quadrants, rings, caption, and size in the psychology module schema. Hadlock
  gestational age by biometry (`obstetric-ga-biometry`) is a
  CalculatorSchema in `minimed.tools.obstetrics-gynecology.ru` preview.2; the expression language has
  `present(name)` so optional biometric inputs can be averaged. Search query analysis still runs in a
  Web Worker after downloaded modules are installed (`createBrowserWorkerCore` remounts IndexedDB packs).
  Intra-route calculator, assessment, and document-catalog hash changes (catalog → collection,
  section, or tool) reset window scroll to top; root-tab scroll restore is unchanged. Unit tests
  evaluate every tool-module calculator schema across each input’s domain and assert the engine never
  throws.
- Locally authored questionnaires are standalone `.minimed-questionnaire` JSON files in the protected
  «Мои файлы / Опросники» system folder. The assessments home opens «Мои опросники» as its first
  notepad card; its local catalog puts search above the page heading, uses the primary theme for
  import and the `+` icon beside search for creation, pluralizes question counts, and writes each edit as a local draft;
  it supports explanatory text, weighted choices, and image groups
  rendered as a two-row horizontal carousel with a lightbox. Files export/import through the platform
  share/download flow, a file rename updates the questionnaire title in its JSON payload, and blank
  forms print on A4 through `PrintManager`. A local Whooley example is seeded with its source notice;
  it remains explicitly a screening example rather than a diagnosis.
- Calculator and questionnaire definitions in the bundled tool modules now use contract schema v2.
  Each declares evaluation status/provenance and stable observation mappings; deterministic numeric
  outputs can be recorded as longitudinal patient observations without guessing a reference range.
- Patient cards are a separate local domain from ordinary notes. On Android/iOS, IndexedDB stores
  `PatientProfile`, dated `ClinicalEpisode`, immutable tool/manual/laboratory/medication
  `PatientEvent` records, and `PatientObservation` snapshots under AES-256-GCM with a data key wrapped
  transparently by Android Keystore or iOS Keychain. The browser offers a plaintext IndexedDB mode
  only after an explicit warning; no application password or biometric prompt is used. Patient
  selectors use an explicit `patientId`, and locked patient data
  is excluded from ordinary history/search/notifications; while the vault is unlocked, patient
  profiles appear in the personal part of the global search. Calculators and questionnaires expose one
  searchable patient/case combobox: free text stays unbound, while locked or unmatched search offers
  the patient unlock action. The patient route includes manual events,
  explicitly plaintext portable backup/import, cascading deletion, and `#/notes/patients/<id>/dynamics`
  with Chart.js series and source tables. The patient index has a safe-area-aware sticky header,
  local profile search, and a themed primary create action with backup/destructive actions grouped
  in its header menu. Calculator and assessment results can target the selected
  open episode or an explicitly standalone event; immutable source title and URL/document targets
  are captured with each tool result. Source links are restricted to HTTP(S) at the tool-contract and
  backup boundaries, and patient surfaces render only those safe targets. Binding a
  questionnaire to a patient removes its ordinary local draft and clears answers before protected
  continuation; unbinding clears protected answers as well. Dynamics opens a source's original
  episode through the patient route and selects its examination card; a closed historical episode
  remains viewable but is never used as the target for a new event. Manual and laboratory
  observations can be corrected through a revision action, including after the linked episode is
  closed; laboratory revisions retain their kind and report range while tool results remain immutable.
  Shared vault mutations are serialized, and locked patient surfaces acknowledge state removal before
  the privacy curtain is released. The prior DEV vault database is dropped without migration.
- Content-module downloads use retry/backoff and resumable partial bytes. Up to three document
  installs run concurrently while additional documents remain queued. Content-pack progress is a pie
  on the top-right of the Settings icon while a pack is queued, transferring, or installing; failed or
  idle packs hide that pie. The manager lives at `#/settings/downloads` rather than a
  floating pill. A single document runtime
  survives catalog refreshes; transient failures release their slot before an automatic retry so one
  broken source cannot starve the queue. The Settings «Experimental» toggle consistently unlocks
  `preview` packs across card install buttons, bulk download counts, category installs, and download
  retry (shared `isModuleReleased` predicate); preview packs still need published artifacts to be
  installable. Stale superseded tool-pack databases (`minimed-tools-*-preview.1` files superseded by
  `preview.2`) are no longer shipped in `public/content/modules`.
- The knowledge graph remains interactive during hover/focus and visually distinguishes clinical,
  medication, legal, and personal-note sources; its canvas supports wheel zoom, pan, and two-finger
  pinch zoom on touch devices. The embedded graph dialog is 95dvh tall.
- Generative local-model selection is hidden from the product UI; its catalog, runtimes, and tests
  remain research infrastructure. Task-specific installers remain product features: ECG digitizer,
  ECG numeric diagnostic, and speech-recognition models are still downloadable from Settings and
  run locally. Settings sections use paper-sheet cards with headed icons. The downloads card is a whole-card link to
  `#/settings/downloads`; hover uses the accent border, and an idle card reads «Тут будут ваши загрузки».
- Device preferences in Settings persist vibration on/off (default on), remember-search-mode
  (default off), floating windows (default off), Experimental modules (default on), and zen-pack UI
  sound volume (default 20%; zero mutes and stops playback).
  The Settings heading keeps back and title on one row (no in-heading app icon). Android, iOS, and browser
  favicons use the same mark; prepared packs are installed with `bun run icons:install <pack.zip>` and
  verified with `bun run icons:check`. GitHub and Android APK links at the bottom of Settings use
  `--theme-link` in both themes.
- Haptics: Android uses `performHapticFeedback` via `LocalMedHaptics` (selection/light/medium/heavy);
  iOS uses Capacitor Haptics impact/selection; web does not call `navigator.vibrate`.
- The NiiVue volume viewer uses the low-cost mobile render profile at DPR `0.75`, disables anti-aliasing,
  and does not render the 3D tile in multiplanar mode; the fullscreen image toolbar includes the native safe-area
  inset so controls stay below the Android status bar and exposes horizontal-scroll arrows. Root tabs prefetch their lazy chunks and skip
  the enter animation on first mount.
- Zen-pack UI sounds go through one `UiSoundController`: cards, buttons, sliders, links, horizontal
  scroll ticks, and fine-pointer hover (touch pointers stay silent). Volume is the single mute/gain
  control. Web Audio unlocks from the first pointer or keyboard gesture on the app shell.
  Distinct cues map delete, print/share, search submit, scroll-to-top, add-note, navigation links,
  radio reselect, and overlay close to dedicated zen sounds; hover uses info on links, warning on
  delete, and snap on toggles.
- Browser application updates install in the background but wait for explicit approval on the search
  sticky toolbar or the Settings checker (compact percent while an APK downloads) before the new
  service worker activates and reloads the page. Android does not register that worker; before an
  APK update it preserves the WebView offline caches. Android checks the latest GitHub release and
  streams its APK directly into an app-private `.part` file through `LocalMedUpdate`: JavaScript never
  receives a file body. It follows HTTPS-only redirects, uses a 64 KiB buffer, atomically promotes a
  complete file, and checks published size/digest when the release API supplies them; a failed replacement
  retains an old ready APK. The task journal keeps artifact identity (including the
  release version), progress, validators and status; resume reads the actual offset from the `.part`
  file, rehashes it in full, restarts on a full, changed, or unverifiable range response, and accepts 416 only after
  size/digest validation. Android 14+ runs the visible,
  user-started transfer as a UIDT job; API 24–33 use one foreground data-sync service with progress and
  cancellation notification when Android permits it. Interrupted work is recovered as resumable rather than a permanent
  spinner, while user cancellation removes its partial file. Background completion never opens the
  installer: only a later explicit ready-state action does. Global CapacitorHttp remains disabled so
  module `fetch` is not patched. Published tool packs (`minimed.tools.*`) auto-install at boot; the
  medications companion stays user-initiated.
  The packaged web assets include the Core SQLite (`core.db`) and all tracked local module
  SQLite files; large companion databases stay optional local-dev or release assets and are stripped
  from `dist` when unavailable. Android aapt ignores those companion filenames explicitly —
  a blanket database glob would also drop the bundled core pack, because aapt `!` only silences skip
  warnings. If the core pack cannot open, boot throws `Не удалось открыть ядро MiniMed`; there is no
  embedded JSON seed fallback in `create-browser-core.ts` (`DEMO_CONTENT_PACK` remains for unit tests
  and benchmarks only).
- The paper workspace follows the device light/dark preference without adding an application toggle.
- Shared `Card` primitives cover new tool/module surfaces; card readers open from the whole card,
  destructive actions use confirmation dialogs, and icon-only trash controls keep secondary actions
  compact; set-level destructive actions use explicit text and red danger treatment. Modal state adds
  one navigator-history entry so Back closes the active modal first.
- Assessment methodology and calculator formula/limitation details use dialogs instead of primary-page
  accordions.   Questionnaire chrome keeps methodology and blank-print as circular icon buttons on the
  right of the header at all widths including tablet. The saved-result page uses the same
  tablet board as the questionnaire (`--layout-cols`), with the score card beside actions. When a questionnaire was opened from another section, a single back control asks where
  to go and shows compact route cards for the test catalog and the previous place (they do not stretch to fill a full-screen mobile sheet). Patient names are suggested from locally stored patient cards, and external/manual test
  results can be saved into the same local result history.
- Vertical mouse-wheel delta is translated into horizontal movement for the shared overflowing-strip
  component, including mixed diagonal wheel input; touch and trackpad scrolling remain native.
- Android draws the page background beneath its transparent status bar while sticky chrome and
  page surfaces add `--safe-top` themselves; there is no solid desk-colored status-bar plate. Sticky
  document-heading paper fill extends beneath the status bar while its text remains below the safe area.
  On native iOS/Android, the top blur/grain is shown only while transparent route chrome is actually
  stuck, and those headers keep their controls below the status bar during keyboard viewport resize.
  Bundled WebView resources clear their cache once per binary version so an APK update cannot keep
  serving an older `index.html` or hashed stylesheet.
  The launch splash and in-app boot screen fill the viewport with paper (`@color/splashBackground`
  on the splash theme; there is no second `drawable/splash.xml` beside Capacitor's `splash.png`).
  Android keeps the window edge-to-edge from `onCreate` (before the WebView) and does not use
  `windowFullscreen`, so splash/boot do not first layout between the system bars and then stretch
  under them. System-bar icon contrast follows the device theme; medical-image readers explicitly
  force the light status-bar appearance; dark-header modal dialogs use the same appearance while open,
  and the device theme is restored after the last such surface closes. Hardware Back closes the
  active dialog or drawer, returns through nested routes and root sections, then minimizes the app at
  the search root. Native-like haptics respect the vibration preference and platform capabilities
  (see device preferences above).
- Native print actions use an in-app preview over the desk background: one A4 sheet with content
  scaled to fit, document-chrome circle Back/Share buttons, and a breadcrumb title. Rendered
  documents are shared as self-contained HTML, while original PDFs use the original file through
  `LocalMedShare` (`ACTION_SEND`); WebView `navigator.share` / `window.print()` are not relied on.
  Hardware Back can exit the preview.
- In-document tables and images pinch-zoom 1–3× with an opaque fill, a dimmed lightbox, and a smooth
  reset on scroll or a click beside the figure. The fullscreen media viewer zooms from the top-left
  and grows its scrollport to the scaled size on both axes so every edge is reachable, with − / 100% /
  + controls on the left of the toolbar (100% restores 1×). Clinical full-text install progress shows
  in the reader button.
- Installed-content changes re-run the active query without clearing the visible results and announce
  the refresh state.
- Search help explains that results are local source references, personal material stays separate,
  and retrieval does not replace clinical responsibility.
- The landing page and browser app are built together for GitHub Pages; the application is published
  below the site at `/app/`. Pages builds regulatory and reference databases in CI and treats
  `medications.db` / `ambulatory.db` as optional GitHub-release companions so a matching tag is not
  required before deploy. Vite no longer strips `regulatory.db`, `reference.db`, or `content/modules`
  from `dist`; Android packaging also keeps those files. Only the multi-hundred-megabyte companions
  (`mkb.db`, `ambulatory.db`) stay out of the APK; `medications.db` is packed when a local copy is
  present outside CI.
- Release labels, tags, APK URLs, Android version metadata, and workflow artifact names derive from
  the root `release.json`; only that file and the independently built corpus manifest are release
  version sources.
- WebExtensions-style localization uses `_locales/<lang>/messages.json` with a bundled
  `browser.i18n.getMessage` shim; the default UI locale is Russian.

### Personal notes

- Device-local patient cards use a flat dated record timeline without a separate context block; card
  and record titles are edited from their final breadcrumbs. The former nested-reply editor is no longer exposed. Card and record deletion require an accessible Kobalte
  alert-dialog confirmation.
- New and edited notes receive deterministic topic labels, are mirrored to IndexedDB, and are
  enriched through the search worker after the editor yields. Related sources appear only with
  sufficient meaningful-term overlap and a readable document title.
- Notes may carry dated follow-up reminders; due items rise to the top, add a red navigation badge,
  and retain the recorded completion condition when closed.
- Saving a reminder automatically requests system-notification permission: Android schedules it
  locally, while the browser deliberately displays it only while the MiniMed tab remains open.
- Note records accept JPEG, PNG, WebP, and GIF attachments up to 8 MB each. Their base64 payloads live
  in a separate IndexedDB store rather than the localStorage note snapshot and are deleted with the
  owning record. The editor keeps its add tile and equal-size image previews in one horizontally
  scrollable row with explicit previous/next controls. Previews enlarge in-place, delete from an
  icon with confirmation, and support long-press multi-select. Saved images and files also render
  inline in the timeline record body and open through the attachment viewer.
- Markdown notes can create and reopen editable Excalidraw diagrams through the toolbar or `/схема`.
  The React editor, its fonts, and Russian UI load lazily from bundled assets; scenes remain local
  Excalidraw JSON attachments with an inline preview and optional SVG export, and remote embeds are
  disabled.
- The user library always exposes a protected root folder named «Заметки». Notes are mirrored there as
  Markdown files and note attachments as regular local-library files; the current note stores remain
  the source of truth and synchronize on note or attachment changes. Editing a mirrored Markdown note
  in the file reader writes its text back to the note record. Mirrored note filenames use the card title
  and append the record title only when it exists, so body text does not become a document heading.
- Notes exposes a separate «Ваши шаблоны» catalog, backed by a protected local folder but not shown
  in «Ваши документы». Its patient-note-style root card and plus action open the catalog with the
  new-template dialog; it can create blank Markdown templates, upload local templates, and add an
  editable «Осмотр на дому» example; template printing uses A4 with 10 mm margins.
- Personal matches appear in search with an explicit personal-source label and outside the official
  result container, so they cannot be mistaken for installed medical content. The block collapses by
  default, shows up to five combined note and book hits sorted by score, and can expand like an
  accordion; note and uploaded-book hits use themed cards, and books carry a notepad icon.
  The «Ваши данные» scope
  searches only personal notes and user-uploaded books and never queries the official SQLite corpus.
  Personal hits require every distinctive query stem (inflected forms still count); a shared leftover
  such as «дети» or «мг» no longer surfaces a book or note that does not contain the specific term.
- User documents open in their original form where possible: EPUB renders through epub.js in the
  page scroll flow, uses the book's own table of contents, and hides the shared app chrome on scroll;
  EPUB and FB2 readers do not expose a separate fullscreen action;
  PPTX renders every slide in the document flow, and DOCX through docx-preview
  (all bundled offline; legacy DOC remains downloadable); EPUB/FB2 extraction honors legacy Cyrillic XML encodings while extracted text
  still powers search. Presentation print sends one rendered slide per A4 landscape page; text-oriented
  print uses ГОСТ 7.32-2017 margins (30/15/20/20 mm), 1.5 line spacing, and a 12.5 mm first-line indent
  without overriding document fonts.
  Persistent text highlights are stored per document/page in IndexedDB and painted with CSS Custom
  Highlights; selecting text offers add/remove actions. EPUB selections use the same store with CFI
  ranges so marks survive reopening. PDFs are shared/printed as the original file; EPUBs are rendered
  through epub.js before printing.
  EPUB navigation now uses the rendition queue and synchronous page scrolling: global smooth
  scrolling and browser scroll anchoring no longer compete with epub.js chapter compensation.
  Text, FB2, DOCX and EPUB selections offer yellow, blue, green, pink and red highlights; legacy
  records remain yellow. Tapping a saved mark opens its removal action, and the shared palette stays
  within the viewport. Native selection collapse no longer dismisses that removal action; the text
  popup follows its source range during page scrolling and closes when that range leaves the viewport.
  OCR runs
  only when requested from the card menu, book mode and in-document search stay disabled without
  extractable text, and the reading-mode paper keeps its light fill. Files support multi-select
  (long-press on touch, «Выбрать» in the context menu) with a bottom bubble showing count and total
  size, single-file and bulk download, bulk delete, and drag-and-drop onto folder cards and breadcrumbs with hover
  highlight. Renamed document titles update directly on library cards, and the protected «Заметки»
  folder carries a note glyph on its animated front panel. Document sharing falls back to a local
  download when desktop Web Share is unavailable, rejects the file type, or denies permission. File
  context menus stop propagation, avoid viewport edges, close on navigation, and show an icon for
  every action.
- User-uploaded PDFs, images, and text-like files live in IndexedDB as a personal overlay: PDF pages
  with insufficient native text use throttled tesseract.js WASM OCR in a background worker, while
  images remain visual-only until the user explicitly requests OCR, which creates a PDF copy. Only
  extracted text is indexed for personal search, never written into official content packs.
- Medical images stay local as well: Cornerstone opens DICOM Part 10 files and sibling series, while
  NiiVue opens native NIfTI, NRRD, MIF, MGH/MGZ, MetaImage, Analyze, AFNI, and NumPy volumes. Both
  readers expose progress and explicit errors and generate first-frame/slice thumbnails for the file
  grid. The personal library shows empty example slots for a CT and MRI in «Исследования» and an
  EPUB in «Книги». The whole example card is the download button; its file-download icon is visual
  only. A stored example is reused by its stable slot id/file name, so repeated clicks do not create
  duplicate documents. Downloads use the versioned GitHub Release, using the CORS-safe raw URL for
  the same tagged source in the browser; progress and errors are shown. The example files are
  separate release assets and are not included in the app bundle.
  Medical-image readers own the full page (including back navigation), hide the global bottom nav,
  expose available patient/study/region/comments metadata, and keep the multiplanar 3D crosshair in
  sync with slice navigation and its three-plane 3D cutaway. Their fixed navigation controls stay
  visible while the tool strip scrolls horizontally, and the canvas resizes with narrow and rotated
  phone viewports; clipped CT/MRI titles use an overflow-aware marquee. Dragging inside a 3D volume
  tile depth-picks and moves the crosshair for mouse input, immediately aligning the three-plane
  cutaway to that position. On touch, single-plane taps move the crosshair and vertical swipes scrub
  slices; the 3D view exposes separate X/Y/Z slice-axis controls over the render tile, and selecting
  one makes vertical touch swipes scrub that axis instead of relying on imprecise cursor clicks. An
  active-by-default floating sphere control shares that overlay and enables direct 3D rotation by
  mouse or one-finger drag; turning it off restores crosshair movement on mouse and axis scrubbing on
  touch. Volume renders open from 45° above the posterior-left side and reset back to that view.
  DICOM uses the file's automatic/default VOI on open; contrast is opt-in. On phones, one-finger
  swipes change slices and two fingers pan and zoom. On desktop, the mouse wheel changes slices while
  the contrast, pan, and zoom modes remain available as explicit controls.
  MRI/volume readers expose contrast adjustment on an explicit toolbar toggle: primary mouse input
  keeps ROI selection, while vertical touch swipes adjust the window width; secondary-click contrast
  and a separate default-contrast reset remain available.
  Single-plane volume views scrub slices by vertical mouse/touch drag on either the
  canvas or slice number, while holding either reader's previous/next control continuously advances
  slices without opening a native context menu. The DICOM slice number also captures mouse/touch
  drag for continuous scrubbing, and both readers show the current/total slice as a stacked fraction;
  NiiVue double-touch input is disabled; two-finger pinch zoom is handled by the app for individual
  volume slices and 3D, with 2D zoom anchored at the point between the user's fingers. Phone
  multiplanar mode uses a 2×2 grid with a clipped per-plane crosshair
  overlay. Viewer controls expose their modes through accessible labels and visible keyboard hints:
  `R` resets, `I` opens image data, `Backspace` returns to navigation, `C` toggles contrast, `P/Z`
  select DICOM pan/zoom, and `D/E` select pencil/eraser. DICOM annotations persist as
  normalized vectors per document, plane, and slice; volume annotations persist as a NiiVue voxel
  bitmap visible in 3D, with red/blue drawing, erasing, and a 24-step undo/redo history.
  Both viewers expose a toolbar printer that captures the current CT/MRI frame or selected slices,
  including annotations and compact patient/series/slice overlays, and lays them out on A4 pages;
  volume grid printing uses 4×4 slice montages.
  Active volume drawing locks rotation and slice navigation; a completed pencil stroke returns the
  pointer to its normal mode so accidental follow-up strokes are not created.
- Voice recordings captured in the note editor render as full-width Telegram-style bubbles with a
  stretching waveform, a decoded-duration label, and a square `text-aa` transcribe button; deleting
  requires confirmation, and transcription without an activated model opens a dialog offering the
  settings screen. On-device ASR now offers quantized Whisper Base and Whisper Small through the
  transformers.js v4 ASR pipeline; onnxruntime-web 1.27 fixes the tied-weight crash that previously
  blocked quantized Whisper decoders. GigaAM v3 remains unavailable until the app has its separate
  audio preprocessor and CTC decoder. Settings rows use
  a single checkbox per model: checking starts the download, checking another or unchecking pauses
  the in-flight download by terminating the worker. Whisper downloads report monotonic total-model
  progress and retry transient fetch/network failures twice before surfacing a localized error.
- The five user-facing root sections and document/file readers can be opened in same-origin
  mini-windows from the fixed action button; settings stays in the main route. Floating windows are
  disabled by default; Settings can enable or disable the button and close existing mini-windows.
  The normal route remains separate; only the current root view and the outgoing view remain mounted
  during the CSS transition, then the outgoing view is disposed. Each mini-window keeps its own hash
  route and geometry while sharing the browser's IndexedDB/localStorage data layer. The single
  floating-window manager persists route, position, size, and stacking order, keeps at most three
  windows with one active visual window, allows separate windows for separate routes in the same root
  section, keeps a shared geometry for all windows, keeps headers in a fixed 45-degree diagonal
  cascade clamped to the viewport, and promotes any clicked header to the top. Inactive headers stay
  visible but their buttons and resize handles are inert. Expanding a mini-window restores its saved
  route in the main view. It moves stacked windows as a group, hides inner scrollbars, shows a centered
  iframe loading state, renders only the active mini-window iframe, and resizes through four invisible
  desktop corner handles with blurred content until the gesture ends; mobile exposes the Phosphor
  `notches` handle at the bottom-left corner. Collapsed windows are header-only, titles marquee only
  when clipped, and embedded Button controls derive their compact size from
  `--floating-window-button-size`. An active mini-window can temporarily occupy the whole viewport;
  its toolbar remains as an ExtraHeader with controls to return to the mini-window. Embedded frames
  receive `minimed-floating=1&minimed-floating-scale=1`; JavaScript mirrors their viewport into CSS
  variables so the shared compact layout adapts after resize. Embedded windows skip the optional OPFS
  medications companion so multiple frames do not contend for one access handle.
  Calculator and questionnaire links inside an official document reuse the same window layer even
  when optional floating windows are disabled. These reader-owned windows are not persisted and close
  automatically when the parent document route changes; their compact and full-screen controls remain available.
- «Ваши документы» opens a dedicated catalog at `#/modules/documents/user` with nested local folders
  whose current folder is preserved in `?folder=<folderId>` navigation,
  visible folder breadcrumbs, page-level plus actions, move/rename/delete actions, file drag-and-drop
  with folder-aware targets, fuzzy search, virtualized cards, and OCR progress; upload validates supported
  container formats before storing a file; opening a document navigates to
  `#/modules/documents/user/<documentId>` (optional `/p/<pageIndex>`) with breadcrumbs
  (origin — Поиск or Ваши документы — then nested titles via Kobalte); a pasted user-document URL
  parents back to the user catalog, in-document search,
  outline, selectable OCR/native word overlay on page images, and print of extracted text. Native PDF
  text uses a PDF.js selection layer, and inspection records whether the source PDF already exposed
  text while keeping the manual OCR action available.
  TXT/Markdown/RTF/DOCX files can be opened in an explicit draft editor; the original IndexedDB
  file is replaced only after «Сохранить черновик», with navigation and browser-close guards for
  unsaved changes. Markdown drafts reuse the notes WYSIWYG editor and toolbar; DOCX drafts retain
  Word page markers and edit as separate A4-like pages, while DOCX/RTF source formatting remains
  plain-text-only. Markdown draft editors also support `/`
  insert commands; uploaded files are stored in the current user-library folder.
  Markdown preview renders a small sanitized GitHub-style HTML subset (for example `mark`,
  `details`, tables, and links) while dropping scripts, event handlers, unsafe URLs, and styles;
  document and note TOC labels clamp at three lines.
  Folders and files render as one Finder-style tile list (icon block + name + meta) obeying a shared
  sort — time, name, or type, persisted — with per-kind icon colors (presentations orange, documents
  blue, sheets green). Opened/modified/added times are tracked and shown in card metadata and
  tooltips (`lastOpenedAt` is recorded without touching `updatedAt`). The view toggle (grid/list)
  sits next to a sort menu on the left of the breadcrumb row with the green add button on the right;
  free placement is hidden for now; file actions open from the context menu on right-click/long-press,
  including multi-select and system file sharing; mobile controls wrap below breadcrumbs, grid keeps two columns on phones,
  and expands to six columns on wide screens. Folder
  creation uses a dialog; drop targets share one helper that highlights hovered folders/breadcrumbs for
  both OS file drops and in-app file/folder moves; on touch devices cards use long-press drag with a
  movement threshold so ordinary swipes keep scrolling without text selection or native callouts; folders can be dragged into other folders with
  cycle protection; names are limited to 256 Unicode characters; ZIP, RAR, and tarball archives
  unpack into the current folder with nested directories and bounded, path-safe extraction; list rows show image
  previews when present; HEIC/HEIF upload is accepted with native-decode previews where the platform
  supports them (glyph fallback elsewhere). Part 10 `.dcm`/`.dicom` files open in a lazy-loaded,
  offline Cornerstone viewer with locally bundled codecs, window/level, pan, zoom, slice navigation,
  and automatic background same-series grouping by `SeriesInstanceUID` after the selected image is
  rendered. Medical viewers use the same dark full-viewport surface under the native status bar; the light
  status-bar appearance is forced while they are open, and the toolbar
  `--medical-image-status-bar-color` fills both the native status bar and the toolbar safe-area
  inset while controls remain below it. The root user library shows
  empty example slots for CT and MRI files in «Исследования» and an EPUB in «Книги»;
  «Книги» and «Исследования» are created once as ordinary user folders. Example cards download their
  sample from the versioned GitHub Release (the browser uses the CORS-safe raw URL for that tag),
  with download progress and errors; stored slots are idempotent and no sample files are included in
  the app bundle. Reader file kinds
  and actions come from one capability matrix: unsupported legacy DOC/PPT/Pages stay download-only,
  XLS/XLSX/XLSM/CSV share one spreadsheet reader: XLSX/XLSM preserve merged cells, colors, fonts,
  borders, alignment, and row/column dimensions; sheet names appear in the TOC and tabs; cells can
  be edited and saved locally; «Редактировать таблицу» keeps the same active sheet in a dedicated editor shell
  with a formula bar, selection highlight, save status, and bottom sheet tabs. XLS/CSV use the same UI and
  remain searchable and printable in A4 landscape. XLSM macros are preserved but never executed.
  The PDF header zoom pill was removed (pinch-zoom now scales the whole document).
- Document text links installed medications, recommendations, and laws into nested
  `#/modules/documents/d/…` pages and
  show kind icons beside each link, with a native CSS wavy underline on every wrapped text line;
  the underline is static, including on hover.
  Links skip the open document and its family (summary, full text, revision, or topic card such as
  `kr.rf.281_3` → `kr.rf.281_3.uti`), so an abbreviation defined in a recommendation does not open
  that same work again or add a duplicate breadcrumb.
- Official JSON figures keep a nearby `Рис.`/`Fig.`/`Таблица` paragraph as the caption instead of
  the CMS filename (`image.png`). Already installed packs get the same pairing in the reader
  without a rebuild.
- A clinical-summary reader installs the matching individual JSON recommendation on request, then
  reconnects the local corpus and replaces that same reader with the full document.

### Local model

- Speech transcription runs locally with quantized Whisper Base or Whisper Small. Model files are
  downloaded from Settings and cached by the transformers.js runtime; GigaAM v3 still needs a
  dedicated adapter before it can be exposed as a working option.


- Validated remote/cache/bundled three-model catalog; Qwen3 0.6B is the automatic recommendation,
  and an older remote/cache catalog cannot replace a newer bundled one.
- Browser CPU/WebAssembly GGUF runtime with a structured-output viability probe.
- A CLI `tester-box` builds a disposable full-corpus FTS index and compares the three catalog models
  across 20 clinician cases using direct and strict-JSON prompts, exact-quote/number validation,
  explicit dose-conflict detection, and one bounded repair attempt.
- The former compact query-planning and generative relevance wrapper is no longer connected to
  search. The runtime remains available as research infrastructure, but released search returns
  source references from deterministic retrieval only.
- The default browser path uses the catalog's immutable upstream model asset rather than an unavailable
  release mirror.

The model cannot open the network, change the corpus, create a citation, calculate a dose, or hide the
ordinary search response when validation fails.

### GigaEmbeddings retrieval POC

- The unsuccessful Needle 2 tool-calling fine-tune was removed: the base model scored 0% exact on
  the Russian split, three local training iterations did not produce a usable checkpoint, and no
  Needle code had been integrated into the app.
- `tools/benchmarks/giga_embeddings_poc.py` evaluates the frozen
  `ai-sage/Giga-Embeddings-instruct-480M-0826` revision
  `2d0c1a92716eef0e5b6972df85b5883eb5b4f57a`. Query-only instruction, mean pooling and L2
  normalization follow the model card; vectors are quantized to the pack contract's signed `int8`,
  and weights stay in the ignored local cache. `export-giga-base-candidates.ts` obtains the comparison
  candidates from the real deterministic/hash `MedicalCore` path rather than reimplementing it.
- The recorded comparison on the same 61 public-pilot queries and 58 source chunks (before the
  title-aware group-ordering change) measured deterministic/hash Recall@1 `0.984`, Recall@5 `1.000`,
  MRR@5 `0.988`, section recall `1.000`, and top-section accuracy `1.000`. Int8 semantic-only Giga
  measured `0.967`, `1.000`, `0.979`, `1.000`, and `0.967`. Adding Giga after that hybrid with the
  existing fusion weights measured `0.984`, `0.984`, `0.984`, `1.000`, and `1.000`: it added no win and pushed
  `drug.ceftriaxone.pediatric-pneumonia-workflow` out of the top five.
- Repeated cached offline runs on Apple Silicon MPS loaded in `1.5–1.7 s`, used `652–669 MB` peak
  RSS, and encoded a warm single query at p50 `35–36 ms` / p95 `47–49 ms` across ten samples per
  run. A local `llama.cpp` conversion also preserved the model's mean pooling and non-causal
  attention: the Q8_0 GGUF is `520209504` bytes with SHA-256
  `d64618ea1ac16be1e71930cacc2d8dff047c4dc91b78b797bf8db09128b25ac2`. Across eight short Russian
  query/document probes, cosine parity against the original BF16 runtime was `0.99896` minimum and
  `0.99911` mean. This is a desktop conversion probe, not mobile qualification. The upstream
  repository still publishes only BF16 safetensors plus custom
  bidirectional Qwen3 code, not an immutable GGUF/ONNX artifact for the app's runtimes; no neural
  profile, model catalog entry, or runtime dependency was added to the app.

### Content and downloads

- Deterministic preparation, Markdown validation, stable IDs, provenance, and SQLite building.
- Public/private source registries with rights metadata and extraction diagnostics.
- Remote binary sources without `ETag`/`Last-Modified` use a `HEAD` preflight: unchanged
  `Content-Disposition` plus `Content-Length` reuses the checksum-validated cache, while any change
  downloads the archive and records a new SHA-256. The ESKLP public ZIP remains a disabled
  build-time source and is never checked during app startup; its verified identity-only preview
  modules are published separately.
- Official Ministry API inventory for 744 recommendations, a resumable structured-JSON sync plan, and
  one deterministic source registry per recommendation.
- Official JSON is validated at the ingestion boundary and compiled into one SQLite module per
  recommendation. Headings remain navigable, tables retain cells and spans, and embedded figures
  remain inside the same offline database without shipping the source PDF.
- PDF import detects broken Cyrillic font encodings and retries with Tesseract `rus+eng` when available.
- An opt-in Replicate Marker pilot can create a forced-OCR Markdown draft from one private PDF or DOCX;
  it validates the private root and never promotes the draft into a pack automatically.
- Corpus lint now also rejects English-dominant output for a source expected to remain Russian, so OCR
  or a model cannot silently replace the original wording with an English translation.
- Published snapshot `clinical-json-2026.07.27-13991c1feee5` contains 744 checksummed SQLite modules
  plus its manifest and catalog fragment. Clinical source-PDF archives are no longer published.
- The knowledge base lists individual recommendations under 21 visible medical sections and supports
  individual or section-level installation. Cross-listed recommendations are downloaded once, and
  each section's progress remains relative to its complete document list. Completed progress bars are
  hidden; section and bulk download buttons report aggregate percent, recommendation-card progress
  spans the full card width, and category removal leaves its busy state before the search index
  reconnects.
- Official GRLS inventory contains 38,815 unique registration records from 140,274 status/version rows,
  with the source ZIP, edition, and checksums retained locally.
- The read-only ESKLP↔GRLS crosswalk indexes 29,300 exact registration numbers from the full ESKLP
  pack and carries the matched MNN document, standardized INN, SMNN, presentation, and KLP codes into
  GRLS knowledge metadata. A 24-record real GRLS sample resolves 20 exact registrations, leaves four
  unmatched, and produces zero ambiguous merges. A registration associated with multiple MNN documents
  fails closed. Exact registration plus exact normalized trade name keeps `Нурофен`, `Нурофен плюс`,
  and `Нурофен Интенсив` attached respectively to ibuprofen, ibuprofen+codeine, and
  ibuprofen+paracetamol instead of merging by their shared brand prefix.
- GRLS brand entities now aggregate the MNN and ESKLP identifiers of their distinct registrations
  instead of requiring every registration with the same trade name to have identical metadata.
  Registration entities and presentations remain separate; this fixes the real multi-registration
  `Зверобоя трава` collision without weakening exact registration matching.
- The public command `medbase-regulated-catalog esklp --archive --taxonomy --output [--generated-at]`
  verifies the real read-only 2026-08-28 archive: 3,324 MNN cards, 7,672 SMNN, 42,240 TN, 604,213 KLP,
  and zero warnings; the ledger is ~619 MiB with measured ~2.3 GiB RSS. A synthetic two-KLP-shard
  fixture builds through the metadata workspace into temporary SQLite/FTS, keeping MNN/TN/form/compound
  `Мирамистин мазь` in one document with `metadata-only`/`trustedDoseData: false`. The verified
  identity-only release is split into fifteen preview SQLite modules; existing source databases are
  preserved read-only.
- The SQLite composer stages modules through ATTACH and set-based `INSERT ... SELECT`, builds FTS and
  secondary indexes after loading, and checkpoints each completed module for exact-config/input-fingerprint
  resume. Pair replacement rolls back on process exceptions but cannot be cross-file atomic across SIGKILL
  or power loss; its local-dev EditionManifest remains unsigned and validation-bound, never published.
- The generic pack builder now defers secondary indexes, writes ordinary rows in bulk, and builds FTS
  with one set-based `INSERT ... SELECT` from the loaded document tables instead of Python
  `executemany`. On the 5,000 largest real Allmed chunks, the FTS stage fell from 2.31 s to 1.39 s with
  the same 42,176,512-byte output. The full 4,708-document/75,156-chunk Allmed shadow build now takes
  836.50 s (13 min 56.5 s), down from 2,927.89 s immediately before the set-based FTS/cache change and
  ~3,294 s in the older path. The 511,971,328-byte result has no staging remainder, passes
  integrity/foreign-key checks, and is logically identical to production across documents, versions,
  sections, chunks, aliases, embeddings, and FTS.
- ESKLP preview modules remain metadata-only (`trustedDoseData: false`): registry authority and
  provenance support identity/catalog facts, not treatment indications or dosing.
- Medication search promotes the longest exact source alias (including a verified TN+form pair) into
  the result-group heading beside its canonical MNN and ranks that group accordingly. The exact
  presentation branch combines brand with form/route/strength, while age and weight only refine the
  match. A public `MedicalCore.search()` fixture with competing ointment and capsule cards verifies
  both the valid `Мирамистин мазь` presentation and refusal to claim the nonexistent
  `Мирамистин капсулы` pair.
- A measured 75-card ESKLP audit pack built from the verified 2026-08-28 ledger passes 13 common-drug
  queries through `MedicalCore.search()`: direct paracetamol, salbutamol, erythromycin, ceftriaxone,
  and cefepime cards stay above fixed combinations; `цефипим` resolves to `ЦЕФЕПИМ`; Nurofen TN,
  paediatric, and suspension queries expose source-faithful rows; and `турбухалер`/`турбухаер` return
  exactly the budesonide, budesonide+formoterol, and formoterol cards. Search limits are applied after
  document grouping, component aliases cannot rewrite an MNN query into a combination, and the first
  snippet favours exact TN fields and query-specific forms while stripping known disclosure markup.
  This audit does not publish or replace the full ESKLP pack.
- The read-only full-ESKLP benchmark now freezes 16 source-audited medication queries. Recall@5,
  MRR@5, exact supported identity Top-1, and source-evidence hit are all `1.00`; p95 is 8.93 s and mean
  latency is 4.86 s on the 1,982,984,192-byte local pack. Its explicit `Нурофен плюс` and
  `Нурофен Интенсив` cases require the combination-specific MNN IDs and source strength evidence.
- Medication-form recall is generic rather than TN-specific: `сироп` and the common typo `спироп`
  also search the exact source phrase `СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ`, while inflected suspension
  queries can find registered syrups. Exact source forms and direct MNN cards rank first; injection
  and external suspensions are not treated as syrup evidence. The extended read-only ESKLP check
  passes 20/20 queries, including Nurofen, Children's Panadol, Ascoril Expectorant, and paracetamol.
- Medication-route search recognizes full intramuscular/intravenous wording and `в/м`/`в/в`, keeps
  the direct MNN above fixed combinations, and prefers a source fragment with the requested route.
  Bare kilogram measurements are extracted from pediatric queries without treating a bare gram drug
  strength as body mass or duplicating an explicitly labelled weight. Eight read-only ceftriaxone
  queries pass against the real ESKLP audit pack; no individualized dose is inferred from registry data.
- Current official instruction synchronization covers nine pilot medications; eight text-layer PDFs
  build into a 147-chunk SQLite pack and the oseltamivir scan remains explicitly blocked on OCR.
- The resumable GRLS downloader now uses 1–8 bounded workers, one cookie session per worker, and commits
  PDFs/state in deterministic plan order while retaining at most `workers` PDF results in memory. A
  real four-registration smoke run completed 4/4 downloads in 4.57 s and a current-site regression for
  `ЛП-000348` resolves the official 5,511,986-byte PDF in 7.96 s. Official PDF paths with Cyrillic are
  percent-encoded before download; `ЛП-000167` resolves its 1,158,161-byte PDF in 3.23 s. Two bounded
  100-target batches added 79 valid current instructions, so the registry now contains 116
  checksum-valid current PDFs, all OCR candidates. This is verified pipeline behavior, not complete
  GRLS instruction or dose coverage.
- The generic `medbase prepare` stage accepts `--workers 1..8`. Extraction/OCR runs concurrently,
  while Markdown, diagnostics, and the report are committed in registry order with at most `workers`
  extracted sources waiting in memory. The default remains one worker. The preserved sequential
  116-instruction run completed in 501.97 s (8 min 22 s); a separate four-worker run completed in
  about 237 s (3 min 57 s), a measured 2.1x speed-up without replacing the original workspace.
- The 116 current OCR instructions now build together with 116 normalized GRLS registration cards
  into `data/build/grls-instructions-current-116.db`: 232 documents, 1,724 sections, 1,507 chunks/FTS
  rows, 503 knowledge entities, 418 relations, and 453 document links in 22,282,240 bytes. The final
  build takes 2.11 s and passes lint, SQLite integrity, and foreign-key checks. Exact registration +
  TN crosswalk links 99 cards to ESKLP MNN/SMNN/KLP identity, leaves 17 explicitly unmatched, and
  produces zero ambiguous links. All 116 instruction documents retain the OCR review requirement;
  this local evidence pack is not yet a reviewed dose corpus.
- Exact known instruction headings are now recognized even when OCR loses font emphasis. The separate
  `current-116-v2` build contains 480 source-exact proposed facts linked to registration entities:
  administration for 58 registrations, contraindications for 58, indications for 51, adverse reactions
  for 52, warnings for 50, and storage for 66. All 480 evidence quotes are exact chunk substrings;
  SQLite integrity and foreign keys pass. These are navigable official-label excerpts, not yet parsed
  or reviewed dose regimens.
- `medbase prepare --reuse-from` reuses only source-file/checksum-matched extraction JSON and
  regenerates Markdown/diagnostics in registry order; an expansion from 121 to 123 instructions reused
  121 extractions and processed only two new PDFs. The latest preserved local build
  `grls-instructions-current-123-v2.db` contains 123 instructions plus 123 registration cards,
  632 entities, 176 parsed presentations, 548 proposed source-exact facts, 881 relations, and 761
  document links. Exact ESKLP
  crosswalk covers 106 registrations, with zero ambiguous and 17 unmatched. It adds complete section
  groups for current salbutamol, oral/tablet paracetamol, Symbicort Turbuhaler, cefepime, and Nurofen
  tablet registrations; older Nurofen suspension/Plus registration searches remain unresolved at the
  GRLS site and are not substituted by name.
- The GRLS batch scheduler now stops retrying a failed registration after a configurable
  `--max-attempts` limit (default 3) and advances to later plan entries. Before the fix, an 8-worker
  smoke run spent 7.1 seconds retrying the same eight 5–6-attempt failures and produced 0/8 PDFs;
  after the fix, the next bounded run skipped 21 exhausted failures and downloaded 8/8 new
  checksum-valid PDFs in 8.0 seconds. A new registry contains 131 sources. `medbase prepare
  --workers 8 --reuse-from` reused 123 extractions and processed only the eight additions in 25.0
  seconds; normalization against the preserved full ESKLP pack took 20.1 seconds. The separately
  preserved `grls-instructions-current-131-v2.db` contains 131 instructions plus 131 registration
  cards, 2,336 sections, 2,020 chunks, 184 presentations, 668 entities, 775 proposed facts, 927
  relations, and 809 document links. Exact crosswalk coverage is 114 matched, zero ambiguous, and 17
  unmatched; the 36,745,216-byte database has SHA-256
  `f106933bdb7c670d41d82b3ce1af894d4f2a5f043b25f9c119b91da7a9d24e22`, integrity `ok`, and zero
  foreign-key violations. The previous 123-instruction databases remain unchanged.
- A subsequent bounded 32-target run added 29 checksum-valid PDFs in 22.0 seconds with eight
  workers. `medbase prepare --workers 8 --reuse-from` reused all 131 prior extractions and processed
  only the 29 additions in about 55.5 seconds. The preserved
  `grls-instructions-current-160-v2.db` contains 160 instructions plus 160 registration cards, 2,870
  sections, 2,486 chunks, 223 presentations, 790 entities, 931 proposed facts, 1,123 relations, 993
  document links, and 193 review tasks. Exact ESKLP crosswalk coverage is 141 matched, zero
  ambiguous, and 19 unmatched. The 45,293,568-byte database has SHA-256
  `e40665735a04f7c17474e047a5d406ca3c67057b27e818f1562ca11e8837a04b`, integrity `ok`, and zero
  foreign-key violations. All earlier GRLS databases and extraction workspaces remain preserved.
- A temporary end-to-end edition composed the current core with the 131-instruction GRLS pack in
  97.619 seconds using the set-based composer: 4,345 documents, 14,134 sections, 13,830 chunks,
  31,949 aliases, 133,029,888 bytes, integrity `ok`, and zero foreign-key violations. The first
  unified search run exposed a real source-order regression: GRLS instructions outranked the
  canonical ESKLP pointer for plain `нурофен`, `нурофен спироп`, and typo `цефипим`, reducing exact
  identity Top-1 to 0.786. Query ranking now uses the already-loaded document metadata: a plain drug
  query prefers the ESKLP medication pointer, while an explicit instruction or registration query
  prefers the corresponding GRLS source. The repeated 16-query run restored Recall@5, MRR@5, and
  exact identity Top-1 to `1.00`. Compact-core source-evidence hit remains at its unchanged `0.80`
  baseline for the two Nurofen evidence fixtures; the full ESKLP pack remains the authoritative
  evidence benchmark.
- A deterministic GRLS dose-candidate projection now extracts only paragraphs with explicit numeric
  dose expressions from administration sections. The preserved
  `grls-instructions-current-123-dose-candidates-v2.db` contains 199 proposed `dosage` facts in
  addition to the previous 548 exact section facts; 57 dosage facts have explicit
  population/applicability data from the same paragraph, with 21 age-group, 23 weight-based, and 15
  same-paragraph route annotations. Forty-nine retain explicit
  frequency expressions and eight retain administration intervals. Every dosage evidence quote is an
  exact source-chunk substring; the quality check found no concentration-only `мг/мл`, `мг/доза`, or
  `мкг/доза` paragraph promoted as a dosage fact. Normalization reused the prepared corpus and took
  about 19.5 seconds; SQLite build took about 4.5 seconds, with no OCR rebuild. The 34,660,352-byte
  database has SHA-256 `e6ddc8d3258b080cb9717ced1ce74b62fbe6f44ccd1cf4e3981a32d0f8f187b6`,
  integrity `ok`, and zero foreign-key violations. All extracted doses remain `proposed`; the
  capability manifest therefore reports zero clinically supported dose entities until automated
  source/applicability review promotes individual regimen facts.
- `medbase ai-fact-review-export` and `ai-fact-review-import` implement immutable dual-AI review for
  existing proposed dosage facts. Export fingerprints the complete fact, preserves the exact evidence
  and source context, and never permits a model to rewrite structured values. Import requires exactly
  two response files, distinct review IDs, matching fingerprints and evidence, confidence at least
  0.95 from both reviewers, full consensus, and deterministic applicability/timing completeness before
  setting `reviewed`; dual rejection sets `rejected`, while disagreement or missing data abstains. The
  123 current instruction documents do not yet declare `allowsDerivativeProcessing`, so the real
  export currently fails closed at the rights boundary and no dosage fact has been promoted.
- GRLS presentation parsing now locates the first numeric strength/unit field instead of assuming the
  second comma-separated token is a dose. Forms such as `таблетки, покрытые оболочкой, 200 мг` retain
  the complete form and produce an exact `clinical-drug` presentation; this raised parsed presentations
  in the 123-instruction pack from 78 to 176. The current Nurofen EAEU record resolves to `Нурофен® ·
  Ибупрофен`, `таблетки, покрытые оболочкой · 200 мг`, with exact ESKLP MNN/SMNN identity.
- The local Allmed companion `apps/app/public/content/medications.db` is a 514,322,432-byte Allmed
  supplemental reference snapshot for local/dev use (4,708 `allmed_reference` documents, 66,430
  sections, and 75,156 combined chunk/FTS rows; SHA-256
  `sha256:5291b2da4dc34b4cf08323c2fd1a24a3a60fddc60a7034772c08124b817922c6`). The preserved previous
  database backup is `/tmp/minimed-medications-production-backup.IPpNak/medications.db`. The
  crosswalk is MNN-only: 3,538 linked, 41 ambiguous, 1,129 unmatched, and 4,236 safe image
  references. Rendering/merging requires exact MNN plus exact normalized trade name. Each row remains
  an Allmed `TradeNameSupplement`, preserving its trade name, `allmedId`, and image reference; it is
  not an ESKLP SMNN/KLP/registration record and does not establish trusted doses.
  Browser sqlite-wasm no longer deserializes that file into the WASM heap (that path OOM'd). The window
  thread streams it into a dedicated OPFS worker (`minimed-sah-pack`) so the large companion stays out
  of the WASM heap. The first boot copies 514,322,432 bytes (~490.5 MiB) into origin-private storage,
  later boots reuse it. Core reloads share that
  worker through ref-counted leases, preventing concurrent
  access handles for the same SAH pool. Opening that companion no longer hydrates every document record as a boot-time
  warm-up; worker `open` already validates the pack through `initialize`. A truncated, empty, or legacy OPFS copy is discarded and re-imported instead of
  failing MultiMedicalStore composition and blocking app boot; OPFS virtual filenames use the required
  absolute-path form. Compiled packs are never schema-mutated during initialization, including legacy
  packs without tool tables; those packs report no tools instead of replaying DDL and exhausting the
  WASM heap. SQLITE_NOMEM or any other failure opening Allmed skips the companion and leaves core search
  usable. IndexedDB-installed modules larger than 32 MiB are not deserialized into WASM. When Allmed is
  mounted, in-app search stays on the window core (`searchExecution: 'direct-only'`)
  so the search worker does not open a second 514,322,432-byte copy. `mkb.db` / `ambulatory.db` still stay
  closed unless `VITE_OPEN_UNSAFE_WASM_COMPANIONS` names them. Core still contributes eight
  `source_linked_summary` registry cards. The 560 KB `data/build/medications.db` GRLS pilot is a
  separate one-drug pipeline artifact, not this catalog. The newer 116-instruction/116-registration
  local crosswalk pack is recorded above and is not mounted or published automatically.
  Allmed preparation also preserves `pharma_effect` as the compact catalog description and imports
  `recipe`/`recipe_ru` as clearly labelled reference examples inside the document. Those examples are
  not a prescription, do not establish `По рецепту`/`Без рецепта`, and remain separate from official
  GRLS/ESKLP status fields.
- Optional local-dev `mkb.db` companion (`minimed.mkb.ru`) contains 9,835 RLS MKB cards, 7,334
  medication brands, 1,952 substances, stable medication IDs, trade-name→MNN aliases, exact
  evidence, and proposed code-to-medicine relations. RLS detail cards use the dedicated
  `rls_mkb_reference` source type, so medication search sees only cards that mention medicines;
  generic medical references remain outside that scope. Clinical-catalog `icd10Codes` metadata is
  projected into FTS with punctuation-free variants so installed recommendations are found by
  `I67.9`, `I679`, `I67-9`, `I67 9`, `679`, `67-9`, or `67 9`. Three-attempt failures are saved to
  `rls-mkb-failures.json`; `bun run content:retry:mkb` repeats only those detail URLs. Build with
  `bun run content:rebuild:mkb`; the builder reuses the validated knowledge workspace, batches
  SQLite writes, and performs one final compaction pass. Existing packs can receive the authority
  and knowledge-search upgrade with `bun run content:upgrade:mkb`, without reparsing Markdown.
- `bun run content:rebuild:krasotaimedicina` deterministically prepares the checksummed private crawl
  snapshot and builds a lexical-only `data/build/diseases.db`. It keeps article headings, links,
  image source links, local asset metadata, exact raw selectors/checksums, and site-supplied ICD-10
  codes; titles containing `синдром` are typed as syndromes. The completed 2026-09-04 snapshot contains
  6,068 documents (5,419 diseases and 649 syndromes), 58,056 sections, and 73,148 chunks. The composed
  `mkb-diseases.db` contains 15,904 documents, 107,239 sections, 250,000 chunks, and 18,929 aliases;
  both databases pass SQLite integrity and foreign-key checks. Two frozen source-derived search
  fixtures under ignored `data/build` exercise `MedicalCore.search()` with 500 lexical queries per
  database; regenerate them explicitly with `bun run benchmark:full-corpus:generate` and run them with
  `bun run benchmark:full-corpus`. `diseases.db`
  measures Recall@5 `0.992`, MRR@5 `0.973`, and section recall `0.980`; `mkb-diseases.db` measures
  Recall@5 `0.938` and MRR@5 `0.942`. These are identity, section-navigation, MKB-code, and composition
  regression checks, not physician-authored clinical-relevance evidence. Neither local artifact is
  published while redistribution review remains incomplete.
- The knowledge base now exposes a unified `Заболевания и состояния` catalog at
  `#/modules/documents/conditions`, with `Заболевания`, `Состояния`, `Синдромы`, and `Симптомы`
  sections. It
  groups MKB entries, clinical-recommendation pointers/full documents, and reference documents by
  exact ICD-10 code, replaces a downloaded-module pointer with its full document, and keeps a
  multi-code recommendation as one fallback entry when the MKB companion is absent. An explicit
  disease/condition/syndrome/symptom type takes precedence; names containing `синдром` are grouped
  as syndromes; otherwise ICD-10 chapter R is shown under
  symptoms, S-T and V-Z under conditions, and remaining codes under diseases. The catalog therefore
  works from bundled core pointers and expands automatically when optional content is mounted,
  without creating source-specific duplicate disease cards. A catalog card opens the unified condition
  page; its separate `КР ↗` action opens the full recommendation when installed or the core pointer,
  outline, and module-download action when it is absent. Single-section document pointers hide the empty
  outline and use compact reader-title typography.
- Optional local `ambulatory.db` companion (`minimed.ambulatory.v1`) mounts private textbook/handbook
  extracts for site/call use. Build via `bun run content:rebuild:ambulatory` (anydoc text-layer +
  macOS Vision OCR). Pack is gitignored — copyrighted sources stay local; deterministic search uses
  its chunks once the pack is mounted. See `docs/AMBULATORY_CORPUS_V1.md`.
- Public Russian starter pack: seven clinical navigation cards and eight medication-registry identity
  cards.
- Structured knowledge tables support proposed facts, exact evidence links, relations, and review tasks.
  The pilot drug-registry facts and the amoxicillin→pediatric-pneumonia relation retain AI-assisted
  verification notes and source lists, but remain `reviewStatus: proposed` with open review tasks until
  a licensed human reviewer records approval through the ingestion workflow. The import pipeline also
  forces new model output to `proposed` and cannot self-promote it. Rights-based flags (`requiresReview`
  on the local MKB companion) are legal blockers, not content reviews, and remain in place. The public
  demo build temporarily passes `--include-unreviewed-knowledge`, which makes proposed records searchable
  without changing their review status; remove the flag after the demo.
- Exact RLS MKB links use the dedicated `professional-reference` authority tier. They remain
  `reference-only` rather than treatment recommendations, but are included in the lexical knowledge
  index because their evidence points directly to the RLS MKB page.
- Interrupted module downloads persist partial bytes in IndexedDB. Failed/interrupted installs remain
  in a durable local queue, recover after restart or catalog refresh, and retry transient failures,
  including temporarily missing release assets, without prompting. Retries use a bounded attempt,
  release one of the three document slots, then requeue; checksum and validation failures stop until
  the user explicitly retries. The download panel shows live transfer, queue position, offline wait,
  scheduled retry, and permanent failure states, with per-task and bulk cancellation/retry controls.
- Clinical snapshot artifacts stay on GitHub Releases for archival download, but the browser installer
  rewrites them to the CORS-safe `datasets/<snapshot-tag>` mirror branch on
  `raw.githubusercontent.com` (`apps/app/public/content/clinical/*.db`). Publish via
  `scripts/publish-clinical-datasets-branch.sh` (also hooked into `publish-clinical-snapshot.yml`).
- GitHub Actions no longer stores APK or SQLite binaries as run artifacts: release jobs publish those
  binaries only as GitHub Release assets, while Actions artifacts retain only diagnostic reports,
  manifests, checksums, and benchmark evidence. A scheduled/manual cleanup retains the newest three
  completed runs per workflow and never targets active runs, releases, release assets, caches, or
  environments.
- The runtime fingerprints actual module versions, digests, URLs, checksums, and sizes rather than only
  comparing catalog counts.
- Regulatory catalog rows resolve Russian document titles, revision dates, and current/historical status;
  document readers render structured tables as HTML tables rather than image blocks, with a compact
  inline view and a full-screen overlay for wide tables. The current 192н
  pilot artifact is still a source-linked summary without the official specialist-visit schedule table;
  that content gap must be filled from a reviewed full source before it is used as a clinical schedule.
- Browser artifact QA and the Pages build can set `VITE_CONTENT_BASE_URL` to the remote
  `apps/app/public/` root and `VITE_USE_LOCAL_MODULE_ARTIFACTS=false`; this fetches packaged databases
  and catalog modules from their published remote URLs without relying on local `public/content` copies.
- A unit gate verifies that catalog checksums and sizes match every thematic database hosted from the
  repository.

## Verified baseline

The 0.6.0 public starter pack rebuild contains:

- 15 documents, 58 sections, 58 chunks, and 31 clinical aliases;
- SQLite integrity `ok`;
- zero foreign-key violations;
- 58 deterministic embeddings.

The current benchmark contains 61 Russian clinical, medication, and realistic doctor-workflow
retrieval cases:

- every expected document is found in the first five results;
- all 61 expected documents are ranked first in all-source mode;
- section recall and top-section accuracy are both `1.00`;
- the pediatric ceftriaxone workflow ranks the exact ceftriaxone registry title first and the pneumonia
  recommendation second in all-source mode; medication scope removes the unrelated clinical document;
- exact context, section, and source-metadata resolution remain release gates.

Chromium coverage includes search onboarding, source scopes, the history drawer, mounted-route state,
document reading, source-context expansion, module lifecycle, responsive navigation, personal notes,
and follow-up reminders.
A browser QA pass also verifies that HTML or other non-SQLite responses at packaged database paths are
rejected before WASM deserialization, so missing optional assets no longer block core boot; a missing or
corrupt `core.db` fails boot with `Не удалось открыть ядро MiniMed` instead of an embedded JSON
seed fallback.
The local 0.6.10 gate includes 26 Chromium flows; the large-model download and standalone dev-server
smokes remain intentionally conditional. CI and Android artifact verification run from the release
head.

A preliminary full-corpus model experiment indexed 744 structured clinical recommendations plus the
regulatory pilot: 747 unique documents and 92,320 searchable chunks. Qwen3 0.6B passed the mechanical
contract validator on 4 of 20 cases, QVikhr 3 1.7B on 3 of 20, and Vikhr Qwen 2.5 0.5B on none.
Exact-quote validation did not establish semantic relevance, so no tested model is qualified for
clinical answers. The complete reproducible report lives beside `packages/tester-box`.

A cents-scale Replicate knowledge-extraction pilot is configured for four public starter-pack excerpts.
It has a hard estimated cost cap of `$0.25`, persists no raw model prose, accepts only proposed records,
and records schema validity plus exact-evidence-quote rate. A separate one-file OCR pilot writes only a
review-required intermediate draft. Neither pilot has been run with provider credentials.

### Reader lookups and core reload lifecycle

- Full-source readers and search source context now use the same inline-link matcher and popover.
  Definitions show their source and retain its exact anchor, including when the source first needs
  downloading. Medication previews show source formulations, strength with its denominator, route
  when supplied, and an explicit distinction from a dosing regimen. Opening or dismissing the
  preview preserves the reading location; full cards remain available for additional presentations.
- OPFS workers hold a browser Web Lock for the pool until worker termination. A reloaded document
  waits for the old worker to release its synchronous file handles; the shared owner also remains
  registered until an in-process close finishes. An OPFS-backed core declares direct search execution:
  SQLite already runs in its owner worker, and opening another core inside the search worker would
  wait on the live owner's exclusive pool. The browser regression reloads the real core three times
  and searches afterward; the worker test covers reopening while the last lease is still closing.

### Runtime retrieval benchmark — initial baseline

- `bun run benchmark:runtime` exercises MedicalCore and the application's scope filtering against
  SQLite, without prototype scoring or generation. The 11 targeted cases pass retrieval, exact source
  context, form/strength/route, negation and Cyrillic ICD checks in both core-only and installed modes.
  For the six cases with an expected document, recall@5 and MRR@5 are both 1 in each mode.
- Download verification remains a failing gate: 9 of 10 checked core-only queries and 4 of 10 checked
  installed queries contain a pointer whose target is neither installed nor declared in catalog
  document membership. The installed contract run uses the local unified medication database and
  recommendation `kr.rf.1006_1`. Exact module membership must be supplied from validated published
  artifacts before those pointers can pass; module names alone are not treated as evidence.
- The separate 500-query prototype shares its fixture generator with `--fixtures=rag500`. The runtime
  comparison evaluates 380 official-source queries per edition and explicitly reports 120 excluded
  calculator/personal queries belonging to other application surfaces. See [SEARCH.md](SEARCH.md)
  for commands and report interpretation.
- The completed 760-evaluation lexical run measured recall@5 of **205/380 (53.95%)** with core alone
  and **210/380 (55.26%)** with local unified medications, ambulatory, MKB, reference and regulatory
  packs. MRR@5 was 0.4896 and 0.4817 respectively. Exact-context errors were zero in both editions.
  Download membership remained unverified in 343/363 checked core-only queries and 175/341 checked
  installed queries; a query fails this gate if any returned pointer lacks verified membership.
  These are the listed local packs, not the complete 744-recommendation corpus. The report is
  `data/build/runtime-rag500-report.json`; its input checksums and fixture audit retain the exact
  corpus and query set. All 500 generated queries are identical before and after graph projection.
  Retrieval relevance and published package membership remain open gates; the prototype's ranking
  results must not be reported as application quality.
  In this run, medication recall fell from 70/70 to 47/70 after adding packs, while symptom queries
  remained 0/60 in both editions. Document-title queries improved from 0/35 to 12/35 and exact-source
  phrase queries from 0/35 to 7/35. These cohorts need separate coverage and ranking investigation.

## Known limits

- Clinical starter documents are concise source-linked cards; the separately installable snapshot
  contains the official structured recommendation text, headings, tables, and embedded figures.
- The selected oseltamivir instruction still requires reviewed OCR; the clinical recommendation
  snapshot no longer depends on PDF OCR.
- Text-layer drug PDFs can still lose visually distinct subheadings that use the same font size as
  body text. Preserved layout metadata prevents list continuations from absorbing adjacent text, but
  complex layouts still require reviewed structure extraction before publication.
- The PDF reader now bounds page rasterization, cancels offscreen renders, and releases inactive
  canvases promptly; a 160-page Android stress scroll completed without a WebView crash, while
  broader large-PDF memory qualification remains a release follow-up.
- Scroll-driven app-chrome hiding is scoped to generic document readers; CT/MRI and ordinary
  application pages keep their normal navigation chrome.
- Medication registry cards establish identity, form, strength, and registration status; they do not
  establish a verified regimen.
- The GRLS `data/build/medications.db` pipeline proof is still one-drug; it is not the local Allmed
  catalog. Allmed cards are reference snapshots, not verified dosing. Similar products, normalized
  dosing facts, ATC classification, and additional dosage forms remain absent from the official
  instruction pack.
- The verified ESKLP archive is available through fifteen preview identity modules and the bundled
  core's lightweight pointers. It remains metadata-only (`trustedDoseData: false`): neither the
  preview modules nor the core establish a verified dose or indication corpus.
- The MKB companion is a local-dev reference pack: the full-detail crawl is network-heavy and must be
  explicitly requested, while its code-to-medicine relations remain proposed/reference-only rather
  than treatment guidance. The public AJAX endpoint is used for forms and manufacturers; raw HTML is
  not bundled.
- The local RLS MKB companion is a classification/reference index with sparse downloaded detail
  content and medicine mentions, not a complete drug-instruction or dosing corpus. The local GRLS
  instruction builds are selected/current samples rather than complete coverage. There is no released
  deterministic linker yet from exact terms inside instructions (for example, `синдром Жильбера`) to
  stable local condition cards, and ambiguous abbreviations are not context-disambiguated.
- The published corpus still lacks complete verified drug instructions, legal/normative material,
  vaccination calendars, nutrition, growth, development, and calculation-rule sources. The complete
  clinical-recommendation snapshot is not yet a complete physician knowledge base.
- A separate Allmed packaging-image pack is built locally with 4,214 images and 4 rejected source
  references; its exact local ZIP/index artifacts are recorded in
  [DRUG_KNOWLEDGE_PIPELINE.md](DRUG_KNOWLEDGE_PIPELINE.md). It is not published or in the application
  catalog because the source terms require written permission for copying, distribution, and
  publication while the footer is contradictory, so the pack remains local-dev only and packaging
  images remain outside the production core. The Settings card, module installer/remover, installed
  source-assets resolver, image checksum validation, and medication-reader rendering are already
  implemented and activate when an authorized catalog entry is supplied. Dose/indication coverage and clinical-grade
  diagnostic/dose validation are also not complete. The larger generated clinician-query benchmark
  for Recall@5, MRR@5, and section recall remains pending.
- The full GRLS export has no confirmed ATC field, so most catalog records remain visibly unclassified.
- The installed corpus must abstain from dose output when no supplied source contains the exact regimen.
- Small local models can satisfy a JSON shape while citing semantically irrelevant exact text; the
  20-case tester-box result is a screening benchmark, not clinical qualification.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- The ECG photo tool has experimental automatic waveform extraction for the fixed 3x4+1R layout,
  but still falls back to manual calipers when its quality gate does not pass. Its adult-alpha rule
  layer does not infer morphology, rhythm, infarction, or bundle/AV block from intervals alone.
  Complete RBBB/LBBB hypotheses require explicit clinician-entered morphology and are worded as
  review-required patterns rather than diagnoses; automatic morphology extraction, full
  perspective/layout correction and clinical validation remain absent. No diagnostic CNN is shipped
  or accepted by the ECG bundle validator; candidate classifiers remain documentation-only.
  A patient-disjoint direct-image ResNet18 experiment was subsequently trained on 21,251 adult
  PTB-XL synthetic 12x1 renders (folds 1-8/9/10, with all patients behind three real-phone holdout
  ECGs excluded). It reached test macro-AUC 0.912 and macro-F1 0.727, and its exported ONNX matched
  PyTorch on the nine phone files within 0.000192 probability. This did not transfer to real PM-ECG-ID
  photographs: three base ECGs photographed by iPhone, Samsung and Doogee produced only 2/9 exact
  multi-label matches, micro-F1 0.444, zero NORM recall (0/6), six MI false positives and three CD
  false positives. EXIF-orientation correction and a grid-crop recheck did not change the rejection.
  The same three ECGs as clean renders matched 2/3, isolating a material synthetic-to-phone domain
  shift. The candidate is therefore rejected for runtime integration and probability fusion; the
  reproducible scripts and measured report are under `tools/ecg-cnn/`, while weights remain outside
  Git with SHA-256 recorded there.
  The downloadable Ribeiro 1D ResNet was reproduced locally from its checksum-matched official
  weights. On the authors' 827-record test artifacts, the selected seed retained macro-F1 0.925 and
  macro-AUROC 0.998; averaging ten published seeds without refitting thresholds reduced macro-F1 to
  0.900 despite a small average-precision gain. On the existing 20-record MiniMed smoke set, the
  native 500 Hz signal found both available sinus-bradycardia labels but missed the one AF label;
  after the 100 Hz/3x4/Open-ECG path, both the selected seed and mean-of-ten ensemble found none of
  the three available positive target labels when short segments were kept at their real times.
  Repeating each 2.5-second segment recovered only one bradycardia and still missed AF. This small,
  label-sparse smoke is not a general sensitivity estimate, but it rejects Ribeiro and a naive
  same-family ensemble as ready diagnostic heads for the current photo representation.
  On 20 licensed ECG Image Kit images, matching upstream sparse normalization and the `0.1` signal
  threshold increased clean-image `usable` results from 6/20 to 9/20 and RR extraction from 17/20 to
  18/20. All 20 synthetic 7° rotations and all 20 affine-skew variants stayed outside `usable`, so
  phone-like geometry still fails closed instead of feeding the rule layer.
  A separate 15-record PTB-XL/PTB-XL+ numeric smoke test found no complete-BBB false positive in
  five NORM controls, but strict AHA RBBB morphology matched only 2/5 CRBBB-labelled 12SL feature
  rows; the published table lacks the core LBBB notch/slur flag. Therefore 12SL-derived feature names
  are not mapped automatically into MiniMed morphology observations, and this small check is not a
  sensitivity/specificity claim.
  OpenECG `boundary_int8.tflite` was also checked as a measurement-only candidate on 15 continuous
  10-second LUDB/QTDB records: pooled six-boundary macro-F1 was 0.951 in the local wiring smoke, but
  QTDB overlaps the model's training domain. On ten held-out LUDB records, zero-padded central crops
  collapsed to 0.066 at 2.5 seconds and 0.097 at 5 seconds. It is therefore not integrated: the
  current photo digitizer exposes short sequential lead segments rather than a reviewed continuous
  10-second trace, and OpenECG rhythm/diagnostic heads remain out of scope.
  PTE-ECG `1.0.0-alpha.1` was also rejected after a fixed 15-record PTB-XL/PTB-XL+ comparison. Its
  QRS and PR mean absolute errors against Uni-G were 52.8 and 48.6 ms, and it detected none of nine
  Uni-G QRS durations at or above 120 ms. The implementation measures QRS from Q peak to S peak and
  derives axis from R amplitudes in I/aVF, so its 1930 extracted features are not interchangeable
  with the equipment-style inputs required by the rules or numeric pack.
  A broader numeric-algorithm review found no permissive ready-made 12-lead rule engine. Construe is
  a real knowledge-based rhythm interpreter but is AGPL/Python; Minnesota/NOVACODE and PEDMEANS are
  useful public rule specifications rather than reusable engines. The public MEANS physician manual
  is the most complete description found of an equipment-style numeric interpreter — lead/global
  measurements, boolean criteria, scoring and suppression rules — but its engine and rule base are
  not open source. The new MIT `ecg-interpreter` 0.1.0 package was rejected because it is single-lead,
  uses unsafe proxy diagnoses, and tests only its own synthetic signals.
  A follow-up search found RECGDT, the closest new executable candidate: its R pipeline converts
  delineated ECG measurements into six disease scores and ships model files, but it remains unsuitable
  for the app because the code is GPL-3.0, the pipeline depends on its own raw-waveform delineation,
  and the training provenance/external validation of the bundled models is insufficient. SCP-ECG v3.0
  and DICOM waveform templates standardize statements, certainty and provenance but do not calculate
  diagnoses; they remain possible future interchange vocabularies rather than engines.
  The official PTB-XL+ split was reproduced locally. ECGDeli was rejected for manual-input training
  after its P/PR/QRS/QT distributions disagreed strongly with both equipment algorithms; Uni-G and
  12SL nearly matched in standard ms/mV. The final adult-only 30-field Uni-G HGB achieved test
  macro-AUC 0.913, macro-F1 0.720 and calibrated Brier 0.090. Without retraining, independent 12SL
  test measurements retained macro-AUC 0.908/F1 0.719, supporting cross-measurer portability. With a
  ±0.10 abstention band the Uni-G test answered 93.6% of class-record pairs at macro-F1 0.755 among
  answered pairs. A reproducible evaluator now executes the exact validated release JSON rather than
  the Python training object and records immutable input hashes plus per-class threshold, calibration,
  abstention, and false-negative metrics. Of 2151 eligible adult 18–120 fold-10 rows, 2130 passed the
  app's complete/in-range contract (16 had a missing feature and five were out of range). It
  reproduced macro-AUC 0.913, threshold macro-F1 0.719, Brier 0.090, 10-bin ECE 0.025, and 93.7%
  coverage at answered macro-F1 0.754. Current abstention remains insufficient for a standalone
  negative conclusion: 403 of 1740 positive pathology labels were confident false negatives (23.2%
  pooled), including 111/530 MI, 96/484 STTC, 122/470 CD, and 74/256 HYP. The pack remains only a
  probabilistic hypothesis above confirmed measurements and rules. The external report is
  `/tmp/minimed-ecg-numeric-release-eval-20260901/report-v2.json`, SHA-256
  `a729197c9aaadb1631852ac052de82fec198bb06799287c1d0f5bed5647ab854`.
  The released JSON inference was also cross-checked on the same 2130 complete adult fold-10
  rows against the independent rule layer: CD captured 164/168 wide-QRS findings but 246/410 positive
  CD hypotheses had QRS below 120 ms; only 94/208 positive HYP hypotheses met Sokolow–Lyon; and
  154/963 positive NORM hypotheses coexisted with at least one literal rule finding. These are
  different scopes, not grounds for model veto. The UI now explains support or mismatch after each
  estimate and never lets a NORM hypothesis hide measured deviations.
  The current browser digitizer was also exercised end-to-end on 15 external images: 4 passed its
  `usable` gate, 10 required review and one failed, with no runtime crash. These images cannot validate
  RR accuracy because many use a recording speed other than the fixed 50 mm/s profile. More
  importantly, the digitizer currently returns waveforms/RR/heart rate but not the 24 P/Q/R/S/T
  amplitudes as validated equipment measurements. MiniMed now derives visible one-complex Q/R/S/T
  drafts from `usable` waveforms and can copy all 24 amplitudes into the numeric form after an
  explicit action, but this heuristic has only synthetic unit coverage plus browser smoke evidence;
  every field stays editable and a complete 30-field form is still required. Independently of the
  probabilistic pack, the numeric form now calls the same pure adult interval-rule core as the photo
  workflow, so manual RR/PR/QRS/QT/QTc input produces explainable findings without an image or model;
  a directly entered Framingham QTc is accepted. The numeric form asks for sex and applies AHA QTc
  review thresholds `>450 ms` for men and `≥460 ms` for women; without sex it keeps the conservative
  `>470 ms` threshold, while `≥500 ms` remains urgent. When QRS is at least 120 ms, ordinary QTc
  classification is suppressed in favor of an explicit QT/JT-correction review finding. It also
  evaluates an optional adult QRS axis and the
  Sokolow–Lyon voltage criterion from S V1 plus R V5/V6, showing the exact measurements and explicitly
  avoiding a negative-LVH claim. The axis threshold was compared locally with strict machine statements in
  MIMIC-IV-ECG: 747,252 comparable rows produced 0.970 sensitivity, 0.915 specificity and 0.608 PPV
  for binary out-of-range agreement. Because missing machine statements are not clinical negatives
  and results vary by `cart_id`, the UI reports only the measured deviation and does not infer its
  cause. On the same source, strict interval-statement agreement was strongest for rate ≥100
  (sensitivity/specificity 0.990/0.997) and PR >200 (0.953/0.987), while QRS ≥120
  (0.927/0.903, PPV 0.451) and Framingham QTc >470 (0.678/0.936, PPV 0.343) confirmed that these
  outputs must remain literal measurements/review findings rather than diagnoses.
  The numeric form now upgrades PR >200 ms to a review-required first-degree AV-delay pattern only
  when the clinician explicitly confirms that every P wave conducts to QRS 1:1; unknown or non-1:1
  conduction leaves the output at the literal prolonged-PR finding.
  It also reports a review-required adult WPW-type ventricular-preexcitation pattern only when
  PR <120 ms, QRS >120 ms and a clinician explicitly confirms a delta wave. Missing/boundary
  criteria abstain, and a complete bundle-branch pattern is suppressed when the preexcitation rule
  is complete because preexcitation itself changes QRS morphology; the UI does not call this WPW
  syndrome.
  A review-required AF pattern is available only after the clinician manually confirms all three
  ACC/AHA ECG observations: RR intervals irregular without a repeating pattern, no distinct
  repeating P waves, and irregular atrial activity/fibrillatory waves. A contradictory 1:1 P→QRS
  observation suppresses the pattern. The digitizer now exports and shows the consecutive RR
  intervals from the full rhythm-II row as an editable automatic draft in addition to median RR and
  heart rate. A 15-image rhythm smoke (3 each NORM, AFIB/AFL, PAC, PVC and TACHY) produced only 6
  `usable`, 8 `review` and 1 `failed` extraction; a conservative short-window irregularity candidate
  fired on two AF examples (only one `usable`), not on the flutter example and not on the 12
  non-AF examples. Automatic AF remains disabled because those image labels do not provide beat-wise
  RR/P-wave reference annotations and the quality-qualified positive sample is far too small.
  A repeated 2026 search found no better permissive numeric diagnostic engine: ECG-R1 exposes a
  simplified generative prompt rather than executable validated rules, ECGomics publishes no source
  pipeline, FeatureDB has no explicit code license or diagnostic layer, and OpenECG's broad rhythm
  output comes from a learned single-lead codec. These remain research comparators; runtime stays on
  confirmed measurements, independent deterministic rules and the separate adult numeric pack.
  A subsequent device-contract audit reached the same implementation boundary. The official Philips
  guide shows that broad apparatus statements depend on representative beat groups plus per-lead
  P/P'/Q/R/S/R'/S'/T amplitudes, durations and areas, QRS notch/delta/VAT, several ST points and
  quality/suppression state; MIMIC-IV-ECG v1.0 exposes only global fiducials/axes and machine text.
  ECGDataKit is a useful Apache-2.0 reference for importing digital ECG formats but contains no
  diagnostic engine. CardioDiag trains global-measurement XGBoost models against patient ICD codes,
  has no reusable weights or explicit repository license, and predicts associated clinical diagnoses
  rather than a formal interpretation of the presented trace. No additional runtime rule was added:
  the next safe expansion is a validated per-lead measurement contract, not another global-score
  heuristic.
  A strict five-field adult LAFB candidate was also preflighted against PTB-XL fold 10 and 12SL
  measurements: it matched only 16/158 LAFB-labelled rows but 0/1,998 negatives. It is now exposed
  only as a positive adult compatible-pattern rule when QRS <120 ms, axis is −90…−45°, qR in aVL,
  aVL R-peak time ≥45 ms and rS in II/III/aVF are all manually confirmed; ventricular origin,
  pacing, pre-excitation or any unknown field suppresses the result. Its absence never excludes
  LAFB. The fixed 15-case image smoke still shows why photo-auto LAFB remains disabled. Separate
  X/Y grid calibration fixed clean amplitude
  gain from 1.772 to 0.945, and a derivative-energy RR detector reduced heart-rate MAE to 1.73 bpm
  on clean and 0.87 bpm on phone-like renders. Clean median lead correlation is 0.981, but phone-like
  correlation remains 0.410; a repeated-lead-II consistency gate now leaves all 15 clean renders
  `usable` while 11/15 phone-like renders require review. The pipeline still cannot supply the QRS
  axis/duration, aVL R-peak time or qR/rS morphology needed by the rule. Photo-derived values remain
  editable drafts, not diagnostic measurements.
  The numeric panel now enforces that boundary in runtime: deterministic findings and the optional
  numeric model remain disabled until the user explicitly confirms that intervals, axis, amplitudes
  and morphology were checked against the source ECG. Importing another draft or editing any checked
  measurement/morphology clears confirmation and removes the findings until they are rechecked.
  A strict adult LPFB candidate was rejected after a PTB-XL+/12SL preflight: on human-validated fold
  10 it matched 4/15 LPFB rows but also 8 non-LPFB rows (specificity 99.63%, PPV 33.3%). Normal/RAD,
  IRBBB and infarct/ST-T records produced the same numeric morphology, so the app does not infer LPFB
  without the unavailable clinical exclusions for other causes of right-axis deviation.
  Confirmed manual beat-sequence observations can now produce five adult AV-conduction patterns:
  Mobitz I requires periodic non-conducted P waves plus progressive PR lengthening; Mobitz II
  requires periodic non-conducted P waves plus constant PR around the dropped QRS; 2:1 is kept as
  its own pattern and is never relabelled as either Mobitz type. High-grade requires at least two
  consecutive non-conducted P waves while some AV conduction remains; complete AV block requires
  AV dissociation and no evidence of P→QRS conduction. The latter two request urgent review. All
  require distinct P waves, non-1:1 conduction, no pacing and explicit exclusion of a blocked
  premature atrial beat. Unknown fields, conflicting conduction/dissociation or PR observations,
  and any missing suppression abstain; a negative pattern is never emitted.
  The numeric panel can now accept ordered P- and QRS-onset times in milliseconds and draft those
  same tri-state observations before clinician confirmation. Applying another sequence or changing
  the event times clears the derived observations, confirmation and findings; pacing and blocked-PAC
  exclusions remain explicit manual inputs. The production TypeScript sequence analyzer plus the
  existing interpreter reproduced the 15 fixed OpenECG oracle-boundary cases 15/15, and the browser
  flow was checked for Mobitz I, complete AV block and stale-draft invalidation. This remains a
  synthetic wiring test, not clinical validation of the heuristic event-association thresholds.
  A further open-source refresh found two useful comparators but no embeddable broad numeric engine.
  RECGDT publishes GPL R code and six `.rds` disease-score models over RR/PR/QRS/Q/QRS amplitudes,
  QTc and ST features, but does not document enough cohort/calibration evidence for clinical reuse.
  Construe is a genuine AGPL knowledge-based rhythm interpreter, but consumes waveforms rather than
  the confirmed numeric contract. The May 2026 `ecg-interpreter` package was rejected because it
  labels STEMI from a single mean ST threshold and complete AV block from rate plus QRS width.
  A newer MIT ECG-Reasoning-Benchmark publishes 6,403 explicit criterion/finding/grounding/decision
  chains across 17 ECG diagnoses and is the best source found for deterministic regression fixtures.
  It is not a runtime engine: its U-Net-based measurement/diagnosis pipeline is unpublished, several
  diagnosis groups were regenerated in pre-release 0.0.2 after systematic issues, and its rule
  thresholds still require independent clinical sourcing before implementation. Its published
  third-degree-AV-block paths also omit separate fields for absence of all P→QRS conduction and for
  two consecutive non-conducted P waves, so they cannot validate the stricter MiniMed rule without
  leaking the target label into the inputs.
  A newer broad Python/YAML `ecg-rule-engine` was also audited locally at commit `84abdf7`; all 45
  unit tests passed and its 138-field adult/pediatric measurement contract is the closest public
  example of the desired architecture. It is not reusable: package metadata declares it proprietary,
  its rules are transcribed from the GE 12SL guide, and its reported PTB-XL comparison uses GE 12SL
  measurements against GE 12SL statements rather than independent clinical truth. Its own
  measurements-only report also leaves beat-dependent AF/flutter/pacing/ectopy paths at zero
  sensitivity and reduces complete AV block to a partial atrial-minus-ventricular-rate surrogate.
  OpenECG's Apache-2.0 synthetic AV generator then closed only the numeric wiring gap: 15 fixed-seed
  clean lead-II boundary cases (Mobitz I, Mobitz II, 2:1, complete block, paced and VT controls)
  matched the production MiniMed sequence analyzer and interpreter 15/15 when they saw only P/QRS
  event arrays and an explicit pacing observation. This is synthetic oracle-boundary evidence, not clinical accuracy;
  it does not validate high-grade block because the upstream Mobitz generators never drop two
  consecutive P waves while preserving some conduction. No generator or external rule engine was
  added to the app; only the derived numeric event contract is used at runtime.
  An oracle perspective-rectification preflight on the same 15 phone-like renders restored median lead
  correlation from 0.410 to 0.980, amplitude gain from 0.411 to 0.987, and made all 15 usable. A naive
  red-grid corner detector was rejected despite 12/15 `usable` outputs because its median correlation
  was only 0.299. Rectification is therefore the next proven image-pipeline layer, but automatic corners
  require a grayscale/background-diverse benchmark before runtime use. The app instead exposes an
  explicit four-corner editor: confirmed normalized corners are validated, perspective-warped locally
  in the digitizer worker, and then passed to the existing segmentation/quality pipeline. Arrow keys
  provide fine adjustment; the original photo remains unchanged.
  The 261,070-byte
  release asset is verified by exact size and
  SHA-256; exported JSON inference matched sklearn on all 2,185 adult test rows, and a real browser
  install/control inference passed. Adult models reject pediatric ECGs.
- The patient vault is browser-tested at the domain/contract level, but native Keychain/Keystore
  failure, memory pressure, and recovery after background suspension still require physical Android
  and iOS device qualification. It intentionally has no cloud sync or server-side backup; portable
  backups are plaintext and require the user's own secure handling.
- Physical Android interruption, memory-pressure, and local-model inference qualification remain release
  follow-up checks even when the debug APK and browser automation are green.
- Personal notes use unencrypted device-local browser storage and are a notebook rather than an
  electronic medical record. Per-card export, a whole-notebook wipe, and local Russian transcription
  are not implemented.

## Ordered next work toward 1.0

The private, resumable `krasotaimedicina.ru` discovery crawl uses Crawlee Python with a persistent
request queue, robots enforcement, bounded same-host paths, raw HTML/image checksums, and per-page
manifests. A preparer/build path exists for repeatable snapshots, but the crawl is still running. Raw
and built output remains ignored private data with `rightsStatus: unresolved` and
`publicationState: blocked`; it is not a publishable MiniMed content pack.

1. Grow the content bank before further retrieval/model work — see [CONTENT_DATA_PLAN.md](CONTENT_DATA_PLAN.md)
   for the full cross-category priority list (regulatory acts, pediatric norms/calculators, assessments,
   diets, nutrition/feeding norms). A personal textbook library under `Med/` is an acceptable cited source
   per book/edition/page ([LITERATURE_BANK.md](LITERATURE_BANK.md)) — MiniMed itself is never the cited
   source — but redistribution review still applies before any extracted table or excerpt publishes.
   Anything uncertain found while extracting goes to [LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md)
   for review rather than being silently trusted. In the same content phase, expand official GRLS
   instruction coverage and extend the current recommendation terminology layer: classification
   IDs/hierarchy, synonyms, eponyms, abbreviations, sourced concept explanations, and exact
   source-mention links from instructions to local concept cards. Do not create a second glossary
   database or treat an RLS MKB medicine mention as dosing/treatment authority.
2. Verify the 0.6.10 prerelease on a physical Android device, including system-bar insets, native Back,
   locally scheduled
   notifications, note-image persistence, and the published Pages `/app/`.
3. Build and qualify the missing dose/indication corpus from source-backed rules, including
   clarification/abstention behavior; resolve Allmed packaging-image rights before considering a
   distributable/cataloged module, while keeping image assets outside the core database.
4. Add verified OCR for the blocked drug instruction.
5. Expand real Russian clinician-query, unsupported-answer, and source-scope benchmark coverage.
   The 70-query medication regression after pack installation is fixed. Use `benchmark:runtime` to investigate
   symptom/phrase misses, and missing published document membership before claiming retrieval quality.
6. Add explicit export and whole-notebook deletion, then evaluate an optional downloadable Russian
   on-device transcriber.
7. Qualify bundled local models on citation fidelity, abstention, latency, storage, and memory before
   presenting diagnostic assistance as a 1.0 capability. For ECG, qualify the digitizer and
   deterministic measurement/rule pipeline on licensed phone-photo fixtures, compare the integrated
   numeric pack with independent Minnesota/AHA/MEANS-derived rule specifications, and test manual
   measurements on an external adult population. Diagnostic CNNs remain research-only. LearnECG
   remains an external manual smoke-test source until redistribution permission is explicit.
8. Keep GigaEmbeddings benchmark-only until a physician-authored real-corpus benchmark shows a gain
   over the current hybrid and the locally verified Q8_0 conversion has an immutable hosted artifact
   plus Android parity, latency, memory, storage, battery, and thermal qualification. The public pilot
   currently shows one Recall@5 regression when Giga is added with the existing fusion weights. Keep
   the deterministic/hash hybrid and lexical fallback.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.
