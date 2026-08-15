# Current state

> Updated: 15 August 2026
> Repository version: `0.6.19`
> Active target: `0.6.19` public prerelease toward `1.0`

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
- Search is hidden until the user selects a scope; scopes with no installed documents are disabled.
- Query analysis and deterministic retrieval run in a Web Worker, and long result sets are window
  virtualized.
- Results are grouped by document and window-virtualized; compact result cards show numbered matches,
  source/category metadata, up to four snippet lines, and open the exact fragment without expanding
  the result group.
- Document readers keep the outline control in the fixed dialog header; desktop outline changes are
  animated, mobile outline changes are immediate, and scrolling pins the current section heading,
  marks its outline entry, and keeps that entry centered.
- Search-result context remaps stale pilot-summary chunks to installed full-text siblings and falls back
  to the readable document when an exact chunk cannot be resolved.
- Within-document ranking uses query intent to prefer the relevant diagnostic, routing, or treatment
  section; the public benchmark currently has perfect section retrieval and top-section accuracy.
- Search scopes cover diagnosis support, clinical recommendations, medications, legal documents, and
  deterministic search across all installed sources.
- Only diagnosis scope may call the optional grounded local-model wrapper; the other scopes constrain
  deterministic retrieval by installed source type.
- A realistic pediatric workflow query — `Цефтриаксон ребенку 3 лет вес 20 кг при пневмонии как
  второй антибиотик` — is part of the retrieval benchmark.

### Browser workspace

- Five primary sections use a compact bottom navigation with a floating glass bubble that follows the
  selected item and horizontal pointer/touch swipes, stretching with drag velocity and compressing
  into the bar edge when the pointer is pulled outside it. Root navigation commits immediately; the incoming
  view overlays the stationary outgoing view with a strictly horizontal CSS slide and temporary page
  shadow, without an opacity transition, while the status-bar blur remains between the old and new views.
  The bottom navigation remains fixed and interactive. Rapid tab changes
  do not wait on View Transition snapshots; document, note, and local-model subroutes remain instant. The
  scroll-to-top control
  reserves the bottom-navigation band on long pages, and the notes add control mounts only while the
  notes root is active.
- Root navigation snapshots the route that was left, not the already-updated hash, so returning from a
  questionnaire or nested tool restores the same Documents subroute. Restored scroll positions are
  applied immediately, and route surfaces extend below the navigation band instead of exposing the desk
  background at the end of the page.
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
  beside extracted facts as a compact category inside the analysis details.
- The paper/archive design uses one top-level semantic color palette in light and dark modes, a
  shared 65-character page measure, compact cards, controls, result rows, responsive spacing, and
  consistent hover/focus feedback for cards, buttons, and fields. Warm page surfaces share a reusable
  low-opacity fine fractal-grain layer; sticky blur uses a coarser variant, while cards and text remain
  untextured. The document uses one
  native page scrollbar without a second application-owned scroller.
- Reusable view components now own confirmation dialogs, horizontal search examples, module cards,
  and module task states; their parent pages retain routing, persistence, and orchestration.
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
- The knowledge-base overview reports the model and corpus state, then opens dedicated document and
  model subroutes without mixing every document family into one long page.
- The document overview exposes five entry cards: medications, norms and calculations, laws and
  regulations, clinical recommendations, and the built-in core. The legacy clinical-pediatrics
  collection is represented by the recommendation sections instead of a duplicate top-level card.
  Drilldown exposes two-column module collections with user-facing release states and inspectable
  document lists, all 21 recommendation sections without an extra reveal step, full-document opening,
  bulk download, background update pause, rollback to retained older versions, and nested URLs for
  opened collections and sections.
- The medications catalog reads medication metadata from document summaries in bounded batches and
  coalesces concurrent summary reads, so direct and navigated catalog routes avoid materializing
  every document's sections/chunks on the main thread.
- Document catalog routes share one route-bounded search field: the query filters only the currently
  opened collection, category, or catalog page, and the recommendations search remains in its sticky
  route header.
- Medication catalog cards use a responsive two-column layout and live rendering so progressive
  batches populate both columns; its route header uses the shared compact catalog search field.
- Medication detail source cards stay within the readable 65ch column, keep all source text mounted,
  and provide exact-match highlighting/count/navigation while the medication heading and section
  headings remain sticky with JS-measured stacked offsets and one shared masked blur layer.
- The personal notes index has local full-text filtering, and Ctrl/Cmd+F focuses the first visible
  app search field without opening the browser find bar.
- Search history and diagnostic help controls share one sticky top toolbar on the search home, with
  the menu on the left and `?` on the right aligned by `justify-content: space-between`.
- Search, module-catalog, medication-catalog, and document-outline sticky headers use transparent,
  page-width masked backdrop blur with a subtle grain layer that stays hidden until the header is
  actually stuck; outgoing root views isolate their fixed overlays below the incoming navigation surface.
- The diagnosis search actions expose the local-model control on the left; it toggles a ready model
  and opens `modules/model` when the model is not loaded yet.
- GitHub release links use a rolling `android-latest` APK asset, and the search history drawer shows
  text links to the repository and current Android build at its bottom.
- The document library uses a virtualized full-width list; the embedded core view exposes only the
  list/map controls, with the graph opened in a modal. Product routes expose the source document title,
  outline, and readable sections inline alongside the selected package details.
- Allmed reference preparation converts known HTML fragments in medication sections and production
  metadata to readable Markdown while preserving the source SQLite snapshot unchanged.
