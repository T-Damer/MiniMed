# Dictionary reliability and bounded acquisition — 2026-09-23

## Delivery and evidence

Existing branch `experiment/system-one-search-benchmark`, PR #180, still stacked on #174. No merge, release, APK or production rollout.

Checked implementation: `789c4b8584b23b2fa9bb005240b3531d4f537968`.
Data and machine receipts: `308e4045919ddc939ddaec32d75d1bb6fbaacdd8`.
Completed verification: [Actions run 35903265987](https://github.com/T-Damer/MiniMed/actions/runs/35903265987).
Frozen comparison reader: `2a6f1a098d407c05317d5879c2c412054e035c48`.

Machine evidence:

- [Build, tests and source identity checks](definition-reliability-build-2026.09.23-reliability-2.json).
- [Actual acquisition outcomes](catalog-completions-2026.09.23-reliability-2.json).
- [Same-database description and exact-name comparison](definition-reliability-search-2026.09.23-reliability-2.json).
- [Deterministic real-name spelling comparison](definition-spelling-2026.09.23-reliability-2.json).

## Implemented search repairs

Exact full names still take priority. Existing definition-question parsing now resolves an exact quoted or framed subject before full-text retrieval. An empty request such as `что за термин` no longer returns an arbitrary definition.

A single adjacent-letter transposition in a normalized 6–48-letter Cyrillic or Latin name is retrieved through at most 47 equality candidates in `knowledge_names`, after exact identity lookup. Numeric codes, short abbreviations, mixed scripts and multiword descriptions do not use this correction. This is not a clinical alias table, synonym inference or a new corpus-wide JavaScript index.

The description ranker evaluates each bounded source passage independently. It no longer concatenates unrelated passages to fabricate coverage, discards a later passage behind a concatenated 4096-character prefix, or increases rarity weights merely because evidence is repeated. Polarity conflicts are checked in both directions; rejected evidence cannot reappear through the legacy body fallback. Short two-term absence descriptions also require evidence when the result limit is one. Additive `не только` is not treated as absence.

These are deterministic dictionary-reader changes, not proof of general clinical understanding. Negation remains a bounded clause-level heuristic rather than a complete semantic parser.

## Measurements

Both old and new readers used the same final SQLite bytes: SHA-256 `3132166453fdda5285d1dd229562f67a901bec94bdd4cd358ba0ce11741ea5d9`. Changes in content are therefore not credited as changes in ranking logic.

| Check | Frozen reader | New reader |
| --- | ---: | ---: |
| 100 deterministic single-transposition queries, Top-1 | 0/100 | 100/100 |
| Same spelling queries, Top-20 | 0/100 | 100/100 |
| Spelling queries using full-text retrieval | 100 | 0 |
| Existing authored/source-derived descriptions, Top-1 | 30/32 | 30/32 |
| Five additional regressions, Top-1 | 0/5 | 3/5 |

All 12,644 distinct normalized exact-name queries retained identical full result arrays. There were no rank regressions on the frozen description cases. All six final empty/unrelated-query controls returned no results; two previously returned unrelated cards.

The spelling sample is generated from actual unambiguous stored names in fixed SHA-256 order, independently of the production candidate generator. It excludes corruptions that become another existing valid name. This is a reproducible mechanical spelling regression set, not an independent natural-language or clinician validation set.

Spelling p50/p95 was approximately 0.288/0.388 ms on this host, with at most two SQL statements and no FTS branch. Existing description p50/p95 was approximately 91.92/97.04 ms. These are single host runs, not Android or WebView latency qualification; a substantial general-description speedup is not established.

## Actual source filling

The first catalog attempt accepted zero definitions. Its [failure receipt](catalog-completions-2026.09.23-reliability.json) is retained. HTTP 200 responses without article content were not treated as successful acquisition. The SM Clinic catalog still returned HTTP 401 in the second attempt.

The second bounded batch used inspected alternative K+31 article pages and independently refetched the selected complete sentences. Exactly three existing empty source-local records were filled:

| Existing identity | Title |
| --- | --- |
| `ruwiki.definition.158538` | Гипергидроз |
| `ruwiki.definition.4974950` | Энтропион |
| `ruwiki.definition.142300` | Роговица |

This batch's own census is **8,467 → 8,470 definitions** and **7,602 → 7,599 pending records**, with **16,069 source-local identities** unchanged. Do not attribute the entire difference from older historical reports to these three fills. Source-local records are not a count of unique medical concepts. Another 421 same-title cases still require sense review rather than automatic merging.

The acquisition runner limits page count, respects robots policy, checks exact source text and records hashes. Full source articles are not committed. The excerpts remain `requires-review`, `local-dev`, and not approved for public redistribution or clinical use. No approved knowledge graph facts or same-as relations were created.

## Verification scope

The completed run passed 367 JavaScript tests across `search-lexical` and `storage-sqlite`, both package TypeScript checks, changed-file Biome checks, Ruff lint/format, Pyright, and 107 ingestion tests with no failures, errors or skips. The ordinary dictionary build ran under a network-denying audit hook. SQLite integrity, foreign keys, entity identities, coverage and logical storage round-trip checks passed.

Final database size: 128,970,752 bytes; gzip: 26,947,863 bytes. No database binary, model weight, APK or Actions artifact was uploaded, and cache uploads are disabled in the dedicated workflow. This is scoped verification, not an assertion that every repository or merge-readiness check is green.

## Unresolved acceptance cases — retain them

The four following descriptions still fail to retrieve their expected term in Top-20:

- `потерял голос и говорит только шёпотом` → Афония.
- `постоянно пересыхает во рту` → Ксеростомия.
- `не чувствует запах духов или кофе` → Аносмия.
- `не помнит то что случилось только что` → Фиксационная амнезия.

The three improved additional cases are exact-name questions about aphonia, xerostomia and electromyography, not these free descriptions. Do not combine the spelling results with clinical-query metrics to advertise 100% semantic quality, add answer-specific hardcoded aliases to hide these failures, or remove failed cases from the denominator.

The next unresolved search work is candidate retrieval for everyday paraphrases and longer diagnosis-free clinical questions, followed by independent evaluation and on-device latency checks. Preserve exact-name results, polarity constraints and source provenance while addressing it. Re-ranking cannot recover a relevant card that was never retrieved.

For another acquisition run, choose a fresh batch identity; existing batch receipts are immutable. The dedicated workflow is an explicit one-shot push-triggered verification, not a recurring background collector. Keep further implementation on this branch/PR unless the user changes that instruction.
