# ADR 0018: Concept-first knowledge discovery projection

- Status: accepted
- Date: 2026-09-18

## Context

MiniMed already stores source documents in SQLite/FTS5 and structured medical knowledge in
`knowledge_entities`, `knowledge_names`, `knowledge_facts`, `knowledge_relations`, evidence and
explicit document links. Large clinical-recommendation, medication, terminology and future
instrument packs should remain independently downloadable, while exact search must know that a
concept exists before its detail pack is installed.

A second graph database or vector database would duplicate identity, provenance and update state.
The current problem is projection and retrieval ownership, not SQLite's ability to store the rows.

## Decision

1. `knowledge_entities` is the canonical cross-domain concept registry for conditions, findings,
   medicines, investigations, scales, questionnaires, criterion sets, classifications and other
   clinical reference objects. Names are search keys; source names never become identity join keys.
2. Source/domain databases remain the canonical owners of full facts, evidence, documents and tool
   definitions. They are immutable, independently versioned SQLite packs.
3. A reproducible **knowledge discovery pack** projects selected source-backed entities into ordinary
   compact MiniMed documents and aliases. It may be composed into `core.db` or mounted alongside it.
   The projection preserves the original `conceptId`, exact reviewed definition text, source document
   IDs and source locator. It does not invent a definition or promote proposed facts.
4. Projection is selectable by `entity_type`, so releases may put only high-value conditions,
   criteria, classifications or instruments into the lightweight discovery edition while keeping
   full details in optional packs.
5. FTS5/exact aliases remain the first retrieval path. Neural/vector data remains a replaceable
   search projection; it never owns medical facts or identity.
6. User documents remain a separate trust overlay. They may link to canonical concepts but cannot
   promote facts into the official registry without the normal source/review pipeline.

## Native direction

A shared native `MedicalCore` remains a desirable target for SQLite access, SIMD/ANN vector search,
pack verification and local inference, with Android Compose and later iOS SwiftUI as possible native
frontends. This ADR does **not** start a Rust/mobile rewrite. The next native step must first run the
same golden search/source-navigation fixtures as the TypeScript core so storage or UI migration cannot
silently change medical retrieval semantics.

SQLite remains the database of record in that native design. ANN indexes, if benchmarks eventually
need them, are disposable side indexes keyed by stable concept/chunk IDs.

## Consequences

- A scale or eponym can be discoverable from the lightweight edition even when its full guideline or
  specialty pack is not installed.
- Definitions are copied only when a reviewed fact has exact evidence; otherwise the discovery card
  only routes to the source.
- Different sources with the same caption remain different documents attached to one reviewed concept
  rather than being title-deduplicated.
- The core can stay small and rebuild quickly because the projection is selectable and contains no
  large source body by default.
- Concept embeddings are computed only from canonical name + aliases + reviewed short definition.
  The initial optional profile is the existing deterministic int8 development profile; replacing it
  with a qualified neural encoder does not change the relational source of truth.

## Initial implementation

`python -m localmed_ingest.knowledge_discovery_pack` accepts one or more compiled SQLite knowledge
sources and emits an immutable local-dev discovery pack. Example:

```bash
uv run --project tools/ingest python -m localmed_ingest.knowledge_discovery_pack \
  --input data/build/reference-knowledge.db \
  --entity-type condition \
  --entity-type criterion_set \
  --entity-type scale \
  --edition-id minimed.knowledge.discovery.ru \
  --version 2026.09.18 \
  --built-at 2026-09-18T00:00:00Z \
  --output data/build/knowledge-discovery-2026.09.18.db
```

The command is intentionally local-dev only. Public redistribution still depends on the rights of the
underlying source text copied into a definition card.

For retrieval-mechanics testing, add `--include-portable-vectors`. This writes exactly one
`localmed.feature-hash.384.v1` int8 embedding for each concept card's description chunk. It is a
development profile, not evidence of neural medical semantic quality. Exact names, aliases and FTS
remain available without it.

## Guideline extraction and review

Clinical recommendations can be scanned without creating medical facts:

```bash
uv run --project tools/ingest python -m localmed_ingest.knowledge_candidates \
  --input data/build/clinical-guidelines.db \
  --output data/intermediate/knowledge-candidates-2026.09.18
```

The immutable candidate workspace contains exact document/version/section/chunk/anchor locators and
stays `proposed`. A reviewer records explicit accept/reject decisions. Accepted candidates are
promoted with a stable machine ID and canonical name:

```bash
uv run --project tools/ingest python -m localmed_ingest.knowledge_candidate_review \
  --candidates data/intermediate/knowledge-candidates-2026.09.18 \
  --source data/build/clinical-guidelines.db \
  --decisions data/intermediate/knowledge-candidate-decisions.jsonl \
  --reviewer "doctor-id" \
  --reviewed-at 2026-09-18T00:00:00+03:00 \
  --output data/intermediate/knowledge.reviewed-candidates.json
```

Promotion creates only a canonical entity and a reviewed source-document link. It does not infer a
definition, scoring formula, cutoff or equivalence. An already implemented assessment/calculator may
be linked only when review supplies both an explicit tool ID and an explicit local
`#/assessments/...` or `#/calculators/...` route. Route/type mismatches and malformed routes fail
closed. The output is intended to be rebuilt with the source documents through the normal
`knowledge*.json` pipeline, where ordinary evidence/link validation still applies.

Knowledge modules may repeat the same stable entity ID when they describe the same concept. Module
composition merges aliases and compatible list metadata while conflicting entity types, external IDs
or scalar metadata still fail closed. Facts, relations, document links and review-task IDs remain
strictly unique. This stricter metadata merge is opt-in for module composition and does not change the
existing AI-enrichment entity merge behavior.

Candidate workspaces fail closed when either the SQLite source fingerprint or deterministic candidate
payload changes after review.

## Runtime identity

Search results and document groups may carry an optional `conceptId`. Both SQLite-WASM and
Capacitor/native compact metadata projections preserve the field. Explicit `interactiveRoute`
metadata is preserved through the same projections. A reference/concept card renders a generic
`Пройти` or `Рассчитать` action only when the reviewed tool ID and route agree; it never derives a
tool from the card title or alias.

This does not yet merge multiple documents into one UI group; it establishes the stable identity
required for a later concept-first presentation while keeping each source document and chunk
independently navigable.
