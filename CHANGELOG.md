# Changelog

All notable changes are documented here. The project follows Semantic Versioning.

## [Unreleased]

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
