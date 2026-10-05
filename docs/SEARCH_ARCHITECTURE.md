# Search architecture — code map

How a query travels through the code, with the file and function at each step, so search work can
start here instead of re-reading `create-medical-core.ts`. Behaviour rules and their reasons live
in [`SEARCH.md`](SEARCH.md); the semantic contract is [`SEMANTIC_RETRIEVAL.md`](SEMANTIC_RETRIEVAL.md)
and ADR 0008. Line numbers drift; function names are the stable anchors. Checked against `main` on
2026-10-05.

## Layers

```text
SearchHome / SearchWorkspace (apps/app/src/features/search)
  → ScopedMedicalCore            scope → document filter, audience, result kinds
  → MedicalCore.search           packages/core/src/create-medical-core.ts
      → query plan               packages/search-lexical (lookup or clinical analysis)
      → store.search ×branch     MultiMedicalStore → one store per mounted pack
      → fuseBranchHits           chunk-level lexical fusion
      → store.searchVector       optional semantic candidates (ADR 0008)
      → fuseSemanticResults      hybrid / semantic ranking
      → exact-identity rescue    titles, aliases, spelling candidates
      → groupResults             chunks → document groups
      → rankSearchGroupsByQuery  packages/core/src/query-group-ranking.ts
      → TerminologySearchIndex.rank, exact-title sort, collapse by target document
```

The UI never touches SQL. Every store implements the `MedicalStore` port
(`packages/storage/src/ports.ts`): `search` (FTS5), `listEmbeddingProfiles`, `searchVector`,
`lookupCoreIdentities`, document/section/chunk reads.

## 1. Entry: which scope, which mode

`SearchWorkspace.tsx` (the `core.search({…})` call) sends:

| UI scope | `mode` | `analysisMode` | suggestions |
|---|---|---|---|
| `diagnosis` («Клинический разбор») | `auto` | `clinical` | yes |
| everything else (`all`, `guidelines`, `medications`, `legal`, `conditions`, …) | `lexical` | `lookup` | no |

So the semantic path runs **only** in the clinical-analysis scope today; ordinary lookup is
lexical by request. `patient-notes.ts` also searches with `mode: 'auto'`.

`ScopedMedicalCore.ts` wraps the core per scope: `documentMatchesSearchScope` maps a scope to
source types (`SOURCE_TYPES_BY_SCOPE`) and catalog pointers (`catalogFamily`), turns that into a
`documentIds` filter, and post-filters result kinds. Personal notes and books are searched outside
SQLite (see SEARCH.md, «Personal overlay»).

## 2. Query plan (`packages/search-lexical`)

- **Lookup** (`medication-lookup.ts` `buildLookupQueryPlan`, wrapped in `analysis.ts`): short
  name-style queries. Alias expansion (`aliases.ts` `createAliasExpander`), medication spelling
  candidates (`medication-spelling.ts`; the plan carries `medicationSpelling.withoutSpelling`),
  suffix fallback, the diluted diagnosis-alias branch.
- **Clinical** (`analysis.ts` `analyzeClinicalQuery`): narrative cases. Extracts facts with
  character offsets, polarity and uncertainty (age, sex, vitals, durations, medications,
  investigations, symptoms), builds up to seven weighted branches (`clinical`, `original`,
  `investigation`, `medication`, `medication-presentation`, `clause`, …).
- `normalize.ts`: `normalizeSurfaceText` (NFKC, lower, ё→е), `searchSubjectText`,
  `lightStemRussian`, `tokenize`. Each branch carries a safe FTS5 expression (`ftsQuery`) and its
  `terms`; raw text is never interpolated into SQL.

`core.search` also calls `store.lookupCoreIdentities(query)` for lookup queries without
specialty/age/section filters: exact identity hits from the core's identity table shown above the
groups (`identities` in the response).

## 3. Lexical retrieval

`runBranchSearches` calls `store.search({ftsQuery, terms, filters, limit, diversifyDocuments})`
per branch, all in parallel. `perBranchLimit = max(limit × 5, 50)`. Spelling branches run only when
the typed word does not occur in any hit (`hitsContainExactSubject`). The `TerminologySearchIndex`
(`terminology-search.ts`) adds branches for a matched terminology entry in lookup mode.

- `SqliteMedicalStore.search` (`packages/storage-sqlite`): FTS5 `bm25` over `chunks_fts`, joined to
  chunks/sections/documents, with filters; `rank` is the positive BM25 score.
- `MultiMedicalStore.search` (`packages/storage/src/multi-medical-store.ts`): runs every active
  mount and replaces scores with `searchWeight / (60 + position)` — per-pack RRF, keeping a chunk's
  best value. BM25 magnitudes are therefore **not comparable across packs**; only positions are.

`fuseBranchHits` (core): for each branch,
`branchScore = weight × (0.82 × rank / maxRankInBranch + 0.18 / (position + 1))`. A chunk's score
is its strongest branch, plus corroboration `min(0.28 × strongest, Σ 0.1 × min(other, strongest))`
(the diluted diagnosis-alias branch never corroborates), plus `branchSectionBoost` (+0.3 when a
branch term ≥4 chars prefixes a title word; +0.03/+0.025 for intent-matching section types). The
cut keeps `perBranchLimit` chunks, but documents with an exact alias or an exact subject title
always survive.

## 4. Semantic path (ADR 0008)

Runs when `mode !== 'lexical'` and `createMedicalCore({embedder})` was given a `QueryEmbedder`
(`packages/search-semantic`: `{ profile, embedQuery(text) → {profileId, values: Int8Array, norm} }`).

