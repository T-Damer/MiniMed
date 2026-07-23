# MiniMed

MiniMed is an offline-first search and evidence assistant for medical source material. A clinician can
paste a patient case, search a local SQLite corpus, open the exact source fragment, and optionally use a
small local model to reorder results and extract source-linked diagnostic or dosing evidence.

The application remains useful with no network, model, account, or hosted backend.

## Current boundary

Implemented:

- Russian case-query parsing, including negative findings and missing-field prompts;
- local SQLite/FTS5 and deterministic vector retrieval;
- exact document, section, chunk, anchor, and neighboring-context navigation;
- installable read-only content-module contracts;
- optional browser-local GGUF inference;
- model-assisted reranking and exact-source clinical extraction;
- deterministic rejection of invented citations and unsupported dose text.

The public pilot contains 15 source-linked navigation cards: seven clinical recommendations and eight
official medication-registry identity records. These cards are enough to test retrieval, but they are
not complete clinical sources. In particular, the installed pilot does not contain verified dosing
regimens.

See [PRODUCT.md](docs/PRODUCT.md) for the product contract,
[CURRENT_STATE.md](docs/CURRENT_STATE.md) for implemented status, and
[TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md) for the ordered plan.

## Quick start

Requirements:

- Bun 1.2.3;
- Python 3.12+ and `uv` for content tooling;
- Chromium for browser tests.

Install only locked dependencies:

```bash
bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
```

Run the web app:

```bash
bun run dev
```

Local servers must bind to `127.0.0.1`. Run app, test, and build processes from a sanitized environment
that does not inherit provider credentials, release tokens, private-corpus paths, or upload targets.
Local-model downloads are optional and disabled in browser automation unless explicitly enabled.

## Verification

```bash
bun run check
bun run typecheck
bun run test
bun run build
bun run python:check
bun run benchmark:all
bun run native:source:check
```

Build and benchmark the public Russian pilot:

```bash
bun run content:lint:pilot
bun run content:build:pilot
bun run benchmark:pilot
```

The generated database and reports live under `data/build/` and are intentionally ignored by Git.
Never hand-edit generated SQLite or JSON packs.

## Add private documents

Private inputs remain outside Git:

```bash
bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

The deterministic preparer accepts declared Markdown, text-layer PDF, and OCR text inputs. It preserves
checksums and page/block or line provenance before the pack builder creates SQLite.

Do not commit source documents, patient data, model weights, credentials, or generated private packs.

## Repository map

```text
apps/app/                 SolidJS browser application
apps/landing/             Static project page
packages/contracts/       Public typed contracts
packages/core/            MedicalCore orchestration and retrieval fusion
packages/search-lexical/  Russian query analysis
packages/search-semantic/ Deterministic portable vector profile
packages/storage*/        Store ports and SQLite/native adapters
content/                  Public authored and synthetic fixture sources
tools/ingest/             Deterministic content pipeline
tools/benchmarks/         Retrieval and clinical-case benchmarks
docs/                     Product, architecture, and operating contracts
```

Dependency direction is:

```text
UI → MedicalCore → ports → adapters

private sources → deterministic preparer → Markdown/provenance → pack builder → SQLite
```
