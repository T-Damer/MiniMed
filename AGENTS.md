# AGENTS.md

Mandatory reading for coding and data agents.

## Product invariant

LocalMed Search is an offline-first navigator over medical source material. Retrieval happens
before generation. The current product must remain useful with no network, no LLM, and no hosted
backend.

## Planning authority

- `docs/TECHNICAL_PLAN.md` defines the target architecture, milestones, and acceptance criteria.
- `docs/CURRENT_STATE.md` records the implemented state and ordered next tasks.
- When the two differ, preserve the architecture invariant and update `CURRENT_STATE.md` rather than
  pretending a planned capability already exists.
- `STATE.md` (repository root) is the live sync file between concurrently working agents: read it
  before starting and before committing, claim tasks there, and edit only paths you own.

## Dependency direction

```text
UI → MedicalCore → ports → adapters

private sources → deterministic preparer → Markdown/provenance → pack builder → SQLite
```

Forbidden without a dedicated ADR:

- UI importing SQL, SQLite, native plugins, or provider SDKs;
- core importing SolidJS, Capacitor, or a concrete AI provider;
- generated model text replacing original source material;
- an agent writing arbitrary SQL into a released content pack;
- adding Rust, Tauri, Postgres, Docker, telemetry, or a backend;
- committing private source documents, patient data, API keys, or model weights.

## DEV format policy (user decision, 2026-09-22)

Breaking changes to DEV code and prepared file formats are allowed. Do not add legacy-format
adapters merely for compatibility. Current reference priority is source collection and database
refreshes; preserve private/user data and exact provenance even when rebuilding generated packs.

## Medical source policy (user decision, 2026-09-22)

Read `docs/REFERENCE_SOURCE_POLICY.md` before reference acquisition. Preserve discovered names
independently of definition quality: audited name-only inventories may restore archived Wikipedia
identities with `needs-definition`, but not Wikipedia medical prose or automatic same-as links. Prioritize specialist
medical teaching/reference works, source guidelines and substantive journal articles; assess each
document, not merely the domain. Retain source classifications, versions and detail; no silent
substitution, clinical promotion or rights assumptions. Historical source files remain unchanged.

## Before editing

1. Read `docs/CURRENT_STATE.md`, the relevant issue/milestone, and architecture/ADR files.
2. Confirm that the task follows the current execution order or explain the dependency that justifies
   changing it.
3. Find the existing public contract and tests.
4. Check dependency direction and offline fallback behavior.
5. Add no library when the current stack can solve the task.
6. For content work, identify whether the input is raw, prepared, or generated. Never hand-edit a
   generated SQLite/JSON pack.

## Local execution

- Use the repository-pinned Bun version for JavaScript commands and CI. Keep explicit Node commands
  only where a tool is incompatible with Bun, and document that fallback.
- Before running project code, use a sanitized environment containing only required, documented
  non-secret values. Do not inherit provider credentials, release tokens, private-corpus paths, or
  upload destinations into local app, test, build, or browser processes.
- The repository is public. Personal or secret values (e-mails, passwords, tokens, keys) never go
  into a tracked file: they live in an ignored local file next to the tracked one (`*.local.env`,
  `.env`) with a committed `*.example`. `bun run check` and CI's `secrets:check` fail on an e-mail or
  a credential-named value in a tracked `*.env`; run `bun run check` before every commit.
- Bind local browser development servers to `127.0.0.1`; do not expose them on the LAN unless the user
  explicitly requests it.
- Concurrent e2e runs (agents, release worktrees) each set their own `E2E_PORT` (default 4173): the
  config reuses a server already on its port, so a shared port tests another checkout's build.
- Content builds, module packaging and data releases run locally and are pushed to GitHub (user
  decision 2026-09-29; Actions minutes are scarce). Only CI, the Pages deploy and the `release:`
  Android build run automatically; every content/data workflow is `workflow_dispatch` only.

## Coding rules

- Implement the smallest complete vertical slice.
- Keep business logic outside Solid components.
- Validate untrusted data at package boundaries.
- Never log clinical query text, secrets, source-document contents, or raw native SQL arguments.
- Change SQLite only through a numbered migration.
- Preserve stable document, section, chunk, and anchor identifiers.
- An OPFS pool has one worker owner. Search must reuse that owner rather than reopen the same pool
  in a nested worker; reload must wait for the previous owner's handles to close.
- Pointer downloads require exact target membership in a verified index artifact; an installed pack
  alone is not proof that its document is readable. Preserve source anchors when opening excerpts.
