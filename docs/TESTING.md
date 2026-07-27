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

## Browser E2E

Playwright builds the production bundle and verifies the offline workspace in Chromium:

1. mount the built application without a hosted API;
2. verify automatic/ambiguous search scopes, `FTS5 + VECTOR`, and exact source context;
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
