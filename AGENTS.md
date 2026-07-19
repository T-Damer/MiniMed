# AGENTS.md

Mandatory reading for coding and data agents.

## Product invariant

LocalMed Search is an offline-first navigator over medical source material. Retrieval happens
before generation. The current product must remain useful with no network, no LLM, and no hosted
backend.

## Dependency direction

```text
UI → MedicalCore → ports → adapters

private sources → deterministic preparer → Markdown/provenance → pack builder → SQLite
```

Forbidden without a dedicated ADR:

- UI importing SQL, SQLite, native plugins, or provider SDKs;
- core importing SolidJS, Capacitor, or a concrete AI provider;
- generated model text replacing original source material;
- an agent writing arbitrary SQL into a released content pack;
- adding Rust, Tauri, Postgres, Docker, telemetry, or a backend;
- committing private source documents, patient data, API keys, or model weights.

## Before editing

1. Read the relevant issue/milestone and architecture/ADR files.
2. Find the existing public contract and tests.
3. Check dependency direction and offline fallback behavior.
4. Add no library when the current stack can solve the task.
5. For content work, identify whether the input is raw, prepared, or generated. Never hand-edit a
   generated SQLite/JSON pack.

## Coding rules

- Implement the smallest complete vertical slice.
- Keep business logic outside Solid components.
- Validate untrusted data at package boundaries.
- Never log clinical query text, secrets, source-document contents, or raw native SQL arguments.
- Change SQLite only through a numbered migration.
- Preserve stable document, section, chunk, and anchor identifiers.
- Preserve raw-file checksum and source spans when transforming authoring artifacts.
- Reject source paths that escape the configured private root.
- Do not catch and discard errors.

## Data-agent rules

- Work on extraction JSON or prepared Markdown, not the production database.
- Do not summarize or harmonize source claims unless the task explicitly creates a separate draft
  artifact.
- Keep every proposed structure/category traceable to source block/page or line ranges.
- Mark table, OCR, missing-text, and contradictory-source problems instead of silently repairing
  them.
- Never remove an original paragraph merely because it looks irrelevant to one query.

## Formatting and checks

TypeScript uses Biome and strict TypeScript. Python uses Ruff formatting/lint, strict Pyright, and
pytest. Before reporting completion run the applicable commands:

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm python:check
pnpm benchmark:all
pnpm native:source:check
```

For private corpus tooling also run:

```bash
pnpm content:prepare:private
pnpm content:lint:private
pnpm content:build:private
```

State honestly which dependency suites, native SDKs, physical devices, and real source documents
were not tested.
