# Current state

> Updated: 19 August 2026
> Repository version: `0.6.27`
> Active target: `0.6.27` public prerelease toward `1.0`

This file records what exists now and the next ordered work. The target architecture and acceptance
gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

## Implemented

### Product and retrieval

- SolidJS browser app behind the UI-independent `MedicalCore` contract.
- SQLite/FTS5 retrieval with SQLite WASM fallback and compatible native read-only storage adapters.
- Deterministic portable embeddings and hybrid lexical/vector fusion.
- Russian patient-case parsing, negative findings, bounded query branches, medical abbreviations, and
  missing-field prompts; the symptom lexicon recognizes nosebleed phrases such as `кровотечение из
  носа` and expands them to searchable `носовое кровотечение`/`эпистаксис` terms.
- Search after 500 ms of inactivity with stale-response cancellation.
- Short name lookups promote a document or medication whose title/trade name *is* the query
  (for example `Парацетамол`) above combinations and sources that only mention the term. The
  medications catalog sorts those hits by the same name-first rule instead of alphabetically.
- Search is hidden until the user selects a scope; scopes with no installed documents are disabled.
- Query analysis and deterministic retrieval run in a Web Worker, and long result sets are window
  virtualized.
- Results are grouped by document and window-virtualized; compact result cards show numbered matches,
  source/category metadata, up to four snippet lines, and open the exact fragment without expanding
  the result group. The document group header opens the full document. Retrieval stats and search mode
  sit inside the expandable query-analysis details panel, whose collapsed row is a hoverable card
  with a details badge and centered summary text. The source preview is a body-level overlay above navigation chrome, vertically
  centered in the viewport, with the shared primary button to open the full document; opening the full
  document closes the preview overlay first.
- Official and personal full documents open as hash-router pages under `#/modules/documents/…`
  inside `<main>` with Kobalte breadcrumbs (origin → nested documents). Official: `#/modules/documents/d/<token>`;
  personal: `#/modules/documents/user/<id>` (optional `/p/<page>`). On tablet and desktop the outline
  is a full-viewport left column; sticky chrome and paper sit in the right column so the page header
  cannot overlap the TOC. Mobile TOC is a full-height drawer above the bottom nav.   Nested headings in the document body keep a full-width sticky bar for in-text
  `h1`/`h2` only; the paper document title is not pinned. Sticky heading fill matches the paper
  and extends through the page padding so scrolling content cannot show gaps beside the title.
  Print and clinical full-text sit in one paper-title
  row; full-text is a primary button with in-button loading instead of a page overlay. Outline
  desktop changes are animated, mobile outline changes are immediate, and scrolling pins the
  current section heading, marks its outline entry, and keeps that entry centered.
  Section headings copy
  a deep link to `#/modules/documents/d/<token>`; legacy `?o=` / `dialog`+`section` and `#/read/…` migrate
  to that hash on load. Opening a large official document no longer freezes the main thread:
  inline cross-links use a prefix-bucket matcher compiled once per document, assessment/calculator
  links reuse a singleton matcher, and paper sections mount in idle batches.   Outline sections are paper blocks in default, hover, and active states. Initial open keeps the
  same page chrome with an inner paper spinner; clinical full-text loading stays inside the primary
  button. Nested document links navigate to another documents hash page and append a breadcrumb
  instead of stacking reader dialogs. Own documents can switch to a paper-free book mode from a
  control above scroll-to-top; pinch-zoom works on the page without opening preview, and a horizontal
  swipe opens or hides the outline. Find is disabled when an upload has no extractable text.
- Search-result context remaps stale pilot-summary chunks to installed full-text siblings and falls back
  to the readable document when an exact chunk cannot be resolved.
- Поиск по полному документу работает как поиск на странице: он точно сопоставляет введённую фразу
  без учёта регистра, включая название и заголовки разделов, подсвечивает только эти диапазоны и
  прокручивает совпадения кнопками «предыдущее/следующее»; диапазоны сохраняются через списки,
  markdown-ссылки, ссылки на инструменты, таблицы и подписи к изображениям.
- В режиме поиска по полному документу и длинному источнику кнопка «Назад» превращается в «×» и
  закрывает поиск; обычные поиски по карточкам сохраняют навигацию назад.
- Within-document ranking uses query intent to prefer the relevant diagnostic, routing, or treatment
  section; the public benchmark currently has perfect section retrieval and top-section accuracy.
