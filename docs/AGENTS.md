# Documentation agent notes

Read the root `AGENTS.md` first. Keep documents concise and distinguish implemented behavior from
roadmap ideas.

## Product shape

- Primary browser navigation: search, knowledge base/documents, settings.
- Search history belongs beside search, not in a separate top-level page.
- Search task scopes: diagnosis, clinical recommendations, medications, legal documents, all sources
  without diagnostic model assistance, and personal («Ваши данные») for local notes and uploaded
  books only.
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
- Keep the layout compact: prefer expandable blocks over tall cards, and do not reintroduce large
  padding around central blocks.
- Sizes are rem-based (16px root): write new CSS in rem. Hairline 1px borders, the 999px
  fully-round radius sentinel, and media-query breakpoints stay in px.
- Put `:hover` styles only inside `@media (hover: hover) and (pointer: fine)` so touch taps do
  not leave a lingering hover wash on controls.
- Native routes with sticky blurred chrome (search tools, document/medication headings, document read
  breadcrumbs) draw under a translucent status bar. `.app-shell--native` has no top padding; chrome
  accounts for `--safe-top` itself. Status-bar blur still uses `.app-shell--native:has(...)` on
  `.route-sticky-chrome.sticky-surface--stuck`, `.module-catalog-heading.sticky-surface--stuck`,
  `.medication-route-heading.sticky-surface--stuck`, and `.search-home__backdrop-blur--visible`.

## Downloads and models

- Every artifact download — content modules and model weights alike — goes through
  `downloadWithRetry`. Never call `downloadWithResume` directly from a feature; the retry layer is
  what keeps a flaky network from reaching the doctor as "network error".
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
