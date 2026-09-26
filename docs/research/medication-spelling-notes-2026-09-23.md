# Medication spelling lookup — 2026-09-23

Implementation commit: `df51379f6c4fc01dca637851eab2fb2bd576004d` on existing PR #180,
`experiment/system-one-search-benchmark`, stacked on #174. No merge, APK, release or content acquisition.

## Main source lookup, not only the definition dictionary

The public `buildLookupQueryPlan` now wraps the existing lookup planner with bounded spelling
candidates from the installed medication alias vocabulary. The clinical parser still imports the
original analysis implementation: spelling alternatives are not patient facts, medication
substitutions, contraindication decisions or dosage calculations.

Candidates support adjacent-letter swaps, insertion/deletion (including doubled consonants),
ordinary single-letter replacements and direct weighted confusion pairs:
`и/е`, `е/о`, `а/о`, `д/т`, `з/с`, `ж/ш`, `б/п`, `в/ф`, `г/к`, `ш/щ`, `и/й`, `е/э`.
Existing normalization handles `ё/е`. The pairs are engineering search costs, not a measured
frequency model of doctors' errors, a linguistic equivalence relation or permission to merge
medicine identities. Transitive folding of all vowels is deliberately avoided.

The matcher uses banded optimal-string-alignment distances and independent edit-count limits.
Short 5–6-letter tokens allow one edit; longer tokens can allow two or three under a separate
weighted budget. Tokens shorter than five letters, codes, numeric strengths and mixed-script
names do not enter this new fuzzy matcher. Prefixes such as `инструкция к` and trailing strength,
units or presentation words are preserved in the alternative query. The original query is
returned unchanged. Multiword names retain word/separator structure; the name does not acquire
missing manufacturer or single-letter presentation suffixes automatically.

At most eight named alternatives become extra lookup branches. The index contains the already
available names, not source bodies or a second SQLite owner. Length buckets and a conservative
letter-mask bound prune distance calculations; the immutable vocabulary owns a collectible cache.
No model, external service, new package dependency, content schema or database migration is needed.

An actual full-corpus check exposed an existing suffix-fallback filter hiding the corrected
single-ingredient card behind combination medicines. The core now retains eligible corrected-name
candidates through chunk cutoffs and that filter, and ranks their source identities below real
exact names but above broad body-only matches. The existing document/age/specialty/section checks
still apply to restored source chunks. Restored spelling evidence is explicitly labelled as a
possible spelling mistake, never as an exact original-query match.

## Reproducible verification

The durable machine receipt is `medication-spelling-2026-09-23.json`, produced by
`.github/workflows/medication-spelling-verify.yml`. It records the checked commit and run, the
unchanged database checksum, individual outcomes, source-context checks, scope tests, latency,
and a comparison against the separate baseline checkout `06b3c68de2725f124d15140daf317dc5400d199b`.

The benchmark uses the actual ordinary `MedicalCore.search`, not a standalone distance score.
Its corpus includes 19,987 documents, 3,324 medication catalog records and 21,610 medication alias
rows. These are source/catalog records, not a count of complete drug instructions or unique brands.

The development set contains 140 mechanically corrupted real names in deterministic hash order
and 22 authored regression queries. Mechanical cases cover swaps, missing letters, extra letters,
arbitrary substitutions, and one/two/three direct letter confusions. The corruption code does not
call the production matcher or select cases based on its success. Existing-name collisions are
excluded explicitly and counted. The 113 exact-name queries compare complete result-group arrays;
clinical-parser comparison is separate. Cases are not independent clinician typo logs, and the
whole-name sample does not establish recall for every trade name or clinical narrative.

Run with a separately installed baseline checkout:

```bash
bun scripts/restore-core.mjs
bun tools/benchmarks/medication-spelling-audit.mjs \
  apps/app/public/content/core.db \
  baseline-source/packages/core/src/create-medical-core.ts \
  packages/core/src/create-medical-core.ts \
  data/build/medication-spelling-results.json "$(git rev-parse HEAD)"
```

Do not point baseline workspace aliases at current packages. No runtime source patches or gold
rewrites belong in this check. Single-host latency is not Android/WebView qualification.

## Extra exploratory brand checks: keep the uncovered cases visible

Outside the fixed 162-case set, direct ordinary-core smoke queries on the same source version showed:

- `нурафен` and `нурофне`: proposed `Нурофен`, retrieving its existing ibuprofen catalog group.
- `амаксиклав`: proposed `Амоксиклав`, retrieving its existing combination catalog group.
- `канефрно`: no result and no spelling candidate. A missing short suffix on the stored trade name
  is not handled by this matcher; this remains an explicit limitation, not a counted success.
- `цитромон`: the existing search returns several combination groups without a new spelling
  candidate. No claim of newly corrected trade-name disambiguation is made for this case.

These exploratory checks are not part of the 162-case denominator or the CI regression gate.
Names with suffixes, incomplete brand names, wider spelling distances, phrase context and a
clinician-authored ambiguity set remain further evaluation work. Do not advertise the passing
mechanical set as 100% medication-search coverage. The four previously documented free-description
misses in the definition reader are also not closed by this medication-specific change.
