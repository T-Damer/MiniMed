# Medical terminology collection

Build-time only. This pipeline does not change the installed core, runtime search, UI, native code,
release catalogs, or model providers. It creates reviewable source artifacts and ordinary schema-2
MiniMed packs. Do not publish them by adding guessed download URLs.

## Sources and identity

- NLM MeSH Descriptor XML/gzip: descriptor IDs, distinct ConceptUIs, their own names/ScopeNotes,
  semantic types, multiple tree placements, and verbatim BRD/NRW/REL relations. A descriptor is not
  one bag of synonyms. Non-preferred concepts never inherit the preferred concept's definition.
- Optional Wikidata P486 join: collect Russian labels, marked third-party candidates. The parser also
  accepts aliases in a supplied valid SPARQL snapshot. Joining is by an exact descriptor ID to its
  preferred concept, not a name. Ambiguous crosswalks go to review. Wikidata descriptions are not
  treated as medical definitions.
- Optional rights-declared `localized-concepts` JSONL: `conceptId`, `language: ru`, `preferredName`,
  `aliases`, and optional source `definition`. This is a normalized import contract, not a claim
  that the CNMB Russian MeSH site provides this export format or permits redistribution.

Every collection has `sources.json` (`TerminologySources`) with source format/path/edition, SHA-256,
`SourceProvenance` and explicit offline/derivative/redistribution rights. Importing local Russian
sources requires adding their actual checksum and rights to that manifest. Unknown or revoked rights
never become public-pack permission automatically. No source text is translated or completed by AI.

NLM terms: https://www.nlm.nih.gov/databases/download/terms_and_conditions_mesh.html
Attribution: **Courtesy of the U.S. National Library of Medicine**. Identify the MeSH edition, warn that
it may not be the latest data, and never imply NLM endorsement. NLM's permission explicitly does not
cover translation (MTMS) files. Wikidata structured labels use CC0:
https://www.wikidata.org/wiki/Wikidata:Licensing

## Commands

Run at repository root with the normal locked ingestion environment. Network is opt-in and free of
provider charges; no Replicate or other model credentials are needed.

```sh
uv run --project tools/ingest medbase-terminology collect \
  --year 2026 --output data/raw/terminology-2026 --cache .cache/terminology --network
# Add --with-wikidata for a separate snapshot with Russian candidate names.
# --offline verifies a completed collection without accessing the network.

uv run --project tools/ingest medbase-terminology prepare \
  --input data/raw/terminology-2026 --output data/intermediate/terminology-2026

uv run --project tools/ingest medbase-terminology build \
  --input data/intermediate/terminology-2026 --output data/build/terminology-2026 \
  --version 2026.1.0 --built-at 2026-01-01T00:00:00Z --section F03
```

`build` defaults to the full discovery index plus requested sections; repeated `--section` selects
several sections, omitting it builds all. `--no-core` builds only section packs. Multi-section concepts
have one deterministic storage owner (first sorted MeSH root); a section plan lists additional owner
packs needed for its complete membership. No concept is duplicated under conflicting identities.
`--for-redistribution` adds a rights preflight, not publication approval or a release action.
All outputs are immutable directories: use a new path for a new snapshot/build.

## Placement decision and completeness

`prepare` emits canonical `terms.jsonl`, `core-discovery.jsonl`, `sections.json`, `review.jsonl`,
deterministic gzip files and `size-report.json`. Discovery retains a complete supplied definition
(prefer Russian, otherwise explicitly labelled original English) plus names and exact detail targets.
Missing definitions remain missing; do not borrow a neighbouring concept's definition.

`build` emits normal SQLite/gzip packs, prepared Markdown/knowledge workspaces, exact document/version
membership, and `pack-size-report.json`. It reuses `knowledge_entities/names/facts/evidence` and existing
content lint/SQLite integrity checks, without a schema migration. Structured facts stay **proposed**.
MeSH hierarchy relations remain source-labelled terminology metadata, not clinical treatment edges.
Whitespace-normalized searchable projections retain original source fields and raw checksums.

Compare measured JSONL/gzip and SQLite/gzip sizes before deciding how much goes into the runtime core.
The discovery edition is a **candidate input** for the existing core composer, not a second active
core. Installing it, adding a user-facing terminology card, and publishing section download URLs are
separate integration work. No runtime catalog is changed by these commands. Reports separately count
Russian-name and Russian-definition coverage; English-only coverage is not a completed Russian glossary.

## Measured MeSH-only baseline — 14 September 2026

The complete `desc2026.gz` (16,812,612 bytes; SHA-256
`ccd4d0d33bebfd4c836a59e7dd0c635b1d4e20c4f5a6abc55e2eb0ba4c8716dd`) was parsed, not sampled:

| Metric | Value |
| --- | ---: |
| Descriptors | 31,110 |
| Distinct concepts | 61,794 |
| Source definition records | 33,362 |
| Concepts missing their own source definition | 28,432 |
| Russian names / definitions in this MeSH-only run | 0 / 0 |
| Discovery JSONL, including supplied definitions | 44,773,523 bytes |
| Discovery JSONL gzip | 6,068,217 bytes |
| Full provenance-rich JSONL gzip | 10,633,650 bytes |

These JSONL sizes are **not SQLite/APK sizes**. An actual `F03 --no-core` SQLite build also completed:
539 section members resolve through 13 unique owner packs (7,587 total stored concepts), totalling
120,504,320 SQLite bytes / 17,599,472 gzip bytes. The F03-owned pack alone contains 211 concepts and is
3,612,672 SQLite bytes / 508,882 gzip bytes. This demonstrates a packaging tradeoff: broad owner packs
can download substantially more than one specialty's membership. It is not a final runtime packing
policy and no performance optimization is introduced here.

An initial Wikidata query with optional aliases returned a truncated HTTP-200 JSON response; the
parser rejected it and produced no partially prepared vocabulary. The collector now requests labels
without the multiplying optional-alias join. Russian-name coverage must be measured on a valid run;
never infer it from the English MeSH totals or from the synthetic Russian regression fixture.

The initial collector covers MeSH Descriptors. Qualifiers, Supplementary Concept Records, HPO,
Orphanet, and a licensed full Russian translation remain follow-up adapters, not claimed coverage.
