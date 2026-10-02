# Documentation agent notes

Read the root `AGENTS.md` first. Keep documents concise and distinguish implemented behavior from
roadmap ideas.

## Product shape

- Hide bottom navigation while the application document is loading. Once the shell has loaded,
  expose search, personal files, and settings independently of medical-core download/initialization.
  Until the core is ready, search shows setup/progress; personal files, their readers, ordinary notes,
  and settings stay usable. Core readiness must not remount these pages or discard local drafts.
  The saved setting «Разбивать навигацию на разделы» restores six tabs once the core is ready.
- Search history belongs beside search, not in a separate top-level page.
- Search opens in ordinary source lookup: one lexical branch, without clinical parsing or vectors.
  «Клинический разбор» is an explicit separate mode beside search actions. Legacy saved scopes must
  not silently select a hidden mode; history may restore an explicitly visible clinical mode.
  Personal matches remain a separate local section.
- Deterministic local search remains complete without a model. Only diagnosis may use the optional
  grounded local-model wrapper.
- Personal notes and future transcription are a separate local trust layer; never present them as an
  official source.

## Shell layout invariants

- Navigation is a fixed bottom bubble (`.app-bottom-nav`); there is no in-app page header. Icon
  tooltips and accessible labels are required. E2E specs locate navigation through that class.
- In the six-section layout, the knowledge-base button carries two counters: available documents (yellow, top left) and
  installed documents (green, bottom right). Neither resets on view change.
- Search history opens from a floating button as a drawer, never as a route or a side column.
- The optional six-section layout contains search, knowledge base, assessments, calculators, notes,
  and settings. In the default layout, a selector beside search actions owns source/tool selection;
  personal files reuse the user library, including notes, CT/MRI example studies, questionnaires,
  templates, and a separate patient-workspace entry. Only a native encrypted vault gets a lock;
  ordinary file drag/drop must never write into that entry. Personal matches render outside the
  official results container so a local record can never pass as installed content — in the DOM or on
  screen.
- In compact navigation, reselecting My Files opens the personal file catalog root; selecting it
  from another tab restores the last personal route. Notes/patients/templates return to Files at
  their section boundary, while nested record and patient routes retain their immediate parents.
- One searchable hierarchical selector owns section/subsection selection, icons, and counts; do not
  reintroduce a separate specialty selector or document-count block. History retains both levels.
  Source/tool selection retains each section's query, filters, and scroll in the current session.
  Empty source queries show a flat document catalog in both navigation layouts; tool lookup uses the declarative tool catalog
  and existing tool/download routes. Clinical parsing is an explicit separate mode.
  Condition subtype filters use source metadata and the preparer's legacy ICD classification rules,
  with the same document membership for browsing and retrieval. Style only ICD code/range spans as
  monospace in titles; do not substitute the digit font across ordinary headings.
- Section-menu downloads share the existing module queue and resolve packages through document/tool membership, never broad specialty labels. Expanded groups retain their child download status; keep download controls separate from selection buttons.
- Tool exit follows its recorded entry page rather than the navigation layout preference. Keep
  intermediate result routes within their tool and preserve the entry across /new creation redirects.
- The download status page lives at `#/settings/downloads`. Active content-pack downloads (queued,
  transferring, or installing) show a pie on the top-right of the Settings tab; tapping it opens that
  page. Failed-only or idle packs hide the pie. Progress stays visible on every tab through the nav
  indicator, not a floating card.
- A waiting application update shows a same-height `Доступно обновление` pill next to the search-home
  menu (tap opens Settings and dismisses that version until a newer one appears), a green dot on the
  top-left of the Settings tab, and a checker card on the Settings index. Applying it reloads the
  waiting service worker on web. On Android, an explicit action starts or resumes the native
  app-private APK stream; after it is ready, a second explicit action opens the system installer.
  Global CapacitorHttp fetch-patching stays off so content modules keep using WebView `fetch`.
- Keep the layout compact: prefer expandable blocks over tall cards, and do not reintroduce large
  padding around central blocks.
- Sizes are rem-based (16px root): write new CSS in rem. Hairline 1px borders, the 999px
  fully-round radius sentinel, and media-query breakpoints stay in px.
- Put `:hover` styles only inside `@media (hover: hover) and (pointer: fine)` so touch taps do
  not leave a lingering hover wash on controls.
