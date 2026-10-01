# Current state

> Updated: 1 October 2026
> Released version: `0.6.46` (public prerelease toward `1.0`)
> Next planned step: the WebView (Capacitor) app is the product again and the native port is frozen
> (user decision, 2026-10-01, after [native-vs-webview-2026-10-01](research/native-vs-webview-2026-10-01.md);
> the HyperOS 60 Hz cap was per package, not WebView). Ordered work: smooth first boot (W1), the
> Chromium-like reader (W3) and the knowledge-base audits K1/K2 — see `STATE.md`.

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

## Drug document screen — 2026-10-01

A trade name or an ЕСКЛП substance card now opens with a drug header instead of the plain title row
(`features/medications/DrugScreen*.tsx`, model in `drug-screen.ts`, ATC logic in `atc-code.ts`, both
pure and tested):

- Header: sentence-case name (ЕСКЛП capitals are only recased when the whole name is capitals),
  Latin name when an Allmed supplement has one, form/strength and manufacturer, bookmark and share. A
  packaging photo (installed packaging-images set only) is a dimmed backdrop under a paper veil
  (`object-fit: cover`, never stretched); without one the header is a plain paper panel.
- Quick links, each row only when the data has it: other trade names of the same substance («Аналоги»,
  opened in place with the closest form/strength, «ещё N» after 6), the substance (switches to the
  substance card with all trade names), the pharmacological group (opens the medication catalog with
  its search filled; groups are matched by catalog text search, not by an exact membership list), ATC
  code chips.
- ATC sheet: the code level by level. Level 1 names are MiniMed's 14 taxonomy headings; levels 2-4
  are named only when ЕСКЛП's group text is a three-entry chain on a level-4+ code; level 5 is the
  node's substance name; everything else says the name is not in the loaded data. Cyrillic look-alike
  letters are mapped to Latin. WHO ATC names are not used.
- Section index (jump chips) above the unchanged instruction/registry text; the «Кратко / Инструкция»
  switch stays below the quick links.
- Not covered: GRLS-only registrations get no analogues/ATC (the data is not in the document);
  the group link is a text search; the bookmark of a trade name still saves the substance document id.
- Verified in headless Chromium at 390 and 1280 px, light and dark, on the ЕСКЛП nervous-system
  module; the packaging photo was a synthetic stand-in (the real images module is not installed
  locally).

## Storage and transfer compression — 2026-10-01 (STATE C1, K2 P0)

Implements the P0 items of [kb-audit-storage-2026-10](research/kb-audit-storage-2026-10.md) (levels a and b).
Candidate artifacts are built and verified locally; **nothing is published and the catalog still points
at the uncompressed assets** (see «Publishing» below).

- **Android core as gzip.** The native installer inflates the downloaded transfer while it streams
  into the verified-install transaction (`VerifiedPackFiles.openTransfer`); the decoded checksum is
  what is verified, a truncated archive never replaces the installed core. `ANDROID_CORE_DOWNLOAD`
  now points at the published `core-0.6.45/core.db.gz` (76.2 MB, the browser bundle's archive of the
  same 16 KiB-page file; `core-report.json` records `transferSha256`/`transferSizeBytes` next to the
  decoded `checksum`). Download 440.9 → 76.2 MB (−365 MB). JVM tests pass; not run on a device.
- **One store per large module index.** Indexes above the 32 MiB WASM limit used to sit in
  IndexedDB (Blob) *and* OPFS, and OPFS pools survived remove/rollback. Now the OPFS pool is the only
  copy; the row keeps `indexStorage: 'opfs'`, `indexSizeBytes`, `indexSha256`. A zstd index made of
  independent ≤64 MiB frames is decoded frame by frame inside the OPFS worker straight into its pool
  with an incremental SHA-256, and the pool associates the file only after size and checksum match
  (`stageEncodedIndex`; no decoded copy in memory, none in IndexedDB). fzstd's streaming API was
  measured and rejected: it moves its whole window per block (10 s vs 1.2 s for 340 MB). Other
  artifacts keep the generic decode and still end up OPFS-only. Pool files are found under the
  unsuffixed name blob imports always used (an e2e run caught the size-suffixed variant).
