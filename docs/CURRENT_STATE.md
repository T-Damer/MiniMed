# Current state

> Updated: 29 September 2026
> Released version: `0.6.44` (public prerelease toward `1.0`)
> Next planned step: finish the pending WebView features and ship the last WebView release; the
> native port (`native/`, Kotlin + Compose) is kept and resumes after that release (user decision,
> 2026-09-29).

This file records what exists now, its trust boundaries and the ordered next work. Keep it short:
append dated measurements to `docs/state/` or `docs/research/`, and link them from here. The target
architecture and acceptance gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

Detailed history, moved verbatim on 2026-09-24:

- [state/branch-log-2026-09.md](state/branch-log-2026-09.md) — dated PR #174/#180 entries
  (definition reference R1–R2, source intake, spelling, reverse definitions, RapidFuzz).
- [state/implemented-0.6.39.md](state/implemented-0.6.39.md) — implemented behaviour, verified
  baseline and runtime benchmark up to the 0.6.39 release.
- [state/ecg-research-log.md](state/ecg-research-log.md) — ECG digitizer, rule layer and every
  measured or rejected model/engine candidate.

## Unreleased — toward the last WebView release

- **Medication card after a reload.** Opening a product from «Препараты» saves it with the
  document's history entry, so a reload or back/forward keeps the trade name, presentation and the
  short/instruction switch. The saved product is validated before use; a queued catalog handoff
  still forces a fresh load, a restored one does not. `e2e/medication-reload.spec.ts` fails
  without the fix.
- **EPUB chapter jumps.** In continuous mode `display()` resolves before epub.js finishes
  rendering neighbouring chapters, so the chapter visibly passed through several positions
  (≈4284 → 6521 → 4389 px). The reader now hides the text while the target's position is still
  moving, aligns once it has been still for six frames (at most 1.5 s), then fades in. Wheel or
  touch — also inside the chapter iframes — hands control back to the reader immediately.
- **Compact catalog membership.** `catalog.preview.json` shrank from 12.6 to 5.8 MB and
  `catalog.terminology.json` from 5.5 to 2.1 MB: both are minified and store membership as a
  compact `documentTable` that the schema expands into the same `documents` (the parsed catalogs
  are deep-equal to the previous ones). All catalog writers use `serializeContentModuleCatalog`.
  Installed 0.6.44 and older read a refreshed remote catalog without membership until updated.
- **RLS packaging module listed.** `minimed.rls.packaging.ru` 2026.9.28 (preview, optional; 7 181
  brand documents, 29.2 MB gzip) is in `catalog.preview.json` (now 7.4 MB) with the release asset
  `reference-rls-mkb-2026.9.28/minimed.reference.rls-packaging.2026.9.28.db.gz`, whose size and
  SHA-256 match the published GitHub asset; the Pages mirror list includes it.

## Definition reference data — edition 2026.9.30 (published 2026-09-28)

- Fixed the ~596-record `Список сокращений` mislabeling bug (`scripts/extract_prepared_definitions.py`)
  and a trailing-punctuation over-splitting bug in the KR glossary/abbreviation dedup key; catalog
  description now reports real per-type counts instead of one lumped figure. Abbreviation-list parsing
  is shared with `clinical_aliases.py` (core search aliases unchanged). The specialized-source verbatim
  quote budget (`clinic_definition_completions.py`) is 1024 words for msdmanuals.com (was 25, still 25
  for consumer sites); a measured rebuild with 3 real MSD quotes added ~4.1 KB installed / ~2.7 KB gzip
  per entry, comfortably inside the accepted growth range even at full high+medium priority volume — see
  `research/definition-quote-budget-2026-09-27.md`. Local edition `2026.9.30` has 31 488 entries (8 585
  clinical definitions, 8 369 abbreviation expansions, 6 939 Wiktionary glosses); verified, all 23 279
  source name surfaces found. 7 141 names still need an external source, priority-scored in
  `research/definition-gap-priority-2026-09-27.json`; a 454-pair same-title review queue has no
  auto-merge. Separately, `catalog_module_builder._map_reference_aliases` no longer collapses a
  polysemous MKB-code alias (e.g. ОНМК, ХСН) to one arbitrary document — 9 218 of 12 432 raw
  diagnosis-category aliases were affected; fixed and tested, `core.db` not yet rebuilt (see
  `research/diagnosis-alias-ambiguity-2026-09-27.md` for scope and the missing-merge-step blocker).
  Details: [research/definition-reference-2026-09-29.md](research/definition-reference-2026-09-29.md).
  The missing-merge-step blocker is now resolved and scripted (`bun run content:core:build`,
  `scripts/build-core.mjs`): three independent pointer tracks (reference/clinical/medication)
  reproduce the released core.db's exact document counts (15,904/744; medication's ledger has
  grown past the released 3,324). `core.db` not yet rebuilt/published; see
  `research/core-build-reconstruction-2026-09-27.md` (pipeline, profiling, gated pilot removal).

## Krasota i Meditsina disease module — built 2026-09-28, not yet released

- User decision (2026-09-28, see `REFERENCE_SOURCE_POLICY.md`): the krasotaimedicina.ru snapshot
  is distributed as an experimental module despite unresolved source rights; documents keep
  `rightsStatus: unresolved`, `crawlPublicationState: blocked`, source URL, `fetchedAt`, raw
  checksum and `requiresReview: true`. Not clinically reviewed.
