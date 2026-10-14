# Search architecture — code map

How a query travels through the code, with the file and function at each step, so search work can
start here instead of re-reading `create-medical-core.ts`. Behaviour rules and their reasons live
in [`SEARCH.md`](SEARCH.md); the semantic contract is [`SEMANTIC_RETRIEVAL.md`](SEMANTIC_RETRIEVAL.md)
and ADR 0008. Line numbers drift; function names are the stable anchors. Checked against `main` on
2026-10-05.

## Layers

```text
SearchHome / SearchWorkspace (apps/app/src/features/search)
  → ScopedMedicalCore            scope → document filter, audience, result kinds;
                                 source-name intent (query «Красота и медицина пневмония» → that
                                 source's documents + the rest of the words)
  → MedicalCore.search           packages/core/src/create-medical-core.ts
      → query plan               packages/search-lexical (lookup or clinical analysis)
      → store.search ×branch     MultiMedicalStore → one store per mounted pack
      → fuseBranchHits           chunk-level lexical fusion
      → store.searchVector       optional semantic candidates (ADR 0008)
      → fuseSemanticResults      hybrid / semantic ranking
      → exact-identity rescue    titles, aliases, spelling candidates
      → groupResults             chunks → document groups
      → rankSearchGroupsByQuery  packages/core/src/query-group-ranking.ts
      → TerminologySearchIndex.rank, exact-title sort
      → bridgeIcdRecommendations МКБ card → recommendations that list its code (S3)
      → collapse by target document
      → drug overview line       medication-overview.ts: group / action / indications first (S6)
  → withNameVariantFallback      layout / transliteration / Latin-name retry of a weak lookup (S3)
  → withAtcDrugs                 an ATC code or prefix as the whole query: the drugs that carry it in front (ATC5)
```

The UI never touches SQL. Every store implements the `MedicalStore` port
(`packages/storage/src/ports.ts`): `search` (FTS5), `listEmbeddingProfiles`, `searchVector`,
`lookupCoreIdentities`, document/section/chunk reads.

## 1. Entry: which scope, which mode

`SearchWorkspace.tsx` (the `core.search({…})` call) sends:

| UI scope | `mode` (`searchModeForScope`) | `analysisMode` | suggestions |
|---|---|---|---|
| `diagnosis` («Клинический разбор») | `auto` | `clinical` | yes |
| `guidelines` | `auto` | `lookup` | no |
| everything else (`all`, `medications`, `legal`, `conditions`, …) | `lexical` | `lookup` | no |

`auto` adds semantic candidates only when the query model is downloaded and the mounted КР modules
carry its profile (`KD1_PROFILE`); otherwise it is the same lexical search. `patient-notes.ts` also searches
with `mode: 'auto'`.

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

Lookup plans (`buildLookupQueryPlan`, option `boundShortTerms`) also carry `lookupTermGroups` (each
typed word with its stem and the stems of the alias names it begins) and, for a query that names an
audience, `lookupTitleRescue` (a `title : (subject AND audience)` FTS query run as one extra branch).
`lookup-subject.ts` decides which words are subject words. Short Cyrillic terms become exact
inflection lists in the FTS expression (`ftsLookupToken`); `hasWordPrefix`/`findWordPrefixMatches`
(`normalize.ts`) implement the same word-start rule for `matchedTerms`.

### Name variants: keyboard layout, transliteration, Latin names (S3, item 3)

`createMedicalCore` wraps the lookup search (`analysisMode: 'lookup'`; the clinical analysis is not
touched) in `withNameVariantFallback` (`create-medical-core.ts`), and only that wrapper changes
anything:

1. The typed query is searched as usual. `responseNamesQuery` (`name-variant-fallback.ts`) says it
   already answers the name when the response has identities, a group with a terminology match, or
   one of the first five groups whose title or declared alias begins with every typed word (a close
   token, edit distance ≤ 1–2 from five letters, also counts). Then the response is returned
   untouched — a query that already matches never changes.
