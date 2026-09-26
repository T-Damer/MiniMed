# Medication-name suffixes and selected reference fills — 2026-09-23

Work remains in draft PR #180 on `experiment/system-one-search-benchmark`, stacked on #174.
The machine receipts below identify the measured implementation commit; this note is not a
claim that every repository, clinical or physical-device qualification gate passes.

## Why a standard edit-distance matcher still missed these inputs

The stored source name is `Канефрон Н`, while the user types `канефрно`, `канифрон` or
`конифрон`. The previous matcher required identical word/separator structure. Making the edit
budget globally larger would not repair that candidate-generation restriction safely.

The fix adds a search-only projection for an existing substantial one-word medication name
followed by a one-letter source marker. Its incomplete lookup handle can use the same bounded
weighted OSA comparison as ordinary names. Results retain the complete original source name,
its canonical catalog targets and an explicit omitted-marker indication. No name/ingredient
record is rewritten or merged, and no drug-specific misspelling aliases are added to the corpus.

An explicitly entered marker is not corrected or discarded. `Канефрон Н` stays an exact known
name; `канефрон п` is not silently turned into it. Multiple source variants remain alternatives.
Forte/Retard, manufacturer names, numeric strengths and other longer qualifiers are not stripped.
The original query, dose/unit text, source identifiers and exact source navigation remain intact.
This path belongs to ordinary lookup, not clinical fact extraction or dosage calculations.

New tests cover the user's variants, every adjacent swap in four representative source names,
and final-character deletion, duplication and substitution. The broader corpus audit uses actual
marked aliases and retains the previous 162 cases without changing their expected targets.
It separately checks full exact-name result arrays, excluded document/section/specialty/age
filters, and the source context of recovered results. Remaining failures stay in the denominator.

## Existing solutions reviewed

- SymSpell: https://github.com/wolfgarbe/SymSpell
- RapidFuzz OSA: https://rapidfuzz.github.io/RapidFuzz/Usage/distance/OSA.html

These provide established spelling-search and distance approaches. SymSpell's delete index is a
candidate-generation optimization; it does not, by itself, define which medical name qualifiers
may be omitted or whether near-identical products are equivalent. No SymSpell/RapidFuzz package
was installed and their published performance numbers are not attributed to MiniMed. The current
change keeps the existing weighted OSA matcher and repairs the source-name projection. Wider
qualifier support and on-device performance still require separate evaluation.

## Actual evidence and content boundaries

- `medication-suffix-2026.09.23-suffix-1.json`: same-database, previous-core comparison; individual
  cases, ranks, exact-name checks, filters, context checks and host latency.
- `selected-completions-2026.09.23-suffix-1.json`: independent source fetch outcomes, accepted and
  deferred candidates, before/after coverage, preserved identities and old source blocks.
- `selected-completion-build-2026.09.23-suffix-1.json`: ordinary offline SQLite build, logical
  round-trip, corpus coverage, scoped tests and file checksums/sizes.
- `selected-completion-reader-2026.09.23-suffix-1.json`: accepted definitions read through the
  actual SQLite adapter, exact text and source links, and named lookup ranks.

The selected source batch prefers professional MSD Manual passages and uses short inspected
INVITRO/K+31 passages only for appropriate candidate definitions. It preserves the source's
wording and any source-specific laboratory threshold, rather than turning it into a universal
reference interval. Exact text, author where stated, source URL/locator and hashes are recorded.
HTTP, robots, author or text-verification failures are deferrals, not successful acquisitions.

New content remains `source-excerpt`, `requires-review`, `local-dev`, and ineligible for public
release. Completion inputs register with the ordinary preparer; generated SQLite is not edited
by hand. No executable clinical facts, same-as relations, model weights, patient data, APK or
public database release are part of this change.

The dedicated qualification run may create a mechanical formatting commit before tests. The
reported checked commit is that committed tree, not an earlier unformatted working copy. All
subsequent measurements reject uncommitted implementation changes. Baseline dependencies remain
isolated from current workspace packages. No cache or Actions artifact uploads are needed.