- Search scopes cover diagnosis support, clinical recommendations, medications, legal documents,
  deterministic search across all installed sources, and a personal overlay («Ваши данные») for local
  notes and uploaded books only.
- Only diagnosis scope may call the optional grounded local-model wrapper; the other scopes constrain
  deterministic retrieval by installed source type.
- A realistic pediatric workflow query — `Цефтриаксон ребенку 3 лет вес 20 кг при пневмонии как
  второй антибиотик` — is part of the retrieval benchmark.

### Browser workspace

- Pointer clicks do not show the system blue tap flash or leftover focus rings; keyboard Tab/arrow
  focus rings stay.
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
  The bottom navigation remains fixed and interactive. Root tab slide animation is not suppressed by
  leftover overlay history in the URL. Stale overlay query params (`o`, legacy `dialog`/`section`) are
  stripped on root hash changes when no document page (`#/modules/documents/d/…` or
  `#/modules/documents/user/<id>`) is open. Rapid tab changes
  do not wait on View Transition snapshots; document read routes, note, and local-model subroutes remain instant. The
  scroll-to-top control
  reserves the bottom-navigation band on long pages, and the notes add control mounts only while the
  notes root is active.
- Root navigation snapshots the route that was left, not the already-updated hash, so returning from a
  questionnaire or nested tool restores the same Documents subroute. Incoming-view scroll is painted
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
  editors expand with their content.
- Recent device-local search history opens from its floating control or a rightward swipe from the
  search page's left edge, preserves the selected source scope, and can show the current-session
  result cache immediately while refreshing in the background. The detected request type is presented
  beside extracted facts as a compact category inside the analysis details, together with result
  counts, document count, elapsed time, and search mode. Clicking a result-group header opens the
  full document; opening the full document from the source preview closes the preview first.
- The paper/archive design uses one top-level semantic color palette in light and dark modes, a
  65-character reading measure (`--page-measure`) for questionnaires and document text, and a wider
  board (`--page-board-width`) for card catalogs. Phone keeps one card column; from tablet (760px)
  upward `--layout-cols` is two and the board caps at 72rem so ultrawide screens stay centered
  instead of stretching. Virtualized lists chunk
  rows in JS so WindowVirtualizer can still measure height. Compact cards, controls, result rows,
  responsive spacing, and consistent hover/focus feedback stay shared. Warm page surfaces share a reusable
  low-opacity fine fractal-grain layer constrained to the page content measure; sticky search/medication
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
- Personal cards use a responsive three-column sticker board and a focused creation dialog opened
  from a floating add button. Card timelines and dated-record editors use nested note routes; card
  edit/delete actions are compact icon controls. Record editors guard unsaved drafts, accept image
  attachments by file selection or drag-and-drop, and keep tags, reminders, images, and related
  sources in distinct blocks. The previous-revision control is enabled only when the stored revision
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
  catalog download weight and, when installed, on-device size. The legacy clinical-pediatrics
  collection is represented by the recommendation sections instead of a duplicate top-level card.
  Drilldown exposes two-column module collections with user-facing release states and inspectable
  document lists, all 21 recommendation sections without an extra reveal step, full-document opening,
  bulk download, background update pause on the documents root catalog only, rollback to retained older versions, and nested URLs for
  opened collections and sections. Leaf catalog download controls are icon-only and use primary accent
  when published; only unpublished rows stay muted.
  Regulatory packs open as a documents sub-route (`#/modules/documents/laws/pediatrics`, alias
  `paediatrics`) with in-page search, not a catalog dialog. The catalog sticky toolbar hides on that
  route.
- The medications catalog reads medication metadata from document summaries in bounded batches and
  coalesces concurrent summary reads, so direct and navigated catalog routes avoid materializing
  every document's sections/chunks on the main thread.
- Document catalog routes share one route-bounded search field: the query filters only the currently
  opened collection, category, or catalog page, and the recommendations search remains in its sticky
  route header.
- Medication catalog cards use a responsive two-column layout and live rendering so progressive
  batches populate both columns; its route header uses the shared compact catalog search field.
  Catalog cards open the official document reader (`#/modules/documents/d/<token>`); legacy
  `medications/<registration>` hashes redirect there after catalog lookup, and the Allmed
  «Карточка препарата» section is omitted in the reader as a duplicate of the document title.
