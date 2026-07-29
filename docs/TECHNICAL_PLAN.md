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

## Runtime corpus edition

The 1.0 runtime reads one immutable curated `core.db` per corpus edition. It contains canonical
searchable chunks and reader payload for the selected clinical, medication, legal, and reference
sources; it is not a claim that every medical source is installed. Individual documents and
categories remain preparation/review/build units, not simultaneously mounted runtime databases.

Every result belongs to the active edition and resolves to the same document version, source checksum,
and anchor in its reader payload. Activation and rollback move one whole-edition pointer. The edition
manifest records source-level rights, jurisdiction, validity/status, and build provenance; unknown or
revoked rights exclude a source from a published edition.

Runtime sharding is deferred until a real edition breaches a measured supported-device budget. See
[ADR 0012](adr/0012-curated-core-edition-before-sharding.md).

## Browser runtime

The browser is the primary target. It uses:

- SolidJS and Vite;
- `MedicalCore` typed contracts;
- FTS5, aliases, and deterministic typo suggestions for the installed edition;
- one SQLite-WASM owner in the Web search worker; its typed RPC also resolves document and context
  reads, so the UI does not mount a second copy of the corpus;
- one native read-only edition on qualified Android/iOS builds; their worker performs query analysis
  only, with an explicit WASM fallback;
- optional local inference only as a separately qualified research feature;
- browser-local storage for preferences, history, bookmarks, installed-module metadata, and the
  explicitly separate personal-note layer; IndexedDB holds durable downloads, mounted packs, and the
  note snapshot mirror plus note-image attachments;
- device-local reminder notifications: Android uses native scheduled notifications, while browsers
  notify only during the lifetime of an open tab. Web Push and a notification backend remain out of
  scope.

The primary navigation remains deliberately small: search, knowledge base, and personal notes.
Documents and the optional local model are knowledge-base subroutes. Search history opens from the
search screen as a drawer rather than becoming a top-level page. The ordinary deterministic search is
immediately usable against all installed sources; source chips refine results. A local model is never
required to interpret or return a search result.

Development and preview servers bind to `127.0.0.1`. Browser automation must not auto-download model
weights unless explicitly enabled.

## Retrieval

1. Validate and normalize the query, including Cyrillic spelling variants, aliases, and bounded drug
   name correction candidates.
2. Extract deterministic patient facts and negative findings.
3. Build bounded weighted query branches.
4. Retrieve lexical candidates from the active edition FTS and drug-name dictionary.
5. Rank by exact/alias match, source eligibility, section, document-title, and validity signals.
6. Group by document and preserve exact chunk navigation.
7. Return an evidence bundle, explicit corpus gap, clarification, or conflict; never synthesise a
   cross-source clinical claim.

Neural-vector retrieval may be evaluated only against this lexical baseline. It cannot become a
release requirement without a real-corpus gain and device qualification.

Acceptance:

- Recall@5 at least `0.90`;
- MRR@5 at least `0.65`;
- section recall at least `0.90`;
- exact context and source metadata resolution `1.00`;
- zero-result rate at most `0.10`;
- every high-risk fact/CTA resolves to a reviewed typed record and exact evidence;
- model failure does not alter deterministic availability.

Current demo and pilot measurements are recorded in `CURRENT_STATE.md`; they do not establish the
real-corpus edition gates above.

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

Before clinical qualification, evaluate each supported model on a real-corpus clinician-reviewed set
and prove a retrieval gain without losing recall. Evaluate:

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

A published edition additionally requires a source-level manifest: document version, raw checksum,
rights/redistribution state, jurisdiction, validity/status, and build provenance. A personal or
owner-provided source compiles into a separately labelled overlay and cannot satisfy an official
clinical claim.

Full source text and structured tables belong in the index pack. For Ministry clinical
recommendations, safe embedded figures also belong in that single SQLite pack and original PDFs are
not published. Other source families may still use optional matching source assets.

## Data updates

The owner selects the trusted documents, either supplied manually or gathered from a declared
official API. Initial ingestion remains local and explicit:

```text
declare source → prepare → inspect diagnostics → lint → build → benchmark → install
```

The runtime validates a new whole edition before activation, retains the previous edition for rollback,
and exposes update status. A source update may not activate a partial mixed-version corpus.

## Milestones toward 1.0

### 1. Validated offline corpus edition

- ingest complete owner-provided documents;
- preserve page/block provenance and tables;
- compile selected approved sources into one versioned `core.db` edition;
- implement FTS, aliases, and deterministic medication typo correction;
- add runtime corpus-specific golden benchmarks.

Done when a clean machine can reproduce the edition, every displayed result opens the expected source
span, no network request follows a completed offline install, and the edition meets measured Web,
Android, and iOS deterministic-search budgets.

### 2. Evidence-backed clinician workflows

- present deterministic evidence bundles, corpus gaps, clarifications, and conflicts instead of
  generated clinical prose;
- deliver GRLS identity plus source-linked medication cards;
- keep personal literature and notes in visibly separate local overlays.

Done when real doctor workflows reach the expected document/version/section/anchor, and personal or
unverified content cannot be mistaken for official evidence.

### 3. Dosing evidence

- ingest sources that contain exact regimens and applicability conditions;
- parse tables without losing units or population constraints;
- show the exact passage and required missing inputs;
- keep patient-specific calculations disabled until reviewed deterministic rules exist.

Done when every displayed dose resolves to a verified source span and strength-only records reliably
abstain.

### 4. Edition updates and optional local-model research

- track owner-selected official source versions;
- stage and checksum new documents;
- show diffs and extraction diagnostics;
- promote only validated whole editions, retain rollback metadata, and expose background-update pause;
- finish local-only patient notes as a separate trust layer, with explicit export/delete controls;
- keep scheduled reminders local: native Android alarms when the app is closed and browser
  notifications only while the tab is open;
- retain note images as local IndexedDB attachments and remove them with their owning note;
- qualify a local model only after it beats the deterministic baseline on clinician-reviewed cases,
  passes exact-evidence/abstention gates, and meets physical-device memory/thermal/latency budgets;
- evaluate optional on-device Russian transcription without sending recordings to a service.

Done when an update cannot silently change the active edition, the previous version remains
recoverable, personal material cannot be confused with an official source, and an unqualified model
remains hidden from clinician workflows.

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