2. Otherwise `nameVariantCandidates` builds at most three rewrites: the titles of documents whose
   `metadata.nameLat` equals the typed query or its layout swap (`QueryDocumentIndex.titlesForLatinName`
   — the real Latin name of an Allmed drug, «Nurofen» → «Нурофен»), then
   `nameQueryVariants` (`packages/search-lexical/src/name-variants.ts`): the same keys on the other
   layout (`swapKeyboardLayout`: «vtnajhvby» → «метформин», including the punctuation keys that are
   letters, `[` → х), the Russian readings of a Latin spelling (`transliterateLatinName`: ordered
   rules with ambiguity flips — ц/к for c, г/х for h, э/е, ч/х for ch, silent final e, «-um», doubled
   consonants — «nurofen» → «нурофен», «paracetamol» → «парацетамол»), and both steps in a row for
   Latin typed on the Russian layout («ьуеащкьшт» → «metformin» → «метформин»). Only short
   single-script name-shaped queries (≤ 3 words, ≥ 4 letters) produce variants.
3. A rewrite is searched only when every word of it of four letters or more begins like a title or
   alias word of the mounted corpus (`QueryDocumentIndex.hasNameWordPrefix`: the first five letters;
   built lazily on first use), so gibberish and unknown names cost no search.
4. The first rewrite whose own response names it replaces the response; it carries
   `queryRewrite: {kind, query}` (contract `QueryRewrite`) and the UI says «Показаны результаты по:
   «…»» (`SearchWorkspace.tsx`, `data-testid="search-rewrite-note"`). Otherwise the typed response
   is returned. `createMedicalCore({nameVariants: false})` switches it off for measurements.

`SEARCH_METADATA_FIELDS` of the SQLite store and the Capacitor store project `nameLat`,
`icd10Codes` and `mkbCode` into `listSearchDocuments`/`listNavigationDocuments` for this and for
the bridge below.

### Misspelt words (TYPO1, item 19)

Matching from the start of a word already forgives a slip late in it («пиелонифрит» finds
«пиелонефрит» by its first letters); a slip in the first letters («оменция», «Помоач») found nothing.
`withNameVariantFallback` tries the spelling correction after the name variants, under the same
rule — only when the typed query names nothing:

1. `spellingCorrection` (`name-variant-fallback.ts`) corrects every letter word of four letters or
   more that begins no name of the vocabulary (nor does its stem without a vowel-led ending of up to
   two letters, so «аменцией» is a word form). `correctWord` (`packages/search-lexical/src/word-typo.ts`)
   walks an implicit trie over the sorted vocabulary with a weighted edit distance and reads the
   cost at every depth, so the typed word is matched to the *beginning* of a name: «помоач» →
   «помрач», not to a whole word. A neighbouring key (ЙЦУКЕН, QWERTY), a sound-alike letter
   (о/а, е/и, и/ы, з/с, д/т, б/п…), a soft or hard sign, a doubled letter or a vowel the typed word dropped («ибупрофн») costs 0.5; any other
   edit 1; two swapped letters 0.6; a typed ending of up to two letters kept after a corrected stem
   0.25 per letter («оменции» → «аменции»). Budget: 0.5 up to five letters, 1 up to eight, 1.5 up
   to eleven, 2 beyond. Ties go to a whole name, then the length nearest the typed one, then the
   name more documents carry.
2. The vocabulary (`QueryDocumentIndex.nameVocabulary`, built on first use, ~47k words over the
   released packs, 0.4 s on a laptop): words of titles, short titles, declared and navigation aliases,
   terminology names, and the core's exact source names of modules not installed
   (`listCoreIdentityNames`, e.g. the dictionary entry «Сумеречное помрачение сознания»). Body text
   is not in it: OCR damage and rare forms would become corrections.
3. The corrected query is searched; it replaces the response when it names what it was corrected
   to (`responseNamesQuery`), or when the typed query found nothing at all. The response carries
   `queryCorrection` (contract `QueryCorrection`).
4. A drug the medication spelling branch already found («обакавир» → АБАКАВИР) gets the same
   `queryCorrection` when the word correction agrees with the drug name the branch matched
   (`drugSpellingCorrection`), so every correction looks the same on screen. `ScopedMedicalCore`
   keeps such drug groups in «Все» (`namedBySpelling`); before, a drug was kept there only when
   its title stem was in the query, which a misspelt name never is.
5. The search box draws the typed text over the field with the wrong letters struck out in red and
   the right letters added in green (`SearchCorrectionOverlay`, letter alignment in
   `search-correction.ts`); a tap on the marked letters puts the corrected text in the field, a tap
   anywhere else reaches the field and hides the correction until the next search. `createMedicalCore({
   spellingCorrection: false })` switches it off for measurements.

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
(`packages/search-semantic`: `{ profile, input?, fusion?, embedQuery(text) → {profileId, values,
norm} }`). The app passes `E5_QUERY_EMBEDDER` (`apps/app/src/features/semantic`), a
`NeuralQueryEmbedder` over `KD1_PROFILE` with `KD1_FUSION`: passages encoded at build time by
Giga-Embeddings 480M, queries on the device by a distilled e5-small-sized student (KD1); details and
numbers in [`SEMANTIC_RETRIEVAL.md`](SEMANTIC_RETRIEVAL.md).

