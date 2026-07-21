# Product brief

## Purpose

MiniMed is an offline-first medical knowledge workspace for Russian clinical practice and medical learning. It accepts a free-form question or detailed patient description, preserves the original text, finds exact source fragments, expands the request through reviewed entities and relations, asks decision-changing clarifications, and can use a small local model to assemble an evidence-grounded result.

It is a retrieval, knowledge-navigation, and clinical-workspace product before it is a chat product. Network access, a hosted backend, and a generative model are optional rather than prerequisites.

The detailed one-window flow is defined in [`CLINICAL_WORKSPACE.md`](CLINICAL_WORKSPACE.md).

## One-window product loop

A user works in one continuing search surface:

```text
free text
→ search history and intent
→ optional patient / episode context
→ source and knowledge retrieval
→ clarifying questions
→ deterministic rules and calculations
→ local evidence-grounded synthesis
→ exact source navigation
```

A general learning query remains a normal thread. A patient-specific query can create or continue a local clinical episode. Possible patient matches, episode continuations, and semantically similar cases are separate suggestions and are never merged automatically.

## Current implemented boundary — 0.3.0-alpha.6

Without an LLM or network call, the application can:

- preserve a long Russian-language narrative;
- extract a transparent case card with source-linked facts, negation, and uncertainty;
- classify diagnostic, treatment, medication, disease-reference, care, and administrative intent;
- build several weighted lexical branches;
- search a precompiled local SQLite/FTS5 pack and compatible local vector projection;
- reuse the pack through native Android/iOS SQLite or SQLite WASM fallback;
- explain retrieval mode, branches, and lexical/semantic scores;
- group candidates by document and clinical section category;
- open the exact source chunk, neighbors, and full section;
- save local search history and bookmarks.

The ingestion toolchain preserves page/block or line provenance and can create proposed entities, medication profiles, facts, relations, document links, and review tasks. Only reviewed structured knowledge enters the searchable projection.

The committed public corpus remains a small source-linked pilot. The current portable vector profile validates the retrieval mechanics and is not a neural medical model.

## Required capabilities before 1.0

The personal stable edition should prove the complete architecture on representative specialties rather than claim complete coverage of medicine:

- diseases, symptoms, investigations, drugs, interventions, administrative concepts, and explicit relations available at runtime;
- a local patient/episode workspace with provenance, clarifications, and no automatic case merging;
- layered case output covering urgency, uncertainty, diagnosis, investigations, treatment, follow-up, and administrative implications;
- structured medication rules, interaction checks, and deterministic patient-specific calculations;
- Russian clinical, drug, and regulatory source packs with versions, validity, authority, and cross-source conflicts;
- local embeddings, reranking, structured case extraction, and evidence-grounded synthesis with deterministic fallback;
- a portable Rust core shared by web, desktop, Android/iOS, and CLI targets while UI and ingestion remain replaceable adapters;
- exact navigation from every material assertion to a reviewed fact, calculation, or source fragment;
- content-pack update, integrity, rollback, and reproducible retrieval benchmarks.

Optional cloud synthesis may exist, but it is not a prerequisite for the primary workflow or release sequence.

## Product invariants

- Offline retrieval and source navigation remain useful with every model adapter disabled.
- Original source and user text are not silently rewritten.
- Source statements, clinician assertions, calculations, and model proposals have visibly different provenance.
- A model cannot create a trusted medical fact, silently choose a dosing rule, or determine legal validity.
- Russian source authority and jurisdiction are explicit; WHO and other international material can be referenced, adapted, supplemented, or contrasted without automatically replacing Russian rules.
- UI never owns SQL, clinical rules, or provider-specific model logic.
- Optional model, pack, or platform failures cannot block source access.
- Patient text is absent from fixtures, logs, analytics, and release artifacts.
- Similar symptoms may suggest a related case but cannot establish patient identity.

## Initial users and non-goals

Initial users are the owner, medical students, and a small invited group of physicians. Before 1.0 MiniMed is not:

- an autonomous diagnostic or prescribing system;
- a replacement for clinical judgment or the current original source;
- a certified medical device;
- a hospital EMR or account/synchronization service;
- a mandatory backend;
- a promise of complete medical or regulatory coverage;
- a universal local-LLM runtime.

The patient workspace is a private local clinical notebook until encryption, export/delete, identity handling, and real-world validation meet a separately documented release gate.

## Success metrics

- every displayed claim resolves to reviewed evidence, a deterministic calculation, or an explicitly labelled user/model assertion;
- every result resolves to an existing version, section, chunk, and anchor;
- no clinical query leaves the device in the default path;
- the system identifies critical missing data and asks fewer, more decision-relevant questions than a generic form;
- time from query to a useful action or source paragraph beats manual PDF/web navigation;
- lexical-only, hybrid, and local-assistant paths are measured on the same physician-authored golden set;
- physicians can distinguish source text, Russian applicability, international context, calculations, and generated synthesis;
- a failed optional feature never blocks source access or corrupts a patient episode.