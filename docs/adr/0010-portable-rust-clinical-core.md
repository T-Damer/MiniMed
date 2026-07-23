# ADR-0010: Portable Rust clinical core

- Status: superseded
- Date: 2026-07-21
- Supersedes: ADR-0001 for new clinical orchestration
- Superseded by: browser-first TypeScript plan, 2026-07-24

## Supersession note

The product no longer targets cross-platform parity or a Rust migration before 1.0. The existing
TypeScript `MedicalCore` remains the portable contract while browser retrieval, local document
ingestion, and grounded model extraction are the active priorities. This ADR is retained as historical
context; its migration plan is not scheduled.

## Context

ADR-0001 selected a TypeScript-first core because the early risks were ingestion, retrieval quality, exact source navigation, and mobile integration. That decision enabled the current vertical slice quickly.

The product target now includes a persistent case workspace, runtime knowledge graph, clinical and regulatory rules, dose calculations, local model orchestration, and the same behavior across web, desktop, Android/iOS, and CLI. Maintaining these semantics independently through TypeScript plus platform bridges is likely to be more expensive and riskier than one portable core.

Rust is therefore a portability and contract-consistency requirement, not merely a performance optimization.

## Decision

Develop the second-generation clinical core in Rust behind versioned, runtime-validated DTOs.

The Rust core owns platform-neutral behavior:

- domain entities and provenance;
- patient/episode/workspace state transitions;
- query planning and intent handling;
- graph traversal and applicability filtering;
- lexical/vector result fusion and evidence assembly;
- deterministic clinical, drug, calculation, and regulatory rule interfaces;
- local-assistant orchestration policies and fallback behavior.

The following remain outside the portable core:

- SolidJS presentation and browser interaction;
- PDF/XML/CSV/OCR ingestion, which remains Python tooling;
- concrete SQLite, filesystem, secure-storage, embedding, and LLM runtimes;
- platform installation, permissions, and lifecycle code.

Target bindings:

```text
web      → Rust/WASM
 desktop  → native Rust, initially through Tauri or a thin host
 Android  → UniFFI/JNI or a thin Capacitor-native binding
 iOS      → UniFFI/Swift binding
 CLI      → direct Rust crates
```

The public core contract must not expose Rust-specific ownership, SQL, model tensors, or platform SDK types.

## Migration

1. Define core-v2 DTOs and golden fixtures independently of either implementation.
2. Keep the existing TypeScript core as the reference implementation for current retrieval behavior.
3. Port pure functions first: normalization, case state, graph traversal, ranking, and evidence assembly.
4. Run identical contract, corpus, and benchmark suites against TypeScript and Rust implementations.
5. Introduce rules and calculations in Rust rather than duplicating new clinical semantics in TypeScript.
6. Switch each platform through a feature flag only after parity, error mapping, and performance checks.
7. Remove duplicated TypeScript orchestration only after migration and rollback tests pass.

## Consequences

- Web and native applications can share clinical semantics and local data contracts.
- Rust/WASM may increase web package complexity, so lexical fallback and startup budgets remain release gates.
- Platform-specific model and storage adapters are still required.
- The migration costs more than continuing the current TypeScript slice, but avoids multiplying the future graph, rule, and case engines across platforms.
- Existing stable source, document, section, chunk, anchor, and pack identifiers remain unchanged.
