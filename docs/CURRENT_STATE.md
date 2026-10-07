# Current state

> Updated: 6 October 2026
> Released version: `0.6.47` (public prerelease toward `1.0`)
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

## КР modules rebuilt with numbered sub-headings — 2026-10-07 (STATE KR3)

Owner OK 2026-10-07: rebuild and republish the clinical-recommendation modules with the numbered
sub-heading rule of [UX11c](#кр-headings-image-zoom-and-selection-ux11c--2026-10-07). Only modules whose
content changed because of the rule were republished; the other 652 keep their catalog entry, version and
URL, so no device re-downloads them.

- **Rebuilt from the raw JSON** (`data/raw/official-clinical-documents/<id>.json`, nothing re-fetched) with
  the committed July plan for the 744 earlier modules and the 2026-10-02 plan for the 30 newer ones
  (`build-documents` → `compact-module-search` → e5 vectors → framed zstd), 774 modules in all. Each was compared
  with the published module (`tools/ingest/scripts/compare_clinical_modules.py`, document / section / chunk
  rows). Separating the rule from older importer drift needed a control build of the 135 candidates with the
  rule switched off: **122 modules changed because of the rule** (841 headings baked in, most in one
  document: 58); 652 are unchanged for the rule. 616 of those still differ from the published bytes by importer
  changes since 2026-07-27 (image label «image.png» → «Иллюстрация», figure/table captions attached to their
  figure; same text, other chunk ids) and 8 by an older structure difference; they were deliberately not
  republished.
- **Extractor: where the rule stays a display-time fact (revision 3).** A first rebuild showed that promoting
  every matching paragraph hides text: the reader drops a section with no text of its own and none below it,
  so a classification list («2.3.1 Краснуха», «2.3.2 Другие» …) or a checklist of numbered lines became
  invisible in the page, the contents and the search index (288 headings in 35 modules), and a promoted
  `3.3.1` at the same level as a stored `h3` «3.3 Иное лечение» left that heading hidden. `clinical_json_import`
  now keeps a matching paragraph a paragraph whenever promoting it would leave it, or a stored heading, hidden
  (`_demote_hidden_promoted_headings`, judged with the reader's own rule, to a fixed point). Of the 1 192
  promotions of the first pass 351 stayed paragraphs; the rule function itself (shared cases file, TS twin)
  is untouched. Those paragraphs are still promoted by the app's display layer, so a current app shows
  them as headings as before, and an older app shows them as plain text exactly as today. Extractor revision
  3 (so `prepare --reuse` re-extracts revision-2 extractions). Tests:
  `test_clinical_json_numbered_headings.py` (+2), `kr-numbered-heading-modules.spec.ts` (3 modules).
- **Published** to the new additive mirror branch `datasets/clinical-json-2026.10.07-197a48d1f268` (122
  `.db.zst`, **139.0 MB** instead of 138.3 MB, 347.6 MB installed instead of 334.7 MB; version
  `0.6.0-json.9db36e75287b.e5`, i.e. the vectors are the same e5 profile, recomputed for the new chunks). Nothing
  existing was touched; no release. `minAppVersion` stays 0.6.46: the data is plain sections, any app reads it.
  Catalog `publishedAt` 2026-10-07T15:40:00Z, `catalogVersion` `kr3-numbered-headings.2026.10.07`; the
  whole КР download is 689.2 MB (was 688.6). Editions sidecar needed no change (998_1 below). Local copy:
  `output/module-zstd-json-2026-10-07/` (the E2 copy `output/module-zstd-e5-2026-10-05/` stays for the 652
  unchanged modules).
- **Identifiers.** Document ids, titles and version labels are identical in all 774 modules. In the 122 modules
  (6 133 sections, 20 922 chunks): 6 123 section ids kept, 841 added, **10 changed** (six modules where a stored
  deeper-level heading, e.g. «3.2.», now sits below a promoted «3.1.» — 1028_1, 1041_1, 391_3, 551_3, 555_3,
  650_2 — so its path-derived id moved), 17 047 chunk ids kept, **3 875 changed** (3 830 new): 1 978 because
  chunks moved under a new sub-section, 2 191 because of the importer drift above (they overlap). That is 4.0 %
  of the 95 827 chunks of the КР modules. Nothing shipped references them: the released core 0.6.47 holds
  its own pointer chunk ids (its KR-derived definition evidence points at «Термины и определения» chunks
  that did not move), mkb/medications/ambulatory/reference packs, the drug-comparison / interaction /
  substance-fallback assets and `clinical-medication-relations` contain none of the changed ids or anchors, and no
  committed test, fixture or benchmark does. Stored on a device: KR highlights (keyed by chunk anchor, quote-checked;
  new today and unreleased), copied section links and a remembered reading position fall back to the document
  top for a moved anchor; bookmarks are per document and survive. No rebuild of the core, the e5 query model or any
  index is needed.
- **998_1** is a changed module whose raw file was re-saved by the registry after the published build (see KR2):
  the rebuild records the current file's checksum (`dfd5f4f7…`), so its source-set digest and document-table
  row differ and the editions sidecar now agrees with the module; its text is as before. The other 11 re-saved
  editions are superseded modules that did not change for the rule and stay as published.
- **Verified:** all 122 `.db.zst` decode with the reference `zstd` CLI to the catalog's decoded checksums, SQLite
  integrity and foreign keys ok, one e5 vector per chunk; every new mirror URL returns the catalog size and
  SHA-256 with `access-control-allow-origin: *`; token check on all 122 modules (text lost from chunks = exactly
  the moved headings, nothing gained); no heading that was visible before is hidden now (0 of 841);
  `bun run typecheck`, `vitest` (469 files, 8 972 tests; one 5 s timeout of `KnowledgeGraph.test.ts` on a busy host,
  green alone), `pytest tools/ingest` , ruff/pyright, `bun run benchmark:all` within tolerance. In a Chromium
  build (`E2E_PORT=4199`, one worker) modules 1062_1, 555_3, 960_1 and 1006_1 installed from the catalog and
  opened: each promoted heading is one outline entry and one title and not repeated as body text.
- **Spot check** (10 documents, all 841 headings screened for doses, ICD codes, units): no dose or code line was
  promoted. Borderline, kept by the rule: descriptive list lines with an enumeration (791_1 «6.1. Интраабдоминальные:
  оментит, …»), the long «7.1. Критерии оценки качества … (коды по МКБ-10: …)» lines of 62_3 and a diagnostic
  criterion «1.1. Подозрение на синдром Линча – …» (396_4); sentence-like items with a trailing full stop
  («1.1. Простой.») are classification entries.
- **Not verified:** Android/WebView or a phone, slow hardware, an older app against the new data (it reads plain
  sections, not run), a physician review, the lexical/semantic search quality on the rebuilt modules (headings now
  also reach FTS through `section_path`; no benchmark was re-run on the 122 modules).
- Tools: `tools/ingest/scripts/compare_clinical_modules.py` (published vs rebuilt), `embed_modules_e5.py --from-dir`
  (rebuilt, compacted databases), `scripts/republish-clinical-modules.ts` (rewrites the listed entries only; new
  version, artifact id, URL, sizes, checksums, digest from the database).

## Module catalog cache — 2026-10-06 (STATE CAT1)

The remote catalog (`catalog.preview.json` on raw.githubusercontent.com) is 7.54 MB, 2.19 MB gzip on
the wire. Its cache used to be one `localStorage` value; the serialized record is about 6.3 MB, over
the quota, so `setItem` threw and the error was swallowed: no validators were ever stored, every
start downloaded the whole catalog, and an offline start used the older bundled catalog.

- **Cache** (`apps/app/src/features/modules/catalog-cache.ts`): IndexedDB database
  `minimed-module-catalog`, store `records`, one record under `preview`. The catalog travels as JSON
  text and is schema-validated by the core on read; a record of the wrong shape or with damaged JSON
  is deleted and reported (`onCacheFailure`), never silently ignored. The old localStorage key
  `minimed.content-module-catalog.preview.v1` is removed on the first refresh, not migrated.
- **Record** (core, `CONTENT_MODULE_CATALOG_CACHE_FORMAT = 2`): format, `appVersion`, `publishedAt`,
  validators, `catalog`. The catalog body is kept only when the remote was strictly newer than the
  bundled one at that time; when the remote merely equals the shipped catalog only the validators and
  `publishedAt` are stored, so the usual state right after a release costs no storage and no parse.
- **Resolution** (`loadContentModuleCatalog`): always the newest of bundled, cached and remote by
  `publishedAt` (ties: bundled, then a freshly fetched remote, then the cache), also on 304 and on
  fetch failure. A record from another app version, or whose body is absent while the bundled
  catalog is older than the remote it describes, loses its validators (a full revalidation); a record
  of another format or one that fails the schema is dropped. Results carry `network`
  (`downloaded`, `not-modified`, `skipped-metered`, `failed`).
- **Transport** (`catalog-fetcher.ts`): raw.githubusercontent does not expose `ETag` to a page and
  its CORS preflight answers 403 to `If-None-Match`, so a page cannot send validators there. Android
  uses the native HTTP client (`CapacitorHttp`: validators sent and read back, 304 passes through);
  the browser uses `fetch` with `cache: 'no-cache'`, so its own HTTP cache revalidates. Not tested on
  a device: the 7.5 MB text response through the Capacitor bridge.
- **Metered connections**: the start-up refresh on a cellular or data-saving connection
  (`coreAutoDownloadAllowed`) contacts the remote only when the cache holds trusted validators (a
  304 costs about 1 KB); without them it uses the local catalogs and does not download. Opening the
  module catalog screen counts as the user asking and may download.
- The start-up refresh no longer ends in `.catch(() => undefined)`: a failure is logged with
  `console.warn` (no clinical text). Offline or HTTP failures stay a `warning` on the result, shown by
  the module catalog screen.

Bytes per start (GitHub, measured with `curl`): before, every start 2 194 392 B on the wire (7 537 011
B decoded, then JSON.parse 15 ms + zod 95 ms on a desktop). After: first start with no record 2.19 MB
once; every later start a 304 of 514 B response headers and no body (cellular: 0 B for the first start).
Size by part: `documentTable` rows 5.85 MB (77.7 %; 1.94 MB gzip) in 795 modules, two ICD reference
modules alone 3.3 MB; `artifacts` 0.48 MB; `tools` previews 0.19 MB; the rest (titles, tags, sizes,
compatibility) about 1 MB. Not changed here: the document table is what lets a pointer open a
document without installing the module, so trimming it is a catalog-format task.

Tests: `packages/core/tests/content-module-catalog-client.test.ts` (newest of three, stale cache on 304 /
failure, other app version / format / schema, metered, cache failures reported),
`apps/app/src/features/modules/catalog-cache.test.ts`, `catalog-fetcher.test.ts`,
`apps/app/e2e/module-catalog-cache.spec.ts` (cached → reload → conditional 304, offline start, newer
bundled catalog after an app update, other app version).

## iOS on iPad mini and iPhone simulators — 2026-10-06 (STATE IOS1)

First time anything ran on iOS. Tested on the **iPad mini (A17 Pro) simulator** (744 × 1133 pt, iOS 26.5)
in Safari and in the Capacitor app, plus the iPhone 17 simulator and Playwright WebKit (iPad mini,
iPhone 15, Slide Over 320 and half-split 570 pt widths). Screens: `output/ios1-screens/` (not
committed; `*-before` / `*-after`, named by device, orientation and screen).

**Works.** The iOS app builds from the committed project (no source changes needed beyond the ones
below), installs and runs: the packaged core opens through the native SQLite plugin («Ядро знаний уже
на месте»), search (20 127 sources, typed through the software keyboard), document reader with the
sticky and hide-on-scroll chrome contract, section/module download and install (4.2 MB drug module
→ drug screen), settings, patient vault (Keychain), camera picker (ECG), share popover, dark mode,
the onboarding tour. In the web view: OPFS incl. sync access handles in a worker, MediaRecorder (webm
and mp4), `navigator.share` with files, backdrop-filter, `@property`, Web Locks, CompressionStream. The
patient diary works in iPad and iPhone Safari (first open, entry with the keyboard, the install card).

**Fixed.**

- *Onboarding blur missing in WebKit.* A radial mask whose first colour stop is negative paints nothing
  in Safari/WKWebView, so the veil (blur and tint) never showed and the greeting sat on the sharp app.
  Stops are clamped (`max(0%, …)`). Headless WebKit paints no backdrop-filter at all: judge blur in the
  simulator, not in Playwright.
- *Portrait tablets.* 744 pt is below the 760 px tablet breakpoint and got the 65ch phone strip with
  83 pt desk gutters. From 600 px the page board is the full width (still one column).
- *Input zoom.* iOS zooms into a focused field under 16 px: on iOS (`@supports (-webkit-touch-callout)`)
  text fields are held at 16 px (`styles/global.css`).
- *Date and time fields* (`date`, `time`, `datetime-local`) stuck out of their card in the patient form
  and the diary and were taller than text fields: `appearance: none` on iOS.
- *Saving files in the app.* `<a download>` of a blob does nothing in the iOS web view (no error). Six
  places (note attachments, transcript, drawing, patient export, user documents, notes backup) now call
  `saveBlobAsFile` (`state/native-share.ts`): the system share sheet on iOS (popover on iPad, «Save to
  Files»), the anchor elsewhere. `navigator.share({files})` works in the web view; verified.
- *Info.plist* had no camera/microphone usage strings: iOS ends the app at the first access.
  `CapApp-SPM/Package.swift` was stale (`@capgo/capacitor-downloader` missing); `cap update ios` fixed it.
- *Launch.* The storyboard was the stock white Capacitor splash and the web view is white until paint,
  so every start flashed white before the cream boot surface. Launch screen: cream + the 190 pt wallet;
  `ios.backgroundColor` in `capacitor.config.ts`.
- *Diary «На экран Домой».* (follow-up in «Patient diary on the iOS home screen», STATE DIARY3.) iPad: the share button is in the top toolbar (iPad detection already
  existed for iPadOS' desktop-class UA). iPhone on Safari 26: «Поделиться» is inside the «⋯» menu.

**Build and run (simulator).** Sanitized environment, no signing identity needed but the app must be
**ad-hoc signed** (`CODE_SIGN_IDENTITY=-`): an unsigned simulator build cannot use the Keychain, and the
patient vault then reports that the key was not saved.

```bash
bun run build:app
# the Android build drops the four large databases; do the same for iOS (core.db stays, ~590 MB):
rsync -a --delete --exclude content/ambulatory.db --exclude content/medications.db \
  --exclude content/mkb.db apps/app/dist/ apps/app/ios/App/App/public/
cd apps/app && bunx cap update ios        # plugins / Package.swift; `bun run cap:sync:ios` also copies dist
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath <scratch>/DerivedData \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build
xcrun simctl install <udid> <scratch>/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch <udid> dev.localmed.search
```

The Safari side serves the build on 127.0.0.1 (`vite preview --outDir … --host 127.0.0.1`) and opens
`xcrun simctl openurl <udid> 'http://127.0.0.1:<port>/#/route'`; `simctl openurl` opens a new tab each
time, and two tabs fight for the one OPFS owner («MiniMed открыт в другой вкладке») — close the old
tab. The iOS-simulator MCP tool can tap, swipe and type (Latin only; Cyrillic text arrives garbled).

**Tests.** `ios-layout.spec.ts` (no sideways scroll at iPad portrait/landscape and iPhone widths, the
portrait page uses the width, the veil mask has no negative stop in WebKit) and an iPad case in
`diary-install.spec.ts`. Opt-in WebKit project: `PLAYWRIGHT_WEBKIT=1 bunx playwright test
--project=webkit-ios` (needs `bunx playwright install webkit`); the specs also run in Chromium. Headless
WebKit cannot navigate offline, so the diary offline spec is skipped there.

**Not verified.** Landscape in real Safari / the app (the simulator cannot be rotated without
accessibility permission for the tool; landscape is checked in Playwright WebKit only — no sideways
scroll, layout as Chromium); iPad Split View / Slide Over in the simulator (widths 320 and 570 checked
in WebKit: the ECG card's «Сфотографировать» button clips at 320); real devices (Keychain with a
real team, camera, microphone permission prompt, haptics, notifications, ProMotion), the Pencil and
touch drawing (Excalidraw), PDF viewer canvas limits on iOS, scroll lock under a sheet, the home-screen
install flow itself (the share sheet cannot be driven), Safari offline after the first visit, PWA
storage eviction (ITP: 7 days without a visit), the real App Store/TestFlight signing. Left as is:
document breadcrumb keeps a stale «Открываем документ» segment after a module install (not iOS
specific), 320 pt Slide Over clipping, `UIRequiredDeviceCapabilities` still lists `armv7`.

## Shared PDF viewer — 2026-10-06 (STATE W3)

Owner decision 2026-10-05: «PDF viewer — just re-use our viewer». The pdf.js reader that lived inline
in `UserDocumentReader` is now one module, `apps/app/src/features/pdf-viewer/` (`PdfViewer`,
`createPdfViewerModel`, `PdfThumbnails`, `PdfFileViewer`), and fills the gaps of W3.

- **Where a PDF is shown, and what is not a PDF here.**
  - «Ваши документы»: `UserDocumentReader` hosts `PdfViewer` (reader chrome, header find, page strip in
    the side panel, menu items «Миниатюры страниц», «Открыть в системе», «Печать»).
  - Note attachments (saved or not yet saved; patient notes, ordinary notes, the timeline): the
    attachment dialog hosts `PdfFileViewer` with its own toolbar (find, page strip, print, open in
    the system). Before, a PDF there fell into «Этот тип файла нельзя показать в заметке».
  - Library card thumbnails (first page, `state/thumbnails.ts`) and OCR ingest still use the same
    `state/pdfjs-document.ts` loader; unchanged.
  - Nothing else shows a PDF file because nothing else ships one: ГРЛС / Allmed / manufacturer
    instruction modules, КР and the forms are text/JSON/schemas (the originals are only recorded as
    `pdfSha256` / `officialSourceUrl` and open as external links); the form preview and print are HTML
    pages (F1/F2); no regulatory scans ship. If a module ever ships an original PDF, or a form offers
    «Сохранить оригинал в Ваши документы», it opens in this viewer (rights decision pending); the
    NEWS1 site viewer is an iframe of its own (request in `STATE.md`).
- **Find.** The units are whole pages of pdf.js text (`pdf-page-text.ts`: item `i` of the text is
  `textDivs[i]` of the layer), searched by the same `findInUnits`/worker as every reader, so a phrase
  matches across lines (the old word units could not). Hits are painted with the CSS Custom Highlight
  API (`::highlight(pdf-find-hit | pdf-find-active)`; a class on the spans where it is missing), next /
  previous bring the match to the middle (`pdf-find-state.ts`, `pdf-find-dom.ts`). Page text is read
  idly 2.5 s after opening (≤ 600 pages) or when find opens; a search waits for it (`busy`). Scanned
  pages without a text layer keep the recognised-word units and the OCR overlay.
- **Page strip, go to page.** Thumbnails (104 px, DPR ≤ 2) live in the reader's side panel — open by
  default in a wide window, a drawer under the header button on a phone; capped at 6 MB with LRU release
  (`pdf-thumbnail-budget.ts`), drawn after pages; in a dialog a rail (a floating strip on a phone). The
  dock above the bottom navigation has previous/next, a page box (type a number, Enter) and zoom.
- **Zoom.** 50–400 % of the column width: buttons, two-finger pinch (anchored at the fingers),
  Ctrl/⌘ + wheel / trackpad pinch, Ctrl/⌘ +/−/0; the % button cycles «По ширине» / «Вся страница»
  (`pdf-zoom.ts`). Pages keep their own aspect ratio from the first read of their size, so positions are
  exact before they are drawn. During a zoom only the CSS scale moves; bitmaps and text layers are
  redrawn 220 ms after it settles.
- **Resume.** Page, offset inside the page and zoom per document (`user:<id>`, `note:<id>`) in
  `localStorage` (`minimed.pdf-position.v1`, newest 150; `pdf-position.ts`). A search hit / explicit page
  wins; a restore keeps its target for 1.5 s while page sizes arrive.
- **Chrome contract** (`docs/NATIVE_STICKY_CHROME.md`): the dock slides out with the bottom navigation
  when the user scrolls down and returns on scroll up; a jump the viewer makes itself (find next, go to
  page, thumbnail, restore) keeps the controls through `state/reader-chrome-hold.ts`.
- **Phone performance design.** One `PdfRenderQueue` (2 concurrent, nearest page to the viewport centre
  first, thumbnails last, off-screen renders cancelled), page bitmaps ≤ 2.5 MP each and ≤ 24 MB in total
  (`pageBudget`), bitmaps swapped in only when complete (no blank flash), pdf.js caches freed by a
  retrying `pdf.cleanup()`, and the text layer built in slices of 8 items after a page has stayed on
  screen 250 ms: pdf.js measures every item with `canvas.measureText`, which made one dense page a
  1.2 s main-thread task.
- **Measured** (`PDF_PERF=1 … pdf-viewer-perf.spec.ts`, production build, headless Chromium, 390 px at
  2.75×, CPU throttled 4×, 150 dense pages / 465 KB; the machine ran at load 12–28 from other agents, so
  absolute times are pessimistic; 4 runs, ranges): open → first page with text layer 0.9–1.2 s;
  finger-speed scroll (140 frames × 30 px) 1.6–1.8 s wall, frame p50 8 ms, p95 34–41 ms, none over
  100 ms, longest task 82–231 ms (before the sliced text layer: 9.3 s, p95 775 ms, 1.2 s tasks); fling
  over all 150 pages: p95 frame 34–42 ms, peak 8 live page canvases = 6.3 MP (was 23 / 18 MP) — two of
  four runs saw a single 1.3 s / 5.6 s stall from other processes; page draw 27–30 ms median;
  jump to page 140 → drawn 0.24–0.29 s (one run 1.7 s); first search 0.38–0.44 s (22 hits), a 5 700-hit
  search 0.44–1.4 s, next match 0.12–0.18 s; two zoom steps → sharp 0.6–1.3 s; thumbnails of all 150
  pages scrolled through: ≤ 25 drawn at once, 1.5 MP. JS heap 54 MB after open → 129 MB after visiting
  every page, searching and scrolling the strip; a heap snapshot shows the PDF part is page text ≈ 1 MB,
  the rest is the app (core buffers 68 MB, catalog JSON 13 MB).
- **Tests.** Unit: `pdf-page-text`, `pdf-position`, `pdf-zoom`, `pdf-render-queue`,
  `pdf-thumbnail-budget`, `pdf-find-state` (26). e2e: `pdf-viewer.spec.ts` (open and lazy pages, text
  selection, find across lines with highlights and wrap-around, go to page, strip on desktop and phone,
  zoom/fit/Ctrl+wheel, CDP two-finger pinch, resume after reload, print path, dock vs reader chrome),
  `pdf-note-attachment.spec.ts`; the reader, native-chrome and user-library specs still pass.
  Screenshots 390/1280 × light/dark in `output/w3-screens/`.
- **Not done / not verified.** Drawing and annotation: the notes drawing editor is a modal Excalidraw
  scene, not an overlay that can sit on a page, so there is no cheap reuse; next step is a per-page ink
  layer (strokes in normalised page coordinates stored per document, eraser, undo-last-stroke — B1).
  Not run: a real phone / Android WebView (touch pinch is CDP-injected), the system print dialog (only
  the hand-off iframe is asserted, headless has no PDF plug-in), OCR-only PDFs end to end (find over
  recognised words + overlay were adapted, no e2e: needs tessdata), PDFs with embedded fonts, rotated
  pages, encrypted files, documents over ~1 000 pages (three observers per page), dark page tint.
  Opening the header menu right after a PDF ingest re-renders it as OCR/text progress events arrive
  (existing behaviour; the specs wait for the banner to go).

## Tools: age scope, «Дети / Взрослые / Все» filter, own questionnaires and calculators — 2026-10-06 (STATE TOOLS1)

- **Age scope in every schema.** `ageScope` (`packages/contracts/src/tool-age-scope.ts`: groups
  `neonates`/`children`/`adults`, optional `minAge`/`maxAge` in completed days/months/years, `basis` = the
  definition wording the declaration rests on) is required in calculator and questionnaire definitions
  and in the catalog entry; it replaced the calculator `audience` enum (the free-text `audience` of a
  questionnaire stays: who fills it in). The schema rejects missing scope and contradictions. All 69
  module tools were audited from their own wording (`content/tool-modules/*.json`, modules rebuilt as
  new versions: core-clinical preview.4, emergency preview.3, gastroenterology preview.4, neonatology
  preview.4, obstetrics-gynecology preview.5, pediatrics preview.3, pediatrics-growth 0.3.1,
  psychology preview.4; catalog digests/sizes updated, old DB files kept for older catalogs). Summary and
  the uncertain tools: `docs/ASSESSMENTS.md`. The built-in unit converter and ECG caliper declare any
  age (the ECG tool's stale «только взрослые» population text was corrected). **Publishing note:** an
  installed pre-0.6.49 tool module has no `ageScope` and fails the new definition parse until it is
  updated to the new versions. TOOLS1b: every module got a new version and file name (the table above),
  all eight artifacts now point at `raw.githubusercontent.com/.../main/apps/app/public/content/modules/`
  (four used the missing `v0.6.33` release assets; the resolver already rewrote them to raw main).
  An installed older version is not read (tools are taken only from the module version the catalog
  lists), so nothing fails to parse; the app installs the new version by itself at start
  (`localPackagedModulesToInstall`, shipped catalog only) and until then the tool shows its
  «Скачать» section state and the list «Есть обновление»
  (`apps/app/e2e/tool-module-update.spec.ts`). An app older than this release still reads the
  catalog from main and cannot parse the new definitions: gate them with `minAppVersion` at the release.
- **Filter and badge.** `features/tools/` (`tool-age-filter.ts`, `ToolAgeFilterBar`, `ToolAgeBadge`):
  the choice is `toolAgeFilter` in app preferences and applies in «Все инструменты» (favourites, tool
  row, groups; collections stay as the doctor made them), the «Калькуляторы»/«Опросники» sections and
  the search catalog, the calculator and test pages and «Мои опросники». «Скрыто по возрасту: N»
  explains short lists; the «create your own» card is never hidden. The patient default is **not**
  implemented: there is no app-wide open patient (the vault is per-tool), so a selected patient outside a tool's
  scope only gets a warning under the patient field in questionnaires (`PatientAgeNotice`).
- **Own questionnaires** (`minimed-questionnaire` v2, v1 still opens): population, sections, per-section
  or total scores, interpretation ranges, plain-Russian issues (`state/user-questionnaire-rules.ts`), pure edit
  operations (`features/assessments/user-questionnaire-edit.ts`), copy/delete/import/export/print.
  `interpretationMode: 'per-scale'` in the engine shows one range per section. Fixed on the way: typing
  lost spaces/focus (saved copy was written back), plural of «Осталось N пунктов», English «incomplete»
  tag, errors with wrong grammatical gender.
- **Own calculators («Мои калькуляторы»)**: file `minimed-calculator` v1 (`.minimed-calculator`), stored in
  `localStorage` `minimed.user-calculators.v1` (not in the user library; unreadable text is kept under
  `….corrupt`), `state/user-calculators.ts`. Numeric inputs (name used in the formula, label, unit,
  limits, integer), a formula typed as text, a result (label, unit, decimals) and result ranges (open-ended
  allowed, compared on the rounded result), population. The formula never reaches `eval`/`new Function`:
  `user-calculator/user-formula.ts` tokenises the text itself (`.`/`,` decimals, `;` between arguments,
  `×÷−`, Cyrillic names, whitelisted functions, ≤ 500 characters, nesting ≤ 30, plain-Russian errors
  with the position) and emits the restricted expression the schema engine already parses;
  `user-calculator-schema.ts` builds a validated `CalculatorSchema` (category `custom`) that is registered
  next to the downloaded ones, so the ordinary form, result panel, print, share, notes and patient
  recording work unchanged. Routes `#/calculators/mine[/new|/<id>/edit]`; editor with input and range
  cards (copy/move/delete), live preview on sample values, range tester, import/export, copy, delete. Side
  effects in generic code: a single numeric result is labelled with the step's own label (older saved
  results still read «Результат»), print puts range messages under «Интерпретация:», a source without
  an address is plain text. `searchCatalog` has the «Создать свой калькулятор» card (`createsNew`, no
  star/collection buttons, never age-filtered).
- Tests: `tool-age-scope.test.ts`, `tool-age-scope-audit.test.ts` (all tools), filter/badge/population/
  patient-age units, questionnaire model/rules/edit units, formula/model/schema/registry/edit units of the
  calculator builder (incl. a scan that no source uses `eval`/`new Function`); e2e `tools-age-filter`,
  `user-questionnaire-builder`, `user-calculators`. Not tested: Android WebView, physical device.

## Patient diary: finding it again, sync, home screen — 2026-10-05 (STATE DIARY2)

Walked the whole flow (doctor issues → patient opens, enters readings, closes the tab, reopens by the
same link / a newer link / another diary / offline / after a browser restart → returns results →
doctor imports, re-imports, imports a newer batch). Bugs found and fixed:

- **Diary lost when no entry was saved.** A link only created the diary in memory; the home-screen
  icon or a bookmark (no link in the address) then showed «пока нет дневников». The diary is now
  stored the moment its link is opened.
- **Older link rolled the header back; a changed plan broke the diary.** `store.load` replaced the
  header with whatever link was opened last. A newer link with a different plan left entries pointing
  at a missing plan item, so the next read failed validation and the diary showed as damaged.
  `diary-merge.ts` merges by `issuedAt` (newer wins, older ignored), keeps plan items that entries
  still use as `ended: true` (not offered again, still readable) and refuses a link whose fields do not
  fit the stored entries. A damaged record keeps its readable entries and the original text is set
  aside under `minimed.diary.salvage.v1.<id>`.
- **No way back from a diary to the list; no landing.** The address kept the first link forever.
  Now: no link → one diary opens at once, several → list with the last used first («Продолжить»);
  «← Мои дневники» is always there; the address is rewritten to a complete link to the open diary.
- **Offline right after the first visit did not work.** The worker cached only `./`; the hashed JS/CSS
  of the first visit were not cached, and cached modules did not match when the host sends
  `Vary: Origin`. The worker now caches the page, its assets (parsed from the HTML and CSS) and the
  manifest on install and matches with `ignoreVary`; `minimed-diary-v3`.
- **Doctor never saw patient corrections.** Import skipped any record whose id was already in the card,
  so an entry the patient edited after the first import stayed wrong. `applyDiaryImport` now replaces
  the card's record and appends «Исправлено пациентом, ранее: …» (applied once; a record in a closed
  visit is reported, not changed). Patient deletions are not propagated (the card is a record).
- **Wrong card.** Results of a diary already imported into / issued from another card are flagged
  before saving and need an explicit tick.
- **Comment and text lines of a diary record were never shown** in the card's «События» list
  (`event.text` was not rendered); it is shown now.
- **Results file.** The patient's «Сохранить файл» was FHIR, which the doctor app cannot read. The
  patient now sends a text file (or copies text) that holds the QR parts; the doctor reads it under
  «Принять данные» → «Пациент прислал файл или текст». The same file restores records on a new phone
  (`RestoreCard`: added to the diary by entry id, never replaces).

Patient UX (`apps/app/src/diary/`): large cards, plain Russian. A «Новая запись» block says how many
entries were made today, a green «Запись сохранена» confirms every save; «Передать врачу» says what
was handed over («Передано врачу (5 окт.): 2 из 3. Не передано — новых: 1»), entries carry «Не
передана врачу» / «Изменена после передачи», and the patient confirms «Врач получил» (showing codes is
not treated as proof). Sending: codes on screen, file (system share sheet where there is one), text.
A link that reopens an existing diary says so («Ваши записи на месте (3 записи)»). Add to home
screen (`InstallCard`): the browser's own prompt (`beforeinstallprompt`, captured at start-up), steps
for iPhone Safari written out, a menu hint for other Android browsers, remembered «Не сейчас» for 7
days, hidden when already installed; a messenger's built-in browser gets a «Откройте дневник в
браузере» warning (its storage is separate and cannot add an icon). Blocked storage (private window)
is explained instead of failing silently. `public/diary/manifest.webmanifest` (scope and start URL
`./`, icons from `../`), Apple meta tags.

Doctor side: the card keeps a list of issued diaries (a patient file `diary-ledger-<patientId>`,
encrypted like other card files, removed with the card): «Ссылка и QR» shows the same link again,
«Обновить» re-issues the same diary id with a new plan/instruction (plan ids are kept; same fields),
«Убрать» forgets it. Import preview counts new / corrected / already present records.

Tests: `diary-sync.test.ts`, `diary-doctor-sync.test.ts` (vitest); e2e `diary-patient`, `diary-install`,
`diary-share`, `diary-doctor` (full doctor ↔ patient round trip, two browser contexts), `diary-screens`
(set `DIARY_SCREENSHOTS=1`; images in `output/diary2-screens/`). The offline test runs only against
the built page (the service worker is off in `vite dev`).

Not verified: real iPhone Safari / Android Chrome (add-to-home-screen behaviour, whether iOS keeps the
`#i=` fragment in the saved URL and gives the icon its own empty storage, `beforeinstallprompt`
timing, the system share sheet, camera scan of the QR codes), Telegram/WhatsApp in-app browsers (only
the user-agent heuristic is tested), GitHub Pages hosting of the scope, a doctor result link that
deep-links into the app (not built: file and pasted text instead).

## Patient diary on the iOS home screen — 2026-10-06 (STATE DIARY3)

Found on the iPad mini simulator (iOS 26.5 Safari, real taps): a diary opened from the doctor's link
and added through «Поделиться» → «Ещё» → «На экран Домой» opened as an **empty «Мои дневники»**. Two
causes: a home-screen web app gets its own storage, and the saved URL was the manifest's `start_url`
(`./`), so the `#i=` invitation was lost and the diary itself did not exist in the icon.

**What iOS 26 Safari honours** (measured with scratch pages on the simulator, dialog name/URL and the
launched icon's `location.href`, `navigator.standalone`, storage counter):

- The manifest is read **once, while the page loads**. A `<link rel=manifest>` swapped to a Blob URL
  after load, or removed after load, changes nothing: the dialog still showed the original manifest's
  name and `start_url`. A manifest known at load always wins over the page address.
- With **no manifest link at load**, the dialog shows the page's current address **including the
  `#i=…` fragment**, the name comes from `apple-mobile-web-app-title`, the icon from
  `apple-touch-icon`; «Open as Web App» is on, and the launched icon is `standalone: true` with that
  exact URL (fragment intact) and empty storage of its own. A Blob manifest as the only manifest was
  ignored (name = page title, icon = letter), so a dynamic manifest is not a usable route on iOS.
- A static manifest can't carry the invitation (it is per patient), so on iOS the page has **no
  manifest at all**. `apps/app/diary/index.html` adds `<link rel=manifest>` from an inline script
  only when the browser is not iOS/iPadOS (same detection as `detectPlatform`, incl. iPadOS' Mac UA).
  Android Chrome and desktop keep the installable manifest (e2e checks both; `sw.js` precaches the
  manifest explicitly, no longer by parsing the HTML). The invitation stays in the fragment, in the
  saved address only; it is never sent to a server and never put in a query string.

**Flows.**

- Add to home screen from a diary: the address is already the full link (`syncAddress`), so the icon
  opens the patient's diary on first launch (notice: «Дневник открыт. Если вы уже делали записи в
  Safari, сюда они не попали…»). Later launches from the icon say nothing about the saved link
  («same»/«older» outcomes are silent when `navigator.standalone`).
- Entries made in Safari before adding: «Передать врачу» → «Сохранить файл» / «Скопировать текстом» in
  Safari, then in the icon «Печать, файлы и копия» → «Восстановить записи». The file/text already
  carries the invitation (`encodeDiaryResultsText` writes `[v, invitation, entries]`), so it restores
  the diary **and** its entries in one step into an empty store or into the diary the icon created from
  its start link (merge by entry id, tests in `diary-sync.test.ts` and `diary-share.spec.ts`).
- Empty «Мои дневники» (icon without a link, or a link that never reached it): card «Вставьте ссылку от
  врача» (`PasteLinkCard`) above «Восстановить записи из файла или текста». `readInvitationText`
  accepts the whole link, a message with the link inside, `#i=…`, `i=…` or the bare code, validates it
  like an opened link and merges with the same rules (newer updates, older ignored, entries kept);
  pasted saved entries (`MMD1.…`) are refused with a pointer to «Восстановить записи». With diaries
  present the same card is a collapsed «Добавить дневник по ссылке врача».
- Copy: iOS steps «Поделиться» (iPad: top toolbar; iPhone: «⋯» then «Поделиться») → «Ещё» → «На экран
  Домой» → «Добавить»; the warning now says what really happens (the icon keeps its storage apart from
  Safari, opens the same diary, entries made in Safari need the file transfer; best order: add before
  the first entry). «телефон» → «устройство» in every patient-facing line.

Tests: `diary-sync.test.ts` (restore into an empty store, merge into the icon's diary, link text
parsing), e2e `diary-install` (iPhone/iPad copy, no manifest on iOS UAs, manifest elsewhere),
`diary-paste` (new, also in `webkit-ios`), `diary-share` (Safari → icon transfer in a second context
with `navigator.standalone`).

Not verified: a real iPhone; iOS versions below 26 (older Safari also takes the manifest at load, so
the behaviour should match, but the share-sheet path differs); Android Chrome install with the
script-inserted manifest (Chrome supports a manifest link added during load, the installability e2e
reads the inserted link but cannot run Chrome's installer).

## Patient diary: a home with three visible actions — 2026-10-06 (STATE DIARY4)

Owner request: it was not always clear how to open, read, fill and send the diary, and the actions were
not visible. The coordinator's phone/iPad screenshots: the page opened with notices and a long
«Добавьте дневник на экран» card, the entry form was long, «Записи» and the list were below it, «Передать
врачу» was at the very bottom, «Печать, файлы и копия» was a collapsed card. Redesigned for an older
patient on a phone (data formats, storage, merge rules, the doctor side: unchanged).

**Structure** (`apps/app/src/diary/`, steps are screens of `DiaryView`, one level deep, the browser's
Back button returns from a step to the home — `history.pushState` with the step in the entry state,
cleaned on reload):

- *Diary home* (`DiaryHome`): title, doctor, «Что просит врач» (the doctor's instruction), then three
  whole-width buttons with an icon, a plain verb and the state in words — **«Записать показания»**
  («Сегодня записей ещё нет» / «Сегодня: 2 записи, последняя в 07:55»), **«Мои записи (N)»**
  («Последняя: вчера в 08:10») and **«Отправить врачу»** («Не отправлено: 3 записи» with a warning
  border / «Всё отправлено 5 окт.» / «Записей пока нет») — and «Ещё: печать, копия, справка». The three
  buttons are on the first 390×844 screen with the title block (e2e checks it, also with the iPhone
  install tip present). Below them: the doctor's plan, the link/update notice (dismissible «Понятно»,
  also dropped once the patient saves), the install tip, the storage note. After a save the green
  «Запись сохранена» card shows the saved entry and when. Wide screens (≥56rem): info and plan on the
  left, actions on the right.
- *Entry* (`DiaryEntryForm`, moved from `features/diary/`): its own page, large labelled fields (label
  20 px bold, input 22 px, unit beside the input, «от 50 до 300» under the label), `inputmode` numeric for
  whole-number fields (pressure, pulse, grams) and decimal otherwise (`diary-validation.ts`
  `inputModeFor`), choices and the doctor's plan as pressed-state buttons instead of dropdowns, counter
  with 56 px buttons, flags as a 56 px row. The time is «Сейчас: 6 октября, 14:32» (read at save time)
  with «Изменить время» opening the date field. «Сохранить» (or «Сохранить изменения») is a sticky bottom
  bar with safe-area padding, so it is on screen however long the form is. Problems are written next to
  the field and summarised above the button («Допустимо от 50 до 300 мм рт. ст. Проверьте, нет ли лишней
  цифры.», «Введите число цифрами, например 120.», ««Нижнее» должно быть меньше, чем «Верхнее»…»); focus
  moves to the first wrong field; `parseDiaryEntry` stays the final authority. Leaving a changed form
  asks «Выйти без сохранения?».
- *Мои записи* (`DiaryRecords`): grouped by day, newest first, «Сегодня» / «Вчера» / weekday + date, today
  highlighted; each record shows time, value, note, «Не отправлена врачу» / «Изменена после отправки»,
  and «Изменить» / «Удалить» buttons (48 px, with the record's time in the accessible name). Deleting asks
  once in place («Удалить эту запись насовсем?»). Editing returns to this list with «Запись изменена».
  A sticky bar keeps «Записать показания» and «Отправить врачу» reachable.
- *Отправить врачу* (`DiarySend`, was `ShareSheet`): three numbered steps. 1 «Что будет отправлено»
  (all records, the period, what the doctor already has and how many are new or changed since, a fold with
  the records, «ваше имя и другие данные не отправляются»), 2 «Выберите, как отправить» — «Показать врачу
  на экране» (QR codes), «Отправить файлом», «Скопировать текстом», each with one line of explanation,
  3 a sticky «Врач получил все записи?» → «Да, врач получил» / «Ещё нет» (showing codes is still not proof;
  nothing is marked until the patient says so). The result is «Готово. Всё отправлено 6 окт.» and the home
  shows it. With no records the step says so and offers «Записать показания».
- *Ещё* (`DiaryMore`): print, FHIR file («для врача в другой программе»), «Восстановить записи из файла
  или текста», the install help (same `InstallCard`, `variant="section"`: always available, no dismissal),
  «Добавить дневник по ссылке врача», «Как пользоваться дневником», «Мои дневники».
- *Мои дневники* (`DiaryList`): one big card per diary — name, doctor, last entry date, where sending
  stands, the same three buttons (each opens that step of that diary), «Удалить дневник» with an in-place
  confirmation; the last used one marked «Продолжить»; empty state keeps «Вставьте ссылку от врача»
  (DIARY3), the install tip and the restore card below. «← Мои дневники» appears on a diary's home only
  when there is more than one diary.
- *Install tip* (`InstallCard`, `variant="tip"`): after the actions, once, «Не сейчас» is remembered for a
  week (DIARY2), the iOS copy is DIARY3's with the file-transfer path renamed («Отправить врачу» →
  «Отправить файлом» / «Скопировать текстом», «Ещё» → «Восстановить записи»).

**Wording.** The patient side now says «отправить / не отправлено» everywhere (was «передать»); the
doctor side is untouched. State logic with no DOM is in `diary-home.ts` (send summary, day labels and
grouping, «сегодня в 07:55», period and what-is-sent sentences) and `diary-validation.ts` (number
messages, keyboard choice); both in `diary-home.test.ts`.

**Accessibility, checked in e2e (`diary-screens.spec.ts`, every screen at 390 and 1024 px, light and dark,
Chromium and WebKit):** every control and checkbox row ≥48 px, page text 17 px (nothing under 15 px),
text contrast ≥4.5:1 (3:1 for large text) computed from the rendered colours, no sideways scroll. The
audit found and fixed two things: the QR carousel's three buttons overflowed a 390 px screen, and the
dark-theme danger button («Да, удалить») had 3.99:1. Screen readers: step titles take focus, action
buttons are named by the verb and described by the state, fields are tied to hints and errors with
`aria-describedby`, errors are `role="alert"`. `prefers-reduced-motion` turns the transitions off.

**Also fixed.** Two links opened in quick succession (hash change while the first was still being decoded)
could leave the earlier one on the screen; the later link now wins and both are stored.

Tests: `diary-patient` (home on the first screen, state in words, the whole open → fill → save → read →
send flow, mistakes explained, leaving a half-filled form, edit and delete in «Мои записи», Back button,
«Ещё», long form with the sticky save, diary cards), `diary-share`, `diary-install`, `diary-paste`,
`diary-doctor` updated to the new flow; `diary-patient` and `diary-screens` now also run in the opt-in
`webkit-ios` project. Screenshots (`DIARY_SCREENSHOTS=1`): `output/diary4-screens/{before,after}/`.

Not verified: a real iPhone or Android phone (touch feel, virtual-keyboard behaviour with the sticky bar,
the numeric keypad on iOS/Android, the system Back gesture), VoiceOver / TalkBack, Telegram/WhatsApp
in-app browsers, the effect on patients themselves (no user test with older people).

## Search header, core status line and source-card download — 2026-10-05 (STATE UX8)

- **Header.** The search top row holds only the history button, the update notice and «?». With the
  notice visible the old row (history, notice, dice, graph, «?») was 392 px wide at 360 px. The
  random record and the relation map are now rows of the «?» menu (`Справка`), under a divider after
  the two help rows: «Случайная запись» (current section; disabled with «Откроется, когда база будет
  готова» until the core is up) and «Карта связей» (hidden for clinical analysis, catalog-only
  views and with experimental modules off, as before). The relation map is still on the knowledge-base
  document library too.
- **Core status line.** Measured in headless Chromium (full 441 MB core, local server): on a first
  run the old «Подготавливаем поиск…» note with a spinner appeared ~1.2 s in and stayed until the user
  pressed «Далее» past the greeting, although nothing ran — the download is held back for the
  onboarding. That state is now `waiting` (`coreWaitingToStart` in `use-app-session.ts`, set only while
  `requestDownload` waits for `releaseCoreStart`): no note on the search page (the field says «Поиск
  откроется после загрузки ядра»; the knowledge-base and document-wait pages still explain it). An
  ordinary open of an installed core takes ~1 s, so the note delay is 400 → 1 200 ms (no flash). The
  spinner is gone: downloading shows the pie with the real share, verifying/installing a full pie
  (no measurable share), opening/waiting/other tab/consent a still clock mark. Slow opens (≥ 10 s)
  still get the longer explanation.
- **Source card.** The «Скачать полный текст · <name> · 1.1 МБ» block below the card header of a
  clinical-recommendation pointer is a compact chip in the header's top-right corner (icon + size;
  «В очереди» / percent / «Повторить» while it works). The accessible name and tooltip keep the full
  sentence with the document title and size; the kind badge on the same line gives it room
  (`--result-group-action-reserve`). The document page's own «Скачать набор» button is unchanged.
- Tests: `search-core-status.test.ts`; `apps/app/e2e/ux8-search-header.spec.ts` (header at 360/390/1280
  px, light and dark, menu rows, first-run status, compact chip); `search.spec.ts` and
  `boot-screen.spec.ts` follow the moved buttons. Before/after screenshots: `output/ux8-screens/`.

## Settings as a list with sub-pages — 2026-10-05 (STATE SET1)

Settings follow the macOS/iOS pattern. `#/settings` is a list of inset groups of large rows (coloured
icon tile, title, status with an indicator dot, chevron); each row opens `#/settings/<id>` with the
existing cards of that area and a `NavBack` arrow (browser and Android back go to the list; the
reference-images page goes back to «Изображения и дополнительно»). From 900 px the list stays on
the left and the open page is on the right (the bare `#/settings` shows «Основные»). A filter field
on the list searches titles, descriptions and card keywords.

| Row (`id`) | Holds | Status (pure function in `settings-status.ts`) |
| --- | --- | --- |
| Основные (`general`) | app update, automatic module updates, onboarding restart, DEV source switch | «Есть обновление» / «Обновляется…» / «Актуальная версия» / «Версия x» |
| Врач и организация (`clinician`) | `ClinicianProfileSettings` | «Не заполнено» / «Заполнено 2 из 5» / «Заполнено» |
| Загрузки и разделы (`downloads`) | sections download, queue, history (`DownloadsPage` is now body-only) | running/queued/needs-attention counts, else «N раздела · 1,2 ГБ» (sections with something installed; sizes from catalog `installedBytes`), «Не скачано» |
| Функции ИИ (`ai`) | search by meaning (e5), speech recognition (ASR), ECG recognition | «Готово 2 из 3» / «Готово» / «Скачивается…» / «Есть обновление» / «Не скачано» |
| Изображения и дополнительно (`images`) | row to «Справочные изображения», packaging images module, «Предварительные материалы» | the reference images' state |
| Внешний вид (`appearance`) | theme note (follows the device), animations, sounds, vibration, separate tabs, floating windows | «Тёмная» / «Светлая» |
| Пациенты и данные (`data`) | patient storage description, where the notes backup lives (link to the notes), no new backup UI | «Пусто» / «Защищено» / «Без шифрования» |
| О приложении (`about`) | technical information, links | «v0.6.50» |

- Statuses are computed from the stores (download queue, e5 cache, ASR selection and cache, ECG
  package, reference-image cache, patient vault, `matchMedia`) in `use-settings-statuses.ts`; the
  list never starts a download, a model or a database. The release catalog (~10 MB) loads when the
  list is shown, to count sections and sizes.
- `#/settings/images/reference` («Справочные изображения») shows the contents from the verified
  manifest («9 084 иллюстрации к 5 932 статьям · 456 МБ»), six example thumbnails and the existing
  download card. Examples: downloaded images are read from the cache only (checksum re-verified,
  `ReferenceImageResolver.cachedSamples`); before the download six original files bundled in
  `public/content/reference-images-preview/` (212 KB, byte-identical to the set, `index.json` with
  article id, source URL and sha256; `bun run content:reference-images:previews`) are shown with a
  note saying so.
- The home update notice opens `#/settings/general` through a one-shot `requestSettingsPage`.
- Not done: no theme choice (the theme follows the device), no new backup/vault UI (it stays in the
  notes section), the old inline «Скачанные материалы» card of the list is gone.
- Tests: `settings-status`, `settings-pages`, `settings-routing`, `reference-image-examples`,
  `native-back` unit tests; `apps/app/e2e/settings-list.spec.ts`; existing specs that touched
  settings now go through the rows (`settings-nav.ts`).

## Android microphone access — 2026-10-05 (STATE MIC1)

- Root cause of "denied although granted" (0.6.50 and earlier): Capacitor's `BridgeWebChromeClient`
  requests `MODIFY_AUDIO_SETTINGS` together with `RECORD_AUDIO` for every WebView audio capture and
  denies the page unless both are granted; the manifest declared only `RECORD_AUDIO`, so
  `getUserMedia` failed with `NotAllowedError` even with the microphone allowed. The manifest now
  declares `MODIFY_AUDIO_SETTINGS` (normal permission, auto-granted) and `check-native-bridge`
  requires it.
- App side: the verdict comes from the failed `getUserMedia` call, never from the Permissions API.
  `features/conversations/microphone-access.ts` compares a refusal with the OS state
  (`LocalMedTranscriber.microphoneStatusAfterRefusal`, since Capacitor's `checkPermissions` reports
  `prompt` for refusals made through the WebView request) and offers «Открыть настройки приложения»
  (`LocalMedTranscriber.openAppSettings`) only when the OS refused for good; a granted OS state
  gets its own wording without the button. Applies to conversation recording, note voice
  recording and the visit recorder.
- Verified on the emulator (API debug build, `org.med.web`): granted -> recorder runs; first
  decline -> "allow in the Android prompt"; second decline (USER_FIXED) -> settings button, which
  opens the app settings. Not verified on a physical phone (HyperOS may add its own audio-record
  gate).

## КР headings, image zoom and selection (UX11c) — 2026-10-07

Owner feedback 2026-10-07, three items. Branch `worktree-agent-a6b8b452dd6b115fe` (not merged).

### КР sub-headings that were plain paragraphs

- **Cause.** The Minzdrav JSON gives only top-level sections (`obj.sections[].title`; the extractor
  already derives their depth from the number), deeper numbered headings («1.2.2.1 Заголовок») sit
  inside the section's HTML as `<p>`. The PDF extraction found headings by font size and missed the
  same ones. Both reach the reader as body paragraphs: no outline entry, no heading style.
- **Measured** (rule below, real data): published КР modules (774 documents, `data/build/official-clinical-documents-merged`):
  1 624 paragraphs start with a multi-level number, **1 184 are headings in 129 documents** (depth 2:
  565, 3: 426, 4: 174, 5: 19; most in one document: 95). Raw JSON editions (1 259): 2 570 candidates,
  **2 004 headings in 250 documents** (headings 56 085 → 58 089). The rest are list items («2.2 ФЛ …;»),
  doses, ICD codes, recommendations, TOC lines.
- **Rule** (`numbered-headings.ts` / `localmed_ingest/numbered_headings.py`, one shared case file
  `numbered-headings.cases.json`, 0 mismatches over the 4 194 real lines): ≥ 2 number components
  (1–2 digits, no leading zero), capital letter next, not ending in `;`/`,`, no dot leaders / page
  number / `____`, no second sentence, no recommendation/instruction phrasing (verbs, infinitive,
  «Для/При …» clauses), ≤ 40 words / 220 characters; question titles of patient sections allowed.
  Depth = number of components.
- **Display layer (works on published modules now).** `visibleReaderSections` (КР source types only)
  runs `promoteNumberedHeadingSections`: the heading paragraph becomes a reader section (outline
  entry, heading element with the sticky-heading stack, find unit, copyable link, section path) and
  the text after it moves in. Stored data and ids are untouched: existing sections keep id/anchor,
  a chunk without a heading is the same object, a chunk cut at a heading gives its id and anchor to
  the first piece that has text; derived ids/anchors are `<chunk id>~<n>` and `<chunk anchor>~h<n>`.
  129 documents / 1 184 sections added over 30 886; no id collisions, text preserved (checked on all
  774 modules). The wording is never changed.
- **Ingest layer (needs a module rebuild).** `clinical_json_import` reads a matching `<p>` as a
  heading block (same text and block id, `promotedFrom: numbered-paragraph`, `promotedHeadings` in the
  extraction report). Section ids are path-derived, so existing sections keep theirs, but chunks that
  move under a new sub-section get new chunk ids — same as any edition rebuild. `ExtractedSource.extractor_revision`
  (2) makes `prepare --reuse` re-extract older clinical-JSON extractions. Rebuild: the KR2 flow
  (`prepare` on the clinical JSON registry without `--reuse`, then build/compact/zstd/publish);
  NOT run or published here (done in KR3, with a further guard for headings the reader would hide). PDF-derived
  modules are not rebuilt: the display layer covers them.
- Tests: `numbered-headings.test.ts`, `numbered-heading-sections.test.ts`, `test_numbered_headings.py`,
  `test_clinical_json_numbered_headings.py`; e2e `kr-reader-structure.spec.ts` (heading + outline).

### Image preview zoom

- Cause: scroll-port zoom scaled from the content's top-left without compensating the scroll,
  the transform model scaled from the centre with an approximate pan, there was no wheel / trackpad
  or double-tap handling, and two lightboxes (user image documents, assessment images) had no zoom.
- `pinch-zoom-math.ts`: one rule — keep the content point under the cursor / pinch centroid / tapped
  point (`placeContentPoint`), clamped pan (content always covers the surface), pinch centroid
  tracking (two-finger pan), double-tap 1× ↔ 2×, wheel factors (mouse notch gentler than trackpad
  pinch, which Chromium reports as Ctrl+wheel). `use-pinch-zoom.ts` applies it in the scrollport
  model (scroll compensation, instant scroll — `html` is `scroll-behavior: smooth`) and in the
  transform model (translate + clamp), adds `wheelZoom` (`ctrl` | `always`), `doubleTapZoom`,
  `dragPan`. Image previews (`MediaViewer` for images, user image lightbox, assessment lightbox)
  use `IMAGE_ZOOM_OPTIONS`; tables keep Ctrl+wheel only so wheel and text selection still work.
  Buttons zoom around the visible centre.
- Library question: PhotoSwipe / similar were not adopted — the viewer needs scroll-port and
  in-place modes, zoom buttons and print inside the app's dialogs; a library would still need that
  glue (~45 kB) for what is ~150 lines of math here, now unit-tested. Inertia was not added.
- Tests: `pinch-zoom-math.test.ts` (22), e2e `image-zoom.spec.ts` (wheel, double click, drag-pan
  clamp, two-finger pinch + double tap via CDP). The scrollport model was checked in a DOM harness
  (wheel, double click, drag, buttons).

### Selection colour and КР highlights

- `::selection` is a green-yellow highlighter from tokens `--selection-background` / `--selection-text`
  in `global.css` (light `#bfd873` + `#292720` 9.5:1; dark `#55661f` + `#f4efd8` 5.5:1); the note
  editor and the PDF text layer use the same tokens.
- Highlights existed only for user documents (`UserDocumentHighlights`); official documents had no
  selection handling, so no popup could appear. `UserDocumentHighlights` now takes the containers it
  works in (`OFFICIAL_DOCUMENT_HIGHLIGHT_CONTAINERS` = a КР text chunk, `id` = chunk anchor), saves a
  selection across chunks as one mark per chunk, checks a stored mark against its quote before
  painting (`verifyQuote`), and `OfficialDocumentReader` mounts it for clinical recommendations.
  Same IndexedDB store, colours and removal-by-tap as user documents. Marks are anchored to the
  rendered chunk (anchor + character offsets + quote); a mark whose text moved (reading rule or a new
  edition) is hidden, not repainted over other words — re-anchoring across editions is R1.
  Only КР for now; other official documents are one prop away.
- Popup placement (`highlight-popup-placement.ts`): mouse — above the selection as before; touch
  (`pointer: coarse`) — below the selection past the drag handles (the system menu opens above it),
  docked above the bottom navigation when there is no room below.
- Tests: `highlight-popup-placement.test.ts`; e2e `kr-reader-structure.spec.ts` (highlight, cross-chunk
  marks, reload, remove, 390 px touch placement + dock); `user-reader.spec.ts` highlight test still passes.
- **Not verified:** the real Android system selection menu (positions, drag handles, whether the
  WebView's menu ever covers the popup below the selection) — emulated touch only.

Merge follow-up (2026-10-07, coordinator): the promoted headings exposed two older reader faults,
both fixed. (1) `visibleReaderSections` dropped every section without its own text, so chapters
(«1. Краткая информация», «3. Лечение», «7. …») vanished and their subsections nested under the
section before; a text-less section now stays when a deeper section under it has text. (2)
`content-visibility: auto` on nested sections let an off-screen chapter collapse to its 420px
estimate while its subsections kept stale boxes: TOC jumps into it settled on a stale box showing
another chapter, and the outline marked the wrong entry. Sections holding subsections now carry
`.document-overlay-section--container` (rendered as a whole); the scroll spy skips sections the
browser is not rendering; `reader-find-jumps.spec.ts` asserts the landed heading is rendered.

Open: the КР modules are not rebuilt with the ingest-side heading rule (owner decision); the
small-caps section path above each promoted sub-heading is shown as for any section.

## Reader chrome and navigation (UX11a) — 2026-10-07

Owner feedback on the document reader (official documents and personal Markdown/text files).

- **Name while opening.** A document opens under its own name: the crumb and the pending title come from
  `features/library/document-title-hints.ts` — the document lists and search-result group headings the
  core has already returned (remembered in `WorkerSearchMedicalCore`, by reference), a title the opener
  passes (`openDocumentOverlay(id, anchor, { title })`) or the module-catalog member title. Only a
  document nobody has named yet shows «Открываем документ».
- **Opening is not a history entry.** A module pointer that stands in for its installed document used to
  redirect with a pushed entry, so back landed on the pointer, which redirected forward again.
  `openDocumentOverlay(…, { replace: true })` now takes the pointer's entry (`history.replaceState` plus a
  synthetic `hashchange`, which `replaceState` does not raise); used by the host's pointer redirect and by
  the post-install open. Unit tests: `document-navigation.test.ts`; e2e: `reader-navigation.spec.ts`
  (history length +1, back leaves the reader). The Android system back (`window.history.back()` on a
  document route) is covered by the same history shape; it was not run on a device.
- **One crumb per document.** `state/document-identity.ts` maps a pointer id
  (`core.catalog.pointer.<kind>.<target id>-<16 hex>`, true for all 20 002 bundled pointers) to its
  target; `appendDocumentCrumb` and the header crumbs (`documentTrailBreadcrumbItems`) keep one crumb per
  document identity (pointer, summary, `.full` text and revisions of one work), the latest — the full
  variant — winning. Trails saved by older builds are deduplicated on display.
- **Position counter «12 / 48».** A reflowed document has no pages, so a *page is one entry of the contents
  list* (the sections the outline numbers «01», «02», …): the total is known before the sections render,
  equals the outline's length, and every number is reachable with the outline's own jump. Pure helpers in
  `document-reader-position.ts`; the pill (`ReaderPositionCounter`, tabular-nums) sits at the end of the
  breadcrumb column of the header and in a «Раздел» row at the top of the contents list (phone drawer and
  desktop column). A tap opens a Kobalte popover with a digits-only field and «Перейти» (a number beyond the
  ends goes to the nearest end); a second tap closes it. The jump holds the reader chrome
  (`holdReaderChrome`). Official documents and Markdown/text personal files have it; PDF (own page box),
  EPUB, sheets and medical images do not. The current number follows the scroll spy, so it moves only
  between sections that are mounted; the jump relies on the same `chrome.scrollTo` as the outline, whose
  reach into not-yet-mounted sections is tracked separately (scroll-to-section reliability).
- **«⋯» toggles.** The button sits inside Kobalte's context-menu trigger, so a press is not an outside press
  and the open menu stayed open; the click then dispatched another synthetic `contextmenu`, which only
  moved it. `requestContextMenu` closes the menu when the trigger is `data-expanded` (all «⋯»/discover
  buttons built on `AppContextMenu`).
- **Drawer above the bottom bar.** `.app-shell` is an isolated stacking context at level 0 and the bar
  (z 70) is its sibling, so no z-index inside the reader could lift the drawer above it; the earlier fix
  (3a6c64dc) only slid the bar away. While the drawer is open the shell rises to
  `--z-reader-shell-open` (75: above the bar, below dialogs and toasts), and the `reader-outline-open`
  root class outlives the drawer's slide-out so the bar does not reappear over the closing drawer.
- **Tests:** unit — `document-identity`, `document-trail`, `document-navigation`, `document-title-hints`,
  `document-reader-position`, `app-breadcrumb-items`; e2e — `reader-navigation.spec.ts` (clinical module
  from the local release copy; skips when it is absent).

## Reader find and section jumps (UX11b) — 2026-10-07

Owner feedback on the official-document reader (КР guidelines and the other `OfficialDocumentReader`
documents): find reported more matches than stepping could reach, a far TOC heading needed several
taps, and the find counter shifted the typed text.

- **Nested sections were never rendered.** The reader mounts sections in idle batches and nests them
  through a cached tree whose nodes keep their identity; a node's `children` array is replaced on every
  rebuild but the inner `<For>` read it once. Sections nested under an already-mounted section that
  arrived in a later batch never reached the DOM (63 sections in the model, 17 in the page after
  mounting finished), so find counted text that was not on screen and the TOC listed headings that did
  not exist. The list now reads the tree memo (`OfficialDocumentReader.tsx`, «children» `<For>`).
- **Jumps are one measured, self-correcting scroll.** `features/library/document-reader-scroll.ts`
  (`jumpReaderTo`) replaces the single `scrollIntoView` of TOC taps (`useDocumentReaderChrome.scrollTo`)
  and of find next / previous. Cause of the multi-tap TOC: `.document-overlay-section` carries
  `content-visibility: auto; contain-intrinsic-size: auto 420px` (`styles/user-library.css`), so every
  off-screen section is estimated at 420 px until it renders and the page height changes under a jump
  (and desktop used a smooth animation that chased the moving target). The jump scrolls instantly,
  re-measures every frame, corrects the remainder and ends after the target stood still for 4 frames
  (max 2.5 s); wheel, touch, key and pointer input cancel it. TOC jumps align the heading to its
  `scroll-margin-top` (below the sticky headings); find centres the highlighted word between the chrome
  and the bottom navigation and also reveals it sideways inside a wide table. Both hold the reader
  controls (`holdReaderChrome`) so the find bar stays on screen while stepping on a phone. The scroll
  spy's reading line is never above the sections' scroll margin (`computeReadingLine(rect, minimum)`),
  so the tapped heading is the active one in the outline.
- **Find counts only what the page shows.** `features/library/document-text-search.ts` is the single
  source of a text chunk's searchable text and of `DocumentText`'s highlight offsets; image blocks
  (whose alt text is never displayed) contribute nothing. Table cells and image captions of a chunk now
  carry the host's match class, so the active match in a table is marked (`--current`).
- **Find bar (item 12).** The counter is in the right end of the field (`SearchField` got a `trailing`
  slot) in a slot of fixed width (`.document-find__status`, `5.5em`, `tabular-nums`) so the text does not
  move; while searching the slot shows `components/AsciiSpinner.tsx` (`| / – \`, ~110 ms per frame, timed
  by `motionMs`; an ellipsis when Animations are off or `prefers-reduced-motion`).
- **Tests.** Unit: `document-reader-scroll.test.ts`, `document-text-search.test.ts`, `computeReadingLine`
  minimum in `document-reader-outline.test.ts`. e2e `reader-find-jumps.spec.ts` on «Острая ишемия
  конечностей» (63 sections, tables; needs the local module copy like `reader-loading-layout.spec.ts`):
  stepping through find matches at 390 px (first, last through unmounted sections, 36 consecutive, a
  complete short query) with the active match highlighted and between chrome and bottom navigation;
  highlighted words equal the reported count and the DOM holds every outline section; six far headings
  reached with one tap at 390 and 1280 px and active; counter inside the field at a fixed width, spinner
  cycling and standing still under reduced motion.
- **Not changed / known.** `UserDocumentReader` (personal files) still scrolls find matches with a single
  `scrollIntoView`, and in a quick check a long `.md` file showed no `.document-overlay-match--current`
  after find next (the markdown path appears to draw no `mark` elements), so find there may count
  matches it does not highlight — not investigated, separate task. The initial
  `initialAnchor` scroll of `OfficialDocumentReader` is unchanged. Not verified on phone hardware or
  with slow devices.

## Children's vaccination calendar (VAC2) — 2026-10-07

Owner request: polish the children's calendar page, make each child a patient record, and print a landscape
«для мамы — личный дневник прививок» sheet shaped like the official chart.

- **Page.** Back and «Печать» share the header row (`Page` `navigation`); the four sections are an even
  two-by-two grid on a phone (`SegmentedControl` got `stretch`); «План ребёнка» rows are compact (date, status,
  dose chips coloured by band, order conditions). Checked at 390 and 1280 px.
- **Child = patient card.** «План ребёнка» starts with «Пациент» (default) / «Только расчёт».
  - Patient: the card field of the calculators (`PatientCaseCombobox`, unlock and «Добавить пациента» inline).
    The plan is computed from the card's birth date and name. «Прикрепить план к карточке» writes a patient
    file `vaccination-plan-<patientId>` into the vault (`vaccination-attachment.ts`: zod-validated on read,
    `{kind, schemaVersion 1, calendarId, editionLine, attachedAt, updatedAt}`); it is protected with the vault,
    removed with the card and carried by the card backup. A stale edition is flagged. A card without a birth
    date gets the typed date written into it when the plan is attached (`setPatientBirthDate`, never
    overwrites a different stored date). No SQLite change, no migration.
  - Only calculate: a birth date (and an optional name for the sheet); nothing is stored.
- **Data (schema v2).** `bun run vaccination:prepare` now also declares, from the reviewed transcription,
  `national.chart.targets` (12 infections in chart order), `item.targets` (chart rows a vaccination covers:
  dtp → коклюш/дифтерия/столбняк …), `item.band` (`all` / `risk` / `catch-up`), `row.ageSpan` (category rows
  16–19: the age from which they apply, open to adulthood) and `item.product` (ИПВ/ОПВ of paragraph 12 of
  Appendix 3, with the risk-group variant). The printed wording is unchanged; the contract checks references.
  The preparer was run against the raw PDFs/OCR of the main checkout (`--dir`).
- **Chart + diary.** `vaccination-chart.ts` builds infections × ages from the data only (columns = age rows:
  24 ч, 3–7 дн., 1…20 мес., 6, 6–7, 14 лет, взрослые; no vaccine named in code). `vaccination-diary.ts` adds
  the child and the planned date of each column; `vaccination-diary-print.ts` renders one A4 landscape page
  (`@page`), green = всем, orange = группы риска, blue = ранее не привитым (with * for risk groups), V/RV
  legend, ИПВ/ОПВ legend, the title and edition cited from the data (приказ 1122н в ред. 677н, приложение № 1),
  the printed date. Printed through the shared `PrintManager`; the preview dialog is generic over the document.
- **Not in the sheet, on purpose.** The order has no columns for 7, 12 and 15–17 years or an АДС-м product
  name; the sheet follows the data (no invented columns or products). The order names no dates: the planned
  dates are calculated from the printed ages (window and ≈ marked), the sheet says so.
- **Tests.** vitest: chart (7), diary model and print (7), child (6), attachment (4), patient-domain
  `setPatientBirthDate` (3), contract (+2), Python (+3). Playwright `vaccination-plan.spec.ts` (3: card
  attach/reload/print one page A4 landscape PDF; calculate-only stores nothing; layout at 390 and 1280) and
  `vaccination-calendar.spec.ts` (updated).
- **Not verified.** A real printer and Android WebView print (the sheet uses 6–7.5 pt text and was checked
  only as Chromium PDF, 1 page, ~10 % spare height); clinical correctness (unchanged, no clinician review);
  the unlock flow on native (Keychain) devices; a diary row for patients who changed edition (only flagged).

Flu colour (owner 2026-10-07): order item 19 names «Дети с 6 месяцев» first and without a
condition, so children's influenza is «всем» (green) from 6 months to 17 years and adults stay
«группы риска». Declared in the data as `bandSpans` on the item (preparer table
`CATEGORY_BAND_SPANS`, contract `NationalItemSchema.bandSpans`); the chart, the diary sheet and the
plan read the band at the age (`itemBandAt`).

## Drug link summary, saved search results, update hint, «Лента» sources — 2026-10-07 (STATE UX10)

Owner screenshots 2026-10-07.

### Drug link card in texts

- A drug name in a text (КР, search context) opens a **short card**: substance (or trade name with
  its substance), the registry's pharmacotherapeutic group (one line; a group that only repeats the
  start of a longer one is dropped), ATC code with the NSI level-4 name, trade names (five, «и ещё
  N»), and — when an instruction module of the substance is installed — one quoted line «Действие:»
  (the instruction's «Фармакодинамика» / «Фармакологические свойства», else «Показания:»; the first
  sentences up to 240 characters, cut at a sentence or word boundary, never paraphrased), then a
  short source line «ЕСКЛП, 28.08.2026 · инструкция». «Открыть» opens the drug card. The previous
  card listed ЕСКЛП codes and a «Открыть фрагмент источника» per dosage form; both are gone.
- Why the codes showed: the link of a not-installed substance points at its core pointer, whose
  lines are «<СМНН code> — form — strength / ТН: …». The card now reads the full ЕСКЛП card behind
  a pointer when its module is installed, else the pointer's «ТН:» lines plus the lazy
  drug-comparison index (`cards`: groups, ATC; `documents`: trade names and the instructions to try)
  and the NSI ATC names — both chunks are shared with their tools and load on the first card only.
- Code: `features/library/medication-link-preview.ts` (pure model + loader, tests),
  `components/DocumentText.tsx` (`MedicationLinkSummaryBody`), CSS `.medication-link-summary*` in
  `styles/doctor-ux.css`. The inline preview card now stands above the search source overlay
  (`--z-inline-preview: 540`); before, in the search context it opened behind the overlay.

### Saved search results

- Every finished search is kept on the device (`state/search-result-cache.ts`, IndexedDB
  `minimed-search-results`, newest 40, evicted through a `savedAt` index; an in-memory layer for the
  session). Key: scope, specialty, filters and the normalised query text.
- Asking a saved query again — typed, submitted, from the history drawer or after the app restarted
  — shows its list at once (no skeleton) with a quiet line «Сохранённые результаты · 12 мин назад ·
  Повторить поиск». A **fresh** copy (same app version and content revision, younger than a day)
  is not searched again; «Повторить поиск» re-runs it and applies the result at once. A **stale**
  copy is still shown at once and the search re-runs behind it with the existing «Есть новые
  результаты» offer (UX9), so the list never changes under the reader's finger.
- The content revision (localStorage `minimed.search.content-revision.v1`) moves on every
  `notifyContentChanged()` (module install/removal, core swap) and on installing/removing the
  semantic model. Clearing the search history clears the saved results too. Query text is stored like
  the history and never logged.
- Tests: unit `search-result-cache.test.ts`, `search-refresh.test.ts` (age wording); e2e
  `search.spec.ts` «a replayed or repeated query shows its saved results at once, and can search
  again» (history replay without re-run or skeleton, «Повторить поиск», survives a reload).

### App update hint

- The «Доступно обновление» pill left the search header. An available update now shows a small
  «Обновление» pill above the «Настройки» tab (`AppBottomNav`, `.app-update-nav-hint`), which opens
  Settings → Основные and is dismissed per version as before (`state/ignored-app-updates.ts`); the dot
  on the tab stays. e2e: `search.spec.ts` (opens settings, applies nothing), `ux8-search-header.spec.ts`
  (header row has two buttons; the hint fits the viewport at 360/390/1280 px, light and dark).

### «Лента»: suggestions first, item pictures, PubMed search (ADR-0024 amended)

Owner request: adding your own feed is too prominent; show what can be added; real articles with
pictures; PubMed search. Code in `apps/app/src/features/news/`, CSS `styles/news.css`.

- **«+» instead of a banner.** The big «Добавить источник» card on the empty view is gone. Adding an
  address of one's own is a small round «+» (`aria-label` «Добавить источник», `data-testid=
  news-add-entry`) in the «Лента» header, beside refresh / PubMed search / «Источники» (all four
  header buttons are now round, 2.5 rem), and a link on «Источники». The add page itself is unchanged
  (its suggestions are now the compact rail).
- **Suggestions are the first view.** `NewsSuggestedFeeds` has two variants: `cards` (empty «Лента»
  or only websites: grouped Россия / Международные, each card = tile + title + language + description
  + topic + «С картинками» + one-tap «Подписаться») and `compact` (a one-row swipeable rail «Ещё
  источники» of the sources not yet subscribed to, under the list and on the add page). No request is
  made to show them: logos are **bundled monogram tiles** (`NewsSourceTile`: coloured tile with a
  1–4 character `mark`, HSL `hue`, topic `glyph` from an allow-list), declared per source in
  `suggested-feeds.json` (`topic`, `visual {mark, hue, glyph}`, `carriesImages`; validated by
  `isSuggestedFeed`; no logo files, no favicons, tested). The «Источники» rows reuse the tile for
  suggested sources. A «Поиск в PubMed» card sits above the suggestions on the empty view.
- **Pictures.** `NewsItem.imageUrl` was already parsed; now also Atom `<link rel="enclosure">`,
  `media:content`/`enclosure` without a declared type (image extension decides), JSON Feed
  `attachments` images (plus the existing `media:thumbnail`, `media:content`, `enclosure`, JSON
  `image`/`banner_image`, first `<img>` of the sanitized text). https only. List row: fixed 4.5 rem
  square thumbnail; article: 16:9 hero box (`aspect-ratio`, lazy, `no-referrer`); both only when the
  source's «Изображения» switch is on. From an article of a source with it off, a one-line button
  turns it on. **Default:** off, except suggested sources whose feeds were measured on 2026-10-07 to
  carry a picture on every item (`carriesImages`: Фармвестник, ДокторПитер, MedPage Today, STAT,
  Medical Xpress), which are subscribed with it on; sources added by address start off.
- **PubMed** (`#/news/pubmed`; `pubmed.ts` pure builders/validators, `pubmed-client.ts` transport +
  rate limit, `NewsPubmedPage.tsx`). User-initiated: a one-line notice «Текст запроса отправляется в
  NCBI (PubMed) — только когда вы нажимаете «Найти»» is shown before the first search; nothing is sent
  until then. `esearch` (no `sort`: `sort=date` is not an E-utilities value and is ignored, the default
  order is newest-added first; measured live) then `esummary`, `tool=minimed`, through `FeedTransport`
  (CapacitorHttp on Android), JSON validated at the boundary, one shared spacer at 400 ms
  (≤ 2.5 requests/s). Results: title, journal · date, first three authors, external link to
  `https://pubmed.ncbi.nlm.nih.gov/<pmid>/` (PubMed refuses framing; no abstract in `esummary`).
  «Подписаться на этот поиск» saves a `kind: 'pubmed'` subscription (`query`, `url` = PubMed web page
  of the search) in the same localStorage list; it refreshes with the other sources, items are dated
  by PubMed entry date, kept 365 days (feeds 30), unread window on first fetch 14 days (feeds 3), and
  counted in the tab badge. Excluded from OPML export. Query text is never logged.
- Tests: unit (`feed-parser` image extraction, `pubmed`, `pubmed-client` incl. spacer, `news-service`
  PubMed + images default, `news-storage` kind/query/badge, `suggested-feeds` data, `opml`, routes);
  e2e `news-feed.spec.ts` (18 cases; «+» entry, tiles without images and no request, images default
  for suggested, thumbnail/hero boxes, compact rail, PubMed search → save → refresh with stubbed
  eutils and spacing, empty/unreachable PubMed).
- Not verified: Android device (`CapacitorHttp` against the real feeds and NCBI, system-browser
  hand-off of the PubMed link), real feeds in the app (parser run against the 14 suggested feeds with
  `bun` on 2026-10-07 only to measure pictures; `who-news-ru` and `nejm-current` failed TLS
  verification from that shell, their pictures were checked with `curl -k`), abstracts/MeSH/NCBI key
  (ADR-0020 items 2–3, still open).

Not verified on a phone: the drug card with installed instruction modules on Android, the saved
results after a WebView kill on Android, the update hint next to the HyperOS gesture bar.

## Search fixes from the QA pass — 2026-10-07 (STATE QA2)

- The source overlay names the kind of document it shows (drug, МКБ card, reference, law,
  recommendation) instead of always «В клинических рекомендациях», and shows catalogue cards in
  reader words (no storage note, identifiers, raw addresses or empty fields).
- Short abbreviations («АГ», «ОКС», «ХСН») match tools only at the start of a word, so scales that
  merely contain the letters no longer lead the list.
- No ghost index numeral under a download chip; «Примеры поиска» at readable contrast; the app links
  (GitHub, APK, version) moved from the history drawer to the «?» help sheet.
- A drug pointer's «Указатель препарата» is cleaned (no storage note) but keeps its place: it carries
  the МНН.

## Reader and library fixes from the QA pass — 2026-10-07 (STATE QA1)

- Reader header: the breadcrumb no longer repeats the H1 title; a long last crumb ends with «…».
  Escape closes the phone outline drawer, and the bottom navigation steps out of its way.
- Library ingest: files are read one at a time (one serial queue; previews too), and a read that
  reports no progress for 60 s (scaled by size, at most 300 s) is abandoned and marked failed with a
  reason and «Повторить» in the card menu, instead of «Читаем файл…» forever (QA saw a hang and a tab
  crash with a 400-page PDF and a 5.5 MB EPUB added together).
- Books are named by their own `dc:title` (and author) once read, unless renamed; the file name stays
  visible. EPUB chapters follow the app theme (dark page and text in the dark theme). Card status wraps
  to two lines on a phone and names the file format.
- EPUB highlight popup (EPUB-POP): the continuous view scrolls the page by itself while it renders
  neighbouring chapters, which used to close or rebuild a just-opened popup (seen on a busy CPU).
  Only a scroll the reader starts (wheel, touch move, scroll keys) closes it now; otherwise it follows
  its text via the CFI range and closes when the text leaves the screen (`epub-popup-anchor.ts`).
  `user-reader.spec.ts` covers both; 12/12 at 6× CPU throttling (the old build failed there).

## Faster lexical search — 2026-10-07 (STATE PERF2)

QA 2026-10-07: some lookups took 7–13 s in the browser build (0.2–0.8 s natively). Cause: packs of
migration 010 index chunks through an external-content view, and reading `chunks_fts.document_id`
/ `chunk_id` made FTS5 materialise the whole source-view row (four joins, chunk text, JSON) for
every match. Filters now reach chunks, versions, documents and sections through the base tables by
rowid (CROSS JOIN keeps FTS as the outer loop), and a document filter of ≤64 documents is narrowed to
its chunk rowid span; older packs keep the direct columns. Same SQL in the Capacitor store.
Browser build, top-10 results identical: ОРВИ 7.1 → 0.5 s, эпилепсия 6.9 → 0.5, инсульт тромболизис
6.6 → 0.4, пневмония у детей 7.0 → 1.2, ангина у ребенка 13.4 → 1.2; `benchmark:all` output identical
apart from timings (suite 24.3 → 20.3 s). Not measured on a phone.

## Smaller APK — 2026-10-07 (STATE SIZE1)

Owner 2026-10-07: «shrink the app; bundle the core or not?». Measured on the 0.6.53 debug APK
(102 MiB): native libs 20.8, tessdata 19.6, JS 18.5, onnxruntime-web wasm 14.35, Excalidraw fonts
12.5, other wasm 3.6, dex 3.6, bundled modules 2.6 MiB.

- Done (≈13 MiB off the APK, dist −26 MiB): Excalidraw's Xiaolai CJK fonts are 312-byte glyph-less
  stubs (`excalidrawCjkFontStubs` in `vite.config.ts`) — CJK falls back to system fonts and nothing
  is fetched from esm.sh; `public/content/modules` keeps only the 11 files the preview catalog names
  (the old core-clinical build used by `tool-module-update.spec.ts` is an e2e fixture); KaTeX ships
  woff2 only (`katexWoff2Only`).
- Core: stays a download after install (76 MB gzip). Bundling it adds 76 MB to every app update
  (the app releases far more often than the core) and keeps a second copy resident; an optional
  «offline» APK beside the normal one is the way to a no-network first run if needed.
- One ONNX Runtime wasm instead of two (≈7 MiB more): the ECG worker imports `onnxruntime-web/webgpu`,
  the entry transformers.js already uses, and still runs on the `wasm` (CPU) backend; the 27 MB
  JSEP build is no longer emitted. Checked with `ecg-success-path.spec.ts` (published model, the app's
  own example photo): local segmentation and editable points as before.
- OCR language pack on demand (≈19.6 MB more): Tesseract eng + rus (tessdata 4.0.0) is no longer
  bundled. «Распознать текст» without it opens a sheet with the size and «Скачать» (nothing is fetched
  before that), progress, «Повторить» on failure, and OCR starts by itself afterwards; Settings →
  Функции ИИ has the card (Скачать / Отменить / Удалить). Files from the pinned naptha/tessdata commit
  806cd9ad (jsDelivr, then raw.githubusercontent), size + SHA-256 checked
  (`features/ocr/ocr-language-pack-catalog.ts`), stored in one IndexedDB transaction in tesseract.js's
  own cache layout (`cacheMethod: 'readOnly'`), offline from then on; a download-queue job (`ocr`).
  E2E `ocr-language-pack.spec.ts`. Not tested on an Android device. Follow-up: a project release
  mirror of the two files as the first source (needs the owner's OK to publish).
- Next, by size: on-demand wasm for ASR/e5, a lite build without the llama stack (≈7 MiB), R8 minify
  (≈2 MiB).

## «В МКБ-11» on ICD-10 cards — 2026-10-07 (STATE ICD11-MAP)

Owner 2026-10-07: specialists should see what changes in ICD-11 for a code they read (Russia still
codes in МКБ-10). WHO's own Russian ICD-11 (MMS 2026-01) is the source; no Russian ministry edition
exists (the 2024 plan was suspended), so nothing is translated by the app.

- Under the title of any card carrying ICD-10 codes (`mkbCode` / `icd10Codes`): a folded row
  «В МКБ-11: 8A6Z · Эпилепсия или эпилептические приступы, неуточнённые» (or «соответствия для N
  кодов МКБ-10» on a recommendation). Opened: per code, the targets of WHO's «одна категория» and
  «несколько категорий» tables (shown separately when they differ), postcoordination parts, the
  ICD-11 chapter, and labels derived from the rows only — одна рубрика / разделено на N рубрик /
  объединено с другими кодами МКБ-10 (reverse rows) / кластер / другая глава / таблицы ВОЗ различаются
  — plus WHO's citation and the practice note (МКБ-10 stays in force). 173 of 8 003 mapped targets
  have no Russian WHO title: the English one is shown, marked «англ., перевода ВОЗ нет».
- With the ICD-11 module installed the codes open its cards; otherwise the panel offers the module
  download (`useModuleInstaller`).
- Asset: `apps/app/src/features/icd11/icd10-icd11-map.json` (1.2 MB raw, lazy chunk), built by
  `bun run content:icd10-icd11-map` from `data/raw/icd11/2026-01` (mapping.zip + Russian tabulation,
  SHA-256 checked); logic and view rules in `icd10-icd11-map.ts`, `icd10-to-icd11-view.ts`,
  `icd10-chapters.ts` (unit tests); e2e `icd10-to-icd11.spec.ts`.
- Licence: WHO CC BY-ND 3.0 IGO for the classification; the mapping tables are shown unchanged under
  the owner's personal-use publication decision of 2026-10-06 (as the ICD-11 module).
- Not done: a dedicated МКБ-11 search section and ICD-11 code lookup in search (STATE request).

## Search and reader polish — 2026-10-07 (STATE UX9)

Owner screenshots 2026-10-06 (search «Эпилепсия», the result list, a disease card's page).
Presentation only: ranking, the core and every benchmark set are unchanged.

- **One definition preview.** Dictionary entries of one name (two term lists, a Wiktionary gloss and
  an archived name without a definition) fold into one card «**Эпилепсия** — …» above the results:
  the best-covered entry first, read from the installed dictionary (`definition-preview.ts`,
  `core.reference` status → blocks → text); without it, the definition section of a found document of
  the same name is quoted with «из «…»». «Подробнее» opens the entry, «ещё N источника/значения» the
  others, «Также в словаре» other names. Source text only, nothing reworded.
- **Nothing blocks.** A re-run of the query on screen (after an install, a core swap, a history
  replay) keeps the results usable — no dimming, no `pointer-events: none`; an identical outcome is
  applied silently, a different one waits behind a sticky «Есть новые результаты · Обновить»
  (`search-refresh.ts`). While the core opens the field takes a query (it runs once the core is
  ready), the send button is a disabled spinner, and the status is one small line at the bottom of the
  search block instead of a separate card. Readiness is `data-search-ready` on the field.
- **Plain result cards.** No second icon under the title or before the fragment, no «Карточка
  источника / Полный текст / Краткий обзор» line, no repeated section line; one section label per
  fragment. A catalogue card's technical fragments («Сведения о документе», «Сведения МКБ-10»,
  «Классификационный контекст», «Ограничение покрытия») come after its own text and read in plain
  words: «Другие названия:», no title/identifier/empty fields/storage note/copied-from address
  (`search-result-presentation.ts`, highlight ranges remapped).
- **Reader.** The same technical sections go last in small print (`isAdministrativeSection`), so a
  disease card opens on «Краткое описание». The download block is one row: «Полная версия — в наборе
  «…»» (up to two lines on a phone) and a button with the size that fills with the download's
  progress. Inline links start at their icon (a `<button>` centred wrapped text), long addresses wrap,
  and their colour is an app token (`--inline-link`, `global.css`) — the dark override used to lose to the
  lazily loaded light rule in the production bundle. The header's «Меню действий» is «⋯».
- «Сравнение препаратов» is the fourth «Полезные функции» card (with «Взаимодействие»).
- Motion tokens `--motion-*` (iOS curves, 120–260 ms, `global.css`: the theme files feed the native token generator) and the AGENTS.md «Motion» rule (owner).
- E2E: `core-identities` (one preview, «ещё 1 …»), `boot-screen`, `startup-shell`, `search`, and the
  readiness checks of 13 specs moved from «field enabled» to `data-search-ready`.

## Stable library cards — 2026-10-06 (STATE LIB-KEY)

- «Ваши документы» keeps one DOM node per card while its document is read, previewed or patched:
  documents and folders live in a Solid store reconciled by `id`, entries keep their identity
  (`features/library/user-library-entries.ts`), and `LayoutVirtualizedGrid` reuses unchanged row
  arrays (`chunkLayoutRows(…, previous)`) because virtua keys rows by reference. Keyboard focus on
  «⋯» and an open card menu survive ingest; before, every refresh rebuilt all cards (found in the
  0.6.52 release run).
- Processing state (inspection, page counts, OCR progress, processing failures) is written with
  `patchUserLibraryDocumentProcessing`, which keeps `updatedAt`: «изменён» and the time order no
  longer move a file while it is read. User edits (rename, colour, move, OCR request) still touch it.
- Inserts and new orders keep cards too (LIB-KEY2): the page uses `LayoutVirtualizedGrid
  preserveItemNodes` — fixed row slots by position, each item rendered once into a
  `display: contents` holder kept by a reference-counted `RetainedNodeCache`, a row's cell only
  hosting it — so a card pushed into the next row is moved, not rebuilt; focus that the move drops to
  the page is given back to the same element. Other grids keep the old mode (their children use the
  render index). E2E: `user-library-doc-menu.spec.ts` holds the PDF reader during ingest, and pushes
  a focused card into the next row with a new file; both check the same node stays focused.

## Discoverable item menu — 2026-10-05

- Document and folder cards in «Мои файлы» (the only list items that carry the right-click /
  long-press menu; the knowledge-base lists have none) now show a «⋯» button («Действия с документом»
  / «Действия с папкой») at the card's top-right corner (`-0.25rem`), via `AppContextMenu`
  `discoverLabel` (`.app-context-menu__discover`). It opens the same menu, anchored under the button.
  With a mouse it fades and scales in on hover of the stable card or keyboard focus (hidden, it is
  `pointer-events: none`, so it cannot feed hover flicker); on touch it is always visible but quiet
  (opacity 0.7, 1.5 rem with a larger tap area) next to the unchanged long-press. Cards themselves
  are not tab stops; the button is. E2E: `user-library-doc-menu.spec.ts`.

## Official forms — 070/у — 2026-10-05 (STATE F1)

- «Формы» (notes → forms, «Мои файлы» → «Формы», patient card → «Заполнить форму»): the first form is
  070/у «Справка для получения путёвки на санаторно-курортное лечение» of Минздрав order № 274н of
  13.05.2025 (Минюст 82433, in force 01.09.2025–01.09.2031). Plan, done list, next steps and open
  questions: [FORMS_PLAN.md](FORMS_PLAN.md).
- Source: `publication.pravo.gov.ru` eoNumber `0001202505300033`, SHA-256 `e385d12a…58a5dd3c`; the PDF is a
  scan, so the text is OCR (macOS Vision) with logged, reviewed corrections. The schema JSON
  (`apps/app/src/features/forms/schemas/ru-minzdrav-274n-070u.json`: 52 fields, 16 cited paragraphs, 89
  region codes, print layout) is generated by `tools/ingest` `localmed_ingest.medical_forms` and parsed
  by `FormSchemaSchema` (`packages/contracts`) at load; prefill bindings are declared in it.
- Trust boundaries: patient full name, address, СНИЛС, ОМС policy, workplace and the episode diagnosis
  live only in the patient vault snapshot (ADR 0015/0016); «Врач и организация» is device-local
  (`localStorage` `minimed.clinician-profile.v1`, no patient data); typed form values are in memory
  only and dropped when the vault locks; nothing is logged or sent. The print is a paper sheet for
  signature and stamp — no electronic document is issued.
- Not verified: print on a physical printer and in the Android shell (`printHtmlInNativeShell` is the
  existing path); ICD-10 codes are format-checked, not looked up in the МКБ module; the OCR-derived
  code lists were compared with the scan by eye only.

## Official forms — layout-fidelity check and thirteen forms — 2026-10-05/06 (STATE F3)

- **«Формы» now lists thirteen forms** (order of the list: the most used first): 070/у, 057/у «Направление для
  оказания медицинской помощи» (519н, from the general rule 27.10.2025), 088/у «Направление на
  медико-социальную экспертизу» (joint 488н/551н, 13 sheets, 216 fields), 107-1/у, 148-1/у-88, 148-1/у-04(л)
  (рецептурные бланки, 1094н), 003-В/у (1092н) and 071/у (395н) — **drafts**, the organisation prints its own
  (protected) stock —, 072/у, 076/у, 079/у, 025-1/у (274н) and 058/у (740н) which is **in force only from
  01.03.2027** and is shown as «Вступает в силу с 01.03.2027» (`validityLine`, from `source.effectiveFrom`).
  Orders, eoNumbers, in-force dates and field statistics: [FORMS_PLAN.md](FORMS_PLAN.md) «Done — F3». All
  sit in the registry `tools/ingest/medical-form-sources.json`, so `bun run forms:check-updates` watches
  them (seven source orders, run clean on 2026-10-05); the regional-order noise of its «possible
  replacement» search was removed (only the federal Минздрав counts).
- **Layout fidelity is measured**, `bun run forms:overlay`: the empty print of each form (Chromium PDF of
  the print HTML, at the declared paper size) is aligned with the official scan page (words by OCR boxes,
  ruled strokes by raster, sheets, paper size, whether Chromium shrank the page), images in
  `output/f3-screens/<form>/`; `bun run forms:calibrate` fits margins, font, line height and the space
  above each row from the scan into `tools/ingest/medical-form-calibration/*.json`, merged by the preparer.
  Figures of the last run are committed (`tools/ingest/medical-form-overlay-results.json`, tested): nine of
  thirteen forms are inside every tolerance (median vertical offset 0.1–0.5 mm, p90 ≤ 1.4 mm); 088/у
  (p90 4.1 mm), 025-1/у (rule recall 0.71), 071/у and 003-В/у (scan layout) carry written reasons —
  details and the before/after table in FORMS_PLAN.md. A form's print is now one layout row per printed
  line; text-only rows flow like paragraphs; blanks keep their length and share the rest of a line.
- Code: contract additions (optional; `rule`, whole-year date part, option `separators`/`range`/`joined`,
  `stretch` rows, `spaceBeforeMm`/`minHeightMm`, page `lineHeight`, `insetMm`, running-text table cells,
  `charCells`, …), prefill `format: initials`, a checkbox ticked by a mapped value, the order/validity line
  (`form-source-line.ts`), blueprints discovered by file name, registry-driven `forms:prepare`, rules from
  several appendices of one order, joint orders (issuer), a form whose order has no filling rules.
- Tests: python 1 210 (overlay metrics, calibration, per-form schema/rebuild, registry, results), vitest
  forms/contracts, Playwright `official-forms.spec.ts` (070/у, the F2 four, 057/у with prefill and
  underlined answers, the seven new forms prefilled with the printed sheet count of the official blank).
- Not verified: print on a physical printer and the Android shell; Latin/Cyrillic letters inside the scans;
  the stitched measurement of 003-В/у (an agent's scratch script, not in the repository); the filled
  print of a very long entry (it flows to another sheet).

## Official forms — the rest of order 274н, update check — 2026-10-05 (STATE F2)

- «Формы» now lists five forms of Минздрав order № 274н of 13.05.2025: 070/у, 072/у «Санаторно-курортная
  карта», 076/у «…для детей», 079/у «Медицинская справка о состоянии здоровья ребенка, направляемого в
  организацию отдыха детей и их оздоровления» and 025-1/у «Талон пациента, получающего медицинскую помощь
  в амбулаторных условиях» (landscape, both sides, with the prescription and visit-date tables). Same
  official file (eoNumber `0001202505300033`), same preparer and review method; schemas
  `apps/app/src/features/forms/schemas/ru-minzdrav-274n-{070u,072u,076u,079u,025-1u}.json`
  (`bun run forms:prepare` builds all). 025/у (the full outpatient card) is not built, on purpose; reasons
  in [FORMS_PLAN.md](FORMS_PLAN.md).
- Prefill: the existing patient, ОМС, address, diagnosis and clinician bindings, `patient.workplace` where
  a printed line needs it (025-1/у line 14), a new `patient.citizenship` (patient vault profile + editor)
  and a `words` binding that takes surname, name and patronymic of the talon from the full name.
  Schema contract extensions are generic (page break, framed block, ruled lines, table, underline
  marks); the UI still knows no form number. Two-sided blanks print the reverse side on a new sheet.
- Every cited page was reviewed against the scan (four independent reviewers plus a zoomed pass over the
  rotated talon); corrections are logged in each schema. Not verified: hyphen vs en dash in running
  text, print on a physical printer, the Android shell.
- `bun run forms:check-updates` (local; `--rebuild`, `--metadata-only`): compares the registry
  `tools/ingest/medical-form-sources.json` with publication.pravo.gov.ru (file SHA-256, size, pages;
  amending/repealing orders; possible replacement sets), writes `data/build/forms-update-check.json`,
  reports network failures, and on `--rebuild` re-runs OCR and the blueprints and asks for a human review
  when anything no longer matches. A step before releases (docs/RELEASES.md). A shortlist of other common
  forms with their verified orders («Candidates for the owner») is in FORMS_PLAN.md; none is built.

## Vaccination calendar of order 1122н — 2026-10-05 (STATE VAX1)

Owner request: «For 1122н — add a whole grid, printable.» The summary card of 1122н in the regulatory
pack stays a pointer; the calendars themselves are now a tool, **«Календарь прививок»**
(`#/notes/vaccination`, `apps/app/src/features/vaccination/`, CSS `styles/vaccination.css`).

- **Source and edition.** Order № 1122н of 06.12.2021 in the edition of № 677н of 12.12.2023 (in force from
  01.09.2024, valid until 01.09.2030): official scans from publication.pravo.gov.ru (eoNumbers
  `0001202112200070`, 15 pages, and `0001202401300021`, 2 pages), edition line «по приказу № 1122н в ред.
  приказа № 677н». The portal was asked on 2026-10-05 for amending orders; 677н is the only one found.
  Full record (hashes, method, rows to check): [research/vax1-transcription-2026-10-05.md](research/vax1-transcription-2026-10-05.md).
- **Data.** `apps/app/src/features/vaccination/data/ru-minzdrav-1122n.json`, generated by
  `bun run vaccination:prepare` (`tools/ingest/src/localmed_ingest/vaccination_calendar.py`, reviewed
  transcription `vaccination_calendar_1122n.py`; contract `packages/contracts/src/vaccination-calendar.ts`).
  Appendix 1: 19 rows (15 by age, 29 vaccinations; 4 by category), Appendix 2: 24 rows, Appendix 3: 15
  paragraphs with 3 footnotes. The scans have no text layer and tables do not survive OCR as cells, so the
  cells were read from the scan and every word is checked against the OCR of the cited pages (100 % but two
  words, both read from the scan). Each row cites its PDF page; the screen link «Проверить по источнику»
  opens the official PDF at that page. Row 24 of Appendix 2 is the 677н text, the original is kept as the
  previous edition. Raw PDFs and OCR stay in git-ignored `data/raw/vaccination-calendar/`.
  `bun run vaccination:check-updates` asks the portal for new orders.
- **Screen.** Sections «Национальный», «План ребёнка», «Эпидемические показания», «Порядок». Wide screens:
  real tables with sticky headers (the three printed columns plus a source column); phones: one card per
  row with the vaccinations in an expandable body, «Развернуть все строки». Filters: «Все / Дети /
  Взрослые» (declared per row), an age (keeps its row and every category row), a search over Appendix 2,
  reset. «Сводка по возрасту» regroups the 29 vaccinations by infection (V1, RV1 …; marked as compiled,
  not the text of the order). The screen says that a clinician has not checked the transcription.
- **Print.** «Печать» opens a preview and prints the whole document on A4 landscape through the shared
  `PrintManager`: the three appendices as in the order (columns, footnotes, PDF page per row), the compiled
  summary, the edition line repeated in every table head, the source links and the «not checked by a
  clinician» line. Checked with Chromium's PDF output (`emulateMedia('print')`).
- **Plan from a birth date** (small slice): dates for the age rows computed from the printed ages, with the
  conventions stated on screen (day of life 1 = day of birth, 4,5 months = 4 months and 15 days, window
  6–7 лет), the related paragraphs of Appendix 3 beside each vaccination; no stored birth date, none in the
  address, no knowledge of vaccinations already given.
- **Reachable from** «Все инструменты» (Справочное) and the search catalog (listed with the calculators,
  population children and adults), and by the route above. Hooks in other agents' files: one entry each in
  `SearchHome.tsx` and `searchCatalog.ts` reading `vaccination/vaccination-tool.ts`.
- **Tests.** Python 16 (`test_vaccination_calendar.py`), contracts 5, app 32 plus the route test, Playwright
  `apps/app/e2e/vaccination-calendar.spec.ts` (6: desktop table with sticky header, filters, grid, epidemic
  table; phone cards; plan; print preview and PDF pagination; «Все инструменты»; search). The tools-list
  test `experimental-reference.spec.ts` now expects «Справочное» to stay with the calendar when
  experimental modules are off (not re-run to the end here: it waits for the real core).
  Screenshots (390, 1280, print pages) in `output/vax1-screens/`.
- **Not verified.** Clinical correctness (no clinician has checked the transcription); amending orders that
  the portal title search cannot find; print on a physical printer and in the Android shell; the PDF page
  anchor (`#page=N`) in every browser or PDF viewer.

## Search loading skeleton — 2026-10-05 (STATE UX6)

- The skeleton (`SearchResultsSkeleton.tsx`, `search-results-skeleton.css`) is drawn with the real result
  group's own classes (`result-group`, header, tags row, excerpt card) and the result grid's column rule,
  so a placeholder card has the card's border, header and spacing; bars replace text, a soft highlight
  sweeps over each card (transform only, off under `prefers-reduced-motion`).
- It lives in the results slot (`.search-results-slot`), one grid cell shared with the results, and is
  shown from the first keystroke of a query (through the 500 ms debounce too) or the submit: it fades out
  in place (`createLingeringFlag`, `motionMs(180)`) while the results fade in; opacity only.
- It does not move: the home intro folds away as a fading overlay (`.search-heading--hidden` is out of
  flow, so the slot is already at its final top), and in «Клинический разбор» a placeholder analysis row
  holds the real row's place. A catalog block above the slot (tools matching the query) is real content and
  can still push it. Checked by `apps/app/e2e/search-skeleton.spec.ts` (skeleton top vs results top within
  2 px, lookup and clinical, 390/1280 px, typing and Enter).

## Download by sections — 2026-10-05 (STATE SEC1)

- «Скачать по специальности»: the tour (new step 4 of 10) and Settings → Загрузки show one shared list
  (`apps/app/src/features/sections/SectionDownloads.tsx`). A section is a clinical collection of the
  catalog (20 sections, 774 single-КР modules; titles from `catalog.categories`, a small glyph table
  for the icons). Each row reads «35 клинических рекомендаций · препараты: 3 группы · 210 МБ» (Russian
  plural forms), expands to the recommendations, the drug groups with the number of substances the
  recommendations name, and a «Формы — скоро» line without a count (forms are task F1). Several sections
  can be ticked; a drug group can be switched off per section; the total counts a shared drug group
  once and an installed package never (partial sections read «ещё N МБ», finished ones «скачано»).
- **Drug groups are derived, not listed.** `bun run content:sections:manifest`
  (`scripts/build-section-manifest.ts`, pure part in `section-manifest-source.ts`) reads the 753
  `data/build/clinical-medication-relations/<КР id>.json` files and the catalog: each recommendation's
  ЕСКЛП МНН ids are looked up in the `documentTable` rows of the ЕСКЛП modules (an ATC level-1 group
  each), and the group's ГРЛС instruction module is the one of the same group. The result is
  `section-manifest.json` (21 kB, provenance: catalog version + SHA-256, relations count + digest;
  `--check` verifies it). Every МНН named in the relations matched a ЕСКЛП module. Allmed
  (`minimed.medications.ru`) is not part of any section: it has no per-drug membership in the catalog;
  «Скачать препараты целиком» still covers it.
- Downloads go through `useModuleInstaller` (shared with `useDrugDownload`, which now sits on top of
  it): the module runtime, so tasks appear in the shared queue; the full-set drug button is unchanged.
- Sizes of the sections today: 85 МБ (офтальмология) … 350 МБ (гематология и онкология), mostly ГРЛС
  instructions; all drug packages together are ~350 МБ. Not measured on a phone; the real download could not be
  completed in the dev browser (the dev server's release proxy answered 502), so the queue path was
  checked up to the retrying task. Unit tests: `features/sections/*.test.ts`; e2e:
  `section-downloads.spec.ts` and the updated `onboarding.spec.ts` (10 steps).

## Semantic search over clinical recommendations — 2026-10-05 (STATE E2)

- Optional on-device e5-small (`Xenova/multilingual-e5-small` q8, 129 MB, pinned revision and
  SHA-256 per file) from Settings → «Поиск по смыслу»; queries are embedded in a worker from
  IndexedDB only. Without it every search is lexical, as before.
- The 774 single-КР modules carry e5 passage vectors (profile `localmed.e5-small.384.int8.v1`)
  instead of the feature-hash scaffold: mirror tag `clinical-e5-2026.10.05`, 688 MB in total
  (+31 MB). Installed modules show as updates (version suffix `.e5`).
- «Клинический разбор» and «Рекомендации» search in `auto` mode (hybrid when the model and e5
  packs are present); drugs, law, conditions and «Все» stay lexical.
- Q1 held-out test, КР only: R@5 0.123 → 0.497, R@1 0.067 → 0.294
  ([SEMANTIC_RETRIEVAL.md](SEMANTIC_RETRIEVAL.md)). Two-phase vector scan: 150–250 ms for all 774
  packs on the host. Not yet measured on a phone; ESKLP, МКБ and core packs have no e5 vectors.
- Code map of the whole search path: [SEARCH_ARCHITECTURE.md](SEARCH_ARCHITECTURE.md).

## Search: name variants and МКБ → КР bridge — 2026-10-06 (STATE S3)

Roadmap items 3 and 4 ([SEARCH_ROADMAP.md](SEARCH_ROADMAP.md), code map in
[SEARCH_ARCHITECTURE.md](SEARCH_ARCHITECTURE.md)); both on by default in `createMedicalCore`
(`nameVariants`, `icdBridge`), measured off/on with `S3_OFF=1`.

- **Names on the wrong layout or in Latin letters.** «vtnajhvby», «ьуеащкьшт», «nurofen», «Nurofen»
  find the drug; a lookup whose first groups name nothing typed is retried (layout swap, Latin →
  Russian reading, drug `nameLat`) and the page says «Показаны результаты по: «метформин»»
  (`queryRewrite`). `tools/benchmarks/name-variant-queries.json` (720 generated variants of real
  МНН, Allmed trade names, disease and КР titles + 166 controls): hit@1 0.063 → 0.947, hit@5 0.094 →
  0.956; controls: 3 of 166 rewritten («vitamin D», «Parkinson», «APGAR» — none had a title match as
  typed), the rest identical. Cost: only on a weak lookup with a plausible rewrite, +50 ms p50 / ~1 s
  p95 over the 720 cases (nearly all of which are such misses). Not covered: the clinical analysis.
- **МКБ → КР bridge.** Cards and disease articles carry `icd10Codes`; recommendation pointers list
  theirs. Q1 test (lexical, `run-icd-bridge.ts`): КР R@5 0.264 → 0.325 with core only (RuCCoD 0.417
  → 0.536), 0.190 → 0.282 with core + mkb.db (0.298 → 0.476), 0.190 → 0.294 with 723 КР modules
  (0.274 → 0.476); e5 hybrid 0.423 → 0.423; complaints unchanged. Latency unchanged (p50 311 → 309 ms).
- **Gates, off → on:** `benchmark:real:release` lookup R@1 0.803 / R@5 0.934, demo 0.526 / 0.632
  — identical; `benchmark:all` identical; `benchmark:doctor-lookup` R@5 0.9 → 1.0; owner queries
  hit@1 0.167 → 0.278, hit@5 0.444 → 0.574; 100 Allmed trade names top-1 100/100 both; `reverse-term`
  hit@5 23/35 both. Not measured (packs not on disk): the ГРЛС name and indication sets of E3,
  e5 on «Болезни», phone latency, the «Рекомендации» scope with e5 and 723 modules.
- Storage: `listSearchDocuments`/`listNavigationDocuments` (SQLite and Capacitor) now project
  `icd10Codes`, `mkbCode`, `nameLat`. Tests: `name-variants.test.ts`, `icd-bridge.test.ts`,
  `packages/core/tests/name-variants-and-icd-bridge.test.ts`, `apps/app/e2e/search-name-variants.spec.ts`.
  The e2e skeleton spec `search-skeleton.spec.ts` (lookup, 390px) was flaky while other work was in
  the tree; it does not involve a rewrite.

## Discovery core 0.6.47 — 2026-10-02 (STATE CORE2)

Published as `core-0.6.47` (prerelease; `core-0.6.45` stays published for rollback). Rebuilt with
`CORE_BUILD_VERSION=0.6.47 CORE_BUILT_AT=2026-10-02T00:00:00Z bun run content:core:build -- --stage=finalize`.

- **Pilot gone from the build.** The stages `public-pilot-build`, `public-pilot-clean-build`,
  `finalize-clean`, `pilot-removal-diff` and the retargeting report are removed; `finalize` composes
  reference + clinical + medication pointers and two alias-only inputs. The 15 pilot documents
  (`kr.rf.*.{uti,…}`, `drug.rf.*`) and their 8 `medication_profiles` are not in the core. The 45
  colloquial aliases moved to `content/colloquial-aliases.yaml` (`alias.pilot.*` → `alias.colloquial.*`;
  `build_alias_pack.py`, the renamed vocabulary builder). `content/pilot-rf` is now only the fixture of the
  historical registry migrations 007/008/012 (`tools/ingest/tests/fixtures/pilot-rf`); the
  `content:lint:pilot`/`content:build:pilot` scripts are gone. The medication alias projection is empty
  (the 1 643 source names are already in the pinned pointers, byte-identical to `medication-source-aliases.db`
  of 0.6.45), so that pack is built with `--allow-empty`.
- **Clinical track = every current edition + the replaced ones.** `medbase-clinical-catalog build
  --previous-source` takes the 2026-10-02 catalog (763 current) and keeps the 11 editions that left it
  (115_2, 25_2, 507_3, 535_2, 758_1, 759_1, 760_1, 761_1, 762_1, 771_1, 937_1) as pointers with
  `status: superseded` and `supersededByDocumentId` (the registry gives no link; the successor is the highest
  current edition of the same code, and a replaced edition without one fails the build). The successor
  lists `supersedesDocumentIds`; both bodies and aliases carry the other edition's code, so a search for
  «507_3» finds both cards. Pointer ids are unchanged for the 744 earlier records (their keywords, aliases,
  definitions, ICD, modules and medication links are identical to 0.6.45); 30 pointers are new
  (`kr.rf.1062_1`…`1080_1`, `311_2`, and the 11 new editions). The databases of the 30 editions are decoded
  from their published zstd modules (decoded checksums verified) because enrichment reads them; they come
  from the current importer, so most have no «Ключевые слова» list (keywords 0 for 27 of 30).
- **Result** (against 0.6.45): 20 002 documents (19 987 − 15 + 30), 57 264 sections, 57 276 chunks, 62 960 aliases
  (62 615 − 45 + 45 + 345); SQLite 441 597 952 B (+0.65 MB, +0.15 %), `core.db.gz` 76 268 794 B (+56 KB, +0.07 %),
  16 KiB pages, integrity ok, no FK violations, identity index unchanged (31 599 names / 31 508 targets). Diff
  against 0.6.45: exactly the 15 pilot ids removed, 30 added, the 11 replaced pointers changed, nothing else.
- **Benchmarks** (candidate = released bytes; baseline file re-measured and committed separately): CI
  `benchmark:all` (core only) lookup R@1 0.131 → 0.180, R@5 0.246 → 0.279, MRR 0.175 → 0.214, demo unchanged;
  release `benchmark:real:release` (all packs + 7 modules) lookup R@1 0.705 → 0.803, R@5 0.918 → 0.934, MRR
  0.788 → 0.855, Top-1 rate 0 → 1 (the ceftriaxone/amoxicillin/paracetamol/oseltamivir lookups no longer rank
  the pilot card above the ЕСКЛП/Allmed record); demo R@1 0.526 unchanged, R@5 **0.684 → 0.632** (one query of 19,
  `demo.30` «учащенное мочеиспускание боль в пояснице», expected `kr.rf.281_3`: it was answered by the pilot's
  retelling text, which the title-only pointer cannot replace) — more than the 0.02 tolerance, accepted as
  the cost of retiring the pilot and recorded in the new baseline; cases unchanged. No colloquial alias was
  added to win it back: that needs a clinician-reviewed symptom → disease mapping.
- **Published:** GitHub release `core-0.6.47` with `core.db.gz` (browser bundle and Android download),
  `MiniMed-0.6.47-core.db` (raw, for older builds), `core-report.json` (`distributions.android` with the gzip
  checksums) and `core.manifest.json`; `content/bundled/core.db.gz`, `apps/app/public/content/core-report.json`
  and `ANDROID_CORE_DOWNLOAD` point at it. `scripts/write-core-report.mjs` writes the report (self-tested: it
  reproduces the 0.6.45 report byte for byte apart from the dropped migration-012 checksum). The catalog's core
  entry (`minimed.core.ru` 1.0.0-preview.8) is independent of the build version and unchanged.
- **Verified:** `bun run test:unit` (312 files, 7 355 tests), `pytest tools/ingest` (895), `python:check`,
  `typecheck`, `benchmark:all`, `benchmark:real:release`; in a Chromium build (headless, fresh profile) the
  new core installs from `/content/core.db` and its checksum passes, a search for «Панариций у детей»
  returns the new pointer first, its page offers «Скачать набор» (139 КБ), the real mirror download installs
  and opens the full text; «507_3» returns the 507_4 pointer (528 КБ module) above the 507_3 one (453 КБ,
  still installable), and their pointer pages show «Редакция заменена: актуальная редакция 507_4» /
  «Заменяет редакции: 507_3».
- **Not verified:** the Android download of the new gzip on a device/emulator (the installer is unchanged; the
  URL and checksums are the published ones), the iOS/native Kotlin port (its `RELEASE_CORE` constant still names
  0.6.45; the port is frozen), a physician review of any text. UI follow-up: the pointer page does not yet read
  `supersededByDocumentId`/`supersedesDocumentIds` or the `superseded` status. Done since: a result list keeps
  one edition of a КР — when a newer edition of the same chain is among the results, the older pointer is left
  out (`withoutOlderEditions`, edition list loaded lazily after the search page); `build-core-slice.ts`
  regenerates again (modules from `data/build/release-clinical`, the retired pilot summary carried over from
  the committed slice under its original core.db checksum).

## Retrieval benchmark from external datasets — 2026-10-02 (STATE Q1)

Research note: [research/query-datasets-2026-10.md](research/query-datasets-2026-10.md). The owner has no
query log, so benchmark queries come from open Russian datasets (nothing machine-translated):
RuMedPrimeData complaints (CC BY 3.0) and RuCCoD diagnosis phrases (CC BY 4.0) with ICD-10 codes, plus
forum questions that name one medication (licence unknown: kept under `data/build/`, never committed).
Relevance is derived over the full databases (753 КР modules with registry ICD codes, 9 549 МКБ cards,
ЕСКЛП МНН/Allmed documents): grade 3 = same/ancestor/descendant code (or the named МНН), grade 1 = same
3-character block.

- `tools/benchmarks/retrieval-icd-queries.json` (400 rows, dev/test 200/200, attribution and checksums inside),
  `retrieval-benchmark.ts` (loader, ICD matching, R@k/MRR/nDCG, vitest), `build-retrieval-benchmark.ts`
  (`--fetch` downloads ≈25 MB into `data/raw/query-datasets`), `run-retrieval-benchmark.ts`
  (`--path=app|core --split=dev|test|all`; the test split is for reporting, not tuning).
- Lexical baseline over core + all packs + 753 КР modules (app path): R@5 0.282 overall (dev 0.272, test
  0.292); complaints 0.05, diagnosis phrases 0.22, drug names 0.87. Not gated: a run takes ≈1 h (≈6 s per
  query with 753 modules mounted). Use it for E1 (embeddings) instead of the synthetic pediatric set.

## Pilot corpus retired — 2026-10-02

Owner decision: the 15-card «pilot» corpus gives way to the full databases
([research/pilot-corpus-retired-2026-10-02.md](research/pilot-corpus-retired-2026-10-02.md)).

- The lookup query sets were renamed (`clinical-guideline-queries.json`,
  `medication-lookup-queries.json`, `doctor-workflow-queries.json`) and re-targeted at full-corpus ids
  (`kr.rf.<id>`, `esklp.mnn.*`, `drug.allmed.*`); no expectation names a pilot card. `run-real-corpus.ts`
  reports `lookup.*` instead of `pilot.*` (section recall is gone) and, for the release run, mounts the
  released module of each targeted recommendation. The baseline was re-measured in its own commit
  (app path, all packs: lookup R@1 0.705, R@5 0.918; CI `core.db`-only R@5 0.246, low by construction
  because pointers carry titles only); tolerance 0.02 is unchanged.
- A pilot-free core candidate (`core.0.7.0-test7.no-pilot.db`) passes the retargeted lookup gate
  (R@5 0.918, Top-1 rate 1): the earlier «no-pilot rebuild failed the clinical gate» came from
  fixtures that expected pilot ids. The pilot left the core build with core 0.6.47 (see above); the 45
  `alias.pilot.*` rows became `alias.colloquial.*`.
- Removed: `benchmark:pilot`/`run-pilot.ts`, the pilot sync/auto-rebuild workflow and scripts, the
  drug-pilot and knowledge-pilot workflows, the pilot docs, the corrupt hard-1500 fixture and its
  loader. Renamed: `Public Russian pilot Android release` → `Android release` (versioned APK asset
  `MiniMed-<v>-android-debug.apk`; `android-latest/MiniMed-android.apk`, Pages and tags unchanged),
  `Validate Russian regulatory pilot` → `…regulatory pack`.
- Still named «pilot» on purpose: the fixture copy of `content/pilot-rf` for the historical migrations, the shipped regulatory/reference/definition pack identifiers and the local
  `private-pilot`/`medications-pilot` data paths (renaming breaks installed modules or running
  pipelines); full list in the research note.

## App fixes after the КР refresh — 2026-10-02 (STATE FIX1)

- **Long titles install.** The download queue rejected any title over 180 characters, so 8 recommendations (759_1,
  759_2, 129_3, 766_1, 817_1, 888_1, 32_2, 795_1) could not be installed. The title is a display label only: it is
  now clipped to 180 characters with «…» (`downloadDisplayTitle`), while id, kind, resume and empty/control-character
  titles are validated exactly as before. Tested with the real titles from `catalog.preview.json`.
- **«DB has been closed» right after an install.** Installing a module builds a new core and closes the old one, but
  the state (`ready`) still pointed at the old core until its close had finished, and readers keep the core they were
  given. The session now wraps every core in `RetirableMedicalCore`: the old core forwards new calls to its successor,
  closes only after its running calls have settled (20 s cap, logged) and `ready`/`searchCore` are switched before the
  close starts (`swapMedicalCore` → `onSwapped(next)`). OPFS pools keep their single worker owner. The end-to-end run
  installs 129_3 (303-character title) and opens it the moment it is installed: no error; the open itself waits ~10 s
  for the new core (not a failure; a faster reconnect is a separate improvement). Done since (claude-ui, PERF1):
  «Скачать набор» → open text measured 5.9 s → 0.9 s on the КР 1006_1 pointer (built app, desktop Chromium, two runs).
  The time went to (a) a quadratic catalog lookup — every pointer of the 20 000-document home catalog scanned whole
  module document lists (`moduleContainsTarget`; 600–790 ms per home recompute, three recomputes per install), now a
  per-module index; (b) the rebuilt core re-reading whole-pack listings of the unchanged core pack (identities and
  aliases for validation, the navigation list: ~2.1 s of worker time with the opened document queued behind them),
  now read once per OPFS pool owner, which the rebuilt core leases (`WorkerOpfsMedicalStore.listing`; a seeded
  initialize drops them); (c) the pointer page waiting for the new core's full document list before reading the
  target — reading the target with text is the proof now, the list loads afterwards; (d) `core-report.json` fetched
  again on every reconnect, now once per page. The first document opened after start-up also waits less (2.1 →
  1.2 s): the home catalog no longer blocks the main thread. Small modules are still re-read from IndexedDB on every
  reconnect (linear in installed modules; not measured with many КР installed).
- **Replaced КР editions.** `catalog.clinical-editions.json` is the source (`features/modules/clinical-editions.ts`).
  Lists, category counters, search and «Скачать раздел» hide a replaced edition unless it is installed (the catalog
  still contains it); an installed one carries the badge «прежняя редакция» and a link «Текущая редакция от …».
- **Edition notice in the reader.** One line under the title: «Это новая редакция от {дата}. Открыть старую
  редакцию от {дата}» / «Это старая редакция от {дата}. Открыть новую редакцию от {дата}». Date = registry
  publication date (`publishedAt`), written as «14 августа 2026». A current edition links to the immediately previous
  one, a replaced one to the newest current one; if the other edition's module is not installed the same tap
  downloads it through the queue (progress inline) and opens it. Only 11 codes have two shipped editions; for the
  rest the notice is not shown at all (owner decision 2026-10-02: no modules for the 485 old editions for now; STATE
  UX3), so «Предыдущая редакция … не поставляется» is gone.
- **«Препараты» without a medication package (UX3).** Since core 0.6.47 the core holds only pointers, so the catalog
  (`#/modules/documents/medications`) is empty until a package is installed. Once it has finished loading with zero
  products the page shows an explanation, the whole download size (sum of the released medication packages,
  `formatModuleBytes`) and a primary «Скачать препараты» that queues them through the same logic as the tour step
  (`useDrugDownload` in `features/medications/use-drug-download.ts`, shared with the onboarding action), plus a quiet
  link «Выбрать группы в базе знаний». Progress shows in the button; the list fills when packages connect.
- **Landing counts** come from the catalog manifest at build time (`apps/landing/src/data/catalog-facts.ts`): current
  recommendation modules (replaced editions excluded, 763) and sections (21), with correct Russian plural forms.

## Clinical recommendations refresh — 2026-10-02 (STATE KR2)

Registry snapshot 2026-10-02 (`apicr.minzdrav.gov.ru`, 1 855 records: 763 current, 496 replaced, 596 archived
or cancelled, 56 of those rows without id or title). Against the 744 modules of `clinical-json-2026.07.27-13991c1feee5` it adds **30 current editions:
19 recommendations that are new to the app (18 new codes 1062–1080 and 311_2, whose only earlier edition is archived)
and 11 new editions of recommendations the app already had**; those 11 earlier editions are now replaced.

- **Raw data kept** (`data/raw/official-clinical-documents/<id>.json`, byte-exact `GetClinrec2`, 1.41 GB, checksums in
  `data/raw/official-clinical-registry/2026-10-02/raw-json-checksums.json`): all 763 current and all 496 replaced
  editions, plus the registry pages (`api-pages*.json`, `catalog*.json`). Every fetch was sequential. 732 of the 744
  earlier modules still match the source checksum of the published pack byte for byte; the 11 replaced editions changed
  bytes when the registry replaced them; 998_1 was re-saved by the registry (publication time) but its text is equal to the
  published pack up to image labels and table captions (the same differences appear for unchanged sources, they come from
  importer changes since 2026-07-27), so its module is unchanged.
- **Built the same way** as the published 744 (`delta` → ledger → source plan → `medbase sync` → `build-documents` →
  `package-snapshot` → `compact-module-search` → framed zstd with decoded checksums): snapshot
  `clinical-json-2026.10.02-7b17a45f02ff`, 30 modules, 85.7 MB SQLite → **33.3 MB** download (2.6×; modules need app
  ≥ 0.6.46). Only the 30 new editions were built; installed modules and their checksums are untouched.
- **Editions.** A new edition is a new module id (`minimed.clinical.recommendation.<CodeVersion>`). The 11 replaced
  editions stay in the catalog, downloadable and installed copies stay valid, with their document marked `superseded`
  (the schema's own status; the app already labels it «предыдущая редакция»). The catalog schema cannot link two modules,
  so the old ↔ new link, dates, registry ids, which edition is a module and the raw checksum are in the sidecar
  `apps/app/src/features/modules/catalog.clinical-editions.json` (358 codes, 797 editions, tested against the catalog).
  Replaced editions that were never modules (485) have raw JSON only; adding them as modules is the same pipeline, but
  they would double the titles in every category list until the UI hides or badges `superseded` editions.
- **Catalog.** 812 modules (+30); `publishedAt` moved to 2026-10-02 because a remote catalog replaces the bundled one only
  when it is newer; category counters recount current editions.
- **Discovery core:** the 30 new editions have pointers and the 11 replaced ones point to their successors since
  core 0.6.47 (see «Discovery core 0.6.47»). Installed modules and their checksums are untouched.
- **Published** to the new mirror branch `datasets/clinical-json-2026.10.02-7b17a45f02ff` (30 `.db.zst`, 33.3 MB, additive:
  a new branch, nothing existing touched; no GitHub release). All 30 mirror URLs return the published bytes (size and SHA-256
  equal the catalog) with `access-control-allow-origin: *`. Local copy: `data/build/official-clinical-2026-10-02/zst/`.
- **Verified:** `bun run typecheck`, `vitest` (310 files, 7 331 tests), `pytest tools/ingest/tests`, `bun run benchmark:all`
  (within tolerance of the core); all 30 files decode with the reference `zstd` CLI to the catalog's decoded checksums; in a
  Chromium build 29 of the 30 modules installed from the catalog UI and opened as full text (3 of them through the real mirror
  with real CORS). Not verified: Android/WebView, slow hardware, a physician review of any text. The 30 new modules come from the current importer, the 744
  earlier ones from an earlier revision (same text, slightly different image labels and table-caption chunking).
- **Known app issues found on the way** (not caused by this data): the download queue rejects titles over 180 characters, so 8
  catalog modules (759_1, 759_2, 32_2, 129_3, 766_1, 795_1, 817_1, 888_1) fail with «Invalid download descriptor» (including the
  new 759_2; fix flagged); opening a document within ~1.5 s after an install can show «DB has been closed» while the app reconnects.

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
- ATC sheet: the code level by level. Levels 1-4 take their Russian names from the Minzdrava NSI
  dictionary «АТХ» (OID 1.2.643.5.1.13.13.99.2.473, v3.8 of 2025-07-15, 6 897 rows built from WHOCC
  data; 14/93/271/937 names for levels 1-4): `features/medications/atc-names.json` (109 kB, 16.8 kB
  gzip) is a lazy chunk loaded by `atc-names.ts` when a sheet first opens, outside the start-up
  preload list. Where the dictionary lacks a code, the older sources apply (MiniMed's 14 headings,
  ЕСКЛП group text); level 5 is the node's substance name. The footer cites the dictionary, version,
  date and the WHO Collaborating Centre. Cyrillic look-alike letters are mapped to Latin. The chunk is
  cached by the service worker after the first open (not pre-cached). The dictionary is fetched by
  `scripts/fetch-nsi-dictionary.sh` in a disposable container that trusts the Russian national root CA
  (fingerprint-checked) and receives only `NSI_USER_TOKEN`; raw data stays in `data/raw/nsi/` (ignored),
  see `docs/NSI_FETCH.md`. The passport carries no licence text; a public release still needs a WHOCC
  request. Verified in headless Chromium (420 px, light and dark) on the albendazole and
  levothyroxine ЕСКЛП cards.
- Section index (jump chips) above the unchanged instruction/registry text; the «Кратко / Инструкция»
  switch stays below the quick links.
- Not covered: GRLS-only registrations get no analogues/ATC (the data is not in the document);
  the group link is a text search; the bookmark of a trade name still saves the substance document id.
- Verified in headless Chromium at 390 and 1280 px, light and dark, on the ЕСКЛП nervous-system
  module; the packaging photo was a synthetic stand-in (the real images module is not installed
  locally).

### Country of manufacture next to trade names — 2026-10-04 (STATE MFG1)

- `scripts/build-mfg-countries.ts` reads `data/raw/official-grls-registry/catalog-02.10.2026.json`
  and writes `features/medications/mfg-countries.json` (registration number → country index, grouped
  by `basis`; 888 kB, 126 kB gzip) — a lazy chunk loaded by `mfg-countries.ts` /
  `use-mfg-countries.ts` only once a drug screen or the «Препараты» list is open; `dist/index.html`
  and the start-up graph do not reference it. Registration numbers are matched by
  `normalizeRegistrationKey` (case, spaces, dashes, Latin look-alikes, `N` = `№`); when the registry
  lists `ЛП-N (…)` (changed) and `ЛП-№(…)` (in force) the record in force wins.
- Country = where the product is made, from «Сведения о стадиях производства»: stage making the
  finished form («Все стадии», «готовой ЛФ») → `finished-form`; else release quality control →
  `release-qc`; else primary packaging → `primary-packaging`; else the holder's country → `holder`
  (secondary packers, solvent and substance makers do not make the product). The export holds one
  stage line per registration, so there is no multi-site data today (the parser and asset support
  it). Countries are normalised to short Russian names («Республика Беларусь» → «Беларусь»).
- Coverage 2026-10-02: 99.96 % of registrations in force (29 389 of 29 400) and 29 297 of the 29 300
  registrations the ЕСКЛП modules show; basis shares over all 39 415 numbers: finished form 80.3 %,
  release control 8.7 %, primary packaging 2.4 %, holder 8.4 %. Packer-only and release-control-only
  records can differ from the true maker; a tooltip on the country says which basis it rests on.
- UI: trade name in the drug header gets «(Россия)» after it (muted, read as «Страна производства»);
  the analogue row lists one chip per trade name × country («Альбендацид (Беларусь)», «Альбендацид
  (Россия)»), each opening its closest registration; «Препараты» list titles carry the country; the
  share text includes it. No country on the МНН (substance) card header. The МНН card's trade-name
  list is an accordion: 2 entries visible, «Показать ещё N названий» (Russian plural) opens the rest
  with the app's disclosure motion (0fr → 1fr track). No «оригинальный препарат» mark.
- Rebuild after a registry refresh: `bun scripts/build-mfg-countries.ts`. Not tested: the ибупрофен
  pointer in the musculoskeletal module did not open its card in headless install (module install
  stayed at 100 %); verification used the antiparasitic module (албендазол) at 360 px, light and dark.

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

## ГРЛС instruction collection (G1) — 2026-10-02

Owner decision: ГРЛС grants no database access; for this personal single-user build the public
instruction PDFs are still collected, politely (`tools/ingest/.../grls_collect.py`, command
`medbase-regulated-catalog grls-collect`): truthful `User-Agent`, ≤2 requests in flight, randomized
delays, backoff on 429/503, no CAPTCHA handling, resumable state ledger, never overwrites a raw file.

- Owner decision: collect over time (no RLS purchase). The runs stopped at an image CAPTCHA twice (30 PDFs, then 14);
  a detached daily-batch loop (`grls-collect-daily`: probe with one registration, batch ≤50 until the first CAPTCHA,
  wait 24 h; never bypassed) waits for its first attempt 2026-10-03 05:45 UTC. Queue order: ЖНВЛП, then INNs with the
  most registrations. Watch `data/build/grls-collect/progress.json`; stop with a `STOP` file. 6 300+ transient
  failures and 675 new registrations remain; the ledger now keeps `idReg`/`routingGuid`/exact PDF URLs
  (`grls-instruction-url-ledger.jsonl`). Pace is unknown until the first windows finish.
- Real-difference queue (owner, 2026-10-04): one text per «INN + dosage-form class» group, not per registration —
  4 383 groups, 2 954 covered (67 %), ЖНВЛП groups 958/1 138 (84 %); queue 1 041 groups (177 ЖНВЛП first) plus an
  ОХЛП second pass for 854 leaflet-only groups. Each card visit keeps all current-edition documents with their kind
  (ohlp/leaflet/national-instruction); only 5 ОХЛП held so far. ~14 registrations per daily window: ЖНВЛП groups
  ~2 weeks, first pass ~2.5 months (honest range 40–100 days). `progress.json` reports groups/ЖНВЛП/ОХЛП coverage.
- New registry export 02.10.2026 (39 481 records, +666) is stored next to the old one
  (`data/raw/official-grls-registry/catalog-02.10.2026.json`); plan `grls-instructions-active-plan-02.10.2026.json`.
- OCR flag kept: `ExtractionDiagnostics`/`metadata.extraction` now carry `textExtractionMode`,
  `ocrEngine`, `ocrPages`, `ocrMeanConfidence` (Vision, character-weighted) and
  `ocrLowConfidenceRatio` for PDFs; `data/build/grls-instruction-text-manifest.jsonl` joins every PDF
  (checksum, URL, fetch date, OCR flag, `unknownWordRatio`, `textSha256`) and
  `grls-instruction-text-coverage.json` holds before/after coverage. Released packs and the catalog
  are untouched; the confidence is recorded only for PDFs extracted since this change (older OCR
  documents have the flag and the unknown-word proxy only).

## Official ГРЛС instructions and Allmed as downloadable modules — 2026-10-05 (STATE GI1)

The ~8 950 collected ГРЛС instructions were in no module; now they ship, one module per ЕСКЛП group, and the
Allmed reference (until now only the local dev companion `public/content/medications.db`, catalog entry without
artifact) is a downloadable module too. Both need app **0.6.48** (`minAppVersion`); the catalog entries are
`releaseState: preview`, i.e. like the ЕСКЛП groups they appear with «Экспериментальные модули».

- **Builder** (`tools/ingest/src/localmed_ingest/grls_instruction_modules.py`, CLI
  `tools/ingest/scripts/build_grls_instruction_modules.py plan|build`, tests `tests/test_grls_instruction_modules.py`;
  it replaces the Sep-28 `build_grls_atc_modules.py` partition, whose `data/build/grls-instructions-atc-*.db` are now
  obsolete). Input = every row of `grls-instruction-text-manifest.jsonl` with `extraction == prepared` (8 947 distinct
  document ids; a PDF fetched under two registration numbers is one document that serves both). Group = the ЕСКЛП
  module that lists one of the document's registration numbers (`data/build/release-esklp`; primary registration
  first, otherwise the most common group, ties alphabetical and flagged `atcGroupBasis`); no ЕСКЛП registration or no ATC
  → `unclassified` («без АТХ»). Only the front matter of the prepared Markdown changes; the body, `localmed:source` spans,
  ids, section and chunk anchors stay byte-identical (checked against the Sep-28 build: 690/690 chunks equal). Added
  metadata, all taken from the manifest: `documentKind` (`leaflet` / `national-instruction` / `ohlp` / `unknown`),
  `fetchedAt`, `ocr`, `textExtractionMode`, `ocrEngine`, `ocrMeanConfidence`, `ocrLowConfidenceRatio`,
  `unknownWordRatio`, `qualityScore`, `textSha256`, `pdfPageCount`, `registrationNumbers` (every number the PDF serves),
  `atcGroup`, `atcGroupBasis`; `officialSourceUrl`, `instructionLabel` («Изм. № …») and `pdfSha256` were already there.
  A leaflet/ОХЛП title names its kind («РАМИПРИЛ: листок-вкладыш»). Cards (`official_registry_summary`) are not shipped
  (ЕСКЛП holds the registry data). Lexical only (no hash embeddings), then `medbase compact-module-search` (all 15
  passed the fingerprint/bm25/text-hash proof), framed zstd (`scripts/package-instruction-modules.ts`, shared archive
  code in `scripts/lib/zstd-module-archive.ts`, also used by `repack-module-indexes-zstd.ts`; decoded again with the app's
  reader and with the reference `zstd` CLI, all 16 match the catalog checksums).
- **Left out:** 3 of 8 947 fail the builder's own guards and are listed in the reports (two OCR headings with control
  characters/backslashes, one English-dominant text); 6 PDFs are `not-prepared` (no text).
- **Published** additively to new branches `datasets/grls-instructions-2026.10.05-056961ab2b54` (15 files) and
  `datasets/allmed-2026.10.05-2d39a7fc2b43` (1 file) with `publish-module-zstd-mirror.sh --family esklp --create`;
  `artifact-url.ts` maps those tags to `raw.githubusercontent.com/…/datasets/<tag>/modules/<file>.db.zst`. All 16 URLs
  return the catalog's bytes (size and SHA-256) with CORS. Catalog `release-0.6.48-grls.2026.10.05` (827 modules, +15,
  Allmed completed with its artifact, same version and `sourceSetDigest` so a locally mounted companion stays valid);
  `catalog:shell` regenerated.

| Module (`minimed.medications.instructions.<group>.ru`) | documents | registrations served | download MB | installed MB |
|---|---:|---:|---:|---:|
| alimentary-metabolism | 1 217 | 1 761 | 26.5 | 159.8 |
| antiinfectives | 1 245 | 1 760 | 40.9 | 236.0 |
| antineoplastic-immunomodulating | 688 | 913 | 25.9 | 141.9 |
| antiparasitic | 30 | 49 | 0.5 | 3.3 |
| blood | 516 | 734 | 15.8 | 96.2 |
| cardiovascular | 949 | 1 361 | 28.2 | 167.6 |
| dermatological | 502 | 754 | 7.3 | 47.7 |
| genitourinary-hormones | 262 | 366 | 7.1 | 41.4 |
| musculoskeletal | 616 | 880 | 16.3 | 97.7 |
| nervous-system | 1 086 | 1 547 | 30.1 | 174.5 |
| respiratory | 680 | 965 | 13.1 | 84.2 |
| sensory-organs | 203 | 272 | 4.9 | 29.4 |
| systemic-hormones | 87 | 126 | 2.8 | 15.5 |
| unclassified («без АТХ») | 705 | 1 040 | 7.2 | 49.9 |
| various | 158 | 221 | 3.9 | 22.8 |
| **15 modules** | **8 944** | **12 749** | **230.6** | **1 367.8** |
| `minimed.medications.ru` (Allmed, 4 708 entries) | 4 708 | — | 48.7 | 276.5 (was 514.3) |

  Uncompacted the instruction packs were 1 883 MB (−27 %). The whole «Препараты» set (ЕСКЛП 68.7 MB + instructions 230.6 +
  Allmed 48.7) is **348 MB download, 3 074 MB installed** (the empty-catalog / onboarding «Скачать препараты» button reads
  332 МБ in MiB), installed as the app does from the mirror in a clean browser profile in 15 minutes on this loaded
  laptop. Kinds in the modules: 4 671 instructions, 3 811 leaflets, 5 ОХЛП, 457 unclassified (scans); 2 296 OCR texts.
- **Coverage** (`tools/ingest/scripts/measure_grls_instruction_coverage.py`, `data/build/grls-instruction-modules/coverage.json`):
  12 740 of 27 049 active non-substance ГРЛС registrations (47.1 %) and 12 666 of 29 300 ЕСКЛП registrations (43.2 %) have an
  official text; 2 353 of 3 324 ЕСКЛП МНН cards (70.8 %), 5 075 of 7 672 СМНН nodes (66.2 %), 2 811 of 4 055 МНН × form-class
  groups (69.3 %); in the collector's «INN + dosage-form class» groups 2 971 of 4 383 (67.8 %), ЖНВЛП groups 961 of 1 138
  (84.4 %). It grows with the daily collector window (about 14 registrations a day); a later delta is a new module version
  or additional modules by the same pipeline.
- **App.** `instruction-source.ts`: kind label («Листок-вкладыш (для пациента)», «Инструкция по медицинскому применению»,
  «ОХЛП (…)»), edition, ГРЛС link (https only), fetch date and an OCR/low-quality note, shown above any
  `official_drug_instruction` text; `instructionIndexFromSummaries` indexes a PDF under every registration it serves and
  prefers ОХЛП > instruction > leaflet when one registration has several documents. `allmed-matching.ts`: an Allmed entry
  is attached to a product only for the same ЕСКЛП substance, the same trade name and a compatible dosage form (a form only
  rules an entry out when both sides name forms with nothing in common; no match across substances or by similarity) — used
  for the merged «Кратко (Allmed)» text and the Allmed panel. The Allmed panel shows its own notice («не официальная
  инструкция ГРЛС»), and for a drug without an installed official text the plaque «Полная официальная инструкция пока
  недоступна — показана краткая справка Allmed» plus, when the group's instruction module is in the catalog and not
  installed, «Скачать инструкции группы «…» · 495 КБ» (downloads through the module runtime, reconnects the core and opens
  «Инструкция»). Without Allmed only the official text is shown (the «Кратко» side is the ЕСКЛП card). The «Скачать
  препараты» flow already selects every `kind: medication` module, so it now includes the instruction modules and Allmed;
  its explanation text names them.
- **Verified in a browser** (390 px, light/dark, headless Chromium, clean profile, packages from the mirror): the whole
  «Скачать препараты» set installs (16 976 documents, 2 931 МБ); Мефлохин (OCR instruction): switch «Кратко (Allmed) /
  Инструкция», source block with edition «Изм. № 1, ЛП-004502, 2022», link, date and OCR note; Вермокс (leaflet): label
  «Листок-вкладыш (для пациента)»; with the antiparasitic instruction module removed the plaque and the offer appear,
  the offer downloads 0.5 MB and opens the text (`apps/app/e2e/grls-instruction-modules.spec.ts`, opt-in with
  `GI1_MIRROR_E2E=1`, passes against a 0.6.48 build). Unit tests: `instruction-source`, `allmed-matching`,
  `instruction-offer`, `artifact-url`, `catalog.preview` (15 instruction modules + Allmed in the drug set),
  Python `test_grls_instruction_modules`.
- **Not verified:** Android/WebView and slow devices; search quality over the mounted instruction modules (they join the
  lexical search as `official_drug_instruction`, which the scoped search already treats as medication); registrations
  with several documents of different kinds (none exist yet: the collector now keeps all of a card's current documents);
  the 3 left-out documents are not repaired.

## Manufacturer-site instructions (M1) — 2026-10-02

Research and pilot (`docs/research/manufacturer-instructions-2026-10.md`): official instruction texts for
registrations the ГРЛС collector has not delivered, taken from the holders' own sites. Separate source class
`manufacturer-site` under `data/raw/manufacturer-instructions/` (ledger entry in `docs/data-ledger.json`); ГРЛС raw files and
the G1 loop are not touched. Collector `tools/ingest/.../manufacturer_instructions.py`
(`medbase-manufacturer-instructions missing-report | crawl | rebuild-manifest`): robots (RFC 9309), one request at a time
per host, TLS verified, truthful `User-Agent`, stops a host on 403/429/CAPTCHA, resumable ledger, manifest with URL, fetch
date, sha256, version/date as printed, OCR flag and match evidence.

- 8 325 missing registrations (3 102 ЖНВЛП, 77 % EAEU numbers) over 1 323 holders: 78 holders cover 50 %, 301 cover 80 %.
- Pilot on 7 holder sites: 245 of 681 missing registrations found (36 %; 94 ЖНВЛП), 61 with the registration number
  printed in the document or on its page, 179 `label-unique` (name + form + holder, no number printed: EAEU листки omit it),
  5 ambiguous. Not yet used by any pack or the app; whether to accept `label-unique` is an owner decision.
- Generic web search for 20 missing ЖНВЛП: 0 verified official documents (reference books and aggregators only).

## Manufacturer-site instruction module (M1 shipped, MED3) — 2026-10-05

Owner decision D2 (2026-10-05): the collected M1 documents ship as ONE separately labelled module,
`minimed.medications.instructions.manufacturer-site.ru` («Инструкции с сайтов производителей»), version
`manufacturer-2026.10.05`, catalog entry `kind: medication`, `releaseState: preview`, collection
`manufacturer-instructions` (not `grls-instructions`: the sections feature reads that collection as the per-ATC groups),
tags `manufacturer-site`, `official-instruction`, `instructions`, `minAppVersion` 0.6.48, lexical only, search-compacted.

- **Builder** `tools/ingest/src/localmed_ingest/manufacturer_instruction_modules.py`, CLI
  `tools/ingest/scripts/build_manufacturer_instruction_module.py plan|registry|build`, tests
  `tests/test_manufacturer_instruction_modules.py`. Flow: `registry` → `medbase prepare` (PDF: normal preparer with the macOS
  Vision OCR fallback, so the body keeps `localmed:source` spans; DOCX: the collector's cached text written as a `format: text`
  source) → `build` (stages only the front matter, GI1 guards, `build_content_pack` without embeddings) →
  `medbase compact-module-search` → `scripts/package-instruction-modules.ts --family manufacturer` (disjoint from `--family grls`) →
  `publish-module-zstd-mirror.sh --family esklp --create`. Text is never summarised or repaired. The 21 DOCX texts have
  single-newline paragraphs, so the text preparer finds only 1–2 headings in each (the body is chunked by size); the PDFs keep
  their headings.
- **Acceptance.** Only `text-number` (number printed in the document), `page-number` (printed on the holder's product page) and
  `label-unique` (name + form + holder, no number printed) count; `label-ambiguous` never attaches a document to a registration.
  A file serves every accepted registration of every manifest row that names its sha256 (373 rows = 277 files). Of the 245
  registrations the pilot found, **240 are accepted: 45 `text-number`, 16 `page-number`, 179 `label-unique`** (strongest level per
  registration; as registration × document pairs 47 / 16 / 213). 5 registrations match only ambiguously and are left out
  (`ЛП-№(004982)`, `(005347)`, `(005543)`, `(005822)`, `(015391)`), with the 5 files that carry only such matches (4 Микроген, 1 Усолье).
  A document that also has accepted matches keeps only those registrations.
- **272 documents** (`drug.rf.m1.<20 hex of the file sha256>.instruction`; 251 PDF + 21 DOCX; 16 OCR; none excluded by the guards),
  5 916 sections, 7 310 chunks. Kinds (read from the text): 153 national instruction, 92 leaflet, 22 ОХЛП, 5 unclassified
  (scans without a title). Documents / registrations by site: Микроген 103 / 103, КРКА 35 / 16, Вертекс 25 / 21, Акрихин 31 / 27,
  Промомед 31 / 26, Реневал 27 / 26, Усолье-Сибирский 20 / 21. Documents by their weakest level: 213 `label-unique`, 15 `page-number`,
  44 `text-number`.
- **Provenance written to every document's metadata** (all from the manifest): `sourceClass` (`manufacturer-site`), `publisher`,
  `site`, `tradeName`, `registrationNumber` (primary = strongest, then lowest number), `registrationNumbers`, `registrationMatches`
  (`registrationNumber`, `tradeName`, `matchLevel`, `evidence`), `matchLevel` (the weakest accepted level of the document) and
  `matchMethod` (`number-in-text` / `number-on-page` / `name-form-holder`), `officialSourceUrl` (the document URL, https only),
  `pageUrl`, `fetchedAt`, `httpLastModified`, `documentRevision` (as the collector derived it, file-name dates included),
  `instructionLabel` (only when a revision/date was printed in the text: 3 documents), `pdfSha256` (the file's sha256, also for DOCX),
  `fileFormat`, `rawPath`, `documentKind`, `ocr`, `textExtractionMode`, `ocrEngine`/`ocrMeanConfidence` when present,
  `qualityScore`, `ocrLowConfidenceRatio`, `pdfPageCount`, and `sourceUrls`/`pageUrls` when one file was reached by several links.
  `sourceType` stays `official_drug_instruction`, so the registration index and the drug screen pick the documents up; the title names a
  leaflet/ОХЛП like the GRLS ones. Rights of the holders' texts are not assessed (owner decision: shipping approved for this source).
- **Size:** 7.34 MB download (7 340 963 B, framed zstd), 46.4 MB installed (46 444 544 B; 64.6 MB before compaction). Tag
  `manufacturer-instructions-2026.10.05-7a74c67f575d` (12 hex of the `sourceSetDigest`), branch
  `datasets/manufacturer-instructions-2026.10.05-7a74c67f575d` (`modules/<file>.db.zst`, created additively), SHA-256
  `f8c4ab3c…bb420c`; the raw.githubusercontent.com URL returns the catalog's size and SHA-256 with CORS. Catalog
  `release-0.6.48-m1.2026.10.05` (828 modules, +1); `artifact-url.ts` maps the `manufacturer-instructions-` tags; locale key
  `collection_manufacturer-instructions` (ru/en).
- **Verified:** python:check (1 077 tests), pack integrity and foreign keys, compaction proof, framed zstd decoded with the app's reader
  (packaging script) and with the reference `zstd` CLI, SQLite query of the built module (272 documents, 240 distinct registration
  numbers, `sourceClass`/`matchLevel`/`matchMethod` in every document, kinds), vitest (`catalog.preview`, `artifact-url`, shell,
  sections, onboarding). **Not verified:** installing the module in a browser/Android profile, the drug-screen wording for this source
  class (MED3 UI), search ranking over the mounted module, text overlap with the ГРЛС version of the same drug.

## Drug comparison: tool, index and search card — 2026-10-06 (STATE CMP1)

Owner request 2026-10-06: «Compare drugs by parameters» (release 0.6.52). Details, numbers and the hand check:
[`research/drug-comparison-2026-10-06.md`](research/drug-comparison-2026-10-06.md); roadmap item 16 of
[`SEARCH_ROADMAP.md`](SEARCH_ROADMAP.md).

- **Tool «Сравнение препаратов»** (`#/notes/drug-comparison?c=<slug|slug|Trade name>&d=<typed name>`, 2–4 drugs, substance or
  product chosen with the app's own drug search, `apps/app/src/features/drug-comparison/`). Columns per drug, rows per
  parameter, the first column pinned on a wide screen, every row stacked with the drug's name on a phone. Rows: МНН, ATC code
  and НСИ group names, registry pharmacotherapeutic group, forms and strengths (ЕСКЛП), conditions of dispensing (ГРЛС
  register), ЖНВЛП per form, counts of registrations / trade names / manufacturers / holders; the instruction's own
  pharmacotherapeutic-group and dispensing lines quoted; age and weight, pregnancy, breastfeeding from the SAFE1 extraction
  run on the open instruction; six quoted sections (Показания, Противопоказания, Способ применения и дозы, Побочное
  действие, Особые указания и «С осторожностью», Передозировка) declared in `SECTION_ROWS`; the INT1 sentences and INT2
  DDInter label for the pairs (the same panel as the interaction tool, `InteractionPairs.tsx`).
- **Deterministic marks, no generated text.** Sections are split into sentences and list items (plain substrings of the
  instruction), normalised (case, punctuation, light stems, numbers kept, the drug's own names ignored) and matched across
  the drugs: «у обоих» / «у всех» (identical), «формулировки различаются» (Jaccard ≥ 0.6, or ≥ 85 % of a ≥ 4-word statement
  inside a longer unit; differing words and numbers marked), «только у X». «Показать только различия», «Показать полностью»,
  «Открыть в инструкции» per statement. The notice «Сравнение текстов инструкций, а не клиническая рекомендация» is on the
  screen, the print and the share text; no summary, no «лучше / хуже».
- **Which instruction is read.** The index lists every instruction with the sections it has: the most sections, ГРЛС before a
  holder's site, professional before leaflet; a product asked for keeps its own instruction; otherwise one dosage-form class
  is read for every drug where each has one. Another instruction of the substance is one `<select>` in the column head; the
  ADR-0023 wording and the leaflet note are shown; missing modules are offered once.
- **Index** `apps/app/src/features/drug-comparison/data/comparison-index.json` (2.5 MB, 541 kB gzip, lazy chunk; registry facts
  per card and a section map per instruction, **no text**), built by `bun run content:drug-comparison`
  (`scripts/build-drug-comparison.ts`: instruction modules checked against the catalog SHA-256 like INT1 / SAFE1, ЕСКЛП
  cards, ГРЛС register `data/raw/official-grls-registry/catalog-02.10.2026.json` for the conditions of dispensing; report
  `data/build/drug-comparison/report.json`). Rebuild it with every instruction-module or register refresh.
- **Search entry.** «X или Y», «X vs Y», «сравнить X и Y», «чем отличается X от Y», «разница между X и Y» (`parseComparisonQuery`)
  → a card «Сравнить: X, Y» above the results of «Все источники» and «Препараты», only when every part names a drug in the
  ordinary drug search (S3 layout / transliteration included, genitive names re-looked-up as their stem). Diseases and
  symptoms get no card. No search code, ranking or alias changed.
- **Entry points.** The search card; «Сравнить с…» in the quick links of a substance card and of a trade-name screen
  (`links.compare` in `drug-screen.ts`); «Сравнить эти препараты» in the interaction tool; «Все инструменты» and the tool search
  (`DRUG_COMPARISON_TOOL`, `ageScope` «any»); print and share like the interaction tool.
- **Refactor.** The pairs block of the interaction tool (quotes, severity labels, offers, summary) moved from
  `DrugInteractionWorkspace.tsx` to `InteractionPairs.tsx` (`InteractionPairsPanel`) so both tools show the same text; classes
  and test ids unchanged. `QuoteBlock` of `SafetyBlocks.tsx` is exported; `endsSentenceAt` / `isUpperStart` of
  `interaction-text.ts` are exported.
- **Measured** (research note): 198 of the 200 most common substances (99 %) have all six quoted sections in the instruction read
  first; marks hand-checked on 62 statements 95.2 % and on 63 after the containment rule 100 % (sample in
  `research/data/cmp1-precision-sample.json`; two known error classes left); 4-drug comparison computes in 66–86 ms (desktop,
  bun + SQLite); `bun run benchmark:cmp1` 35/35; exact-lookup gates unchanged.
- **Not verified:** Android / WebView, devices, emulators; print on paper; recall of shared statements; statements on one topic in
  different words are not matched (a «только у X» can be shown for a topic the other drug also covers).
- Tests: unit (`comparison-*.test.ts`, 50 cases: units, normalisation and matching, view and instruction choice, registry rows,
  build, query parsing, routing) and e2e `apps/app/e2e/drug-comparison.spec.ts` (instruction module from local bytes; screenshots
  `output/cmp1-screens/`).

## Pregnancy, lactation and child-age questions in search — 2026-10-06 (STATE SAFE1)

Owner request 2026-10-06: «X разрешён ли во время ГВ», «X при беременности», «X можно кормящей», «X ребёнку до Y лет / ребёнку 3 лет /
с какого возраста X». Design, rules, measurements and what is not done:
[research/medication-safety-2026-10-06.md](research/medication-safety-2026-10-06.md); roadmap item 15 in
[SEARCH_ROADMAP.md](SEARCH_ROADMAP.md).

- **Index** (`scripts/build-medication-safety.ts`, `bun run content:medication-safety`, rebuild after every instruction-module refresh):
  same inputs and SHA-256 checks as the INT1 build; writes `apps/app/src/features/medication-safety/data/safety-index.json` (1.8 MB,
  592 kB gzip, lazy chunk) and `data/build/medication-safety/report.json`. It holds offsets into the canonical text of each section plus a
  4-hex checksum — no instruction text. Per МНН card the best instruction of each of up to five dosage forms (3 201 of 9 186 instructions).
  Per sentence: topic (pregnancy / lactation), origin section, dosage forms named; per age limit: operator, bounds (days / tenths of kg),
  the words it was read from.
- **Query parsing** (`safety-query.ts`, syntactic): intents lactation / pregnancy (trimester) / age (typed age or «до N лет»); the
  rest, minus frame words, is the name; looked up with the app's own medication search (S3 layout / transliteration fallback included).
  A name that no result group carries (a symptom, a disease) shows no card.
- **Card** (`MedicationSafetyCard`, above the results of «Все источники» and «Препараты», not shown for the interaction query): quotes of the
  installed instruction without change, grouped (the pregnancy section; «Противопоказания» and «С осторожностью»; other sections folded),
  each with its section, the source line (kind, edition, ГРЛС / holder's site, fetch date, form), dosage forms named in the sentence and
  «Открыть в инструкции». Age: limits by section, weight limits apart, and for a typed age «Рассчитано: 3 года — меньше верхней границы
  12 лет» lines (labelled as the app's arithmetic). Never «можно / разрешён / безопасно» in the app's own words. States: not installed
  (download offer through the module runtime), no instruction in the sources, «В инструкции об этом не сказано» (the instruction read is
  named, with a link to open it), changed section (reported). The instruction read is «одна из инструкций по этому веществу» (ADR-0023
  wording) unless the doctor typed the product; the other dosage forms of the substance are a switch.
- **On the open instruction**: «Беременность, ГВ, дети» folded block in `OfficialDocumentReader` (`DrugSafetyBlock`), the same extraction run
  on the open text (so every registration has it, not only the instructions the index keeps).
- **Measured**: coverage (2 398 МНН cards have an instruction; 74.6 % a pregnancy section, 93.0 % / 90.6 % ≥ 1 pregnancy / lactation
  sentence anywhere, 88.1 % a numeric age limit); hand-checked precision 98.3 % (age), 100 % (weight), 94 % (age group without a number),
  98.3 % (section sentences), 94.5 % (mentions outside the section) on 50–60 sentences each; recall ≈ 99 % of the number + unit +
  child-word sentences. Separate set `tools/benchmarks/safe1-queries.json` (44 questions): 44/44 with and without the module installed;
  `benchmark:real:release`, `benchmark:doctor-lookup`, `benchmark:owner-queries` unchanged (no search code changed).
- **Not done / not verified**: comparing the substance's other manufacturers' instructions; trade names inside quoted text; print / share of
  the card; Android / WebView / devices (desktop Chromium only); limits worded without a number or in sections the section splitter typed
  wrongly.

## Drug interactions: tool, index and search entry — 2026-10-06 (STATE INT1)

Owner request 2026-10-06: a drug-interaction «calculator» (UI idea from vidal.ru; Vidal's data is proprietary and is
not used — only a «Проверить на vidal.ru» link-out that sends nothing). Research, measurements and the severity-source
recommendation: [research/drug-interactions-2026-10-06.md](research/drug-interactions-2026-10-06.md).

- **Index** (`scripts/build-drug-interactions.ts`, rebuild after every instruction-module refresh): reads the 16 published
  instruction modules (SHA-256 checked against the catalog), the ЕСКЛП cards and the НСИ «АТХ» names; writes
  `apps/app/src/features/drug-interactions/data/interaction-index.json` (2.0 MB, 672 kB gzip, lazy chunk, no instruction
  text: sentence offsets into each section plus a 4-hex checksum) and `data/build/drug-interactions/report.json`.
  Sections: interactions, special instructions, contraindications, caution (flagged by section); a leaflet without a typed
  interaction section is read only for sentences about taking drugs together. Substances by МНН (whole word, inflection-aware,
  own substance excluded), classes by the official ATC group names (derived; 35 documented aliases, each pointing at НСИ codes).
- **Tool** «Взаимодействие препаратов» (`#/notes/drug-interactions?d=<name>&c=<card>`, listed in «Все инструменты» and the
  search catalog, ageScope any, Print / Поделиться): 2–10 drugs from the ordinary drug search (+ «Алкоголь»), per pair the quoted
  sentences of each drug's instruction with the matched words marked, the section, the source (kind, edition, ГРЛС/holder site)
  and «Открыть в инструкции» (reader at the chunk). States: «упоминание найдено», «в инструкциях упоминаний не найдено»
  (never «безопасно»; the notice says so), «инструкция не установлена — скачать» (one offer per missing module), no instruction
  in the sources. The instruction read is one of the substance's instructions and is labelled so (ADR-0023). A changed section
  text is reported, not guessed.
- **Search entry**: «X взаимодействие с Y, Z», «совместимость X и Y», «X и алкоголь» (`parseInteractionQuery`, syntactic, cue
  word + separators) add a card «Проверить взаимодействие: …» above the results of «Все источники» and «Препараты»; the
  ordinary search and ranking are untouched (benchmarks before/after in the research note).
- **Measured**: 12.2 % of the 19 900 pairs among the 200 most common substances have ≥ 1 sentence in either instruction; 1 484 of
  3 324 МНН have an indexed interaction section (2 398 have any instruction). Hand-checked precision (50 sentences): all
  targets right 96 %, relevant to a pair 86 % (interaction section 27/27, «Особые указания» 6/12).
- **Not done / not verified**: trade names in instruction text; Android/WebView; products as items (a drug is picked as a
  substance); `benchmark:*` unchanged by design (no core change). The severity layer is INT2 below.

### INT2: optional DDInter severity labels and the fold — 2026-10-06 (STATE INT2)

Owner decisions of 2026-10-06 (recorded in `docs/research/drug-interactions-2026-10-06.md` §5): a severity layer is wanted as an
optional, separately downloadable module from DDInter 2.0 (CC BY-NC-SA 4.0, personal non-commercial app), **labels only**
(no English text, no machine translation); a label only on a pair that already has an instruction sentence, naming the source;
sentences outside the interaction section folded; INT1's best-instruction-per-substance rule kept.

- **Source and licence checked** (`docs/research/drug-interactions-2026-10-06.md` §6.1): terms page states CC BY-NC-SA 4.0; the bulk
  download has no login or CAPTCHA; its CSV files hold only `DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level` (no ATC codes, no text);
  14 files, six of them (C, G, J, M, N, S) not linked from the download page but served from the same path. Raw files and
  `MANIFEST.json` (SHA-256 per file) in `data/raw/ddinter/` (33 MB, local, git-ignored).
- **Join** (`tools/ingest/src/localmed_ingest/ddinter_severity.py`, CLI `tools/ingest/scripts/build_ddinter_severity_module.py
  manifest|report|build`, 13 pytest cases): DDInter English name → НСИ «АТХ» level-5 English name (exact, salt-stripped, 21 listed USAN → INN
  spellings, each checked against НСИ) → ЕСКЛП single-substance card (НСИ Russian name equals МНН, or the card's own code with the same first
  word). 815 of 1 971 DDInter drugs and 811 of 2 020 single-substance cards joined; **79 884 labelled card pairs**, of which **19 213** also
  have an instruction sentence (the only ones the tool shows); 1 071 of the 2 430 pairs with a sentence among the 200 most common substances.
- **Module** `minimed.reference.ddinter-severity.ru` (`kind: reference`, collection `ddinter-severity`, preview, `minAppVersion` 0.6.52,
  `capabilities.search: false`): 799 documents (one per card that is the smaller slug of a labelled pair: `<partner slug> TAB <level code>`;
  a manifest document with source, licence, date), documents flagged `definitionReference` so they stay out of the search index, 6.5 MB
  installed, 243 KB download, reproducible build. Packaged with `bun scripts/package-instruction-modules.ts --family ddinter` (tag
  `ddinter-severity-2026.10.06-51ff325a7659`, mirrored through the `datasets/<tag>/modules/` branch like the other medication modules;
  `artifact-url.ts` maps the tag). The installer accepts an empty search index only for a module that declares no search
  (`module-search-index.ts`).
- **Tool**: `interaction-severity.ts` (levels, rules, labels «Серьёзное / Умеренное / Слабое / Степень не определена по DDInter»),
  `interaction-severity-load.ts` (reads the manifest and one document per pair through `core.getDocument`), a badge with the note «Оценка из
  международной базы DDInter … а не из инструкции» under the pair status, a source block (source, licence link, retrieval date, count),
  `SeverityDownloadOffer` («Скачать метки степени риска (DDInter), 243 КБ», shown only when a quotable sentence exists and the module is not
  installed), the label and attribution in print and share text. **A label needs a level for the pair and at least one sentence quotable now**
  (instruction installed): alcohol and pairs without sentences get none. No module: nothing changes.
- **Fold**: per side, interaction-section sentences (and a leaflet's general-text sentences, which have no typed interaction section) stay visible;
  «Особые указания», «Противопоказания», «С осторожностью» sit behind the shared `Disclosure` «ещё из других разделов (N)», closed by default; a
  side with only folded sentences says so. Print and share keep every sentence with its section name.
- **Tests**: `test_ddinter_severity.py` (name matching, aliases refused when not НСИ names, card codes, most-severe rule, pack content, raw checksum
  manifest), `interaction-severity.test.ts`, `interaction-view.test.ts` (label rules, print, `splitQuotes`), `module-search-index.test.ts`,
  `catalog.preview.test.ts`, `artifact-url.test.ts`; e2e `drug-interactions-severity.spec.ts` (module installed from its local bytes with the
  catalog chunk's minimum version lowered, `severity-module-fixture.ts`; fold; no label without a sentence; no leak into search).
- **Not verified**: Android/WebView, a phone, the module card in the knowledge-base catalog UI (not looked at under load), the app on the real catalog URL (the mirror branch and the pre-release are published; the catalog entry reaches `main` with the app code),
  the module on old apps (they hide it by `minAppVersion`), clinical accuracy of DDInter levels (shown as the source's label, never as advice).

## Same-substance instruction fallback (MED3) — 2026-10-05

Owner decision D1 (2026-10-05, delegated and decided; details in [ADR-0023](adr/0023-same-substance-instruction-fallback.md) and
`docs/research/medication-instructions-2026-10-05.md` «Decisions»): a product with no instruction of its own shows, labelled, the
instruction of ANOTHER registration of the same МНН. Never presented as the product's own text, never merged, exact provenance kept,
no fallback across МНН or form classes. D2 (the M1 holder-site module) is the section above; D3–D5 (official requests, BY/KZ
registers, machine translation) stay not done.

- **Matching is build-time data.** `tools/ingest/src/localmed_ingest/substance_fallback.py` (pure; 43 pytest cases in
  `tests/test_substance_fallback.py`) + `tools/ingest/scripts/build_substance_fallback.py` read the released ЕСКЛП cards, the
  documents the released instruction modules hold (GRLS module reports + the instruction manifest, and the M1 module report) and the
  ГРЛС registry export (holder country and date, ranking only), and write the generated asset
  `apps/app/src/features/medications/substance-fallback.json` (schema 1: ranked donor lists shared between registrations, 669 kB,
  14 180 registrations, 3 358 groups, lazy chunk) plus `data/build/substance-fallback/report.json` (coverage). Rebuild it with
  `bun run content:substance-fallback` after every instruction-module refresh or collector window; nobody edits it by hand.
  Level 1 = the same СМНН node or an identical form string with an identical canonical strength (`0,5 г` = `500 мг`, combinations keep
  their order; an unstated strength, «НЕ УКАЗАНО», is never «the same»). Level 2 only when level 1 has no donor: same form class
  (the collector's `dosage_form_class`) with a different strength (flag 1), unstated strength (2) or another wording of the form (4).
  A donor always belongs to the product's own ЕСКЛП МНН card. Ranking: fewest differences, ГРЛС before holder-site, ОХЛП >
  instruction > leaflet, foreign holder (originator proxy), earliest registration, number; four donors per registration.
- **Drug screen** (`instruction-fallback.ts`, `substance-fallback.ts`, `use-substance-fallback.ts`; `DocumentPageHost`,
  `OfficialDocumentReader`): the asset is validated at the boundary (schema, flags/level consistency); a donor applies only if it is
  in the product's own card and its document is installed (the existing registration index), so nothing shows until the group's
  instruction module is installed (the existing download offer stays). The «Инструкция» tab then opens the donor document; above the
  donor's own source block a fallback block shows the label «Инструкция другого производителя: то же вещество, форма и
  дозировка», the warnings (level 2: «Дозировка отличается: проверьте дозы по своему препарату»; unstated strength: «Дозировка в
  реестре не указана: …»; other form wording: «Лекарственная форма отличается: …»), the donor product (trade name, registration,
  holder, form and strength) and «Это не инструкция выбранного препарата…». The product card's source line no longer claims ГРЛС for a
  fallback; a hint under the «Кратко | Инструкция» switch names it. A restored history entry is re-resolved against what is
  installed. A product with an own text never gets a fallback; a ГРЛС file outranks a holder-site document of the same registration.
- **Holder-site documents in the screen:** the source block names the holder («Сайт производителя: АО «ВЕРТЕКС»»), links the
  document, and states the match method per registration (number in the text, number on the product page, or «по названию, форме и
  держателю: номер регистрации в документе не напечатан»); `instructionSourceClass` keeps the product's source line honest.
- **Coverage** (604 213 ЕСКЛП product positions = packs, deduplicated by КЛП code; own = the registration has a document in a released
  module, now including the 231 M1 registrations that are in ЕСКЛП):

  | | own text | + level 1 (same form and stated strength) | + level 2 (same form class) | none |
  |---|---:|---:|---:|---:|
  | all positions | 267 374 = **44.3 %** | 88.9 % | **97.4 %** | 15 752 (2.6 %) |
  | ЖНВЛП positions (345 837) | 42.2 % | 94.3 % | 99.0 % | 3 519 |
  | trade name × МНН units (12 038) | 55.8 % | 83.0 % | 89.2 % | 1 296 |
  | registrations (29 300) | 12 897 = 44.0 % | + 10 869 | + 3 311 | 2 223 |

  Versus MED2's estimate (43.7 % → 94.3 % same СМНН node / 97.3 % same form class): without M1 the same method gives 43.7 % own, 95.1 %
  node-equivalent and 97.3 % form-class-equivalent (the 0.8-point gap to 94.3 % is unreconciled: positions listed under several
  registrations), so the estimate holds. The shipped level 1 is stricter than «same node»: 6 points of positions sit in groups whose
  strength the registry does not state (14 % of trade entries) and are level 2 with a warning, which is why level 1 alone is 88.9 %.
  Level 2 first donors: unstated strength 2 173 registrations, different strength 456, other form wording 322, wording and strength
  231, wording and unstated strength 129. МНН cards: 2 395 of 3 324 have a text somewhere; the other 929 have no registration with a
  text, so nothing can be shown for them (nothing crosses an МНН).
- **Verified:** pytest (matching), vitest (`instruction-fallback`, `instruction-source`, `medication-record`), e2e
  `apps/app/e2e/medication-instruction-fallback.spec.ts` on a real build with the real antiparasitic ЕСКЛП module and GRLS instruction module
  (level 1 Албендазол-Эдвансд, level 2 Гельминтокс with its warning, own text Вермокс without a block; screenshots in
  `output/med3-screens/`, light and dark, 390 px). The real M1 module was read with the app's own functions (272 documents, 240
  registrations indexed, 213 / 47 / 16 registration-document pairs by match level).
- **Not verified:** Android/WebView and slow devices; the M1 module installed in a browser profile (its drug-screen wording was checked
  on the real module's metadata only); clinical suitability of any donor text (that is the label's job, not a check); search ranking
  with the M1 module mounted; the fallback asset's refresh after the next collector window (manual rebuild step).

## Exact lookup (S2) — 2026-10-05

- Lexical lookup no longer matches a short query word inside a longer one («боли» → `Болиголов`), drops
  groups that share only form/audience/meta words with the query, prefers documents with every subject
  word, and finds «Вирусные менингиты у детей» for «менингит у ребёнка» (rules in `docs/SEARCH.md`).
  Measured: `benchmark:doctor-lookup` R@5 0.7 → 0.9, MRR 0.65 → 0.85; `benchmark:real:release` lookup
  R@1 0.803, R@5 0.934, MRR 0.855 → 0.852 (unchanged within tolerance, no re-baseline).
- Left: the release set is mostly narrative clinical phrasing (clinical path); its misses come from
  the intent branch («лечить», «терапия») matching ICD Z-codes when the subject is lost to a negation
  span, and need the clinical parser. Indication queries («от давления») need the semantic path (E3).

## Release 0.6.47 — 2026-10-02

- Ships core 0.6.47 (no pilot; 30 new КР editions, replaced editions point to successors), the
  КР refresh to the 2026-10-02 rubricator, the reader edition notice, НСИ ATC names and the FIX1
  fixes. Release ratchet passes on the full databases (lookup R@1 0.803, R@5 0.934).
- Verified: `bun run verify`, 27 targeted browser E2E tests, emulator clean install with the new
  core (metered-network consent → gzip download → ready).
- Known: the «Препараты» catalog is empty until a medication module is installed (pilot drug
  cards left the core).

## Release 0.6.46 — 2026-10-02

- Ships the smooth start-up, guided onboarding, drug screen, motion settings and the compressed
  module distribution (ЕСКЛП ×15 and КР ×744 as framed zstd from the dataset mirror branches,
  `minAppVersion` 0.6.46; kras/МКБ/РЛС-упаковки zstd gated to 0.6.45; Android core as gzip).
- Verified: `bun run verify`, 23 targeted browser E2E tests, emulator clean install (core gzip
  download → search; КР and ЕСКЛП zstd modules installed from the real mirror and opened).
- Known limitation at release time (resolved 2026-10-02, see «Pilot corpus retired»):
  `benchmark:real:release` reported `pilot.sectionRecall` 0.836 against 0.869; v0.6.45 measured the
  same, so the drop predated this release.
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
  runtime-ready Whisper model through `asr-models`. The «Мои файлы» step and the tour's imaging
  slide cycle six sagittal head-MRI frames captured from MiniMed's own viewer on the downloadable
  MRI example (`public/onboarding/mri-viewer`, provenance in its SOURCES.md; 2026-10-05, replacing
  the drawn demo and the OpenNeuro axial slices). The tour dialog «Что умеет MiniMed» had lost its
  stylesheet with the old first-run modal (0.6.46) and has it again.
- Dismissal is unchanged: `dismissSetup()` runs only when the core is installed (at the end of the
  tour or when it arrives later); otherwise the tour hides for the session and returns next launch.
  `restartOnboarding()` (`onboarding-state.ts`) runs it again; Settings needs a button for it.
- Verified in headless Chromium at 390 and 1280 px (light, dark, reduced motion, animations off,
  core ready / downloading / failing; dark theme re-checked step by step) and by `e2e/onboarding.spec.ts`; not verified on a physical
  Android device or WebView build (View Transitions there).

### Onboarding polish (UX5) — 2026-10-05

- The intro no longer advances by timer: «Привет» (logo) → «Далее» → short text about the app →
  «Далее» → core screen → «Далее» → tour (`IntroPhase`: `wait | hello | welcome | core`). The core
  download starts only on that second «Далее» (`holdCoreStart()` in `setup-state.ts`, set in
  `App.tsx` when the onboarding will open, released by the onboarding on `core`/tour/done/unmount;
  `use-app-session` awaits `whenCoreStartReleased()` before asking for consent). The progress line is
  hidden until then. The core screen plays the icon: vector documents (`OnboardingDocuments`) leave
  the wallet, it fades, three sheets drift, the middle one higher (transform/opacity only; reduced
  motion = static triplet).
- The «notification over the button» was the wide metered-connection caption of the progress line
  («Мобильная сеть: загрузка ядра около …» + «Скачать», centred above the navigation, z-index above the
  tour): while the onboarding is open it is a compact pill in the bottom corner (`compact`), the tour
  card keeps a 44 px strip clear of it, the intro footer sits above it. Toasts slip under the tour
  (`:root[data-onboarding]`); the speech-model failure shows inside the card.
- Tour card respects the safe area (`safe-insets.ts`), falls back to a tighter arrow gap and scrolls the
  page (`scrollDeltaToFit`) when neither side has room; the arrow ends `ARROW_OUTSET` from the control,
  clear of the ring; `data-tour` slides are re-revealed (900 ms) after the carousel restores itself.
  Tour body padding stops the buttons' shadows being cut square. «Мои файлы»: the list is a collapsed
  accordion (`bulletsSummary`), the MRI source is behind a «?» (`MriSliceViewer variant="badge"`).
- Home «Полезные функции» (`components/Carousel`): 12 px gap, scroll-driven scale/opacity on slides
  (`animation-timeline: view(inline)`, snaps without support), arrows moved under the slides beside the
  dots (no longer clipped), autoplay paused while the onboarding is on screen.
- Not verified on the Android emulator, a physical phone or HyperOS WebView.

### Home polish 2 (UX7) — 2026-10-05

- **Carousel scroll**: the track no longer reads layout per scroll event (stride cached on width change,
  passive listener + one rAF, signal only when the slide changes), the resize observer reacts to width
  only, `will-change` is set on the slide frames only while the track moves. On native Android the
  scroll-driven scale/fade is off (`carousel__frame--plain`). Desktop headless, 4x CPU, 6 touch swipes:
  scroll-event dispatch 604 ms to 227-316 ms, FunctionCall 1264 to ~800 ms, one 259 ms long task to none;
  desktop was already 120 fps, so the Android-WebView gain is not measured (the shared emulator was
  taken by other agents).
- **First-tap stall (root cause of «hard re-render» on opening a section)**: the first UI sound built
  the `AudioContext` (~205 ms) inside the tap. `uiSounds.warmUp()` now preloads the common cues in idle
  time 1.5 s after start (`installUiFeedback`). Opening a section: longest task 428 ms to 85 ms.
- **Open section = page**: `#/search/section/<id>` (entry pushed with `history.state.searchSection`,
  replaced on section switch). Back arrow, system/Android back and `Escape` return to the list, which
  stays mounted and gets its scroll back (`restoreScroll` retries while the page is laid out);
  the section starts at the top with a 220 ms slide/fade (transform + opacity, `backwards` fill).
  `SearchWorkspace` leaves list/section scroll to `SearchHome`. A group of «Все источники» has no address.
- **«Примеры поиска» arrows**: centred on the chips row (`--example-pad-*` variables), row clips sideways
  only so chip and arrow shadows are not cut; e2e checks centre within 2 px and corner hit-tests.
- **«ЭКГ по фото»**: the tool route has no description page any more; the editor is the route.
  Closing it (`leaveTool`) replaces the route's history entry with the recorded origin (search page for a
  deep link), re-entering reopens it, closing «Готовые измерения» returns to the editor (a button on step 1
  opens them). Inline use keeps the small launcher. The home «?» opens the editor's first step.
- **Context menu**: an item with no actions has a disabled trigger (no menu on long press or right click,
  the event reaches the page menu) and no «⋯» button.
- **«Клинический разбор»**: a note above the results (`ClinicalAnalysisNote`) and an explanatory
  placeholder. **«Скрыть»** on «Полезные функции» stores `usefulFeaturesHidden` in app-preferences; a quiet
  «Показать полезные функции» link at the end of the home restores it (Settings toggle left to SET1).
- Tests: `ux7-home`, `ecg-close`, `empty-context-menu` e2e, `search-section-route`, `ui-sounds`,
  `app-preferences` units. Not tested: Android WebView frame rate, physical device.

### Tools, tour, recording activity and button depth (UX6) — 2026-10-05

- **«Все инструменты»** lists only real app features (`APP_TOOL_IDS`, `quick-tools.ts`): «Запись беседы»,
  «ЭКГ по фото» (id `ecg-photo-caliper`), «Формы» (`#/notes/forms`), «Заметки», «Просмотр снимков»,
  «Калькуляторы» (+ the experimental dictionary). Calculators and questionnaires are starred from
  their own pages (star on every calculator and questionnaire card, same `item-collections`
  favourites as before, shown in the quick row). Patients/questionnaires entries are no longer
  listed but still resolve for stars from older versions. `QuickTool.dropFiles` makes a tool row a drop
  target (data, not an id check).
- **«Просмотр снимков»**: an empty state (`ImagingViewerEntry`) with «Открыть из моих файлов» (DICOM and
  NIfTI already in the library), «Открыть новый файл» (`userLibraryFileAccept()`, imports into
  «Исследования») and a drop target; a file dropped on the tool row imports and opens directly.
- **Home «Полезные функции»** no longer repeats header actions (graph card removed; ECG, imaging,
  recording stay). The imaging card and the tour's imaging slide offer «Открыть пример МРТ» when the
  example is already in the library, otherwise a link to «Исследования»; nothing downloads from them.
- **«Что умеет MiniMed»**: every slide has a navigation action (search, patients, record, notes,
  research folder / MRI example, calculators + questionnaires); navigating closes the dialog; the dialog
  clips (`overflow-x: clip`, `contain: inline-size`) instead of letting the track widen it.
- **Search page**: «Все инструменты» is a primary button (icon takes the label colour), pinned tools are
  raised secondary buttons, «?» is a `ui-button`; while a section is open with an empty field the history
  button becomes a «Назад к разделам» arrow (Escape and Android back do the same via `[data-search-back]`).
  Scroll rows (quick access, examples, carousel) carry padding with a compensating negative margin so
  hover shadows are not clipped.
- **Recording activity**: the bar «Идёт запись беседы» (time, level meter) opens a window built on the
  `.floating-window` frame with a full-screen toggle, live text, a note when no speech model is loaded, and
  «Стоп»; it lives in `ConversationRecorderHost`, so it survives tab switches. Live text
  (`live-transcription.ts`) recognises the newest 6–28 s of the in-memory recording with the loaded browser
  Whisper model every 7 s, skips silence, stays in memory, is cleared on stop and never logged. Not saved
  into the patient record (only the audio is). No model: timer and meter only.
- **Button depth** (`--theme-primary-*` tokens in `theme.css`/`theme-dark.css`, `Button.css`,
  `primary-depth.css`): hover = lighter face, bright top edge, larger shadow; press = inset shadow and the
  label sinks. **No control transforms on hover or press** (a moving box slides from under the pointer at its
  edge, ends the hover and loops, replaying the hover sound): the global `button:hover` lift, card lifts and tilt
  were replaced by shadow-only states; `UiSoundController.hover` also ignores a re-entry of the same control within
  400 ms. Reduced motion: no transitions, states still visible.
- Viewer keyboard hints are keycaps outside the icon (`data-shortcut`, hidden on touch).
- Range sliders share one style (`RangeSlider`, separate commit) and the search loading skeleton matches the result
  groups (separate commit).
- Not verified: live text with a real Russian speech model on a device; Android hardware back for the section
  arrow; physical touch devices; Firefox/Safari.

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

## МКБ-11 (ВОЗ) as an optional separate module — 2026-10-06 (ICD11)

Owner decision 2026-10-05: МКБ-11 may be a separate pack, Russia uses МКБ-10. Source and licence
findings, the Russian status and what the public files lack are in
`docs/research/icd11-2026-10-05.md`. Summary: WHO publishes the MMS **Russian** linearization
(release 2026-01) and the ICD-10↔ICD-11 mapping tables as public downloads (no account); licence
CC BY-ND 3.0 IGO; the public file has titles, hierarchy and coding notes but **no definitions,
inclusions, exclusions or index terms** (ICD-API only; added in 2026.10.6, see below); Russian has no
official status (Минздрав suspended the transition 2024-02).

- **Numbers** (2026.10.6): 37 052 documents (28 chapters, 1 360 blocks, 35 664 categories), 1 494 titles without a
  Russian translation in WHO's file (English kept, marked), 633 coding notes (+246 residual rows with the API's note);
  55 078 sections, 56 720 chunks; **47.7 MB download, 261.7 MB installed** (2026.10.5: 76.3 / 479 MB);
  release asset `reference-icd11-2026.10.6` (pre-release), catalog preview entry updated (no per-document table:
  no core pointer targets it).
- **Module** `minimed.reference.icd11.ru`, collection `icd11`, title «МКБ-11 (ВОЗ), справочно; в РФ
  действует МКБ-10», `preview`, `minAppVersion` 0.6.51. Never replaces or mixes with МКБ-10 (own id,
  collection, document prefix `who.icd11.mms.`, source type `who_icd11_reference`, none of
  `mkbCode`/`icd10Codes`/`entityType`; the packager refuses a document with one).
- **Pipeline** (`bun run content:fetch:icd11`, `bun run content:module:icd11`):
  `medbase fetch-icd11` (SHA-256 manifest in `data/raw/icd11/<release>/MANIFEST.json`) →
  `prepare-icd11` (one Markdown document per WHO row; every paragraph carries a `localmed:source`
  marker with the entity's browser URL and the raw file line / mapping rows) → `build` →
  `package-icd11` → `scripts/upsert-catalog-module.ts`. Ids are WHO linearization ids (residual rows
  `…/other`, `…/unspecified` keep their own). A title WHO has not translated stays WHO's English
  title and the card says so; nothing is translated or generated.
- **Mapping tables** (WHO's own, unchanged): ICD-11 → closest ICD-10, ICD-10 → ICD-11 (one and several
  categories), cluster targets such as `A00.0 → 1A00&XN8P1` shown as text with the extension titles
  (the only postcoordination data in the public files). ICD-10 links open the МКБ-10 card only when
  that exact card exists in the МКБ-10 module (`rls.mkb.node.<code>`), otherwise the code is plain
  text. WHO's redistribution terms for the mapping tables are not explicit (the licence puts
  crosswalks outside the classification licence): recorded as an owner publication decision.
- **App**: `apps/app/src/features/icd11/` (`icd11-document.ts`, `Icd11CardPanel`); ICD-11 documents are
  searched only in «Все источники» (`documentMatchesSearchScope`), dropped from the whole-core
  «Клинический разбор» scope, absent from the МКБ/состояния section, the condition catalog and the
  inline term links, ordered last in the home catalog and counted outside the «Ядро» card;
  result cards carry the label «МКБ-11 (ВОЗ), справочно», the card title ends «МКБ-11 (ВОЗ)», and the
  reader shows the practice note («В Российской Федерации действует МКБ-10…»), WHO hierarchy as
  links, children and the crosswalk; the modules page lists it in its own «МКБ-11 (ВОЗ), справочно»
  card, not under «Нормы и расчёты» or «Заболевания и состояния», so no section download queues it.
- **ICD-API text (owner decisions 2026-10-06, `docs/research/icd11-2026-10-05.md`)**: WHO's local container
  `whoicd/icd-api` (`acceptLicense=true`, `include=2026-01_ru`, loopback only, analytics off) is run once by
  `bun run content:fetch:icd11-api` (`medbase fetch-icd11-api`; refuses a non-loopback URL); the 37 052 raw answers are
  cached unchanged in `data/raw/icd11/2026-01/api/mms-ru.zip` with a SHA-256 manifest (image digest, data release,
  per-entity checksums). `prepare-icd11` merges them: definitions (7 990 cards), long definitions (665), fully specified
  names (89), inclusions (1 515 cards), exclusions (2 535), index terms (14 419) and «children elsewhere» (1 669).
  The container tags English fallback as `"@language":"ru"` with `[No translation available]` (or unmarked English):
  such text is **omitted** and counted (76 definitions, 6 252 index terms, 23 exclusions, …), WHO's
  `[possible translation]` strings are kept with a visible note; nothing is translated or substituted. The ICD-10 ↔ ICD-11
  crosswalk tables stay (owner publication decision).
- **Size reduction**: one «Рубрика МКБ-11» section per card (+ the crosswalk), hierarchy/children kept as metadata links only,
  crosswalk text without English ICD-10 titles (kept in metadata), compact source spans and per-document metadata
  (`rawSources` checksums in the release report). Remaining lever, not done: ancestor/child titles by id in the panel.
- **Not done**: exclusion/inclusion link targets and postcoordination axes (in the raw cache, not carried), a dedicated ICD-11 search section and ICD-10 → ICD-11 links on the МКБ-10 cards (they would
  need `SearchWorkspace`/`contracts`, owned by other tasks), a zstd-framed re-pack (gzip transport only).
- Tests: `tools/ingest/tests/test_icd11_prepare.py`, unit (`icd11-document`, `ScopedMedicalCore`,
  `homeDocumentOrder`, `overview-document-counts`), `apps/app/e2e/icd11-module.spec.ts` (installs the
  module from the local release bytes, skipped when they are absent).

## Known limits


- Clinical starter documents are concise source-linked cards; the separately installable snapshot
  contains the official structured recommendation text, headings, tables, and embedded figures.
- The selected oseltamivir instruction still requires reviewed OCR; the clinical recommendation
  snapshot no longer depends on PDF OCR.
- Text-layer drug PDFs can still lose visually distinct subheadings that use the same font size as
  body text. Preserved layout metadata prevents list continuations from absorbing adjacent text, but
  complex layouts still require reviewed structure extraction before publication.
- The PDF reader is the shared viewer (see «Shared PDF viewer»): page rasterization is bounded
  (2.5 MP per page, 24 MB in total), off-screen renders are cancelled and inactive canvases released;
  a 160-page Android stress scroll completed without a WebView crash earlier, the new queue/budget
  and sliced text layer were measured only in headless Chromium — a physical-phone qualification is
  still open.
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
  instruction pilot builds are samples; since 0.6.48 the collected official instructions ship as 15 group modules
  (43 % of ЕСКЛП registrations, see «Official ГРЛС instructions … (GI1)»). There is no released
  deterministic linker yet from exact terms inside instructions (for example, `синдром Жильбера`) to
  stable local condition cards, and ambiguous abbreviations are not context-disambiguated.
- The published corpus has official ГРЛС instruction texts for 43 % of ЕСКЛП registrations (a part of them OCR, flagged), but
  still lacks complete verified drug instructions, legal/normative material,
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
10. Medical news and research feed: user subscriptions to RSS/Atom/JSON Feed and websites shipped as
    the «Лента» tab (ADR-0024, NEWS1, section below). The research-API layer (PubMed, Europe PMC,
    OpenAlex, ClinicalTrials.gov; ADR-0020) is still plan only.

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
5. (Done 2026-10-02) the corrupt `hard-medical-queries-1500` fixture was removed, not regenerated; see
   `tools/benchmarks/HARD_BENCHMARK.md`.

### Drug chips, fold button and the ATC group tree — 2026-10-04 (STATE UX4)

- Drug screen: the fold button of trade-name/analogue/group lists is `.drug-links__toggle`, a tinted
  borderless pill with an `AppGlyph` `caret-down` that turns 180° on open (`aria-expanded`,
  `aria-controls`, Russian plural labels unchanged). Chips are one type step smaller (0.875rem),
  tighter (0.625rem side padding, 0.375rem gaps, 40 px minimum height) and the country «(Россия)» is
  muted, 0.8em and never splits from its brackets; two chips usually fit a row at 360–390 px.
- «Препараты» has a view switch «Список | По группам АТХ» (`SegmentedControl`, state in the hash):
  `#/modules/documents/medications/atc` (14 groups) and `…/atc/<code>` for levels 1–4 (`N`, `N06`,
  `N06B`, `N06BX`) or `none` (substances without an ATC code). The registration-number legacy route
  no longer swallows `atc`; browser back climbs the tree, the header back button goes one level up
  (`knowledgeDocumentBackHash`).
- `atc-tree.ts` (pure, tested) places the installed ЕСКЛП МНН documents under the levels of their
  normalised ATC codes (`drugAtcCodes`, Cyrillic look-alikes fixed), counts distinct substances per
  node («12 веществ», «3 подгруппы») and names levels 1–4 from the NSI dictionary
  (`atc-names.json`, lazy; taxonomy headings as fallback for level 1). Levels the dictionary does
  not name show «Группа <код>». `MedicationAtcTree.tsx` + `medication-atc-tree.css` are a lazy chunk
  of `MedicationCatalogView`; substance lists use `LayoutVirtualizedGrid`; each level fades in.
- Level-1 groups without substances show the package size and «Скачать · 9,3 МБ» for their ЕСКЛП module
  (`atc-group-package.ts` over `useDrugDownload`, now exposing `installedIds`/`tasks` and
  `start(modules?)`; the same queue and progress mark as the catalog button); the subtree appears
  once the module is installed and the catalog reloads. «Скачать все группы» queues the rest.
  Group → module map is `atcLevelOneGroups` (checked against the release catalog in a test).
- Not covered: the unclassified and Allmed packages have no group of their own (only the synthetic
  `none` group when installed substances lack a code); no search inside the tree. E2E:
  `apps/app/e2e/medication-atc-tree.spec.ts` (antiparasitic module, needs the local zstd copy).

### «Лента»: opt-in news feed and site viewer — 2026-10-05 (STATE NEWS1, ADR-0024)

Owner decision: a fourth bottom tab «Лента» (Поиск · Файлы · Лента · Настройки; in the six-section
layout it sits before «Настройки») with the unread count on the tab icon (`app-nav-badge--news`,
read from localStorage only). Everything is in `apps/app/src/features/news/`, CSS `styles/news.css`
(lazy with the tab) and `styles/news-badge.css` (start-up).

- **Network is opt-in.** No request is made until a source is added; suggested sources are offered
  (`suggested-feeds.json`, data not code), never auto-subscribed. Refresh on opening the tab (only
  feeds older than 15 min) and on the refresh button; no background polling. Offline the tab shows
  the cache with the last fetch time; a failing source keeps its items and shows its own error.
- **Transport port** (`news-transport.ts`): Android uses `CapacitorHttp` (core, no plugin, no config
  change; no CORS; base64 body decoded with the declared charset; redirects followed by the app;
  ETag/Last-Modified sent); the web build uses `fetch` and reports a CORS refusal honestly («Этот
  источник не разрешает чтение из браузера — откройте в приложении для Android или как сайт») with an
  «Добавить как сайт» fallback. No CORS proxy. Limits: 15 s, 6 MB, 100 items per fetch.
- **Parsing** (`markup.ts`, `feed-parser.ts`): RSS 2.0, RSS 1.0/RDF (NEJM, Lancet, Nature), Atom,
  JSON Feed; a small tolerant tokenizer instead of `DOMParser` (no DOM in the unit runner, malformed
  feeds, no entity expansion — reasons in ADR-0024). Page feed discovery reads
  `<link rel="alternate" type="application/rss+xml|atom+xml|feed+json">` only; no path guessing.
- **Sanitization** (`feed-content.ts`, `NewsRichText.tsx`): item HTML becomes a tree of allow-listed
  elements rendered by element creation (no `innerHTML`); remote images only when «Изображения» is on
  for that source; links `target=_blank rel="noopener noreferrer"`, no referrer.
- **Storage** (`news-storage.ts`): subscriptions in localStorage (`minimed.news.subscriptions.v1`),
  items in IndexedDB `minimed-news` (≤ 200 per feed, ≤ 30 days; memory fallback). First fetch marks
  only the last 3 days unread. OPML 2.0 export (system share/download) and import in «Источники».
- **UI**: list grouped by day (Сегодня/Вчера/date) with source, time, title, snippet and unread dot,
  filter chips per source with counts, «Отметить всё прочитанным», sites strip, empty state with the
  suggested sources, add page (paste address: feed → preview and «Подписаться»; page → declared feeds
  or «Добавить как сайт»), sources page (rename, images on/off, remove with confirmation, OPML).
  Routes: `#/news`, `/add`, `/sources`, `/item/<id>`, `/site/<id>`; `newsParentHash` makes Android
  Back close the viewer, then the sub-pages, then return to search (`native-back.test.ts`).
- **Viewer** (`NewsViewer.tsx`, `framing-policy.ts`): «Из ленты» (offline text) / «Страница»
  (`<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">`, no
  `allow-same-origin`, `referrerpolicy=no-referrer`), address line, «Открыть в браузере». Framing
  refusal is read from `X-Frame-Options`/CSP `frame-ancestors` where headers are readable (Android,
  CORS-open hosts) and otherwise caught by a 12 s load timeout plus a standing hint.

Suggested sources, verified by fetching and parsing with the app's own parser on 2026-10-05
(`webReadable` = host sent `Access-Control-Allow-Origin` for `https://t-damer.github.io`; Android
reads all of them):

| Source | Format | Items | Browser build |
| --- | --- | --- | --- |
| Росздравнадзор — новости | RSS 2.0 (every item twice; deduplicated) | 10 | blocked (CORS) |
| ВОЗ — новости (на русском) | RSS 2.0 | 25 | readable |
| Фармвестник — новости | RSS 2.0 | 30 | blocked |
| Медицинская газета | RSS 2.0 | 10 | blocked |
| MedPortal — новости медицины | RSS 2.0 | 100 | readable |
| ДокторПитер | RSS 2.0 | 100 | readable |
| NEJM — свежий выпуск | RSS 1.0 (RDF) | 52 | blocked |
| The Lancet — новые статьи | RSS 1.0 (RDF) | 55 | blocked |
| Nature Medicine | RSS 1.0 (RDF) | 8 | blocked |
| PLOS Medicine | Atom | 30 | blocked |
| FDA MedWatch | RSS 2.0 | 20 | blocked |
| MedPage Today | RSS 2.0 | 20 | readable |
| STAT | RSS 2.0 | 20 | blocked |
| Medical Xpress | RSS 2.0 | 30 | blocked |

Left out on purpose: Минздрав (no feed; the site is not reachable without the Russian root CA),
Медвестник (no feed), Лечащий врач (feed without items), WHO English (newest item from February),
BMJ (redirects to http-only `feeds.bmj.com`: mixed content in the browser, cleartext on Android),
JAMA (bot challenge for non-browser clients), RIA/TASS (general news, not medical), Medscape (the
public feed found is the nurses' one).

Framing of article pages (HEAD with a browser User-Agent, 2026-10-05): refused by Росздравнадзор,
Медицинская газета, ДокторПитер, WHO, NEJM, The Lancet, Nature, PLOS, FDA, STAT, Medical Xpress,
PubMed, Vidal, КР Минздрава, BMJ and JAMA (`X-Frame-Options: SAMEORIGIN`/`DENY`, WHO and STAT also
`frame-ancestors`); allowed by Фармвестник, MedPortal, Медвестник, RLS and Wikipedia; unknown
(HEAD refused or bot-blocked) for MedPage Today, CyberLeninka and Cochrane Library. Most medical
publishers therefore need «Открыть в браузере» or the feed's own text.

Not verified: a physical device or the Android emulator (shared, not touched): `CapacitorHttp`
against the real feeds, system-browser hand-off from the viewer, and whether Android lets an external
`<iframe src>` load inside the frame (see ADR-0024). The Vite dev/preview servers are cross-origin
isolated, so real sites cannot be framed there; the e2e fixtures send the opt-in headers.
Tests: unit (`features/news/*.test.ts`: parsing of every format, malformed and oversized input,
sanitizer attacks, merge/retention/unread, URL detection, transport, framing policy, OPML, routes,
service) and `apps/app/e2e/news-feed.spec.ts` (empty tab makes no request, add by address, offline
cache, unread badge, viewer sandbox, framing-refused and never-loading fallbacks, CORS message,
images switch, suggested source, rename/remove).
