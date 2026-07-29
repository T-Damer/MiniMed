# Testing strategy

## Commands

```bash
bun run check             # Biome format + lint
bun run typecheck         # TypeScript and Astro
bun run test:unit         # Vitest
bun run python:check      # Ruff, strict Pyright, pytest
bun run build             # schemas + app + landing
bun run benchmark:all     # compact hybrid + long lexical cases
bun run secrets:check
bun run verify
CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e
```

## Unit and contract coverage

- Unicode/Russian normalization, stemming, aliases, FTS query escaping;
- age/sex/duration/temperature/measurement extraction;
- negation and uncertainty handling;
- branch construction and suggestions;
- strong-match rank-fusion regression;
- snippets and highlight ranges;
- patient-card validation, nested-note deletion/search, and follow-up reminder ordering/completion;
- deterministic note categorization and installed-document cross-link segmentation;
- worker search delegation/fallback and automatic scope inference;
- module/model retry behavior and persisted partial-download recovery;
- model catalog, selection, structured output, and grounded-result validation;
- `MedicalCore` behavior over the shared storage contract;
- native Capacitor row mapping, read-only FTS query shape, backend diagnostics, and fallback boundary;
- deterministic IDs, anchors, Markdown parsing, chunking, and hidden provenance markers;
- PDF/TXT registry preparation, repeated marginalia removal, heading detection, path traversal
  rejection, extraction diagnostics, and source checksum propagation.

## Ingestion integration

Python tests generate a multi-page PDF at runtime with repeated headers, numbered headings, body
text, and page-number footers. They verify removal/classification, build-ready Markdown, page/block
provenance, atomic registry preparation, path-root enforcement, and a searchable SQLite build. A
separate TXT test verifies line provenance. Real recommendations still require a private pilot and
manual inspection of parser diagnostics.

## SQLite integration

- SQLite WASM module, FTS5 availability, and embedding-profile migrations;
- seed installation and direct `.db` deserialization;
- BM25 search, exact int8 cosine search, and filters;
- exact section/chunk/context navigation;
- integrity check, foreign keys, and FTS row parity.

## Retrieval benchmarks

`tools/benchmarks/queries.json` contains 30 compact synthetic queries. The runner records Recall@1,
Recall@5, MRR@5, zero-result rate, latency, hybrid usage, and semantic-path usage.

`tools/benchmarks/clinical-cases.json` contains long descriptions with expected facts, branches,
negations, warnings, and a rank-1 target document. Its purpose is to catch query-planning and
fusion regressions.

Neither benchmark estimates clinical quality. A real corpus requires a separate physician-authored
golden set that is not identical to tuning cases.

## Corpus-edition release validation

The demo benchmark is not a release claim for the installed corpus. Every `core.db` edition needs a
separate, versioned golden set of synthetic/de-identified clinician scenarios written against the
approved source coverage, not copied from tuning queries. A case records expected document version,
section, anchor, trust tier, and expected safe state (`evidence`, `gap`, `clarification`, or
`conflict`).

The edition gate requires:

- at least 120 scenarios across diseases, medications, laws/norms, typo/alias lookup, and compound
  workflows;
- Recall@5 at least `0.95` for covered scenarios, with no ineligible/superseded source ranked as the
  current answer;
- exact document-version, section, context, and anchor resolution `1.00`;
- `0` high-risk dose, contraindication, interaction, or antibiogram CTAs without a typed reviewed
  record and exact evidence;
- typo candidates that never silently merge an ambiguous medication/form/strength;
- no result from a personal, unverified, or rights-blocked overlay inside the official result
  container.

Run the golden set through the same `MedicalCore` composition used by the application, not only
through tester-box's disposable FTS index. Tester-box remains useful for model-contract experiments,
but it must use synthetic/de-identified prompts because it persists runs and model output.

## Edition and platform gates

Before shipping an edition, validate its source-level manifest, SQLite integrity/foreign keys/FTS row
parity, whole-edition checksum, and atomic `A → B → A` rollback. Interrupted download, invalid
manifest, revoked/unknown rights, worker restart, and absent reader payload must leave the preceding
edition searchable; they must never produce a stale or unopenable result.

Record the following on supported physical devices with the full approved edition and no local model:

- offline cold start at most 5 s;
- lexical P95 at most 750 ms for all-source queries and 500 ms for scoped queries;
- peak RSS at most 600 MB on an 8 GB device;
- 30 airplane-mode searches with no outgoing request after installation;
- ten interrupted update/rollback drills per platform.

These are release gates, not source-level simulations. iOS deterministic search is unsupported until
the native edition path passes them.

## Browser E2E

Playwright builds the production bundle and verifies the offline workspace in Chromium:

1. mount the built application without a hosted API;
2. verify immediately available deterministic search, source refinement, typo/alias suggestion, and
   exact source context;
3. use the history drawer and preserve mounted view state across bottom-navigation changes;
4. read documents, expand source context, and exercise the live module lifecycle;
5. create, edit, nest, search, and delete personal notes outside the official results container;
6. create and complete follow-up reminders and verify the due badge;
7. exercise responsive navigation and the knowledge-base/model subroutes without downloading model
   weights.

## Native source checks

`bun run native:source:check` validates plugin method parity, Android/iOS registration, read-only open
flags, integrity/FTS5 probes, backup/recovery markers, Xcode SQLite linkage, and the SHA-256 of the
packaged database.

This is a source-level guard, not a substitute for compiling against real mobile SDKs.

## Native release gates

Before claiming a mobile release:

- cold start in airplane mode;
- native FTS5 availability;
- pack persistence after restart/process death;
- background/foreground and memory pressure;
- atomic pack update/recovery;
- Android WebView and iOS WKWebView/device matrix;
- recorded p50/p95 latency and memory;
- no query/source text in platform logs.

These physical-device checks are not available in the current container.
