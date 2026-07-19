# ADR 0003: Generated read-only content packs

- Status: accepted
- Date: 2026-07-16

## Context

Allowing an LLM or UI to edit the production search database directly makes provenance, diffs, and
rebuilds difficult. The current product needs repeatable packs rather than an editorial CMS.

## Decision

Author in human-readable extracted Markdown or a future authoring database. Build runtime SQLite and
JSON artifacts deterministically. Never hand-edit generated pack files. Keep draft processing data
outside the production mobile database.

## Consequences

- clean rebuild and Git diff workflow;
- original text and structure remain inspectable;
- tooling can evolve independently from the app;
- a future authoring DB can be added without changing the runtime pack contract.
