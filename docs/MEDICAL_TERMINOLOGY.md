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
  --year 2026 --output data/raw/terminology-2026 --cache .cache/terminology --network --with-wikidata
# Omit --with-wikidata for a MeSH-only snapshot.
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
Source titles/provenance remain MeSH; `shortTitle` and candidate names may be Russian. Definitions
carry their own source/language. A Russian display label must not falsely classify original English
scope notes as bad Russian OCR. Actual `ru` definitions still pass the existing Russian text guards.
The pack's `aliases.yaml` includes explicitly labelled `terminology-search-spelling` expansions for
Latin lookalikes inside predominantly Cyrillic words. Original labels and concept IDs remain unchanged;
these search-only forms never establish a clinical synonym or navigation link. HLA-DR, CD4 and Latin
terms are not rewritten. The actual Wikidata label `cиндром Мюнхгаузена` demonstrates this boundary.

Compare measured JSONL/gzip and SQLite/gzip sizes before deciding how much goes into the runtime core.
The discovery edition is a **candidate input** for the existing core composer, not a second active
core. Installing it, adding a user-facing terminology card, and publishing section download URLs are
separate integration work. No runtime catalog is changed by these commands. Reports separately count
Russian-name and Russian-definition coverage; English-only coverage is not a completed Russian glossary.

## Measured real-source run — 14 September 2026

The complete NLM `desc2026.gz` was downloaded (16,812,612 bytes; SHA-256
`ccd4d0d33bebfd4c836a59e7dd0c635b1d4e20c4f5a6abc55e2eb0ba4c8716dd`), joined to a valid
Russian-label Wikidata snapshot, prepared and verified for offline reuse. This is not a sample.

| Metric | Value |
| --- | ---: |
| MeSH descriptors | 31,110 |
| Distinct concepts | 61,794 |
| Own source-definition records | 33,362 |
| Concepts missing their own definition | 28,432 |
| Concepts with Russian candidate names | 16,020 |
| Russian source definitions in this run | 0 |
| Discovery JSONL, including supplied definitions | 45,528,519 bytes |
| Discovery JSONL gzip | 6,391,188 bytes |
| Full provenance-rich JSONL gzip | 11,811,961 bytes |

These JSONL sizes are **not SQLite/APK sizes**. The actual bilingual `F03 --no-core` SQLite build
completed after the language fix: 539 section members require 13 unique owner packs (7,587 stored
concepts), totalling 130,805,760 SQLite bytes / 18,385,744 gzip bytes. The F03-owned pack alone stores
211 concepts: 3,964,928 SQLite bytes / 546,906 gzip bytes. Full discovery SQLite size has not been
measured on this complete corpus. Broad owner packs download more than one section's exact membership;
this is an explicit packaging tradeoff, not a finalized or optimized runtime download policy.

A read-only query through the built pack's spelling expansion and FTS finds the real Munchausen
concept `mesh.M0014205` / descriptor `D009110`. Its by-proxy concept is separate (`mesh.M0025483` /
`D016735`). Source definitions remain the original English; do not report them as Russian coverage.

An initial optional-alias Wikidata query returned truncated HTTP-200 JSON. The parser rejected it
without a partial prepared output. The labels-only query succeeded; ambiguous crosswalks remain
review tasks. Whole-source collection/measurement is manual in CI; PR validation runs offline tests.

The collector tests cover identity/evidence, hostile XML, decompression limits, checksums, rights,
path escapes, truncated JSON, exact joins, section ownership, Cyrillic FTS, source language, unchanged
source labels, proposed-only knowledge, SQLite integrity and byte-identical rebuilds in the same
pinned environment. No patient data or paid inference is involved.

The initial collector covers MeSH Descriptors. Qualifiers, Supplementary Concept Records, HPO, Orphanet,
and a licensed full Russian translation remain follow-up adapters, not silently claimed coverage.
