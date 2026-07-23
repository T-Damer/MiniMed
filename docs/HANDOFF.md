# Handoff — LocalMed Search `0.3.0-alpha.1`

Snapshot date: 18 July 2026.

## Product boundary

The current alpha is a fully local retrieval application over a synthetic corpus. It accepts a long
Russian clinical description, extracts searchable facts without a generative model, searches a
precompiled SQLite pack through FTS5 and a local vector path, and opens the original source at an
exact chunk/section anchor.

It is not a diagnostic system and the included fixture text is not clinical guidance.

## Implemented runtime

```text
long Russian case
→ deterministic local facts, negations, uncertainty, and suggestions
→ several weighted query branches
→ lexical candidates: SQLite FTS5 / BM25
→ local query vector: portable 384-dimensional int8 profile
→ exact filtered cosine scan
→ hybrid fusion with explicit diagnostics
→ document / section / chunk / stable anchor
→ neighboring original source context
```

Implemented components:

- SolidJS archive-style application and Astro landing;
- typed `MedicalCore`, storage ports, runtime-validated DTOs, and explicit error results;
- SQLite WASM browser adapter and Capacitor native-storage contract;
- deterministic query analyzer with source character ranges and explicit negatives;
- `embedding_profiles` and `chunk_embeddings` schema migration;
- one precomputed vector per chunk and local query-only embedding;
- exact vector search in memory, SQLite WASM, and Android/iOS Capacitor plugins;
- `auto`, `lexical`, `semantic`, and `hybrid` modes;
- exact profile compatibility and complete lexical fallback;
- active retrieval mode, profile, lexical score, and semantic score in the UI;
- private PDF/TXT/Markdown preparation tooling from `0.2.2`.

## Important limitation of the current embedding profile

`localmed.feature-hash.384.v1` is deterministic feature hashing over Russian word, bigram, and
character features. It exists to verify the portable vector architecture. It is marked
`development` and must not be described as a neural or medically intelligent embedding model.

See [`SEMANTIC_RETRIEVAL.md`](SEMANTIC_RETRIEVAL.md) and
[`adr/0008-portable-int8-vector-profile.md`](adr/0008-portable-int8-vector-profile.md).

## Verified in this environment

- dependency installation from the available package mirror;
- Biome over 100 files;
- strict TypeScript/Astro typecheck across 12 workspace projects;
- 28 Vitest tests;
- 13 ingestion tests;
- Ruff formatting/lint and strict Pyright;
- deterministic content build with SQLite integrity and zero foreign-key violations;
- 15/15 chunk vectors and cross-language golden-vector parity;
- Vite and Astro production builds;
- real Chromium Playwright E2E against the built application;
- 30-query hybrid benchmark with Recall@1/5 and MRR@5 equal to 1.0 on synthetic fixtures;
- hybrid and semantic path usage equal to 1.0 across those 30 queries;
- five long-case regression fixtures passing;
- native bridge method/source parity plus a TypeScript hydration regression test, peer dependencies,
  and secret scan.

The complete one-command verifier is phase-isolated with per-phase timeouts. This chat environment
limits a single command to roughly 100 seconds, so the later phases were also run independently.

## Not yet verified

- retrieval quality on real Russian clinical recommendations;
- a genuine compact neural embedding model;
- Android Gradle and iOS Xcode compilation for the current alpha tree;
- physical-device SQLite/FTS5/vector latency, memory, battery, and process-recovery behavior;
- NPU execution;
- ANN at realistic corpus scale;
- cloud answer synthesis;
- OCR and complex-table reconstruction for scanned source documents.

## First commands after checkout

```bash
corepack enable
bun install --frozen-lockfile
bun run content:sync
bun run verify
bun run test:e2e
```

`playwright.config.ts` uses `CHROMIUM_PATH` when provided and automatically recognizes
`/usr/bin/chromium` in Linux development containers.

## Next milestone

1. Import 5–10 real recommendations through the private source registry.
2. Author 50–100 physician-owned expected-document/section queries.
3. Benchmark lexical-only versus the portable scaffold.
4. Spike compact multilingual neural models and freeze one reproducible profile only if it improves
   the real golden set within mobile latency/memory budgets.
5. Build and install the Android APK, then measure the exact native scan on a physical device.
