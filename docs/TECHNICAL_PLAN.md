# Technical plan

This document is the concise target architecture and acceptance plan. Implemented status and ordered
next tasks live in [CURRENT_STATE.md](CURRENT_STATE.md).

## Architecture

```text
SolidJS UI
  → MedicalCore
    → storage and model ports
      → SQLite WASM/native adapters
      → optional local-model adapter

private inputs
  → deterministic preparer
  → provenance-preserving Markdown
  → validator
  → pack builder
  → versioned SQLite
```

Rules:

- UI does not import SQL, SQLite, native plugins, or model-provider SDKs.
- Core does not import SolidJS, Capacitor, or a concrete model runtime.
- Search and exact source navigation work without a model.
- Source material and generated output remain separate.
- SQLite changes use numbered migrations.
- Stable document, section, chunk, and anchor IDs survive rebuilds when the source span is unchanged.
- Content inputs stay declared, checksummed, rights-labelled, and provenance-linked.

## Browser runtime

The browser is the primary target. It uses:

- SolidJS and Vite;
- `MedicalCore` typed contracts;
- SQLite WASM/FTS5 for the default local pack;
- deterministic portable embeddings for hybrid retrieval;
- optional wllama CPU/WASM inference;
- browser-local storage for preferences, history, bookmarks, installed-module metadata, and the
  explicitly separate personal-note layer; IndexedDB holds durable downloads, mounted packs, and the
  note snapshot mirror.

The primary navigation remains deliberately small: search, knowledge base, and personal notes.
Documents and the optional local model are knowledge-base subroutes. Search history opens from the
search screen as a drawer rather than becoming a top-level page. Query analysis selects a confident
scope automatically and asks for a scope only when confidence is insufficient.

Development and preview servers bind to `127.0.0.1`. Browser automation must not auto-download model
weights unless explicitly enabled.

## Retrieval

1. Validate and normalize the query.
2. Extract deterministic patient facts and negative findings.
3. Build bounded weighted query branches.
4. Retrieve lexical candidates from active read-only stores.
5. Retrieve compatible vector candidates when available.
6. Fuse scores with explicit section and document-title signals.
7. Group by document and preserve exact chunk navigation.
8. Optionally rerank only the bounded retrieved IDs.

Acceptance:

- Recall@5 at least `0.90`;
- MRR@5 at least `0.65`;
- section recall at least `0.90`;
- exact context and source metadata resolution `1.00`;
- zero-result rate at most `0.10`;
- model failure does not alter deterministic availability.

Current measured results exceed these gates; see `CURRENT_STATE.md`.

## Clinical model contract

The model may produce only bounded structured JSON. Diagnostic and dose items must cite retrieved chunk
IDs and copy exact source text.

Deterministic code validates:

- schema and length bounds;
- allowed candidate IDs;
- exact excerpt membership;
- same-chunk support for each clinical label, excerpt, and applicable section type;
- diagnosis-label presence;
- treatment category for dose evidence;
- numeric dose plus regimen cue;
- stale-query generation.

The model may not calculate a patient dose, fill missing clinical facts, create a source, or write to a
content pack. A failed validation returns untouched deterministic results.

Before clinical qualification, evaluate each supported model on:

- exact-citation rate;
- unsupported-claim rate;
- correct abstention when evidence is absent;
- negation and missing-input handling;
- Russian extraction quality;
- load time, generation latency, memory, and storage.

## Content pipeline

Inputs are raw source files, official structured JSON, or authored Markdown declared in registries.
The preparer preserves raw checksums and available source spans. Agents may propose extraction JSON or
prepared Markdown, but they do not write production SQLite or silently rewrite source claims.

A publishable pack must pass:

- rights and source-registry validation;
- deterministic preparation;
- Markdown/content lint;
- SQLite integrity and foreign-key checks;
- stable identifier checks;
- retrieval benchmarks;
- version and checksum generation.

Full source text and structured tables belong in the index pack. For Ministry clinical
recommendations, safe embedded figures also belong in that single SQLite pack and original PDFs are
not published. Other source families may still use optional matching source assets.

## Data updates

The owner selects the trusted documents, either supplied manually or gathered from a declared
official API. Initial ingestion remains local and explicit:

```text
declare source → prepare → inspect diagnostics → lint → build → benchmark → install
```

A trusted catalog may advertise newer versions for already selected modules. The runtime validates the
download and checksum before activation, records the previous version for rollback, exposes update
status, and lets the user pause background updates.

## Milestones toward 1.0

### 1. Full local corpus

- ingest complete owner-provided documents;
- preserve page/block provenance and tables;
- build a versioned installable core pack;
- add corpus-specific retrieval benchmarks.

Done when a clean machine can reproduce the pack and every displayed result opens the expected source
span.

### 2. Qualified grounded answers

- benchmark the existing small local models;
- measure exact citations, abstention, latency, and memory;
- refine prompts only where benchmark evidence shows a failure;
- add clinician review for consequential cases.

Done when unsupported clinical output is rejected, the no-model path remains complete, and reviewed
cases show a useful improvement over deterministic ordering alone.

### 3. Dosing evidence

- ingest sources that contain exact regimens and applicability conditions;
- parse tables without losing units or population constraints;
- show the exact passage and required missing inputs;
- keep patient-specific calculations disabled until reviewed deterministic rules exist.

Done when every displayed dose resolves to a verified source span and strength-only records reliably
abstain.

### 4. Selected-source updates and personal overlay

- track owner-selected official source versions;
- stage and checksum new documents;
- show diffs and extraction diagnostics;
- promote only validated packs, retain rollback metadata, and expose background-update pause;
- finish local-only patient notes as a separate trust layer, with explicit export/delete controls;
- evaluate optional on-device Russian transcription without sending recordings to a service.

Done when an update cannot silently change the active corpus, the previous version remains recoverable,
and personal material cannot be confused with an official source.

## 1.1 idea: portable Rust core and terminal client

After the browser-first 1.0 gates are met, evaluate a portable Rust implementation of the stable
`MedicalCore` contracts. The first deliverable is a non-interactive JSON CLI for deterministic search,
pack verification, benchmarks, and automation; an optional terminal UI may follow.

This is not a 1.0 release gate and must not become a big-bang rewrite. The current TypeScript core stays
the reference until shared golden fixtures and differential tests demonstrate equivalent search,
source navigation, provenance, errors, offline fallback, and rollback behavior.

## Non-goals

- a Rust runtime migration before the 1.1 evaluation;
- Tauri, Postgres, Docker, telemetry, accounts, cloud sync, or a hosted backend;
- Android/iOS parity during the browser-first phase;
- autonomous diagnosis or prescribing;
- generated prose replacing original medical sources;
- automatic ingestion of arbitrary online medical content.