- The personal notes index has local full-text filtering, and Ctrl/Cmd+F focuses the visible
  search field with the highest stacking order (the field inside the topmost dialog when one is open).
  A second Ctrl/Cmd+F within 700ms does not intercept, so the browser find bar can open.
- Search history and diagnostic help controls share one sticky top toolbar on the search home, with
  the menu on the left, an optional compact app-update control immediately to its right (progress
  percent while an APK downloads), and `?` on the far right. There is no second floating app-update pill.
  A green dot on the top-left of the Settings tab also marks a waiting application update, and Settings
  contains an update-checker card (current version, check, and apply).
- Search, module-catalog, and medication-catalog sticky headers use transparent,
  page-width masked backdrop blur with a subtle grain layer that stays hidden until the header is
  actually stuck. Document reader chrome stays opaque; in-text `h1`/`h2` sticky offsets are measured
  from the real chrome (the paper title is not pinned). On native Android the page itself draws under a
  translucent status bar (`.app-shell--native` has no top desk padding). Page surfaces keep a negative
  `--safe-top` margin so the folder paint sits under the bar, and double `--safe-top` padding so text
  starts below it. Sticky catalog/search chrome adds `--safe-top` only once stuck; blur layers animate
  through opacity and stay under search fields and `/search` tools. The bottom nav remembers the largest
  observed bottom inset so hash navigation cannot drop it into the gesture bar and bounce it back.
  Outgoing root views isolate their fixed overlays below the incoming navigation surface. Hover styles
  use `@media (hover: hover)`.
- The diagnosis search actions expose the local-model control on the left; it toggles a ready model,
  fills the brain-download icon with download progress, and opens Settings when the model is not
  loaded yet.
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
  installed tools keep specialty section cards open dedicated sub-routes containing the full grid.
  Pasted document links with `?o=` (or legacy `dialog` + `section`) migrate to
  `#/modules/documents/d/<token>` on load. Legacy `#/read/…` hashes migrate the same way.
  Schema calculators support staged inputs via `step`/`stepRequired`; the fluids section includes a
  two-stage paediatric ORS calculator that adds measured vomiting and stool episodes to the base plan.
  Installed tools keep their offline-use state across reloads. Incomplete assessment attempts are
  also stored in the existing device-local results store, restored by their history entry with an
  `incomplete` tag and answered-count, and replaced by the completed result when submitted. The
  questionnaire next control stacks under scroll-to-top on long forms, scrolls to the next unanswered
  question with a brief highlight, and the remaining-count badge
  animates on change. Response cards hide the radio; the score sits as a bold background numeral,
  the answer is centered in body text, and long labels scroll inside the card. When a saved return destination exists, questionnaire and missing-test screens
  show one back control that opens a destination chooser (catalog vs saved route). Questionnaire URLs
  are `#/assessments/{specialty}/{slug}` so Back returns to the
  owning section rather than the assessments root; a test may later appear in several sections via tags.
  Runtime TypeScript keeps only `unit-conversion` in `CALCULATOR_REGISTRY`; every other calculator
  schema and all assessments live in `content/tool-modules/*.json`, build to
  `apps/app/public/content/modules/minimed-tools-*.db`, and are auto-installed from those local
  artifacts during browser-dev boot (`VITE_USE_LOCAL_MODULE_ARTIFACTS`, on by default). Once a tool
  pack is on the device, every questionnaire and calculator in it is available immediately — there is
  no second per-item download/remove toggle. Production builds without local artifacts still install
  a pack through `ContentModuleRuntime.install`. Section-to-module mapping is in
  `CALCULATOR_SECTION_MODULE_IDS` and `ASSESSMENT_SECTION_MODULE_IDS`. Published packs:
  `minimed.tools.core-clinical.ru` preview.2 (the original 17 renal/emergency/cardiology/hepatology/
  hematology calculators plus BSA, CKD-EPI 2021, Schwartz 2009, maintenance fluids, and paediatric
  ORS); `minimed.tools.obstetrics-gynecology.ru` (full ObCalc set plus Apgar, EPDS, Ferriman–Gallwey,
  and Whooley); `minimed.tools.psychology.ru` (Braverman, egogram, PAEI, team roles, temperament);
  plus gastroenterology preview.2, neonatology, pediatrics, and emergency. Assessment score bands for
  downloaded questionnaires come from JSON `interpretations` (`minScore`/`maxScore`/`headline`/`message`),
  not hardcoded engine branches. Hadlock gestational age by biometry (`obstetric-ga-biometry`) is a
  CalculatorSchema in `minimed.tools.obstetrics-gynecology.ru` preview.2; the expression language has
  `present(name)` so optional biometric inputs can be averaged. Search query analysis still runs in a
  Web Worker after downloaded modules are installed (`createBrowserWorkerCore` remounts IndexedDB packs).
  Intra-route calculator, assessment, and document-catalog hash changes (catalog → collection,
  section, or tool) reset window scroll to top; root-tab scroll restore is unchanged. Unit tests
  evaluate every tool-module calculator schema across each input’s domain and assert the engine never
  throws.