- **Migration of existing installs, no re-download.** Mounting a legacy row opens its OPFS copy (or
  imports it once from the Blob) and then drops the duplicate bytes; inactive versions migrate in
  the background; pools no row refers to (removed modules, failed installs, copies orphaned by older
  versions) are swept under Web Locks, an install in progress holds a shared staging lock, and a pool
  a live worker still holds waits for a later sweep. Rollback keeps both versions (the registry history
  needs them); registry history is still unbounded, so a version bump of a large module keeps the old
  copy on the device (next task: prune history).
- **Search-compacted module builds.** `medbase compact-module-search` (migration 013) and
  `medbase build --compact-search-text`: external-content FTS (the pack's own tokenizer/prefix kept)
  plus empty `chunks.normalized_text` after the rank-1 integrity check; accepted only when a
  token-instance fingerprint of the index, bm25 top-50 of a deterministic query set and a hash of all
  other chunk columns equal the input's. The Krasota/MKB/packaging module scripts use it; a compacted
  pack records `search_text_state` and refuses any later index rebuild or composition.

| Measured | before | after |
|---|---:|---:|
| ЕСКЛП ×15, download | 1 992.6 MB (`none`) | 94.5 MB zstd of the published bytes (21.1×) · **68.7 MB** zstd of the compacted build (29.0×) |
| ЕСКЛП ×15, on device | 3 985 MB (IndexedDB + OPFS copies, by code) | 1 992.6 MB (single store) · **1 429.4 MB** (compacted, −28.3% of the SQLite) |
| Клинреки ×744, download | 2 072.5 MB (`none`) | 677.0 MB (3.06×) · **652.6 MB** compacted (3.18×) |
| Клинреки ×744, on device | 2 072.5 MB | **1 560.9 MB** compacted (−24.7%) |
| Android core, download | 440.9 MB | 76.2 MB |
| kras / MKB / packaging SQLite (local packs, already external FTS) | 629.8 / 294.8 / 221.1 MB | 461.9 / 257.6 / 177.1 MB (normalized_text only) |

zstd parameters: `-19 --long=26`, frames of ≤64 MiB made from files (so each declares its size; the
128 MiB-window decoding bug of fzstd is avoided by construction). `-22 --ultra` gains 4.8% for 10× time.
Search checks: all 15 + 744 compactions passed the built-in fingerprint/bm25/text-hash proof. Through the
whole `MedicalCore.search` pipeline over the released core plus the modules mounted as the app mounts
them (`tools/benchmarks/src/compare-module-search.ts`, lexical, every `query` of the committed benchmark
fixtures plus document titles): 229 queries over three compacted ЕСКЛП modules and 260 queries over 49
sampled compacted clinical modules, 0 differences in both (reports in `output/module-zstd-2026-10-01/`;
the full 15-module run did not finish on the loaded host). The same 40 store-level queries on one module
in Chromium over sqlite-wasm/OPFS (plain vs compacted install): identical ids, ranks and order.
`bun run benchmark:all` (core only, unchanged) stays within tolerance. All 1 518 `.db.zst` files were
decoded again with the reference `zstd` CLI and match their catalog checksums.

**Publishing (pending the owner's decision).** Candidates are in `output/module-zstd-2026-10-01/`
(`esklp`, `esklp-compacted`, `clinical`, `clinical-compacted`, each with `repack-report.json`; the two
`catalog.candidate.*.json` are the full catalog with those entries swapped; recorded in the data
ledger). Upload plan and mirror paths are in the reports; `scripts/publish-module-zstd-mirror.sh`
adds the files to the `datasets/<tag>` branches additively. The clinical release already has 746 of
the 1 000 allowed assets, so the 744 clinical `.db.zst` go to the branch only. The same module
version is kept: the logical source set is unchanged, installed copies stay valid, nothing re-downloads.
`minAppVersion` of repacked modules becomes 0.6.45 (the first release with the zstd installer; the
three already published zstd modules still say 0.6.44 and should be corrected with the next catalog change).
Regenerate `catalog.shell.json` (`scripts/build-module-catalog-shell.ts`) after swapping the catalog.

Not verified: any Android device or WebView (Java unit tests and Chromium only), slower hardware (install
of a 93 MB module took 1.4 s to import + ≈8 s validation on this loaded laptop), all 744 compacted
clinical modules through the app (49 sampled through the benchmark pipeline, none in a browser), the four already published
zstd modules (single frame: they still decode in memory) and the `module-pointer` e2e case
«no download action when experiments are disabled» (times out waiting for the core on this loaded host;
it does not touch module storage).

## Release 0.6.46 — 2026-10-02

- Ships the smooth start-up, guided onboarding, drug screen, motion settings and the compressed
  module distribution (ЕСКЛП ×15 and КР ×744 as framed zstd from the dataset mirror branches,
  `minAppVersion` 0.6.46; kras/МКБ/РЛС-упаковки zstd gated to 0.6.45; Android core as gzip).
- Verified: `bun run verify`, 23 targeted browser E2E tests, emulator clean install (core gzip
  download → search; КР and ЕСКЛП zstd modules installed from the real mirror and opened).
- Known limitation, not new: `benchmark:real:release` reports `pilot.sectionRecall` 0.836 against
  the 0.869 baseline; v0.6.45 measures the same 0.836, so the drop predates this release.
- Not in this release (owner decisions pending): ГРЛС access (its robots.txt forbids crawlers),
  Allmed redistribution, refreshing КР (+30 editions since 2026-07-27); embeddings paused.

## Smooth start-up — 2026-10-01

- Android splash shows the whole launcher wallet (`res/drawable/splash_icon.xml`) and stays until
  the page calls `window.MiniMedBoot.ready()` (a JavaScript interface from
  `LocalMedSystemUiPlugin`, because plugin calls queue behind the database plugin) or 4 s pass,
  then fades onto `#boot-surface` in `index.html`: the same image at the same screen position
  (`MiniMedBoot.iconShiftY()` corrects for the system bars). `src/app/boot-surface.ts` removes it
  with one fade once the first view's code and fonts are in and two frames have painted. The
  former «Запускаем MiniMed…» card and the reveal veil are gone.
- `FirstRunSetup` (now the lazy onboarding, see below) is lazy; its package list loaded the full module catalog after the reveal, so the
  9.6 MB catalog chunk is no longer in every launch's start-up graph (12.2 → 2.5 MB; emulator
  DOMContentLoaded 5.9 → 1.8 s). The session's catalog load also waits for the reveal.
- `capacitor.config.ts` sets `loggingBehavior: 'none'`: prereleases are debug builds, where
  Capacitor echoed every bridge result (SQL rows, query text) to logcat.
- Open: on the loaded emulator the native core open still takes ~25 s before search is ready.

## Motion settings — 2026-10-01

- Settings → «Анимации» (Выключены / Быстрые / Обычные / Медленные), stored as
  `motionSpeed` in app preferences. `src/state/motion.ts` retimes every CSS transition, keyframe
  animation and `Element.animate` call through `playbackRate`; «off» collapses durations in CSS so
  end states and `transitionend`/`animationend` still happen. JS-timed code uses `motionMs()`.
- `OverlayDialog` keeps a closing dialog mounted until its exit plays: on phones the sheet slides
  down from where it was released (pull-to-close continues instead of snapping back), the backdrop
  fades; wide-screen dialogs fade and settle. Verified in headless Chromium (close ≈ 290 ms).

## Guided onboarding — 2026-10-01

- `apps/app/src/features/onboarding/` replaces the first-run modal (`FirstRunSetup`, its package
  list and the carousel on that screen are gone). The real search page renders under a full-screen
  blur; after the splash leaves: «Привет», «Добро пожаловать в MiniMed», then the core download on
  a thin line along the bottom edge (`CoreProgressLine`: percent and smoothed speed from
  `coreProgress.loaded` samples, own texts for verifying/installing, «Скачать» on a metered
  connection, «Повторить» on error). An installed core is reported as «уже на месте».
- «Далее» begins the tour (steps 2–9 of 9, data in `onboarding-steps.ts`, state machine in
  `onboarding-controller.ts`): the blur recedes to a light band at the screen edges (registered
  `@property --onboarding-clear`; the band is the «tutorial mode» indicator, there is no edge glow
  or particle layer), the intro's «Далее» flies into the hint card with the View Transitions API
  (cross-fade without it), and hand-drawn arrows are drawn with `stroke-dashoffset` from the card
  to the control found by `[data-tour="…"]` (rAF-batched tracking; carousel slides out of sight are
  scrolled into view). Arrows are plain SVG: a few tangent-continuous cubic Béziers with one small
  loop and a two-stroke curved head turned to the shaft's last direction, viewBox in CSS pixels, no
  filter or noise. Step 2 spotlights the bottom navigation (`data-tour="nav"`): a pulsing ring whose
  shadow dims the rest of the screen a little (static with animations off or reduced motion). The
  welcome scene shows the real `boot-icon.png`; both «Пропустить» buttons are bordered 44 px pills.
  The tour switches between search and «Мои файлы» and returns to search at the end.
- Start-up hand-off: when the onboarding will show, `App.tsx` calls
  `revealFromBootSurface({ handOff })` and the splash does not reveal search. The onboarding is
  already mounted under the surface (blur at full strength, the wallet icon as the intro's anchor);
  after the native splash has faded, `document.startViewTransition` removes the surface and starts
  the greeting in one frame while the splash icon (`minimed-boot-icon`) flies onto the intro icon
  (520 ms, `::view-transition-group` in `onboarding.css`) and the ground cross-fades into the blurred
  app. Without the API or with animations off the surface fades over the intro. A finished
  onboarding keeps the plain fade into search. Checked by 25 fps video frame strips at 390 px (light,
  dark) and an rAF probe: no frame shows bare search. `afterBootReveal()` still resolves after it.
- Optional downloads inside the tour go through the real feature code: «Скачать препараты» queues
  the released `medication` modules through the module runtime (the 10 MB catalog loads only at
  that step, after the intro; size from the catalog), «Скачать модель (в фоне)» activates the first
  runtime-ready Whisper model through `asr-models`. Step 6 cycles the real MRI slices from
  `public/onboarding/mri/manifest.json` with their attribution (the drawn imaging demo if absent).
- Dismissal is unchanged: `dismissSetup()` runs only when the core is installed (at the end of the
  tour or when it arrives later); otherwise the tour hides for the session and returns next launch.
  `restartOnboarding()` (`onboarding-state.ts`) runs it again; Settings needs a button for it.
- Verified in headless Chromium at 390 and 1280 px (light, dark, reduced motion, animations off,
  core ready / downloading / failing; dark theme re-checked step by step) and by `e2e/onboarding.spec.ts`; not verified on a physical
  Android device or WebView build (View Transitions there).

## Release 0.6.45 — 2026-09-30

- **Published application and corpus.** The signed Android APK, core `13f238f…`, and RLS MKB
  2026.9.30 are published. GitHub CI and Android release checks pass; APK certificate and SHA-256
  match the declared prerelease identity. The published Pages app downloads its actual core and
  returns four source groups for the public pneumonia lookup. On Xiaomi 14, Android rejected
  `adb install --user 0 -r` with `INSTALL_FAILED_USER_RESTRICTED`; no physical runtime pass is
  claimed and existing user data was not cleared. The native product port continues; its current
  lookup spike is not a complete replacement for the WebView application.

- **Core rebuild qualification.** Audited medication aliases, exact definition/document identities,
  RLS packaging links and light/dark contrast fixes are implemented. The no-pilot rebuild failed
  the existing clinical regression gate, so the 15 pilot documents remain until source replacements
  qualify. Phrase indexing and classification-alias attribution are corrected; numbered migration
  012 restores eight issued paragraph identifiers. The final `13f238f…` core passes the unchanged
  clinical thresholds and exact source audit. Nine stale expected section labels now describe the
  existing registration schema; targets, anchors and thresholds are unchanged. Native lookup agrees
  on the released core's golden queries. Age-qualified lookup preserves doctor-lookup R@5/MRR@5
  0.70/0.60 by keeping explicitly opposite source populations behind matching or general sources;
  clinical ranking is unchanged. The paired application release is published. See the continuation record below.
- **Continued Claude's UI/data queue.** S2 paper sheets are retained; cancelled drags spring
  back, reopening clears drag state, and only the topmost dialog handles Escape/Tab. S3 result
  cards show one compact excerpt and disclose the others with the shared `Disclosure` animation;
  source-kind badges are readable in ordinary flow. Details and the remaining release blockers:
  [state/claude-continuation-2026-09-30.md](state/claude-continuation-2026-09-30.md).
- **Lookup patient qualifiers.** In ordinary age/sex-qualified lookup, a literal subject match
  precedes a match limited to «ребёнок», «взрослый» or sex. Explicit failed-treatment and clinical
  finding ranking keep their existing rules. Candidate test7 doctor-lookup reaches R@5/MRR@5
  0.70/0.60 (was 0.70/0.533), with zero forbidden hits; the released core stays 0.70/0.60.
  This is a ten-case regression gate, not clinical qualification or a published core rebuild.
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
- **zstd module indexes.** The installer decodes zstd indexes in a Web Worker with `fzstd` 0.1.1
  (24 KB, reviewed: no network, no eval). fzstd silently corrupts a 128 MiB window
  (`--long=27`) and decodes 64 MiB exactly, so indexes are packed with `zstd -19 --long=26` and
  windows above 64 MiB are refused; the decoded SHA-256 is verified as before.
  `scripts/repack-module-index-zstd.ts` re-encodes a published gzip index, verifies it with the
  app's decoder and updates the catalog. Four modules moved (267.6 → 167.3 MB): definition
  reference 42.2 → 18.8, krasotaimedicina 142.7 → 100.6, MKB 53.5 → 30.4, RLS packaging
  29.2 → 17.5 MB; the `.db.zst` assets sit next to the `.db.gz` in the same releases and their
  GitHub digests match. `e2e/module-pointer.spec.ts` installs the MKB zstd file through a core
  pointer (1.7 min, local-only fixture). Terminology packs stay gzip.
- **Per-document lexical window.** Lexical search ranks a 4× wider bm25 window and keeps at most
  three chunks per document before cutting to the limit, so long books no longer crowd other
  documents out of the window. Released core: doctor-lookup, lookup-quality, runtime and
  real-corpus unchanged, p50 latency 161 → 140 ms. Candidate core: doctor-lookup R@5 0.60 → 0.70
  ([research](research/search-kr-pointers-vs-mkb-2026-09.md)).

## Native application port — 2026-09-30

- The first product slice owns actual private content storage, consent/download/verification,
  lookup, the 782-module inventory, exact module membership and original-document reading.
  Android and Desktop use the same UI-independent core and bundled SQLite adapter; iOS has a
  real Foundation/CoreCrypto/zlib adapter and Swift host. No WebView or hosted backend is involved.
- Desktop qualification passes 60 tests, including unchanged 151-query lookup and 206 SQL-branch
  parity. Actual published core download matches `13f238f…`; the immutable 401,408-byte regulatory
  module matches `61b82c9…`. Installation, visible offline failure/retry, original reading,
  historical status, down/up reader chrome and exact reading/search positions across offline
  process restart were exercised. The Android 36 emulator downloaded the same core and performed
  real native lookup. A physical device pass is still pending.
- Device/simulator iOS Kotlin and simulator test sources compile; the device framework and actual
  Swift host link. Full Xcode application packaging and runtime tests remain blocked by the absent
  iOS simulator runtime. No simulator or physical iOS runtime pass is claimed.
- Exact source identities and current-edition definition cards/readers now pass 80 Desktop tests,
  including 259 exact-name cases and complete hashes for 22 cards/73 blocks/88 text pages. The
  previous 151 lookup queries and 206 SQL branches remain unchanged. An actual Android APK
  upgrade preserves its schema-1 installed registry, query, catalog filter and exact reader position
  in schema 2. Source-local review and missing-definition status stay explicit.
- The searchable 782-module inventory preserves filters and positions through Back and offline
  restart; the Android emulator exercises actual keyboard input, the immutable regulatory install,
  original reading and down/up chrome with application-only network denial.
- Installed-reference search resolves an exact catalog edition, installs through the existing
  verified owner and preserves its query/results position. All 23 production reference searches
  match complete ordered cards, including limits and bounded description/negation behavior.
  The combined Desktop suite passes 86 tests without skips; Android lint and Android/Desktop/Wasm
  builds pass. Actual Desktop reading reaches all 17 blocks and seven Unicode pages, restores
  page seven offline and returns to the same reference query. Android verifies visible original
  text hashes, all three ambiguous senses, missing-definition status and a second block page.
  Fixed grey-background action contrast, clipped long-name actions, final-card navigation and
  reader focus loss while switching blocks/pages. Android also exercises real Russian keyboard
  input and all seven pages of the same 26,155-codepoint block, preserving page seven offline.
  Updated iOS sources and Swift host compile/link; the runtime limitation above remains.
- Explicit native clinical mode now matches all 85 production lexical cases: 152 facts,
  356 branches and 2,863 complete ordered source passages, including scores, highlights and anchors.
  The 151 lookup queries and 206 SQL branches remain unchanged. Clinical mode uses the current core
  only; it does not imply mounted-module or hybrid retrieval. SQL timing now measures SQL stages.
  The combined Desktop suite passes 108 tests without skips; Android lint and Android/Desktop/Wasm
  builds pass. Current iOS Kotlin/test sources, device framework and Swift host compile/link.
- Native theme/text-size settings and a bounded completed-search history persist atomically and
  remain independent of medical content. History distinguishes lookup and clinical modes, replays
  through the real core and deduplicates successful searches. Failed writes retain pending changes;
  malformed private state is preserved and reported. Actual Desktop and Android emulator checks
  cover settings/restart, replay, deletion, confirmed/cancelled clearing, clinical source opening and
  offline restoration. Production personal-data migration and physical-device qualification remain
  separate gates.
- Native mounted retrieval now preserves 94 actual scoped requests over verified module editions,
  including source identities and complete ordered passages. Six document scopes are exposed in the
  UI; query/mode/scope/filter guards and scoped history prevent stale results or replay changes.
  Initial search warmup admits the installed composition once; completion signals no longer retain
  an obsolete full index. Single-document identities avoid allocating ambiguous-name sets.
- The native catalog opens all 69 schema-defined calculators/assessments. Its engines match 3,014
  production cases with explicitly bounded numerical interoperability checks, and catalog discovery
  matches 407 actual ordered queries. Inputs, stages, answers and results persist atomically in a
  separate validated private file. Tool Back restores its actual search/catalog/collection entry.
  Android emulator checks exercise real keyboard input, calculation, assessment, upgrade/restart and
  package-only offline restart. Patient-result saving remains hidden until the vault is implemented.
- Native readers now have a compact primary Back row and a source menu retaining full title,
  edition, provenance, saving and retry actions. Reader controls hide down and return up together
  with bottom navigation. Shared chrome currently uses the coordinator's opaque strip/fade (`22ac0aa0`);
  this chat's earlier transparent blur/grain request awaits reconciliation in `STATE.md`. Android file
  reading now has current phone light/dark and dark tablet checks; PDF chrome remains separate.
- `bun run native:visual:dev` serves actual shared Compose screens at `127.0.0.1:4174` with continuous
  compilation and browser reload. Its labelled preview uses one public, checksum-linked reader
  fixture and disposable in-memory user state; it does not expose SQLite or claim native FTS.
  Six same-page resized light/dark comparisons against actual WebView found missing home sections,
  query typography and layout differences. The frozen WebView and generated design-system
  components are the reference; screen migration is the immediate next task.
- Native home/search now consumes the shared generated query sheet/footer, equal-height feature
  carousel, section list, bubble navigation and source/identity result cards. The query remains
  editable before core readiness; explicit submission shows «Ищем…» and runs after readiness.
  Source and clinical sections retain independent queries, filters, completed results and viewport
  in the current session; only the active validated search snapshot is durable. Public Wasm checks
  cover queue/edit/clear/readiness, carousel controls and Settings swipe. Selected tests and
  Desktop/Wasm/Android/iOS source compilation pass; these checks do not qualify current Android
  visual parity. Wasm serif rendering, responsive geometry and admitted-source counters still
  require the coordinator's component/core contracts. Feature-card engines remain unavailable.
- Official-source text now maps to shared reader blocks without changing its stored chunk or anchor.
  A frozen oracle from the actual Web functions passes 115 cases: 75 released public chunks and
  40 explicitly labelled test boundaries, including list continuation, source spans, Unicode spaces,
  extra table cells and validated image/table metadata. Reproduce with
  `bun scripts/nativePrepareSourceText.ts` after placing the checksum-verified regulatory module at
  `playwright/native-verified-regulatory.db`, then run `NativeSourceTextGoldenTest` on Desktop.
  This qualifies parser data and block mapping. The coordinator connected the adapter to the shared
  official-source reader and checked it on Android; neighbouring captions, media decoding and inline
  navigation still need their own checks.
- The main native app now exposes «Открыть файл» beside search and in collections, including before
  the medical core is ready. The system picker opens the shared Markdown/HTML/text/PDF reader in
  a transient, in-memory layer; Back preserves the underlying screen and search draft, and cancellation
  preserves the current file. Android's main activity accepts local `content:`/`file:` VIEW intents.
  This is a file-reading entry, not a durable personal library or encrypted patient vault.
  Desktop flows check cancelled/failed picks, failed navigation saves and return without a core;
  22 selected search/tool/navigation tests pass. Android emulator checks cover the actual system
  picker, visible original text/list/table and native Back restoring the same query. The release
  merged manifest includes the local VIEW filters; current physical devices remain unqualified.
  Actual Wasm import checks pass Markdown/HTML/TXT in search and startup, phone/tablet, light/dark;
  Back loses accessibility nodes with `Node 16 not found`, and ordinary search edits similarly fail
  with `Node 39 not found`. The matching upstream fix is in Compose 1.11.1; the current 1.9.3 Android
  SDK ceiling prevents an unchecked version bump. PDF chrome and browser Back parity remain open.
- Personal Markdown/HTML/text reading now assembles the shared document-reader parts inside
  `NativeChromeScaffold`: controls take the status inset once, Back uses the shared primary glyph,
  and the bottom navigation follows scroll direction. The scaffold's current opaque/fade treatment
  is recorded above; the earlier matrix APK still demonstrates the preceding grain treatment.
  Find, outline, text size, embedded images and explicit external-link handling remain shared reader
  behavior. Choosing Search, Settings or Collections closes the transient file only after a successful
  navigation flush; failure retains the file and draft. Another file gets its own list and chrome
  state; its controls and navigation padding do not change the covered source reader's state.
  Desktop checks pass 45 file/navigation/tools/user-state/search-mode/collections/clinical/component tests; Desktop,
  Android, Wasm and iOS source compilation and generated source/token checks pass. Actual Android
  picker/down/up/Back checks preserve the covered source viewport and hidden controls; gestures on
  unsupported-file notices also retain exact underlying text/bounds. PDF and notices retain safe
  viewport padding until their shared reader branches expose the same chrome/inset contract.
- Startup/progress and search retry/error copy now use generated design-system parts. Settings render
  the Web sheets, choices and range control for the two real persisted native preferences (theme and
  text scale). Files render shared search, breadcrumbs, folder grid/list, saved references, empty state
  and collection dialogs. Clinical query analysis now uses the same DS paper, disclosure and choice
  chips, preserving the original deterministic facts, polarities, warnings and calculation copy.
  Picking a local file remains transient; durable files, other Web settings and
  the encrypted patient vault are not implemented. File-folder navigation survives other destinations;
  reselecting Files clears the filter and returns to root only after successful navigation flush.
  Android checks cover both phone themes, actual 140% text, settled 820×1180 tablet settings, collection
  create/rename/delete, picker cancellation and file Back. Current artifacts live in ignored
  `playwright/native-pages-qa/` and `playwright/native-files-navigation-qa/` (APK932972c0: grid/list,
  folder/filter retention, reselect to root and breadcrumbs). APKc1d730ab clinical checks prove two
  visible age/temperature facts, disclosure/reset on query change, source opening and Back in both
  phone themes (`playwright/native-clinical-ui-qa/`). Those cases do not exercise warnings, suggestions
  or calculations; UIAutomator does not expose the disclosure's spoken stateDescription. The current
  component box-parity suite passes too. Final APK0e654729 checks also prove that selecting Files
  from its reader preserves exact origin folder/filter bounds, while reselecting Files returns to root
  (`playwright/native-final-file-return-qa/`). No physical-device or iOS runtime qualification is claimed.
- Next: finish design-system screen parity, then personal files/patient-vault parity, the two separate
  unit-conversion/photo-ECG tools, rich
  original rendering, and remaining application features. The personal library and patient vault
  remain subsequent work. Production Android identity and existing personal data must be preserved
  by a qualified migration before replacing the released app.
- Qualification and concrete limits: [state/native-first-slice-2026-09-30.md](state/native-first-slice-2026-09-30.md).
- Exact identity/migration qualification: [state/native-identities-2026-09-30.md](state/native-identities-2026-09-30.md).
- Clinical/user-state qualification: [state/native-clinical-user-2026-09-30.md](state/native-clinical-user-2026-09-30.md).
- Mounted/tools/chrome continuation: [state/native-tools-chrome-2026-09-30.md](state/native-tools-chrome-2026-09-30.md).
- Mounted/scoped retrieval has a production-generated 94-case oracle over the exact immutable
  regulatory pack and current core; 50 calculators and 19 assessments have 3,014 real-engine cases.
  Mounted retrieval and tool engines pass the qualified native gates above; full feature parity
  remains open.
  Production calculator traces now trim fractional mantissa zeros only: scientific exponents and
  rounded integer zeros preserve their value. The expression/all-schema checks pass 1,399 tests.

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
  diagnosis-category aliases were affected; fixed and tested before the qualified 0.6.45 rebuild (see
  `research/diagnosis-alias-ambiguity-2026-09-27.md` for scope and the missing-merge-step blocker).
  Details: [research/definition-reference-2026-09-29.md](research/definition-reference-2026-09-29.md).
  The missing-merge-step blocker is now resolved and scripted (`bun run content:core:build`,
  `scripts/build-core.mjs`): three independent pointer tracks (reference/clinical/medication)
  reproduced the earlier core.db's exact document counts (15,904/744; medication's ledger had
  grown past its 3,324). The qualified rebuild is now published as core-0.6.45 above; see
  `research/core-build-reconstruction-2026-09-27.md` (pipeline, profiling, gated pilot removal).

## Krasota i Meditsina disease module — built and published 2026.9.28

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

## RLS MKB-10 modules — initial published edition 2026.9.28

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
  add about 8.6 MB of membership to `catalog.preview.json`. Since 2026-09-29 both are published as
  zstd (30.4 + 17.5 MB). Edition 2026.9.30 of the MKB module is published with 50 137 exact
  source-listed packaging links (306 647 040 bytes installed, 30 738 701-byte zstd). The app opens
  their verified packaging target and preserves its source anchor across installation and reload.
  Packaging edition 2026.9.28 is reused unchanged; the MKB source text and identities are unchanged.

## Core coverage audit — 2026-09-28 (measurement only)

- `benchmark:core-coverage` (`tools/benchmarks/src/run-core-coverage.ts`, seed 20260928, 3,850
  queries) searches `core.db` alone through the app's lookup path. KR titles and INN reach 100%
  correct@5. ICD codes reach only 46% because the released pointers do not index sub-codes and the
  legacy fallback assumes chapter I; the candidate rebuild reaches 97.5–99.5%. All 15,904 MKB and
  krasotaimedicina pointers were dead ends at measurement time; the 6,068 krasotaimedicina ones
  resolve from 0.6.44 (module c6b63b6b, membership fallback 044ef7a7). The MKB module and its
  qualified 2026.9.30 packaging links are now published above. The original audit found terms at 16%,
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
- Dialogs are paper sheets (`OverlayDialog`, `presentation="sheet"` by default): from the bottom
  edge on phones with a grip, pulled down to close (`sheet-drag.ts`), a centred paper sheet on wide
  screens; the scrim, Escape, the focus trap and safe-area insets are shared. Viewers and editors
  (relation map, image lightboxes, print, drawing, ECG editor, first-run setup) keep
  `presentation="screen"`. Confirmations use the same sheet as an `alertdialog`. Panels that open
  from a button — search sections, collections, the home «?» — are popovers on wide screens and the
  same sheet on phones (`SheetPopover`).
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

User decision, 2026-09-29/30: after publishing the last WebView release, finish the native
application port first. The qualified first slice and its next dependencies are recorded above;
the content and 1.0 qualification queue below remains open. Completed identity-index/core and
RLS packaging-link work is recorded in release 0.6.45 rather than kept as a future task.

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
2. Verify the published 0.6.45 prerelease and native replacement on a physical Android device, including system-bar insets, native Back,
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