- Assessment tests and medical calculators are grouped into downloadable sections. Catalog cards show
  what is on the device, calculator catalog search uses the shared icon field and Ctrl/Cmd+F focus
  target, section cards show an explicit disabled state for unavailable tools and allow individual
  calculator downloads with confirmation, direct tool routes explain which section is missing, and
  installed tools keep specialty section cards open dedicated sub-routes containing the full grid.
  Schema calculators support staged inputs via `step`/`stepRequired`; the fluids section includes a
  two-stage paediatric ORS calculator that adds measured vomiting and stool episodes to the base plan.
  Installed tools keep their offline-use state across reloads. Incomplete assessment attempts are
  also stored in the existing device-local results store, restored by their history entry with an
  `incomplete` tag and answered-count, and replaced by the completed result when submitted.
- The obstetrics/gynecology calculator catalog now covers the full ObCalc list: EDD/gestational-age
  tools, fetal growth and Doppler indices, maternal/Rudakov fetal-weight estimates, both Grobman
  VBAC models, NCI Gail/BCRAT breast-risk estimation, and an ASCCP cervical-screening pathway band.
  All are offline schema-driven calculators with cited formulas and explicit population/limitation
  text; ASCCP is intentionally a route band rather than a fabricated absolute cancer-risk percentage.
- Module and model downloads share retry/backoff and resumable partial bytes, but use independent
  network lanes: up to three document installs run concurrently while additional documents remain
  queued, and the selected model always receives its own download slot. A single document runtime
  survives catalog refreshes; transient failures release their slot before an automatic retry so one
  broken source cannot starve the queue.
- The knowledge graph remains interactive during hover/focus and visually distinguishes clinical,
  medication, legal, and personal-note sources; its canvas supports wheel zoom, pan, and two-finger
  pinch zoom on touch devices.
- Model settings distinguish always-available offline search from the optional local model and expose
  model size, requirements, advantages, limitations, and model selection.
- Browser application updates install in the background but wait for explicit approval in the shared
  floating system-status area before the new service worker activates and reloads the page. Android
  checks the latest GitHub release and downloads a newer APK through a native Capacitor bridge before
  handing it to the system installer.
- The paper workspace follows the device light/dark preference without adding an application toggle.
- Shared `Button` and `Card` primitives cover new tool/module surfaces; card readers open from the
  whole card, destructive actions use confirmation dialogs, and icon-only trash controls keep secondary
  actions compact; set-level destructive actions use explicit text and red danger treatment. Modal state
  adds one navigator-history entry so Back closes the active modal first.
- Assessment methodology and calculator formula/limitation details use dialogs instead of primary-page
  accordions. Patient names are suggested from locally stored patient cards, and external/manual test
  results can be saved into the same local result history.
- Vertical mouse-wheel delta is translated into horizontal movement for the shared overflowing-strip
  component, including mixed diagonal wheel input; touch and trackpad scrolling remain native.
- Android draws the page background beneath its transparent status bar while safe-area padding keeps
  controls below it; a native-only transparent masked backdrop-blur layer blends the page behind the
  status bar, and system-bar icon contrast follows the device theme. Hardware Back closes the
  active dialog or drawer, returns through nested routes and root sections, then minimizes the app at
  the search root. Standard WebView vibration supplies light, medium, and heavy feedback for controls,
  primary navigation, and destructive actions without another native plugin.
- Native print actions use an in-app preview with a non-printing Back header, so Android does not leave
  the application for a browser tab and hardware Back can exit the preview.
- Capacitor Haptics supplies native light/medium/heavy impact feedback, with Web Vibration as the
  browser fallback.
- Installed-content changes re-run the active query without clearing the visible results and announce
  the refresh state.
- Diagnosis mode includes a visible explanation that local model output can be wrong, must remain
  source-grounded, and does not replace clinical responsibility.
- The landing page and browser app are built together for GitHub Pages; the application is published
  below the site at `/app/`.
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
  scrollable row with explicit previous/next controls.
- Personal matches appear in search with an explicit personal-source label and outside the official
  result container, so they cannot be mistaken for installed medical content.
- Document text links installed medications, recommendations, and laws into nested reader dialogs.
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
- The bundled `medications.db` vertical pilot contains one current Miramistin GRLS registration,
  eight official package variants, the complete official patient leaflet, six traceable entities,
  seven proposed relations, and four document links. The app exposes the same database through the
  medication catalog, product detail route, document reader, catalog search, and main medication
  search. Medication-indication queries prefer the full instruction and its treatment sections over
  the registry identity card. The reader reconstructs bullet and numbered lists from their preserved
  PDF markers and source-block indentation.
- Optional local-dev `mkb.db` companion (`minimed.mkb.ru`) contains the full RLS MKB index (9,841
  nodes) plus the default `I67.9` detail page, 138 grouped trade-name cards, 4,956 unique MNN/form/
  dosage/package/manufacturer rows, stable medication brand/substance IDs, trade-name→MNN aliases,
  exact evidence, and proposed code-to-medicine relations. RLS detail cards use the dedicated
  `rls_mkb_reference` source type, so medication search sees only cards that mention medicines;
  generic medical references remain outside that scope. Clinical-catalog `icd10Codes` metadata is
  projected into FTS with punctuation-free variants so installed recommendations are found by
  `I67.9`, `I679`, `I67-9`, `I67 9`, `679`, `67-9`, or `67 9`. Three-attempt failures are saved to
  `rls-mkb-failures.json`; `bun run content:retry:mkb` repeats only those detail URLs. Build with
  `bun run content:rebuild:mkb`.
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
  document readers render structured tables as HTML tables rather than image blocks. The current 192н
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
rejected before WASM deserialization, so missing optional assets no longer block core boot and a
missing core pack falls back to the embedded seed.
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
- `medications.db` is a one-drug pipeline proof, not a medication corpus. Similar products, normalized
  dosing facts, ATC classification, and additional dosage forms remain absent.
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