- Module and model downloads share retry/backoff and resumable partial bytes, but use independent
  network lanes: up to three document installs run concurrently while additional documents remain
  queued, and the selected model always receives its own download slot. Content-pack progress is a pie
  on the top-right of the Settings icon while a pack is queued, transferring, or installing; failed or
  idle packs hide that pie. The manager lives at `#/settings/downloads` rather than a
  floating pill. A single document runtime
  survives catalog refreshes; transient failures release their slot before an automatic retry so one
  broken source cannot starve the queue.
- The knowledge graph remains interactive during hover/focus and visually distinguishes clinical,
  medication, legal, and personal-note sources; its canvas supports wheel zoom, pan, and two-finger
  pinch zoom on touch devices. The embedded graph dialog is 95dvh tall.
- Model settings live in Settings (`#/settings`); the optional local model loader indicator sits on
  the settings nav icon when no content-pack download pie is covering that corner. Settings sections
  use paper-sheet cards with headed icons. The downloads card is a whole-card link to
  `#/settings/downloads`; hover uses the accent border, and an idle card reads «Тут будут ваши загрузки».
  Model settings use the shared paper theme tokens, and the
  available-models row uses a chevron disclosure. They distinguish always-available offline search
  from the optional local model and expose model size, requirements, advantages, limitations, and
  model selection.
- Device preferences in Settings persist vibration on/off (default on), remember-search-mode
  (default off), and zen-pack UI sound volume (default 20%; zero mutes and stops playback).
  The Settings heading keeps back and title on one row (no in-heading app icon). Android, iOS, and browser
  favicons use the same mark; replace `branding/app-icon-source.png` and run `bun run icons:generate`
  to rebuild every size. GitHub and Android APK links at the bottom of Settings use `--theme-link` in both themes.
- Haptics: Android uses `performHapticFeedback` via `LocalMedHaptics` (selection/light/medium/heavy);
  iOS uses Capacitor Haptics impact/selection; web does not call `navigator.vibrate`.
- Zen-pack UI sounds go through one `UiSoundController`: cards, buttons, sliders, links, horizontal
  scroll ticks, and fine-pointer hover (touch pointers stay silent). Volume is the single mute/gain
  control. Web Audio unlocks from the first pointer or keyboard gesture on the app shell.
  Distinct cues map delete, print/share, search submit, scroll-to-top, add-note, navigation links,
  radio reselect, and overlay close to dedicated zen sounds; hover uses info on links, warning on
  delete, and snap on toggles.
- Browser application updates install in the background but wait for explicit approval on the search
  sticky toolbar or the Settings checker (compact percent while an APK downloads) before the new
  service worker activates and reloads the page. Android checks the latest GitHub release, downloads a
  newer APK through explicit `CapacitorHttp.get` (global CapacitorHttp stays disabled so module
  `fetch` is not patched), writes it in chunks through `LocalMedUpdate`, and hands the file to the
  system installer. Published tool packs (`minimed.tools.*`) auto-install at boot; the medications
  companion stays user-initiated. The packaged web
  assets include only the Core SQLite (`core-demo.db`); companion databases stay optional local-dev
  files and are stripped from `dist`. Android aapt ignores those companion filenames explicitly —
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
  to go and shows route cards for the test catalog and the previous place. Patient names are suggested from locally stored patient cards, and external/manual test
  results can be saved into the same local result history.
- Vertical mouse-wheel delta is translated into horizontal movement for the shared overflowing-strip
  component, including mixed diagonal wheel input; touch and trackpad scrolling remain native.