- `bun run content:module:krasotaimedicina` prepares the unchanged 2026-09-04 crawl (20 926 records,
  crawl finished; 6 068 articles), builds a lexical pack and packages it
  (`medbase package-krasotaimedicina`): 6 068 documents, 58 056 sections, 73 148 chunks,
  629 829 632 bytes installed, 142 650 749-byte gzip, text only. Module id
  `minimed.reference.krasotaimedicina.ru` 2026.9.28, `releaseState: preview`, `minAppVersion` 0.6.44.
  The released core's pointers still name the unpublished `minimed.mkb.ru` (kept for the RLS MKB
  pack); from 0.6.44 `selectModuleForPointer` falls back to any released module whose verified index
  lists the exact target. The packager checks every krasotaimedicina pointer against the module's
  membership: 6 068/6 068 targets present with identical document version ids and definition
  anchors. The 9 836 RLS MKB pointers are covered by the separate `minimed.mkb.ru` module below.
- Distribution: data prerelease `reference-krasotaimedicina-2026.9.28`, mirrored to Pages by the
  existing `MIRRORED_DATA_RELEASE_TAG` list (about 820 MB of the 1 GB Pages site). The generated
  catalog entry adds 3.1 MB to `catalog.preview.json`.
- Open risks: the one index is 143 MB gzip / 630 MB SQLite (the contract allows one index per
  module, so no split); installation holds both in memory before the OPFS copy, which is
  unqualified on Android. Article images still point to the source site.

## RLS MKB-10 modules — built 2026-09-28, not yet released

- User decision (2026-09-28, see `REFERENCE_SOURCE_POLICY.md`): the 2026-08-14 RLS MKB snapshot is
  distributed as two experimental modules; documents keep `rightsStatus: unknown`, their `rights`
  block, source URLs and response checksums. Not clinically reviewed.
- `bun run content:module:rls-mkb` splits the existing scrape workspace without refetching
  (`medbase split-rls-mkb`), builds both packs and packages them (`medbase package-rls-mkb`).
  - `minimed.mkb.ru` 2026.9.28: 9 835 code pages plus the classification index (9 836 documents,
    49 183 sections, 51 335 chunks), a classification path (category → block → chapter) derived
    from that index, 18 929 aliases, 19 121 knowledge entities, 51 206 `listed-on-rls-mkb-page` and
    6 986 `active-ingredient-of` relations with exact evidence, 9 286 medication profiles (forms and
    strengths, no packaging rows). The medicine section lists names/INN/RLS links only.
    294 768 640 bytes installed, 53 529 648-byte gzip (the local-dev `mkb.db` was 1 501 626 368).
    Document versions, the code/synonym/limitation sections and every chunk outside the medicine
    section keep their ids and anchors; all 9 836 core pointers and their 17 013 cited
    classification anchors resolve.
  - `minimed.rls.packaging.ru` 2026.9.28 (optional): 7 181 brand documents with 7 185 source tables
    (260 022 rows, unchanged), linked by `medicationEntityId` ↔ profile `packagingDocumentId`;
    221 089 792 bytes installed, 29 206 386-byte gzip.
  - Lexical search over the code pack finds `J18.9`, `J189`, `J18 9`, Cyrillic look-alikes such as
    `Е11`/`К29.7`/`А00.0`, synonyms (`ЦВБ`, `внебольничная пневмония`) and titles at rank 1.
- Distribution: one data prerelease `reference-rls-mkb-2026.9.28` with both assets; the Pages
  mirror needs that tag prefix and grows to about 900 MB of 1 GB. Both catalog entries together
  add about 8.6 MB of membership to `catalog.preview.json`. The installer accepts only gzip; brotli -q 11
  would be about 45% smaller (29.1 + 16.5 MB instead of 53.5 + 29.2 MB) but needs a decoder change. The app has no link yet from a profile's
  `packagingDocumentId` to the packaging document.

## Core coverage audit — 2026-09-28 (measurement only)

- `benchmark:core-coverage` (`tools/benchmarks/src/run-core-coverage.ts`, seed 20260928, 3,850
  queries) searches `core.db` alone through the app's lookup path. KR titles and INN reach 100%
  correct@5. ICD codes reach only 46% because the released pointers do not index sub-codes and the
  legacy fallback assumes chapter I; the candidate rebuild reaches 97.5–99.5%. All 15,904 MKB and
  krasotaimedicina pointers were dead ends at measurement time; the 6,068 krasotaimedicina ones
  resolve from 0.6.44 (module c6b63b6b, membership fallback 044ef7a7), the 9,835 MKB ones still do not. Terms reach 16%,
  normative acts 0% (90% with the bundled `regulatory.db`), and tools 100% through the client-side
  catalog. Findings and the size/risk proposal:
  [research/core-coverage-2026-09-28.md](research/core-coverage-2026-09-28.md).
- ICD fallback fix (2026-09-28): the legacy ICD query keeps the typed chapter letter (Cyrillic
  look-alikes mapped) and adds the three-character parent token instead of assuming chapter I. On
  the released core alone, correct@5 for «J18.9»-style codes rose from 46.0% to 96.5% and for
  «J189» from 46.0% to 99.0%; benchmark:all within tolerance, doctor-lookup 0.70/0.60 unchanged,
  lookup-quality Top-1 1.0. Downloadable (actionable) ICD results stay 7–15% until an MKB module
  ships.

## Knowledge graph («Карта связей») — 2026-09-27

- Experimental module (follows the experimental setting like «Словарь»). Opens on at most 300
  documents (query results plus shared areas, or an area-balanced sample) with «Показано N из M»;
  «Показать все» draws the whole scope. Layout runs in a Web Worker (Barnes–Hut, grid collisions,
  cluster separation; static grid above 500 nodes); the main thread only draws cached paths.
  Headed 165 Hz measurement: pan/zoom frame p95 <= 3.6 ms in every scenario (20 040 documents
  included), 0% node overlap after convergence. 14 missing area labels were added. Details:
  [research/knowledge-graph-performance-2026-09.md](research/knowledge-graph-performance-2026-09.md).

