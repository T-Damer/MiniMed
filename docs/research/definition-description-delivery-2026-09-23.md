# Definition description handler and MSD intake — 2026-09-23

The exact-name path remains first and unchanged. A separate description query plan removes
only anchored navigation framing, reuses the existing light Russian stemmer with limited
case-ending support, and searches definition/item evidence through two bounded FTS branches.
At most 192 evidence rows, 4096 Unicode characters per row and 20 returned cards. Shared
blocks for a candidate are bounded again to 4096 characters before ranking. No corpus JS
index, new SQLite owner, neural model, remote query or new external dependency.

Ranking measures distinct feature coverage, rarity within the bounded pool and proximity,
rather than accepting one common word. Clause-local absence cues are retained; this is not
general semantic entailment or clinical negation/subject/time understanding. Exact source
texts and locators remain unchanged. Long descriptions, remote synonyms, ambiguous clauses
and evidence beyond the bounded text window are limitations. Existing lexical fallback
remains when no bounded description candidate qualifies; never infer a diagnosis/confidence.

## Actual same-corpus comparison

Frozen authored source-derived cases: 32/32 present in corpus.
Before Top-1/Top-20: 10/10.
After Top-1/Top-20: 30/30.
Exact-name queries compared: 12644; changes: 0.
Both readers used the same complete new database; new source acquisition is not credited
as a ranking gain. All misses/rank regressions and negative controls remain in JSON.
These queries are not independent clinical/colloquial evaluation, nor an Android benchmark.
No per-query aliases or target-specific rules were added and gold was not changed.

MSD candidates inspected: 10; added: 4;
existing-definition names deferred: 6. One source sentence per
selected title, with original wording and available source author/reviewer/edition fields.
Full HTML is not archived: hashes bind selected excerpts/prepared inputs, not original pages.
Medical review and redistribution review remain open. No full articles or scoring rules.
Original sources remain unchanged; compared 26707 source blocks in final SQLite.

Passed 106 Python tests and 46 selected Vitest cases.
Search-lexical, storage-sqlite and app typechecks passed. No whole-repository CI claim.
Installed SQLite: 129740800 bytes; gzip: 26919433 bytes.
These are file sizes, not target-device RAM. No APK, release, merge, model or UI migration.

Reproduce: prepare DEV version `2026.09.23-reverse-definitions-1`, then run
`tools/benchmarks/definition-description-audit.ts` with the database, the pinned baseline
reader (commit ed4c84a) and a new report path. The complete numerical outcome is in
`definition-description-search-2026-09-23.json`.
