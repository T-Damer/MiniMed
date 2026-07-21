# Product brief

## Purpose

LocalMed Search is an offline-first navigator over a curated Russian medical corpus. It is a retrieval
and exact source-navigation product before it is a chat product.

The target architecture and milestones live in `docs/TECHNICAL_PLAN.md`. The implemented state and
ordered next tasks live in `docs/CURRENT_STATE.md`.

## Version 0.3.1 outcome

A user can paste a long Russian-language case description. Without an LLM or network call, the app can:

- preserve the full original narrative;
- extract a transparent case card and keep the raw text in every search path;
- distinguish common explicit negative findings from positive search concepts;
- suggest missing fields without forcing a form;
- build several weighted lexical query branches;
- search a precompiled local SQLite/FTS5 pack and a compatible local vector index;
- reuse that pack as a persistent read-only native SQLite file on compatible mobile builds;
- fall back to SQLite WASM when native SQLite/FTS5 probing fails;
- explain matched branches, active retrieval mode, profile, and lexical/semantic scores;
- group candidates by document and clinical section category;
- open the exact source chunk, neighbors, and full section through stable anchors;
- save local history and bookmarks.

For authoring, source registries can prepare text-layer PDF, OCR TXT, or Markdown inputs without LLM
rewriting. The pipeline retains page/block or line provenance, emits extraction diagnostics, validates
rights metadata, and feeds the same deterministic pack builder.

## Current corpus and knowledge boundary

The public pilot is no longer purely synthetic. It contains:

- seven source-linked Russian clinical-recommendation navigation cards;
- eight official Russian medication-registry identity cards;
- synthetic fixtures retained separately for software contract tests.

The knowledge layer stores entities, medication profiles, proposed facts and relations, evidence,
document links, and review tasks. Proposed medication knowledge is not reviewed guidance. A registry
record establishes identity, form, strength, and registration metadata only; absent clinical fields are
kept absent rather than completed from model memory.

The current portable vector profile is deterministic feature hashing and is not a neural medical model.

## Quality foundation

The committed benchmark suite contains:

- a deterministic natural-distribution sample of real clinician queries with original language and
  jurisdiction preserved;
- Russian parser, morphology, workflow, and safety edge cases;
- Russian source-grounded clinical and medication queries tied to exact versions, sections, chunks, and
  anchors.

Russian release metrics are reported separately from foreign-dataset metrics. Strong foreign results
cannot compensate for regression on Russian source applicability or provenance.

## Product invariants

- Offline retrieval remains useful with every model adapter disabled.
- Original source and user text are not silently rewritten.
- Source text, proposed structure, reviewed knowledge, and generated output remain distinguishable.
- UI never owns SQL or provider-specific model logic.
- Optional cloud/model failures cannot break source navigation.
- Real patient data is absent from fixtures, tests, logs, analytics, and release artifacts.
- Every trusted structured claim must resolve to evidence and an explicit review state.

## Initial user and non-goals

The initial user is the owner and a small invited group of physicians. Before 1.0 the product is not an
EMR, autonomous decision system, account/sync service, mandatory backend, complete medical ontology,
or universal local model runtime.

## Success metrics

- Russian rank, section, anchor, provenance, and zero-result thresholds remain green;
- every result resolves to an existing document version, section, chunk, and anchor;
- no search query leaves the device in the default path;
- time from opening the app to a useful source paragraph beats manual document navigation;
- physicians can find the needed source without repeated reformulation in a growing share of cases;
- a failed optional feature never blocks source access;
- corpus growth and structured knowledge never bypass rights, evidence, and review gates.