## Search while the core is not ready — 2026-09-28

- Only the shell load and a missing core waiting for download consent (metered network) keep a
  separate screen; first-run setup is unchanged. Opening, verifying, another tab holding the
  database, open errors and later core downloads keep the search page mounted (not remounted when
  the core arrives): the field is disabled with the status as placeholder and a compact line shows
  progress or the error with «Повторить»; tools that need no core work at once, «Словарь» waits
  (`search-core-status.ts`, `SearchCoreStatusNote`). E2E boot-screen, core-reload, startup-shell and
  unified-downloads pass (the last two had failed since 0.6.40).

## Start-up and patients polish — 2026-09-28

- Start-up keeps one ground from the Android splash to the first view: the post-splash window and
  the WebView use `splashBackground` (light `#F3ECD9`, night `#2D2721`), the page before render and
  the boot screen use the same surface, and the first view fades in once (0.2 s, none with reduced
  motion). A quick core open shows only the field placeholder; the note under it appears after
  400 ms. The native part needs verification on a physical device.
- Patients: device-key and existing vaults open without a dialog (ADR-0016 unchanged); the dialog
  appears only when the user must act (browser warning, «Открыть» for a plaintext vault, Keystore
  error). The blurred sticky-header layer now paints behind every header control, and route desks
  hold one viewport of folder tint instead of stretching with the content height.
- Home: no greeting. The search field leads the page; the tool row and «Полезные функции» follow
  it on a quieter surface and fold away once a search starts. The carousel (`components/Carousel`)
  has equal-height cards, arrows on the card edges, position dots («Функция 2 из 4»), and autoplay
  that pauses on hover or focus, stops once the user swipes, presses an arrow or a dot, and is off
  with reduced motion; it opens on today's capability. Capability cards carry a second action as a
  second button and «Как это работает» as a round «?» (`HelpIconLink`). The field holds only the
  input, source picker, «Клинический разбор» and a round send button; clearing is a × inside the
  field, and «Карта связей» sits in the top row beside «Случайная запись». All home blocks share
  one spacing step (`--home-gap`, 1 rem / 1.25 rem).
- While the core opens, its status shows once: the note under the field (with progress) or, for
  the first 400 ms of a quick open, the field placeholder. «Мои файлы» lists «База знаний» as a
  root folder when the navigation has no tab for it (separate tabs off, or the core not ready);
  folders that cannot be deleted carry a pin.
- Notices about something the user now has (a downloaded example, an added file, a created PDF,
  a recording attached to a patient) carry a link-styled «Открыть» that opens exactly that item
  (`components/notify.ts`); the CT example no longer jumps to «Заметки» on its own.
- Downloads the user starts by hand end with the same notice: a calculator or its section, a
  questionnaire or its section, a document set or a whole catalog section, and ECG recognition
  from Settings; «Открыть» leads to what was installed (`catalogGroupHash`, `moduleCatalogHash`).
  Background updates and restored downloads stay silent.
- Readers (official document, medication card, file from «Мои файлы») share one header
  «Меню действий» (`ReaderActionsMenu`: «Печать», the reader's own actions, «Сохранить в
  коллекцию») and one bookmark in front of the title (`ReaderTitleRow`); both open the same
  collections panel. Saved personal files reopen in the personal reader.

## Release 0.6.44 — 2026-09-29

- **Reference modules become reachable.** `minimed.reference.krasotaimedicina.ru` and
  `minimed.mkb.ru` (RLS MKB-10) are listed as preview modules (minAppVersion 0.6.44); pointers
  resolve through exact membership (`selectModuleForPointer` fallback). The RLS packaging module is
  released as an asset but not yet listed (no UI link; catalog membership needs a compact format —
  the catalog is 12.6 MB with these two).
- **Search:** ICD chapter-letter fix (core alone: dotted codes 46% → 96.5% correct@5). Fixed the
  ASR download (transformers 4 `main` probe) and the Android WebView OOM on broad queries (paged
  navigation catalog).
- **UI:** collections and bookmarks, reader actions menu, calm start-up, patient vault without a
  flashing dialog, home carousel and spacing, «База знаний» entry and folder pins, «Открыть» in toasts.
- Corpus unchanged. Signed with the persistent prerelease key.

## Release 0.6.43 — 2026-09-28

- **Persistent APK signing.** Up to 0.6.42 every release was signed with an ephemeral CI debug key, so
  no release could be installed over another. From 0.6.43 the release workflow signs with one PKCS12
  key from repository secrets and fails on any other certificate; see `RELEASES.md` «Android
  signing». Users of 0.6.42 or older reinstall once.
- **«Разделы» on the empty home** (`SearchSectionsOverview`, `sections-overview.ts`): six sections
  with one/few/many worded counts declared in `SEARCH_SECTIONS`.
- Corpus and packs unchanged; `verify` passes; section-related e2e 59 passed / 1 skipped (serial).
  The `tool-hydration` and `search-section-downloads` failures noted under 0.6.42 were stale specs,
  fixed after this release.
- **Speech model download (fixed after 0.6.43).** Since df6448a3 (transformers.js 4.2) the Whisper
  download failed with «Unsupported speech asset URL»: transformers 4 probes `config.json`,
  `tokenizer_config.json` and `preprocessor_config.json` at `resolve/main/` before honouring the
  pinned `revision`, and the worker's host/revision guard rejected them. The worker now maps that
  probe onto the pinned revision; the guard is unchanged.

## Release 0.6.42 — 2026-09-28

