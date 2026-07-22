# MiniMed development TODO

This list records product work that directly affects clinicians. Technical implementation details should remain in architecture documents and collapsed diagnostics rather than dominate the application UI.

## P0 — full medical documents and loadable datasets

- [ ] Publish immutable GitHub Release assets for the first real SQLite modules.
- [ ] Make the Russian pediatric regulatory pack installable, searchable, removable and persistent across restarts.
- [x] Add browser and Android-WebView storage for downloaded module databases.
- [x] Mount enabled downloaded modules through the existing multi-store search router without blocking the active search or reloading the page.
- [ ] Add a browser E2E scenario for install → live search → remove using a published SQLite fixture.
- [x] Show download progress, SHA-256/SQLite verification, installed version and storage size.
- [ ] Preserve and display the exact installation failure stage after a failed task.
- [ ] Keep the previous validated module active when an update fails.
- [x] Keep persistent registry metadata and stored SQLite artifacts consistent when rollback or removal fails.
- [ ] Build and publish the first full-text pediatric clinical module.
- [x] Add deterministic HTML extraction for complete recommendation text and tables from declared public mirrors.
- [ ] Inventory every discoverable current clinical recommendation and assign a coverage state.
- [ ] Categorize clinical recommendations by specialty, population, condition family and source edition.
- [ ] Generate specialty module definitions automatically from the reviewed inventory.
- [ ] Publish every recommendation that passes provenance, rights, extraction, integrity and retrieval gates.
- [ ] Keep metadata-only records for recommendations whose full text cannot yet be safely distributed.
- [ ] Record blocked, licence-restricted, superseded, historical and failed-validation records explicitly.
- [ ] Store complete extracted text, headings, anchors, page references, tables and provenance in the index artifact.
- [ ] Keep original PDFs as optional source-assets downloads when redistribution permits.
- [ ] Add source-grounded benchmark cases for every major section introduced by new documents.
- [ ] Produce per-specialty coverage reports and fail release promotion on unexplained coverage regressions.

## P0 — medication datasets

- [ ] Inventory official Russian medication records and current instruction editions.
- [ ] Separate registration identity, instruction text, structured facts and reviewed dosing knowledge.
- [ ] Build categorized medication modules that can be installed independently from clinical recommendations.
- [ ] Preserve trade names, INN, dosage forms, strengths, routes, manufacturers, registration numbers and source editions.
- [ ] Mark withdrawn, suspended, historical and conflicting records explicitly.
- [ ] Never promote extracted doses, contraindications or interactions to trusted facts without source evidence and review state.
- [ ] Add medication-search and source-navigation benchmarks before publishing each module.

## P0 — laws and regulatory datasets

- [ ] Add a read-only collector for the official legal-publication API.
- [ ] Inventory health-related federal laws, government acts and Ministry of Health orders with stable publication identifiers.
- [ ] Categorize acts by care organization, licensing, medicines, clinical recommendations, public health, records, consent, military medicine and other relevant domains.
- [ ] Preserve publication number, authority, document type, signature/publication dates, registration details and source PDF checksum.
- [ ] Model amendments, replacements, invalidation and historical applicability instead of overwriting old editions.
- [ ] Publish searchable regulatory modules with exact source PDFs or metadata-only records according to redistribution rules.
- [ ] Add update-detection and supersession tests against the official API.

## P0 — document reading and navigation

- [x] Open complete documents in a reusable overlay outside tab navigation.
- [x] Stop rendering a permanent large document reader inside the Archive route.
- [x] Present search-result context as an overlay rather than a second application column.
- [x] Use compact readable line length and typography for medical text.
- [x] Reuse one overlay shell for document and error dialogs.
- [ ] Preserve a deep link to the open document and exact anchor in browser history.
- [ ] Add optional full-screen and split-view modes for tablets.
- [ ] Add PDF.js source viewing at the linked original page after source assets are installable.
- [ ] Add structured table rendering with a page-image fallback.

## P0 — working local model and grounded assistant

- [x] Let the user choose a concrete model and explicitly download/test it.
- [x] Expand model errors in a readable modal with a retry action.
- [x] Disable Qwen3 thinking during the short structured-output test and allow enough output tokens.
- [x] Default model downloads to the MiniMed GitHub Release mirror.
- [x] Disable upstream fallback by default for networks where upstream hosts may be blocked.
- [ ] Publish and verify mirrored model artifacts on GitHub before marking each candidate available.
- [ ] Show which stage failed: catalog, download, checksum, runtime initialization, memory, generation or schema validation.
- [ ] Store a privacy-safe diagnostic bundle that the user can copy when reporting an error.
- [ ] Qualify at least one compact Russian-capable model on physical Android hardware.
- [ ] Connect the model to structured query planning only after deterministic parsing remains available as fallback.
- [ ] Add source-fragment reranking with candidate IDs fixed before inference.
- [ ] Add clarifying-question selection from a bounded deterministic candidate set.
- [ ] Require every assistant statement to reference retrieved document/chunk identifiers.
- [ ] Reject unsupported claims, invented citations and ungrounded numerical doses.
- [ ] Add Russian safety benchmarks for negation, age, pregnancy, allergy, renal impairment, route, units and per-dose/per-day distinctions.
- [ ] Add a native LiteRT-LM adapter and physical Android CPU/GPU/NPU qualification where supported.

## P1 — clinician-facing UX and Russian text

- [x] Rename technical navigation labels to doctor-facing terms.
- [x] Hide system internals under explicit collapsible sections.
- [x] Replace the grouped-list “graph” with an interactive canvas graph.
- [x] Add proper graph margins, padding, pan, zoom and drag behavior.
- [ ] Review every Russian status, empty state, button and search explanation with clinicians.
- [ ] Replace abbreviations such as FTS5, VECTOR, runtime and schema in primary UI with plain-language descriptions.
- [ ] Keep exact technical values available only in diagnostics.
- [ ] Explain search results in complete Russian sentences: why the source matched, what is missing and what the user can do next.
- [ ] Consolidate repeated card, toolbar, empty-state, disclosure and dialog UI into shared components.
- [ ] Perform Android phone and tablet usability review with safe-area, keyboard and back-button behavior.

## P1 — graph and knowledge navigation

- [x] Render a real node-edge canvas instead of a list styled as a graph.
- [ ] Derive graph edges from reviewed entities and relations rather than specialties alone.
- [ ] Add filters for disease, symptom, medicine, diagnostic method and regulatory document.
- [ ] Add focus mode around the selected node and a readable relation explanation.
- [ ] Keep a non-canvas accessible list of the same nodes and relationships.

## 0.4.0 release gate

- [ ] Maximum verified clinical-recommendation coverage is published by category, with all omissions explained in the coverage ledger.
- [ ] Medication and regulatory modules are loadable, versioned, searchable and auditable.
- [ ] At least one local model works on supported Android devices and provides source-grounded planning/reranking with deterministic fallback.
- [ ] Production signing, stable/preview channels, migrations, recovery and physical-device checks are complete.
- [ ] Clinician-facing Russian UX and privacy-safe diagnostics pass the pilot checklist.

## Safety boundary

- [ ] Do not expose model-generated diagnosis, treatment or dosing until exact evidence citations, unsupported-claim rejection and deterministic safety checks pass the reviewed Russian benchmark.
- [ ] Keep deterministic search and source reading fully usable with no model and no network.
- [ ] Never allow an incomplete dataset download or failed model load to block the clinician’s current search.
