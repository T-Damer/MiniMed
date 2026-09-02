# Search design — 0.3.0 alpha

## Default offline path

```text
long free-form case
  → deterministic case analysis
  → source-linked facts and missing-field suggestions
  → negation-aware concept selection
  → several weighted lexical branches
  → FTS5/BM25 candidates
  + local query embedding
  → exact filtered vector candidates
  → hybrid fusion
  → document groups
  → exact source context
```

No generative model participates in this path. When vectors are unavailable or incompatible, the complete lexical path remains active.

## Core-only pointers and modules

The bundled core indexes lightweight medication and clinical-recommendation pointers. If the full
document or medicine pack is not installed, search can still show the pointer and offer the exact
module download; after installation, the result reconnects to the full source document. ESKLP
identity modules are preview content and are available only when Experimental modules are enabled.

SQLite packs larger than 32 MiB use OPFS in the browser; small packs stay on the WASM path.

## Personal overlay

Notes and uploaded books are searched outside SQLite. A hit requires every distinctive query stem
(length ≥ 5 after light stemming), with bounded-edit inflected forms. Short leftovers (`мг`, `500`,
`вес`) only matter when the query has no distinctive stem. One shared generic word is not a match.

## Deterministic case analysis

`packages/search-lexical` currently recognizes:

- age and sex;
- duration and basic timeline phrases;
- measured temperature;
- mass, SpO2, heart rate, respiratory rate, and blood pressure;
- common investigations and abbreviations;
- medication phrases and trade-name aliases present in the pack;
- locations and a small epidemiological vocabulary;
- positive aliases/symptom concepts;
- common explicit negations;
- uncertainty warnings for phrases such as «кажется» or «вроде».

Every extracted fact keeps a character range into `originalQuery`. This is a search aid, not a
complete medical NLP parser. The original text always remains available and searchable.

## Branches

A long description can produce at most seven branches and 28 terms per branch:

- `clinical` — strongest positive symptoms, aliases, locations, and relevant concepts;
- `original` — normalized original wording as a recall fallback;
- `investigation` — laboratory/instrumental terms;
- `medication` — current therapy and drug aliases;
- `medication-presentation` — a high-weight conjunction for a brand/MNN with the requested form,
  route, and strength;
- `clause` — useful individual clauses from the narrative.

Branches have explicit weights and appear in diagnostics. A failed specialized branch does not
block the others.

## Normalization and aliases

The lexical layer applies Unicode normalization, lowercase, `ё → е`, safe punctuation handling,
light transparent Russian suffix normalization, and additive aliases. Abbreviations match only at
word boundaries, so a short form such as `АД` cannot expand from the middle of an unrelated word.
Example fixture aliases:

```text
часто дышит -> тахипноэ
температурит -> лихорадка
оам -> общий анализ мочи
оак -> общий анализ крови
срб / CRP -> С-реактивный белок
рези при мочеиспускании -> дизурия болезненное мочеиспускание
аугментин -> амоксициллин клавулановая кислота
справа внизу живота -> правая подвздошная область
```

Raw user text is never interpolated into SQL. The planner emits a safe bind value for FTS5.

Clinical recommendation pointers project disease aliases/synonyms and explicit terms from valid
`Ключевые слова` sections into the recall vocabulary. These terms improve candidate coverage but are
not exact diagnoses and do not create treatment or dose assertions. The combined
`Ключевые слова Список сокращений` section is ignored; abbreviations are not promoted to keywords
automatically.

Medication-form aliases are additive and source-preserving. `сироп` (including `спироп`) adds the
exact FTS phrase `суспензия для приема внутрь`; suspension inflections add `сироп`. The phrase is not
split into generic suspension tokens, so injection and external suspensions receive no syrup boost.
The exact requested source form remains ahead of an equivalent form, and displayed form labels stay
as registered in the source.

The measured medication smoke cases keep the correct ESKLP suspension section first for
`нурофен суспензия` and `100 мг/5 мл`, return no result for `нурофен мазь`, and preserve the
ceftriaxone intravenous match. This verifies identity retrieval only; it does not supply a dose.

Administration-route shorthand is also additive: `в/м` searches `внутримышечно`, and `в/в` searches
`внутривенно`. Route, age, and body-mass terms refine the source result but do not weaken an exact
single-ingredient title in favour of a fixed combination. A bare value in kilograms can be recorded
as body mass; bare grams remain a medication strength unless explicitly labelled as weight or mass.
Search does not turn these facts into an individualized dose.

## Rank fusion

Each branch retrieves a BM25-ranked candidate list. Fusion preserves the strongest normalized
lexical evidence and adds only a capped corroboration bonus from additional branches. This avoids
a known failure mode of plain reciprocal-rank summation, where one weak chunk can win merely by
appearing in several nearly duplicated branches.

After grouping by document, query-aware ranking prefers a title containing a specific query term
over a document that only mentions the term frequently in body text. Exact name/form matches still
beat combination products; terms that describe a failed prior treatment do not become the answer
solely because that treatment appears in a title.

Small transparent section boosts are applied only when branch intent matches section type, for
example investigation → diagnostics and medication → treatment. Each result exposes:

- lexical and final score;
- matched terms;
- matched branches;
- section type and user-facing category;
- document, version, section, chunk, and stable anchor.

## Snippets and source context

Known HTML fragments and entities are converted to readable plain text before snippet offsets are
computed. Source text is rendered as text nodes; computed ranges become `<mark>` elements. Untrusted
corpus text is never injected as HTML. Selecting a result loads the focus chunk plus configurable
neighbors and can open the whole section.

## Regression benchmarks

```bash
bun run benchmark:search  # 30 compact lexical queries
bun run benchmark:cases   # 5 long clinical descriptions
bun run benchmark:all
bun run benchmark:pilot   # 61 public-pilot clinical, medication, and workflow queries
```

The long-case benchmark requires the expected synthetic document at rank 1, expected extracted
fact/branch types, negative spans, and exclusion of negated terms from the positive clinical
branch. These fixtures protect mechanics only; a physician-authored real-corpus golden set is still
required before judging medical retrieval quality.

## Semantic alpha

The content builder precomputes one compact vector per chunk. Runtime work is limited to embedding
the current query and comparing it against vectors that survive SQL filters. `auto` mode uses hybrid
retrieval when the exact embedding profile is present.

```text
precompute chunk embeddings off-device
  → store immutable profile + int8 vectors in SQLite
  → embed only the user query locally
  → exact filtered cosine top-K
  → fuse with lexical candidates
  → same source-linked SearchResult
```

The current `localmed.feature-hash.384.v1` profile is a deterministic development scaffold, not a
neural medical embedding. Every response records profile ID, semantic candidate count, elapsed time,
and fallback reason. See [`SEMANTIC_RETRIEVAL.md`](SEMANTIC_RETRIEVAL.md).

A separate vector server is not required for the local MVP.