- **App-only release over the 0.6.41 corpus.** `core.db` and the companion packs are unchanged; the
  rebuilt candidate core (`bun run content:core:build`) is not shipped because doctor-lookup on it is
  0.60/0.45 (recall@5/MRR@5) against 0.70/0.60 on the released core. A wider per-branch window and a
  targeted identity backfill were measured and rejected
  ([research/search-kr-pointers-vs-mkb-2026-09.md](research/search-kr-pointers-vs-mkb-2026-09.md)).
- **Definition reference `2026.9.30`** is published as the `definition-reference-2026.9.30` data
  prerelease (42 173 697-byte gzip, 192 323 584 bytes installed, 31 488 entries) and replaces
  `2026.9.27` in `catalog.preview.json`; `minAppVersion` stays 0.6.41.
- **Home, startup, search ranking, medication card, «Словарь» and graph** changes are listed in
  `CHANGELOG.md` [0.6.42].
- **Verification.** `bun run verify` and `benchmark:real:release` pass. Full serial Web E2E: 105
  passed, 8 failed, 6 skipped of 119. The section-menu specs were stale after the new home and pass
  once updated; `module-pointer` passes when rerun alone. `tool-hydration` (both variants) and
  `search-section-downloads` (375/1280) failed the same way on a v0.6.41 build; both specs were stale
  and were fixed after 0.6.43. `tool-hydration` still expected a fresh profile to auto-install tool
  packages, which e72af7f8 deliberately stopped (optional packs install only on «Скачать»).
  `search-section-downloads` lost its menu when `hover()` scrolled the page at 375 px, and its
  25-second assertion raced the 423 MB core open that package status waits for.
- **Native spike.** `native/` holds a Kotlin Multiplatform + Compose Multiplatform search page over
  the same `core.db` (ADR-0021) for a device speed comparison with this release's WebView; it is not
  built by CI or shipped.

## Release 0.6.41 — 2026-09-27

- **Experimental definition reference and data-release mirror.** Everything that previously worked
  only in DEV now follows the experimental-modules setting (default on). The draft dictionary
  edition `2026.9.27` (16 069 entries, 27 003 687-byte gzip, 127 369 216 bytes installed; verified
  by `scripts/verify-definition-reference.ts`: all 12 644 source names found) is built with
  `prepare-definition-reference.py --publication-state experimental-preview --artifact-url …` and
  advertised from the `definition-reference-2026.9.27` data prerelease. Release hosts send no CORS
  headers and the old resolver rewrote such URLs to a nonexistent raw-`main` path (terminology
  downloads returned 404 since 0.6.39), so `terminology-*` and `definition-reference-*` assets are
  now read from the Pages mirror (`content/releases/<tag>/<file>`, absolute on native builds) via
  the shared `releaseAssetMirrorUrl`; `landing-pages.yml` mirrors exactly the assets the catalogs
  advertise (`scripts/list-mirrored-release-assets.ts`), verifying size and SHA-256 (~64 MB; the
  Pages site stays ≈677 MB of 1 GB). Definition drafts remain DEV-only.
- **Search home widget, favourites and tool collections.** The welcome block (greeting, key tools
  and the ECG photo entry, previously a separate card) collapses once typing starts; a compact
  «Мои инструменты» row stays above the field with favourite chips and a menu: favourites first,
  then user collections drawn as the same folders as «Мои файлы» (shared `FolderFigure`), then
  built-in tools (conversation recording, term dictionary, ECG). Any catalog calculator or
  questionnaire can be starred or added to several collections from its card; collections can be
  created, renamed and deleted. Data lives only on the device (`state/tool-collections.ts`, stable
  tool ids); ids missing from the catalog stay listed as «Недоступен». Full personal-notes backups
  carry favourites and collections as an optional v1 field; card handover backups do not.
- **Section menu stability.** Opening the menu focused it without `preventScroll`, so the smooth
  page scroll immediately triggered the release's close-on-scroll and detached its rows. It now
  focuses without scrolling and closes on scroll only once its trigger leaves the viewport.
  E2E (`--workers=1`): search-dropdown 2/2, tool-collections 2/2, search-ui-revision 4/4 (the
  long scenario now dismisses the modal patient-vault dialog with Escape, as a user would).
- **Search latency.** Clinical analysis no longer re-prepares 44k aliases per query; medication
  aliases are normalized once; Levenshtein runs in a band. `bun run benchmark:search-latency`
  (132 queries, full core, native SQLite): Bun p50 657 → 208 ms. Ranking benchmarks unchanged.
- **Diaries v2 (schema-driven).** Fields (number, choice, multi, flag, count, text, plan) plus the
  doctor's plan. Templates: blood pressure, medication (prescribed list, taken/missed), child
  (feeding plan, amount, weight in g → body mass in kg, sleep, stool flag/count, complaints),
  illness course (temperature, symptoms, medicine), glucose; doctors can build custom diaries.
  Entries default to now and stay editable; landscape A4 print for doctor and patient. v1 links,
  stored diaries and QR codes convert on read. FHIR export codes LOINC vitals/MedicationStatement.
- **Conversation recording.** «Записать беседу» on the home screen records immediately; each
  one-second slice is committed to IndexedDB, so a crash keeps the recorded part (reported as
  interrupted). After stopping, audio is added to a patient/visit or kept in «Записи бесед».
  Stored unencrypted for now.
- **Patient vault in the browser.** Unlock/creation in a compact dialog; no automatic lock or
  privacy curtain any more (user decision). Passkey protection (WebAuthn PRF) was moved to the
  unmerged `feature/patient-vault-passkey` branch and is not part of this line.
