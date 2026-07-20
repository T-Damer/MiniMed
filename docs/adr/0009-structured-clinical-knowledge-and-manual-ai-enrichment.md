# ADR 0009: Structured clinical knowledge and manual AI enrichment

- Status: accepted
- Date: 2026-07-19

## Context

MiniMed already compiles source-preserving Markdown into an offline SQLite/FTS5/vector content pack. Drug lookup and treatment discovery require more structure than document chunks alone: substances and products, pediatric applicability, warnings, indication-specific facts, and explicit links to clinical recommendations.

The enrichment step will initially be performed through ChatGPT chat rather than an API. Medical data cannot safely treat an LLM's completion as a source, and proprietary drug databases cannot be collected without the appropriate export and redistribution rights.

Search also needs to distinguish a clinical case from a treatment request, medicine lookup, care-guidance question, or administrative reference without adding an online model dependency.

## Decision

1. Keep source documents/chunks immutable and authoritative for quoted content.
2. Add a generic relational knowledge graph to SQLite, with an optional medication profile and typed population/safety facts.
3. Require exact chunk evidence for every AI-proposed fact and relation.
4. Force all ChatGPT imports to `proposed` and derive authority from source metadata; only an explicit human-review command can set `reviewed`.
5. Project only reviewed knowledge into chunk FTS/vector text and the structured `knowledge_fts` index.
6. Represent missing clinical fields as review tasks; never infer pediatric dosing, contraindications, or prescription rules from absence/context/model memory.
7. Store authority tier and relation status separately from a deterministic ranking weight.
8. Reuse the existing checksum/ETag/cache source sync through a rights-aware drug-source catalog; do not add crawler/scraper behavior.
9. Classify Russian queries deterministically into diagnosis, treatment, medication, disease reference, care guidance, administrative reference, mixed, or unknown. Use intent to add retrieval terms and clarification suggestions, not to generate an answer.
10. Keep the base entity/fact/relation model domain-neutral so another project can replace the medical intent profile and optional medication table.

## Relation score

`final_weight` is calculated from stored components:

```text
0.30 authority + 0.25 evidence quality + 0.20 applicability
+ 0.10 recency + 0.15 editorial review
```

The score ranks evidence-backed links. It is not a treatment probability, recommendation grade, or safety guarantee. Contraindicated and anecdotal relations retain explicit statuses even when their evidence is strong.

## Consequences

### Positive

- Drug data becomes queryable without relying on a vector store as the source of truth.
- Search can connect a drug/condition query to the exact recommendation chunk supporting the relationship.
- ChatGPT assists categorization while source evidence and human approval remain enforceable.
- Proposed, reviewed, rejected, stale, and missing information remain auditable.
- The same offline pack can support case-style, direct-treatment, drug-class, care, and administrative queries.
- Source updates can invalidate/review affected graph records without overwriting history.

### Negative

- Clinical review becomes an explicit operational requirement.
- Vendor/export adapters are still needed for each licensed data format.
- The initial runtime consumes structured knowledge through reviewed FTS/vector projections; dedicated drug-card queries over the relational tables require a later storage-port/UI slice.
- Exact-quote evidence does not by itself prove that an extraction is clinically correct, hence the review gate.

## Rejected alternatives

- **Scrape Allmed or other public UIs:** rejected because it is technically brittle and may violate database/content rights.
- **Let ChatGPT fill missing pediatric fields from memory:** rejected because it creates unsourced medical claims.
- **Store all drug information only as vectors:** rejected because identity, population constraints, legal status, and audit/version fields need deterministic relational queries.
- **Use a large runtime LLM to answer every query:** rejected because MiniMed is offline-first and source-opening retrieval is the safety boundary.
- **Collapse official and unofficial treatment into one confidence number:** rejected because source authority and recommendation status must remain visible and filterable.
