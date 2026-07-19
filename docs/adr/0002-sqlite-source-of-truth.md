# ADR-0002: SQLite is the local source of truth

- Status: accepted
- Date: 2026-07-16

## Context

The application must work offline, ship modular knowledge packs, and navigate from a result to an exact section or chunk without running a database server.

## Decision

Use SQLite for documents, versions, sections, chunks, aliases and metadata. Use FTS5/BM25 as the first retrieval index. Vector search remains an optional derived index introduced only after lexical retrieval has a measured baseline.

The web runtime opens a precompiled SQLite pack with SQLite WASM. A deterministic JSON seed remains a recovery fixture. Version 0.2.1 adds a native mobile adapter with an explicit WASM fallback; physical-device verification remains a release gate.

## Consequences

- Content packs are portable files and can be rebuilt deterministically.
- No Postgres/pgvector process is required on the device.
- The FTS5 smoke test must be repeated for the final Android/iOS native adapter.
