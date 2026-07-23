# AGENTS.md

Mandatory reading for coding and data agents.

## Product invariant

LocalMed Search is an offline-first navigator over medical source material. Retrieval happens
before generation. The current product must remain useful with no network, no LLM, and no hosted
backend.

## Planning authority

- `docs/TECHNICAL_PLAN.md` defines the target architecture, milestones, and acceptance criteria.
- `docs/CURRENT_STATE.md` records the implemented state and ordered next tasks.
- When the two differ, preserve the architecture invariant and update `CURRENT_STATE.md` rather than
  pretending a planned capability already exists.

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

1. Read `docs/CURRENT_STATE.md`, the relevant issue/milestone, and architecture/ADR files.
2. Confirm that the task follows the current execution order or explain the dependency that justifies
   changing it.
3. Find the existing public contract and tests.
4. Check dependency direction and offline fallback behavior.
5. Add no library when the current stack can solve the task.
6. For content work, identify whether the input is raw, prepared, or generated. Never hand-edit a
   generated SQLite/JSON pack.

## Local execution

- Use the repository-pinned Bun version for JavaScript commands and CI. Keep explicit Node commands
  only where a tool is incompatible with Bun, and document that fallback.
- Before running project code, use a sanitized environment containing only required, documented
  non-secret values. Do not inherit provider credentials, release tokens, private-corpus paths, or
  upload destinations into local app, test, build, or browser processes.
- Bind local browser development servers to `127.0.0.1`; do not expose them on the LAN unless the user
  explicitly requests it.

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
- Update `docs/CURRENT_STATE.md` when a change affects behavior, corpus coverage, trust boundaries,
  benchmark composition, or ordered next tasks.

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
bun run check
bun run typecheck
bun run test
bun run build
bun run python:check
bun run benchmark:all
bun run native:source:check
```

For private corpus tooling also run:

```bash
bun run content:prepare:private
bun run content:lint:private
bun run content:build:private
```

State honestly which dependency suites, native SDKs, physical devices, and real source documents
were not tested.