- Preserve raw-file checksum and source spans when transforming authoring artifacts.
- Reject source paths that escape the configured private root.
- Do not catch and discard errors.
- Assessment copy must attribute or accurately describe real instruments and explain how to
  interpret results; never brand an established instrument or questionnaire as a MiniMed invention.
- Assessment and calculator behavior, interpretations, and charts must be declared in tool schemas;
  UI and print code may render schema data but must not branch on tool ids or slugs.
- Overview-card counters must name the entity they summarize: section/module counts are never
  labelled as documents, and concrete document counts come from the catalog manifest rather than
  incidental documents already mounted in the search core.
- When visible copy puts a number before a countable word, explicitly decide whether the word needs
  pluralization; Russian counters must use the correct one/few/many form rather than a fixed noun.
- Update `docs/CURRENT_STATE.md` when a change affects behavior, corpus coverage, trust boundaries,
  benchmark composition, or ordered next tasks.

## Data-agent rules

- Work on extraction JSON or prepared Markdown, not the production database.
- Do not summarize or harmonize source claims unless the task explicitly creates a separate draft
  artifact.
- Keep every proposed structure/category traceable to source block/page or line ranges.
- Mark table, OCR, missing-text, and contradictory-source problems instead of silently repairing
  them.
- Never remove an original paragraph merely because it looks irrelevant to one query.

## Worktrees and disk

- Never symlink `output/`, `data/` or any gitignored local data into a worktree: read it from the main
  checkout by absolute path. A committed `output` link once made a pull delete every local release
  copy (2026-10-14); `bun run check` now fails on any tracked symlink or local-data path.
- Worktrees live under `.claude/worktrees/` or an agent scratchpad. Remove a worktree as soon as its
  branch is merged into `main` (`git worktree remove`, `git worktree prune`), and remove measurement
  or release worktrees when the measurement or release is done.
- JavaScript dependencies stay on the repository-pinned Bun (its global cache is shared across
  checkouts); do not add npm or yarn-classic installs.
- `output/release-*`: keep the 3 newest while they total at most 4 GB, otherwise fewer, never fewer
  than 2. Release assets themselves live on GitHub. Machine-wide limits and `dev-disk` are in the
  global agent rules.
- Do not keep intermediate build data. A task that creates candidate cores, test or `no-pilot`
  variants, merge/split stages, compaction experiments or pre-fix copies deletes them itself as soon
  as the final artifact is verified or the result is written down; only sources, released artifacts
  and current build inputs stay on disk.
- Local data ≥50 MiB is recorded in `docs/data-ledger.json` (rules: `docs/DATA_LEDGER.md`); run
  `bun run data:ledger` after creating or removing such artifacts. Anything else — sources, released
  artifacts, data another task produced — is deleted only by the owner.

## Formatting and checks

TypeScript uses Biome and strict TypeScript. Python uses Ruff formatting/lint, strict Pyright, and
pytest. Before reporting completion run the applicable commands:

```bash
bun run check
bun run typecheck
bun run test
bun run build
bun run python:check
bun run benchmark:all
bun run native:source:check
```

For the current browser-first milestone, use CLI checks by default. Run browser automation only for
UI/UX changes, and run mobile/native validation only when the change directly touches native code.

For private corpus tooling also run:

