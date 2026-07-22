# Changelog

All notable changes are documented here. The project follows Semantic Versioning.

## [Unreleased]

## [0.3.3] - 2026-07-22

### Added

- An optional local-model startup layer with a validated six-model catalog, automatic device-fit
  selection, cached viability benchmarks, failure cooldown, one smaller-model fallback, and manual
  controls on the System page.
- Russian-first Vikhr and QVikhr candidates alongside Qwen, Gemma, and Llama comparison models, with
  explicit licence handling, immutable artifact metadata, and configurable mirror/upstream endpoints.
- Browser and Android-WebView GGUF loading through a CPU/WebAssembly wllama adapter, plus a passive
  bottom status toast that never blocks deterministic SQLite search.
- A scheduled/manual real-model CI smoke lane that verifies the compact Vikhr and Qwen artifacts by
  SHA-256 and requires valid structured Russian output.
- Persistent installed-module registry metadata with deterministic snapshots, restart rehydration,
  immutable version/source-set validation, rollback history, and transactional recovery after failed
  storage writes.

### Changed

- Workspace packages, Android application version, public-pilot pack, regulatory pack, and APK-only
  release workflow are aligned to 0.3.3; Android uses build number 11.
- Local-model selection no longer awards a WebGPU bonus to wllama: the implemented browser/WebView path
  is explicitly CPU-only. GPU and NPU acceleration remain a native LiteRT-LM follow-up.

### Verification boundary

- Model output is not used for diagnosis, treatment, retrieval ranking, or generated clinical answers in
  this release. Deterministic retrieval and safety behavior remain authoritative.
- The APK does not bundle model weights. Models are resolved after startup through the validated catalog
  and configured immutable or upstream artifact endpoints.
- Native Android GPU/NPU execution, streaming artifact installation, physical-device model qualification,
  and source-grounded clinical orchestration remain follow-up work.

## [0.3.2] - 2026-07-22

### Added

- A modular-content foundation with a validated GitHub catalog, multi-store routing, rollback records,
  and a portable atomic installer state machine.
- A searchable document archive, direct document opening, readable medical-domain map, sticky document
  reader, and local document filtering.
- A versioned Russian symptom-expression lexicon covering abdominal distension, respiratory wording,
  urinary symptoms, and neuroinfection-related signs.
- Non-blocking clinical clarifications for ambiguous neuroinfection queries, dedicated
  next-diagnostics and differential branches, and 500 ms debounced search.
- Local medical glyphs, passive module-update badges, compact progressive search results,
  exact-fragment source reading, surrounding-context expansion, and scroll-to-top navigation.

### Changed

- Search results show one best fragment per document first; additional matches, surrounding context,
  and the complete document are opened progressively.
- Current medication remains visible as patient context but no longer acts as a diagnostic symptom in
  patient-case retrieval.
- Workspace packages, Android application version, public-pilot pack, regulatory pack, and APK-only
  release workflow are aligned to 0.3.2; Android uses build number 10.
- Module updates never interrupt the clinical search flow; availability is indicated only on the
  Modules icon and page.

### Verification boundary

- The portable installer is tested with injected downloader, staging, validator, registry, and rollback
  adapters; real Android/iOS filesystem downloads and WorkManager notifications remain a later slice.
- The application still embeds the existing 15-document pilot pack. Full extracted recommendations,
  structured tables, source PDFs, and dedicated medication cards remain planned modular artifacts.
- The query parser and retrieval are deterministic and source-grounded. A local neural reranker or
  generative model is not included in this release.

## [0.3.1] - 2026-07-21

### Added

- A provenance-labelled 193-record clinical-query benchmark with Russian-first intent, source-grounded retrieval, and 12 safety/workflow contract overlays.
- A separate Russian regulatory pilot containing current orders 192н and 211н, superseded order 302н, and current-versus-historical retrieval gates.
- Rights-aware collection manifests for supported HTTPS, local, manual, and licensed vendor drug
  exports, including checksums, cache provenance, and separate offline-storage, derivative-processing,
  and redistribution permissions.
- A manual ChatGPT enrichment handoff that exports exact source chunks, imports evidence-backed
  proposals as `proposed`, records missing medical fields as review tasks, and requires an identified
  human reviewer before facts, relations, or document links become searchable.
- A relational SQLite knowledge layer for entities, medicine profiles, typed clinical facts, weighted
  relations, exact evidence, document links, editorial tasks, and a reviewed-only structured FTS
  index.
- A profile-driven Russian query-intent classifier for diagnostic cases, treatment requests,
  medication lookup, disease reference, care guidance, administrative reference, mixed requests,
  and unknown queries.
- Regression coverage for the thirteen Russian search examples collected during design, preserving
  their original wording and misspellings.

### Changed

- Android and iOS application versions, workspace packages, and release content packs are aligned to 0.3.1.
- The APK-only public-pilot workflow is the single release path; the obsolete synthetic full-release workflow is removed.
- Reviewed structured knowledge can extend existing chunk FTS and vector projections while original
  source text, source spans, and stable anchors remain unchanged.
- Medication identity reconciliation now uses concept level, INN, form, route, strength,
  registration identifiers, and external IDs instead of merging medicines by display name alone.
- ChatGPT task export fails closed for non-synthetic sources unless explicit derivative-processing
  permission and a reviewed licence/terms identifier are present in source metadata.

### Verification boundary

