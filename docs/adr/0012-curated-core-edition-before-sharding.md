# ADR 0012: Curated core editions before runtime sharding

- Status: accepted
- Date: 2026-07-29

## Context

The source pipeline can build hundreds of independently versioned SQLite documents. The current
browser composition mounts active databases into SQLite WASM and the worker can create another
runtime composition. Treating every document, or every taxonomy category, as an active runtime
database makes all-source retrieval, memory use, native storage, rollback, and reader resolution
hard to measure and harder to make atomic.

The product goal is an offline clinician reference, not a distributed document-store client. It must
answer from installed source evidence on Web, Android, and eventually deterministic iOS search. A
small local model, vectors, personal material, calculators, and antibiograms are not allowed to make
the ordinary source reader unavailable or to weaken its trust boundary.

## Decision

1. A `core.db` is one immutable, curated **corpus edition**. It contains canonical searchable chunks,
   reader payload, stable anchors, FTS, aliases, and source/version/rights metadata for the selected
   corpus. It is not a three-document demo pack and it is not a claim of complete medicine.
2. Individual documents and source categories remain preparation, review, and build units. They are
   compiled into one edition only after their source-level manifest passes validation.
3. An edition activates and rolls back as one whole-snapshot pointer. A result may only reference a
   document version and payload in that same active edition.
4. Web has one SQLite-WASM owner in the search worker; search, reader, and context use its typed RPC.
   Android and iOS use one native read-only edition when qualified; their worker performs query
   analysis only. A WASM fallback remains explicit.
5. FTS5 plus aliases and deterministic typo suggestions are the release retrieval baseline. The
   current feature-hash vector profile and local LLM are research paths, not release dependencies.
6. Runtime sharding is a scale-out contingency, not the default. It may be evaluated only after a
   real edition exceeds a published device budget and a split prototype preserves source navigation,
   whole-release rollback, and retrieval quality.

## Required edition manifest

For every non-synthetic document version, record source checksum, rights/redistribution state,
jurisdiction, validity/status, document-version ID, and build provenance. Unknown or revoked rights
exclude the source from a published edition. Registry identity, instruction evidence, legal material,
personal material, and unverified archives remain separate trust tiers.

## Scale-out trigger

Evaluate at most three runtime shards only when the measured one-edition path breaches a supported
device limit: lexical P95 above 750 ms, peak RSS above 600 MB, offline cold start above 5 s, update
requiring more than twice the active-pack free disk space, or a demonstrated need for independent
subsets. A shard prototype must retain 100% document-version/anchor resolution and whole-release
rollback before it can replace the edition path.

## Consequences

- `CONTENT_MODULES.md` and `FULL_DATASETS.md` describe useful source/distribution history, but their
  multi-store runtime target is superseded by this ADR.
- Clinical answers remain evidence bundles or explicit gaps/conflicts, never free-form generated
  prose. A calculator needs a typed reviewed rule; an antibiogram needs a complete contextual source.
- Personal notes and owner-provided literature may be indexed locally only as separately labelled
  overlays. They cannot appear as official evidence or implicit model context.