1. `store.listEmbeddingProfiles()` (cached per open pack) → the first profile `profilesCompatible`
   with the embedder's (same id, dimensions, format, normalisation, generator, generator version,
   fingerprint).
2. `embedQuery(text)`: `input: 'original-query'` (neural) sends the user's wording with the
   profile's `query: ` prefix; the default sends `semanticQueryText(analysis)` (joined normalised
   positive facts), which the feature-hash profile was tuned for. The query embedder runs in a worker
   and rejects with `semantic-model-not-installed` until the model is downloaded.
3. `store.searchVector({profileId, vector, norm, filters, limit: max(limit × 5, 50)})`.
   `MultiMedicalStore` is two-phase when every mount implements it: `scoreVectors` per pack
   (scores only, top window = `min(500, max(limit × 10, 100))`), global top window, then
   `hydrateVectorHits` per pack for the chosen chunks only. `SqliteMedicalStore.scoreVectors`
   scans an in-memory index (chunk ids, document ids, section types, Int8 vectors, norms) built on
   the first query; specialty/age filters fall back to a SQL join scan.
4. `fuseSemanticResults` with the embedder's `SemanticFusion` (`LEGACY_SEMANTIC_FUSION` without one):
   - `semantic` mode: vector hits only, `finalScore = cosine`;
   - `hybrid`: lexical score / best lexical × `lexicalWeight`; semantic strength = cosine relative
     to the query's best cosine within `band` (0…1; raw cosine without a band); vector-only hit =
     strength × `vectorOnlyWeight`; found by both = lexical part + strength × `corroborationWeight`
     + 0.04. With `confidence {low, high}` every strength is also multiplied by where the query's
     best cosine lies between `low` (0) and `high` (1), so unsure vectors fall back to lexical
     ranking. KD1: band 0.50, confidence 0.25–0.35, weights 0.3 / 0.8 / 0.3 (student cosines spread
     wider than e5's, which used band 0.10, 0.5 / 0.8 / 0.3). Legacy: no band, 0.78 / 0.62 / 0.22.
   Exact-alias documents and the exact subject title survive the cut as in lexical fusion.

5. **Descriptions in «Все» (items 5/14).** «Все» searches in lexical lookup mode. After the name
   variants and the spelling correction, `withDescriptionRecommendations` checks the response: a
   query with at least two Cyrillic words that names nothing (`responseNamesQuery(…, exact)`), was
   not rewritten, corrected or scoped to a source, first asks the embedder for its vector (cached:
   `NeuralQueryEmbedder` reuses the last query's vector for the following search). Without the model
   the response carries `descriptionRecommendations: {status: 'model-missing'}` and the app offers
   the download (`SemanticModelOffer`); with it, a clinical hybrid search runs and up to three
   recommendations with a semantic score that are not already listed go right behind the first
   lexical group (`{status: 'added', documentIds}`).

Any failure falls back to lexical and is reported in `diagnostics.semantic` (`status`,
`profileId`, `candidateCount`, `elapsedMs`, `fallbackReason`: `query-embedder-unavailable`,
`embedding-profile-mismatch`, `invalid-query-vector`, `no-vector-candidates`, `semantic-error:*`).

Data: `embedding_profiles(id, dimensions, vector_format='int8', normalization='l2', generator,
generator_version, fingerprint UNIQUE, metadata_json)` and `chunk_embeddings(profile_id, chunk_id,
vector BLOB, vector_norm)`. Vectors are L2-normalised, ×127, rounded half away from zero
(`quantizeEmbedding`). КР modules carry `localmed.kd1-giga480m.384.int8.v1` since mirror tag
`clinical-kd1-2026.10.11`, the ГРЛС instruction and Allmed modules on their indication sections
(tags `…-kd1`); other packs carry no vectors (or the old feature-hash scaffold, which the embedder
ignores). The Capacitor native store answers `scoreVectors` only if the plugin exposes
`searchVectors`; installed modules are mounted through the browser runtime (WASM/OPFS
`SqliteMedicalStore`), so they use the JS scan above.

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
- Lexical lookup only: `rankSearchGroupsByQuery` gets `lookupTermGroups` and prefers groups with every
  subject word (`everyWord`); `dropGroupsWithoutSubject` then removes groups that share no subject
  word (protected: exact identities, spelling candidates, terminology matches). `ScopedMedicalCore`
  `rankSearchGroupsByAudience` gets the query and lets an audience tag help only titles that name the
  subject.
- `filterSuffixFallbackGroups`, then `TerminologySearchIndex.rank`, then (lexical lookup of a list of
  complaints, `isSymptomPhraseQuery`) `prioritizeSymptomLevelGroups` (`symptom-phrase-ranking.ts`),
  then a stable sort that puts exact title, secondary identity (navigation alias / short title /
  the МКБ-10 card of a typed code, `QueryDocumentIndex.exactIcdCardIds`) and spelling documents first,
  then `collapseGroupsByTargetDocument` (a pointer and its installed full document become one
  group), then `slice(0, limit)`.

### МКБ → recommendation bridge (S3, item 4)

After ranking and before the collapse of pointers into documents, `bridgeIcdRecommendations`
(`create-medical-core.ts`, data side in `icd-bridge.ts`) joins a diagnosis to the recommendations
that cover it through source codes only:

- The best-ranked (`cards` = 5) groups that are not recommendations but carry МКБ codes
  (`documentIcdCodes`: `icd10Codes`/`mkbCode`; cards, disease articles, core pointers) lend their
  codes if their score is at least 30 % of the best card's.
- `IcdRecommendationIndex` (built lazily from the search documents) lists recommendations and
  recommendation pointers (`catalogFamily: 'clinical'`, `icd10Codes`) by МКБ category; a recommendation
  matches a code that it lists, or a category/subcode of it; sibling subcodes never match.
  At most 4 per card and 6 in total; recommendations already in the list (also through their pointer's
  `targetDocumentId`) are skipped. Their passages are read by `buildExactIdentityResults` and labelled
  «Рекомендация по коду МКБ J20.9».
- Placement depends on the evidence and the mode (`DEFAULT_ICD_BRIDGE_TUNING`): a card whose title
  covers ≥ 80 % of the query words (`titleCoverage`) is a diagnosis match. **Clinical analysis**:
  its recommendations go first, behind exact-name groups; weaker cards add nothing. **Lookup**: only
  when the first group is itself a card or disease article; its recommendations follow the first
  recommendation found by words, weaker cards' the first two. Exact names, aliases and spelling
  candidates (`pinnedIds`) are never moved.
- `createMedicalCore({icdBridge: false | Partial<IcdBridgeTuning>})` switches or tunes it; the e5
  hybrid path uses the same code after `fuseSemanticResults` and grouping.

### Drugs by ATC code (ATC5)

A query that is an ATC code or prefix also lists the drugs carrying it, in front of the text hits. One reading
rule serves the core and every drug picker (`packages/search-lexical/src/atc-query.ts`):

- `parseAtcQueries(text)`: the whole text, spaces and invisible characters ignored, has the code shape — an anatomical
  letter, two digits, then as much of «letter, letter, digit, digit» as was typed (`J05`, `J05A`, `J05AX`, `J05AX1`,
  `J05AX13`); anything else (a word, a lone letter, a letter with one digit such as «С3», «ВИЧ», a longer text) is no code.
  Typed on the wrong script it is still read: Cyrillic look-alikes (А В С Е Н К М О Р Т Х У) and the keys of the Russian
  layout (`latinKeyOfRussianLetter`: «о05» is `J05`). The readings come in order — as it looks, as keys, character by
  character — and a text with two readings («м01ае01»: `M01AE01` by look, `V01FT01` by key) gives both.
- `findAtcEntries(query, entries)`: an entry matches when any of its codes begins with the typed code; the exact level
  (the drug carries that very code) first, then by name. A card with an agreed code beside a registry group stub (ATC3)
  matches under either and reports the agreed code with the stub («J05AX13 · в реестре: L03AX»).
- **Core side** (`packages/core/src/atc-drug-search.ts`, `createMedicalCore({ drugCodes })`): `search()` runs the text
  search with its fallbacks as before, then `withAtcDrugs` — only for lookup mode and without specialty / audience /
  section filters. The first reading that names a drug wins; each drug is the installed record
  (`esklp.mnn.<slug>`) or, when its module is not installed, its catalogue pointer
  (`QueryDocumentIndex.documentIdsForTarget`), read through `buildExactIdentityResults`, so the request's
  `documentIds` scope applies. The groups carry `atcMatch` (`SearchAtcMatch`), go in front of the text hits (an МКБ-10
  card named by the same letters and digits, `M05`, stays first), a drug the text search found too is listed once, and a
  query typed with the Russian layout gets `queryRewrite: {kind: 'layout'}` («Показаны результаты по: «J05»»).
  `ScopedMedicalCore` keeps `atcMatch` groups through its medication-intent filters. Without `drugCodes` nothing changes.
- **Directory** (`apps/app/src/features/drug-comparison/comparison-atc-directory.ts`): one entry per ЕСКЛП МНН card of the
  comparison index (`a`: the registry's, the completed and the agreed codes; `q`: `[agreed, registry]` pairs, added by
  `scripts/build-drug-comparison.ts`). The index ships with the app (a lazy 2.5 MB chunk, loaded on the first code query), so
  the lookup is offline and needs no module. The composition passes it to the three cores (`create-browser-core.ts`).
- **Pickers** read the same groups through `ScopedMedicalCore('medications')`: comparison (`findDrugs`, `resolveDrugName`),
  interactions (`findDrugCandidates`, `resolveTypedName`), prescription and the search dose card (`findDoseCandidates`), the
  safety card (`resolveSafetyCandidate`); suggestions show the code (`AtcMatchBadge`). A resolver that needs one drug takes
  a full code or a prefix that holds exactly one (`atc-groups.ts` `singleByCode`). The medication list
  (`medication-catalog-search.ts`) matches `MedicationProduct.atcCodes` with the same reading.

Measured by `bun run benchmark:atc` (generated from the directory) and the unchanged name gates: see roadmap item 21.

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
| `tools/benchmarks/src/probe-exact-lookup.ts` | S2 probe: top-5 titles of every lookup miss (release + doctor-lookup sets) and of «nonsense» probes («от головной боли», «таблетки от головы») in the «Все» and «Лекарства» scopes; `--query="…"` adds queries |
| `tools/benchmarks/retrieval-icd-queries.json` | Q1 real-language queries with ICD-based КР relevance |
| `tools/benchmarks/src/run-icd-bridge.ts` | S3 item 4: Q1 through `ScopedMedicalCore('diagnosis' \| 'guidelines')`, bridge off/on, optional `--packs=<КР modules>`, `--e5-model-dir=`, `--tunings='[…]'` |
| `tools/benchmarks/src/build-name-variant-queries.ts` → `name-variant-queries.json`, `run-name-variants.ts` | S3 item 3: layout / Latin-spelling variants of real names plus negative controls, fallback off/on, hit@1/hit@5 and latency |
| `tools/benchmarks/src/build-typo-queries.ts` → `typo-queries.json`, `run-typo-queries.ts` | item 19: one slip (neighbour key, sound-alike vowel, unrelated letter in the first three letters; a late neighbour key) in real names, plus controls that must not change, correction off/on |
| `S3_OFF=1` (any `openRealCorpus` benchmark), `S3_BRIDGE_JSON='{…}'` | state before S3 / tuning override for `run-real-corpus`, `run-doctor-lookup`, `run-owner-queries` |
| `bun run benchmark:atc` | ATC5: every full code of every card finds its card, agreed pairs show both codes, typing variants (case, spaces, look-alikes, Russian layout) give the same drugs, words and short codes never match; `ATC5_OFF=1` removes the directory from any `openRealCorpus` benchmark |
| `bun run benchmark:source-names` (`source-name-queries.json`) | source-name intent (read as expected, results inside the source, negatives stay plain) and the drug overview line; `--check` fails on any miss |
| `tools/benchmarks/src/run-semantic-kr.ts` | Q1 over the embedded КР packs through MedicalCore: lexical / semantic / hybrid, `--grid` over fusion constants |

## Pitfalls

- Cross-pack lexical scores are RRF positions, so a weak hit at position 1 of a tiny pack ties with
  a strong hit at position 1 of a large one.
- A neural embedder must set `input: 'original-query'`; the default feeds normalised facts.
- The vector scan is linear in the embedded chunks of every mounted pack (95 827 for all КР:
  ~37 MB of Int8 in memory once warmed).
- `rankSearchGroupsByQuery` reorders after fusion, so fusion weights must be tuned end to end
  (`run-semantic-kr.ts`), not on raw cosine rankings.
