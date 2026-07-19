# Roadmap

The detailed product plan is in [`TECHNICAL_PLAN.md`](TECHNICAL_PLAN.md). This file records the
implemented boundary rather than an aspirational feature list.

## 0.0.1–0.0.3 — foundation — complete

- pnpm monorepo, SolidJS/Vite, Capacitor shells, Astro landing;
- strict TypeScript, Biome, Vitest, Ruff, Pyright, GitHub Actions;
- runtime-validated contracts, `MedicalCore`, storage ports and adapters;
- deterministic Markdown corpus builder, stable IDs/anchors, SQLite/FTS5 and integrity reports.

## 0.1.0 — useful lexical vertical slice — complete

- one free-form field up to 20,000 characters;
- Russian normalization and aliases;
- FTS5/BM25, snippets, grouping, source context;
- library/status views, history, benchmark, and browser E2E.

## 0.2.0 — clinical query core and archive UI — complete

- deterministic extraction of age, sex, duration, temperature, measurements, investigations,
  medications, locations, epidemiology, and explicit negations;
- source ranges, uncertainty warnings, and clickable missing-field suggestions;
- multiple weighted query branches and explainable diagnostics;
- rank fusion resistant to duplicated weak branches;
- direct loading of the compiled SQLite `.db` pack in the browser runtime;
- local bookmarks and richer source reader;
- archive/folder/paper visual language for the app and landing;
- long-case rank-1 regression benchmark.

## 0.2.1 — native persistence adapter — implemented; device smoke pending

- `CapacitorMedicalStore` implements `MedicalStore`;
- local Android/iOS plugins copy/open a bundled `.db` in private storage without rebuilding it;
- checksum, quick integrity check, real FTS5 probe, and WASM fallback are implemented;
- source registration and bridge parity checks are automated;
- physical Android/iOS FTS5, process-death, reboot, recovery, and latency smoke remain open.

## 0.2.2 — private recommendation ingestion — tooling complete; corpus pending

- ignored private raw-data workspace and validated source registry;
- text-layer PDF, UTF-8 TXT/OCR, and Markdown importer;
- repeated header/footer removal, heading/list/table candidates, and low-text diagnostics;
- page/block or line provenance carried into compiled chunks;
- build-ready Markdown and atomic preparation output;
- parser tests with generated multi-page PDF and path traversal rejection.

Still requires the user's 5–10 selected recommendations, spot review, 50–100 physician-authored
queries, and real-corpus latency/size/memory measurements.

## 0.3.0 — local semantic retrieval — alpha implemented

Implemented in `0.3.0-alpha.1`:

- immutable embedding-profile contract and schema migration;
- precomputed per-chunk int8 vectors and local query-only embedding;
- exact filtered cosine scan in in-memory/SQLite adapters and native bridge contracts;
- lexical, semantic, hybrid, and auto modes;
- hybrid fusion, per-result scores, profile diagnostics, and explicit lexical fallback;
- cross-language golden vectors, unit tests, hybrid benchmark assertions, and browser E2E.

Still required before stable `0.3.0`:

- compact multilingual neural model spike with Russian medical benchmark;
- physical-device latency, memory, battery, and package-size measurements;
- lexical versus neural retrieval comparison on 50–100 physician-authored queries;
- exact scan versus ANN decision at representative corpus size.

## 0.4.0 — optional BYOK cloud synthesis

- provider-neutral answer port;
- payload preview and selected-chunk-only sending;
- citations back to local anchors;
- cancellation, timeout, and rate limits;
- no-key/no-network path remains fully useful.

## 0.5.0 — optional local model assistance

- structured-output adapter for more ambiguous case extraction;
- deterministic parser remains fallback;
- source spans, negation, uncertainty, and timeline contract tests;
- model may propose search branches but never own the local corpus.

## 0.6.0+ — content packs, scale, hardening, closed beta

- signed manifests, install/update/rollback, specialty modules;
- tens/hundreds of recommendations and physician golden set;
- performance/memory budgets and device matrix;
- feedback workflow without patient data;
- closed beta with several physicians.

## 1.0.0 — stable personal edition

- reproducible content packs;
- offline-first mobile UX;
- measured retrieval quality on representative content;
- documented update/recovery path;
- no mandatory backend.