- **UX.** Settings grouped with a shared `FeatureCard`; animated `Disclosure`; `SelectField`,
  `FileDropZone`; search welcome with shortcuts; questionnaire import dialog; notes open straight
  into the full-screen editor with title, tags, pictures and reminder; plain-language copy;
  virtualized grids pass a row-size hint (no first-frame jump); smoother nav bubble overscroll.
- **Known open items.** Content pointer text still exposes internal ids/English categories (needs a
  generator change, a core rebuild and a new dataset); UI strings are not yet on Lingui; patient
  storage is not yet migrated to HL7 FHIR resources; e2e «creates a protected patient profile»
  needs the anthropometry pack (download area owned by another agent).

- **Search recovery and startup (merged from `feature/ux-ecg-pass`).** Free search keeps a
  medication whose title stem is typed; source-pointer results offer the exact containing module
  (verified index membership) as an in-result download; a completed search with no document groups
  shows an explicit empty state with scope downloads; ambiguous phrases list candidate documents
  as `ChoiceChip` buttons. Startup parses bundled catalogs as raw JSON text and reads tools and the
  core descriptor from a generated `catalog.shell.json` (`bun run catalog:shell`, drift-checked by
  a test). UI font sizes below 11px use `--type-micro`. Section-menu, result-chip and bottom-nav
  download states separate “queued” from “transferring” (`DownloadProgressMark`); long section
  names scroll only for the selected/hovered/focused row (`MarqueeText`).
- **Core opening.** The OPFS open timeout counts only while this worker owns the pool lock and is
  not waiting for the user's download consent; the boot screen explains when another tab holds the
  local database. Calculators and assessments open before the medical core is ready.
- **ECG photo editor.** Guided five-step flow with per-step guides, camera capture, auto-markup
  summary, explicit paper speed, a home-screen entry card, stale-model detection with in-place
  update, and the 30 numeric-model features drafted from confirmed editor points. Details and
  checks: [state/ecg-research-log.md](state/ecg-research-log.md). The dev/preview Vite server
  serves `/content/releases/<tag>/<file>` from the gitignored `.cache/releases/` cache.
- **ECG perspective.** Automatic sheet corners with manual handles and «Выпрямить по углам»; calibration runs on the rectified image, the original is kept ([details](state/ecg-research-log.md)).
- **ECG ST.** Per-lead ST at the J point and adult Fourth UDMI/ESC 2023 review findings from a declared schema, checked against PTB-XL+ ([details](state/ecg-research-log.md)).
- **ECG children.** Under 18 the editor and numeric panel compare confirmed values with Rijnbeek 2001 age/sex limits declared in a schema; no paediatric model by user decision ([details](state/ecg-research-log.md)).
- **Query-parser POC (tools only).** Local LLM/GLiNER parsers compared with the deterministic
  parser on 40 realistic narratives; no model or runtime was added to the app. See
  [research/query-parser-llm-ner-poc-2026-09.md](research/query-parser-llm-ner-poc-2026-09.md).
- **Verification (0.6.41).** `bun run verify` passes (Biome, strict TypeScript, Vitest, build,
  Python, native source checks, benchmarks, secret scan); `benchmark:pilot` Recall@1 0.951,
  Recall@5 0.984, MRR@5 0.967. Targeted Playwright (`--workers=1`) over boot, startup, core reload,
  downloads, modules, terminology, calculators, assessments, navigation, search, experimental
  reference and patient vault: 16 failures that equally fail on 0.6.40 (stale selectors and
  pre-core flows; 18 tests that failed on 0.6.40 now pass); the one new regression (inline
  preview under the bottom navigation) was fixed. Not tested: physical Android devices, MIUI, iOS.
- **Integration note.** Part of this work was developed on a base older than 0.6.40 and merged on
  2026-09-26; the merge combined the consent-gated core download with the other-tab lock wait and
  the FeatureCard ECG settings with the model-update state.

## Release 0.6.40 — 2026-09-26

One consolidated branch (`release/0.6.40`) merges every open line of work into `main`:
`feature/browser-integration` (diary, canvas links, browser ASR, reading scale, notes backup),
PR #180/#174 (search quality, definition reference, index compaction — see the section below, now
released), the native Android transcriber, and the Android high-refresh display mode.

- **Visit dictaphone (Android).** A visit in the patient card can record a consented conversation.
  sherpa-onnx 1.13.8 (JitPack AAR) runs pyannote segmentation + CAM++ speaker clustering and GigaAM v3
  CTC recognition fully on the device after a one-time verified model download. The doctor renames
  speakers, edits the text and saves: the audio is stored as a patient-vault blob and the transcript as
  a `note` event labelled «Автоматическая расшифровка аудиозаписи; проверьте перед использованием».
  Recording files are deleted from app storage after a successful save. Only arm64 native libraries
  are packaged (APK ≈ 102 MB). Not qualified on physical devices; iOS (libopus) is not implemented.
- **Display refresh.** Android requests the highest refresh mode for the current resolution
  (`preferredDisplayModeId`, plus `setFrameRate` on Android 15+). MIUI behaviour on real hardware is
  unverified.
- **First run.** The core download now starts automatically, except when the connection reports
  `cellular` or `saveData` (then the user decides). The screen cannot be dismissed while the core
  downloads; it shows a feature tour with live demos of real screens (search, patient chart, dictaphone,
  canvas, questionnaire). Onboarding is remembered as completed only once the core is installed.
- **Shared UI.** New `Disclosure` (animated accordion, card/inline variants, reduced-motion aware)
  replaces native `<details>` in setup, settings, calculator sources, reader source details, Allmed
  supplements and the definition-reference panel. New `SelectField` replaces raw selects in the patient
  workspace. `OverlayDialog` accepts `dismissible={false}`.
