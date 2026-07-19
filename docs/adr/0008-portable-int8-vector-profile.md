# ADR 0008 — Portable int8 embedding profile and lexical fallback

Status: accepted for `0.3.0-alpha.1`.

## Context

LocalMed needs one retrieval contract that can run in three environments:

- SQLite WASM in a browser;
- system SQLite behind a Capacitor plugin on Android and iOS;
- deterministic in-memory adapters used by tests and tooling.

A future neural query embedder must be replaceable without changing `MedicalCore`, result DTOs, the
content-pack layout, or the source reader. At the same time, the project cannot claim neural semantic
quality before a compact Russian medical model is selected and measured on real recommendations.

## Decision

A content pack may declare one or more immutable embedding profiles. A profile freezes:

- profile and model identifiers;
- model revision and profile checksum;
- vector dimension;
- normalization;
- storage format;
- profile kind (`development` or `neural`).

`chunk_embeddings` stores one signed `int8` BLOB and its norm per `(profile, chunk)`. Document vectors
are calculated off-device. The runtime embeds only the current query and performs cosine scoring.

`MedicalCore` resolves the profile by the exact ID requested by its `QueryEmbedder`. It enables hybrid
retrieval only when ID, model revision, dimension, normalization, format, and checksum match. Any
missing profile, mismatch, invalid vector, or vector-search error yields an explicit diagnostic and a
complete lexical fallback.

The first checked-in profile, `localmed.feature-hash.384.v1`, is deterministic feature hashing over
word, word-bigram, and character-ngram features. It is marked `development`. Its purpose is to test:

- reproducible off-device vector generation;
- cross-language TypeScript/Python parity;
- compact int8 persistence;
- web/native vector scanning;
- hybrid fusion and diagnostics;
- profile mismatch and lexical fallback.

It is **not** treated as a medical neural embedding model or as evidence of semantic retrieval quality.

## Consequences

Positive:

- the database and runtime contracts are ready before model selection;
- the same content pack works in WASM and native SQLite;
- query vectors never require a server;
- a neural adapter can replace feature hashing without changing the UI or source-navigation contract;
- FTS5 remains independently usable.

Trade-offs:

- current vector search is an exact brute-force scan, not ANN;
- feature hashing mainly captures lexical/orthographic proximity;
- fusion constants are provisional and must be recalibrated for a neural profile;
- every mobile profile needs an implementation whose output matches the off-device builder exactly.

## Exit criteria for a neural profile

A profile may be marked `neural` only after:

1. model files and preprocessing are versioned and checksummed;
2. Python/off-device and mobile query vectors pass golden parity or an explicitly documented
   tolerance;
3. latency, peak memory, package size, and battery impact are measured on a device matrix;
4. a physician-authored real-corpus benchmark shows a useful gain over lexical-only retrieval;
5. lexical fallback and source opening remain intact when the model is unavailable.