```bash
bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

State honestly which dependency suites, native SDKs, physical devices, and real source documents
were not tested.

## CSS selectors and BEM

- New or touched UI elements must have their own semantic BEM class (`block`, `block__element`, or `block--modifier`).
- Do not style elements through descendant selectors such as `.block h2` or `.block button`; put the class on the styled element and target that class directly.
- Never add selectors shaped like `.class <node />` (for example `.block svg`); use a specific class on the styled node instead.
- Keep state selectors class-based (`.block--active`) and avoid selector chains whose meaning depends on DOM nesting.
- Use normal flex/grid/document flow for layout. Use `position: absolute` only for intentional overlays, such as a full-card hit area or an icon layered over content; do not use it for ordinary actions or spacing.

## Motion (user decision, 2026-10-06)

- Animations, transitions and interactions follow iOS (UIKit/SwiftUI) behaviour, in a fast mode:
  content slides and fades instead of popping, state changes (idle → busy → result, empty →
  filled, pending → «Обновить») cross-fade or move rather than jump, sheets rise from below,
  pressed controls give a short scale feedback (≈0.96) and, while held, a shade of their own text
  colour (keys on a ledge sink instead; `components/press-feedback.ts`).
- Keep them quick: 120–260 ms through the theme tokens `--motion-fast`, `--motion-base`,
  `--motion-slow` and the curves `--motion-ease` / `--motion-ease-out` (`styles/global.css`); nothing
  longer than ~300 ms unless it follows a gesture.
- Animate through CSS or `Element.animate` so the AnimationManager (`state/motion.ts`, Settings →
  «Анимации») retimes it; timers use `motionMs()`. With animations off, end states still apply.
- Never block input to show a transition or a pending state: keep what is on screen usable and show
  progress in place (a spinner inside the control, a quiet status line).
- **An idle screen draws nothing (PERF6, owner 2026-11-11 «телефон греется»).** Decorative motion
  plays a few times and settles, or rests a few seconds after the last touch (`PageHero`'s ECG
  trace); no `infinite` animation outside a pending state (a spinner while something loads). SVG
  child transforms and anything under a `backdrop-filter` are re-drawn on the main thread or the GPU
  every frame: an endless one cost up to 0.9 of a core on an idle screen. Timers stop while their
  screen is hidden or off screen (`IntersectionObserver`), not only while the tab is hidden.
  `e2e/perf-budget.spec.ts` fails on an endless animation on the main screens;
  `e2e/perf-idle.spec.ts` measures idle CPU per screen (`docs/research/perf-idle-2026-11.md`).

## Interface rules (user decisions, 2026-10-08)

The owner repeated these on several screens; apply them to every screen you touch, not only the one
reported.

- **Header row.** A route's title sits in one row between the back button and the right-hand tools
  (`Page` does this). One short description line at most; no big multi-line header blocks.
- **Help is a «?».** «Как это работает», method notes and disclaimers live behind a round «?» icon
  button in the header (`Page` `help` prop), never as a section, card or disclosure on the page.
- **Less text.** Every visible sentence must earn its place; prefer icons, visuals and state to
  explanations. Icon-only buttons (printer, share, add, delete) where the icon is obvious, with an
  `aria-label`. No captions that restate a button («Предпросмотр бланка» next to a print icon).
- **Reference data under «Информация».** Orders, editions, statuses, validity and fetch dates,
  sources and registrations are not page content: they live in the reader's «⋯» → «Информация»
  dialog (owner 2026-10-20) — no card, no block, no footer on the page. The only legal detail
  doctors need up front is a document/form number (№1122н, 070/у): show the number, not the legal
  wording. Avoid law/legal language in UI copy.
- **No disclaimers at all (owner 2026-10-20).** Never show «Данные не проверены», «Решение за
  врачом», «не заменяет врача», «а не диагноз» or similar notes anywhere; state facts and method
  limits plainly instead.
- **Drug cards lead with clinical content.** One tap from search lands on forms, doses, usage and
  analogues (instruction or reference text); registry listings (packages, prices, barcodes) are never
  the body.
- **No validation disclaimers on official documents.** Government documents (orders, official
  forms, calendars) are already validated; do not add «врач не проверял» notes to them. Draft or
  machine-extracted content may carry one short status badge, not a stack of warnings.
- **No raw data in UI.** Never render JSON, internal ids, schema keys or pipeline notes to the user.
- **Inputs look fillable.** Inputs are large enough to read as the main task; a field's fill rule is
  an icon button in its label that opens a tooltip, shown only when the field has a rule — no
  always-visible «Правило заполнения» rows (they add scroll).
- **Progressive input.** Do not pre-suggest values the user did not ask for. Show one search field;
  suggestions appear as they type; the next field appears once the previous one is filled. When the
  data or model the tool needs is not installed, offer the download right there.
- **Compact patient row.** Patient choice is one row: «Пациент — выберите, чтобы подставить данные —
  icon button»; once chosen: avatar/photo, full name, birth date, a button to change.
- **Drafts autosave.** Forms and editors autosave as drafts; an explicit «Сохранить» at the bottom
  approves (signs) the result.
- **Debounce/throttle every input-driven computation** (search, suggestions, previews, autosave).
  Reviewers need not report this as a finding — it is the default, always implement it.
- **Live previews.** Where a printable artifact exists (forms, calendars), show a small paper
  thumbnail in the header that updates (debounced) as the user fills it; tapping it prints/opens it.
- **No hanging text buttons.** Avoid rows of text-link buttons and many inputs in a row; use segmented
  controls, icon buttons, cells and visual tools a doctor can tap.
- **Loading is one state.** A screen shows one loading state, then the finished content — no
  loading → partial → loading → full flicker; background data refreshes never replace visible
  content with a loader.
- **Header overflow (owner 2026-10-27).** Header buttons carry a priority: 1 (phone, «?») folds last, 2
  (export, share, edit) next, 3 first. When the header row runs out of width — a long patient name —
  the lowest priority folds into one «⋯» context menu (same labels and icons), then the next; a single
  button is never folded (the «⋯» takes a slot, so hide at least two), and with everything fitting
  there is no «⋯». Width is measured dynamically (ResizeObserver), the title keeping its natural width
  so buttons fold before it truncates. Use `HeaderActions` (`Page` `headerActions`, «?» included as
  priority 1) and the pure `layoutHeaderActions`; never hand-roll responsive hiding of header buttons.
  Account and rare actions (reminders, sign-out, demo data) are `menuOnly`: always in «⋯».
- **Scroll only when it overflows (owner 2026-10-27).** A page or panel that fits shows no scroll:
  no `min-height` that pushes a short page past the screen. Vertical scroll is shown by the themed
  overlay scrollbar (OverlayScrollbars / the thin themed native bar); horizontal scroll areas use
  `HorizontalScroller` with its ‹ › arrows (`controls`, hidden bar) — never a bare horizontal
  scrollbar. Month-by-month strips (heatmap, calendar) page with ‹ › in their title row.
- **Sounds and haptics (owner 2026-10-27).** Taps get sound and vibration from the shared feedback
  (`installUiFeedback`); non-tap moments (saved, failed, received) call
  `playFeedback(...FEEDBACK_MOMENTS.<moment>)`. Both follow the «Звуки» / «Вибрация» switches, and
  every app mode (profiles, the patient diary PWA) offers those switches.
- **Schema first (owner 2026-10-28).** Build new features as declared data rendered by generic
  components — chart lists (`features/diary/dashboard/diary-charts.ts`), red lines from the tool
  schemas (`state/assessment-limits.ts`), profile flags (`hiddenSettings`) — so the main app can
  reuse them; a page never branches on one chart, tool or row id.
- **Editable previews (owner 2026-10-28).** Where one user edits what another sees (the doctor and
  the patient's screen), show the real screen with its real components; every part that can be
  changed gets the two-colour dashed frame (`care-editable`, `care-row--editable`) and a pencil, and
  editing opens a sheet over the live preview. The preview can be used like the other user would
  (ticks, questionnaires); a toast says it is only a showcase.
- **No «необязательно» (owner 2026-10-28).** Do not label optional fields «(необязательно)» or use
  it as a placeholder — the «не» reads as a refusal; invite instead («Опишите ваши ощущения»).
- **Empty states are centred (owner 2026-11-01).** A list with nothing in it shows, centred in the
  empty space below the header, an icon, a line or two of text and the action buttons — never a
  heading stuck to the top of an empty screen. Use `EmptyState` (`components/EmptyState.tsx`); it
  fills the rest of the viewport above the bottom bar, so the page still does not scroll.
- **No native pickers (owner 2026-11-01).** Dates and times use the app's own fields — `DateField`
  (typed «ДД.ММ.ГГГГ» or a calendar in a Kobalte popover / the paper sheet on phones) and the Kobalte
  `TimeField` — never `<input type="date|time|datetime-local|month">`: native pickers look and work
  differently on every browser and phone.
- **Never a lone spinner (owner 2026-10-26).** A loading screen keeps its chrome (‹ back, title when
  known, bottom bar) and shows a skeleton shaped like the coming page: `PageSkeleton` for a whole
  screen, `SkeletonLines` for text still arriving inside a page (`components/PageSkeleton.tsx`). A
  reader shows its first page as soon as it is ready, with skeleton lines only at the bottom.
  `e2e/no-bare-loader.spec.ts` fails on any frame with a loader and no way out.
- **Sources fold under «Источники» in the «?» (owner 2026-11-08).** A tool's sources are passed to
  `Page` as `helpSources` (never written into `help`): `HelpSources` folds them at the end of the «?»,
  collapsed, as named rows — title, publisher, year — not raw links. A source the app has (a КР, a
  book: `moduleId`/`documentId` in the tool record) opens in the reader; any other opens on its site,
  named («PubMed»). A popover taller than the screen scrolls inside itself (`SheetPopover`).
- **A menu belongs to its button (owner 2026-11-08).** While a popover, sheet or menu is open, the
  button that opened it stays pressed — accent fill and ring (`menu-owner--open`,
  `components/menu-owner.css`) — and the panel's border repeats the ring. `SheetPopover`,
  `AppContextMenu` and `HeaderActions` do it; a new trigger uses them or the same class.
- **Fold only what is worth unfolding (owner 2026-11-08).** A text folds behind «Показать ещё» /
  «Показать полностью» only when that hides 3 lines or more (`createLineClamp`,
  `components/line-clamp.ts`); a list folds only when 3 items or more stay hidden. Otherwise show it
  whole, with no button. In a source list each source has its own small open button beside its name.
- **Fill the screen, avoid scrolling (owner 2026-11-08).** Each screen shows as much as it can; a
  screen with a lot of function is compressed instead. If a screen can avoid scrolling it must:
  scrolling looks like there is nothing more, or loses the user on a dull first screen. Empty space is
  filled enough, not overloaded. Lists and grids of alike items may scroll. `e2e/screen-density.spec.ts`
  reports per screen, at 390 and 1024 px, the filled share of the first viewport, the largest empty
  band, and «scrolls without being a list» (`DENSITY_STRICT=1` fails on them; thresholds in
  `e2e/screen-density.ts` are heuristics — no validated published metric exists, see
  `docs/research/screen-density-2026-11-08.md`).
- **Hover only where it exists (owner 2026-11-08).** Every interactive element has a hover effect,
  inside `@media (hover: hover)`, so touch screens never keep a stuck hover. `e2e/hover-effects.spec.ts`
  lists elements without one.
- **Presses are playful, never clipped (owner 2026-11-08).** The shared press feedback
  (`components/press-feedback.ts`) shrinks a control and springs it back past full size before it
  settles; the overshoot is capped by the room its clipping box leaves, so nothing pokes out of a card
  or the screen. Don't add per-component press animations.
- **Interactions don't shift the layout (owner 2026-11-08).** Hover, press, focus, selection, loading
  and similar states animate only the element itself; its neighbours do not move. Animate `transform`
  and `opacity`, not size or position; a state never changes width, height, padding, border width or
  font weight (swap a colour or an outline instead); spinners, badges, counters and error text get
  their space up front or float over the content (popover, overlay), so nothing jumps when they
  appear. The exception is layout that is designed to move: panes that trade space (`flex: 1` next to
  `flex: 4`), an accordion or a «Показать ещё» the user opens.
- **Contrast in both themes (owner 2026-11-08).** Text and icon contrast is checked in light and dark
  (`e2e/app-contrast.spec.ts`, `e2e/diary-screens.spec.ts`); an element that fails gets a different
  colour at the token or component level — never a per-screen override.
- **Errors are typed and all handled (owner 2026-11-08).** Like Rust's `Result`: an expected failure
  is a value — a `kind` union in `TypedResult<T, E>` — never a string or a generic catch. Callers cover
  every kind (`matchError`, or `switch` + `assertNever`; a missing kind does not compile), and an
  `ErrorStates<E>` table gives each kind its own user-facing state, drawn by `CalmError`. A thrown
  error is converted once, in an `attempt…` boundary; an unknown one becomes `unexpected` and is
  logged. Example: the news feed (`features/news/news-failure.ts`); a migrated area joins the Biome
  override and `bun run check:errors`. See `docs/ERRORS.md`.

## Navigation (user decision, 2026-10-14)

- Back returns where the user came from, with state intact. The in-app ‹, the browser back and Android back are one
  history step (`state/app-back.ts`); each peels exactly one layer. A ‹ calls `navigateBack(parentHash)`, never
  `window.location.hash = parent` (that pushes, and the history grows with every back press).
- Sheets, popovers, previews and menus are history layers (`OverlayDialog`, `SheetPopover` or `useHistoryLayer`), not
  private state. Close-then-navigate is safe; navigate from inside a layer, do not close it with a timer first.
- Tabs share one history (`visitRoute`); a tool keeps its state in its address (`replaceToolUrl`) so back and tab round trips
  restore it. Details and the rejected alternatives: `docs/CURRENT_STATE.md` «Back returns where the user came from».

## Native sticky chrome

- Read `docs/NATIVE_STICKY_CHROME.md` before changing safe-area, sticky-header, backdrop blur/grain,
  document-reader chrome, or scroll-direction visibility behavior.
- WebView transparent route chrome and opaque reader chrome are different modes. Do not share
  safe-area padding or backdrop treatment between them. Compose native routes and readers use the
  shared chrome scaffold defined in the chrome contract: no glass behind the controls, only a
  page-colour status-bar strip (user decision 2026-10-01).
- Do not add feature-specific `--safe-top` padding or negative safe-area margins to
  `.route-sticky-chrome--transparent`; the shared shell contract owns that geometry.
- Preserve the reader rule: scrolling down hides controls and scrolling up reveals them. The WebView
  reader paints its opaque status-bar fill; Compose renders the scrolling-source backdrop beneath
  transparent system bars, including while reader controls are hidden.
