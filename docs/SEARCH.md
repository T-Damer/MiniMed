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
- `clause` — useful individual clauses from the narrative.

Branches have explicit weights and appear in diagnostics. A failed specialized branch does not
block the others.

## Normalization and aliases

The lexical layer applies Unicode normalization, lowercase, `ё → е`, safe punctuation handling,
light transparent Russian suffix normalization, and additive aliases. Example fixture aliases:

```text
часто дышит -> тахипноэ
температурит -> лихорадка
оам -> общий анализ мочи
рези при мочеиспускании -> дизурия болезненное мочеиспускание
аугментин -> амоксициллин клавулановая кислота
справа внизу живота -> правая подвздошная область
```

Raw user text is never interpolated into SQL. The planner emits a safe bind value for FTS5.

## Rank fusion

Each branch retrieves a BM25-ranked candidate list. Fusion preserves the strongest normalized
lexical evidence and adds only a capped corroboration bonus from additional branches. This avoids
a known failure mode of plain reciprocal-rank summation, where one weak chunk can win merely by
appearing in several nearly duplicated branches.

Small transparent section boosts are applied only when branch intent matches section type, for
example investigation → diagnostics and medication → treatment. Each result exposes:

- lexical and final score;
- matched terms;
- matched branches;
- section type and user-facing category;
- document, version, section, chunk, and stable anchor.

## Snippets and source context

Source text is rendered as text nodes; computed ranges become `<mark>` elements. Untrusted corpus
text is never injected as HTML. Selecting a result loads the focus chunk plus configurable
neighbors and can open the whole section.

## Regression benchmarks

```bash
bun run benchmark:search  # 30 compact lexical queries
bun run benchmark:cases   # 5 long clinical descriptions
bun run benchmark:all
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
