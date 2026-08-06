# Current state

> Updated: 29 July 2026
> Repository version: `0.6.10`
> Active target: `0.6.10` public prerelease toward `1.0`

This file records what exists now and the next ordered work. The target architecture and acceptance
gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

## Implemented

### Product and retrieval

- SolidJS browser app behind the UI-independent `MedicalCore` contract.
- SQLite/FTS5 retrieval with SQLite WASM fallback and compatible native read-only storage adapters.
- Deterministic portable embeddings and hybrid lexical/vector fusion.
- Russian patient-case parsing, negative findings, bounded query branches, medical abbreviations, and
  missing-field prompts.
- Search after 500 ms of inactivity with stale-response cancellation.
- Search is hidden until the user selects a scope; scopes with no installed documents are disabled.
- Query analysis and deterministic retrieval run in a Web Worker, and long result sets are window
  virtualized.
- Results are grouped by document; collapsed groups show only their document header, while expanded
  groups expose exact fragments, surrounding context, and full-document navigation.
- Document readers keep the outline control in the fixed dialog header; scrolling pins the current
  section heading, marks its outline entry, and keeps that entry centered.
- Search-result context remaps stale pilot-summary chunks to installed full-text siblings and falls back
  to the readable document when an exact chunk cannot be resolved.
- Within-document ranking uses query intent to prefer the relevant diagnostic, routing, or treatment
  section; the public benchmark currently has perfect section retrieval and top-section accuracy.
- Initial results are limited to five documents with an accessible control to reveal the rest.
- Search scopes cover diagnosis support, clinical recommendations, medications, legal documents, and
  deterministic search across all installed sources.
- Only diagnosis scope may call the optional grounded local-model wrapper; the other scopes constrain
  deterministic retrieval by installed source type.
- A realistic pediatric workflow query — `Цефтриаксон ребенку 3 лет вес 20 кг при пневмонии как
  второй антибиотик` — is part of the retrieval benchmark.

### Browser workspace

- Three primary sections in a compact bottom navigation bubble: search, knowledge base, and personal
  notes. View Transition viewport snapshots follow their left-to-right order: the next page slides
  over the current one horizontally, while the bottom navigation remains fixed and interactive above
  the transition. Rapid tab changes play through a serial queue; document, note, and local-model
  subroutes remain instant.
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
  consistent hover/focus feedback for cards, buttons, and fields. The document uses one
  native page scrollbar without a second application-owned scroller.
- Reusable view components now own confirmation dialogs, horizontal search examples, module cards,
  and module task states; their parent pages retain routing, persistence, and orchestration.
- Personal cards use a responsive three-column sticker board and a focused creation dialog opened
  from a floating add button. Card timelines and dated-record editors use nested note routes; card
  edit/delete actions are compact icon controls. Record editors guard unsaved drafts, accept image
  attachments by file selection or drag-and-drop, and keep tags, reminders, images, and related
  sources in distinct blocks. On first launch, an editable colleague card and record introduce the
  local notes workflow; once removed, they stay removed.
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
- Module and model downloads share retry/backoff and resumable partial bytes, but use independent
  network lanes: up to three document installs run concurrently while additional documents remain
  queued, and the selected model always receives its own download slot. A single document runtime
  survives catalog refreshes; transient failures release their slot before an automatic retry so one
  broken source cannot starve the queue.
- The knowledge graph remains interactive during hover/focus and visually distinguishes clinical,
  medication, legal, and personal-note sources.
- Model settings distinguish always-available offline search from the optional local model and expose
  model size, requirements, advantages, limitations, and model selection.
- Browser application updates install in the background but wait for explicit approval in the shared
  floating system-status area before the new service worker activates and reloads the page.
- The paper workspace follows the device light/dark preference without adding an application toggle.
- Android draws the page background beneath its transparent status bar while safe-area padding keeps
  controls below it; system-bar icon contrast follows the device theme. Hardware Back closes the
  active dialog or drawer, returns through nested routes and root sections, then minimizes the app at
  the search root. Standard WebView vibration supplies light, medium, and heavy feedback for controls,
  primary navigation, and destructive actions without another native plugin.
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
- Optional compact query planning and reranking over at most six retrieved chunks.
- Exact-source diagnostic candidate extraction.
- Exact-source dose extraction only from a treatment chunk containing both a numeric dose and regimen.
- Candidate-ID, text-length, exact-substring, category, and dose-pattern validation.
- One cited chunk must independently support the label, exact excerpt, and treatment classification;
  evidence cannot be assembled across unrelated citations.
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
- Optional local `ambulatory.db` companion (`minimed.ambulatory.v1`) mounts private textbook/handbook
  extracts for site/call use. Build via `bun run content:rebuild:ambulatory` (anydoc text-layer +
  macOS Vision OCR). Pack is gitignored — copyrighted sources stay local; GroundedMedicalCore already
  cites whatever MultiMedicalStore returns, so diagnosis AI uses ambulatory chunks once mounted. See
  `docs/AMBULATORY_CORPUS_V1.md`.
- Public Russian starter pack: seven clinical navigation cards and eight medication-registry identity
  cards.
- Structured knowledge tables support proposed facts, exact evidence links, relations, and review tasks.
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

1. Verify the 0.6.10 prerelease on a physical Android device, including system-bar insets, native Back,
   locally scheduled
   notifications, note-image persistence, and the published Pages `/app/`.
2. Validate the one-drug `medications.db` pipeline, then expand it without hand-editing generated
   SQLite.
3. Add verified OCR for the blocked drug instruction.
4. Expand real Russian clinician-query, unsupported-answer, and source-scope benchmark coverage.
5. Add explicit export and whole-notebook deletion, then evaluate an optional downloadable Russian
   on-device transcriber.
6. Qualify bundled local models on citation fidelity, abstention, latency, storage, and memory before
   presenting diagnostic assistance as a 1.0 capability.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.