- Native safe-area and sticky-chrome behavior is defined in
  [NATIVE_STICKY_CHROME.md](NATIVE_STICKY_CHROME.md). Transparent route chrome uses masked
  blur/grain beneath its controls; WebView document-reader chrome paints the status-bar area itself.
  Compose readers use the shared transparent blur/grain scaffold and compact primary Back controls.
  Never reintroduce feature-specific safe-area offsets.
- The CT/MRI viewer status bar uses `--medical-image-status-bar-color`, matching the toolbar safe-area
  fill; its dark surface requires light icons, and leaving the viewer restores the system default.

## Downloads and models

- Browser and Android core files may use different SQLite page sizes for the same logical corpus.
  Keep the Android download URL paired with its own checksum; never validate that immutable remote
  artifact against the browser gzip's checksum. A corpus change must update both distributions.
  Android downloads a gzip transfer (`distributions.android.url`, `transferSha256`) whose decoded
  `checksum` is what the native installer verifies; today it is the browser bundle's `core.db.gz`
  because both distributions share one 16 KiB-page file. When they diverge, publish a separate gzip
  for Android and update `transferSha256`, `transferSizeBytes` and `checksum` together.
- Large module indexes live in one place on the device: OPFS (one pool per module version) for
  indexes above the 32 MiB WASM limit, IndexedDB for small ones. Never write the bytes of a large
  index to IndexedDB, and remove a module's OPFS pools together with its rows (the orphan sweep in
  `browser-module-runtime.ts` does it; the staging lock keeps it away from installs in progress).

- Every artifact download — content modules and model weights alike — goes through
  `downloadWithRetry`. Never call `downloadWithResume` directly from a feature; the retry layer is
  what keeps a flaky network from reaching the doctor as "network error". Android APK updates are the
  exception: GitHub release assets stream directly into app-private native storage, never through a
  JavaScript file body or a global fetch patch.
- Partial bytes must be flushed with an awaited write before a failure propagates, otherwise an
  automatic retry races the write and restarts a multi-gigabyte download from zero.
- The local model loads in the background automatically. There is no opt-in checkbox, and the only
  indicator is the loader over the settings icon.

## Search expectations

- Retrieval cases live in `tools/benchmarks/`. `doctor-workflow-queries.json` holds deliberately messy
  real-world phrasing (typos, abbreviations, brand names, colloquial verbs) and gates the same
  thresholds as the curated sets. Add real doctor phrasing there rather than canonical terminology.
- When a realistic query misses, first check whether the colloquial-vocabulary aliases (`alias.*` rows) lack the term.
  Aliases are the intended Russian vocabulary layer.
- A dose question must retrieve the relevant treatment or instruction section, never imply a dose
  the corpus does not contain (the medication cards in core are identity records, not instructions).

## Release order

- `1.0`: complete/qualified corpus, reliable content lifecycle, measured Russian clinical scenarios,
  and a safe local personal overlay.
- Native port: follow [ADR-0022](adr/0022-native-application-port.md), the accepted Kotlin/Compose
  target. Preserve the working browser and qualify each native slice against immutable production
  goldens. Keep full feature and personal-data migration gates explicit; the native prototype is
  not a production package replacement. A new portable JSON CLI remains an unimplemented idea.

Update `CURRENT_STATE.md` only for implemented or measured changes. Update `TECHNICAL_PLAN.md` only
when the target architecture or release gates change. Do not duplicate long implementation details
that are already enforced by tests or ADRs.

## Terminology collection

Read [MEDICAL_TERMINOLOGY.md](MEDICAL_TERMINOLOGY.md) before changing terminology adapters or packs.
Preserve ConceptUI identity, source-language definitions and multi-section membership. Never turn
Wikidata descriptions into clinical definitions, merge concepts by names, or enable runtime packs
without measured sizes, exact membership and source redistribution review.

Term-occurrence projections store literal source labels/locators, not clinical assertions. Preserve
exact term → source mention → related-concept tiers and every active search filter. Never restore
full-catalog work before the reader's selected-document request. Keep benchmark engine timings
separate from browser/physical-device timings, and rebuild caches after core reinitialization.

- For Russian terminology sources/distribution, read `RUSSIAN_TERMINOLOGY.md`. Keep sense-level
  selection, CC-BY-SA attribution, proposed/third-party status and exact gzip/decoded checksums.
