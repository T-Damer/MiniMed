# Product brief

## Purpose

LocalMed Search is an offline-first navigator over a curated Russian medical corpus. It is a
retrieval and source-navigation product before it is a chat product.

## Version 0.3.0-alpha.1 outcome

A user can paste a long Russian-language case description. Without an LLM or network call, the app
can:

- preserve the full original narrative;
- extract a transparent case card with source-linked facts;
- distinguish common explicit negative findings from positive search concepts;
- suggest missing fields without forcing a form;
- build several weighted lexical query branches;
- search a precompiled local SQLite/FTS5 pack and a compatible local vector index;
- reuse that pack as a persistent read-only native SQLite file on compatible Android/iOS devices;
- fall back to SQLite WASM when native SQLite/FTS5 probing fails;
- explain matched branches, active retrieval mode, profile, and lexical/semantic scores;
- group candidates by document and clinical section category;
- open the exact source chunk, neighbors, and full section;
- save local history and bookmarks.

For authoring, a private registry can prepare text-layer PDF, OCR TXT, or Markdown sources without
LLM rewriting. It retains page/block or line provenance, emits extraction diagnostics, and feeds the
same deterministic pack builder.

The committed corpus is synthetic and validates software behavior only. The current portable vector
profile is deterministic feature hashing and is not a neural medical model.

## Product invariants

- Offline retrieval remains useful with every model adapter disabled.
- Original source and user text are not silently rewritten.
- Extracted facts and generated text are distinguishable from source material.
- UI never owns SQL or provider-specific model logic.
- Optional cloud/model failures cannot break source navigation.
- Real patient data is absent from fixtures, tests, logs, analytics, and release artifacts.

## Initial user and non-goals

The initial user is the owner and a small invited group of physicians. Before 1.0 the product is not
an EMR, autonomous diagnostic/treatment system, account/sync service, mandatory backend, complete
medical ontology, or universal local LLM runtime.

## Success metrics

- rank/recall thresholds remain green on committed regression suites;
- every result resolves to an existing version, section, chunk, and anchor;
- no search query leaves the device in the default path;
- time from opening the app to useful source paragraph beats manual PDF navigation;
- physicians can find the needed source without repeated reformulation in a growing share of cases;
- a failed optional feature never blocks source access.
