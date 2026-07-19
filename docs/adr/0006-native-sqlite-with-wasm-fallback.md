# ADR-0006: Native SQLite on mobile with a WASM fallback

- Status: accepted
- Date: 2026-07-17

## Context

The browser can deserialize the generated SQLite pack into SQLite WASM, but a mobile application
needs persistent private storage and should not rebuild the runtime database on every launch.
Platform SQLite capabilities, especially FTS5 availability, can differ by OS release and vendor.

## Decision

Add `CapacitorMedicalStore` behind the existing `MedicalStore` port. Android and iOS plugins copy a
checksum-addressed bundled pack into private app storage, open it read-only, verify integrity, and
probe the actual FTS5 query path. If the native path fails, application composition opens the same
pack through the existing SQLite WASM adapter.

The native bridge remains read-only and intentionally narrow. The portable TypeScript core retains
query analysis, SQL selection, ranking, mapping, and source navigation.

## Consequences

- a successful mobile launch reuses a persistent SQLite file;
- web and mobile consume the same generated schema and pack;
- system SQLite incompatibility degrades to WASM rather than breaking the app;
- two storage adapters must pass the same contract tests;
- physical-device performance, process-death, and interrupted-update tests remain release gates;
- future signed downloadable packs need a dedicated installer API, not arbitrary SQL writes.