- **Ranking fix found by the release gate.** Body weight («вес 20 кг», label «Масса») was treated as
  a positive clinical finding, so any document mentioning body mass got full finding coverage and
  outranked a named medicine (`drug.ceftriaxone.pediatric-pneumonia-workflow` fell to rank 5).
  Weight facts are now excluded from ranking findings. Pilot, lookup (Top-1 100%) and clinical
  (Top-1 81.8%, NDCG@5 0.913) benchmarks pass. Note: `benchmark:all` does not run `benchmark:pilot`;
  run it locally before a release.
- **Verification.** Local only (Actions minutes are reserved for the release build): Biome, strict
  TypeScript, Vitest, Vite build, Python checks, native source checks and benchmarks — see the release
  commit. The release APK is built by the release workflow. Not tested: physical Android devices, MIUI,
  iOS, and the boot-screen Playwright spec on a real build.

## Browser integration workspace — 2026-09-25

- Integration branch: `feature/browser-integration`. It combines the browser transcription branch
  with the patient self-monitoring diary and canvas/app-link work while deliberately making no new
  Android or iOS qualification claim.
- Shared browser form controls (`TextField`, `TextArea`, `ChoiceGroup`, `Checkbox`,
  `FileButton`) are reused by the diary/transcript surfaces. Hidden labels are self-contained and
  do not depend on the main app's global visually-hidden utility.
- The patient card can issue a blood-pressure, glucose or medication diary. The lightweight
  `app/diary/` entry stores patient-entered readings locally, exchanges invitation/result payloads
  through QR codes and can export an HL7 FHIR R4 bundle. Doctor-side import remains idempotent by
  diary/entry id and can attach imported events to an open visit. The QR transport caps both encoded
  input and decompressed JSON (1 MiB), rejects oversized individual QR chunks, limits photo import
  batches/files, and releases camera/ImageBitmap resources on every exit path. The local diary index
  is reconstructed from source records after corrupt/stale/quota-failed index writes, and patients
  can explicitly remove a stored diary. Its scoped service worker caches static assets only.
- Note drawings support links to MiniMed documents, calculators, assessments and notes through the
  shared note-link target index. Drawing attachments render an actual Excalidraw preview in note
  timelines instead of a generic file icon.
- Text and Markdown readers now expose a persistent reading scale in the existing document menu:
  90/100/110/125/140%. Plain text, Markdown body text, headings, tables, code and captions scale as
  layout typography rather than a visual transform, preserving selection and scroll geometry. The
  preference is local/session-safe when storage is unavailable and remains independent of PDF
  pinch/zoom and two-page mode.
- Voice notes use the browser MediaRecorder + optional local Whisper path documented below. Persisted
  audio opens the editable transcript panel; a transcript can be copied or inserted at the current
  note caret, including a timestamped form.
- `NoteMarkdownEditor` and `notes-polish.css` were resolved manually rather than choosing one
  feature branch wholesale: canvas link-target behavior and structured browser-ASR behavior are both
  present in the integration tree.
- Draft PR #185 (`feature/browser-integration` → `main`) is the consolidated review surface.
  GitHub Actions are intentionally not used because the repository Actions quota is exhausted.
  Dependency-free source validation passes **57/57** top-level invariants on
  `56fe5dfabe1c17419ffc3e74c0202a43714a556b` across diary, canvas, MediaRecorder, structured ASR,
  persistent Whisper lifecycle, transcript retention, portable personal-notes backup, diarization
  admission and integration wiring. The source gate's three over-escaped word-boundary regexes were
  corrected before that run. A full browser `tsc/vitest/vite build` is still a pre-merge gate when
  a checkout/build environment is available.

## Portable personal-notes backup — 2026-09-26

- Personal notes now have their own plaintext JSON backup domain, deliberately separate from the
  encrypted/optional-plaintext patient-vault backup. Schema v1 includes stable card/note ids,
  arbitrary note files, note images and transcript records including edited speaker labels.
- Binary note files retain their exact ids and carry declared size plus SHA-256. Import decodes and
  verifies all binaries and every cross-store link (card→note, file/image→note,
  transcript→source-audio) before changing durable state. Duplicate ids, note hierarchy cycles,
  missing parents and transcript/audio mismatches are rejected.
- Import is a full replacement of the personal-notes domain. It snapshots the current durable state
  first and attempts rollback if a later store replacement fails. Active transcription jobs are
  quiesced before transcript-store replacement. Restored queued/running transcript records become
  explicit retryable failures instead of pretending an inference job survived the backup.
- Backup v1 intentionally excludes ephemeral editor drafts and the single previous-revision recovery
  slot. A successful import clears those stale local recovery records so an imported note cannot
  reopen with text from the previous device state; rejected imports leave them untouched.
- Notes UI validates/parses the selected JSON before showing the destructive confirmation and displays
  its card/note/file/image/transcript counts. Export/import actions live in a separate data menu rather
  than the create-note menu. Raw backup files above 512 MiB are rejected before parsing. Export also
  estimates the final base64-expanded JSON before reading attachment blobs and refuses a result above
  512 MiB, avoiding a late browser-memory spike after hundreds of megabytes have already been copied.
- Backup v1 also supports `scope: card` for handover. Each ordinary note card has an explicit export
  action that serializes only that card and its files/images/transcripts. Importing a card backup
  replaces or adds only that card; all unrelated cards remain unchanged, and note/file/image/transcript
  ID collisions with another card are rejected before mutation. Legacy v1 backups without a scope are
  read as full backups for compatibility with earlier branch exports.
