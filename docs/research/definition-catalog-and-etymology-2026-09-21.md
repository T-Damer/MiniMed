# Compact definitions and etymology

Date: 2026-09-21. Work remains in draft PR #180, stacked on #174. No merge, release, model download or Actions artifact upload is authorized by this note.

## User requirements

- Find a term by its name, alias, incomplete remembered definition or individual criterion points. A document merely mentioning a term is not a substitute for its definition.
- Preserve distinct meanings of ambiguous eponyms. The consciousness-obscuration criteria associated with Jaspers and the reactive-state triad are separate staging identities, with four and three items respectively; neither is an invented score.
- Accept multiple source families, including lower-authority references such as Krasota i Meditsina, into an explicitly review-required authoring queue. Source reputation is not clinical review, and clinical review is not permission to redistribute source text.
- Keep mobile downloads small. Store source descriptions once, use numeric references, retain exact article/chapter locators, and do not make a complete source book/article a dependency of a short definition.
- **Personal product requirement: etymology is a first-class part of a term card.** Show the original spelling, language, transliteration where useful, component meanings and literal sense. Greek, Latin, German and English must be supported. This requirement is planned, not implemented by this note.

## Immediate definition slice

The local work uses a small JSON authoring catalog, a shared numeric source list, explicit `requires-review`, `local-dev` and `editorial-paraphrase` markers, and a bounded deterministic inverted index in core. It does not create reviewed knowledge facts, same-as edges, diagnostic rules or another canonical medical graph.

The browser preview must remain opt-in and DEV-only until rights, clinical review and integration are qualified. Retrieval must not fetch source websites, send queries to a server or require an LLM. Opening an external citation is an explicit user action. Ordinary MedicalCore document search and the diagnostic/assistant path remain separate.

The starter catalog is not a claim of bulk-corpus completion. At authoring time, 36 draft entries were prepared using the NCPZ library, a third-party psychiatric dictionary mirror, NINDS, NIDCD and NHS pages. Krasota i Meditsina already has repository ingestion tooling; its prepared material is a follow-up input, not an invented extra source for this starter. A web page with no retrievable text must remain pending rather than acquire a fabricated definition.

## Compact storage contract

A source record contains an integer ID, publication/collection title, base URL, authority and access date. Each definition retains the source ID, relative path and a precise textual locator. Different definitions from one source do not repeat its publisher description. Conflicting definitions are preserved as separate source-backed drafts, not automatically harmonized.

The starter has a 256 KiB serialized-data ceiling. This is an admission limit, not a measured SQLite size. Larger additions belong in optional, versioned content modules through the existing installer and SQLite ownership model; do not grow a hardcoded JavaScript dictionary without a bound.

For modular deployment, numeric references must be scoped by a source-catalog identity and version/hash. IDs are append-only and never reused after removal. Install source tables and dependent records atomically, reject missing references, and measure both transport bytes and installed bytes. Deduplication must never discard the exact source edition, article, page, section or anchor. No numbered SQL migration is introduced by this JSON preview; integrating these fields into SQLite will require one.

## Planned etymology model — not implemented

Use the existing canonical concept identity after review; until then use the draft identity. Keep etymology separate from the clinical definition and its review status.

Suggested normalized records:

```text
etymology_roots
  root_id: integer
  language: grc | la | de | en | another explicitly declared language
  original: source spelling, preserved in Unicode
  transliteration: optional
  meaning_ru: one source-supported sense
  references: shared numeric source references plus exact locators
  review_status: requires-review | reviewed

term_etymologies
  term_id: canonical or explicitly draft identity
  components: ordered root IDs with their roles
  literal_meaning_ru: short literal meaning, not a diagnostic definition
  borrowing_path: optional, only when independently supported
  note: optional ambiguity/history note
  references: the same shared source registry
  review_status: independent of the term's clinical review
```

Do not key a root solely by its letters: identical spellings can represent different languages or meanings. Do not infer a prefix from the first letter of every word. Preserve the original spelling; search can additionally use transliteration, but normalization must not overwrite source text.

### Card presentation

Place a compact origin line directly below the term name when information exists; expand it for the component breakdown, borrowing history and sources. Do not bury this feature exclusively in bibliography metadata.

Illustrative wording, not a newly approved clinical entry:

> Анестезия. Происхождение: греческие an- «без» и aisthēsis «ощущение»; буквально — «без ощущения».

The example deliberately does not label those roots Latin. Collins' English entry distinguishes the Greek formation from the New Latin borrowing stage: https://www.collinsdictionary.com/dictionary/english/anaesthesia (Word origin, accessed 2026-09-21). A Russian borrowing history requires its own evidence; the English entry is not proof of that entire chain.

The literal sense is a memory aid, not a replacement for the modern medical definition. Names derived from people need an attribution/history note, not an invented translation into roots. Uncertain or conflicting origins stay marked as requiring review; absence of an etymology is preferable to a fluent but unsupported derivation.

### Retrieval and size

Etymological spellings and literal translations may participate in an explicitly lexical/learning search mode. They must not create clinical equivalence, symptom-to-diagnosis edges or automatic expansion of diagnostic queries. A common root must not swamp exact term matches.

Reuse the numeric source catalog and store each root/sense once. An optional term module should require only its referenced root subset, not an entire general-language dictionary. Etymology loading must not block the definition card or ordinary offline search.

### Acceptance before enabling etymology

- A reviewed multi-language fixture covers original spelling, transliteration, compound words, mixed-language formations, ambiguous roots and eponyms.
- Every displayed derivation resolves to a real source locator; publication authority and review state remain distinct.
- Literal meaning and clinical definition are separately labelled, and no missing origin is synthesized automatically.
- Missing optional root data leaves definition lookup working; broken numeric references fail validation.
- Transport size, installed size and peak lookup memory are measured on the actual module. Do not advertise gzip JSON bytes as SQLite/device footprint.

## Verification boundaries

Authored reverse-lookup probes belong to a separate regression suite. They are not an independent clinician benchmark and must not be added to the 33-query clinical denominator to inflate quality. Record initial failures, final ranks and unresolved collisions; do not add probe sentences as aliases.

Full repository checks, actual browser integration and Android validation remain separate from isolated TypeScript/Node execution. This note does not claim those checks passed. The implementation and measurements will be recorded in a companion verification note when executed.
