# MiniMed development TODO

This list records product work that directly affects clinicians. Technical implementation details should remain in architecture documents and collapsed diagnostics rather than dominate the application UI.

## P0 — full medical documents and loadable datasets

- [ ] Publish immutable GitHub Release assets for the first real SQLite module.
- [ ] Make the Russian pediatric regulatory pack installable, searchable, removable and persistent across restarts.
- [ ] Add browser and Android-WebView storage for downloaded module databases.
- [ ] Mount enabled downloaded modules through the existing multi-store search router.
- [ ] Show clear download progress, checksum verification, failure, installed version and storage size.
- [ ] Keep the previous validated module active when an update fails.
- [x] Keep persistent registry metadata and stored SQLite artifacts consistent when rollback or removal fails.
- [ ] Build the first full-text pediatric clinical module from the already validated recommendations.
- [x] Add deterministic HTML extraction for complete recommendation text and tables from declared public mirrors.
- [ ] Scale to 30–50 current Russian clinical recommendations after the first module lifecycle works end to end.
- [ ] Store complete extracted text, headings, anchors, page references, tables and provenance in the index artifact.
- [ ] Keep original PDFs as optional source-assets downloads when redistribution permits.
- [ ] Add source-grounded benchmark cases for every major section introduced by new documents.

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

## P0 — local model reliability

- [x] Let the user choose a concrete model and explicitly download/test it.
- [x] Expand model errors in a readable modal with a retry action.
- [x] Disable Qwen3 thinking during the short structured-output test and allow enough output tokens.
- [x] Default model downloads to the MiniMed GitHub Release mirror.
- [x] Disable upstream fallback by default for networks where upstream hosts may be blocked.
- [ ] Publish and verify mirrored model artifacts on GitHub before marking each candidate available.
- [ ] Show which stage failed: catalog, download, checksum, runtime initialization, memory or response validation.
- [ ] Store a privacy-safe diagnostic bundle that the user can copy when reporting an error.
- [ ] Run physical Android CPU/GPU/NPU qualification after the native LiteRT-LM adapter exists.

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

## Safety boundary

- [ ] Do not expose model-generated diagnosis, treatment or dosing until exact evidence citations, unsupported-claim rejection and deterministic safety checks pass the reviewed Russian benchmark.
- [ ] Keep deterministic search and source reading fully usable with no model and no network.
- [ ] Never allow an incomplete dataset download or failed model load to block the clinician’s current search.