- Card wipe remains a separate destructive action and explicitly states that the card, nested notes,
  files, images and transcripts are removed. The existing retention journal makes that cascade
  retryable across browser restarts.
- Unit coverage includes exact-ID full round trip with audio bytes, image and edited speaker name,
  same-size binary corruption rejected by SHA-256, missing transcript source-audio rejection, scoped
  card round trip preserving unrelated data and working drafts, plus cross-card ID-conflict rejection.
  Patient-vault data is never read or replaced by this format.

## Browser voice transcription — 2026-09-25

- Browser voice notes use MediaRecorder with a 64 kbit/s target, one-second chunks and a 10-minute
  ceiling. Unsupported recorder startup, runtime recorder errors and empty captures release the
  microphone and surface an error instead of saving a broken attachment.
- Quantized Whisper Base/Small remains optional and local after its existing first model download.
  The worker requests word timestamps and returns millisecond transcript segments. Browser
  transcription rejects recordings over 10 minutes before the expensive decode when metadata is
  available. One worker owns one pipeline: switching Base↔Small unloads the previous runtime first,
  so readiness cannot point at a model the worker no longer holds and the two pipelines do not
  overlap in memory. Unchecking a model now truly deactivates the worker while keeping its admitted
  cache; Settings can separately delete one cached model plus its resumable partials without touching
  already-saved transcripts.
- Persisted audio attachments now retain their NoteFile in the viewer, fixing the previous path where
  a saved recording could not actually start transcription. The viewer exposes queue/running/failure/
  unsupported states, retry, editable text, copy/insert actions, timestamped segments and plain-text
  export. Real diarized speakers can be quickly relabelled as «Врач»/«Пациент». Finished transcripts
  remain separate local personal data in IndexedDB.
- Background OCR preemption re-queues speech work without marking it as a failed ASR job. Genuine ASR
  failures persist as failed with their error so retry is explicit.
- Transcript retention follows its audio attachment: replacing/deleting an attachment removes the
  separate transcript record **before** mutating the file store, so a secondary file-store failure
  cannot leave hidden derived text behind. Explicit transcript deletion keeps the source audio.
  Active transcription jobs are cancelled and tombstoned before deletion; guarded IndexedDB writes
  prevent a stale completion or concurrent manual save from recreating deleted transcript data.
  Deleting a note/card first journals every doomed note id in localStorage and then runs idempotent
  file/image cleanup; an interrupted cleanup is retried after the next browser start, closing the
  previous fire-and-forget orphan-data gap.
- Speaker-aware storage/alignment is implemented: an optional BrowserDiarizationEngine can supply
  source time regions, Whisper words are assigned by temporal overlap and adjacent words are merged
  into turns. Null/empty region sets are tested and never set `diarized=true`. The pyannote
  segmentation and CAMPPlus embedding files are pinned by immutable source revision, exact size and
  SHA-256; admitted blobs persist in a versioned IndexedDB cache for offline reuse, while cache
  failures do not block the current verified session. No diarizer runtime is enabled by default yet;
  without one the UI says «без разделения спикеров» and labels timestamps neutrally as «Речь».
- Upstream sherpa-onnx v1.13.8 has a first-party browser/WASM diarization target. MiniMed deliberately
  does not load a floating HF Space or the Node-specific npm WASM build. Runtime handoff and remaining
  artifact-pinning requirements are recorded in
  `research/browser-speaker-diarization-2026-09-25.md`.
- This branch is browser-only work; no Android qualification or APK claim is made here.

- MiniMed `0.6.39` ships optional Russian Wiktionary/Kaikki lexical downloads: seven gzip packages
  (index with source definitions plus six owner sections). Local selection: 6,939 senses, 6,940
  Russian glosses; no MeSH equivalence or clinical approval is inferred. Current-core + Russian-index
  reconstruction completed locally with 26,926 documents and 75,299 chunks, valid SQLite/FKs and
  unchanged source hashes. Published data remains `terminology-ru-2026.9.16`. See
  `RUSSIAN_TERMINOLOGY.md` for source rights, sizes and measurements. The discovery core is unchanged.

## Production versus DEV boundaries

- **Definition reference (thesaurus) ships as an experimental module.** The reader accepts
  `publicationState` `local-dev` (a developer's own build, DEV-only `catalog.definition-reference.local.json`,
  which replaces the published entry with the same id) or `experimental-preview` (the edition
  advertised in `catalog.preview.json` as a `preview` module, installable only while experimental
  modules are enabled; `minAppVersion` 0.6.41). The «Словарь» entry points and the onboarding row
  follow the same setting reactively. All content stays `requires-review` and the UI says «Черновая
  редакция, не проверено». The app dispatcher still rejects the `fragments-v1` metadata layout.
- Definition drafts (`content/definition-drafts`, ~39 MB of JSON) still load only under
  `import.meta.env.DEV`; shipping them needs a separate downloadable artifact, not bundle chunks.
- DEV-only infrastructure (not features): local module artifacts (`artifact-url.ts`), local
  reference-image assets, DEV download settings and the DEV update checker.
- Ordinary lookup is deterministic: lexical FTS5, aliases, exact-identity retention, bounded
  medication spelling alternatives. No model participates in ordinary search. Laya multilingual and
  a Russian cross-encoder were measured and not adopted (they lowered Top-1 on the frozen
  candidate set); see `research/laya-source-smoke-results-2026-09-23.md` and the cross-encoder
  PoC in `research/system-one-search-benchmark-2026-09.md`.
- Personal notes and the patient vault are separate local trust layers, never official sources.

## Search quality from PR #180 (released in 0.6.40)

