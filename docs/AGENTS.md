# Documentation agent notes

Read the root `AGENTS.md` first. Keep documents concise and distinguish implemented behavior from
roadmap ideas.

## Product shape

- Primary browser navigation: search, knowledge base/documents, settings.
- Search history belongs beside search, not in a separate top-level page.
- The search home currently exposes one «Свободный поиск» scope across sources. Existing internal
  scoped-search contracts remain available, but saved modes and history must not silently switch
  the home to a hidden scope. Personal matches remain a separate local section.
- Deterministic local search remains complete without a model. Only diagnosis may use the optional
  grounded local-model wrapper.
- Personal notes and future transcription are a separate local trust layer; never present them as an
  official source.

## Shell layout invariants

- Navigation is a fixed bottom bubble (`.app-bottom-nav`); there is no in-app page header. Icon
  tooltips and accessible labels are required. E2E specs locate navigation through that class.
- The knowledge-base button carries two counters: available documents (yellow, top left) and
  installed documents (green, bottom right). Neither resets on view change.
- Search history opens from a floating button as a drawer, never as a route or a side column.
- There are six primary sections: search, knowledge base, assessments, calculators, notes, and
  settings. Personal notes are their own section, and personal matches in search render outside the
  official results container so a local record can never pass as installed content — in the DOM or on
  screen.
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
  blur/grain beneath its controls; opaque document-reader chrome paints the status-bar area itself.
  Never reintroduce feature-specific safe-area offsets.
- The CT/MRI viewer status bar uses `--medical-image-status-bar-color`, matching the toolbar safe-area
  fill; its dark surface requires light icons, and leaving the viewer restores the system default.

## Downloads and models

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
- When a realistic query misses, first check whether the pilot aliases lack the colloquial term.
  Aliases are the intended Russian vocabulary layer.
- The public pilot corpus carries no dosing regimens by design. A dose question must retrieve the
  relevant treatment section, never imply a dose the corpus does not contain.

## Release order

- `1.0`: complete/qualified corpus, reliable content lifecycle, measured Russian clinical scenarios,
  and a safe local personal overlay.
- `1.1` idea: portable Rust `MedicalCore` plus a stable JSON CLI. Do not begin a broad runtime rewrite
  before 1.0 or before golden cross-language fixtures exist.

Update `CURRENT_STATE.md` only for implemented or measured changes. Update `TECHNICAL_PLAN.md` only
when the target architecture or release gates change. Do not duplicate long implementation details
that are already enforced by tests or ADRs.
