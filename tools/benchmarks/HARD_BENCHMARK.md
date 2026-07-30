# Hard medical retrieval benchmark

`hard-medical-queries-1500` is a reproducible **synthetic baseline**, not a claim that all 1500 rows
were typed by real clinicians or parents. It contains 300 information needs with five controlled
styles each: professional, colloquial, keyword, noisy, and case narrative. Its main purpose is to
expose regressions, query-style brittleness, section-ranking errors, and obviously dangerous matches.

The fixture is stored as checked, gzip-compressed base64 split into deterministic text parts so it
remains compatible with the GitHub Contents API. `hard-query-dataset.ts` verifies compressed and
uncompressed SHA-256 checksums, query uniqueness, split counts, style counts, scenario count, and
no-answer probes before returning a row.

## Run

Build or provide a SQLite corpus, then run:

```bash
bun run benchmark:hard
```

Environment controls:

```text
MINIMED_HARD_BENCHMARK_DB=data/build/rf-public-pilot.db
MINIMED_HARD_BENCHMARK_SPLIT=all|dev|validation|hidden_test
MINIMED_HARD_BENCHMARK_MODE=auto|lexical|semantic|hybrid
MINIMED_HARD_BENCHMARK_MAX_QUERIES=100
MINIMED_HARD_BENCHMARK_MIN_RECALL_AT_5=0.80
MINIMED_HARD_BENCHMARK_MIN_SECTION_RECALL_AT_5=0.60
MINIMED_HARD_BENCHMARK_MAX_FORBIDDEN_RATE_AT_5=0.01
```

`MINIMED_HARD_BENCHMARK_MAX_QUERIES` is intended only for smoke runs; omit it for a scored comparison.
No quality threshold is enabled by default because the public pilot does not contain an answer for all
75 topics. Release workflows should point the runner at a known corpus and set explicit thresholds.
The report is written to `data/build/hard-medical-benchmark-<split>.json` with per-query rows and slices
by style, intent, and specialty.

## Interpretation

The automatic entity labels are weak supervision. A required-term miss can be a false negative when a
document uses a synonym, and a forbidden phrase only detects the labelled failure mode. Use the report
to compare engines and identify regressions, then manually review a stratified sample.

The committed `hidden_test` split is held out from ordinary tuning but is not genuinely secret once it
is in the repository. A final release gate still needs 200–300 private, human-written queries kept out
of the repository and out of the context of the agent modifying retrieval.
