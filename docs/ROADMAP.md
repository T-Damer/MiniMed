# Roadmap

The detailed product plan is in [`TECHNICAL_PLAN.md`](TECHNICAL_PLAN.md). The one-window clinical flow is defined in [`CLINICAL_WORKSPACE.md`](CLINICAL_WORKSPACE.md). This file records the intended delivery order and the implemented boundary.

## 0.0.1–0.0.3 — foundation — complete

- pnpm monorepo, SolidJS/Vite, Capacitor shells, Astro landing;
- strict TypeScript, Biome, Vitest, Ruff, Pyright, GitHub Actions;
- runtime-validated contracts, `MedicalCore`, storage ports and adapters;
- deterministic Markdown corpus builder, stable IDs/anchors, SQLite/FTS5 and integrity reports.

## 0.1.0 — useful lexical vertical slice — complete

- one free-form field up to 20,000 characters;
- Russian normalization and aliases;
- FTS5/BM25, snippets, grouping, source context;
- library/status views, history, benchmark, and browser E2E.

## 0.2.0 — clinical query core and archive UI — complete

- deterministic extraction of age, sex, duration, temperature, measurements, investigations, medications, locations, epidemiology, and explicit negations;
- source ranges, uncertainty warnings, and clickable missing-field suggestions;
- multiple weighted query branches and explainable diagnostics;
- direct loading of the compiled SQLite pack;
- local bookmarks, search history, source reader, and archive UI;
- long-case retrieval regression benchmark.

## 0.2.1–0.2.2 — native persistence and private ingestion — implemented; real corpus/device validation pending

- native Android/iOS read-only SQLite adapters with integrity/FTS5 probing and WASM fallback;
- private PDF/TXT/Markdown preparation with source spans and diagnostics;
- cached source synchronization and deterministic pack rebuild;
- physical device persistence/performance checks and a representative private corpus remain open.

## 0.3.0 — hybrid retrieval and structured knowledge foundation — alpha implemented

- immutable embedding profiles and per-chunk int8 vectors;
- lexical, semantic, hybrid, and automatic retrieval modes;
- Russian query-intent classification and deterministic case extraction;
- relational entities, medication profiles, facts, weighted relations, exact evidence, document links, and review tasks;
- AI proposal export/import with exact-evidence validation and reviewed-only search projection;
- source-linked public clinical and medication pilots.

Still required before stable `0.3.0`:

- a compact multilingual neural embedding spike with a Russian medical benchmark;
- real-corpus latency, size, memory, and battery measurements;
- runtime entity/knowledge cards rather than projection-only retrieval;
- physical Android/iOS validation.

## 0.4.0 — runtime knowledge graph

- condition, symptom, investigation, drug, intervention, document, and administrative entities available through the core;
- aliases, typed facts, outgoing/incoming relations, source links, authority, jurisdiction, validity, and review state;
- graph expansion during retrieval without replacing direct lexical evidence;
- runtime cards and exact navigation from entities and relations to evidence;
- explicit conflict and missing-evidence presentation;
- Russian-first source ranking with international source lineage.

## 0.5.0 — one-window case workspace

- persistent `WorkspaceThread`, optional `PatientProfile`, and separate `ClinicalEpisode`;
- automatic distinction between learning queries, new episodes, episode continuations, and mixed requests;
- explicit separation of possible patient match, episode continuation, and semantically similar case;
- no automatic patient or episode merging;
- fact provenance, clinician confirmation, uncertainty, contradictions, and decision-linked clarification questions;
- layered case output: urgency, known facts, missing data, hypotheses, investigations, treatment, follow-up, regulation, and sources;
- temporary no-save mode, local encryption design, export/delete, and no clinical logs/telemetry.

## 0.6.0 — portable Rust core

- versioned core-v2 DTOs and golden contract tests;
- Rust domain, case state, query planning, graph traversal, ranking fusion, evidence assembly, and rule interfaces;
- WASM target for web, native target for desktop/CLI, and thin Android/iOS bindings;
- parity mode with the TypeScript implementation until the same fixtures and benchmarks pass;
- UI remains SolidJS/TypeScript; ingestion remains Python; model and platform runtimes remain adapters;
- TypeScript clinical orchestration is removed only after parity and migration tests.

## 0.7.0 — drug, rule, and calculation engine

- structured indication/population/route/form/strength/dose/duration/maximum rules;
- deterministic weight, body-surface-area, renal/hepatic, age, and concentration calculations where supported by reviewed sources;
- contraindication, interaction, duplicate-ingredient, monitoring, and treatment-response checks;
- missing-input detection instead of guessed values;
- calculation trace showing inputs, formula, limits, rounding, source version, and applicability;
- specialty-neutral rule API with high-risk content review policy.

## 0.8.0 — Russian regulatory and source-comparison packs

- regulatory acts, orders, standards, care procedures, drug instructions, and clinical recommendations as distinct document classes;
- issuing authority, jurisdiction, effective dates, amendments, repeal/supersession, paragraph/table anchors, and target populations;
- conditional administrative implications linked to the medical criteria and evidence required;
- `references`, `classification_based_on`, `adapts`, `supplements`, `differs_from`, and `supersedes` relations;
- comparison of document versions and conflicting clinical/drug/regulatory statements;
- clinical and administrative conclusions displayed separately.

## 0.9.0 — local assistant and private beta

- local structured-output model for ambiguous case extraction and clarification drafting;
- local evidence-grounded synthesis over reviewed facts, rules, calculations, and selected source chunks;
- model applicability, limitations, active retrieval tier, and source coverage visible in layered UI;
- deterministic fallback at every stage;
- 100–200 deidentified physician-style scenarios covering common and specialty-specific workflows;
- closed testing with students and several physicians, local feedback export, and safety/retrieval regression gates.

Optional BYOK cloud synthesis may be added behind the same evidence contract, but it is not on the critical path to 1.0.

## 1.0.0 — stable personal edition

The release proves a complete offline workflow on a representative, explicitly incomplete corpus:

- reproducible clinical, medication, and regulatory content packs;
- local one-window search and patient/episode workspace;
- runtime knowledge graph and exact provenance;
- hybrid retrieval with lexical fallback;
- reviewed drug/rule calculations;
- local structured assistance and evidence-grounded synthesis on supported devices;
- portable Rust core for web, desktop, Android/iOS, and CLI targets;
- pack update, integrity, rollback, export/delete, and recovery;
- measured retrieval and task success on the same golden scenarios;
- no mandatory account, backend, network, or cloud model.

A complete medical ontology, hospital EMR integration, cross-device synchronization, unrestricted patient record storage, autonomous diagnosis/treatment, and universal specialty coverage remain outside the 1.0 claim.