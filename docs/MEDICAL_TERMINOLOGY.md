# Medical terminology collection

The collector creates reviewable source artifacts and ordinary schema-2 MiniMed packs. Runtime
lookup understands their compact terminology projection; collection/build commands do not change
an installed core, active release catalog, or model provider. Do not invent publication URLs.

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
`--discovery-only` builds just the complete discovery candidate, with no specialty detail packs.
Discovery authoring/knowledge validation uses bounded batches and the existing atomic composer.
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
core. `integrate` below builds a new unpublished core; deploying it and publishing exact specialty
download URLs remain explicit release work. No runtime catalog is changed by these commands. Reports separately count
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
211 concepts: 3,964,928 SQLite bytes / 546,906 gzip bytes. The complete discovery SQLite build is now measured at **714,932,224 bytes**,
gzip **123,182,224 bytes** (61,794 documents and 123,598 chunks, no vectors). Broad owner packs download more than one section's exact membership;
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


## Runtime lookup and source occurrences — PR #171

Core lookup ranks an exact source-backed concept name first, literal source-label occurrences next,
then MeSH-declared related concepts. Existing relevance orders results within each tier. Related
concepts and third-party candidate labels are not clinical equivalence, diagnosis, or approval.
Names are matched without silently merging ConceptUIs; a same-concept installed detail hides its
own discovery card only for the same terminology edition. Source/specialty/document filters remain
applicable to every additional lexical branch. Definitions are searchable as ordinary source text,
including queries that do not mention the concept name. English definitions remain labelled `en`.

`index-mentions` writes immutable JSONL with the first literal occurrence of each concept per source
document, exact original quote/character offsets, source checksum, document/version/section/chunk IDs,
anchor and available page coordinates. Longest explicit names win over embedded shorter names;
ambiguous names retain all candidate IDs. Short uppercase abbreviations are case-sensitive. This is
label matching, not clinical entity disambiguation or an assertion about negated/positive findings.
Personal notes/patient source types are excluded. No full-text coverage is inferred from pointers.

```sh
uv run --project tools/ingest medbase-terminology index-mentions \
  --terminology data/build/terminology-2026/minimed.terminology.discovery.db \
  --source-pack /path/to/verified-full-source.db \
  --output data/build/term-occurrences-2026.jsonl

uv run --project tools/ingest medbase-terminology integrate \
  --core apps/app/public/content/core.db \
  --discovery data/build/terminology-2026/minimed.terminology.discovery.db \
  --source-pack /path/to/verified-full-source.db \
  --output data/build/core-with-terminology.db \
  --manifest data/build/core-with-terminology.edition.json \
  --version 2026.1.0 --built-at 2026-09-14T00:00:00Z
```

Repeat `--source-pack` for explicitly available source snapshots; omitting it on `integrate` indexes
only source text actually present in the selected core. The new core retains original documents,
text and anchors; source-only metadata and derived pointer chunks add occurrence search. A matching
source document/version is required; an explicit canonical version cannot be overridden by a
matching display label. Pointer chunks contain the exact term label and source locator, never a
fabricated full document. After exact-package installation, their anchors resolve to the source
fragment. Existing checksum, target-membership, and SQLite activation gates remain authoritative.
Knowledge links are `proposed` and `searchOnly`; recomposition replaces only this projection.

**Placement decision:** do not silently add the 682 MiB discovery candidate to every mobile core.
The much smaller prepared JSONL is not a deployable SQLite size estimate. Keep full MeSH optional
until a compact presence/definition distribution is qualified; any baseline core membership change
needs a separately built and measured immutable edition. Runtime and composition support are not
claims that the public application already contains the new terminology. Russian-definition coverage
and broad section-owner download overhead remain explicit follow-up work.

Performance method and limits: [TERMINOLOGY_PERFORMANCE.md](TERMINOLOGY_PERFORMANCE.md).
