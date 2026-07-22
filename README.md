# MiniMed

MiniMed is an offline-first navigator over Russian clinical recommendations, medication sources and
regulatory documents. It accepts a free-form clinical query, extracts a transparent case structure,
searches local SQLite knowledge packs and opens the relevant source at an exact section or chunk.

> MiniMed is an engineering and clinical-reference pilot. Its datasets are incomplete and it must not
> be used as an autonomous diagnostic or treatment system. The deterministic source search remains
> the primary product; local models are optional and are not currently allowed to generate clinical
> conclusions.

![MiniMed archive workspace](docs/assets/app-search-archive.png)

## Current release — 0.3.3

The current APK release provides:

- a 15-document Russian public pilot with source-linked clinical, medication and regulatory records;
- deterministic Russian query parsing, lexical search, local vector search and hybrid rank fusion;
- exact document, section and chunk navigation with neighboring source context;
- a SolidJS application and Capacitor Android shell;
- local history and bookmarks;
- persistent installed-module registry metadata with rollback state;
- an optional six-model local-AI catalog with automatic device-fit selection and a startup viability
  test;
- CPU/WebAssembly GGUF loading in browsers and the current Android WebView path;
- deterministic Python ingestion for Markdown, TXT and PDF sources;
- Biome, strict TypeScript, Vitest, pytest, Ruff, Pyright, Playwright and GitHub Actions verification.

The local model is not connected to diagnosis, treatment, dose selection, retrieval ranking or
clinical-answer generation. MiniMed remains fully usable without a model or network connection.

## Roadmap

The roadmap is version-oriented rather than date-oriented. A milestone is complete only when its
acceptance criteria pass in CI and, where required, on a physical Android device.

| Version | State | Primary goal | Release gate |
| --- | --- | --- | --- |
| **0.3.3** | Released | Public pilot, module registry and local-model runtime foundation | Verified APK with the embedded 15-document corpus |
| **0.3.4** | In development | Loadable full-text datasets and doctor-facing UX | Real modules can be downloaded, verified, persisted, searched, removed and rolled back |
| **0.3.5** | Planned | Expand the Russian corpus into practical specialty packs | 30–50 current recommendations with per-section retrieval benchmarks |
| **0.3.6** | Planned | Source-grounded local assistant | Query planning and reranking pass Russian safety benchmarks with exact evidence links |
| **0.4.0** | Planned | Doctor pilot suitable for routine offline reference use | Production signing, reliable update channels, migrations, recovery and physical-device qualification |

### 0.3.4 — loadable datasets and clinician UX