1. `store.listEmbeddingProfiles()` → the first profile `profilesCompatible` with the embedder's
   profile (same id, dimensions, format, normalisation, generator, generator version, fingerprint).
2. `embedder.embedQuery(semanticQueryText(analysis))` — note the text is the **joined normalised
   positive facts** (or the clinical branch's normalised query), not the raw query.
3. `store.searchVector({profileId, vector, norm, filters, limit: max(limit × 5, 50)})`.
   `SqliteMedicalStore.searchVector` scans every `chunk_embeddings` row of that profile (with
   filter joins), keeps a top-`min(500, max(limit × 10, 100))` window by cosine, then hydrates
   chunks. `MultiMedicalStore.searchVector` multiplies by `searchWeight` and keeps each chunk's best.
4. `fuseSemanticResults`:
   - `semantic` mode: vector hits only, `finalScore = cosine`;
   - `hybrid`: lexical scores normalised to the best lexical score ×0.78; vector-only hits
     cosine ×0.62; a chunk found by both gets `+0.22 × cosine + 0.04`.
   Exact-alias documents and the exact subject title survive the cut as in lexical fusion.

Any failure falls back to lexical and is reported in `diagnostics.semantic` (`status`,
`profileId`, `candidateCount`, `elapsedMs`, `fallbackReason`: `query-embedder-unavailable`,
`embedding-profile-mismatch`, `invalid-query-vector`, `no-vector-candidates`, `semantic-error:*`).

Data: `embedding_profiles(id, dimensions, vector_format='int8', normalization='l2', generator,
generator_version, fingerprint UNIQUE, metadata_json)` and `chunk_embeddings(profile_id, chunk_id,
vector BLOB, vector_norm)`. Vectors are L2-normalised, ×127, rounded half away from zero
(`portable-hash.ts` `quantize`). The browser composition (`create-browser-core.ts`) currently wires
`PortableHashEmbedder` — the deterministic `localmed.feature-hash.384.v1` development profile
carried by КР packs, not a neural model. The Capacitor native store answers `searchVector` only if
the plugin exposes `searchVectors`; installed modules are mounted through the browser runtime
(WASM/OPFS `SqliteMedicalStore`), so they use the JS scan above.

## 5. After fusion: identities and grouping

- `mergeExactIdentityResults` re-adds lexical hits of exact-identity documents that semantic
  ranking dropped; `buildExactIdentityResults` reads missing exact-title / navigation-alias /
  short-title documents (`QueryDocumentIndex`, `query-document-index.ts`) and spelling candidates
  (≤40) straight from the store.
- `filterSupersededSummaryResults` drops summary rows whose full document is available.
- `groupResults`: chunks → one group per document. Inside a group the order is preferred section
  type (`requestedSectionType`: diagnostics/routing/treatment from the query wording), meta sections
  last, exact presentation alias, original-query snippet coverage, term coverage, then score.
  `bestScore` is the max chunk score; a medication presentation may prefix the title.
- `rankSearchGroupsByQuery` (`query-group-ranking.ts`) reorders groups with query-aware rules:
  title term matches over body mentions, current vs historical editions
  (`CURRENT_EDITION_QUERY` / `HISTORICAL_EDITION_QUERY`), instruction and registry intents,
  navigation aliases, generic-word stop list. **This step can override a better semantic order**;
  measure semantic changes after it, not on raw `fuseSemanticResults` output.
- `filterSuffixFallbackGroups`, then `TerminologySearchIndex.rank`, then a stable sort that puts
  exact title, secondary identity (navigation alias / short title) and spelling documents first,
  then `collapseGroupsByTargetDocument` (a pointer and its installed full document become one
  group), then `slice(0, limit)`.

## 6. Packs and modules

- **Core** (`core.db`, bundled/downloaded): pointers for medications, КР and legal documents,
  identities, aliases, terminology. Pointer results offer the exact module download (SEARCH.md,
  «Core-only pointers»).
- **Modules** (`browser-module-runtime.ts` `loadInstalledModuleMounts`): each installed module is an
  OPFS SQLite file mounted with `searchWeight: 1`. One worker owns the OPFS pool
  (`worker-opfs-medical-store.ts`); search goes through that owner.
- КР editions: superseded editions are filtered from search; the reader links old/new editions
  (`clinical-editions.ts`).

## 7. Measuring

| Command | What it checks |
|---|---|
| `bun run benchmark:all` | core-only real-corpus gate (`run-real-corpus.ts --path=core`) |
| `bun run benchmark:real:release` | app path over all release packs, release gate |
| `bun run benchmark:lookup-quality`, `benchmark:doctor-lookup` | lookup ranking suites |
| `bun run benchmark:search-latency` | latency over the app path |
| `tools/benchmarks/src/export-retrieval-candidates.ts` + `embedding_eval.py` | offline lexical vs embedding comparison ([research](research/embeddings-kr-2026-10-02.md)) |
| `tools/benchmarks/retrieval-icd-queries.json` | Q1 real-language queries with ICD-based КР relevance |

## Pitfalls

- Cross-pack lexical scores are RRF positions, so a weak hit at position 1 of a tiny pack ties with
  a strong hit at position 1 of a large one.
- `semanticQueryText` feeds normalised facts, not the user's wording; a neural model may prefer the
  raw query.
- The vector scan is linear in the number of embedded chunks across every mounted pack.
- Lookup scopes request `lexical`; changing the default mode changes every search tab.