- Android draws the page background beneath its transparent status bar while sticky chrome and
  page surfaces add `--safe-top` themselves; there is no solid desk-colored status-bar plate.
  The launch splash and in-app boot screen fill the viewport with paper (`@color/splashBackground`
  on the splash theme; there is no second `drawable/splash.xml` beside Capacitor's `splash.png`).
  Android keeps the window edge-to-edge from `onCreate` (before the WebView) and does not use
  `windowFullscreen`, so splash/boot do not first layout between the system bars and then stretch
  under them. System-bar icon contrast
  follows the device theme. Hardware Back closes the
  active dialog or drawer, returns through nested routes and root sections, then minimizes the app at
  the search root. Native-like haptics respect the vibration preference and platform capabilities
  (see device preferences above).
- Native print actions use an in-app preview over the desk background: one A4 sheet with content
  scaled to fit, a non-printing Back header, and a share (native) or print control that the user taps
  — Android does not auto-open the system print dialog. Hardware Back can exit the preview.
- In-document tables and images pinch-zoom 1–3× with an opaque fill, a dimmed lightbox, and a smooth
  reset on scroll or a click beside the figure. The fullscreen media viewer has zoom controls on the
  left of its toolbar. Clinical full-text install progress and local-model download progress show in
  the reader button and the diagnosis brain-download icon.
- Installed-content changes re-run the active query without clearing the visible results and announce
  the refresh state.
- Diagnosis mode includes a visible explanation that local model output can be wrong, must remain
  source-grounded, and does not replace clinical responsibility.
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

- Device-local patient cards support editable summaries and a flat dated record timeline; the former
  nested-reply editor is no longer exposed. Card and record deletion require an accessible Kobalte
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
  icon with confirmation, and support long-press multi-select.
- Personal matches appear in search with an explicit personal-source label and outside the official
  result container, so they cannot be mistaken for installed medical content. The block collapses by
  default, shows up to five combined note and book hits sorted by score, and can expand like an
  accordion; note and uploaded-book hits use themed cards, and books carry a notepad icon.
  The «Ваши данные» scope
  searches only personal notes and user-uploaded books and never queries the official SQLite corpus.
  Personal hits require every distinctive query stem (inflected forms still count); a shared leftover
  such as «дети» or «мг» no longer surfaces a book or note that does not contain the specific term.
- User-uploaded PDFs, images, and text-like files live in IndexedDB as a personal overlay: visual
  pages render immediately while throttled tesseract.js WASM OCR runs in a background worker; only
  extracted text is indexed for personal search, never written into official content packs.
- «Ваши документы» opens a dedicated catalog at `#/modules/documents/user` with upload, fuzzy
  search, rename with confirm, virtualized cards, and OCR progress; opening a document navigates to
  `#/modules/documents/user/<documentId>` (optional `/p/<pageIndex>`) with breadcrumbs
  (origin — Поиск or Ваши документы — then nested titles via Kobalte); a pasted user-document URL
  parents back to the user catalog, in-document search,
  outline, selectable OCR/native word overlay on page images, and print of extracted text.
- Document text links installed medications, recommendations, and laws into nested
  `#/modules/documents/d/…` pages and
  show kind icons beside each link, with a traveling wavy underline on hover.
  Links skip the open document and its family (summary, full text, revision, or topic card such as
  `kr.rf.281_3` → `kr.rf.281_3.uti`), so an abbreviation defined in a recommendation does not open
  that same work again or add a duplicate breadcrumb.
- Official JSON figures keep a nearby `Рис.`/`Fig.`/`Таблица` paragraph as the caption instead of
  the CMS filename (`image.png`). Already installed packs get the same pairing in the reader
  without a rebuild.
- A clinical-summary reader installs the matching individual JSON recommendation on request, then
  reconnects the local corpus and replaces that same reader with the full document.

### Local model

- Validated remote/cache/bundled model catalog and device selection.
- Browser CPU/WebAssembly GGUF runtime with a structured-output viability probe.
- A CLI `tester-box` builds a disposable full-corpus FTS index and compares the three catalog models
  across 20 clinician cases using direct and strict-JSON prompts, exact-quote/number validation,
  explicit dose-conflict detection, and one bounded repair attempt.
- Optional compact query planning and coarse relevance-based reranking over at most six retrieved
  chunks, applied in the background without delaying deterministic results.
- The runtime model does not extract diagnoses, doses, or citations; failed or unrecognized model
  output leaves the deterministic result order unchanged.
- The default browser path uses the catalog's immutable upstream model asset rather than an unavailable
  release mirror.

The model cannot open the network, change the corpus, create a citation, calculate a dose, or hide the
ordinary search response when validation fails.

### Content and downloads

- Deterministic preparation, Markdown validation, stable IDs, provenance, and SQLite building.
- Public/private source registries with rights metadata and extraction diagnostics.
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
  hidden, and category removal leaves its busy state before the search index reconnects.
- Official GRLS inventory contains 38,815 unique registration records from 140,274 status/version rows,
  with the source ZIP, edition, and checksums retained locally.
- Current official instruction synchronization covers nine pilot medications; eight text-layer PDFs
  build into a 147-chunk SQLite pack and the oseltamivir scan remains explicitly blocked on OCR.
- The local Allmed companion `apps/app/public/content/medications.db` (~421 MB, 4,708
  `allmed_reference` cards) is the full drug catalog for local/dev use. Browser sqlite-wasm no longer
  deserializes that file into the WASM heap (that path OOM'd). It streams the pack into an OPFS SAH
  pool and opens it from disk; the first boot copies ~421 MB into origin-private storage, later boots
  reuse it. A truncated, empty, or legacy OPFS copy is discarded and re-imported instead of failing
  MultiMedicalStore composition and blocking app boot; OPFS virtual filenames use the required
  absolute-path form. On browsers
  where `FileSystemFileHandle.prototype.createSyncAccessHandle` is unavailable
  on the window thread (Safari and some Chromium builds), the main thread opens the pack in a
  dedicated worker with pool name `minimed-sah-pack` and proxies it as a `MedicalStore`; the search
  worker still opens OPFS directly (`minimed-sah-worker`) because it already runs in a dedicated
  worker. `mkb.db` / `ambulatory.db` still stay closed unless
  `VITE_OPEN_UNSAFE_WASM_COMPANIONS` names them. Core still contributes eight
  `source_linked_summary` registry cards. The 560 KB `data/build/medications.db` GRLS pilot is a
  separate one-drug pipeline artifact, not this catalog.
- Optional local-dev `mkb.db` companion (`minimed.mkb.ru`) contains the full RLS MKB index (9,841
  nodes) plus the default `I67.9` detail page, 138 grouped trade-name cards, 4,956 unique MNN/form/
  dosage/package/manufacturer rows, stable medication brand/substance IDs, trade-name→MNN aliases,
  exact evidence, and proposed code-to-medicine relations. RLS detail cards use the dedicated
  `rls_mkb_reference` source type, so medication search sees only cards that mention medicines;
  generic medical references remain outside that scope. Clinical-catalog `icd10Codes` metadata is
  projected into FTS with punctuation-free variants so installed recommendations are found by
  `I67.9`, `I679`, `I67-9`, `I67 9`, `679`, `67-9`, or `67 9`. Three-attempt failures are saved to
  `rls-mkb-failures.json`; `bun run content:retry:mkb` repeats only those detail URLs. Build with
  `bun run content:rebuild:mkb`; the builder reuses the validated knowledge workspace, batches
  SQLite writes, and performs one final compaction pass. Existing packs can receive the authority
  and knowledge-search upgrade with `bun run content:upgrade:mkb`, without reparsing Markdown.
- Optional local `ambulatory.db` companion (`minimed.ambulatory.v1`) mounts private textbook/handbook
  extracts for site/call use. Build via `bun run content:rebuild:ambulatory` (anydoc text-layer +
  macOS Vision OCR). Pack is gitignored — copyrighted sources stay local; GroundedMedicalCore already
  cites whatever MultiMedicalStore returns, so diagnosis AI uses ambulatory chunks once mounted. See
  `docs/AMBULATORY_CORPUS_V1.md`.
- Public Russian starter pack: seven clinical navigation cards and eight medication-registry identity
  cards.
- Structured knowledge tables support proposed facts, exact evidence links, relations, and review tasks.
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
- The runtime fingerprints actual module versions, digests, URLs, checksums, and sizes rather than only
  comparing catalog counts.
- Regulatory catalog rows resolve Russian document titles, revision dates, and current/historical status;
  document readers render structured tables as HTML tables rather than image blocks, with a compact
  inline view and a full-screen overlay for wide tables. The current 192н
  pilot artifact is still a source-linked summary without the official specialist-visit schedule table;
  that content gap must be filled from a reviewed full source before it is used as a clinical schedule.
- Browser artifact QA can set `VITE_CONTENT_BASE_URL` to the remote `apps/app/public/` root and
  `VITE_USE_LOCAL_MODULE_ARTIFACTS=false`; this fetches packaged databases and catalog modules from
  their published remote URLs without using local `public/content` copies.
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
- 60 of 61 expected documents are ranked first in all-source mode;
- section recall and top-section accuracy are both `1.00`;
- the pediatric ceftriaxone workflow ranks the pneumonia recommendation first and the ceftriaxone
  registry card second in all-source mode; medication scope removes the unrelated clinical document;
- exact context, section, and source-metadata resolution remain release gates.

Chromium coverage includes search onboarding, source scopes, the history drawer, mounted-route state,
document reading, source-context expansion, module lifecycle, responsive navigation, personal notes,
and follow-up reminders.
A browser QA pass also verifies that HTML or other non-SQLite responses at packaged database paths are
rejected before WASM deserialization, so missing optional assets no longer block core boot; a missing or
corrupt `core-demo.db` fails boot with `Не удалось открыть ядро MiniMed` instead of an embedded JSON
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

## Known limits

- Clinical starter documents are concise source-linked cards; the separately installable snapshot
  contains the official structured recommendation text, headings, tables, and embedded figures.
- The selected oseltamivir instruction still requires reviewed OCR; the clinical recommendation
  snapshot no longer depends on PDF OCR.
- Text-layer drug PDFs can still lose visually distinct subheadings that use the same font size as
  body text. Preserved layout metadata prevents list continuations from absorbing adjacent text, but
  complex layouts still require reviewed structure extraction before publication.
- Medication registry cards establish identity, form, strength, and registration status; they do not
  establish a verified regimen.
- The GRLS `data/build/medications.db` pipeline proof is still one-drug; it is not the local Allmed
  catalog. Allmed cards are reference snapshots, not verified dosing. Similar products, normalized
  dosing facts, ATC classification, and additional dosage forms remain absent from the official
  instruction pack.
- The MKB companion is a local-dev reference pack: the full-detail crawl is network-heavy and must be
  explicitly requested, while its code-to-medicine relations remain proposed/reference-only rather
  than treatment guidance. The public AJAX endpoint is used for forms and manufacturers; raw HTML is
  not bundled.
- The published corpus still lacks complete verified drug instructions, legal/normative material,
  vaccination calendars, nutrition, growth, development, and calculation-rule sources. The complete
  clinical-recommendation snapshot is not yet a complete physician knowledge base.
- The full GRLS export has no confirmed ATC field, so most catalog records remain visibly unclassified.
- The installed corpus must abstain from dose output when no supplied source contains the exact regimen.
- Small local models can satisfy a JSON shape while citing semantically irrelevant exact text; the
  20-case tester-box result is a screening benchmark, not clinical qualification.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- Physical Android interruption, memory-pressure, and local-model inference qualification remain release
  follow-up checks even when the debug APK and browser automation are green.
- Personal notes use unencrypted device-local browser storage and are a notebook rather than an
  electronic medical record. Per-card export, a whole-notebook wipe, and local Russian transcription
  are not implemented.

## Ordered next work toward 1.0

1. Grow the content bank before further retrieval/model work — see [CONTENT_DATA_PLAN.md](CONTENT_DATA_PLAN.md)
   for the full cross-category priority list (regulatory acts, pediatric norms/calculators, assessments,
   diets, nutrition/feeding norms). A personal textbook library under `Med/` is an acceptable cited source
   per book/edition/page ([LITERATURE_BANK.md](LITERATURE_BANK.md)) — MiniMed itself is never the cited
   source — but redistribution review still applies before any extracted table or excerpt publishes.
   Anything uncertain found while extracting goes to [LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md)
   for review rather than being silently trusted.
2. Verify the 0.6.10 prerelease on a physical Android device, including system-bar insets, native Back,
   locally scheduled
   notifications, note-image persistence, and the published Pages `/app/`.
3. Validate the one-drug `medications.db` pipeline, then expand it without hand-editing generated
   SQLite.
4. Add verified OCR for the blocked drug instruction.
5. Expand real Russian clinician-query, unsupported-answer, and source-scope benchmark coverage.
6. Add explicit export and whole-notebook deletion, then evaluate an optional downloadable Russian
   on-device transcriber.
7. Qualify bundled local models on citation fidelity, abstention, latency, storage, and memory before
   presenting diagnostic assistance as a 1.0 capability.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.
