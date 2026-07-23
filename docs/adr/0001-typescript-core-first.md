# ADR-0001: TypeScript core first

- Status: superseded for new clinical orchestration by [ADR-0010](0010-portable-rust-clinical-core.md)
- Date: 2026-07-16

## Context

The main early risks were source ingestion, search quality, exact navigation, and mobile integration—not JavaScript execution speed. SQLite and model runtimes already executed in native/WASM code.

## Decision

Keep orchestration and public contracts in strict TypeScript for the initial retrieval MVP. UI depends on `MedicalCore`; concrete storage and future model adapters are injected at the composition root.

Rust was initially deferred until profiling demonstrated a bottleneck or one portable native core became clearly cheaper than maintaining TypeScript plus platform adapters.

## Consequences

- The decision enabled faster iteration and one language across the initial UI/contracts/retrieval slice.
- The current TypeScript core remains the reference implementation during the Rust parity migration.
- The expanded cross-platform case, graph, rule, and calculation scope now satisfies the portability trigger; ADR-0010 governs new clinical orchestration.
- Native SQLite, model/NPU, filesystem, and secure-storage access still require platform-specific adapters.