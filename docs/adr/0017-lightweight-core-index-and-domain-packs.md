# ADR 0017: Lightweight core index and domain packs

- Status: accepted
- Date: 2026-09-02
- Supersedes: [ADR 0012](0012-curated-core-edition-before-sharding.md)

## Context

The bundled application must find a medicine or clinical recommendation even when its full content
pack is not installed. Full ESKLP, GRLS instructions, Allmed text, and packaging images are too large
and have different update and trust lifecycles. Treating all of them as `core.db` makes every content
refresh a multi-gigabyte application-core replacement.

## Decision

1. `core.db` is the bundled discovery index. It contains canonical titles, aliases, clinical disease
   synonyms, explicit source keywords, stable identifiers, small pointer text, provenance, and exact
   module/download targets. It does not contain full medication cards or instructions.
2. `medications.db` is the detailed medication pack. It composes ESKLP identity/registration data,
   exact-linked GRLS instructions, and reliably matched local Allmed supplements. Its rows remain
   distinct unless MNN/SMNN/registration identity proves the link.
3. Other large domains remain separate packs. Packaging images are a separate source-assets package
   installable from Settings and are never embedded in either SQLite database.
4. Search mounts installed packs with `core.db`; a core pointer remains useful offline when detail is
   absent and offers the exact pack download. Stable document/module IDs join the stores.
5. Each pack has its own checksum, edition manifest, update, rollback, and trust state. `core.db`
   updates may add discovery terms without forcing a medication-data download.

## Consequences

- The application remains searchable immediately after installation while large medical data stays
  optional and independently replaceable.
- `core.db` and `medications.db` are canonical runtime names; `core-demo.db` is retired.
- Release validation must test both core-only discovery and mounted detail navigation.
