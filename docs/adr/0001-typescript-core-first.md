# ADR-0001: TypeScript core first

- Status: accepted
- Date: 2026-07-16

## Context

The main pre-1.0 risks are source ingestion, search quality, exact navigation, and mobile integration—not JavaScript execution speed. SQLite and model runtimes already execute in native/WASM code.

## Decision

Keep orchestration and public contracts in strict TypeScript for the MVP. UI depends on `MedicalCore`; concrete storage and future model adapters are injected at the composition root.

Rust is introduced only after profiling demonstrates a real bottleneck or when one portable native core is clearly cheaper than maintaining TypeScript plus platform adapters.

## Consequences

- Faster iteration and one language across UI/contracts.
- Rust remains possible behind the same contracts.
- Native SQLite, NPU and secure-storage access still require platform-specific adapters later.