- The release APK embeds the 15-document Russian clinical/medication pack. The separate regulatory pack is built and benchmarked in release CI but is not installed in the APK until multi-pack lifecycle support is implemented.
- No licensed medical source data, Allmed content, patient data, model output, or API credentials are
  committed. The checked-in material implements and tests the ingestion, review, graph, and retrieval
  contracts only.
- Dedicated runtime drug-card queries and UI remain a later vertical slice; this change exposes
  reviewed knowledge through the existing local FTS/vector retrieval path and stores the complete
  structured graph in the offline SQLite pack.

## [0.3.0-alpha.1] - 2026-07-18

### Added

- Versioned embedding profiles and compact signed-int8 vectors stored per searchable chunk.
- Deterministic cross-language feature-hash profile for exercising the complete local semantic
  pipeline without presenting it as a neural medical model.
- `lexical`, `semantic`, `hybrid`, and automatic retrieval modes with explicit diagnostics and
  lexical fallback.
- Exact cosine vector search in memory, SQLite WASM, Android SQLite, and iOS SQLite.
- Hybrid score fusion, per-result lexical/semantic evidence, profile compatibility checks, and
  semantic-path benchmark coverage.
- Native Capacitor vector-search contract and regression tests for profile loading, int8 transport,
  and source-record hydration.

### Changed

- Demo content packs use schema version 2 and include one precomputed vector for every chunk.
- The application exposes the active retrieval route as `FTS5 + VECTOR` and the technical panel
  shows profile, fallback, and score information.
- Repository verification runs isolated phases with explicit timeouts instead of one opaque nested
  command chain.
- Android and iOS application versions are aligned to the `0.3.0-alpha.1` source milestone.

### Verification boundary

- Formatting, TypeScript/Astro checks, 29 Vitest tests, strict Python checks, 13 Python tests,
  deterministic content compilation, production builds, real-Chromium E2E, retrieval benchmarks,
  native bridge parity, peer checks, and secret scanning pass in the development environment.
- The feature-hash profile validates mechanics only. Neural retrieval quality, real clinical
  recommendations, native binary builds, and physical-device performance remain separate exit
  criteria.

## [0.2.2] - 2026-07-17

### Added

- Private source registry and atomic `medbase prepare` workspace.
- Text-layer PDF, UTF-8 TXT/OCR, and Markdown extraction paths.
- Repeated header/footer and page-number removal, heading/list/table candidates, low-text warnings,
  and extraction quality reports.
- Hidden page/block or line provenance markers compiled into chunk metadata and page ranges.
- Raw-source SHA-256 propagation into document versions.
- Generated multi-page PDF, path traversal, TXT provenance, and end-to-end private-pack tests.
- Private corpus template and authoring documentation.

### Changed

- Markdown sources can explicitly distinguish synthetic fixtures from imported source material.
- Demo fixtures now declare `synthetic_fixture: true`; generated pack checksum was refreshed.
- Workspace and native application versions are aligned to 0.2.2.

### Verification boundary

- Python formatter/linter, strict Pyright, 11 ingestion tests, deterministic pack build, SQLite
  integrity, native source checks, and checksum parity pass.
- Exact 0.2.2 JavaScript build/test suite, physical mobile builds, and real recommendation parsing
  remain recipient-machine/pilot checks.

## [0.2.1] - 2026-07-17

### Added

- `CapacitorMedicalStore`, a portable adapter that implements the existing `MedicalStore` contract.
- Local Android and iOS `LocalMedDatabase` plugins for read-only packaged SQLite access.
- Checksum-addressed installation into private app storage, integrity probing, FTS5 probing, and
  interrupted-update recovery.
- Automatic native-to-WASM fallback during application composition.
- Storage backend and persistence diagnostics on the System screen.
- Native bridge contract tests, source-registration checks, and a physical-device smoke protocol.

### Changed

- Mobile composition now prefers persistent native SQLite instead of always deserializing the pack
  into WebView memory.
- Workspace and native application versions are aligned to 0.2.1.

### Verification boundary

- Source-level TypeScript, Swift, Java, checksum, Python, and schema checks pass in the handoff
  environment.
- Android/iOS compilation and physical-device persistence remain unverified until the recipient
  runs the documented native smoke suite.

## [0.2.0] - 2026-07-17

### Added

- Deterministic long-case analyzer for age, sex, duration, temperature, measurements,
  investigations, medications, locations, epidemiology, explicit negations, and uncertainty.
- Source-linked query facts, missing-field suggestions, and multiple explainable lexical branches.
- Magnitude-preserving branch fusion with a rank-1 clinical-case regression suite.
- Direct loading of precompiled SQLite content packs in the browser runtime.
- Local bookmarks, richer source navigation, and branch/category diagnostics.
- Archive-folder and paper visual language for the application and landing page.
- Five long clinical-case benchmark fixtures in addition to the compact lexical benchmark.

### Changed

- Browser composition now treats JSON seed loading as a recovery fallback rather than the primary
  content-pack path.
- Core capability now reports deterministic local case extraction as available.
- Search ranking caps weak cross-branch reinforcement so strong lexical evidence remains dominant.

## [0.1.0] - 2026-07-16

### Added

- Offline-first application shell with SolidJS and Capacitor configuration.
- Typed `MedicalCore` boundary and replaceable storage/search ports.
- SQLite WASM integration with verified FTS5 support for the web demo and tests.
- Deterministic clinical-recommendation fixture builder and demo content pack.
- BM25 lexical search, Russian query normalization, aliases, snippets, anchors, and context.
- Astro landing page, GitHub workflows, agent instructions, tests, and retrieval benchmark.