- **Search quality gates.** A corpus-derived lookup benchmark (titles, navigation aliases, declared
  aliases) and a diagnosis-free, leakage-checked clinical challenge set with graded multi-document
  relevance. See `research/system-one-search-benchmark-2026-09.md`.
- **Exact identity.** Exact title, short title and editorial navigation aliases are hard ordering
  keys, and identities lost by candidate cut-offs are restored. They are restored with one filtered
  FTS query and fall back to reading the first readable section.
- **Medication spelling.** Bounded OSA candidates from the alias vocabulary, including omitted
  one-letter source suffixes (Канефрон Н). Since 2026-09-24, alternatives are used only when no
  retrieved source passage literally contains the typed word: "дизурия" no longer ranks
  "ДЕЗОГЕСТРЕЛ" first. RapidFuzz stays experiment-only (see the branch log).
- **Clinical ranking.** Fractional coverage keys are compared in tiers (none / under half / at
  least half / all) before the relevance score. The 33-case challenge set is unchanged by this
  (Top-1 81.8%, NDCG@5 0.909 on the committed public-pilot fixture).
- **Definition reference.** Source-local definition cards with exact provenance, a bounded reverse
  (description → term) search and source-span annotations (migrations 006–009). Counts and
  evidence are in the branch log. Reviewed links now stay visible. Only `rejected` links are hidden.
- **Search index size (migration 010).** Ordinary `chunks_fts` reads its content from `chunks`
  through the `chunks_fts_source` view, with `prefix = '2 3'`. The composer writes 16 KiB pages. On
  the bundled core this is 403.2 → 342.0 MiB with an identical token stream and identical
  lookup-quality metrics. Readers are unchanged, so old packs keep working. See
  `research/core-db-size-2026-09-24.md`.

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
- The ECG photo tool extracts waveforms only for the fixed 3x4+1R layout and falls back to manual
  calipers when its quality gate fails. Findings come from confirmed manual measurements and
  deterministic adult rules. The optional numeric model is a probabilistic hypothesis, not a
  diagnosis. No diagnostic CNN is shipped. Every measured and rejected candidate is in
  [state/ecg-research-log.md](state/ecg-research-log.md).
- The patient vault is browser-tested at the domain/contract level, but native Keychain/Keystore
  failure, memory pressure, and recovery after background suspension still require physical Android
  and iOS device qualification. It intentionally has no cloud sync or server-side backup; portable
  backups are plaintext and require the user's own secure handling.
- Physical Android interruption, memory-pressure, and local-model inference qualification remain release
  follow-up checks even when the debug APK and browser automation are green.
- Personal notes use unencrypted device-local browser storage and are a notebook rather than an
  electronic medical record. Browser-local Russian transcription is implemented with optional
  Whisper Base/Small, editable stored transcripts and word timestamps. Full-backup export/import,
  single-card handover and a rollback-safe whole-notebook wipe are implemented. Verified
  multi-speaker diarization still waits for a fully pinned browser WASM runtime.

## Ordered next work toward 1.0


The private, resumable `krasotaimedicina.ru` discovery crawl uses Crawlee Python with a persistent
request queue, robots enforcement, bounded same-host paths, raw HTML/image checksums, and per-page
manifests. The crawl finished on 2026-09-06 (20 926 pages, 6 failed requests). Raw and built output
remains ignored private data with `rightsStatus: unresolved`; since the 2026-09-28 user decision the
disease articles are packaged as the experimental `minimed.reference.krasotaimedicina.ru` module
described above.

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
6. Qualify the existing browser Whisper path on real Russian consultations and enable multi-speaker
   diarization only after the full WASM runtime is immutable/pinned. The two speaker models already
   pass exact size+SHA admission and verified IndexedDB reuse; the executable JS/WASM runtime remains
   the missing supply-chain/runtime gate.
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
9. Local device sync (ADR-0019, proposed): Settings → «Синхронизация» with paired phone/tablet/desktop
   devices, Bluetooth LE pairing and signalling, WebRTC bulk transfer, background sync and dated
   conflict blocks. First slice: one-way copy to a new device; needs native Android BLE and a
   physical device.
10. Medical news and research feed (ADR-0020, proposed; plan only): research sources, rate limits,
    CORS and Russian journal OAI-PMH/RSS coverage before choosing a first slice.
11. Link RLS medication profiles (`packagingDocumentId`) to their packaging document; the app does
    not yet show `medication_profiles` knowledge entities anywhere.
12. zstd module artifacts: about 45% smaller than gzip for the RLS modules; the catalog schema
    already allows zstd, the installer needs a decoder.
13. Core rebuild with medicine aliases (1,678 mapped trade names) and a non-FTS identity table for
    terms, scales and acts (`research/core-coverage-2026-09-28.md`), after the candidate core
    passes the doctor-lookup gate.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.

Branch-specific next steps (PR #180):

1. Run the full CI (Biome, Ruff, pytest, benchmarks) on the branch and rebuild the core with
   migration 010 through the composer. Publish both distributions with their own checksums.
2. Collect a held-out Russian clinician query set (200–300 queries, multi-relevance) before any
   reranker or decision-model work. Candidate public sources are listed in the PR discussion.
3. Consider an OSA fallback for medication names only when the bounded matcher returns nothing,
   behind the corpus-evidence gate. Test negative controls at corpus scale (thousands of correctly
   spelled words), not ten.
4. Further size work: catalog-pointer `classificationPath` (9.3 MiB) as parent pointers, and a
   decision on `normalized_text` (16.9 MiB) versus a custom tokenizer.
5. Regenerate `tools/benchmarks/fixtures/hard-medical-queries-1500.parts`: the committed base64
   parts fail gzip CRC, so `hard-query-dataset.test.ts` is excluded from Vitest until then.
