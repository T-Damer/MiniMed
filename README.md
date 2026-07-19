# LocalMed Search

LocalMed Search is an offline-first navigator over Russian clinical recommendations. It accepts a
long free-form case description, extracts a transparent case card without a generative model,
searches a local SQLite content pack, and opens the most relevant source at an exact section or
chunk.

> The included corpus is synthetic. It exists only to verify software behavior and must not be
> used for clinical decisions.

![LocalMed Search 0.3.0 alpha archive workspace](docs/assets/app-search-archive.png)

## Current vertical slice — 0.3.0-alpha.1

- SolidJS application and Capacitor 8 Android/iOS shells;
- typed, platform-independent `MedicalCore` boundary;
- deterministic extraction of age, sex, duration, temperature, measurements, investigations,
  medications, locations, epidemiology, aliases, uncertainty, and negative findings;
- several weighted lexical branches for one long case description;
- SQLite FTS5/BM25 plus a local exact vector path and hybrid fusion;
- one precompiled `.db` content pack with immutable embedding profiles and per-chunk int8 vectors;
- persistent native SQLite adapter for Android/iOS with checksum install, integrity/FTS5 probing,
  and interrupted-update recovery;
- automatic mobile fallback to SQLite WASM when the platform plugin or FTS5 runtime is unavailable;
- grouped, explainable results with lexical/semantic scores, matched branches, stable anchors, and
  neighboring source context;
- local query history and bookmarks;
- deterministic Python content-pack builder;
- private PDF/TXT/Markdown source registry with repeated-header removal, extraction diagnostics,
  hidden page/block provenance, and build-ready Markdown;
- archive-inspired application and Astro landing page;
- Biome, strict TypeScript, Vitest, pytest, Ruff, Pyright, Playwright, and GitHub Actions.

No LLM, API key, hosted database, or application backend participates in the default search path.
The current vector profile is a deterministic engineering scaffold, not a neural medical model.

## Runtime storage paths

```text
Browser
  → packaged core-demo.db
  → SQLite WASM / FTS5

Android / iOS
  → CapacitorMedicalStore
  → private persistent SQLite file
  → integrity + real FTS5 probe
  → SQLite WASM fallback on incompatibility
```

The **Система** screen reports `SQLITE-NATIVE`, `SQLITE-WASM`, or `IN-MEMORY`, so a device test does
not have to infer which adapter was selected.

## Quick start

Requirements: Node.js 22.12+, pnpm 11, Python 3.12+, and `uv`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm content:sync
pnpm content:build
pnpm dev
```

Run the verification suite:

```bash
pnpm verify
CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e
```

Prepare mobile projects:

```bash
pnpm build:app
pnpm native:sync
pnpm native:source:check
```

Physical device checks are documented in [`docs/NATIVE_SMOKE.md`](docs/NATIVE_SMOKE.md).

## Prepare a private pilot corpus

Raw recommendations remain under the ignored `data/raw/` workspace:

```bash
cp docs/examples/private-sources.yaml data/raw/sources.yaml
# Put referenced PDF/TXT files in data/raw and edit the registry.

pnpm content:prepare:private
pnpm content:lint:private
pnpm content:build:private
```

The preparer does not summarize medical content. It removes repeated marginalia, detects probable
structure, records extraction warnings, and adds hidden source markers that compile into chunk/page
metadata. See [`docs/PILOT_CORPUS.md`](docs/PILOT_CORPUS.md).

## Repository map

```text
apps/app                    SolidJS + Capacitor application
apps/landing                Static Astro project page
packages/contracts          Runtime-validated public DTOs
packages/domain             Medical document domain model
packages/core               Query analysis, retrieval orchestration, rank fusion
packages/storage            Storage/search port and in-memory adapter
packages/storage-sqlite     SQLite WASM adapter, migrations, FTS5
packages/storage-capacitor  Capacitor/native SQLite adapter
packages/search-lexical     Russian normalization and deterministic case planning
packages/search-semantic    Embedding profiles, portable query vectors, cosine helpers
packages/test-fixtures      Synthetic content and fixtures
tools/ingest                PDF/TXT preparation and deterministic content-pack builder
tools/benchmarks            Lexical and long-case benchmark runners
schema                      Shared SQL contract
docs                        Product, ingestion, architecture, native smoke, and handoff docs
```

## Native status

The Android and iOS local plugins are implemented and registered in the checked-in projects. They
install the packaged database into private app storage, open it read-only, and expose the same
`MedicalStore` behavior as the browser adapter. Source registration, bridge parity, Swift parsing,
Java compilation against local stubs, and the packaged checksum are checked in this release.

A real APK/iOS build and physical-device persistence/performance run are still required before
calling the native milestone verified. See [`docs/NATIVE_SQLITE.md`](docs/NATIVE_SQLITE.md),
[`docs/HANDOFF.md`](docs/HANDOFF.md), and [`data/build/verification-report.md`](data/build/verification-report.md).
