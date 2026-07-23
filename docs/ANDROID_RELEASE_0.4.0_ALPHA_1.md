# Android release candidate 0.4.0-alpha.1

This document defines the review boundary for the next MiniMed Android engineering prerelease.
The candidate is built from the combined categorized-dataset and source-grounded-assistant stack.
It is not a production-signed medical device release.

## Included in the APK

- the verified 15-document Russian clinical/medication starter pack;
- deterministic SQLite/FTS5 and local vector retrieval with exact source anchors;
- doctor-facing source reader, archive search and knowledge-graph navigation;
- persistent install, update, removal and rollback support for validated SQLite modules;
- optional local-model query planning and candidate-only reranking;
- visible deterministic fallback when no valid local model result is available.

## Included in the source tree, not automatically installed

- complete-catalog inventory and specialty planning;
- medication registration and health-law coverage ledgers;
- canonical `primaryModuleId` packaging for metadata-only catalog records;
- official-source acquisition, provenance and review tooling.

Metadata-only catalog cards remain distinct from validated full text. They do not become trusted
clinical recommendations, medicine instructions or statements of current legal applicability.

## Model safety boundary

The local model may propose bounded search terms, clarifying questions and an order for exact source
fragment IDs already retrieved by deterministic search. It may not add:

- diagnosis or differential diagnosis;
- treatment, routing or monitoring advice;
- drug doses, schedules, calculations or contraindication claims;
- new source IDs, citations or facts absent from the candidate list.

Malformed output, an invented candidate ID, a stale search, missing model weights or a runtime error
returns the untouched deterministic result.

## Automated release evidence

The pull-request release job must:

1. run the repository TypeScript, Python, content and benchmark verification;
2. rebuild the public and regulatory SQLite packs;
3. assemble the Android debug APK;
4. verify the APK signature and inspect declared permissions;
5. extract the embedded database and byte-compare it with the validated build output;
6. run SQLite integrity, foreign-key, pack-version, document, chunk, embedding and provenance checks;
7. upload the APK together with SHA-256 files, badging, permissions, signature and JSON evidence.

The workflow cannot publish a GitHub Release from this PR. Publication requires a deliberate push to
`main` whose commit message contains `release: MiniMed 0.4.0-alpha.1`.

## Manual gates before distribution

- install and cold-start on at least one physical Android device;
- verify search, source opening, module lifecycle and process-restart persistence;
- test the intended mirrored local model artifact on-device;
- record model memory, latency, thermal behavior and deterministic fallback;
- confirm the debug-signing warning is clear to recipients;
- review the generated APK permissions, checksums and embedded source index.

Native LiteRT-LM GPU/NPU execution and production signing are not release blockers for this debug
engineering alpha, but they remain blockers for a broader or production-facing release.