This is the active milestone in [PR #98](https://github.com/T-Damer/MiniMed/pull/98).

Planned release contents:

- a shared modal-style document reader outside tab navigation;
- compact medical-text layout, document search and exact-anchor navigation;
- an interactive canvas knowledge graph with pan, zoom and dragging;
- plain-language Russian UI with technical diagnostics hidden in collapsible sections;
- explicit model selection and an exact-model download/load/structured-response test;
- readable model failure details and retry actions;
- GitHub-first model downloads for checksum-verified redistributable models;
- browser and Android-WebView persistence for downloaded SQLite modules;
- checksum, SQLite integrity, foreign-key and FTS validation before activation;
- mounting enabled modules through the multi-store search router;
- the first downloadable Russian regulatory module;
- the first full-text respiratory module containing pneumonia, bronchitis and bronchiolitis
  recommendations.

The 0.3.4 release is blocked until both datasets build from declared sources, pass integrity and
retrieval checks, install successfully in the application and survive an application restart.

### 0.3.5 — corpus expansion

- expand to 30–50 current Russian clinical recommendations;
- split content into coherent pediatric, infectious, respiratory/allergy, gastroenterology,
  neurology/emergency, medication and regulatory packs;
- add one grounded benchmark scenario for every major imported section;
- introduce resumable/background Android downloads and a native private-file storage adapter;
- offer original PDFs as separate optional source assets where redistribution permits;
- preserve old validated module versions for safe rollback;
- surface superseded, historical and conflicting versions explicitly.

### 0.3.6 — source-grounded local assistant

The model may assist only after deterministic retrieval has produced candidate evidence.

- structured query decomposition and terminology normalization;
- selection of useful clarifying questions;
- reranking of already retrieved source fragments;
- concise formatting with exact source anchors;
- strict JSON schemas and deterministic fallbacks;
- rejection of unsupported claims and ungrounded numerical doses;
- Russian tests for negation, age, pregnancy, allergy, renal impairment, route, units and
  per-dose/per-day distinctions;
- native LiteRT-LM CPU/GPU/NPU adapter and physical-device benchmarks where hardware support exists.

### 0.4.0 — doctor pilot

- production-signed Android builds and stable/preview content channels;
- reliable module migrations, interrupted-update recovery and storage management;
- physical-phone and tablet usability review, including keyboard, safe-area and back-button behavior;
- privacy-safe diagnostics that can be copied when reporting an error;
- provenance and version visibility suitable for clinical source auditing;
- documented recovery path when a model or dataset cannot be loaded;
- a broader clinician-reviewed Russian UX pass.

### Later milestones

- reviewed disease–symptom–test–medication knowledge-graph relations;
- personal notes that become searchable without entering the shared medical corpus;
- desktop and iOS packaging;
- optional source-aware comparison between historical and current recommendations;
- specialty packs beyond the initial pediatric focus.

Detailed task-level work is tracked in [`docs/TODO.md`](docs/TODO.md). Dataset architecture is
explained in [`docs/FULL_DATASETS.md`](docs/FULL_DATASETS.md).

## Roadmap maintenance policy

Every version or release PR must update this README in the same change set:

1. update the **Current release** version and shipped capabilities;
2. mark the released roadmap row as **Released**;
3. move the next milestone to **In development** and state its measurable release gate;
4. remove, split or defer work that did not ship rather than presenting it as completed;
5. keep [`CHANGELOG.md`](CHANGELOG.md), [`docs/TODO.md`](docs/TODO.md) and release notes consistent;
6. preserve safety boundaries explicitly when model or medical-content capabilities change.

The roadmap should describe outcomes and acceptance criteria. Implementation-level tasks belong in
`docs/TODO.md`, architecture documents, issues and pull requests.

## Runtime storage paths

```text
Browser
  → packaged core database
  → SQLite WASM / FTS5
  → downloaded module databases in IndexedDB

Android
  → packaged core database in private application storage
  → native SQLite when available
  → SQLite WASM fallback
  → current downloaded-module adapter through Android WebView storage
```

A native Android private-file and background-download adapter is planned for 0.3.5.

## Quick start

Requirements: Node.js 22.12+, pnpm 11, Python 3.12+ and `uv`.

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

Physical-device checks are documented in [`docs/NATIVE_SMOKE.md`](docs/NATIVE_SMOKE.md).

## Prepare a private corpus

Raw recommendations remain under the ignored `data/raw/` workspace:

```bash
cp docs/examples/private-sources.yaml data/raw/sources.yaml
# Put referenced PDF/TXT files in data/raw and edit the registry.

pnpm content:prepare:private
pnpm content:lint:private
pnpm content:build:private
```

The preparer does not summarize medical content. It removes repeated marginalia, detects probable
structure, records extraction warnings and adds hidden source markers that compile into chunk/page
metadata. See [`docs/INGESTION.md`](docs/INGESTION.md).

## Repository map

```text
apps/app                    SolidJS + Capacitor application
apps/landing                Static Astro project page
packages/contracts          Runtime-validated public DTOs
packages/domain             Medical document domain model
packages/core               Query analysis, retrieval orchestration and rank fusion
packages/storage            Storage/search port and in-memory adapter
packages/storage-sqlite     SQLite WASM adapter, migrations and FTS5
packages/storage-capacitor  Capacitor/native SQLite adapter
packages/search-lexical     Russian normalization and deterministic case planning
packages/search-semantic    Embedding profiles, portable vectors and cosine helpers
packages/test-fixtures      Synthetic test-only content and fixtures
tools/ingest                Source preparation and deterministic content-pack builder
tools/benchmarks            Retrieval and clinical-query benchmark runners
schema                      Shared SQL contract
docs                        Product, ingestion, architecture, roadmap and handoff documents
```
